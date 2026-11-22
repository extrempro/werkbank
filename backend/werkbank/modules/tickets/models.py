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
from werkbank.modules.tickets.mail_texts import DEFAULT_EVENTS, DEFAULT_TYPES

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
    # Mails an den Melder (Phase 2)
    sender_name: Mapped[str] = mapped_column(String(120), default="", server_default="")
    header_title: Mapped[str] = mapped_column(String(120), default="", server_default="")
    signature: Mapped[str] = mapped_column(Text, default="", server_default="")
    ack_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    ack_text: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Automatische Mails: in_progress, assignee, waiting, solved, closed (siehe mail_texts.py)
    mail_events: Mapped[dict[str, bool]] = mapped_column(
        JSONB, default=lambda: dict(DEFAULT_EVENTS), server_default=text("'{}'::jsonb")
    )
    # E-Mail-Eingang
    external_policy: Mapped[str] = mapped_column(
        String(10), default="accept", server_default="accept"
    )
    max_attachment_mb: Mapped[int] = mapped_column(Integer, default=15, server_default=text("15"))
    allowed_types: Mapped[list[str]] = mapped_column(
        JSONB, default=lambda: list(DEFAULT_TYPES), server_default=text("'[]'::jsonb")
    )
    processed_days: Mapped[int] = mapped_column(Integer, default=30, server_default=text("30"))
    ignored_days: Mapped[int] = mapped_column(Integer, default=7, server_default=text("7"))
    reopen_policy: Mapped[str] = mapped_column(String(10), default="days", server_default="days")
    reopen_days: Mapped[int] = mapped_column(Integer, default=14, server_default=text("14"))
    mailbox_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mailbox_error: Mapped[str] = mapped_column(Text, default="", server_default="")
    # Fristen (Phase 3): an/aus, Arbeitstage (0 = Montag) und Arbeitszeit in Minuten ab 0 Uhr
    sla_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    work_days: Mapped[list[int]] = mapped_column(
        JSONB, default=lambda: [0, 1, 2, 3, 4], server_default=text("'[0, 1, 2, 3, 4]'::jsonb")
    )
    work_start: Mapped[int] = mapped_column(Integer, default=480, server_default=text("480"))
    work_end: Mapped[int] = mapped_column(Integer, default=1020, server_default=text("1020"))
    # Geräte aus dem IT-Bestand (Phase 3)
    devices_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )
    device_kinds: Mapped[list[int]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    device_suggest: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    device_in_inventory: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false")
    )

    __table_args__ = (
        CheckConstraint("assignment IN ('first', 'round_robin')", name="ck_ticket_area_assignment"),
        CheckConstraint(
            "external_policy IN ('accept', 'review', 'reject')", name="ck_ticket_area_external"
        ),
        CheckConstraint("reopen_policy IN ('days', 'always', 'new')", name="ck_ticket_area_reopen"),
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
    # Erste Antwort an den Melder (für Fristen)
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Phase 3: Kategorie, Gerät, Erinnerung, Zusammenführen, Zuständigkeit
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("ticket_categories.id", ondelete="SET NULL"), index=True
    )
    hardware_id: Mapped[int | None] = mapped_column(
        ForeignKey("inventory_hardware.id", ondelete="SET NULL"), index=True
    )
    reminder_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    reminder_note: Mapped[str] = mapped_column(String(120), default="", server_default="")
    # Zeitpunkt, zu dem die Erinnerung zuletzt ausgelöst hat (für die Benachrichtigung)
    reminder_fired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tickets.id", ondelete="SET NULL")
    )
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    assigned_by_oid: Mapped[str | None] = mapped_column(String(64))
    # Bei einer Übergabe: die neue Person benachrichtigen?
    assign_notify: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    # Fristen: fällig (berechnet), ruhende Arbeitsminuten (Wartet), seit wann es ruht, eingehalten
    sla_response_due: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sla_solution_due: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    sla_paused_minutes: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    sla_paused_since: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sla_response_met: Mapped[bool | None] = mapped_column(Boolean)
    sla_solution_met: Mapped[bool | None] = mapped_column(Boolean)

    __table_args__ = (
        CheckConstraint(
            "status IN ('new', 'in_progress', 'waiting', 'reminder', 'solved', 'closed', 'merged')",
            name="ck_ticket_status",
        ),
        CheckConstraint("priority IN ('low', 'medium', 'high')", name="ck_ticket_priority"),
        CheckConstraint("channel IN ('mail', 'manual', 'phone')", name="ck_ticket_channel"),
        Index("ix_tickets_area_status", "area_id", "status"),
    )


class TicketCategory(Base):
    """Kategorie je Bereich mit Standard-Priorität."""

    __tablename__ = "ticket_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(
        ForeignKey("ticket_areas.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    default_priority: Mapped[str] = mapped_column(
        String(10), default="medium", server_default="medium"
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))

    __table_args__ = (
        UniqueConstraint("area_id", "name", name="uq_ticket_category"),
        CheckConstraint(
            "default_priority IN ('low', 'medium', 'high')", name="ck_ticket_category_priority"
        ),
    )


class TicketSla(Base):
    """Frist je Bereich und Priorität in Arbeitsminuten."""

    __tablename__ = "ticket_sla"

    area_id: Mapped[int] = mapped_column(
        ForeignKey("ticket_areas.id", ondelete="CASCADE"), primary_key=True
    )
    priority: Mapped[str] = mapped_column(String(10), primary_key=True)
    response_minutes: Mapped[int] = mapped_column(Integer)
    solution_minutes: Mapped[int] = mapped_column(Integer)


class TicketTemplate(Base):
    """Textbaustein je Bereich (gemeinsam, keine persönlichen)."""

    __tablename__ = "ticket_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(
        ForeignKey("ticket_areas.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(80))
    shortcut: Mapped[str] = mapped_column(String(30))
    kind: Mapped[str] = mapped_column(String(10))  # reply | note
    status_after: Mapped[str] = mapped_column(String(10), default="", server_default="")
    body: Mapped[str] = mapped_column(Text)

    __table_args__ = (
        UniqueConstraint("area_id", "shortcut", name="uq_ticket_template_shortcut"),
        CheckConstraint("kind IN ('reply', 'note')", name="ck_ticket_template_kind"),
        CheckConstraint(
            "status_after IN ('', 'waiting', 'solved')", name="ck_ticket_template_status"
        ),
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
    # Zitat aus früheren Mails (eingeklappt angezeigt) und Message-ID der Mail
    quote: Mapped[str] = mapped_column(Text, default="", server_default="")
    message_id: Mapped[str | None] = mapped_column(String(998), index=True)
    # Beim Zusammenführen übernommen: Nummer des Quelltickets („aus T-…“)
    from_number: Mapped[int | None] = mapped_column(BigInteger)

    __table_args__ = (
        CheckConstraint(
            "kind IN ('inbound', 'reply', 'note', 'system')", name="ck_ticket_entry_kind"
        ),
    )


class TicketAttachment(Base):
    """Anhang eines Eintrags; Datei im Volume (nicht in der Datenbank, nicht im Webroot)."""

    __tablename__ = "ticket_attachments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    ticket_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tickets.id", ondelete="CASCADE"), index=True
    )
    entry_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("ticket_entries.id", ondelete="CASCADE"), index=True
    )
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(
        String(100), default="application/octet-stream", server_default="application/octet-stream"
    )
    size: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    # Schlüssel der Datei; leer, wenn der Anhang entfernt wurde (gesperrter Typ, zu groß)
    key: Mapped[str | None] = mapped_column(String(64))
    original: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    removed_reason: Mapped[str] = mapped_column(String(200), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TicketMailLog(Base):
    """Protokoll „Letzte Eingänge“: was mit jeder Mail passiert ist."""

    __tablename__ = "ticket_mail_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("ticket_areas.id", ondelete="CASCADE"))
    message_id: Mapped[str] = mapped_column(String(998), default="", server_default="")
    sender: Mapped[str] = mapped_column(String(320), default="", server_default="")
    subject: Mapped[str] = mapped_column(String(250), default="", server_default="")
    result: Mapped[str] = mapped_column(String(20))
    detail: Mapped[str] = mapped_column(String(300), default="", server_default="")
    ticket_number: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )

    __table_args__ = (Index("ix_ticket_mail_log_area_message", "area_id", "message_id"),)


class TicketReview(Base):
    """Mail eines unbekannten externen Absenders unter „Zu prüfen“ (bleibt im Posteingang)."""

    __tablename__ = "ticket_review"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(
        ForeignKey("ticket_areas.id", ondelete="CASCADE"), index=True
    )
    graph_id: Mapped[str] = mapped_column(String(300), default="", server_default="")
    message_id: Mapped[str] = mapped_column(String(998))
    sender: Mapped[str] = mapped_column(String(320))
    sender_name: Mapped[str] = mapped_column(String(200), default="", server_default="")
    subject: Mapped[str] = mapped_column(String(250), default="", server_default="")
    raw: Mapped[bytes] = mapped_column(LargeBinary)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    __table_args__ = (UniqueConstraint("area_id", "message_id", name="uq_ticket_review"),)


class TicketBlock(Base):
    """Gesperrter Absender (Adresse oder @domain) je Bereich."""

    __tablename__ = "ticket_blocks"

    id: Mapped[int] = mapped_column(primary_key=True)
    area_id: Mapped[int] = mapped_column(ForeignKey("ticket_areas.id", ondelete="CASCADE"))
    value: Mapped[str] = mapped_column(String(320))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (UniqueConstraint("area_id", "value", name="uq_ticket_block"),)


class TicketMailOut(Base):
    """Gesendete Mails an Melder (ohne Inhalt): Art, Empfänger, Ergebnis."""

    __tablename__ = "ticket_mail_out"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tickets.id", ondelete="CASCADE"), index=True
    )
    area_id: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(20))
    recipients: Mapped[str] = mapped_column(String(2000))
    message_id: Mapped[str] = mapped_column(String(998), default="", server_default="")
    error: Mapped[str] = mapped_column(String(500), default="", server_default="")
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class TicketMailDesign(Base):
    """Gestaltung aller Mails an Melder (eine Zeile, id = 1; Ticket-Verwaltung)."""

    __tablename__ = "ticket_mail_design"

    id: Mapped[int] = mapped_column(primary_key=True)
    accent: Mapped[str] = mapped_column(String(7), default="", server_default="")
    footer: Mapped[str] = mapped_column(Text, default="", server_default="")
    privacy_url: Mapped[str] = mapped_column(String(500), default="", server_default="")
    logo_png: Mapped[bytes | None] = mapped_column(LargeBinary)


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
