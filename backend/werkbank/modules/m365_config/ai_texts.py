"""KI-Texte für Einstellungen: verständliche Beschreibung je Art von Einstellung (spec.md 6.9).

An den Anbieter gehen nur Dienst, Bereich und Name der Eigenschaft. Werte, Namen von Objekten
und alles andere aus dem Tenant bleiben in der Werkbank. Ein Text gilt deshalb für alle
Einstellungen derselben Art und bleibt „ungeprüft“, bis ihn jemand mit der Rolle Reviewer freigibt.
"""

import logging
from typing import Any

from sqlalchemy import and_, exists, or_, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.ai import AiCompleter, AiConfig, AiError, complete, load_ai_config
from werkbank.core.audit import write_audit
from werkbank.core.sessions import now_utc
from werkbank.modules.m365_config.models import (
    AiTextState,
    CfgAiText,
    CfgSetting,
    CfgSettingMeta,
)

logger = logging.getLogger(__name__)

GENERATE_AI_TEXTS = "m365_config.ki_texte"
MODULE = "m365_config"
UNKNOWN_MARK = "UNBEKANNT"

SYSTEM_PROMPT = (
    "Du erklärst Einstellungen von Microsoft 365 für IT-Fachleute in verständlichem Deutsch. "
    "Antworte mit zwei bis drei Sätzen: was die Einstellung steuert und worauf man achten sollte. "
    "Keine Anrede, keine Aufzählung, kein Markdown, keine Rückfragen. "
    f"Wenn du die Einstellung nicht sicher kennst, antworte nur mit dem Wort {UNKNOWN_MARK}."
)

# Verknüpfung einer Einstellung mit dem Text ihrer Art
AI_TEXT_JOIN = and_(
    CfgAiText.workload == CfgSetting.workload,
    CfgAiText.area == CfgSetting.area,
    CfgAiText.property == CfgSetting.property,
)


def build_prompt(workload: str, area: str, prop: str) -> str:
    """Anfrage an den Anbieter. Enthält bewusst nur diese drei technischen Angaben."""
    return f"Dienst: {workload}\nBereich: {area}\nEigenschaft: {prop}"


def pending_kinds(db: Session, limit: int) -> list[tuple[str, str, str]]:
    """Arten von Einstellungen ohne eigene Beschreibung, für die es noch keinen Text gibt."""
    no_description = or_(CfgSettingMeta.description.is_(None), CfgSettingMeta.description == "")
    rows = db.execute(
        select(CfgSetting.workload, CfgSetting.area, CfgSetting.property)
        .outerjoin(CfgSettingMeta, CfgSettingMeta.setting_id == CfgSetting.id)
        .where(CfgSetting.active, no_description, ~exists().where(AI_TEXT_JOIN))
        .distinct()
        .order_by(CfgSetting.workload, CfgSetting.area, CfgSetting.property)
        .limit(limit)
    ).all()
    return [(str(row[0]), str(row[1]), str(row[2])) for row in rows]


def generate_ai_texts(db: Session, config: AiConfig, completer: AiCompleter) -> int:
    """Erzeugt Texte bis zur Höchstzahl je Lauf. Bei einem Fehler des Anbieters endet der Lauf."""
    created = 0
    failure: str | None = None
    for workload, area, prop in pending_kinds(db, config.texts_per_hour):
        try:
            answer = completer(config, SYSTEM_PROMPT, build_prompt(workload, area, prop))
        except AiError as error:
            failure = str(error)
            break
        unknown = answer.strip().strip(".").upper() == UNKNOWN_MARK
        db.add(
            CfgAiText(
                workload=workload,
                area=area,
                property=prop,
                text=None if unknown else answer,
                state=AiTextState.UNKNOWN if unknown else AiTextState.UNREVIEWED,
                model=config.model[:100],
                generated_at=now_utc(),
            )
        )
        # Jeder Text einzeln: Ein späterer Fehler verwirft die schon bezahlten Antworten nicht.
        db.commit()
        created += 1
    if created or failure:
        write_audit(
            db,
            module=MODULE,
            action="ki.texte_erzeugt",
            object_type="ki_text",
            result="fehler" if failure else "ok",
            details={"erzeugt": created, "modell": config.model},
            note=failure,
        )
        db.commit()
    return created


def generate_ai_texts_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    """Stündlicher Auftrag. Tut nichts, solange die KI-Texte in der Verwaltung aus sind."""
    try:
        config = load_ai_config(db, settings)
    except AiError as error:
        logger.warning("KI-Texte: %s", error)
        return
    if config is None:
        return
    generate_ai_texts(db, config, complete)
