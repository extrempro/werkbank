"""Verwaltung, Seite Berechtigungen: Bereichsrechte je Person (spec.md, Kapitel 6.1a).

Nur für Mitglieder der Admin-Gruppe und nur kurz nach einer Anmeldung (Step-up). Die
Verwaltung selbst lässt sich hier nicht vergeben; sie kommt aus der Admin-Gruppe in Entra.
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from werkbank.core.audit import write_audit
from werkbank.core.avatar import avatar_etags, avatar_url
from werkbank.core.deps import DbDep, SettingsDep, require_recent_login
from werkbank.core.models import User
from werkbank.core.permissions import (
    AREA_BY_KEY,
    AREAS,
    levels_from_roles,
    roles_from_levels,
    set_permissions,
)
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc

router = APIRouter(prefix="/api/admin/permissions")

AdminUser = Annotated[CurrentUser, Depends(require_recent_login(Role.WERKBANK_ADMIN))]


class LevelOut(BaseModel):
    label: str


class AreaOut(BaseModel):
    key: str
    name: str
    hint: str
    levels: list[LevelOut]


class PersonOut(BaseModel):
    id: uuid.UUID
    display_name: str
    email: str | None
    avatar_url: str | None
    last_login_at: datetime | None
    is_admin: bool
    # Stufe je Bereich (nur Bereiche mit Zugriff)
    levels: dict[str, int]
    # Seit wann die Rechte in der Werkbank stehen; leer: Übernahme der App-Rollen steht aus
    permissions_since: datetime | None
    permissions_origin: str | None


class OverviewOut(BaseModel):
    groups_configured: bool
    areas: list[AreaOut]
    people: list[PersonOut]


def _person(user: User, etag: str | None) -> PersonOut:
    return PersonOut(
        id=user.id,
        display_name=user.display_name,
        email=user.email,
        avatar_url=avatar_url(user.id, etag),
        last_login_at=user.last_login_at,
        is_admin=user.is_admin,
        levels=levels_from_roles(user.permissions or []),
        permissions_since=user.permissions_since,
        permissions_origin=user.permissions_origin,
    )


@router.get("")
def overview(_: AdminUser, db: DbDep, settings: SettingsDep) -> OverviewOut:
    """Bereiche mit ihren Stufen und alle Personen, die die Werkbank kennt."""
    people = db.scalars(select(User).order_by(User.display_name, User.id)).all()
    etags = avatar_etags(db, [person.id for person in people])
    return OverviewOut(
        groups_configured=settings.entra_groups_configured,
        areas=[
            AreaOut(
                key=area.key,
                name=area.name,
                hint=area.hint,
                levels=[LevelOut(label=level.label) for level in area.levels],
            )
            for area in AREAS
        ],
        people=[_person(person, etags.get(person.id)) for person in people],
    )


class PermissionsIn(BaseModel):
    levels: dict[str, int] = Field(max_length=len(AREAS))


def _audit_levels(levels: dict[str, int]) -> dict[str, str]:
    return {
        AREA_BY_KEY[key].name: AREA_BY_KEY[key].levels[index].label
        for key, index in levels.items()
        if index > 0
    }


@router.put("/{user_id}")
def update(
    user_id: uuid.UUID, body: PermissionsIn, user: AdminUser, db: DbDep, request: Request
) -> PersonOut:
    """Setzt die Stufen einer Person. Fehlende Bereiche heißen „Kein Zugriff“. Wirkt sofort."""
    person = db.get(User, user_id)
    if person is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Diese Person gibt es nicht.")
    for key, index in body.levels.items():
        area = AREA_BY_KEY.get(key)
        if area is None or not 0 <= index < len(area.levels):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Unbekannte Stufe.")
    before = levels_from_roles(person.permissions or [])
    set_permissions(person, roles_from_levels(body.levels))
    after = levels_from_roles(person.permissions)
    if person.permissions_since is None:
        # Ab jetzt zählt die Verwaltung; die App-Rollen werden nicht mehr übernommen
        person.permissions_since = now_utc()
        person.permissions_origin = "verwaltung"
    write_audit(
        db,
        module="kern",
        action="berechtigungen.geaendert",
        user_id=user.user_id,
        object_type="person",
        object_id=str(person.id),
        ip=request.client.host if request.client else None,
        details={
            "person": person.display_name,
            "vorher": _audit_levels(before),
            "nachher": _audit_levels(after),
        },
    )
    db.commit()
    return _person(person, avatar_etags(db, [person.id]).get(person.id))


class CandidateOut(BaseModel):
    oid: str
    display_name: str
    email: str
    department: str


def _lookup_unavailable() -> HTTPException:
    return HTTPException(
        status.HTTP_409_CONFLICT,
        "Die Suche in Entra ist nicht eingerichtet. Die Person erscheint nach ihrer ersten "
        "Anmeldung in der Liste.",
    )


@router.get("/candidates")
def candidates(
    _: AdminUser, db: DbDep, settings: SettingsDep, q: Annotated[str, Query(max_length=60)] = ""
) -> list[CandidateOut]:
    """Personen aus Entra, die die Werkbank noch nicht kennt (Suche ab zwei Zeichen)."""
    from werkbank.modules.inventory.people import PeopleError, graph_people_finder

    if len(q.strip()) < 2:
        return []
    try:
        found = graph_people_finder(settings)(q)
    except PeopleError:
        raise _lookup_unavailable() from None
    known = set(db.scalars(select(User.entra_oid)).all())
    return [
        CandidateOut(
            oid=person.oid,
            display_name=person.name,
            email=person.mail or person.upn,
            department=person.department,
        )
        for person in found
        if person.enabled and person.oid not in known
    ]


class AddIn(BaseModel):
    oid: str = Field(pattern=r"^[0-9a-fA-F-]{36}$")


@router.post("/people", status_code=status.HTTP_201_CREATED)
def add_person(
    body: AddIn, user: AdminUser, db: DbDep, settings: SettingsDep, request: Request
) -> PersonOut:
    """Nimmt eine Person aus Entra auf, bevor sie sich das erste Mal anmeldet (ohne Rechte)."""
    from werkbank.modules.inventory.people import PeopleError, graph_person_lookup

    oid = body.oid.lower()
    if db.execute(select(User).where(User.entra_oid == oid)).scalar_one_or_none() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Diese Person steht schon in der Liste.")
    try:
        found = graph_person_lookup(settings)(oid)
    except PeopleError:
        raise _lookup_unavailable() from None
    if found is None or not found.enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Diese Person gibt es in Entra nicht.")
    person = User(
        entra_oid=oid,
        display_name=found.name or found.upn,
        email=(found.mail or found.upn) or None,
        permissions=[],
        last_roles=[],
        permissions_since=now_utc(),
        permissions_origin="verwaltung",
    )
    db.add(person)
    db.flush()
    write_audit(
        db,
        module="kern",
        action="berechtigungen.person_aufgenommen",
        user_id=user.user_id,
        object_type="person",
        object_id=str(person.id),
        ip=request.client.host if request.client else None,
        details={"person": person.display_name},
    )
    db.commit()
    return _person(person, None)
