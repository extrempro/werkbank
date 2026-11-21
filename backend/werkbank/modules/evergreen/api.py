"""API des Bereichs Evergreen: Einträge je Software, Notizen, Bewertung, Abschluss (spec.md 8).

Lesen dürfen Leser und Bearbeiter; Notizen, Bewertung, Abschließen, Wiederöffnen und Anlegen
nur Bearbeiter. Status: neu → bearbeitet (erste Notiz oder Bewertung) → abgeschlossen.
"""

import json
import uuid
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.orm import Session

from werkbank.core.ai import AiCompleterDep, AiError
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep, require_roles
from werkbank.core.models import User
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.evergreen.ai_suggest import (
    evergreen_ai_enabled,
    load_evergreen_ai,
    suggest,
    used_last_hour,
)
from werkbank.modules.evergreen.models import (
    Codetermination,
    DefaultState,
    EntrySource,
    EntryStatus,
    EvEntry,
    EvNote,
    NoteKind,
)
from werkbank.modules.evergreen.rules import info_only, kind_label, split_sections
from werkbank.modules.evergreen.service import (
    EDITOR_ROLES,
    MODULE,
    OBJECT_TYPE,
    OPEN_STATES,
    READER_ROLES,
    add_note,
    create_entry,
)
from werkbank.modules.inventory.search import escape_like
from werkbank.modules.m365_config.models import CfgChange, CfgSetting, CfgSettingVersion

router = APIRouter(prefix="/api/evergreen")

Reader = Annotated[CurrentUser, Depends(require_roles(*READER_ROLES))]
Editor = Annotated[CurrentUser, Depends(require_roles(*EDITOR_ROLES))]
EntryId = Annotated[int, Path(ge=1)]
SoftwareKey = Literal["m365"]

LIST_MAX = 500
NOTE_MAX_LENGTH = 4000
TEXT_MAX_LENGTH = 4000
SETTING_HITS = 20
VALUE_MAX = 120
DETAIL_MAX = 200
MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"
CONFIG_ROLES = (Role.CONFIG_READER, Role.CONFIG_REVIEWER)
BODY_MAX_LENGTH = 20_000


class EntrySummaryOut(BaseModel):
    id: int
    number: str
    software: str
    title: str
    source: str
    source_ref: str | None
    services: list[str]
    major_change: bool
    action_required_by: datetime | None
    status: str
    created_at: datetime
    updated_at: datetime
    # wer zuletzt eine Notiz geschrieben, abgeschlossen oder wieder geöffnet hat
    last_editor: str | None
    kind: str | None
    info_only: bool


class EntryListOut(BaseModel):
    entries: list[EntrySummaryOut]
    total: int
    # Zähler für die Chips (ohne Suche, mit dem Schalter für Info-Meldungen)
    open: int
    new: int
    due: int
    done: int
    can_edit: bool


class NoteChange(BaseModel):
    field: str
    old: str | None
    new: str | None


class NoteOut(BaseModel):
    id: int
    kind: str
    text: str | None
    author: str | None
    created_at: datetime
    changes: list[NoteChange]


class SectionOut(BaseModel):
    head: str | None
    text: str


class Phase(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    start: str = Field(pattern=MONTH_PATTERN)
    end: str = Field(pattern=MONTH_PATTERN)


class LinkedSettingOut(BaseModel):
    id: int
    path: str
    value: str | None
    # nur mit Recht auf die M365-Konfiguration
    can_open: bool


class EntryOut(EntrySummaryOut):
    category: str | None
    published_at: datetime | None
    modified_at: datetime | None
    body: str | None
    closed_at: datetime | None
    tags: list[str]
    sections: list[SectionOut]
    schedule_previous: str | None
    schedule_changed_at: datetime | None
    affected: str | None
    default_state: str | None
    controllable: bool | None
    controllable_how: str | None
    phases: list[Phase]
    phases_previous: list[Phase]
    suggested: list[str]
    # Felder aus `suggested`, deren Vorschlag von der KI kommt
    ai_suggested: list[str]
    # Die KI wird beim nächsten Lauf gefragt
    ai_pending: bool
    # „KI-Vorschlag holen“ ist möglich (Schalter in der Verwaltung an)
    ai_available: bool
    summary: str | None
    staff_change: str | None
    training: str | None
    codetermination: str | None
    codetermination_reason: str | None
    setting: LinkedSettingOut | None
    notes: list[NoteOut]
    can_edit: bool


class AssessmentIn(BaseModel):
    affected: str | None = Field(default=None, max_length=200)
    default_state: DefaultState | None = None
    controllable: bool | None = None
    controllable_how: str | None = Field(default=None, max_length=300)
    phases: list[Phase] = Field(default_factory=list, max_length=6)
    summary: str | None = Field(default=None, max_length=TEXT_MAX_LENGTH)
    staff_change: str | None = Field(default=None, max_length=TEXT_MAX_LENGTH)
    training: str | None = Field(default=None, max_length=TEXT_MAX_LENGTH)
    codetermination: Codetermination | None = None
    codetermination_reason: str | None = Field(default=None, max_length=TEXT_MAX_LENGTH)
    setting_id: int | None = Field(default=None, ge=1)


class SettingHitOut(BaseModel):
    id: int
    path: str
    value: str | None


class SettingSearchOut(BaseModel):
    settings: list[SettingHitOut]
    more: bool


class EntryCreateIn(BaseModel):
    software: SoftwareKey = "m365"
    title: str = Field(min_length=1, max_length=500)
    body: str | None = Field(default=None, max_length=BODY_MAX_LENGTH)
    service: str | None = Field(default=None, max_length=100)


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=NOTE_MAX_LENGTH)


class OptionalNoteIn(BaseModel):
    text: str | None = Field(default=None, max_length=NOTE_MAX_LENGTH)


class FromChangeIn(BaseModel):
    change_id: int = Field(ge=1)


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _names(db: Session, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not ids:
        return {}
    return dict(
        db.execute(select(User.id, User.display_name).where(User.id.in_(ids))).tuples().all()
    )


def _last_editors(db: Session, entry_ids: list[int]) -> dict[int, str]:
    """Je Eintrag der Name der Person, die zuletzt etwas eingetragen hat."""
    if not entry_ids:
        return {}
    newest = (
        select(func.max(EvNote.id))
        .where(EvNote.entry_id.in_(entry_ids), EvNote.user_id.is_not(None))
        .group_by(EvNote.entry_id)
    )
    rows = db.execute(
        select(EvNote.entry_id, User.display_name)
        .join(User, User.id == EvNote.user_id)
        .where(EvNote.id.in_(newest))
    ).all()
    return {entry_id: name for entry_id, name in rows}


def _summary(entry: EvEntry, editors: dict[int, str]) -> dict[str, Any]:
    return {
        "id": entry.id,
        "number": entry.number,
        "software": entry.software,
        "title": entry.title,
        "source": entry.source,
        "source_ref": entry.source_ref,
        "services": list(entry.services or []),
        "major_change": entry.major_change,
        "action_required_by": entry.action_required_by,
        "status": entry.status,
        "created_at": entry.created_at,
        "updated_at": entry.updated_at,
        "last_editor": editors.get(entry.id),
        "kind": kind_label(entry.tags, entry.category),
        "info_only": info_only(entry.tags, entry.category),
    }


def _value_short(value: Any) -> str | None:
    if value is None:
        return None
    text = _value_text(value)
    return text if len(text) <= VALUE_MAX else text[: VALUE_MAX - 1] + "…"


def _current_values(db: Session, setting_ids: list[int]) -> dict[int, Any]:
    if not setting_ids:
        return {}
    rows = db.execute(
        select(CfgSettingVersion.setting_id, CfgSettingVersion.value).where(
            CfgSettingVersion.setting_id.in_(setting_ids), CfgSettingVersion.valid_to.is_(None)
        )
    ).all()
    return {setting_id: value for setting_id, value in rows}


def _linked_setting(db: Session, entry: EvEntry, user: CurrentUser) -> LinkedSettingOut | None:
    if entry.setting_id is None:
        return None
    setting = db.get(CfgSetting, entry.setting_id)
    if setting is None:
        return None
    value = _current_values(db, [setting.id]).get(setting.id)
    return LinkedSettingOut(
        id=setting.id,
        path=setting.path,
        value=_value_short(value),
        can_open=user.has_any_role(*CONFIG_ROLES),
    )


def _note_changes(details: Any) -> list[NoteChange]:
    if not isinstance(details, list):
        return []
    return [
        NoteChange(field=str(item.get("field")), old=item.get("old"), new=item.get("new"))
        for item in details
        if isinstance(item, dict) and item.get("field")
    ]


def _entry_out(db: Session, entry: EvEntry, user: CurrentUser) -> EntryOut:
    notes = db.scalars(select(EvNote).where(EvNote.entry_id == entry.id).order_by(EvNote.id)).all()
    names = _names(db, {note.user_id for note in notes if note.user_id})
    return EntryOut(
        **_summary(entry, _last_editors(db, [entry.id])),
        category=entry.category,
        published_at=entry.published_at,
        modified_at=entry.modified_at,
        body=entry.body,
        closed_at=entry.closed_at,
        tags=list(entry.tags or []),
        # Einträge von Hand und aus erkannten Änderungen: die Beschreibung als ein Abschnitt
        sections=[SectionOut(**item) for item in (entry.sections or split_sections(entry.body))],
        schedule_previous=entry.schedule_previous,
        schedule_changed_at=entry.schedule_changed_at,
        affected=entry.affected,
        default_state=entry.default_state,
        controllable=entry.controllable,
        controllable_how=entry.controllable_how,
        phases=[Phase(**item) for item in entry.phases or []],
        phases_previous=[Phase(**item) for item in entry.phases_previous or []],
        suggested=list(entry.suggested or []),
        ai_suggested=list(entry.ai_suggested or []),
        ai_pending=entry.ai_pending,
        ai_available=evergreen_ai_enabled(db),
        summary=entry.summary,
        staff_change=entry.staff_change,
        training=entry.training,
        codetermination=entry.codetermination,
        codetermination_reason=entry.codetermination_reason,
        setting=_linked_setting(db, entry, user),
        notes=[
            NoteOut(
                id=note.id,
                kind=note.kind,
                text=note.text,
                author=names.get(note.user_id) if note.user_id else None,
                created_at=note.created_at,
                changes=_note_changes(note.details),
            )
            for note in notes
        ],
        can_edit=user.has_any_role(*EDITOR_ROLES),
    )


def _entry(db: Session, entry_id: int) -> EvEntry:
    entry = db.get(EvEntry, entry_id)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    return entry


def _audit(
    db: Session,
    request: Request,
    user: CurrentUser,
    action: str,
    entry: EvEntry,
    details: dict[str, Any] | None = None,
) -> None:
    write_audit(
        db,
        module=MODULE,
        action=action,
        user_id=user.user_id,
        object_type=OBJECT_TYPE,
        object_id=entry.number,
        ip=request.client.host if request.client else None,
        details=details,
    )


def _info_filter(query: Any) -> Any:
    """Blendet reine Info-Meldungen aus (Kategorie „stayInformed“ ohne Auswirkung)."""
    impact = or_(
        EvEntry.tags.contains(["User impact"]),
        EvEntry.tags.contains(["Admin impact"]),
    )
    return query.where(or_(EvEntry.category.is_(None), EvEntry.category != "stayInformed", impact))


@router.get("/entries")
def list_entries(
    user: Reader,
    db: DbDep,
    software: Annotated[SoftwareKey, Query()] = "m365",
    state: Annotated[
        Literal["offen", "neu", "frist", "bearbeitet", "abgeschlossen", "alle"], Query()
    ] = "offen",
    q: Annotated[str, Query(max_length=100)] = "",
    hide_info: Annotated[bool, Query()] = False,
    limit: Annotated[int, Query(ge=1, le=LIST_MAX)] = LIST_MAX,
) -> EntryListOut:
    """Einträge einer Software, neueste zuerst (höchstens 500); ``q`` sucht in Nummer, Titel,
    Kennung der Meldung (z. B. MC123456), Diensten und Text. Die Gruppen bildet die Oberfläche."""
    base = select(EvEntry).where(EvEntry.software == software)
    if hide_info:
        base = _info_filter(base)
    query = base
    if state == "offen":
        query = query.where(EvEntry.status.in_(OPEN_STATES))
    elif state == "frist":
        query = query.where(
            EvEntry.status.in_(OPEN_STATES), EvEntry.action_required_by.is_not(None)
        )
    elif state != "alle":
        query = query.where(EvEntry.status == state)
    term = q.strip().casefold()
    if term:
        pattern = f"%{escape_like(term)}%"
        query = query.where(
            or_(
                func.lower(EvEntry.title).like(pattern, escape="\\"),
                func.lower(EvEntry.source_ref).like(pattern, escape="\\"),
                func.lower(cast(EvEntry.services, Text)).like(pattern, escape="\\"),
                func.lower(EvEntry.body).like(pattern, escape="\\"),
                func.lower(
                    func.concat(
                        "ev-",
                        EvEntry.year,
                        "-",
                        func.lpad(cast(EvEntry.sequence, Text), 3, "0"),
                    )
                ).like(pattern, escape="\\"),
            )
        )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(
        query.order_by(EvEntry.created_at.desc(), EvEntry.id.desc()).limit(limit)
    ).all()
    counted = base.subquery()
    counts: dict[str, int] = dict(
        db.execute(select(counted.c.status, func.count()).group_by(counted.c.status)).tuples().all()
    )
    due = (
        db.scalar(
            select(func.count())
            .select_from(counted)
            .where(counted.c.status.in_(OPEN_STATES), counted.c.action_required_by.is_not(None))
        )
        or 0
    )
    editors = _last_editors(db, [row.id for row in rows])
    new = int(counts.get(EntryStatus.NEW, 0))
    return EntryListOut(
        entries=[EntrySummaryOut(**_summary(row, editors)) for row in rows],
        total=total,
        open=new + int(counts.get(EntryStatus.WORKED, 0)),
        new=new,
        due=int(due),
        done=int(counts.get(EntryStatus.DONE, 0)),
        can_edit=user.has_any_role(*EDITOR_ROLES),
    )


@router.get("/entries/{entry_id}")
def read_entry(entry_id: EntryId, user: Reader, db: DbDep) -> EntryOut:
    return _entry_out(db, _entry(db, entry_id), user)


@router.post("/entries", status_code=status.HTTP_201_CREATED)
def create(request: Request, body: EntryCreateIn, user: Editor, db: DbDep) -> EntryOut:
    """Legt einen Eintrag von Hand an, z. B. für eine Neuerung, die nicht im
    Nachrichtencenter steht."""
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Titel fehlt")
    service = _clean(body.service)
    entry = create_entry(
        db,
        software=body.software,
        title=title,
        source=EntrySource.MANUAL,
        body=_clean(body.body),
        services=[service] if service else [],
        created_by=user.user_id,
    )
    _audit(db, request, user, "eintrag.angelegt", entry, {"quelle": entry.source})
    db.commit()
    return _entry_out(db, entry, user)


@router.post("/entries/{entry_id}/notes")
def note(request: Request, entry_id: EntryId, body: NoteIn, user: Editor, db: DbDep) -> EntryOut:
    """Notiz anfügen. Ein neuer Eintrag wird damit „bearbeitet“."""
    entry = _entry(db, entry_id)
    if entry.status == EntryStatus.DONE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Der Eintrag ist abgeschlossen. Öffne ihn wieder, um eine Notiz anzufügen.",
        )
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=422, detail="Notiz fehlt")
    add_note(db, entry, NoteKind.NOTE, text, user.user_id)
    if entry.status == EntryStatus.NEW:
        entry.status = EntryStatus.WORKED
    _audit(db, request, user, "eintrag.notiz", entry)
    db.commit()
    return _entry_out(db, entry, user)


@router.post("/entries/{entry_id}/close")
def close(
    request: Request, entry_id: EntryId, body: OptionalNoteIn, user: Editor, db: DbDep
) -> EntryOut:
    """Abschließen, auf Wunsch mit einer letzten Notiz."""
    entry = _entry(db, entry_id)
    if entry.status == EntryStatus.DONE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Schon abgeschlossen")
    now = now_utc()
    add_note(db, entry, NoteKind.CLOSED, _clean(body.text), user.user_id, now)
    entry.status = EntryStatus.DONE
    entry.closed_at = now
    _audit(db, request, user, "eintrag.abgeschlossen", entry)
    db.commit()
    return _entry_out(db, entry, user)


@router.post("/entries/{entry_id}/reopen")
def reopen(
    request: Request, entry_id: EntryId, body: OptionalNoteIn, user: Editor, db: DbDep
) -> EntryOut:
    """Wieder öffnen: der Eintrag ist danach „bearbeitet“."""
    entry = _entry(db, entry_id)
    if entry.status != EntryStatus.DONE:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Nicht abgeschlossen")
    add_note(db, entry, NoteKind.REOPENED, _clean(body.text), user.user_id)
    entry.status = EntryStatus.WORKED
    entry.closed_at = None
    _audit(db, request, user, "eintrag.wieder_geoeffnet", entry)
    db.commit()
    return _entry_out(db, entry, user)


FIELD_LABELS = {
    "affected": "Betroffen",
    "default_state": "Standard",
    "controllable": "Steuerbar",
    "controllable_how": "Steuerbar mit",
    "phases": "Rollout",
    "summary": "Kurzfassung",
    "staff_change": "Änderung für Mitarbeitende",
    "training": "Schulung / Kommunikation",
    "codetermination": "Mitbestimmungsrelevant",
    "codetermination_reason": "Begründung",
    "setting_id": "Verknüpfte Einstellung",
}
STATE_LABELS = {"an": "eingeschaltet", "aus": "ausgeschaltet", "entfaellt": "entfällt"}
CODETERMINATION_LABELS = {"ja": "Ja", "nein": "Nein", "pruefen": "Noch prüfen"}


def _empty(value: Any) -> Any:
    """Leere Werte („“, [], None) gelten als gleich; False bleibt ein Wert."""
    return None if value is None or value == "" or value == [] else value


def _phases_text(phases: list[dict[str, str]]) -> str | None:
    if not phases:
        return None
    return "; ".join(f"{p['name']} {p['start']} bis {p['end']}" for p in phases)


def _show(db: Session, field: str, value: Any) -> str | None:
    """Wert eines Felds als kurzer Text für den Verlauf."""
    if _empty(value) is None:
        return None
    if field == "phases":
        text = _phases_text(value)
    elif field == "controllable":
        text = "Ja" if value else "Nein"
    elif field == "default_state":
        text = STATE_LABELS.get(value, value)
    elif field == "codetermination":
        text = CODETERMINATION_LABELS.get(value, value)
    elif field == "setting_id":
        setting = db.get(CfgSetting, value)
        text = setting.path if setting else str(value)
    else:
        text = str(value)
    if text is None:
        return None
    return text if len(text) <= DETAIL_MAX else text[: DETAIL_MAX - 1] + "…"


@router.put("/entries/{entry_id}/assessment")
def assess(
    request: Request, entry_id: EntryId, body: AssessmentIn, user: Editor, db: DbDep
) -> EntryOut:
    """Steckbrief, Rollout-Phasen und Bewertung speichern. Vorschläge gelten danach als
    geprüft; ein neuer Eintrag wird „bearbeitet“. Geht auch an abgeschlossenen Einträgen."""
    entry = _entry(db, entry_id)
    if body.setting_id is not None and db.get(CfgSetting, body.setting_id) is None:
        raise HTTPException(status_code=422, detail="Einstellung nicht gefunden")
    for phase in body.phases:
        if phase.end < phase.start:
            raise HTTPException(
                status_code=422, detail=f"Rollout „{phase.name}“: Ende liegt vor dem Beginn"
            )
    values: dict[str, Any] = {
        "affected": _clean(body.affected),
        "default_state": body.default_state.value if body.default_state else None,
        "controllable": body.controllable,
        "controllable_how": _clean(body.controllable_how) if body.controllable else None,
        "phases": [{"name": p.name.strip(), "start": p.start, "end": p.end} for p in body.phases],
        "summary": _clean(body.summary),
        "staff_change": _clean(body.staff_change),
        "training": _clean(body.training),
        "codetermination": body.codetermination.value if body.codetermination else None,
        "codetermination_reason": _clean(body.codetermination_reason),
        "setting_id": body.setting_id,
    }
    changes = []
    for field, value in values.items():
        old = getattr(entry, field)
        if _empty(old) != _empty(value):
            changes.append(
                {
                    "field": FIELD_LABELS[field],
                    "old": _show(db, field, old),
                    "new": _show(db, field, value),
                }
            )
            setattr(entry, field, value)
    confirmed = bool(entry.suggested)
    if not changes and not confirmed:
        return _entry_out(db, entry, user)
    entry.suggested = []
    entry.ai_suggested = []
    text = "Vorschläge bestätigt." if not changes else None
    note = add_note(db, entry, NoteKind.ASSESSED, text, user.user_id)
    note.details = changes or None
    if entry.status == EntryStatus.NEW:
        entry.status = EntryStatus.WORKED
    _audit(
        db,
        request,
        user,
        "eintrag.bewertet",
        entry,
        {"felder": [change["field"] for change in changes]},
    )
    db.commit()
    return _entry_out(db, entry, user)


AI_REPEAT_MINUTES = 10


@router.post("/entries/{entry_id}/ai-suggestion")
def ai_suggestion(
    entry_id: EntryId,
    user: Editor,
    db: DbDep,
    settings: SettingsDep,
    completer: AiCompleterDep,
) -> EntryOut:
    """Fragt die KI sofort nach Rollout-Phasen und Steckbrief (spec.md 8.4)."""
    entry = _entry(db, entry_id)
    if entry.source != EntrySource.MESSAGE_CENTER:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Vorschläge der KI gibt es nur für Meldungen aus dem Nachrichtencenter.",
        )
    try:
        config = load_evergreen_ai(db, settings)
    except AiError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    if config is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Die KI-Vorschläge für Evergreen sind in der Verwaltung ausgeschaltet.",
        )
    now = now_utc()
    if entry.ai_at and entry.ai_at > now - timedelta(minutes=AI_REPEAT_MINUTES):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Die KI wurde zu diesem Eintrag gerade erst gefragt. "
            f"Versuch es in {AI_REPEAT_MINUTES} Minuten noch einmal.",
        )
    if used_last_hour(db) >= config.texts_per_hour:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Die Höchstzahl an KI-Anfragen je Stunde ist erreicht. Versuch es später.",
        )
    try:
        suggest(db, entry, config, completer, user.user_id)
    except AiError as error:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(error)) from error
    db.commit()
    return _entry_out(db, entry, user)


@router.get("/settings")
def search_settings(
    user: Editor,
    db: DbDep,
    q: Annotated[str, Query(max_length=100)] = "",
) -> SettingSearchOut:
    """Einstellungen der M365-Konfiguration zum Verknüpfen suchen (Pfad), höchstens 20;
    ohne Suchbegriff die ersten 20 nach Pfad."""
    pattern = f"%{escape_like(q.strip().casefold())}%"
    rows = db.scalars(
        select(CfgSetting)
        .where(func.lower(CfgSetting.path).like(pattern, escape="\\"), CfgSetting.active)
        .order_by(CfgSetting.path)
        .limit(SETTING_HITS + 1)
    ).all()
    hits = rows[:SETTING_HITS]
    values = _current_values(db, [row.id for row in hits])
    return SettingSearchOut(
        settings=[
            SettingHitOut(id=row.id, path=row.path, value=_value_short(values.get(row.id)))
            for row in hits
        ],
        more=len(rows) > SETTING_HITS,
    )


CHANGE_KIND_LABELS = {"neu": "neue Einstellung", "geaendert": "geändert", "entfernt": "entfernt"}


def _value_text(value: Any) -> str:
    if value is None:
        return "-"
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


@router.post("/entries/from-change", status_code=status.HTTP_201_CREATED)
def create_from_change(request: Request, body: FromChangeIn, user: Editor, db: DbDep) -> EntryOut:
    """Legt aus einer erkannten Änderung in M365-Konfiguration einen Eintrag an."""
    row = db.execute(
        select(CfgChange, CfgSetting)
        .join(CfgSetting, CfgSetting.id == CfgChange.setting_id)
        .where(CfgChange.id == body.change_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    change, setting = row[0], row[1]
    source_ref = f"aenderung:{change.id}"
    existing = db.execute(
        select(EvEntry).where(
            EvEntry.source == EntrySource.CHANGE, EvEntry.source_ref == source_ref
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Zu dieser Änderung gibt es schon den Eintrag {existing.number}",
        )
    kind = CHANGE_KIND_LABELS.get(change.kind, change.kind)
    name = setting.object_name or setting.object_id
    text = "\n".join(
        [
            f"Erkannte Änderung im Tenant ({kind}).",
            f"Einstellung: {setting.path}",
            f"Vorher: {_value_text(change.old_value)}",
            f"Nachher: {_value_text(change.new_value)}",
            f"Geändert von: {change.changed_by or 'unbekannt'}",
        ]
    )
    entry = create_entry(
        db,
        software="m365",
        title=f"{name}: {setting.property} ({kind})"[:500],
        source=EntrySource.CHANGE,
        source_ref=source_ref,
        body=text[:BODY_MAX_LENGTH],
        services=[setting.workload[:100]],
        created_by=user.user_id,
    )
    _audit(
        db,
        request,
        user,
        "eintrag.angelegt",
        entry,
        {"quelle": entry.source, "aenderung": change.id},
    )
    db.commit()
    return _entry_out(db, entry, user)
