"""Benachrichtigungen im Modul Tickets (Glocke, Mail, Teams, Push nach den Einstellungen der
Person). Titel nennen nur die Nummer, keine Inhalte."""

import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.models import User
from werkbank.core.notifications import Event
from werkbank.modules.tickets.access import area_people
from werkbank.modules.tickets.models import (
    AREA_ADMIN,
    AREA_EDIT,
    ENTRY_INBOUND,
    OPEN_STATUSES,
    STATUS_NEW,
    Ticket,
    TicketArea,
    TicketEntry,
    TicketReview,
)
from werkbank.modules.tickets.retention import HOLD_WARN_DAYS
from werkbank.modules.tickets.sla import consumed_share

RECENT = timedelta(days=7)
WARN_SHARE = 0.8


def _link(number: int) -> str:
    return f"/tickets/{number}"


def tickets_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    users = {oid.lower(): uid for uid, oid in db.execute(select(User.id, User.entra_oid))}
    areas = {a.id: a for a in db.scalars(select(TicketArea).where(TicketArea.active.is_(True)))}
    people: dict[tuple[int, tuple[str, ...]], frozenset[uuid.UUID]] = {}

    def members(area_id: int, roles: tuple[str, ...]) -> frozenset[uuid.UUID]:
        key = (area_id, roles)
        if key not in people:
            people[key] = frozenset(
                users[m.oid] for m, _ in area_people(db, area_id, roles) if m.oid in users
            )
        return people[key]

    since = now - RECENT
    tickets = db.scalars(
        select(Ticket).where(Ticket.status.in_(OPEN_STATUSES), Ticket.area_id.in_(list(areas)))
    ).all()
    for t in tickets:
        area = areas[t.area_id]
        assignee = users.get((t.assignee_oid or "").lower())
        if t.status == STATUS_NEW and t.assignee_oid is None and t.created_at >= since:
            recipients = members(t.area_id, (AREA_ADMIN, AREA_EDIT))
            if recipients:
                yield Event(
                    kind="tickets.neu",
                    key=str(t.id),
                    title=f"T-{t.number}: neues Ticket im Bereich {area.name}",
                    link=_link(t.number),
                    user_ids=recipients,
                )
        if (
            assignee is not None
            and t.assign_notify
            and t.assigned_at is not None
            and t.assigned_at >= since
            and (t.assigned_by_oid or "").lower() != (t.assignee_oid or "").lower()
        ):
            yield Event(
                kind="tickets.zugewiesen",
                key=f"{t.id}:{t.assigned_at.isoformat()}",
                title=f"T-{t.number} ist dir zugewiesen",
                link=_link(t.number),
                user_ids=frozenset({assignee}),
            )
        if t.reminder_fired_at is not None and t.reminder_fired_at >= since:
            recipients = (
                frozenset({assignee}) if assignee else members(t.area_id, (AREA_ADMIN, AREA_EDIT))
            )
            if recipients:
                yield Event(
                    kind="tickets.erinnerung",
                    key=f"{t.id}:{t.reminder_fired_at.isoformat()}",
                    title=f"Erinnerung zu T-{t.number}",
                    link=_link(t.number),
                    user_ids=recipients,
                )
        if area.sla_enabled and t.sla_solution_due is not None and t.sla_paused_since is None:
            due = t.sla_solution_due.isoformat()
            if t.sla_solution_due < now:
                admins = members(t.area_id, (AREA_ADMIN,))
                if admins:
                    yield Event(
                        kind="tickets.frist_ueberschritten",
                        key=f"{t.id}:{due}",
                        title=f"T-{t.number}: Frist überschritten",
                        link=_link(t.number),
                        user_ids=admins,
                    )
            elif assignee is not None:
                share = consumed_share(t, area, now)
                if share is not None and share >= WARN_SHARE:
                    yield Event(
                        kind="tickets.frist_bald",
                        key=f"{t.id}:{due}",
                        title=f"T-{t.number}: Frist bald erreicht",
                        link=_link(t.number),
                        user_ids=frozenset({assignee}),
                    )

    # Neue Mails unter „Zu prüfen“ (Bereichsverwaltung); ohne Absender und Betreff
    reviews = db.execute(
        select(TicketReview.id, TicketReview.area_id).where(
            TicketReview.received_at >= since, TicketReview.area_id.in_(list(areas))
        )
    ).all()
    for review_id, area_id in reviews:
        admins = members(area_id, (AREA_ADMIN,))
        if admins:
            yield Event(
                kind="tickets.pruefen",
                key=str(review_id),
                title=f"Neue Mail zu prüfen im Bereich {areas[area_id].name}",
                link=f"/tickets/einstellungen/pflege?bereich={area_id}",
                user_ids=admins,
            )

    # Ausnahmen von der Aufbewahrung, die in den nächsten 30 Tagen enden (Bereichsverwaltung)
    holds = db.execute(
        select(Ticket.id, Ticket.number, Ticket.area_id, Ticket.hold_until).where(
            Ticket.hold_until > now,
            Ticket.hold_until <= now + timedelta(days=HOLD_WARN_DAYS),
            Ticket.area_id.in_(list(areas)),
        )
    ).all()
    for ticket_id, number, area_id, until in holds:
        admins = members(area_id, (AREA_ADMIN,))
        if admins:
            yield Event(
                kind="tickets.ausnahme",
                key=f"{ticket_id}:{until.isoformat() if until else ''}",
                title=f"T-{number}: Ausnahme von der Aufbewahrung endet bald",
                link=_link(number),
                user_ids=admins,
            )

    replies = db.execute(
        select(TicketEntry.id, Ticket.number, Ticket.assignee_oid)
        .join(Ticket, Ticket.id == TicketEntry.ticket_id)
        .where(
            TicketEntry.kind == ENTRY_INBOUND,
            TicketEntry.original.is_(False),
            TicketEntry.created_at >= since,
            Ticket.assignee_oid.is_not(None),
        )
    ).all()
    for entry_id, number, oid in replies:
        uid = users.get((oid or "").lower())
        if uid is not None:
            yield Event(
                kind="tickets.antwort",
                key=str(entry_id),
                title=f"Antwort des Melders auf T-{number}",
                link=_link(number),
                user_ids=frozenset({uid}),
            )
