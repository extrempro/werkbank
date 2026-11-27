"""Tabellen der Rückmeldungen (Fehler und Ideen)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, LargeBinary, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from werkbank.db import Base


class FeedbackEntry(Base):
    """Eine Rückmeldung. Lesen und bearbeiten dürfen nur Werkbank-Admins und die Person selbst
    (ihre eigenen, ohne technische Angaben und Bildschirmfoto)."""

    __tablename__ = "feedback_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    # Name zum Zeitpunkt der Meldung (bleibt lesbar, wenn das Konto gelöscht wird)
    user_name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    # fehler oder idee
    kind: Mapped[str] = mapped_column(String(10))
    text: Mapped[str] = mapped_column(Text)
    # Pfad der Seite, z. B. /bestand/ausgaben/3
    page: Mapped[str] = mapped_column(String(500), default="", server_default="")
    # neu, in_arbeit, erledigt, abgelehnt
    status: Mapped[str] = mapped_column(String(12), default="neu", server_default="neu", index=True)
    # Version, Fenster, Browser, Fehlermeldungen des Browsers (nur bei Fehlern)
    technical: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    screenshot: Mapped[bytes | None] = mapped_column(LargeBinary)
    screenshot_type: Mapped[str] = mapped_column(String(20), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    status_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FeedbackReply(Base):
    """Antwort der IT auf eine Rückmeldung."""

    __tablename__ = "feedback_replies"

    id: Mapped[int] = mapped_column(primary_key=True)
    entry_id: Mapped[int] = mapped_column(
        ForeignKey("feedback_entries.id", ondelete="CASCADE"), index=True
    )
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    author_name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
