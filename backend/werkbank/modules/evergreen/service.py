"""Einträge anlegen und Verlauf schreiben (spec.md 8)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from werkbank.core.roles import Role
from werkbank.core.sessions import now_utc
from werkbank.modules.evergreen.models import EntryStatus, EvEntry, EvNote

MODULE = "evergreen"
OBJECT_TYPE = "eintrag"
# Sperre für die Vergabe der laufenden Nummer (beliebige, feste Zahl)
NUMBER_LOCK = 3_650_001

READER_ROLES = (Role.EVERGREEN_READER, Role.EVERGREEN_EDITOR)
EDITOR_ROLES = (Role.EVERGREEN_EDITOR,)
OPEN_STATES = (EntryStatus.NEW, EntryStatus.WORKED)


def create_entry(
    db: Session,
    *,
    software: str,
    title: str,
    source: str,
    source_ref: str | None = None,
    body: str | None = None,
    services: list[str] | None = None,
    created_by: uuid.UUID | None = None,
    **extra: Any,
) -> EvEntry:
    """Legt einen Eintrag mit Nummer an (Status „neu“). Der Aufrufer entscheidet über das Commit."""
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": NUMBER_LOCK})
    now = now_utc()
    last = db.scalar(select(func.max(EvEntry.sequence)).where(EvEntry.year == now.year)) or 0
    entry = EvEntry(
        year=now.year,
        sequence=last + 1,
        software=software,
        title=title,
        source=source,
        source_ref=source_ref,
        body=body,
        services=services or [],
        status=EntryStatus.NEW,
        created_by=created_by,
        created_at=now,
        updated_at=now,
        **extra,
    )
    db.add(entry)
    db.flush()
    return entry


def add_note(
    db: Session,
    entry: EvEntry,
    kind: str,
    note: str | None,
    user_id: uuid.UUID | None,
    now: datetime | None = None,
) -> EvNote:
    moment = now or now_utc()
    row = EvNote(entry_id=entry.id, kind=kind, text=note, user_id=user_id, created_at=moment)
    db.add(row)
    entry.updated_at = moment
    return row
