"""Tabellen des Bereichs Evergreen (spec.md, Kapitel 8).

Ein Eintrag ist eine Neuerung einer Software (zunächst Microsoft 365), die die IT sichtet:
Status neu → bearbeitet (Notizen) → abgeschlossen. Notizen und Statuswechsel stehen im Verlauf.
"""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

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

# Verknüpfte Einstellung (setting_id): die Tabelle muss in den Metadaten bekannt sein, auch
# wenn nur Evergreen geladen ist (z. B. im Worker beim Abruf des Nachrichtencenters).
from werkbank.modules.m365_config import models as _config_models  # noqa: F401


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
    SCHEDULE = "zeitplan"
    ASSESSED = "bewertet"
    TOPIC = "kategorie"
    AI = "ki"


class DefaultState(StrEnum):
    ON = "an"
    OFF = "aus"
    NONE = "entfaellt"


class Codetermination(StrEnum):
    YES = "ja"
    NO = "nein"
    CHECK = "pruefen"


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
    # Kategorie von Hand (sonst aus den Diensten, siehe topics.py)
    topic: Mapped[str | None] = mapped_column(String(20))
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

    # Seit 0.83: Kennzeichen und Abschnitte der Meldung, Steckbrief und Bewertung (spec.md 8.4)
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    # [{"head": str | None, "text": str}]
    sections: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    schedule_previous: Mapped[str | None] = mapped_column(Text)
    schedule_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    affected: Mapped[str | None] = mapped_column(String(200))
    default_state: Mapped[str | None] = mapped_column(String(16))
    controllable: Mapped[bool | None] = mapped_column(Boolean)
    controllable_how: Mapped[str | None] = mapped_column(String(300))
    # [{"name": str, "start": "JJJJ-MM", "end": "JJJJ-MM"}]
    phases: Mapped[list[dict[str, str]]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    phases_previous: Mapped[list[dict[str, str]]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    # Felder, deren Wert noch ein Vorschlag aus den Regeln ist („affected“, „phases“)
    suggested: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    summary: Mapped[str | None] = mapped_column(Text)
    staff_change: Mapped[str | None] = mapped_column(Text)
    training: Mapped[str | None] = mapped_column(Text)
    codetermination: Mapped[str | None] = mapped_column(String(16))
    codetermination_reason: Mapped[str | None] = mapped_column(Text)
    setting_id: Mapped[int | None] = mapped_column(
        ForeignKey("cfg_settings.id", ondelete="SET NULL")
    )
    # Seit 0.85: Vorschläge der KI (spec.md 8.4). Felder aus `suggested`, die von der KI kommen
    ai_suggested: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    # Die KI soll (wieder) gefragt werden: neue Meldung oder geänderter Zeitplan
    ai_pending: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # Zeitpunkt der letzten Anfrage an die KI (für die Höchstzahl je Stunde)
    ai_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

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
    # geänderte Felder bei „bewertet“: [{"field", "old", "new"}]
    details: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    # leer bei Einträgen des Systems (z. B. Meldung von Microsoft aktualisiert)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
