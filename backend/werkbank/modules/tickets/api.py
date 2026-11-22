"""API des Moduls Tickets: Liste, Anlegen, Ticketseite, Status und Zuständigkeit, Notizen.

Jede Abfrage ist auf die Bereiche der Person beschränkt (serverseitig). Tickets aus fremden
Bereichen gibt es für sie nicht: 404 statt 403 (spec.md 8e, „Sichtbarkeit“).
"""

import re
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Path, Query, status
from pydantic import AfterValidator, BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from werkbank.core.admin_settings import ADDRESS_PATTERN
from werkbank.core.deps import DbDep
from werkbank.core.sessions import now_utc
from werkbank.modules.inventory.search import escape_like
from werkbank.modules.tickets.access import (
    AccessDep,
    TicketAccess,
    area_people,
    forbidden,
    not_found,
)
from werkbank.modules.tickets.models import (
    AREA_ADMIN,
    AREA_EDIT,
    ENTRY_INBOUND,
    ENTRY_NOTE,
    OPEN_STATUSES,
    STATUS_CLOSED,
    STATUS_IN_PROGRESS,
    STATUS_SOLVED,
    STATUS_WAITING,
    Ticket,
    TicketArea,
    TicketEntry,
    TicketParticipant,
)
from werkbank.modules.tickets.service import (
    PRIORITY_LABELS,
    STATUS_LABELS,
    Actor,
    assign_new,
    protocol,
    set_status,
    system_entry,
)

router = APIRouter(prefix="/api/tickets")

TicketNumber = Annotated[int, Path(ge=1, le=1_000_000_000_000)]
PAGE_SIZE = 50
BODY_MAX = 20_000
PARTICIPANTS_MAX = 20
# Status, die man im Ticketkopf von Hand wählen kann (Erinnerung folgt in Phase 3)
SETTABLE_STATUSES = (STATUS_IN_PROGRESS, STATUS_WAITING, STATUS_SOLVED, STATUS_CLOSED)
_NUMBER = re.compile(r"^\s*(?:t-?)?(\d{1,12})\s*$", re.IGNORECASE)


def _mail(value: str) -> str:
    value = value.strip().lower()
    if not ADDRESS_PATTERN.match(value):
        raise ValueError("Bitte eine gültige Mailadresse angeben.")
    return value


Mail = Annotated[str, Field(max_length=320), AfterValidator(_mail)]
Priority = Literal["low", "medium", "high"]
View = Literal["open", "mine", "unassigned", "waiting", "reminder", "done", "all"]


def actor(access: TicketAccess) -> Actor:
    return Actor(oid=access.oid, name=access.user.display_name)


# --- Ausgaben ------------------------------------------------------------------------------


class AreaRef(BaseModel):
    id: int
    name: str
    role: str | None = None


class MeOut(BaseModel):
    manager: bool
    settings: bool
    areas: list[AreaRef]


class TicketItem(BaseModel):
    number: int
    subject: str
    area: AreaRef
    status: str
    priority: str
    assignee_oid: str | None
    assignee_name: str
    reporter_name: str
    channel: str
    created_at: datetime
    updated_at: datetime


class TicketListOut(BaseModel):
    items: list[TicketItem]
    total: int
    has_more: bool


class ParticipantOut(BaseModel):
    name: str
    mail: str


class EntryOut(BaseModel):
    id: str
    kind: str
    body: str
    author_name: str
    original: bool
    created_at: datetime


class PersonOut(BaseModel):
    oid: str
    name: str


class PermissionsOut(BaseModel):
    edit: bool
    note: bool
    # Darf jede Zuständigkeit ändern (Bereichsverwaltung)
    assign_any: bool
    move: bool


class TicketOut(TicketItem):
    reporter_mail: str
    created_by: str
    participants: list[ParticipantOut]
    entries: list[EntryOut]
    permissions: PermissionsOut
    assignees: list[PersonOut]
    move_targets: list[AreaRef]


def _area_names(db: Session) -> dict[int, str]:
    return dict(db.execute(select(TicketArea.id, TicketArea.name)).tuples().all())


def _item(ticket: Ticket, names: dict[int, str], access: TicketAccess) -> TicketItem:
    return TicketItem(
        number=ticket.number,
        subject=ticket.subject,
        area=AreaRef(
            id=ticket.area_id, name=names.get(ticket.area_id, ""), role=access.role(ticket.area_id)
        ),
        status=ticket.status,
        priority=ticket.priority,
        assignee_oid=ticket.assignee_oid,
        assignee_name=ticket.assignee_name,
        reporter_name=ticket.reporter_name,
        channel=ticket.channel,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
    )


def _visible_ticket(db: Session, access: TicketAccess, number: int) -> Ticket:
    ticket = db.scalar(select(Ticket).where(Ticket.number == number))
    if ticket is None or not access.can_read(ticket.area_id):
        raise not_found()
    return ticket


def _detail(db: Session, access: TicketAccess, ticket: Ticket) -> TicketOut:
    names = _area_names(db)
    item = _item(ticket, names, access)
    entries = db.scalars(
        select(TicketEntry)
        .where(TicketEntry.ticket_id == ticket.id)
        .order_by(TicketEntry.original.desc(), TicketEntry.created_at, TicketEntry.id)
    ).all()
    participants = db.scalars(
        select(TicketParticipant)
        .where(TicketParticipant.ticket_id == ticket.id)
        .order_by(TicketParticipant.id)
    ).all()
    can_edit = access.can_edit(ticket.area_id)
    assignees = [PersonOut(oid=m.oid, name=m.name) for m, _ in area_people(db, ticket.area_id)]
    if ticket.assignee_oid and all(p.oid != ticket.assignee_oid for p in assignees):
        assignees.append(PersonOut(oid=ticket.assignee_oid, name=ticket.assignee_name))
    active = db.scalars(
        select(TicketArea).where(TicketArea.active.is_(True)).order_by(TicketArea.name)
    ).all()
    return TicketOut(
        **item.model_dump(),
        reporter_mail=ticket.reporter_mail,
        created_by=ticket.created_by,
        participants=[ParticipantOut(name=p.name, mail=p.mail) for p in participants],
        entries=[
            EntryOut(
                id=str(e.id),
                kind=e.kind,
                body=e.body,
                author_name=e.author_name,
                original=e.original,
                created_at=e.created_at,
            )
            for e in entries
        ],
        permissions=PermissionsOut(
            edit=can_edit,
            note=access.can_read(ticket.area_id),
            assign_any=access.is_area_admin(ticket.area_id),
            move=can_edit,
        ),
        assignees=assignees,
        move_targets=[
            AreaRef(id=a.id, name=a.name, role=access.role(a.id))
            for a in active
            if a.id != ticket.area_id
        ],
    )


# --- Endpunkte -----------------------------------------------------------------------------


@router.get("/me")
def me(access: AccessDep, db: DbDep) -> MeOut:
    """Eigene Rechte im Modul: Bereiche mit Rolle, Ticket-Verwaltung, Einstellungen sichtbar."""
    names = _area_names(db)
    return MeOut(
        manager=access.manager,
        settings=access.settings_visible,
        areas=[
            AreaRef(id=a, name=names.get(a, ""), role=access.role(a)) for a in access.visible_areas
        ],
    )


def _conditions(access: TicketAccess, view: View, area: int | None, q: str) -> list[Any]:
    areas = access.visible_areas
    if area is not None:
        areas = [a for a in areas if a == area]
    where: list[Any] = [Ticket.area_id.in_(areas)]
    if view == "open":
        where.append(Ticket.status.in_(OPEN_STATUSES))
    elif view == "mine":
        where += [Ticket.assignee_oid == access.oid, Ticket.status.in_(OPEN_STATUSES)]
    elif view == "unassigned":
        where += [Ticket.assignee_oid.is_(None), Ticket.status.in_(OPEN_STATUSES)]
    elif view == "waiting":
        where.append(Ticket.status == STATUS_WAITING)
    elif view == "reminder":
        where.append(Ticket.status == "reminder")
    elif view == "done":
        where.append(Ticket.status.in_((STATUS_SOLVED, STATUS_CLOSED)))
    text = q.strip()
    if text:
        number = _NUMBER.match(text)
        pattern = f"%{escape_like(text)}%"
        matches: list[Any] = [
            Ticket.subject.ilike(pattern, escape="\\"),
            Ticket.reporter_name.ilike(pattern, escape="\\"),
            Ticket.reporter_mail.ilike(pattern, escape="\\"),
        ]
        if number:
            matches.append(Ticket.number == int(number.group(1)))
        where.append(or_(*matches))
    return where


@router.get("")
def list_tickets(
    access: AccessDep,
    db: DbDep,
    view: View = "open",
    area: Annotated[int | None, Query(ge=1, le=2_000_000_000)] = None,
    q: Annotated[str, Query(max_length=100)] = "",
    offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
) -> TicketListOut:
    """Tickets der eigenen Bereiche, zuletzt geändert zuerst."""
    if not access.visible_areas:
        return TicketListOut(items=[], total=0, has_more=False)
    where = _conditions(access, view, area, q)
    total = db.scalar(select(func.count()).select_from(Ticket).where(*where)) or 0
    rows = db.scalars(
        select(Ticket)
        .where(*where)
        .order_by(Ticket.updated_at.desc(), Ticket.number.desc())
        .offset(offset)
        .limit(PAGE_SIZE)
    ).all()
    names = _area_names(db)
    return TicketListOut(
        items=[_item(t, names, access) for t in rows],
        total=total,
        has_more=offset + len(rows) < total,
    )


class ParticipantIn(BaseModel):
    name: str = Field(default="", max_length=200)
    mail: Mail

    @field_validator("name")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class TicketIn(BaseModel):
    area_id: int = Field(ge=1, le=2_000_000_000)
    subject: str = Field(min_length=1, max_length=250)
    reporter_name: str = Field(min_length=1, max_length=200)
    reporter_mail: Mail | None = None
    priority: Priority = "medium"
    channel: Literal["manual", "phone"] = "manual"
    body: str = Field(min_length=1, max_length=BODY_MAX)
    participants: list[ParticipantIn] = Field(default_factory=list, max_length=PARTICIPANTS_MAX)
    assign_to_me: bool = False

    @field_validator("subject", "reporter_name", "body")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Darf nicht leer sein.")
        return value


def _set_participants(db: Session, ticket: Ticket, participants: list[ParticipantIn]) -> None:
    seen: set[str] = set()
    for p in participants:
        mail = str(p.mail).lower()
        if mail in seen or mail == ticket.reporter_mail.lower():
            continue
        seen.add(mail)
        db.add(TicketParticipant(ticket_id=ticket.id, name=p.name, mail=mail))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_ticket(body: TicketIn, access: AccessDep, db: DbDep) -> TicketOut:
    """Ticket von Hand erfassen (Bearbeiten oder Bereichsverwaltung im gewählten Bereich)."""
    area = db.get(TicketArea, body.area_id)
    if area is None or not area.active or not access.can_read(area.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bereich nicht gefunden.")
    if not access.can_edit(area.id):
        raise forbidden("Mit „Nur lesen“ kannst du keine Tickets anlegen.")
    me_actor = actor(access)
    ticket = Ticket(
        area_id=area.id,
        subject=body.subject,
        reporter_name=body.reporter_name,
        reporter_mail=str(body.reporter_mail or "").lower(),
        priority=body.priority,
        channel=body.channel,
        created_by=me_actor.name,
    )
    db.add(ticket)
    db.flush()
    db.refresh(ticket)
    db.add(
        TicketEntry(
            ticket_id=ticket.id,
            kind=ENTRY_INBOUND,
            body=body.body,
            author_oid=me_actor.oid,
            author_name=me_actor.name,
            original=True,
        )
    )
    _set_participants(db, ticket, body.participants)
    if body.assign_to_me:
        ticket.assignee_oid = access.oid
        ticket.assignee_name = me_actor.name
        system_entry(db, ticket, f"Zuständig: {me_actor.name}", me_actor)
    else:
        assign_new(db, ticket, area)
    protocol(db, me_actor, "ticket_angelegt", ticket=ticket, details={"eingang": body.channel})
    db.commit()
    return _detail(db, access, ticket)


@router.get("/{number}")
def read_ticket(number: TicketNumber, access: AccessDep, db: DbDep) -> TicketOut:
    return _detail(db, access, _visible_ticket(db, access, number))


class ChangeIn(BaseModel):
    """Status und Zuständigkeit; gelten erst nach „Bestätigen“ in der Oberfläche.

    expected_*: Stand, den die Oberfläche angezeigt hat (Schutz vor gleichzeitigen Änderungen).
    assignee_oid: leer = niemand zuständig. Nicht gesetzt = unverändert.
    """

    expected_status: str = Field(max_length=20)
    expected_assignee_oid: str | None = Field(default=None, max_length=64)
    status: str | None = Field(default=None, max_length=20)
    change_assignee: bool = False
    assignee_oid: str | None = Field(default=None, max_length=64)
    handover_note: str = Field(default="", max_length=BODY_MAX)


@router.patch("/{number}")
def change_ticket(number: TicketNumber, body: ChangeIn, access: AccessDep, db: DbDep) -> TicketOut:
    """Status und/oder Zuständigkeit ändern (mit Prüfung der Rechte)."""
    ticket = _visible_ticket(db, access, number)
    if not access.can_edit(ticket.area_id):
        raise forbidden("Mit „Nur lesen“ kannst du Status und Zuständigkeit nicht ändern.")
    if ticket.status != body.expected_status or (ticket.assignee_oid or None) != (
        body.expected_assignee_oid or None
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Das Ticket wurde inzwischen geändert. Lade es neu und prüfe die Angaben.",
        )
    me_actor = actor(access)
    changed = False
    if body.status is not None and body.status != ticket.status:
        if body.status not in SETTABLE_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Diesen Status kannst du hier nicht setzen.",
            )
        if ticket.status == "merged":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ein zusammengeführtes Ticket lässt sich nicht mehr ändern.",
            )
        old = ticket.status
        set_status(ticket, body.status)
        system_entry(
            db, ticket, f"Status: {STATUS_LABELS[old]} → {STATUS_LABELS[body.status]}", me_actor
        )
        protocol(
            db, me_actor, "ticket_status", ticket=ticket, details={"von": old, "nach": body.status}
        )
        changed = True
    if body.change_assignee:
        new_oid = (body.assignee_oid or "").lower() or None
        if new_oid != ticket.assignee_oid:
            _check_handover(db, access, ticket, new_oid)
            old_name = ticket.assignee_name or "niemand"
            if new_oid is None:
                new_name = ""
            elif new_oid == access.oid:
                new_name = me_actor.name
            else:
                new_name = next(
                    m.name for m, _ in area_people(db, ticket.area_id) if m.oid == new_oid
                )
            ticket.assignee_oid = new_oid
            ticket.assignee_name = new_name
            ticket.updated_at = now_utc()
            system_entry(db, ticket, f"Zuständig: {old_name} → {new_name or 'niemand'}", me_actor)
            protocol(
                db,
                me_actor,
                "ticket_zustaendig",
                ticket=ticket,
                details={"zugewiesen": new_oid is not None},
            )
            note = body.handover_note.strip()
            if note:
                db.add(
                    TicketEntry(
                        ticket_id=ticket.id,
                        kind=ENTRY_NOTE,
                        body=note,
                        author_oid=access.oid,
                        author_name=me_actor.name,
                    )
                )
            changed = True
    if changed:
        db.commit()
        db.refresh(ticket)
    return _detail(db, access, ticket)


def _check_handover(db: Session, access: TicketAccess, ticket: Ticket, new_oid: str | None) -> None:
    """Wer darf die Zuständigkeit wie ändern (spec.md 8e)?

    - Bereichsverwaltung: jede Änderung.
    - Bearbeiten: ein freies Ticket sich selbst nehmen; ein eigenes Ticket übergeben oder freigeben.
    Neue zuständige Person muss im Bereich bearbeiten dürfen.
    """
    if new_oid is not None:
        allowed = {m.oid for m, _ in area_people(db, ticket.area_id, (AREA_ADMIN, AREA_EDIT))}
        if new_oid != access.oid and new_oid not in allowed:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Diese Person kann im Bereich keine Tickets bearbeiten.",
            )
    if access.is_area_admin(ticket.area_id):
        return
    if ticket.assignee_oid is None and new_oid == access.oid:
        return
    if ticket.assignee_oid == access.oid:
        return
    raise forbidden("Übergeben darf nur die zuständige Person oder die Bereichsverwaltung.")


class DetailsIn(BaseModel):
    priority: Priority
    participants: list[ParticipantIn] = Field(default_factory=list, max_length=PARTICIPANTS_MAX)


@router.put("/{number}/details")
def change_details(
    number: TicketNumber, body: DetailsIn, access: AccessDep, db: DbDep
) -> TicketOut:
    """Priorität und Beteiligte."""
    ticket = _visible_ticket(db, access, number)
    if not access.can_edit(ticket.area_id):
        raise forbidden("Mit „Nur lesen“ kannst du die Angaben nicht ändern.")
    me_actor = actor(access)
    if body.priority != ticket.priority:
        system_entry(
            db,
            ticket,
            f"Priorität: {PRIORITY_LABELS[ticket.priority]} → {PRIORITY_LABELS[body.priority]}",
            me_actor,
        )
        ticket.priority = body.priority
    db.query(TicketParticipant).filter(TicketParticipant.ticket_id == ticket.id).delete()
    _set_participants(db, ticket, body.participants)
    ticket.updated_at = now_utc()
    db.commit()
    db.refresh(ticket)
    return _detail(db, access, ticket)


class MoveIn(BaseModel):
    area_id: int = Field(ge=1, le=2_000_000_000)


class MoveOut(BaseModel):
    visible: bool
    ticket: TicketOut | None


@router.post("/{number}/move")
def move_ticket(number: TicketNumber, body: MoveIn, access: AccessDep, db: DbDep) -> MoveOut:
    """In einen anderen Bereich verschieben. Wer das Ziel nicht sieht, verliert den Zugriff."""
    ticket = _visible_ticket(db, access, number)
    if not access.can_edit(ticket.area_id):
        raise forbidden("Mit „Nur lesen“ kannst du Tickets nicht verschieben.")
    target = db.get(TicketArea, body.area_id)
    if target is None or not target.active or target.id == ticket.area_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Diesen Bereich gibt es nicht."
        )
    me_actor = actor(access)
    names = _area_names(db)
    old_area = ticket.area_id
    ticket.area_id = target.id
    ticket.assignee_oid = None
    ticket.assignee_name = ""
    ticket.updated_at = now_utc()
    system_entry(db, ticket, f"Verschoben: {names.get(old_area, '')} → {target.name}", me_actor)
    protocol(
        db,
        me_actor,
        "ticket_verschoben",
        ticket=ticket,
        details={"von": old_area, "nach": target.id},
    )
    db.flush()
    assign_new(db, ticket, target)
    db.commit()
    db.refresh(ticket)
    if not access.can_read(target.id):
        return MoveOut(visible=False, ticket=None)
    return MoveOut(visible=True, ticket=_detail(db, access, ticket))


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=BODY_MAX)

    @field_validator("body")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Darf nicht leer sein.")
        return value


@router.post("/{number}/notes", status_code=status.HTTP_201_CREATED)
def add_note(number: TicketNumber, body: NoteIn, access: AccessDep, db: DbDep) -> TicketOut:
    """Interne Notiz (auch mit „Nur lesen“). Der Melder sieht sie nicht und bekommt keine Mail."""
    ticket = _visible_ticket(db, access, number)
    db.add(
        TicketEntry(
            ticket_id=ticket.id,
            kind=ENTRY_NOTE,
            body=body.body,
            author_oid=access.oid,
            author_name=access.user.display_name,
        )
    )
    ticket.updated_at = now_utc()
    db.commit()
    db.refresh(ticket)
    return _detail(db, access, ticket)
