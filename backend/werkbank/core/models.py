"""Tabellen des Kerns (siehe docs/spec.md, Kapitel 9)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from werkbank.db import Base


class User(Base):
    """Person, die sich über Entra ID angemeldet hat."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    entra_oid: Mapped[str] = mapped_column(String(64), unique=True)
    display_name: Mapped[str] = mapped_column(String(256))
    email: Mapped[str | None] = mapped_column(String(320))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Rollen bei der letzten Anmeldung (nur zur Anzeige; maßgeblich ist Entra)
    last_roles: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )


class AuditLog(Base):
    """Unveränderliches Protokoll. UPDATE und DELETE verhindert ein Datenbank-Trigger."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    module: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(128))
    object_type: Mapped[str | None] = mapped_column(String(64))
    object_id: Mapped[str | None] = mapped_column(String(128))
    result: Mapped[str] = mapped_column(String(32), default="ok")
    ip_truncated: Mapped[str | None] = mapped_column(String(64))
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    note: Mapped[str | None] = mapped_column(Text)


class UserSession(Base):
    """Serverseitige Sitzung. Im Browser liegt nur ein zufälliges Token, hier sein Hash."""

    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    roles: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    authenticated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class AuthFlow(Base):
    """Laufende Anmeldung (state, nonce, PKCE) zwischen Weiterleitung und Rückkehr von Entra."""

    __tablename__ = "auth_flows"

    id_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    flow: Mapped[dict[str, Any]] = mapped_column(JSONB)
    return_to: Mapped[str] = mapped_column(String(512), default="/")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
