"""Schnittstelle der Dokumentation für Mitglieder der Arbeitsbereiche (spec.md 8f)."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep, check_recent_login
from werkbank.core.sessions import now_utc
from werkbank.modules.doku.access import (
    LEVEL,
    AccessDep,
    DokuAccess,
    RightsResolver,
    can_edit,
    forbidden,
    not_found,
    space_pages,
    visible_page,
)
from werkbank.modules.doku.collab import reset_page, reset_space
from werkbank.modules.doku.content import TITLE_MAX, ContentError, clean_content, empty_doc
from werkbank.modules.doku.models import (
    PAGE_ROLES,
    ROLE_EDIT,
    ROLE_MANAGE,
    ROLE_READ,
    SPACE_ROLES,
    DokuPage,
    DokuPageRight,
    DokuSpace,
    DokuSpaceMember,
    DokuVersion,
)
from werkbank.modules.doku.service import (
    load_settings,
    next_position,
    record_edit,
    snapshot,
    subtree,
    trash,
)
from werkbank.modules.inventory.people import PeopleError, PeopleFinder, get_people_finder

router = APIRouter(prefix="/api/doku")

PageId = Annotated[uuid.UUID, Path()]
SEARCH_MAX = 30
VERSIONS_MAX = 200


def _clean_line(value: str, field: str, limit: int) -> str:
    value = " ".join(value.split())
    if any(ord(ch) < 32 for ch in value):
        raise ValueError(f"{field} enthält Steuerzeichen.")
    if len(value) > limit:
        raise ValueError(f"{field} ist zu lang.")
    return value


# --- Ausgaben -----------------------------------------------------------------------------


class SpaceRef(BaseModel):
    id: int
    name: str
    description: str
    role: str
    archived: bool


class MeOut(BaseModel):
    is_admin: bool
    spaces: list[SpaceRef]


class TreePage(BaseModel):
    id: uuid.UUID
    parent_id: uuid.UUID | None
    title: str
    position: int
    own_rights: bool
    locked: bool
    can_edit: bool


class TreeSpace(SpaceRef):
    pages: list[TreePage]


class Crumb(BaseModel):
    id: uuid.UUID
    title: str


class PageOut(BaseModel):
    id: uuid.UUID
    space_id: int
    space: str
    parent_id: uuid.UUID | None
    path: list[Crumb]
    title: str
    content: dict[str, Any]
    revision: int
    role: Literal["read", "edit"]
    can_manage_space: bool
    archived: bool
    locked: bool
    locked_by_name: str
    locked_at: datetime | None
    own_rights: bool
    # Seite, von der die eigenen Rechte kommen (sie selbst oder darüber); None: Arbeitsbereich
    rights_from: Crumb | None
    created_by_name: str
    created_at: datetime
    updated_by_name: str
    updated_at: datetime
    versions: int


class SearchHit(BaseModel):
    id: uuid.UUID
    title: str
    space: str
    snippet: str


class VersionOut(BaseModel):
    id: int
    created_at: datetime
    name: str
    authors: str
    note: str


class VersionDetail(VersionOut):
    title: str
    content: dict[str, Any]


class PersonRight(BaseModel):
    oid: str
    name: str
    role: str


class RightsOut(BaseModel):
    own_rights: bool
    # Eigene Rechte kommen von einer Seite darüber (dann hier nicht änderbar)
    inherited_from: Crumb | None
    entries: list[PersonRight]
    space_members: list[PersonRight]
    can_manage_space: bool


class PersonOut(BaseModel):
    oid: str
    name: str
    upn: str
    department: str


# --- Eingaben -----------------------------------------------------------------------------


class PageIn(BaseModel):
    space_id: int = Field(ge=1)
    parent_id: uuid.UUID | None = None
    title: str = Field(min_length=1, max_length=TITLE_MAX)

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        value = _clean_line(value, "Titel", TITLE_MAX)
        if not value:
            raise ValueError("Titel fehlt.")
        return value


class SaveIn(BaseModel):
    title: str = Field(min_length=1, max_length=TITLE_MAX)
    # Ohne Inhalt: nur den Titel ändern (der Inhalt läuft über die Live-Bearbeitung)
    content: dict[str, Any] | None = None
    # Stand, auf dem der Inhalt beruht; passt er nicht, hat jemand anderes gespeichert (409)
    revision: int = Field(ge=1)

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        value = _clean_line(value, "Titel", TITLE_MAX)
        if not value:
            raise ValueError("Titel fehlt.")
        return value


class MoveIn(BaseModel):
    parent_id: uuid.UUID | None = None
    # Vor diese Seite einsortieren; None: ans Ende
    before_id: uuid.UUID | None = None


class VersionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = _clean_line(value, "Name", 120)
        if not value:
            raise ValueError("Name fehlt.")
        return value


class RestoreIn(BaseModel):
    reason: str = Field(default="", max_length=200)

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        return _clean_line(value, "Grund", 200)


class PersonRightIn(BaseModel):
    oid: str = Field(min_length=1, max_length=64)
    name: str = Field(default="", max_length=256)
    role: str

    @field_validator("oid")
    @classmethod
    def _oid(cls, value: str) -> str:
        return _clean_line(value, "Kennung", 64).lower()

    @field_validator("name")
    @classmethod
    def _person(cls, value: str) -> str:
        return _clean_line(value, "Name", 256)


class PageRightsIn(BaseModel):
    own_rights: bool
    entries: list[PersonRightIn] = Field(default_factory=list, max_length=500)

    @field_validator("entries")
    @classmethod
    def _entries(cls, value: list[PersonRightIn]) -> list[PersonRightIn]:
        if any(entry.role not in PAGE_ROLES for entry in value):
            raise ValueError("Unbekanntes Recht.")
        if len({entry.oid for entry in value}) != len(value):
            raise ValueError("Eine Person steht doppelt in der Liste.")
        return value


class MembersIn(BaseModel):
    members: list[PersonRightIn] = Field(max_length=1000)

    @field_validator("members")
    @classmethod
    def _members(cls, value: list[PersonRightIn]) -> list[PersonRightIn]:
        if any(entry.role not in SPACE_ROLES for entry in value):
            raise ValueError("Unbekannte Rolle.")
        if len({entry.oid for entry in value}) != len(value):
            raise ValueError("Eine Person steht doppelt in der Liste.")
        return value


# --- Hilfen -------------------------------------------------------------------------------


def _space_ref(space: DokuSpace, role: str) -> SpaceRef:
    return SpaceRef(
        id=space.id,
        name=space.name,
        description=space.description,
        role=role,
        archived=space.archived,
    )


def _my_spaces(db: Session, access: DokuAccess) -> list[DokuSpace]:
    if not access.space_ids:
        return []
    return list(
        db.scalars(
            select(DokuSpace)
            .where(DokuSpace.id.in_(list(access.space_ids)))
            .order_by(DokuSpace.archived, func.lower(DokuSpace.name))
        )
    )


def _path(db: Session, page: DokuPage) -> list[Crumb]:
    crumbs: list[Crumb] = []
    seen = {page.id}
    current = db.get(DokuPage, page.parent_id) if page.parent_id else None
    while current is not None and current.id not in seen and len(crumbs) < 50:
        seen.add(current.id)
        crumbs.append(Crumb(id=current.id, title=current.title))
        current = db.get(DokuPage, current.parent_id) if current.parent_id else None
    return list(reversed(crumbs))


def _page_out(db: Session, access: DokuAccess, page: DokuPage, role: str) -> PageOut:
    space = db.get(DokuSpace, page.space_id)
    if space is None:
        raise not_found()
    resolver = RightsResolver(db, access, space_pages(db, page.space_id))
    source = resolver.rights_source(page)
    versions = db.scalar(select(func.count()).where(DokuVersion.page_id == page.id)) or 0
    return PageOut(
        id=page.id,
        space_id=page.space_id,
        space=space.name,
        parent_id=page.parent_id,
        path=_path(db, page),
        title=page.title,
        content=page.content,
        revision=page.revision,
        role="edit" if can_edit(role) else "read",
        can_manage_space=access.space_role(page.space_id) == ROLE_MANAGE,
        archived=space.archived,
        locked=page.locked_at is not None,
        locked_by_name=page.locked_by_name,
        locked_at=page.locked_at,
        own_rights=page.own_rights,
        rights_from=Crumb(id=source.id, title=source.title) if source is not None else None,
        created_by_name=page.created_by_name,
        created_at=page.created_at,
        updated_by_name=page.updated_by_name,
        updated_at=page.updated_at,
        versions=versions,
    )


def _audit(
    db: Session, access: DokuAccess, action: str, object_id: str, details: dict[str, Any] | None
) -> None:
    write_audit(
        db,
        module="doku",
        action=action,
        object_type="seite",
        object_id=object_id,
        user_id=access.user.user_id,
        details=details,
    )


def _writable(page: DokuPage) -> None:
    if page.locked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Die Seite ist gesperrt ({page.locked_by_name or 'unbekannt'}).",
        )


# --- Lesen --------------------------------------------------------------------------------


@router.get("/me")
def me(access: AccessDep, db: DbDep) -> MeOut:
    return MeOut(
        is_admin=access.is_admin,
        spaces=[_space_ref(s, access.space_role(s.id)) for s in _my_spaces(db, access)],
    )


@router.get("/tree")
def tree(access: AccessDep, db: DbDep) -> list[TreeSpace]:
    """Seitenbaum: alle Arbeitsbereiche der Person mit den Seiten, die sie sehen darf.

    Ist eine Seite darüber nicht sichtbar, hängt die Seite oben im Arbeitsbereich.
    """
    result: list[TreeSpace] = []
    for space in _my_spaces(db, access):
        pages = space_pages(db, space.id)
        resolver = RightsResolver(db, access, pages)
        visible = {p.id: p for p in pages if LEVEL[resolver.role(p)] >= LEVEL[ROLE_READ]}
        items = [
            TreePage(
                id=p.id,
                parent_id=p.parent_id if p.parent_id in visible else None,
                title=p.title,
                position=p.position,
                own_rights=p.own_rights,
                locked=p.locked_at is not None,
                can_edit=can_edit(resolver.role(p)),
            )
            for p in sorted(visible.values(), key=lambda p: (p.position, p.title.lower()))
        ]
        result.append(
            TreeSpace(**_space_ref(space, access.space_role(space.id)).model_dump(), pages=items)
        )
    return result


@router.get("/search")
def search(
    access: AccessDep, db: DbDep, q: Annotated[str, Query(min_length=2, max_length=100)]
) -> list[SearchHit]:
    """Seiten nach Titel und Text, nur aus den eigenen Arbeitsbereichen und nur sichtbare."""
    if not access.space_ids:
        return []
    term = f"%{q.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')}%"
    rows = db.scalars(
        select(DokuPage)
        .where(
            DokuPage.space_id.in_(list(access.space_ids)),
            DokuPage.deleted_at.is_(None),
            or_(DokuPage.title.ilike(term, escape="\\"), DokuPage.text.ilike(term, escape="\\")),
        )
        .order_by(DokuPage.updated_at.desc())
        .limit(200)
    ).all()
    names = {s.id: s.name for s in _my_spaces(db, access)}
    resolvers: dict[int, RightsResolver] = {}
    hits: list[SearchHit] = []
    needle = q.strip().lower()
    for page in rows:
        resolver = resolvers.get(page.space_id)
        if resolver is None:
            resolver = RightsResolver(db, access, space_pages(db, page.space_id))
            resolvers[page.space_id] = resolver
        if LEVEL[resolver.role(page)] < LEVEL[ROLE_READ]:
            continue
        index = page.text.lower().find(needle)
        snippet = page.text[max(index - 60, 0) : index + 100] if index >= 0 else page.text[:160]
        hits.append(
            SearchHit(
                id=page.id, title=page.title, space=names.get(page.space_id, ""), snippet=snippet
            )
        )
        if len(hits) >= SEARCH_MAX:
            break
    return hits


@router.get("/pages/{page_id}")
def read_page(page_id: PageId, access: AccessDep, db: DbDep) -> PageOut:
    page, role = visible_page(db, access, page_id)
    return _page_out(db, access, page, role)


# --- Seiten anlegen, speichern, verschieben, löschen ---------------------------------------


@router.post("/pages", status_code=status.HTTP_201_CREATED)
def create_page(body: PageIn, access: AccessDep, db: DbDep) -> PageOut:
    space = db.get(DokuSpace, body.space_id)
    if space is None or space.id not in access.space_ids:
        raise not_found("Arbeitsbereich")
    if body.parent_id is not None:
        parent, _ = visible_page(db, access, body.parent_id, write=True)
        if parent.space_id != space.id:
            raise not_found()
    elif not can_edit(access.space_role(space.id)):
        raise forbidden("Du darfst in diesem Arbeitsbereich nur lesen.")
    now = now_utc()
    page = DokuPage(
        space_id=space.id,
        parent_id=body.parent_id,
        position=next_position(db, space.id, body.parent_id),
        title=body.title,
        content=empty_doc(),
        text="",
        created_by_name=access.name,
        created_at=now,
        updated_by_name=access.name,
        updated_at=now,
    )
    db.add(page)
    db.flush()
    _audit(db, access, "seite_angelegt", str(page.id), {"arbeitsbereich": space.id})
    db.commit()
    db.refresh(page)
    page_out, role = visible_page(db, access, page.id)
    return _page_out(db, access, page_out, role)


@router.put("/pages/{page_id}")
def save_page(page_id: PageId, body: SaveIn, access: AccessDep, db: DbDep) -> PageOut:
    """Titel speichern; mit Inhalt auch den ganzen Inhalt (dann laden alle, die die Seite live
    offen haben, neu). Nach der eingestellten Bearbeitungszeit entsteht eine Version."""
    page, role = visible_page(db, access, page_id, write=True)
    _writable(page)
    if body.content is None:
        if body.title != page.title:
            page.title = body.title
            record_edit(db, page, access.name, load_settings(db))
            db.commit()
            db.refresh(page)
        return _page_out(db, access, page, role)
    if body.revision != page.revision:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Jemand anderes hat die Seite inzwischen geändert. Lade sie neu.",
        )
    try:
        content, text = clean_content(body.content)
    except ContentError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
        ) from exc
    if content == page.content and body.title == page.title:
        return _page_out(db, access, page, role)
    reset_page(page.id, persist=False)
    page.title = body.title
    page.content = content
    page.text = text
    page.ystate = None
    record_edit(db, page, access.name, load_settings(db))
    db.commit()
    reset_page(page.id, persist=False)
    db.refresh(page)
    return _page_out(db, access, page, role)


@router.post("/pages/{page_id}/move")
def move_page(page_id: PageId, body: MoveIn, access: AccessDep, db: DbDep) -> PageOut:
    """Seite unter eine andere Seite (oder nach oben) im selben Arbeitsbereich schieben."""
    page, role = visible_page(db, access, page_id, write=True)
    _writable(page)
    if body.parent_id is not None:
        parent, _ = visible_page(db, access, body.parent_id, write=True)
        if parent.space_id != page.space_id:
            raise not_found()
        if parent.id in {p.id for p in subtree(db, page)}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Eine Seite lässt sich nicht unter sich selbst schieben.",
            )
    elif not can_edit(access.space_role(page.space_id)):
        raise forbidden("Oben im Arbeitsbereich darfst du keine Seiten ablegen.")
    siblings = [
        p
        for p in space_pages(db, page.space_id)
        if p.parent_id == body.parent_id and p.id != page.id
    ]
    siblings.sort(key=lambda p: (p.position, p.title.lower()))
    index = next((i for i, p in enumerate(siblings) if p.id == body.before_id), len(siblings))
    siblings.insert(index, page)
    for position, entry in enumerate(siblings, start=1):
        entry.position = position
    page.parent_id = body.parent_id
    db.commit()
    db.refresh(page)
    return _page_out(db, access, page, role)


@router.delete("/pages/{page_id}")
def delete_page(page_id: PageId, access: AccessDep, db: DbDep) -> dict[str, bool]:
    """In den Papierkorb, mit allen Unterseiten (30 Tage wiederherstellbar)."""
    page, _ = visible_page(db, access, page_id, write=True)
    _writable(page)
    ids = [entry.id for entry in subtree(db, page)]
    count = trash(db, page, access.name)
    _audit(db, access, "seite_geloescht", str(page.id), {"seiten": count})
    db.commit()
    for entry_id in ids:
        reset_page(entry_id, persist=False)
    return {"ok": True}


@router.post("/pages/{page_id}/lock")
def lock_page(page_id: PageId, access: AccessDep, db: DbDep) -> PageOut:
    """Sperren: Niemand kann die Seite ändern, bis jemand mit Bearbeiten sie entsperrt."""
    page, role = visible_page(db, access, page_id, write=True)
    if page.locked_at is None:
        page.locked_at = now_utc()
        page.locked_by_name = access.name
        _audit(db, access, "seite_gesperrt", str(page.id), None)
        db.commit()
        reset_page(page.id, persist=True)
        db.refresh(page)
    return _page_out(db, access, page, role)


@router.delete("/pages/{page_id}/lock")
def unlock_page(page_id: PageId, access: AccessDep, db: DbDep) -> PageOut:
    page, role = visible_page(db, access, page_id, write=True)
    if page.locked_at is not None:
        page.locked_at = None
        page.locked_by_name = ""
        _audit(db, access, "seite_entsperrt", str(page.id), None)
        db.commit()
        reset_page(page.id, persist=True)
        db.refresh(page)
    return _page_out(db, access, page, role)


# --- Versionen ----------------------------------------------------------------------------


@router.get("/pages/{page_id}/versions")
def list_versions(page_id: PageId, access: AccessDep, db: DbDep) -> list[VersionOut]:
    page, _ = visible_page(db, access, page_id)
    rows = db.scalars(
        select(DokuVersion)
        .where(DokuVersion.page_id == page.id)
        .order_by(DokuVersion.created_at.desc(), DokuVersion.id.desc())
        .limit(VERSIONS_MAX)
    ).all()
    return [
        VersionOut(id=v.id, created_at=v.created_at, name=v.name, authors=v.authors, note=v.note)
        for v in rows
    ]


def _version(db: Session, page: DokuPage, version_id: int) -> DokuVersion:
    version = db.get(DokuVersion, version_id)
    if version is None or version.page_id != page.id:
        raise not_found("Version")
    return version


@router.get("/pages/{page_id}/versions/{version_id}")
def read_version(
    page_id: PageId, version_id: Annotated[int, Path(ge=1)], access: AccessDep, db: DbDep
) -> VersionDetail:
    page, _ = visible_page(db, access, page_id)
    v = _version(db, page, version_id)
    return VersionDetail(
        id=v.id,
        created_at=v.created_at,
        name=v.name,
        authors=v.authors,
        note=v.note,
        title=v.title,
        content=v.content,
    )


@router.post("/pages/{page_id}/versions", status_code=status.HTTP_201_CREATED)
def name_version(page_id: PageId, body: VersionIn, access: AccessDep, db: DbDep) -> VersionOut:
    """Aktuellen Stand benennen (benannte Versionen bleiben immer)."""
    page, _ = visible_page(db, access, page_id, write=True)
    v = snapshot(db, page, name=body.name, authors=page.editors or access.name)
    db.commit()
    db.refresh(v)
    return VersionOut(id=v.id, created_at=v.created_at, name=v.name, authors=v.authors, note=v.note)


@router.post("/pages/{page_id}/versions/{version_id}/restore")
def restore_version(
    page_id: PageId,
    version_id: Annotated[int, Path(ge=1)],
    body: RestoreIn,
    access: AccessDep,
    db: DbDep,
) -> PageOut:
    """Alten Stand zurückholen. Der Stand davor wird vorher als Version gesichert."""
    page, role = visible_page(db, access, page_id, write=True)
    _writable(page)
    v = _version(db, page, version_id)
    stamp = v.created_at.strftime("%d.%m.%Y %H:%M")
    # Offene Live-Änderungen erst speichern, damit sie in der Sicherung davor stehen
    reset_page(page.id, persist=True)
    db.refresh(page)
    snapshot(db, page, note="Stand vor dem Wiederherstellen")
    page.title = v.title
    page.content = v.content
    page.ystate = None
    _, page.text = clean_content(v.content)
    record_edit(db, page, access.name, load_settings(db))
    note = f"Wiederhergestellt: Stand vom {stamp}" + (
        f". Grund: {body.reason}" if body.reason else ""
    )
    snapshot(db, page, note=note[:300], authors=access.name)
    _audit(db, access, "version_wiederhergestellt", str(page.id), {"version": v.id})
    db.commit()
    reset_page(page.id, persist=False)
    db.refresh(page)
    return _page_out(db, access, page, role)


# --- Rechte -------------------------------------------------------------------------------


def _members(db: Session, space_id: int) -> list[PersonRight]:
    return [
        PersonRight(oid=m.oid, name=m.name, role=m.role)
        for m in db.scalars(
            select(DokuSpaceMember)
            .where(DokuSpaceMember.space_id == space_id)
            .order_by(func.lower(DokuSpaceMember.name))
        )
    ]


@router.get("/pages/{page_id}/rights")
def read_rights(page_id: PageId, access: AccessDep, db: DbDep) -> RightsOut:
    page, _ = visible_page(db, access, page_id)
    resolver = RightsResolver(db, access, space_pages(db, page.space_id))
    source = resolver.rights_source(page)
    entries: list[PersonRight] = []
    if source is not None:
        entries = [
            PersonRight(oid=r.oid, name=r.name, role=r.role)
            for r in db.scalars(
                select(DokuPageRight)
                .where(DokuPageRight.page_id == source.id)
                .order_by(func.lower(DokuPageRight.name))
            )
        ]
    return RightsOut(
        own_rights=page.own_rights,
        inherited_from=Crumb(id=source.id, title=source.title)
        if source is not None and source.id != page.id
        else None,
        entries=entries,
        space_members=_members(db, page.space_id),
        can_manage_space=access.space_role(page.space_id) == ROLE_MANAGE,
    )


@router.put("/pages/{page_id}/rights")
def save_rights(page_id: PageId, body: PageRightsIn, access: AccessDep, db: DbDep) -> RightsOut:
    """Eigene Rechte der Seite (Schloss) setzen oder zurück auf den Arbeitsbereich.

    Darf jede Person, die die Seite bearbeiten darf. Wer sich selbst „Kein Zugriff“ gibt,
    sieht die Seite danach nicht mehr.
    """
    page, _ = visible_page(db, access, page_id, write=True)
    db.query(DokuPageRight).filter(DokuPageRight.page_id == page.id).delete()
    page.own_rights = body.own_rights
    if body.own_rights:
        for entry in body.entries:
            db.add(
                DokuPageRight(
                    page_id=page.id,
                    oid=entry.oid,
                    name=entry.name,
                    role=entry.role,
                    changed_by_name=access.name,
                )
            )
    _audit(
        db,
        access,
        "rechte_geaendert",
        str(page.id),
        {"eigene_rechte": body.own_rights, "eintraege": len(body.entries)},
    )
    db.commit()
    reset_space(page.space_id)
    try:
        return read_rights(page_id, access, db)
    except HTTPException:
        # Eigenen Zugriff entzogen: leere Antwort statt Fehler
        return RightsOut(
            own_rights=True,
            inherited_from=None,
            entries=[],
            space_members=[],
            can_manage_space=False,
        )


@router.put("/spaces/{space_id}/members")
def save_members(
    space_id: Annotated[int, Path(ge=1)],
    body: MembersIn,
    access: AccessDep,
    db: DbDep,
    settings: SettingsDep,
) -> list[PersonRight]:
    """Personen im Arbeitsbereich: für Verwalten im Arbeitsbereich und für Doku.Admin."""
    space = db.get(DokuSpace, space_id)
    if space is None:
        raise not_found("Arbeitsbereich")
    if not access.is_admin and access.space_role(space_id) != ROLE_MANAGE:
        raise not_found("Arbeitsbereich")
    if not access.is_admin and not any(
        m.oid == access.oid and m.role == ROLE_MANAGE for m in body.members
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Du würdest dir selbst das Verwalten entziehen. Das kann nur die Doku-Verwaltung."
            ),
        )
    if members_changed(db, space.id, body.members):
        # Rechte vergeben: nur mit frischer Anmeldung (wie in der Verwaltung)
        check_recent_login(access.user, settings)
    replace_members(db, space, body.members)
    write_audit(
        db,
        module="doku",
        action="personen_geaendert",
        object_type="arbeitsbereich",
        object_id=str(space.id),
        user_id=access.user.user_id,
        details={"personen": len(body.members)},
    )
    db.commit()
    reset_space(space.id)
    return _members(db, space.id)


def members_changed(db: Session, space_id: int, members: list[PersonRightIn]) -> bool:
    """Ändern sich Personen oder ihre Rolle im Arbeitsbereich? (Namen zählen nicht.)"""
    current = {
        (m.oid, m.role)
        for m in db.scalars(select(DokuSpaceMember).where(DokuSpaceMember.space_id == space_id))
    }
    return current != {(m.oid, m.role) for m in members}


def replace_members(db: Session, space: DokuSpace, members: list[PersonRightIn]) -> None:
    db.query(DokuSpaceMember).filter(DokuSpaceMember.space_id == space.id).delete()
    for member in members:
        db.add(
            DokuSpaceMember(space_id=space.id, oid=member.oid, name=member.name, role=member.role)
        )
    space.updated_at = now_utc()


# --- Personen aus Entra -------------------------------------------------------------------


@router.get("/people")
def search_people(
    access: AccessDep,
    finder: Annotated[PeopleFinder, Depends(get_people_finder)],
    q: Annotated[str, Query(min_length=2, max_length=60)],
) -> list[PersonOut]:
    """Personen für Rechte und Arbeitsbereiche; nur wer irgendwo bearbeiten darf."""
    if not access.is_admin and not any(
        LEVEL[access.space_role(s)] >= LEVEL[ROLE_EDIT] for s in access.spaces
    ):
        raise forbidden()
    try:
        people = finder(q)
    except PeopleError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Die Suche in Entra ist gerade nicht möglich. {exc}",
        ) from exc
    return [
        PersonOut(oid=p.oid.lower(), name=p.name, upn=p.upn, department=p.department)
        for p in people
    ]
