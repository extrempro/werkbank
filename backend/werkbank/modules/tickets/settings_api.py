"""Einstellungen des Moduls Tickets: Bereiche und Rollen je Bereich (spec.md 8e).

- Ticket-Verwaltung (App-Rolle `Tickets.Verwaltung`): Bereiche anlegen und ändern, Postfach,
  alle Rollen vergeben, auch die Bereichsverwaltung. Kein Zugriff auf Tickets.
- Bereichsverwaltung: im eigenen Bereich „Bearbeiten“ vergeben, Zuweisungsart.
- Jeder Bereich behält mindestens einen Eintrag mit Bereichsverwaltung.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from werkbank.core.deps import DbDep, SettingsDep, check_recent_login
from werkbank.modules.inventory.people import PeopleError, PeopleFinder, get_people_finder
from werkbank.modules.tickets.access import (
    AccessDep,
    GroupSourceDep,
    GroupSourceError,
    TicketAccess,
    forbidden,
    forget_membership,
    valid_oid,
)
from werkbank.modules.tickets.api import Mail, actor
from werkbank.modules.tickets.models import (
    AREA_ADMIN,
    TicketArea,
    TicketAreaGrant,
    TicketAudit,
    TicketGroupMember,
)
from werkbank.modules.tickets.service import protocol
from werkbank.worker.jobs import enqueue

router = APIRouter(prefix="/api/tickets/settings")

AreaId = Annotated[int, Path(ge=1, le=2_000_000_000)]
GROUP_SYNC = "tickets.gruppen"


class GrantOut(BaseModel):
    id: int
    role: str
    kind: str
    oid: str
    name: str
    mail: str
    # Zahl der Mitglieder aus dem letzten Abgleich (nur bei Gruppen)
    members: int | None


class AreaOut(BaseModel):
    id: int
    name: str
    mailbox: str
    assignment: str
    active: bool
    # Darf die Person hier Bereichsverwaltung vergeben, Name und Postfach ändern?
    manage: bool
    grants: list[GrantOut]


class SettingsOut(BaseModel):
    manager: bool
    areas: list[AreaOut]


def _require_settings(access: TicketAccess) -> None:
    if not access.settings_visible:
        raise forbidden("Keine Berechtigung für die Einstellungen der Tickets.")


def _area_for_settings(db: Session, access: TicketAccess, area_id: int) -> TicketArea:
    area = db.get(TicketArea, area_id)
    if area is None or not (access.manager or access.is_area_admin(area_id)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bereich nicht gefunden.")
    return area


def _grants(db: Session, area_id: int) -> list[GrantOut]:
    grants = db.scalars(
        select(TicketAreaGrant)
        .where(TicketAreaGrant.area_id == area_id)
        .order_by(TicketAreaGrant.role, TicketAreaGrant.kind, TicketAreaGrant.name)
    ).all()
    out: list[GrantOut] = []
    for g in grants:
        members = None
        if g.kind == "group":
            members = len(
                db.scalars(
                    select(TicketGroupMember.oid).where(TicketGroupMember.group_oid == g.oid)
                ).all()
            )
        out.append(
            GrantOut(
                id=g.id,
                role=g.role,
                kind=g.kind,
                oid=g.oid,
                name=g.name,
                mail=g.mail,
                members=members,
            )
        )
    return out


def _area_out(db: Session, access: TicketAccess, area: TicketArea) -> AreaOut:
    return AreaOut(
        id=area.id,
        name=area.name,
        mailbox=area.mailbox,
        assignment=area.assignment,
        active=area.active,
        manage=access.manager,
        grants=_grants(db, area.id),
    )


@router.get("")
def read_settings(access: AccessDep, db: DbDep) -> SettingsOut:
    """Bereiche, die die Person einstellen darf (Ticket-Verwaltung: alle)."""
    _require_settings(access)
    query = select(TicketArea).order_by(TicketArea.name)
    if not access.manager:
        query = query.where(TicketArea.id.in_(access.admin_areas))
    areas = db.scalars(query).all()
    return SettingsOut(manager=access.manager, areas=[_area_out(db, access, a) for a in areas])


class GrantIn(BaseModel):
    role: Literal["admin", "edit"]
    kind: Literal["group", "person"]
    oid: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=256)
    mail: Mail | Literal[""] = ""

    @field_validator("oid")
    @classmethod
    def _lower(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("name")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class AreaIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    mailbox: Mail | Literal[""] = ""
    active: bool = True

    @field_validator("name")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Darf nicht leer sein.")
        return value


class NewAreaIn(AreaIn):
    # Erste Bereichsverwaltung (Pflicht: jeder Bereich braucht mindestens eine)
    admin: GrantIn


def _check_grant(body: GrantIn, settings_ok: bool) -> None:
    if not settings_ok:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Unbekannte Kennung aus Entra.",
        )
    if body.kind == "group" and body.mail:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Gruppen haben hier keine Mailadresse.",
        )


def _add_grant(db: Session, area: TicketArea, body: GrantIn) -> TicketAreaGrant:
    grant = TicketAreaGrant(
        area_id=area.id,
        role=body.role,
        kind=body.kind,
        oid=body.oid,
        name=body.name,
        mail=body.mail,
    )
    db.add(grant)
    return grant


def _unique_name(db: Session, name: str, area_id: int | None = None) -> None:
    query = select(TicketArea.id).where(TicketArea.name.ilike(name))
    if area_id is not None:
        query = query.where(TicketArea.id != area_id)
    if db.scalar(query) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Einen Bereich mit diesem Namen gibt es schon.",
        )


@router.post("/areas", status_code=status.HTTP_201_CREATED)
def create_area(body: NewAreaIn, access: AccessDep, db: DbDep, settings: SettingsDep) -> AreaOut:
    """Bereich anlegen (nur Ticket-Verwaltung), mit erster Bereichsverwaltung."""
    if not access.manager:
        raise forbidden("Bereiche legt nur die Ticket-Verwaltung an.")
    # Vergibt die erste Bereichsverwaltung: nur mit frischer Anmeldung
    check_recent_login(access.user, settings)
    if body.admin.role != AREA_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Der erste Eintrag muss die Bereichsverwaltung sein.",
        )
    _check_grant(body.admin, valid_oid(body.admin.oid, settings))
    _unique_name(db, body.name)
    area = TicketArea(name=body.name, mailbox=body.mailbox, active=body.active)
    db.add(area)
    db.flush()
    _add_grant(db, area, body.admin)
    who = actor(access)
    protocol(db, who, "bereich_angelegt", area_id=area.id, details={"name": area.name})
    protocol(
        db,
        who,
        "rolle_vergeben",
        area_id=area.id,
        details={"rolle": AREA_ADMIN, "art": body.admin.kind, "name": body.admin.name},
    )
    if body.admin.kind == "group":
        enqueue(db, GROUP_SYNC)
    db.commit()
    return _area_out(db, access, area)


@router.put("/areas/{area_id}")
def update_area(area_id: AreaId, body: AreaIn, access: AccessDep, db: DbDep) -> AreaOut:
    """Name, Postfach und aktiv (nur Ticket-Verwaltung)."""
    area = _area_for_settings(db, access, area_id)
    if not access.manager:
        raise forbidden("Name und Postfach ändert nur die Ticket-Verwaltung.")
    _unique_name(db, body.name, area.id)
    changes: dict[str, object] = {}
    for field in ("name", "mailbox", "active"):
        new = getattr(body, field)
        if getattr(area, field) != new:
            changes[field] = new
            setattr(area, field, new)
    if changes:
        protocol(db, actor(access), "bereich_geaendert", area_id=area.id, details=changes)
        db.commit()
    return _area_out(db, access, area)


class AssignmentIn(BaseModel):
    assignment: Literal["first", "round_robin"]


@router.put("/areas/{area_id}/assignment")
def update_assignment(area_id: AreaId, body: AssignmentIn, access: AccessDep, db: DbDep) -> AreaOut:
    """Zuweisung neuer Tickets (Bereichsverwaltung oder Ticket-Verwaltung)."""
    area = _area_for_settings(db, access, area_id)
    if area.assignment != body.assignment:
        protocol(
            db,
            actor(access),
            "bereich_zuweisung",
            area_id=area.id,
            details={"von": area.assignment, "nach": body.assignment},
        )
        area.assignment = body.assignment
        db.commit()
    return _area_out(db, access, area)


@router.post("/areas/{area_id}/grants", status_code=status.HTTP_201_CREATED)
def add_grant(
    area_id: AreaId, body: GrantIn, access: AccessDep, db: DbDep, settings: SettingsDep
) -> AreaOut:
    """Rolle vergeben. Bereichsverwaltung vergibt nur die Ticket-Verwaltung."""
    area = _area_for_settings(db, access, area_id)
    if body.role == AREA_ADMIN and not access.manager:
        raise forbidden("Die Bereichsverwaltung vergibt nur die Ticket-Verwaltung.")
    # Rechte vergeben: nur mit frischer Anmeldung (wie in der Verwaltung)
    check_recent_login(access.user, settings)
    _check_grant(body, valid_oid(body.oid, settings))
    _add_grant(db, area, body)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Diesen Eintrag gibt es schon."
        ) from exc
    protocol(
        db,
        actor(access),
        "rolle_vergeben",
        area_id=area.id,
        details={"rolle": body.role, "art": body.kind, "name": body.name},
    )
    if body.kind == "group":
        enqueue(db, GROUP_SYNC)
    db.commit()
    return _area_out(db, access, area)


@router.delete("/areas/{area_id}/grants/{grant_id}")
def remove_grant(
    area_id: AreaId,
    grant_id: Annotated[int, Path(ge=1, le=2_000_000_000)],
    access: AccessDep,
    db: DbDep,
    settings: SettingsDep,
) -> AreaOut:
    """Rolle entziehen; der letzte Eintrag der Bereichsverwaltung bleibt."""
    area = _area_for_settings(db, access, area_id)
    check_recent_login(access.user, settings)
    grant = db.get(TicketAreaGrant, grant_id)
    if grant is None or grant.area_id != area.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Eintrag nicht gefunden.")
    if grant.role == AREA_ADMIN:
        if not access.manager:
            raise forbidden("Die Bereichsverwaltung entzieht nur die Ticket-Verwaltung.")
        admins = db.scalars(
            select(TicketAreaGrant.id).where(
                TicketAreaGrant.area_id == area.id, TicketAreaGrant.role == AREA_ADMIN
            )
        ).all()
        if len(admins) <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Jeder Bereich braucht mindestens einen Eintrag mit Bereichsverwaltung.",
            )
    protocol(
        db,
        actor(access),
        "rolle_entzogen",
        area_id=area.id,
        details={"rolle": grant.role, "art": grant.kind, "name": grant.name},
    )
    db.delete(grant)
    db.commit()
    return _area_out(db, access, area)


class FoundOut(BaseModel):
    oid: str
    name: str
    mail: str = ""
    detail: str = ""


@router.get("/groups")
def search_groups(
    access: AccessDep, source: GroupSourceDep, q: Annotated[str, Query(max_length=60)] = ""
) -> list[FoundOut]:
    """Entra-Gruppen suchen (für Rollen je Bereich)."""
    _require_settings(access)
    try:
        return [FoundOut(oid=g.oid, name=g.name) for g in source.search_groups(q)]
    except GroupSourceError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc


@router.get("/people")
def search_people(
    access: AccessDep,
    settings: SettingsDep,
    q: Annotated[str, Query(max_length=60)] = "",
) -> list[FoundOut]:
    """Personen in Entra suchen (für einzelne Einträge)."""
    _require_settings(access)
    finder: PeopleFinder = get_people_finder(settings)
    try:
        people = finder(q)
    except PeopleError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    return [
        FoundOut(oid=p.oid, name=p.name, mail=p.mail, detail=p.department or p.upn)
        for p in people
        if p.enabled
    ]


class ProtocolOut(BaseModel):
    occurred_at: str
    actor_name: str
    area_id: int | None
    action: str
    ticket_number: int | None
    details: dict[str, object]


@router.get("/protocol")
def read_protocol(
    access: AccessDep,
    db: DbDep,
    area: Annotated[int | None, Query(ge=1, le=2_000_000_000)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> list[ProtocolOut]:
    """Protokoll der Einstellungen und Abläufe (Bereichsverwaltung: nur eigene Bereiche)."""
    _require_settings(access)
    query = select(TicketAudit).order_by(TicketAudit.id.desc()).limit(limit)
    if not access.manager:
        query = query.where(TicketAudit.area_id.in_(access.admin_areas))
    if area is not None:
        query = query.where(TicketAudit.area_id == area)
    return [
        ProtocolOut(
            occurred_at=row.occurred_at.isoformat(),
            actor_name=row.actor_name,
            area_id=row.area_id,
            action=row.action,
            ticket_number=row.ticket_number,
            details=row.details,
        )
        for row in db.scalars(query)
    ]


# --- nur für automatische Tests -------------------------------------------------------------


class TestMembershipIn(BaseModel):
    group_oid: str = Field(min_length=1, max_length=64)
    oid: str = Field(min_length=1, max_length=64)
    name: str = Field(default="", max_length=256)
    mail: str = Field(default="", max_length=320)
    member: bool = True


test_router = APIRouter(prefix="/api/tickets/test")


@test_router.post("/membership")
def test_membership(body: TestMembershipIn, db: DbDep, settings: SettingsDep) -> dict[str, bool]:
    """Gruppenmitgliedschaft der Testquelle setzen oder entfernen. In Produktion 404."""
    if not settings.enable_test_login or settings.environment not in ("test", "development"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    from werkbank.core.sessions import now_utc

    db.execute(
        delete(TicketGroupMember).where(
            TicketGroupMember.group_oid == body.group_oid, TicketGroupMember.oid == body.oid
        )
    )
    if body.member:
        db.add(
            TicketGroupMember(
                group_oid=body.group_oid,
                oid=body.oid,
                name=body.name,
                mail=body.mail,
                synced_at=now_utc(),
            )
        )
    # wie nach Ablauf des Zwischenspeichers
    forget_membership(db, body.oid)
    db.commit()
    return {"ok": True}
