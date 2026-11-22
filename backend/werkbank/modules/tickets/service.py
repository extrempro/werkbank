"""Fachliche Abläufe im Modul Tickets (ohne HTTP), damit API und Worker sie teilen."""

from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.core.audit import write_audit
from werkbank.core.sessions import now_utc
from werkbank.modules.tickets.access import Member, area_people
from werkbank.modules.tickets.models import (
    AREA_EDIT,
    ASSIGN_ROUND_ROBIN,
    ENTRY_SYSTEM,
    OPEN_STATUSES,
    STATUS_CLOSED,
    STATUS_SOLVED,
    Ticket,
    TicketArea,
    TicketAudit,
    TicketEntry,
)

STATUS_LABELS = {
    "new": "Neu",
    "in_progress": "In Arbeit",
    "waiting": "Wartet auf Rückmeldung",
    "reminder": "Erinnerung",
    "solved": "Gelöst",
    "closed": "Geschlossen",
    "merged": "Zusammengeführt",
}
PRIORITY_LABELS = {"low": "Niedrig", "medium": "Mittel", "high": "Hoch"}

# Gelöst → Geschlossen nach so vielen Tagen ohne Rückmeldung
AUTO_CLOSE_DAYS = 5
# Protokoll des Moduls: Aufbewahrung
AUDIT_KEEP_DAYS = 3 * 365


def ticket_label(number: int) -> str:
    return f"T-{number}"


@dataclass(frozen=True)
class Actor:
    """Wer etwas tut (Person oder „Werkbank“ für Aufträge)."""

    oid: str | None
    name: str


SYSTEM = Actor(oid=None, name="Werkbank")


def protocol(
    db: Session,
    actor: Actor,
    action: str,
    *,
    area_id: int | None = None,
    ticket: Ticket | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Eintrag im Protokoll des Moduls und im Audit-Log (ohne Inhalte von Texten)."""
    db.add(
        TicketAudit(
            actor_oid=actor.oid,
            actor_name=actor.name,
            area_id=area_id if area_id is not None else (ticket.area_id if ticket else None),
            action=action,
            ticket_number=ticket.number if ticket else None,
            details=details or {},
        )
    )
    write_audit(
        db,
        module="tickets",
        action=action,
        object_type="ticket" if ticket else ("bereich" if area_id is not None else None),
        object_id=ticket_label(ticket.number) if ticket else (str(area_id) if area_id else None),
        details=details,
    )


def system_entry(db: Session, ticket: Ticket, text: str, actor: Actor) -> None:
    db.add(
        TicketEntry(
            ticket_id=ticket.id,
            kind=ENTRY_SYSTEM,
            body=text,
            author_oid=actor.oid,
            author_name=actor.name,
        )
    )


def open_counts(db: Session, area_id: int) -> dict[str, int]:
    rows = db.execute(
        select(Ticket.assignee_oid, func.count())
        .where(
            Ticket.area_id == area_id,
            Ticket.status.in_(OPEN_STATUSES),
            Ticket.assignee_oid.is_not(None),
        )
        .group_by(Ticket.assignee_oid)
    ).all()
    return {oid: count for oid, count in rows if oid}


def next_round_robin(db: Session, area_id: int) -> Member | None:
    """Person mit „Bearbeiten“ und den wenigsten offenen Tickets.

    Bei Gleichstand bekommt die Person, die am längsten kein neues Ticket bekommen hat.
    „Nur lesen“ und die Bereichsverwaltung werden nicht berücksichtigt.
    """
    candidates = [member for member, role in area_people(db, area_id, (AREA_EDIT,))]
    if not candidates:
        return None
    counts = open_counts(db, area_id)
    last = dict(
        db.execute(
            select(Ticket.assignee_oid, func.max(Ticket.created_at))
            .where(Ticket.area_id == area_id, Ticket.assignee_oid.is_not(None))
            .group_by(Ticket.assignee_oid)
        ).all()
    )
    epoch = now_utc() - timedelta(days=36500)

    def key(member: Member) -> tuple[int, Any, str]:
        return (counts.get(member.oid, 0), last.get(member.oid) or epoch, member.name.lower())

    return min(candidates, key=key)


def assign_new(db: Session, ticket: Ticket, area: TicketArea) -> None:
    """Zuweisung eines neuen Tickets nach der Art des Bereichs."""
    if area.assignment != ASSIGN_ROUND_ROBIN:
        return
    member = next_round_robin(db, area.id)
    if member is None:
        return
    ticket.assignee_oid = member.oid
    ticket.assignee_name = member.name
    system_entry(db, ticket, f"Zuständig: {member.name} (reihum)", SYSTEM)


def set_status(ticket: Ticket, new_status: str) -> None:
    now = now_utc()
    ticket.status = new_status
    ticket.updated_at = now
    ticket.solved_at = now if new_status == STATUS_SOLVED else None
    if new_status == STATUS_CLOSED:
        ticket.closed_at = now
    elif new_status in OPEN_STATUSES:
        ticket.closed_at = None


def auto_close(db: Session) -> int:
    """Gelöste Tickets nach AUTO_CLOSE_DAYS Tagen ohne Rückmeldung schließen."""
    limit = now_utc() - timedelta(days=AUTO_CLOSE_DAYS)
    tickets = db.scalars(
        select(Ticket).where(Ticket.status == STATUS_SOLVED, Ticket.solved_at < limit)
    ).all()
    for ticket in tickets:
        solved_at = ticket.solved_at
        set_status(ticket, STATUS_CLOSED)
        ticket.solved_at = solved_at
        system_entry(
            db,
            ticket,
            f"Status: Gelöst → Geschlossen (automatisch nach {AUTO_CLOSE_DAYS} Tagen)",
            SYSTEM,
        )
        protocol(
            db,
            SYSTEM,
            "ticket_status",
            ticket=ticket,
            details={"von": "solved", "nach": "closed", "automatisch": True},
        )
    return len(tickets)
