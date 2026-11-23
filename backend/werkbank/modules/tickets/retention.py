"""Aufbewahrung im Modul Tickets (spec.md 8e, Phase 4).

Frist in Monaten ab dem Schließen (nach Wiederöffnen beginnt sie neu, weil das Schließen
`closed_at` neu setzt). Danach wird ein Ticket anonymisiert oder vollständig gelöscht.
Vorgabe für alle Bereiche (Ticket-Verwaltung), Abweichung je Bereich (Bereichsverwaltung);
0 Monate heißt aus. Ausnahmen je Ticket gelten ein Jahr und verfallen ohne Bestätigung.
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import ColumnElement, Select, and_, delete, func, or_, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.sessions import now_utc
from werkbank.modules.tickets.files import remove_file
from werkbank.modules.tickets.models import (
    ANONYMIZED_SUBJECT,
    RETENTION_ANONYMIZE,
    RETENTION_DELETE,
    STATUS_CLOSED,
    STATUS_MERGED,
    Ticket,
    TicketArea,
    TicketAttachment,
    TicketEntry,
    TicketMailLog,
    TicketMailOut,
    TicketParticipant,
    TicketRetention,
    TicketRetentionRun,
)
from werkbank.modules.tickets.service import SYSTEM, protocol

logger = logging.getLogger(__name__)

HOLD_DAYS = 365
# Hinweis an die Bereichsverwaltung so viele Tage vor dem Ende einer Ausnahme
HOLD_WARN_DAYS = 30
PREVIEW_LIMIT = 20
RUNS_KEEP = 100


@dataclass(frozen=True)
class Policy:
    months: int
    action: str
    # Woher die Regel kommt: Vorgabe oder Bereich
    custom: bool

    @property
    def active(self) -> bool:
        return self.months > 0


def default_policy(db: Session) -> TicketRetention:
    row = db.get(TicketRetention, 1)
    if row is None:
        row = TicketRetention(id=1, months=0, action=RETENTION_ANONYMIZE)
        db.add(row)
        db.flush()
    return row


def policy_for(area: TicketArea, default: TicketRetention) -> Policy:
    if area.retention_custom:
        return Policy(area.retention_months, area.retention_action, True)
    return Policy(default.months, default.action, False)


def months_before(moment: datetime, months: int) -> datetime:
    """Gleicher Tag (oder letzter Tag des Monats) `months` Monate früher."""
    total = moment.year * 12 + (moment.month - 1) - months
    year, month = divmod(total, 12)
    month += 1
    for day in (moment.day, 30, 29, 28):
        try:
            return moment.replace(year=year, month=month, day=day)
        except ValueError:
            continue
    return moment.replace(year=year, month=month, day=28)


def _closed_since() -> ColumnElement[datetime]:
    # Zusammengeführte Tickets haben kein Schließdatum; dann zählt die letzte Änderung
    return func.coalesce(Ticket.closed_at, Ticket.updated_at)


def due_query(area_id: int, policy: Policy, now: datetime) -> Select[Ticket]:
    """Tickets eines Bereichs, die beim nächsten Lauf an der Reihe sind."""
    cutoff = months_before(now, policy.months)
    conditions = [
        Ticket.area_id == area_id,
        Ticket.status.in_((STATUS_CLOSED, STATUS_MERGED)),
        _closed_since() <= cutoff,
        or_(Ticket.hold_until.is_(None), Ticket.hold_until <= now),
    ]
    if policy.action == RETENTION_ANONYMIZE:
        conditions.append(Ticket.anonymized_at.is_(None))
    return select(Ticket).where(and_(*conditions)).order_by(Ticket.number)


@dataclass
class Preview:
    policy: Policy
    count: int
    numbers: list[int]
    holds: int
    holds_expiring: list[int] = field(default_factory=list)


def preview(db: Session, area: TicketArea, now: datetime | None = None) -> Preview:
    now = now or now_utc()
    policy = policy_for(area, default_policy(db))
    holds = db.scalar(
        select(func.count())
        .select_from(Ticket)
        .where(Ticket.area_id == area.id, Ticket.hold_until > now)
    )
    expiring = list(
        db.scalars(
            select(Ticket.number)
            .where(
                Ticket.area_id == area.id,
                Ticket.hold_until > now,
                Ticket.hold_until <= now + timedelta(days=HOLD_WARN_DAYS),
            )
            .order_by(Ticket.hold_until)
            .limit(PREVIEW_LIMIT)
        )
    )
    if not policy.active:
        return Preview(policy, 0, [], holds or 0, expiring)
    query = due_query(area.id, policy, now)
    count = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    numbers = list(db.scalars(query.with_only_columns(Ticket.number).limit(PREVIEW_LIMIT)))
    return Preview(policy, count, numbers, holds or 0, expiring)


def _remove_files(db: Session, directory: Path, ticket_id: uuid.UUID) -> None:
    for key in db.scalars(
        select(TicketAttachment.key).where(
            TicketAttachment.ticket_id == ticket_id, TicketAttachment.key.is_not(None)
        )
    ):
        try:
            remove_file(directory, key)
        except OSError:
            logger.warning("Anhang %s konnte nicht gelöscht werden.", key)


def _drop_traces(db: Session, ticket: Ticket) -> None:
    """Protokoll „Letzte Eingänge“ (Absender, Betreff) und Ausgang (Empfänger) zum Ticket."""
    db.execute(delete(TicketMailLog).where(TicketMailLog.ticket_number == ticket.number))
    db.execute(delete(TicketMailOut).where(TicketMailOut.ticket_id == ticket.id))


def anonymize(db: Session, directory: Path, ticket: Ticket, now: datetime) -> None:
    """Entfernt Melder, Adressen, Betreff, Texte, Anhänge, Namen der Bearbeiter.
    Erhalten bleiben Nr., Bereich, Kategorie, Priorität, Zeitpunkte und die Fristen."""
    _remove_files(db, directory, ticket.id)
    db.execute(delete(TicketAttachment).where(TicketAttachment.ticket_id == ticket.id))
    db.execute(delete(TicketEntry).where(TicketEntry.ticket_id == ticket.id))
    db.execute(delete(TicketParticipant).where(TicketParticipant.ticket_id == ticket.id))
    _drop_traces(db, ticket)
    ticket.subject = ANONYMIZED_SUBJECT
    ticket.reporter_name = ""
    ticket.reporter_mail = ""
    ticket.assignee_oid = None
    ticket.assignee_name = ""
    ticket.assigned_by_oid = None
    ticket.created_by = ""
    ticket.reminder_note = ""
    ticket.hold_until = None
    ticket.hold_reason = ""
    ticket.hold_by_name = ""
    ticket.anonymized_at = now


def remove(db: Session, directory: Path, ticket: Ticket) -> None:
    """Löscht das Ticket vollständig (Einträge, Anhänge und Beteiligte über die Datenbank)."""
    _remove_files(db, directory, ticket.id)
    _drop_traces(db, ticket)
    db.execute(delete(Ticket).where(Ticket.id == ticket.id))


def expire_holds(db: Session, now: datetime) -> dict[int, int]:
    """Ausnahmen, die nicht bestätigt wurden, verfallen; das Ticket ist im selben Lauf dran."""
    counts: dict[int, int] = {}
    for ticket in db.scalars(select(Ticket).where(Ticket.hold_until <= now)):
        counts[ticket.area_id] = counts.get(ticket.area_id, 0) + 1
        protocol(db, SYSTEM, "aufbewahrung_ausnahme_verfallen", ticket=ticket)
        ticket.hold_until = None
        ticket.hold_reason = ""
        ticket.hold_by_name = ""
    return counts


def run_retention(
    db: Session, settings: Settings, now: datetime | None = None
) -> TicketRetentionRun:
    """Täglicher Lauf: Ausnahmen verfallen lassen, dann je Bereich anonymisieren oder löschen."""
    now = now or now_utc()
    directory = settings.tickets_files_dir
    run = TicketRetentionRun(started_at=now, areas={})
    db.add(run)
    expired = expire_holds(db, now)
    db.flush()
    default = default_policy(db)
    per_area: dict[str, dict[str, int]] = {}
    for area in db.scalars(select(TicketArea).order_by(TicketArea.id)):
        policy = policy_for(area, default)
        stats = {"anonymized": 0, "deleted": 0, "holds_expired": expired.get(area.id, 0)}
        if policy.active:
            for ticket in db.scalars(due_query(area.id, policy, now)).all():
                if policy.action == RETENTION_DELETE:
                    remove(db, directory, ticket)
                    stats["deleted"] += 1
                else:
                    anonymize(db, directory, ticket, now)
                    stats["anonymized"] += 1
        if any(stats.values()):
            per_area[str(area.id)] = stats
            protocol(db, SYSTEM, "aufbewahrung_lauf", area_id=area.id, details=dict(stats))
    run.areas = dict(per_area)
    run.anonymized = sum(s["anonymized"] for s in per_area.values())
    run.deleted = sum(s["deleted"] for s in per_area.values())
    run.holds_expired = sum(expired.values())
    # Nur die letzten Läufe behalten
    keep = select(TicketRetentionRun.id).order_by(TicketRetentionRun.id.desc()).limit(RUNS_KEEP)
    db.flush()
    db.execute(delete(TicketRetentionRun).where(TicketRetentionRun.id.not_in(keep)))
    db.commit()
    return run


def set_hold(ticket: Ticket, reason: str, by_name: str, now: datetime) -> None:
    ticket.hold_until = now + timedelta(days=HOLD_DAYS)
    ticket.hold_reason = reason
    ticket.hold_by_name = by_name


def clear_hold(ticket: Ticket) -> None:
    ticket.hold_until = None
    ticket.hold_reason = ""
    ticket.hold_by_name = ""
