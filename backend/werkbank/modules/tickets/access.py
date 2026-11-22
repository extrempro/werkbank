"""Rechte im Modul Tickets (spec.md 8e, „Rollen“ und „Sichtbarkeit“).

- `Tickets.Verwaltung` ist eine App-Rolle und kommt aus der Sitzung (Claim `roles`).
- Die Rollen je Bereich liegen in der Datenbank (Gruppe oder Person, jeweils Objekt-ID).
  Ob eine Person in einer Gruppe ist, fragt die Werkbank über Microsoft Graph ab
  (`transitiveMemberOf`, also auch verschachtelte Gruppen) und merkt sich das Ergebnis einige
  Minuten. Der Gruppen-Claim im Token wird bewusst nicht verwendet (unvollständig ab 200 Gruppen).
- Deny by default: ohne Rolle kein Zugriff; ist Graph nicht erreichbar und der Zwischenspeicher
  abgelaufen, zählen nur die Einträge für einzelne Personen.
"""

import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Annotated, Any, Protocol

import httpx
from fastapi import Depends, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.deps import CurrentUserDep, DbDep, SettingsDep
from werkbank.core.models import User
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.m365_config.utcm import GRAPH_URL, UtcmClient, UtcmError
from werkbank.modules.tickets.models import (
    AREA_ADMIN,
    AREA_EDIT,
    AREA_READ,
    AREA_ROLES,
    TicketArea,
    TicketAreaGrant,
    TicketGroupMember,
    TicketMembershipCache,
)

logger = logging.getLogger(__name__)

HTTP_TIMEOUT_SECONDS = 15
MAX_GROUP_HITS = 15
_GUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
# Kennungen aus dem Test-Login (nur in den Umgebungen test und development)
_TEST_OID = re.compile(r"^test:[a-z0-9.-]{1,50}$")
_SEARCH_SPECIAL = re.compile(r'["\\]')


class GroupSourceError(RuntimeError):
    """Gruppen lassen sich gerade nicht abfragen (nicht eingerichtet oder Graph antwortet nicht)."""


@dataclass(frozen=True)
class Member:
    oid: str
    name: str
    mail: str


@dataclass(frozen=True)
class Group:
    oid: str
    name: str


class GroupSource(Protocol):
    """Woher die Werkbank Gruppenmitgliedschaften kennt (Graph oder Testquelle)."""

    def member_of(self, oid: str) -> set[str]: ...

    def members(self, group_oid: str) -> list[Member]: ...

    def search_groups(self, query: str) -> list[Group]: ...


def valid_oid(oid: str, settings: Settings) -> bool:
    """Objekt-ID aus Entra; in Testumgebungen auch Kennungen des Test-Logins."""
    if _GUID.match(oid):
        return True
    return settings.enable_test_login and bool(_TEST_OID.match(oid))


def _text(value: Any, limit: int) -> str:
    return value.strip()[:limit] if isinstance(value, str) else ""


class GraphGroups(UtcmClient):
    """Abfragen über Microsoft Graph mit der Collector-App (`GroupMember.Read.All`)."""

    def member_of(self, oid: str) -> set[str]:
        if not _GUID.match(oid):
            return set()
        items = self._pages(
            f"{GRAPH_URL}/users/{oid.lower()}/transitiveMemberOf/microsoft.graph.group",
            {"$select": "id", "$top": "999"},
        )
        return {i["id"].lower() for i in items if isinstance(i.get("id"), str)}

    def members(self, group_oid: str) -> list[Member]:
        if not _GUID.match(group_oid):
            return []
        items = self._pages(
            f"{GRAPH_URL}/groups/{group_oid.lower()}/transitiveMembers/microsoft.graph.user",
            {"$select": "id,displayName,mail,accountEnabled", "$top": "999", "$count": "true"},
        )
        return [
            Member(
                oid=i["id"].lower(),
                name=_text(i.get("displayName"), 256),
                mail=_text(i.get("mail"), 320),
            )
            for i in items
            if isinstance(i.get("id"), str)
            and _GUID.match(i["id"])
            and i.get("accountEnabled") is not False
        ]

    def search_groups(self, query: str) -> list[Group]:
        term = " ".join(_SEARCH_SPECIAL.sub(" ", query).split())[:60]
        if len(term) < 2:
            return []
        data = self._json(
            "GET",
            f"{GRAPH_URL}/groups",
            params={
                "$search": f'"displayName:{term}"',
                "$select": "id,displayName",
                "$orderby": "displayName",
                "$top": str(MAX_GROUP_HITS),
                "$count": "true",
            },
            headers={"ConsistencyLevel": "eventual"},
        )
        return [
            Group(oid=i["id"].lower(), name=_text(i.get("displayName"), 256))
            for i in data.get("value") or []
            if isinstance(i, dict) and isinstance(i.get("id"), str) and _GUID.match(i["id"])
        ]

    def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        # Abfragen mit Typ-Filter und $count verlangen ConsistencyLevel; schadet sonst nicht
        kwargs["headers"] = {"ConsistencyLevel": "eventual", **kwargs.get("headers", {})}
        return super()._request(method, url, **kwargs)


class _GraphSource:
    def __init__(self, settings: Settings) -> None:
        from werkbank.modules.inventory.people import _TOKENS, PeopleError, graph_people_finder

        try:
            graph_people_finder(settings)  # prüft die Einrichtung und legt das Token an
        except PeopleError as exc:
            raise GroupSourceError(str(exc)) from exc
        self._token = _TOKENS[id(settings)]

    def _call(self, method: str, *args: str) -> Any:
        try:
            with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False) as http:
                return getattr(GraphGroups(http, self._token), method)(*args)
        except UtcmError as exc:
            raise GroupSourceError(str(exc)) from exc

    def member_of(self, oid: str) -> set[str]:
        result: set[str] = self._call("member_of", oid)
        return result

    def members(self, group_oid: str) -> list[Member]:
        result: list[Member] = self._call("members", group_oid)
        return result

    def search_groups(self, query: str) -> list[Group]:
        result: list[Group] = self._call("search_groups", query)
        return result


class TestGroupSource:
    """Testquelle (nur mit Test-Login): Mitgliedschaften stehen in `ticket_group_members`.

    E2E-Tests pflegen sie über `/api/tickets/test/membership`. Der Abgleich liest dieselbe
    Tabelle, ändert also nichts.
    """

    def __init__(self, db: Session) -> None:
        self._db = db

    def member_of(self, oid: str) -> set[str]:
        rows = self._db.scalars(
            select(TicketGroupMember.group_oid).where(TicketGroupMember.oid == oid)
        )
        return set(rows)

    def members(self, group_oid: str) -> list[Member]:
        rows = self._db.scalars(
            select(TicketGroupMember).where(TicketGroupMember.group_oid == group_oid)
        )
        return [Member(oid=r.oid, name=r.name, mail=r.mail) for r in rows]

    def search_groups(self, query: str) -> list[Group]:
        term = query.strip().lower()
        oids = sorted(set(self._db.scalars(select(TicketGroupMember.group_oid))))
        return [Group(oid=o, name=o) for o in oids if term in o.lower()][:MAX_GROUP_HITS]


class _UnavailableSource:
    def __init__(self, reason: str) -> None:
        self._reason = reason

    def member_of(self, oid: str) -> set[str]:
        raise GroupSourceError(self._reason)

    def members(self, group_oid: str) -> list[Member]:
        raise GroupSourceError(self._reason)

    def search_groups(self, query: str) -> list[Group]:
        raise GroupSourceError(self._reason)


def group_source(db: Session, settings: Settings) -> GroupSource:
    """Graph über die Collector-App; mit Test-Login die Testquelle."""
    if settings.enable_test_login and settings.environment in ("test", "development"):
        return TestGroupSource(db)
    try:
        return _GraphSource(settings)
    except GroupSourceError as exc:
        return _UnavailableSource(str(exc))


def get_group_source(db: DbDep, settings: SettingsDep) -> GroupSource:
    """Abhängigkeit für die API; in Tests ersetzbar."""
    return group_source(db, settings)


GroupSourceDep = Annotated[GroupSource, Depends(get_group_source)]


def member_groups(db: Session, settings: Settings, source: GroupSource, oid: str) -> set[str]:
    """Gruppen der Person, höchstens TICKETS_MEMBERSHIP_CACHE_MINUTES alt.

    Ist Graph nicht erreichbar und der Zwischenspeicher abgelaufen: keine Gruppen (deny).
    """
    now = now_utc()
    cached = db.get(TicketMembershipCache, oid)
    max_age = timedelta(minutes=settings.tickets_membership_cache_minutes)
    if cached is not None and now - cached.checked_at < max_age:
        return set(cached.group_ids)
    try:
        groups = {g.lower() for g in source.member_of(oid)}
    except GroupSourceError as exc:
        logger.warning("Gruppen für eine Person nicht abfragbar: %s", exc)
        return set()
    if cached is None:
        db.add(TicketMembershipCache(oid=oid, group_ids=sorted(groups), checked_at=now))
    else:
        cached.group_ids = sorted(groups)
        cached.checked_at = now
    db.commit()
    return groups


def forget_membership(db: Session, oid: str | None = None) -> None:
    """Zwischenspeicher leeren (eine Person oder alle). Der Aufrufer entscheidet über das Commit."""
    query = delete(TicketMembershipCache)
    if oid is not None:
        query = query.where(TicketMembershipCache.oid == oid)
    db.execute(query)


def _strongest(roles: Iterable[str]) -> str | None:
    for role in AREA_ROLES:
        if role in roles:
            return role
    return None


def area_roles(db: Session, settings: Settings, source: GroupSource, oid: str) -> dict[int, str]:
    """Stärkste Rolle je aktivem Bereich für eine Person."""
    grants = db.scalars(
        select(TicketAreaGrant)
        .join(TicketArea, TicketArea.id == TicketAreaGrant.area_id)
        .where(TicketArea.active.is_(True))
    ).all()
    groups: set[str] = set()
    if any(g.kind == "group" for g in grants):
        groups = member_groups(db, settings, source, oid)
    found: dict[int, set[str]] = {}
    for grant in grants:
        hit = (grant.kind == "person" and grant.oid == oid) or (
            grant.kind == "group" and grant.oid.lower() in groups
        )
        if hit:
            found.setdefault(grant.area_id, set()).add(grant.role)
    result: dict[int, str] = {}
    for area_id, roles in found.items():
        best = _strongest(roles)
        if best is not None:
            result[area_id] = best
    return result


@dataclass
class TicketAccess:
    """Rechte der angemeldeten Person im Modul Tickets."""

    user: CurrentUser
    oid: str
    roles: dict[int, str] = field(default_factory=dict)

    @property
    def manager(self) -> bool:
        """App-Rolle Ticket-Verwaltung (gibt allein keinen Zugriff auf Tickets)."""
        return self.user.has_any_role(Role.TICKETS_MANAGER)

    def role(self, area_id: int) -> str | None:
        return self.roles.get(area_id)

    def can_read(self, area_id: int) -> bool:
        return area_id in self.roles

    def can_edit(self, area_id: int) -> bool:
        return self.roles.get(area_id) in (AREA_ADMIN, AREA_EDIT)

    def is_area_admin(self, area_id: int) -> bool:
        return self.roles.get(area_id) == AREA_ADMIN

    @property
    def visible_areas(self) -> list[int]:
        return sorted(self.roles)

    @property
    def admin_areas(self) -> list[int]:
        return sorted(a for a, r in self.roles.items() if r == AREA_ADMIN)

    @property
    def settings_visible(self) -> bool:
        return self.manager or bool(self.admin_areas)


def user_oid(db: Session, user: CurrentUser) -> str:
    oid = db.scalar(select(User.entra_oid).where(User.id == user.user_id))
    return (oid or "").lower()


def get_access(
    user: CurrentUserDep, db: DbDep, settings: SettingsDep, source: GroupSourceDep
) -> TicketAccess:
    oid = user_oid(db, user)
    return TicketAccess(
        user=user, oid=oid, roles=area_roles(db, settings, source, oid) if oid else {}
    )


AccessDep = Annotated[TicketAccess, Depends(get_access)]


def not_found() -> HTTPException:
    """Fremde oder unbekannte Tickets: immer „nicht gefunden“, nie „kein Zugriff“."""
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket nicht gefunden.")


def forbidden(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def area_people(
    db: Session, area_id: int, roles: tuple[str, ...] = (AREA_ADMIN, AREA_EDIT)
) -> list[tuple[Member, str]]:
    """Personen eines Bereichs mit ihrer stärksten Rolle (einzeln und aus Gruppen).

    Für Auswahllisten und „reihum“; maßgeblich für den Zugriff bleibt `area_roles`.
    """
    grants = db.scalars(select(TicketAreaGrant).where(TicketAreaGrant.area_id == area_id)).all()
    people: dict[str, tuple[Member, set[str]]] = {}
    group_roles: dict[str, set[str]] = {}
    for grant in grants:
        if grant.kind == "person":
            member = Member(oid=grant.oid, name=grant.name, mail=grant.mail)
            people.setdefault(grant.oid, (member, set()))[1].add(grant.role)
        else:
            group_roles.setdefault(grant.oid.lower(), set()).add(grant.role)
    if group_roles:
        rows = db.scalars(
            select(TicketGroupMember).where(TicketGroupMember.group_oid.in_(list(group_roles)))
        )
        for row in rows:
            entry = people.setdefault(
                row.oid, (Member(oid=row.oid, name=row.name, mail=row.mail), set())
            )
            entry[1].update(group_roles[row.group_oid])
    result: list[tuple[Member, str]] = []
    for member, member_roles in people.values():
        best = _strongest(member_roles)
        if best is not None and best in roles:
            result.append((member, best))
    return sorted(result, key=lambda item: item[0].name.lower())


__all__ = [
    "AREA_READ",
    "AccessDep",
    "GroupSource",
    "TicketAccess",
]
