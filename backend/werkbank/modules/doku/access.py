"""Rechte in der Dokumentation (spec.md 8f, „Rechte“).

- App-Rollen: `Doku.Nutzer` öffnet den Bereich, `Doku.Admin` verwaltet Arbeitsbereiche,
  Einstellungen und Papierkorb. Inhalte sieht auch Doku.Admin nur als Mitglied.
- Arbeitsbereich: Mitglieder mit Lesen, Bearbeiten oder Verwalten (Verwalten = Bearbeiten und
  Mitglieder des Arbeitsbereichs ändern).
- Seite: ohne eigene Rechte gilt der Arbeitsbereich; mit eigenen Rechten (Schloss) gelten diese
  für die Seite und ihre Unterseiten. Je Person überschreibt ein Eintrag das Recht aus dem
  Arbeitsbereich, „Kein Zugriff“ nimmt die Seite weg; Personen ohne Eintrag behalten das Recht
  aus dem Arbeitsbereich.
- Archivierte Arbeitsbereiche sind höchstens lesbar.
- Fremde oder nicht sichtbare Seiten ergeben 404.
"""

import uuid
from dataclasses import dataclass, field
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.core.deps import CurrentUserDep, DbDep
from werkbank.core.models import User
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser
from werkbank.modules.doku.models import (
    ROLE_EDIT,
    ROLE_MANAGE,
    ROLE_NONE,
    ROLE_READ,
    DokuPage,
    DokuPageRight,
    DokuSpace,
    DokuSpaceMember,
)

LEVEL = {ROLE_NONE: 0, ROLE_READ: 1, ROLE_EDIT: 2, ROLE_MANAGE: 3}


def not_found(what: str = "Seite") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{what} nicht gefunden")


def forbidden(detail: str = "Keine Berechtigung") -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


@dataclass
class DokuAccess:
    """Angemeldete Person mit ihren Rollen in den Arbeitsbereichen."""

    user: CurrentUser
    oid: str
    # Arbeitsbereich → Rolle der Person
    spaces: dict[int, str]
    archived: set[int]
    # Arbeitsbereiche, in denen die Person nicht Mitglied ist, aber eigene Rechte an Seiten hat
    guest: set[int] = field(default_factory=set)

    @property
    def space_ids(self) -> set[int]:
        return set(self.spaces) | self.guest

    @property
    def is_admin(self) -> bool:
        return self.user.has_any_role(Role.DOKU_ADMIN)

    @property
    def name(self) -> str:
        return self.user.display_name

    def space_role(self, space_id: int) -> str:
        role = self.spaces.get(space_id, ROLE_NONE)
        if space_id in self.archived and LEVEL[role] > LEVEL[ROLE_READ]:
            return ROLE_READ
        return role


def user_oid(db: Session, user: CurrentUser) -> str:
    oid = db.scalar(select(User.entra_oid).where(User.id == user.user_id))
    return (oid or "").lower()


def load_access(db: Session, user: CurrentUser) -> DokuAccess:
    oid = user_oid(db, user)
    spaces: dict[int, str] = {}
    if oid and user.has_any_role(Role.DOKU_USER, Role.DOKU_ADMIN):
        for space_id, role in db.execute(
            select(DokuSpaceMember.space_id, DokuSpaceMember.role).where(DokuSpaceMember.oid == oid)
        ):
            spaces[space_id] = role
    guest: set[int] = set()
    if oid and user.has_any_role(Role.DOKU_USER, Role.DOKU_ADMIN):
        guest = set(
            db.scalars(
                select(DokuPage.space_id)
                .join(DokuPageRight, DokuPageRight.page_id == DokuPage.id)
                .where(
                    DokuPageRight.oid == oid,
                    DokuPageRight.role != ROLE_NONE,
                    DokuPage.own_rights.is_(True),
                    DokuPage.deleted_at.is_(None),
                )
            )
        ) - set(spaces)
    archived = set(db.scalars(select(DokuSpace.id).where(DokuSpace.archived.is_(True))))
    return DokuAccess(user=user, oid=oid, spaces=spaces, archived=archived, guest=guest)


def get_access(user: CurrentUserDep, db: DbDep) -> DokuAccess:
    if not user.has_any_role(Role.DOKU_USER, Role.DOKU_ADMIN):
        raise forbidden()
    return load_access(db, user)


AccessDep = Annotated[DokuAccess, Depends(get_access)]


def require_admin(access: AccessDep) -> DokuAccess:
    if not access.is_admin:
        raise forbidden()
    return access


AdminDep = Annotated[DokuAccess, Depends(require_admin)]


class RightsResolver:
    """Rechte vieler Seiten eines Arbeitsbereichs auf einmal (Seitenbaum, Suche)."""

    def __init__(self, db: Session, access: DokuAccess, pages: list[DokuPage]) -> None:
        self.access = access
        self.by_id = {page.id: page for page in pages}
        own = [page.id for page in pages if page.own_rights]
        self.rights: dict[uuid.UUID, dict[str, str]] = {pid: {} for pid in own}
        if own:
            for page_id, oid, role in db.execute(
                select(DokuPageRight.page_id, DokuPageRight.oid, DokuPageRight.role).where(
                    DokuPageRight.page_id.in_(own)
                )
            ):
                self.rights[page_id][oid] = role
        self._cache: dict[uuid.UUID, str] = {}

    def rights_source(self, page: DokuPage) -> DokuPage | None:
        """Nächste Seite (sie selbst oder darüber) mit eigenen Rechten."""
        current: DokuPage | None = page
        seen: set[uuid.UUID] = set()
        while current is not None and current.id not in seen:
            seen.add(current.id)
            if current.own_rights:
                return current
            current = self.by_id.get(current.parent_id) if current.parent_id else None
        return None

    def role(self, page: DokuPage) -> str:
        cached = self._cache.get(page.id)
        if cached is not None:
            return cached
        space_role = self.access.space_role(page.space_id)
        source = self.rights_source(page)
        role = space_role
        if source is not None:
            entry = self.rights.get(source.id, {}).get(self.access.oid)
            if entry is not None:
                role = entry
                if page.space_id in self.access.archived and LEVEL[role] > LEVEL[ROLE_READ]:
                    role = ROLE_READ
        # Verwalten betrifft nur den Arbeitsbereich; an der Seite zählt es wie Bearbeiten
        if role == ROLE_MANAGE:
            role = ROLE_EDIT
        self._cache[page.id] = role
        return role


def space_pages(db: Session, space_id: int) -> list[DokuPage]:
    """Alle nicht gelöschten Seiten eines Arbeitsbereichs (für Rechte und Baum)."""
    return list(
        db.scalars(
            select(DokuPage).where(DokuPage.space_id == space_id, DokuPage.deleted_at.is_(None))
        )
    )


def page_role(db: Session, access: DokuAccess, page: DokuPage) -> str:
    return RightsResolver(db, access, space_pages(db, page.space_id)).role(page)


def visible_page(
    db: Session, access: DokuAccess, page_id: uuid.UUID, *, write: bool = False
) -> tuple[DokuPage, str]:
    """Seite mit Rolle der Person; 404, wenn sie sie nicht sehen darf, 403 ohne Schreibrecht."""
    page = db.get(DokuPage, page_id)
    if page is None or page.deleted_at is not None:
        raise not_found()
    role = page_role(db, access, page)
    if LEVEL[role] < LEVEL[ROLE_READ]:
        raise not_found()
    if write and LEVEL[role] < LEVEL[ROLE_EDIT]:
        raise forbidden("Du darfst diese Seite nur lesen.")
    return page, role


def can_edit(role: str) -> bool:
    return LEVEL[role] >= LEVEL[ROLE_EDIT]


def access_for_oid(db: Session, oid: str) -> DokuAccess | None:
    """Rechte einer anderen Person (für Erwähnungen und Benachrichtigungen).

    None, wenn die Person die Werkbank nicht kennt oder die Dokumentation nicht nutzen darf.
    """
    from werkbank.core.permissions import effective_roles

    person = db.execute(select(User).where(User.entra_oid == oid)).scalar_one_or_none()
    if person is None:
        return None
    roles = tuple(effective_roles(person))
    if not any(role in roles for role in (Role.DOKU_USER, Role.DOKU_ADMIN)):
        return None
    now = person.last_login_at or person.created_at
    user = CurrentUser(
        user_id=person.id,
        session_id=uuid.UUID(int=0),
        display_name=person.display_name,
        email=person.email,
        roles=roles,
        authenticated_at=now,
        expires_at=now,
    )
    return load_access(db, user)


def can_read_page(db: Session, oid: str, page: DokuPage) -> bool:
    """Darf die Person (Objekt-ID) die Seite lesen?"""
    access = access_for_oid(db, oid)
    return access is not None and LEVEL[page_role(db, access, page)] >= LEVEL[ROLE_READ]
