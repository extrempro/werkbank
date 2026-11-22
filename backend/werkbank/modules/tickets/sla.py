"""Fristen (SLA) je Bereich: erste Reaktion und Lösung je Priorität in Arbeitsminuten.

- Gezählt wird nur in der Arbeitszeit des Bereichs (Wochentage, Beginn und Ende, Ortszeit
  `TICKETS_TIMEZONE`). Feiertage zählen als Arbeitstage.
- Bei „Wartet auf Rückmeldung“ ruht die Frist: Die Arbeitsminuten in diesem Status werden
  addiert (`sla_paused_minutes`) und die Fälligkeiten verschieben sich entsprechend.
- Bei „Erinnerung“ läuft die Frist weiter.
- Ist die Frist im Bereich aus, gibt es keine Fälligkeiten (alles None).
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import get_settings
from werkbank.core.sessions import now_utc
from werkbank.modules.tickets.models import (
    STATUS_CLOSED,
    STATUS_SOLVED,
    STATUS_WAITING,
    Ticket,
    TicketArea,
    TicketSla,
)

MAX_DAYS = 3660


@dataclass(frozen=True)
class WorkTime:
    days: frozenset[int]  # 0 = Montag
    start: int  # Minuten ab 0 Uhr
    end: int
    tz: ZoneInfo


@lru_cache
def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError, ValueError:
        return ZoneInfo("UTC")


def work_zone() -> ZoneInfo:
    """Zeitzone der Arbeitszeit und für Anzeigen in Systemeinträgen."""
    return _zone(get_settings().tickets_timezone)


def work_time(area: TicketArea, tz_name: str | None = None) -> WorkTime:
    days = frozenset(d for d in (area.work_days or []) if isinstance(d, int) and 0 <= d <= 6)
    start = min(max(area.work_start, 0), 24 * 60)
    end = min(max(area.work_end, start), 24 * 60)
    return WorkTime(
        days=days, start=start, end=end, tz=_zone(tz_name or get_settings().tickets_timezone)
    )


def _window(day: datetime, wt: WorkTime) -> tuple[datetime, datetime]:
    base = datetime.combine(day.date(), time(0), tzinfo=wt.tz)
    return base + timedelta(minutes=wt.start), base + timedelta(minutes=wt.end)


def add_work_minutes(start: datetime, minutes: int, wt: WorkTime) -> datetime | None:
    """Zeitpunkt, an dem nach `start` so viele Arbeitsminuten vergangen sind."""
    if not wt.days or wt.end <= wt.start:
        return None
    current = start.astimezone(wt.tz)
    remaining = max(minutes, 0)
    for _ in range(MAX_DAYS):
        begin, finish = _window(current, wt)
        if current.weekday() in wt.days and current < finish:
            current = max(current, begin)
            available = int((finish - current).total_seconds() // 60)
            if remaining <= available:
                return (current + timedelta(minutes=remaining)).astimezone(start.tzinfo)
            remaining -= available
        next_day = datetime.combine(current.date() + timedelta(days=1), time(0), tzinfo=wt.tz)
        current = next_day
    return None


def work_minutes_between(start: datetime, end: datetime, wt: WorkTime) -> int:
    """Arbeitsminuten zwischen zwei Zeitpunkten (0, wenn end vor start liegt)."""
    if end <= start or not wt.days or wt.end <= wt.start:
        return 0
    current = start.astimezone(wt.tz)
    stop = end.astimezone(wt.tz)
    total = 0.0
    for _ in range(MAX_DAYS):
        if current >= stop:
            break
        begin, finish = _window(current, wt)
        if current.weekday() in wt.days:
            lo = max(current, begin)
            hi = min(finish, stop)
            if hi > lo:
                total += (hi - lo).total_seconds() / 60
        current = datetime.combine(current.date() + timedelta(days=1), time(0), tzinfo=wt.tz)
    return int(total)


def sla_for(db: Session, area_id: int, priority: str) -> TicketSla | None:
    return db.get(TicketSla, (area_id, priority))


def recalc(db: Session, ticket: Ticket, area: TicketArea | None = None) -> None:
    """Fälligkeiten neu berechnen (nach Anlegen, Priorität, Verschieben, Ende einer Pause)."""
    area = area or db.get(TicketArea, ticket.area_id)
    sla = sla_for(db, ticket.area_id, ticket.priority) if area and area.sla_enabled else None
    if area is None or sla is None:
        ticket.sla_response_due = None
        ticket.sla_solution_due = None
        ticket.sla_response_met = None
        ticket.sla_solution_met = None
        return
    wt = work_time(area)
    created = ticket.created_at or now_utc()
    paused = ticket.sla_paused_minutes or 0
    ticket.sla_response_due = add_work_minutes(created, sla.response_minutes + paused, wt)
    ticket.sla_solution_due = add_work_minutes(created, sla.solution_minutes + paused, wt)
    if ticket.first_response_at is not None and ticket.sla_response_due is not None:
        ticket.sla_response_met = ticket.first_response_at <= ticket.sla_response_due


def on_status(db: Session, ticket: Ticket, old: str, new: str, now: datetime | None = None) -> None:
    """Pause bei „Wartet“, Ergebnis bei „Gelöst“/„Geschlossen“, zurücksetzen beim Wiederöffnen."""
    now = now or now_utc()
    area = db.get(TicketArea, ticket.area_id)
    if area is None or not area.sla_enabled:
        return
    if new == STATUS_WAITING and old != STATUS_WAITING:
        ticket.sla_paused_since = now
    if old == STATUS_WAITING and new != STATUS_WAITING and ticket.sla_paused_since is not None:
        ticket.sla_paused_minutes = (ticket.sla_paused_minutes or 0) + work_minutes_between(
            ticket.sla_paused_since, now, work_time(area)
        )
        ticket.sla_paused_since = None
        recalc(db, ticket, area)
    if new in (STATUS_SOLVED, STATUS_CLOSED) and ticket.sla_solution_met is None:
        if ticket.sla_solution_due is not None:
            ticket.sla_solution_met = now <= ticket.sla_solution_due
    elif new not in (STATUS_SOLVED, STATUS_CLOSED) and old in (STATUS_SOLVED, STATUS_CLOSED):
        ticket.sla_solution_met = None


def on_first_response(ticket: Ticket) -> None:
    if ticket.sla_response_due is not None and ticket.first_response_at is not None:
        ticket.sla_response_met = ticket.first_response_at <= ticket.sla_response_due


def consumed_share(ticket: Ticket, area: TicketArea, now: datetime) -> float | None:
    """Anteil der verbrauchten Lösungsfrist (0 … 1+), None ohne Frist oder bei Pause."""
    if ticket.sla_solution_due is None or ticket.sla_paused_since is not None:
        return None
    wt = work_time(area)
    created = ticket.created_at
    total = work_minutes_between(created, ticket.sla_solution_due, wt) - (
        ticket.sla_paused_minutes or 0
    )
    used = work_minutes_between(created, now, wt) - (ticket.sla_paused_minutes or 0)
    if total <= 0:
        return None
    return used / total


def save_sla(db: Session, area: TicketArea, rows: Iterable[tuple[str, int, int]]) -> None:
    """Fristen je Priorität speichern (Minuten) und offene Tickets neu berechnen."""
    for priority, response, solution in rows:
        sla = db.get(TicketSla, (area.id, priority))
        if sla is None:
            db.add(
                TicketSla(
                    area_id=area.id,
                    priority=priority,
                    response_minutes=response,
                    solution_minutes=solution,
                )
            )
        else:
            sla.response_minutes, sla.solution_minutes = response, solution
    db.flush()
    from werkbank.modules.tickets.models import OPEN_STATUSES

    for ticket in db.scalars(
        select(Ticket).where(Ticket.area_id == area.id, Ticket.status.in_(OPEN_STATUSES))
    ):
        recalc(db, ticket, area)
