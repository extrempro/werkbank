"""Leiste „Favoriten“ und „Geöffnet“ unter „Neues Ticket“ (je Person, auf allen Geräten gleich).

Die Reihenfolge ist die des ersten Öffnens. Favoriten zählen nicht zur Höchstzahl; ist sie
überschritten, fällt das älteste Ticket ohne Stern heraus. Angezeigt werden nur Tickets, die die
Person gerade sehen darf: Wer die Rechte an einem Bereich verliert, sieht dessen Tickets nicht
mehr in der Leiste (die Einträge bleiben, falls die Rechte zurückkommen).
"""

from typing import Literal

from fastapi import APIRouter, HTTPException, Path, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.core.deps import DbDep
from werkbank.core.sessions import now_utc
from werkbank.modules.tickets.access import AccessDep, TicketAccess, not_found
from werkbank.modules.tickets.models import Ticket, TicketNavPrefs, TicketRecent

router = APIRouter(prefix="/api/tickets/leiste")

LIMITS = (5, 10, 15, 25)
DEFAULT_LIMIT = 15
# Obergrenze aller Einträge je Person (auch unsichtbare), damit nichts unbegrenzt wächst
HARD_LIMIT = 200

NumberPath = Path(ge=1, le=10**12)


class RecentItem(BaseModel):
    number: int
    subject: str
    status: str


class RecentOut(BaseModel):
    limit: int
    compact: bool
    favorites: list[RecentItem]
    recent: list[RecentItem]


class FavoriteIn(BaseModel):
    favorite: bool


class PrefsIn(BaseModel):
    limit: Literal[5, 10, 15, 25]
    compact: bool


def _oid(access: TicketAccess) -> str:
    if not access.oid:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Keine Berechtigung.")
    return access.oid


def _prefs(db: Session, oid: str) -> TicketNavPrefs:
    prefs = db.get(TicketNavPrefs, oid)
    if prefs is None:
        prefs = TicketNavPrefs(oid=oid, recent_limit=DEFAULT_LIMIT, compact=True)
    return prefs


def _rows(db: Session, access: TicketAccess, oid: str) -> list[tuple[TicketRecent, Ticket]]:
    """Einträge der Person in Reihenfolge, nur sichtbare Tickets."""
    rows = db.execute(
        select(TicketRecent, Ticket)
        .join(Ticket, Ticket.id == TicketRecent.ticket_id)
        .where(TicketRecent.oid == oid)
        .order_by(TicketRecent.added_at, TicketRecent.id)
    ).all()
    return [(entry, ticket) for entry, ticket in rows if access.can_read(ticket.area_id)]


def _trim(db: Session, access: TicketAccess, oid: str, limit: int) -> None:
    """Älteste Tickets ohne Stern über der Höchstzahl entfernen."""
    plain = [entry for entry, _ in _rows(db, access, oid) if not entry.favorite]
    for entry in plain[: max(0, len(plain) - limit)]:
        db.delete(entry)
    db.flush()
    ids = db.scalars(
        select(TicketRecent.id)
        .where(TicketRecent.oid == oid)
        .order_by(TicketRecent.added_at.desc(), TicketRecent.id.desc())
        .offset(HARD_LIMIT)
    ).all()
    if ids:
        db.execute(delete(TicketRecent).where(TicketRecent.id.in_(ids)))


def _out(db: Session, access: TicketAccess, oid: str) -> RecentOut:
    prefs = _prefs(db, oid)
    favorites: list[RecentItem] = []
    recent: list[RecentItem] = []
    for entry, ticket in _rows(db, access, oid):
        item = RecentItem(number=ticket.number, subject=ticket.subject, status=ticket.status)
        (favorites if entry.favorite else recent).append(item)
    return RecentOut(
        limit=prefs.recent_limit, compact=prefs.compact, favorites=favorites, recent=recent
    )


def _visible(db: Session, access: TicketAccess, number: int) -> Ticket:
    ticket = db.scalar(select(Ticket).where(Ticket.number == number))
    if ticket is None or not access.can_read(ticket.area_id):
        raise not_found()
    return ticket


def _entry(db: Session, oid: str, ticket: Ticket) -> TicketRecent | None:
    return db.scalar(
        select(TicketRecent).where(TicketRecent.oid == oid, TicketRecent.ticket_id == ticket.id)
    )


@router.get("")
def recent(access: AccessDep, db: DbDep) -> RecentOut:
    return _out(db, access, _oid(access))


@router.post("/{number}")
def opened(access: AccessDep, db: DbDep, number: int = NumberPath) -> RecentOut:
    """Ticket wurde geöffnet: ans Ende der Leiste, falls es noch nicht drin ist."""
    oid = _oid(access)
    ticket = _visible(db, access, number)
    if _entry(db, oid, ticket) is None:
        db.add(TicketRecent(oid=oid, ticket_id=ticket.id, favorite=False, added_at=now_utc()))
        db.flush()
        _trim(db, access, oid, _prefs(db, oid).recent_limit)
    db.commit()
    return _out(db, access, oid)


@router.put("/{number}/favorit")
def favorite(body: FavoriteIn, access: AccessDep, db: DbDep, number: int = NumberPath) -> RecentOut:
    oid = _oid(access)
    ticket = _visible(db, access, number)
    entry = _entry(db, oid, ticket)
    if entry is None:
        entry = TicketRecent(oid=oid, ticket_id=ticket.id, added_at=now_utc())
        db.add(entry)
    entry.favorite = body.favorite
    db.flush()
    _trim(db, access, oid, _prefs(db, oid).recent_limit)
    db.commit()
    return _out(db, access, oid)


@router.delete("/{number}")
def remove(access: AccessDep, db: DbDep, number: int = NumberPath) -> RecentOut:
    """Aus der Leiste nehmen (auch Favoriten). Unbekannte Nummern ändern nichts."""
    oid = _oid(access)
    ticket = db.scalar(select(Ticket).where(Ticket.number == number))
    if ticket is not None:
        db.execute(
            delete(TicketRecent).where(TicketRecent.oid == oid, TicketRecent.ticket_id == ticket.id)
        )
        db.commit()
    return _out(db, access, oid)


@router.delete("")
def clear(access: AccessDep, db: DbDep) -> RecentOut:
    """„Liste leeren“: alle Tickets ohne Stern."""
    oid = _oid(access)
    db.execute(
        delete(TicketRecent).where(TicketRecent.oid == oid, TicketRecent.favorite.is_(False))
    )
    db.commit()
    return _out(db, access, oid)


@router.put("/einstellungen")
def save_prefs(body: PrefsIn, access: AccessDep, db: DbDep) -> RecentOut:
    """Höchstzahl und Ansicht (Konto). Weniger als vorher kürzt die Liste sofort."""
    oid = _oid(access)
    prefs = db.get(TicketNavPrefs, oid)
    if prefs is None:
        prefs = TicketNavPrefs(oid=oid)
        db.add(prefs)
    prefs.recent_limit = body.limit
    prefs.compact = body.compact
    db.flush()
    _trim(db, access, oid, body.limit)
    db.commit()
    return _out(db, access, oid)
