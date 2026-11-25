"""Verwaltung der Dokumentation (nur Doku.Admin): Arbeitsbereiche, Seiten mit eigenen Rechten,
Versionen, Papierkorb. Inhalte der Seiten sieht die Verwaltung hier nicht, nur Titel."""

import uuid
from datetime import datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep, check_recent_login
from werkbank.modules.doku.access import AdminDep, DokuAccess, not_found
from werkbank.modules.doku.api import (
    MembersIn,
    PersonRight,
    PersonRightIn,
    _clean_line,
    _members,
    members_changed,
    replace_members,
)
from werkbank.modules.doku.collab import reset_space
from werkbank.modules.doku.models import DokuPage, DokuPageRight, DokuSpace, DokuSpaceMember
from werkbank.modules.doku.service import (
    TRASH_DAYS,
    DokuSettings,
    load_settings,
    restore,
    save_settings,
)

router = APIRouter(prefix="/api/doku/admin")


class SpaceOut(BaseModel):
    id: int
    name: str
    description: str
    archived: bool
    people: int
    pages: int
    own_rights: int
    updated_at: datetime
    members: list[PersonRight]


class SpaceIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    archived: bool = False
    members: list[PersonRightIn] = Field(default_factory=list, max_length=1000)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = _clean_line(value, "Name", 120)
        if not value:
            raise ValueError("Name fehlt.")
        return value

    @field_validator("description")
    @classmethod
    def _description(cls, value: str) -> str:
        return _clean_line(value, "Beschreibung", 500)

    @field_validator("members")
    @classmethod
    def _members(cls, value: list[PersonRightIn]) -> list[PersonRightIn]:
        return MembersIn(members=value).members


class OwnRightsPage(BaseModel):
    id: uuid.UUID
    title: str
    space: str
    # z. B. „2 Personen mit eigenem Recht, 1 ohne Zugriff“
    summary: str
    changed_by_name: str
    changed_at: datetime | None


class TrashItem(BaseModel):
    id: uuid.UUID
    title: str
    space: str
    pages: int
    deleted_by_name: str
    deleted_at: datetime
    purge_at: datetime


class SettingsOut(BaseModel):
    version_minutes: Literal[5, 10, 30]
    keep_auto: Literal["1y", "immer"]


def _audit(db: Session, access: DokuAccess, action: str, object_type: str, object_id: str) -> None:
    write_audit(
        db,
        module="doku",
        action=action,
        object_type=object_type,
        object_id=object_id,
        user_id=access.user.user_id,
    )


def _space_out(db: Session, space: DokuSpace) -> SpaceOut:
    members = _members(db, space.id)
    pages = db.scalar(
        select(func.count()).where(DokuPage.space_id == space.id, DokuPage.deleted_at.is_(None))
    )
    locked = db.scalar(
        select(func.count()).where(
            DokuPage.space_id == space.id,
            DokuPage.deleted_at.is_(None),
            DokuPage.own_rights.is_(True),
        )
    )
    last = db.scalar(select(func.max(DokuPage.updated_at)).where(DokuPage.space_id == space.id))
    return SpaceOut(
        id=space.id,
        name=space.name,
        description=space.description,
        archived=space.archived,
        people=len(members),
        pages=pages or 0,
        own_rights=locked or 0,
        updated_at=max(space.updated_at, last) if last else space.updated_at,
        members=members,
    )


def _name_taken(db: Session, name: str, space_id: int | None) -> None:
    query = select(DokuSpace.id).where(func.lower(DokuSpace.name) == name.lower())
    if space_id is not None:
        query = query.where(DokuSpace.id != space_id)
    if db.scalar(query) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ein Arbeitsbereich mit diesem Namen existiert schon.",
        )


@router.get("/spaces")
def list_spaces(access: AdminDep, db: DbDep) -> list[SpaceOut]:
    spaces = db.scalars(
        select(DokuSpace).order_by(DokuSpace.archived, func.lower(DokuSpace.name))
    ).all()
    return [_space_out(db, s) for s in spaces]


@router.post("/spaces", status_code=status.HTTP_201_CREATED)
def create_space(body: SpaceIn, access: AdminDep, db: DbDep, settings: SettingsDep) -> SpaceOut:
    if body.members:
        # Rechte vergeben: nur mit frischer Anmeldung
        check_recent_login(access.user, settings)
    _name_taken(db, body.name, None)
    space = DokuSpace(name=body.name, description=body.description, archived=body.archived)
    db.add(space)
    db.flush()
    replace_members(db, space, body.members)
    _audit(db, access, "arbeitsbereich_angelegt", "arbeitsbereich", str(space.id))
    db.commit()
    db.refresh(space)
    return _space_out(db, space)


@router.put("/spaces/{space_id}")
def update_space(
    space_id: Annotated[int, Path(ge=1)],
    body: SpaceIn,
    access: AdminDep,
    db: DbDep,
    settings: SettingsDep,
) -> SpaceOut:
    space = db.get(DokuSpace, space_id)
    if space is None:
        raise not_found("Arbeitsbereich")
    if members_changed(db, space.id, body.members):
        # Rechte vergeben: nur mit frischer Anmeldung; Name und Beschreibung gehen ohne
        check_recent_login(access.user, settings)
    _name_taken(db, body.name, space.id)
    space.name = body.name
    space.description = body.description
    space.archived = body.archived
    replace_members(db, space, body.members)
    _audit(db, access, "arbeitsbereich_geaendert", "arbeitsbereich", str(space.id))
    db.commit()
    reset_space(space.id)
    db.refresh(space)
    return _space_out(db, space)


@router.delete("/spaces/{space_id}")
def delete_space(
    space_id: Annotated[int, Path(ge=1)], access: AdminDep, db: DbDep
) -> dict[str, bool]:
    """Nur leere Arbeitsbereiche (auch ohne Seiten im Papierkorb) lassen sich löschen."""
    space = db.get(DokuSpace, space_id)
    if space is None:
        raise not_found("Arbeitsbereich")
    if db.scalar(select(DokuPage.id).where(DokuPage.space_id == space.id).limit(1)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Der Arbeitsbereich hat noch Seiten. Archiviere ihn stattdessen.",
        )
    db.query(DokuSpaceMember).filter(DokuSpaceMember.space_id == space.id).delete()
    db.delete(space)
    _audit(db, access, "arbeitsbereich_geloescht", "arbeitsbereich", str(space_id))
    db.commit()
    return {"ok": True}


@router.get("/own-rights")
def own_rights_pages(access: AdminDep, db: DbDep) -> list[OwnRightsPage]:
    """Alle Seiten, deren Rechte vom Arbeitsbereich abweichen, mit einer kurzen Beschreibung."""
    pages = db.scalars(
        select(DokuPage)
        .where(DokuPage.own_rights.is_(True), DokuPage.deleted_at.is_(None))
        .order_by(func.lower(DokuPage.title))
    ).all()
    names = dict(db.execute(select(DokuSpace.id, DokuSpace.name)).all())
    result: list[OwnRightsPage] = []
    for page in pages:
        rights = db.scalars(select(DokuPageRight).where(DokuPageRight.page_id == page.id)).all()
        counts = {"read": 0, "edit": 0, "none": 0}
        for right in rights:
            counts[right.role] = counts.get(right.role, 0) + 1
        parts = []
        if counts["edit"]:
            parts.append(f"{counts['edit']} bearbeiten")
        if counts["read"]:
            parts.append(f"{counts['read']} lesen")
        if counts["none"]:
            parts.append(f"{counts['none']} ohne Zugriff")
        latest = max(rights, key=lambda r: r.changed_at, default=None)
        result.append(
            OwnRightsPage(
                id=page.id,
                title=page.title,
                space=names.get(page.space_id, ""),
                summary=", ".join(parts) or "wie der Arbeitsbereich",
                changed_by_name=latest.changed_by_name if latest else "",
                changed_at=latest.changed_at if latest else None,
            )
        )
    return result


@router.post("/pages/{page_id}/reset-rights")
def reset_rights(
    page_id: uuid.UUID, access: AdminDep, db: DbDep, settings: SettingsDep
) -> dict[str, bool]:
    """Eigene Rechte entfernen: Es gilt wieder der Arbeitsbereich (frische Anmeldung nötig)."""
    check_recent_login(access.user, settings)
    page = db.get(DokuPage, page_id)
    if page is None or page.deleted_at is not None:
        raise not_found()
    db.query(DokuPageRight).filter(DokuPageRight.page_id == page.id).delete()
    page.own_rights = False
    _audit(db, access, "rechte_zurueckgesetzt", "seite", str(page.id))
    db.commit()
    reset_space(page.space_id)
    return {"ok": True}


@router.get("/settings")
def read_settings(access: AdminDep, db: DbDep) -> SettingsOut:
    value = load_settings(db)
    return SettingsOut(version_minutes=value.version_minutes, keep_auto=value.keep_auto)  # type: ignore[arg-type]


@router.put("/settings")
def write_settings(body: SettingsOut, access: AdminDep, db: DbDep) -> SettingsOut:
    save_settings(
        db,
        DokuSettings(version_minutes=body.version_minutes, keep_auto=body.keep_auto),
        access.user.user_id,
    )
    _audit(db, access, "einstellungen_geaendert", "einstellungen", "doku")
    db.commit()
    return read_settings(access, db)


@router.get("/trash")
def list_trash(access: AdminDep, db: DbDep) -> list[TrashItem]:
    roots = db.scalars(
        select(DokuPage)
        .where(DokuPage.deleted_root.is_(True), DokuPage.deleted_at.is_not(None))
        .order_by(DokuPage.deleted_at.desc())
    ).all()
    names = dict(db.execute(select(DokuSpace.id, DokuSpace.name)).all())
    result: list[TrashItem] = []
    for page in roots:
        if page.deleted_at is None:
            continue
        count = db.scalar(
            select(func.count()).where(
                DokuPage.space_id == page.space_id, DokuPage.deleted_at == page.deleted_at
            )
        )
        result.append(
            TrashItem(
                id=page.id,
                title=page.title,
                space=names.get(page.space_id, ""),
                pages=count or 1,
                deleted_by_name=page.deleted_by_name,
                deleted_at=page.deleted_at,
                purge_at=page.deleted_at + timedelta(days=TRASH_DAYS),
            )
        )
    return result


def _trashed(db: Session, page_id: uuid.UUID) -> DokuPage:
    page = db.get(DokuPage, page_id)
    if page is None or not page.deleted_root or page.deleted_at is None:
        raise not_found()
    return page


@router.post("/trash/{page_id}/restore")
def restore_page(page_id: uuid.UUID, access: AdminDep, db: DbDep) -> dict[str, bool]:
    page = _trashed(db, page_id)
    restore(db, page)
    _audit(db, access, "seite_wiederhergestellt", "seite", str(page.id))
    db.commit()
    return {"ok": True}


@router.delete("/trash/{page_id}")
def purge_page(page_id: uuid.UUID, access: AdminDep, db: DbDep) -> dict[str, bool]:
    """Endgültig löschen, mit allen zusammen gelöschten Unterseiten und Versionen."""
    page = _trashed(db, page_id)
    db.delete(page)
    _audit(db, access, "seite_endgueltig_geloescht", "seite", str(page_id))
    db.commit()
    return {"ok": True}
