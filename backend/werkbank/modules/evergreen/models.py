"""Tabellen des Bereichs Evergreen (spec.md, Kapitel 8).

Ein Eintrag ist eine Neuerung einer Software (zunächst Microsoft 365), die die IT sichtet:
Status neu → bearbeitet (Notizen) → abgeschlossen. Notizen und Statuswechsel stehen im Verlauf.
"""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from werkbank.db import Base


class EntrySource(StrEnum):
    MESSAGE_CENTER = "nachrichtencenter"
    MANUAL = "manuell"
    CHANGE = "aenderung"


class EntryStatus(StrEnum):
    NEW = "neu"
    WORKED = "bearbeitet"
    DONE = "abgeschlossen"


class NoteKind(StrEnum):
    NOTE = "notiz"
    CLOSED = "abgeschlossen"
    REOPENED = "geoeffnet"
    UPDATED = "aktualisiert"


# Unterabschnitte (Software); weitere kommen später dazu
SOFTWARE: dict[str, str] = {"m365": "Microsoft 365"}


class EvEntry(Base):
    """Eintrag: eine Meldung oder Neuerung, die die IT sichtet und abschließt."""

    __tablename__ = "ev_entries"
    __table_args__ = (
        UniqueConstraint("year", "sequence"),
        UniqueConstraint("source", "source_ref"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Nummer EV-JJJJ-NNN aus Jahr und laufender Nummer
    year: Mapped[int] = mapped_column(Integer)
    sequence: Mapped[int] = mapped_column(Integer)
    software: Mapped[str] = mapped_column(String(32), index=True)
    title: Mapped[str] = mapped_column(String(500))
    source: Mapped[str] = mapped_column(String(32))
    # Kennung in der Quelle (z. B. MC123456 oder aenderung:17); verhindert doppelte Einträge
    source_ref: Mapped[str | None] = mapped_column(String(128))
    services: Mapped[list[str]] = mapped_column(JSONB, default=list)
    category: Mapped[str | None] = mapped_column(String(32))
    major_change: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    action_required_by: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # zuletzt von Microsoft geändert (nur Nachrichtencenter)
    modified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    body: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default=EntryStatus.NEW, index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def number(self) -> str:
        return f"EV-{self.year}-{self.sequence:03d}"


class EvNote(Base):
    """Verlauf eines Eintrags: Notiz, Abschluss, Wiederöffnen, Aktualisierung durch Microsoft."""

    __tablename__ = "ev_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    entry_id: Mapped[int] = mapped_column(
        ForeignKey("ev_entries.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(16))
    text: Mapped[str | None] = mapped_column(Text)
    # leer bei Einträgen des Systems (z. B. Meldung von Microsoft aktualisiert)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
