"""Datenmodell des Moduls Tickets (spec.md, Kapitel 8e).

Rollen je Bereich liegen hier und nicht in Entra: Gruppen (Objekt-ID) oder einzelne Personen.
Die Mitgliedschaft in Gruppen prüft die Werkbank über Microsoft Graph (siehe access.py).
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
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

# Rollen je Bereich, von stark nach schwach
AREA_ADMIN = "admin"  # Bereichsverwaltung
AREA_EDIT = "edit"  # Bearbeiten
AREA_READ = "read"  # Nur lesen
AREA_ROLES = (AREA_ADMIN, AREA_EDIT, AREA_READ)

ASSIGN_FIRST = "first"
ASSIGN_ROUND_ROBIN = "round_robin"

STATUS_NEW = "new"
STATUS_IN_PROGRESS = "in_progress"
STATUS_WAITING = "waiting"
STATUS_REMINDER = "reminder"
STATUS_SOLVED = "solved"
STATUS_CLOSED = "closed"
STATUS_MERGED = "merged"
STATUSES = (
    STATUS_NEW,
    STATUS_IN_PROGRESS,
    STATUS_WAITING,
    STATUS_REMINDER,
    STATUS_SOLVED,
    STATUS_CLOSED,
    STATUS_MERGED,
)
OPEN_STATUSES = (STATUS_NEW, STATUS_IN_PROGRESS, STATUS_WAITING, STATUS_REMINDER)

PRIORITIES = ("low", "medium", "high")
CHANNELS = ("mail", "manual", "phone")

ENTRY_INBOUND = "inbound"  # Nachricht vom Melder
ENTRY_REPLY = "reply"  # Antwort an den Melder
ENTRY_NOTE = "note"  # interne Notiz
ENTRY_SYSTEM = "system"  # Systemeintrag
ENTRY_KINDS = (ENTRY_INBOUND, ENTRY_REPLY, ENTRY_NOTE, ENTRY_SYSTEM)


class TicketArea(Base):
    """Bereich, z. B. eine Abteilung, mit genau einem Postfach."""

    __tablename__ = "ticket_areas"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    # Postfach des Bereichs (Anbindung folgt in Phase 2)
    mailbox: Mapped[str] = mapped_column(String(320), default="", server_default="")
    assignment: Mapped[str] = mapped_column(
        String(20), default=ASSIGN_FIRST, server_default=ASSIGN_FIRST
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("assignment IN ('first', 'round_robin')", name="ck_ticket_area_assignment"),
    )


class TicketAreaGrant(Base):
    """Rolle in einem Bereich für eine Entra-Gruppe oder eine Person (jeweils Objekt-ID)."""

    __tablename__ = "ticket_area_grants"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("ticket_areas.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(10))
    kind: Mapped[str] = mapped_column(String(10))  # group | person
    oid: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    mail: Mapped[str] = mapped_column(String(320), default="", server_default="")

    __table_args__ = (
        UniqueConstraint("area_id", "role", "kind", "oid", name="uq_ticket_grant"),
        CheckConstraint("role IN ('admin', 'edit', 'read')", name="ck_ticket_grant_role"),
        CheckConstraint("kind IN ('group', 'person')", name="ck_ticket_grant_kind"),
    )


class TicketMembershipCache(Base):
    """Zwischenspeicher: Gruppen (Objekt-IDs), in denen eine Person Mitglied ist."""

    __tablename__ = "ticket_membership_cache"

    oid: Mapped[str] = mapped_column(String(64), primary_key=True)
    group_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class TicketGroupMember(Base):
    """Mitglieder einer Gruppe aus dem regelmäßigen Abgleich (für Zuweisung und Auswahl)."""

    __tablename__ = "ticket_group_members"

    group_oid: Mapped[str] = mapped_column(String(64), primary_key=True)
    oid: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    mail: Mapped[str] = mapped_column(String(320), default="", server_default="")
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Ticket(Base):
    """Ein Anliegen. Die Nummer läuft über alle Bereiche (Anzeige T-1042)."""

    __tablename__ = "tickets"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    number: Mapped[int] = mapped_column(
        BigInteger, Identity(start=1000), unique=True, nullable=False
    )
    area_id: Mapped[int] = mapped_column(ForeignKey("ticket_areas.id"), index=True)
    subject: Mapped[str] = mapped_column(String(250))
    reporter_name: Mapped[str] = mapped_column(String(200), default="", server_default="")
    reporter_mail: Mapped[str] = mapped_column(String(320), default="", server_default="")
    priority: Mapped[str] = mapped_column(String(10), default="medium", server_default="medium")
    status: Mapped[str] = mapped_column(String(20), default=STATUS_NEW, server_default=STATUS_NEW)
    # Zuständige Person (Objekt-ID in Entra) und Name zur Anzeige
    assignee_oid: Mapped[str | None] = mapped_column(String(64), index=True)
    assignee_name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    channel: Mapped[str] = mapped_column(String(10))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    solved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[str] = mapped_column(String(256), default="", server_default="")

    __table_args__ = (
        CheckConstraint(
            "status IN ('new', 'in_progress', 'waiting', 'reminder', 'solved', 'closed', 'merged')",
            name="ck_ticket_status",
        ),
        CheckConstraint("priority IN ('low', 'medium', 'high')", name="ck_ticket_priority"),
        CheckConstraint("channel IN ('mail', 'manual', 'phone')", name="ck_ticket_channel"),
        Index("ix_tickets_area_status", "area_id", "status"),
    )


class TicketParticipant(Base):
    """Beteiligte (Personen in Kopie)."""

    __tablename__ = "ticket_participants"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(200), default="", server_default="")
    mail: Mapped[str] = mapped_column(String(320))

    __table_args__ = (UniqueConstraint("ticket_id", "mail", name="uq_ticket_participant"),)


class TicketEntry(Base):
    """Eintrag im Verlauf. Texte sind reiner Text (nie HTML)."""

    __tablename__ = "ticket_entries"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tickets.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(10))
    body: Mapped[str] = mapped_column(Text, default="", server_default="")
    author_oid: Mapped[str | None] = mapped_column(String(64))
    author_name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    # Ursprüngliche Meldung (steht im Verlauf immer oben)
    original: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(
            "kind IN ('inbound', 'reply', 'note', 'system')", name="ck_ticket_entry_kind"
        ),
    )


class TicketAudit(Base):
    """Protokoll des Moduls (Einstellungen, Zuständigkeit, Status); 3 Jahre aufbewahrt."""

    __tablename__ = "ticket_audit"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    actor_oid: Mapped[str | None] = mapped_column(String(64))
    actor_name: Mapped[str] = mapped_column(String(256), default="", server_default="")
    area_id: Mapped[int | None] = mapped_column(Integer, index=True)
    action: Mapped[str] = mapped_column(String(60))
    ticket_number: Mapped[int | None] = mapped_column(BigInteger)
    details: Mapped[dict[str, object]] = mapped_column(JSONB, default=dict)
