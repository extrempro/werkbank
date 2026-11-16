"""Tabellen der IT-Tools: Favoriten, zuletzt genutzte Tools und Verlauf je Konto."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from werkbank.db import Base


class ToolPrefs(Base):
    """Favoriten, zuletzt genutzte Tools und ob der Verlauf gespeichert wird (je Person)."""

    __tablename__ = "tool_prefs"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # Kennungen der Tools, z. B. ["cidr", "uuid"]
    favorites: Mapped[list[str]] = mapped_column(JSONB, default=list)
    recent: Mapped[list[str]] = mapped_column(JSONB, default=list)
    history_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ToolHistory(Base):
    """Einstellungen eines Tools, wie sie in der Adresszeile stehen (nie Geheimnisse oder Texte)."""

    __tablename__ = "tool_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    tool: Mapped[str] = mapped_column(String(60))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    summary: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
