"""API des Bereichs Evergreen: Einträge je Software, Notizen, Abschluss (spec.md 8).

Lesen dürfen Leser und Bearbeiter; Notizen, Abschließen, Wiederöffnen und Anlegen nur
Bearbeiter. Status: neu → bearbeitet (mit der ersten Notiz) → abgeschlossen.
"""

import json
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.orm import Session

from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, require_roles
from werkbank.core.models import User
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.evergreen.models import (
    EntrySource,
    EntryStatus,
    EvEntry,
    EvNote,
    NoteKind,
)
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
from werkbank.modules.m365_config.models import CfgChange, CfgSetting

router = APIRouter(prefix="/api/evergreen")

Reader = Annotated[CurrentUser, Depends(require_roles(*READER_ROLES))]
Editor = Annotated[CurrentUser, Depends(require_roles(*EDITOR_ROLES))]
EntryId = Annotated[int, Path(ge=1)]
SoftwareKey = Literal["m365"]

PAGE_SIZE = 50
PAGE_MAX = 200
NOTE_MAX_LENGTH = 4000
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


class EntryListOut(BaseModel):
    entries: list[EntrySummaryOut]
    total: int
    open: int
    new: int
    can_edit: bool


class NoteOut(BaseModel):
    id: int
    kind: str
    text: str | None
    author: str | None
    created_at: datetime


class EntryOut(EntrySummaryOut):
    category: str | None
    published_at: datetime | None
    modified_at: datetime | None
    body: str | None
    closed_at: datetime | None
    notes: list[NoteOut]
    can_edit: bool


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
    }


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
        notes=[
            NoteOut(
                id=note.id,
                kind=note.kind,
                text=note.text,
                author=names.get(note.user_id) if note.user_id else None,
                created_at=note.created_at,
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


@router.get("/entries")
def list_entries(
    user: Reader,
    db: DbDep,
    software: Annotated[SoftwareKey, Query()] = "m365",
    state: Annotated[
        Literal["offen", "neu", "bearbeitet", "abgeschlossen", "alle"], Query()
    ] = "offen",
    q: Annotated[str, Query(max_length=100)] = "",
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=PAGE_MAX)] = PAGE_SIZE,
) -> EntryListOut:
    """Einträge einer Software seitenweise, neueste zuerst; ``q`` sucht in Nummer, Titel,
    Kennung der Meldung (z. B. MC123456), Diensten und Text."""
    query = select(EvEntry).where(EvEntry.software == software)
    if state == "offen":
        query = query.where(EvEntry.status.in_(OPEN_STATES))
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
        query.order_by(EvEntry.created_at.desc(), EvEntry.id.desc()).offset(offset).limit(limit)
    ).all()
    counts = dict(
        db.execute(
            select(EvEntry.status, func.count())
            .where(EvEntry.software == software)
            .group_by(EvEntry.status)
        )
        .tuples()
        .all()
    )
    editors = _last_editors(db, [row.id for row in rows])
    new = int(counts.get(EntryStatus.NEW, 0))
    return EntryListOut(
        entries=[EntrySummaryOut(**_summary(row, editors)) for row in rows],
        total=total,
        open=new + int(counts.get(EntryStatus.WORKED, 0)),
        new=new,
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
