"""Tabellen des Moduls Evergreen (spec.md, Kapitel 9)."""

import uuid
from datetime import date, datetime
from enum import StrEnum

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
