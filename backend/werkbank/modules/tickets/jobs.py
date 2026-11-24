"""Aufträge des Moduls Tickets für den Worker."""

import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.sessions import now_utc
from werkbank.modules.tickets.access import GroupSourceError, TestGroupSource, group_source
from werkbank.modules.tickets.models import (
    TicketArea,
    TicketAreaGrant,
    TicketAudit,
    TicketGroupMember,
    TicketMailLog,
    TicketMembershipCache,
)
from werkbank.modules.tickets.retention import run_retention
from werkbank.modules.tickets.service import AUDIT_KEEP_DAYS, auto_close, fire_reminders

logger = logging.getLogger(__name__)

GROUP_SYNC = "tickets.gruppen"
GROUP_SYNC_INTERVAL = timedelta(hours=1)
HOUSEKEEPING = "tickets.wartung"
HOUSEKEEPING_INTERVAL = timedelta(hours=1)
REMINDERS = "tickets.erinnerungen"
REMINDERS_INTERVAL = timedelta(minutes=5)
RETENTION = "tickets.aufbewahrung"
RETENTION_INTERVAL = timedelta(days=1)


def sync_groups(db: Session, settings: Settings) -> int:
    """Mitglieder der Gruppen mit Rollen in Bereichen aus Entra übernehmen (stündlich).

    Für Auswahllisten und „reihum“; der Zugriff selbst wird bei jeder Anfrage geprüft.
    Schlägt die Abfrage einer Gruppe fehl, bleibt ihr letzter Stand.
    """
    source = group_source(db, settings)
    if isinstance(source, TestGroupSource):
        return 0
    groups = sorted(
        set(db.scalars(select(TicketAreaGrant.oid).where(TicketAreaGrant.kind == "group")))
    )
    now = now_utc()
    synced = 0
    for group_oid in groups:
        try:
            members = source.members(group_oid)
        except GroupSourceError as exc:
            logger.warning("Gruppe %s nicht abgleichbar: %s", group_oid, exc)
            continue
        db.execute(delete(TicketGroupMember).where(TicketGroupMember.group_oid == group_oid))
        for member in {m.oid: m for m in members}.values():
            db.add(
                TicketGroupMember(
                    group_oid=group_oid,
                    oid=member.oid,
                    name=member.name,
                    mail=member.mail,
                    synced_at=now,
                )
            )
        synced += 1
    # Gruppen ohne Rolle mehr: Mitglieder entfernen
    db.execute(delete(TicketGroupMember).where(TicketGroupMember.group_oid.not_in(groups)))
    db.commit()
    return synced


def group_sync_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    sync_groups(db, settings)


def housekeeping(db: Session) -> None:
    """Gelöste Tickets schließen, alten Zwischenspeicher und altes Protokoll löschen."""
    auto_close(db)
    now = now_utc()
    db.execute(
        delete(TicketMembershipCache).where(
            TicketMembershipCache.checked_at < now - timedelta(days=1)
        )
    )
    db.execute(
        delete(TicketAudit).where(TicketAudit.occurred_at < now - timedelta(days=AUDIT_KEEP_DAYS))
    )
    prune_intake_log(db, now)
    db.commit()


def prune_intake_log(db: Session, now: datetime) -> int:
    """„Letzte Eingänge“ ohne Ticket je Bereich nach `intake_log_days` löschen. Zeilen zu einem
    Ticket gehen mit dessen Aufbewahrung."""
    removed = 0
    for area_id, days in db.execute(select(TicketArea.id, TicketArea.intake_log_days)):
        result = db.execute(
            delete(TicketMailLog).where(
                TicketMailLog.area_id == area_id,
                TicketMailLog.ticket_number.is_(None),
                TicketMailLog.created_at < now - timedelta(days=max(days, 1)),
            )
        )
        removed += result.rowcount or 0  # type: ignore[attr-defined]
    return removed


def housekeeping_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    housekeeping(db)


def sla_missed_mails(db: Session, settings: Settings) -> int:
    """Mail „Frist nicht eingehalten“ an den Melder (je Bereich zuschaltbar), je Ticket einmal."""
    from werkbank.modules.tickets.mail_texts import DEFAULT_EVENTS
    from werkbank.modules.tickets.mailbox import MailboxError, available, new_http, open_mailbox
    from werkbank.modules.tickets.models import OPEN_STATUSES, Ticket, TicketArea, TicketMailOut
    from werkbank.modules.tickets.outbound import event_text, send_to_reporter
    from werkbank.modules.tickets.service import SYSTEM, system_entry

    if not available(settings):
        return 0
    now = now_utc()
    areas = {
        a.id: a
        for a in db.scalars(
            select(TicketArea).where(TicketArea.sla_enabled.is_(True), TicketArea.mailbox != "")
        )
        if {**DEFAULT_EVENTS, **(a.mail_events or {})}.get("sla_missed")
    }
    if not areas:
        return 0
    sent_before = set(
        db.scalars(select(TicketMailOut.ticket_id).where(TicketMailOut.kind == "sla_missed"))
    )
    due = db.scalars(
        select(Ticket).where(
            Ticket.area_id.in_(list(areas)),
            Ticket.status.in_(OPEN_STATUSES),
            Ticket.sla_solution_due < now,
            Ticket.sla_paused_since.is_(None),
            Ticket.reporter_mail != "",
        )
    ).all()
    count = 0
    with new_http() as http:
        try:
            mailbox = open_mailbox(settings, http)
        except MailboxError:
            return 0
        for ticket in due:
            if ticket.id in sent_before:
                continue
            message_id, error = send_to_reporter(
                db,
                mailbox,
                areas[ticket.area_id],
                ticket,
                event_text("sla_missed", ticket),
                kind="sla_missed",
                auto=True,
            )
            system_entry(
                db,
                ticket,
                "Mail „Frist nicht eingehalten“ an den Melder "
                + ("gesendet" if message_id else f"nicht gesendet: {error}"),
                SYSTEM,
            )
            count += 1
    db.commit()
    return count


def reminders_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    fire_reminders(db)
    db.commit()
    sla_missed_mails(db, settings)


def retention_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    run_retention(db, settings)
