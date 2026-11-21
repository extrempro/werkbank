"""Vorschläge der KI für Rollout-Phasen und Steckbrief (spec.md 8.4, 6.9).

An den Anbieter gehen nur Titel, Dienste und drei Abschnitte der Meldung von Microsoft (öffentlicher
Text), nie Notizen, Bewertungen oder Daten aus dem Tenant. Die Antwort muss ein festes JSON-Format
haben; was nicht passt, verwirft die Werkbank. Vorschläge ersetzen nur Felder, die noch niemand
geprüft hat, und sind als „KI-Vorschlag, ungeprüft“ markiert, bis jemand die Bewertung speichert.
"""

import json
import logging
import re
from datetime import timedelta
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.ai import AiCompleter, AiConfig, AiError, complete, load_ai_config, stored_ai
from werkbank.core.audit import write_audit
from werkbank.core.sessions import now_utc
from werkbank.modules.evergreen.models import EntrySource, EntryStatus, EvEntry, NoteKind
from werkbank.modules.evergreen.service import MODULE, OBJECT_TYPE, add_note

logger = logging.getLogger(__name__)

GENERATE_AI_SUGGESTIONS = "evergreen.ki_vorschlaege"
# Schalter in den Einstellungen der KI (neben „enabled“ für die Beschreibungen in M365)
EVERGREEN_FLAG = "evergreen"
SECTION_MAX = 3000
SECTIONS_FOR_AI = (
    "when this will happen",
    "when will this happen",
    "how this affects your organization",
    "how this will affect your organization",
    "how this will affect your users",
    "what you need to do to prepare",
    "what you can do to prepare",
    "what you need to do",
)
MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"

SYSTEM_PROMPT = """Du liest Meldungen aus dem Nachrichtencenter von Microsoft 365 und füllst einen
Steckbrief für die IT. Antworte ausschließlich mit einem JSON-Objekt, ohne Markdown und ohne Text
davor oder danach:
{"phases": [{"name": "...", "start": "JJJJ-MM", "end": "JJJJ-MM"}],
 "affected": "..." | null,
 "default_state": "an" | "aus" | "entfaellt" | null,
 "controllable": true | false | null,
 "controllable_how": "..." | null}
Regeln:
- phases: Rollout-Phasen aus dem Zeitplan, höchstens 6, in zeitlicher Reihenfolge. Beginn und Ende
  als Monat (JJJJ-MM); „early/mid/late“ zählen zum Monat. Steht nur ein Monat da, sind Beginn und
  Ende gleich. Namen auf Deutsch: „Targeted Release“, „Allgemein verfügbar“, „Vorschau“,
  „Abschaltung“, bei Regionen in Klammern dahinter, z. B. „Allgemein verfügbar (GCC)“. Ohne
  erkennbaren Zeitplan eine leere Liste.
- affected: wer die Änderung bemerkt, kurz auf Deutsch (höchstens 80 Zeichen), z. B. „Alle Nutzer
  mit Teams-Lizenz“ oder „Admins“.
- default_state: „an“, wenn die Funktion nach dem Rollout ohne Zutun eingeschaltet ist; „aus“, wenn
  sie erst eingeschaltet werden muss; „entfaellt“ bei Abkündigungen und reinen Änderungen ohne
  Schalter.
- controllable: ob Admins die Funktion abschalten oder einschränken können; controllable_how kurz
  auf Deutsch womit (höchstens 120 Zeichen), sonst null.
- Was der Text nicht hergibt, ist null. Nichts erfinden."""


class AiPhase(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    start: str = Field(pattern=MONTH)
    end: str = Field(pattern=MONTH)


class AiAnswer(BaseModel):
    phases: list[AiPhase] = Field(default_factory=list, max_length=6)
    affected: str | None = Field(default=None, max_length=200)
    default_state: Literal["an", "aus", "entfaellt"] | None = None
    controllable: bool | None = None
    controllable_how: str | None = Field(default=None, max_length=300)


def evergreen_ai_enabled(db: Session) -> bool:
    """Schalter „Vorschläge für Evergreen“ an und Anbieter eingetragen."""
    stored = stored_ai(db)
    return (
        stored.get(EVERGREEN_FLAG) is True
        and bool(stored.get("base_url"))
        and bool(stored.get("model"))
    )


def load_evergreen_ai(db: Session, settings: Settings) -> AiConfig | None:
    """Anbieter für Evergreen; None, wenn der Schalter aus ist. AiError bei kaputtem Schlüssel."""
    if not evergreen_ai_enabled(db):
        return None
    return load_ai_config(db, settings, require_enabled=False)


def build_prompt(entry: EvEntry) -> str | None:
    """Anfrage an den Anbieter, nur mit öffentlichem Text von Microsoft. None ohne Zeitplan-Text."""
    parts = [f"Titel: {entry.title}", f"Dienste: {', '.join(entry.services or []) or '-'}"]
    found = False
    for section in entry.sections or []:
        head = section.get("head")
        text = section.get("text")
        if isinstance(head, str) and isinstance(text, str) and head.casefold() in SECTIONS_FOR_AI:
            parts.append(f"[{head}]\n{text[:SECTION_MAX]}")
            found = True
    if not found:
        # Meldung ohne bekannte Überschriften: der ganze Text, gekürzt
        if not entry.body:
            return None
        parts.append(f"[Text]\n{entry.body[: SECTION_MAX * 2]}")
    return "\n\n".join(parts)


def parse_answer(text: str) -> AiAnswer | None:
    """Liest das JSON aus der Antwort; None, wenn es nicht dem Format entspricht."""
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        data: Any = json.loads(match.group(0))
        answer = AiAnswer.model_validate(data)
    except ValueError, ValidationError:
        return None
    if any(phase.end < phase.start for phase in answer.phases):
        return None
    return answer


FIELD_LABELS = {
    "phases": "Rollout",
    "affected": "Betroffen",
    "default_state": "Standard",
    "controllable": "Steuerbar",
}


def apply_answer(entry: EvEntry, answer: AiAnswer) -> list[str]:
    """Übernimmt Vorschläge in Felder, die noch niemand geprüft hat. Ergebnis: geänderte Felder."""
    suggested = set(entry.suggested or [])
    from_ai = set(entry.ai_suggested or [])
    changed: list[str] = []

    def free(field: str, current: Any) -> bool:
        return field in suggested or current in (None, "", [])

    values: dict[str, Any] = {
        "phases": [
            {"name": phase.name.strip(), "start": phase.start, "end": phase.end}
            for phase in answer.phases
        ],
        "affected": (answer.affected or "").strip() or None,
        "default_state": answer.default_state,
        "controllable": answer.controllable,
    }
    for field, value in values.items():
        if value in (None, []) or not free(field, getattr(entry, field)):
            continue
        setattr(entry, field, value)
        if field == "controllable":
            how = (answer.controllable_how or "").strip() or None
            entry.controllable_how = how if value else None
        suggested.add(field)
        from_ai.add(field)
        changed.append(field)
    entry.suggested = sorted(suggested)
    entry.ai_suggested = sorted(from_ai)
    return changed


def used_last_hour(db: Session) -> int:
    since = now_utc() - timedelta(hours=1)
    return db.scalar(select(func.count()).where(EvEntry.ai_at >= since)) or 0


def suggest(
    db: Session,
    entry: EvEntry,
    config: AiConfig,
    completer: AiCompleter,
    user_id: Any = None,
) -> list[str]:
    """Fragt die KI zu einem Eintrag und übernimmt die Vorschläge. Wirft AiError."""
    now = now_utc()
    entry.ai_pending = False
    entry.ai_at = now
    prompt = build_prompt(entry)
    if prompt is None:
        return []
    answer = parse_answer(completer(config, SYSTEM_PROMPT, prompt))
    if answer is None:
        add_note(db, entry, NoteKind.AI, "Die Antwort der KI war nicht brauchbar.", user_id, now)
        return []
    changed = apply_answer(entry, answer)
    labels = [FIELD_LABELS[field] for field in changed]
    text = (
        f"KI-Vorschlag für: {', '.join(labels)}."
        if labels
        else "Die KI hatte keine neuen Vorschläge."
    )
    add_note(db, entry, NoteKind.AI, text, user_id, now)
    write_audit(
        db,
        module=MODULE,
        action="eintrag.ki_vorschlag",
        user_id=user_id,
        object_type=OBJECT_TYPE,
        object_id=entry.number,
        details={"felder": labels, "modell": config.model},
    )
    return changed


def generate_suggestions(db: Session, config: AiConfig, completer: AiCompleter) -> int:
    """Fragt die KI für wartende offene Meldungen, bis zur Höchstzahl je Stunde."""
    budget = config.texts_per_hour - used_last_hour(db)
    if budget <= 0:
        return 0
    entries = db.scalars(
        select(EvEntry)
        .where(
            EvEntry.ai_pending,
            EvEntry.source == EntrySource.MESSAGE_CENTER,
            EvEntry.status != EntryStatus.DONE,
        )
        .order_by(EvEntry.created_at.desc(), EvEntry.id.desc())
        .limit(budget)
    ).all()
    done = 0
    for entry in entries:
        try:
            suggest(db, entry, config, completer)
        except AiError as error:
            db.rollback()
            write_audit(
                db,
                module=MODULE,
                action="ki.vorschlaege",
                result="fehler",
                details={"erzeugt": done, "modell": config.model},
                note=str(error),
            )
            db.commit()
            break
        # Jeder Eintrag einzeln: Ein späterer Fehler verwirft die schon bezahlten Antworten nicht.
        db.commit()
        done += 1
    return done


def generate_suggestions_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    """Stündlicher Auftrag. Tut nichts, solange „Vorschläge für Evergreen“ aus ist."""
    try:
        config = load_evergreen_ai(db, settings)
    except AiError as error:
        logger.warning("KI-Vorschläge Evergreen: %s", error)
        return
    if config is None:
        return
    generate_suggestions(db, config, complete)
