"""Tabellen des Kerns (siehe docs/spec.md, Kapitel 9)."""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
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


class AppSetting(Base):
    """Einstellung der Werkbank aus der Verwaltung. Geheime Werte stehen hier nur verschlüsselt."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class BrandingAsset(Base):
    """Bild für das Branding aus der Verwaltung: Logo (hell, dunkel) oder Favicon."""

    __tablename__ = "branding_assets"

    kind: Mapped[str] = mapped_column(String(16), primary_key=True)
    content_type: Mapped[str] = mapped_column(String(32))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    etag: Mapped[str] = mapped_column(String(32))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))


class UserAvatar(Base):
    """Profilbild einer Person aus Entra ID, bei der Anmeldung aktualisiert."""

    __tablename__ = "user_avatars"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    content_type: Mapped[str] = mapped_column(String(32))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    etag: Mapped[str] = mapped_column(String(32))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


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


class JobStatus(StrEnum):
    """Zustand eines Auftrags für den Worker."""

    PLANNED = "geplant"
    RUNNING = "laeuft"
    DONE = "fertig"
    FAILED = "fehler"


class Job(Base):
    """Auftrag für den Worker (Auftragsliste in PostgreSQL, keine zusätzliche Queue)."""

    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(64), index=True)
    status: Mapped[str] = mapped_column(String(16), default=JobStatus.PLANNED, index=True)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    scheduled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    error: Mapped[str | None] = mapped_column(Text)


class WorkflowInstance(Base):
    """Laufender oder beendeter Ablauf zu einem Objekt (spec.md 6.3). step ist der Status."""

    __tablename__ = "workflow_instances"
    __table_args__ = (UniqueConstraint("workflow", "object_type", "object_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    workflow: Mapped[str] = mapped_column(String(64))
    object_type: Mapped[str] = mapped_column(String(64))
    object_id: Mapped[str] = mapped_column(String(128))
    step: Mapped[str] = mapped_column(String(64), index=True)
    finished: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkflowEvent(Base):
    """Unveränderlicher Protokolleintrag einer Aktion. UPDATE und DELETE verhindert ein Trigger."""

    __tablename__ = "workflow_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    instance_id: Mapped[int] = mapped_column(ForeignKey("workflow_instances.id"), index=True)
    step: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64))
    target: Mapped[str] = mapped_column(String(64))
    comment: Mapped[str | None] = mapped_column(Text)
    # None: automatische Aktion des Systems
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    # gesetzt, wenn jemand die Aktion stellvertretend erfasst hat (z. B. "Betriebsrat")
    on_behalf_of: Mapped[str | None] = mapped_column(String(128))
    details: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Notification(Base):
    """Eine Benachrichtigung für eine Person (Glocke). Nur Text, Link und Zeitpunkt."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Art, z. B. „budget.rechnung_pruefen“ (siehe core/notifications.py)
    kind: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(300))
    link: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Zuletzt per Mail, Teams bzw. Push mitgeteilt (gesammelt, ohne fachlichen Inhalt)
    mailed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    teams_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pushed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NotificationMark(Base):
    """Ereignis, das schon gemeldet wurde; dieselbe Sache meldet die Glocke nur einmal."""

    __tablename__ = "notification_marks"

    # Art und Schlüssel des Ereignisses, z. B. „tenant.zugangsdaten:17:dringend“
    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    # Zuletzt von einer Quelle gemeldet; verschwindet das Ereignis, wird die Marke gelöscht
    seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class NotificationKind(Base):
    """Seit wann eine Art beobachtet wird. Beim ersten Mal gilt der Bestand als gemeldet."""

    __tablename__ = "notification_kinds"

    kind: Mapped[str] = mapped_column(String(64), primary_key=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NotificationMute(Base):
    """Art, die eine Person ausgeschaltet hat (Vorgabe: alle an)."""

    __tablename__ = "notification_mutes"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    kind: Mapped[str] = mapped_column(String(64), primary_key=True)


class PushSubscription(Base):
    """Ein Gerät (Browser), das Push-Nachrichten bekommt. Je Person beliebig viele."""

    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # Adresse beim Push-Dienst; nur bekannte Dienste (core/webpush.py)
    endpoint: Mapped[str] = mapped_column(String(1000), unique=True)
    p256dh: Mapped[str] = mapped_column(String(200))
    auth: Mapped[str] = mapped_column(String(100))
    # Kurze Angabe zum Gerät aus dem Browser, z. B. „iPhone“ (zum Wiedererkennen im Konto)
    label: Mapped[str] = mapped_column(String(60), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class NotificationChannel(Base):
    """Art, die eine Person zusätzlich per Mail, Teams oder Push bekommt (Vorgabe: aus)."""

    __tablename__ = "notification_channels"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # „mail“, „teams“ oder „push“
    channel: Mapped[str] = mapped_column(String(16), primary_key=True)
    kind: Mapped[str] = mapped_column(String(64), primary_key=True)
    # Ab hier wird mitgeteilt; ältere Benachrichtigungen nicht
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NavEntry(Base):
    """Angeheftete und zuletzt besuchte Seiten je Person (Navigation).

    Gespeichert werden nur Pfade aus der Navigation; ``kind`` ist „pin“ oder „recent“,
    ``position`` die Reihenfolge (angeheftet) bzw. ``used_at`` der letzte Besuch.
    """

    __tablename__ = "nav_entries"
    __table_args__ = (UniqueConstraint("user_id", "kind", "path", name="uq_nav_entries_entry"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(8))
    path: Mapped[str] = mapped_column(String(120))
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
