"""Tabellen des Moduls Evergreen (spec.md, Kapitel 9)."""

import uuid
from datetime import date, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    Boolean,
    Date,
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


class ItemSource(StrEnum):
    MANUAL = "manuell"
    MESSAGE_CENTER = "nachrichtencenter"
    SETTING = "einstellung"


class EvItem(Base):
    """Evergreen-Vorgang: eine Neuerung, die bewertet und freigegeben wird."""

    __tablename__ = "ev_items"
    __table_args__ = (
        UniqueConstraint("year", "sequence"),
        UniqueConstraint("source", "source_ref"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Nummer EV-JJJJ-NNN aus Jahr und laufender Nummer
    year: Mapped[int] = mapped_column(Integer)
    sequence: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(300))
    service: Mapped[str | None] = mapped_column(String(100))
    source: Mapped[str] = mapped_column(String(32), default=ItemSource.MANUAL)
    # Kennung in der Quelle (z. B. Nachrichten-ID); verhindert doppelte Vorgänge
    source_ref: Mapped[str | None] = mapped_column(String(128))
    major_change: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    rollout_date: Mapped[date | None] = mapped_column(Date)
    summary: Mapped[str | None] = mapped_column(Text)
    departments_feedback: Mapped[str | None] = mapped_column(Text)
    not_controllable: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
    workflow_instance_id: Mapped[int] = mapped_column(
        ForeignKey("workflow_instances.id"), unique=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    @property
    def number(self) -> str:
        return f"EV-{self.year}-{self.sequence:03d}"


class MessageStatus(StrEnum):
    NEW = "neu"
    ADOPTED = "uebernommen"
    IGNORED = "ignoriert"


class EvMessage(Base):
    """Meldung aus dem Nachrichtencenter von Microsoft (Eingang für Vorgänge)."""

    __tablename__ = "ev_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Kennung bei Microsoft, z. B. MC123456
    message_id: Mapped[str] = mapped_column(String(64), unique=True)
    title: Mapped[str] = mapped_column(String(500))
    services: Mapped[list[str]] = mapped_column(JSONB, default=list)
    category: Mapped[str | None] = mapped_column(String(32))
    major_change: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    action_required_by: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    modified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Text der Meldung ohne HTML
    body: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default=MessageStatus.NEW, index=True)
    item_id: Mapped[int | None] = mapped_column(ForeignKey("ev_items.id"), index=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class EvPlan(Base):
    """Geplante Umsetzung eines Vorgangs: ein Soll-Wert, den die IT im Tenant setzt."""

    __tablename__ = "ev_plan"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("ev_items.id"), index=True)
    # Einstellung aus M365-Konfiguration, wenn die Werkbank sie überwacht; sonst None
    setting_id: Mapped[int | None] = mapped_column(
        ForeignKey("cfg_settings.id", ondelete="SET NULL"), index=True
    )
    label: Mapped[str] = mapped_column(String(300))
    target_value: Mapped[Any] = mapped_column(JSONB)
    # wo bzw. mit welchem Befehl die IT den Wert setzt
    instruction: Mapped[str | None] = mapped_column(Text)
    # vorläufige Sperre bis zum Beschluss (spec.md 8.4)
    provisional: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # nur ohne überwachte Einstellung: von der IT als umgesetzt bestätigt
    confirmed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
