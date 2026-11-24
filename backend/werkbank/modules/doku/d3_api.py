"""Dokumentation, Phase D3: Kommentare an Textstellen, Verweise, Live-Bausteine, Rückverweise.

- Kommentieren darf, wer die Seite lesen darf (nicht im Papierkorb, nicht in archivierten
  Arbeitsbereichen). Erledigt setzen und wieder öffnen ebenso; löschen nur den eigenen Beitrag.
- Erwähnen kann man nur Personen, die die Seite lesen dürfen; der Server prüft das.
- Verweise und Live-Bausteine zeigen Daten immer mit den Rechten der lesenden Person
  (`refs.py`).
- Benachrichtigungen (Erwähnung, Antwort) erzeugt der Worker; Titel ohne Inhalt.
"""

import base64
import binascii
import uuid
from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Path, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.deps import DbDep, SettingsDep
from werkbank.core.models import User
from werkbank.core.notifications import Event
from werkbank.core.sessions import now_utc
from werkbank.modules.doku.access import (
    LEVEL,
    AccessDep,
    DokuAccess,
    RightsResolver,
    access_for_oid,
    can_read_page,
    forbidden,
    not_found,
    space_pages,
    visible_page,
)
from werkbank.modules.doku.content import LIVE_KINDS, REF_KINDS
from werkbank.modules.doku.models import (
    ROLE_NONE,
    ROLE_READ,
    DokuComment,
    DokuPage,
    DokuPageRight,
    DokuSpaceMember,
    DokuThread,
)
from werkbank.modules.doku.refs import (
    SEP,
    Rights,
    live_data,
    live_options,
    referencing_pages,
    resolve,
    search,
)

router = APIRouter(prefix="/api/doku")

PageId = Annotated[uuid.UUID, Path()]
TEXT_MAX = 2000
QUOTE_MAX = 300
ANCHOR_MAX = 400
MENTIONS_MAX = 20
RECENT = timedelta(days=7)


def _rights(access: DokuAccess, db: Session, settings: Settings) -> Rights:
    return Rights(user=access.user, oid=access.oid, db=db, settings=settings)


def _clean_text(value: str) -> str:
    text = "".join(ch for ch in value if ch in "\n\t" or ord(ch) >= 32).strip()
    if not text:
        raise ValueError("Der Kommentar ist leer.")
    if len(text) > TEXT_MAX:
        raise ValueError(f"Höchstens {TEXT_MAX} Zeichen.")
    return text


def _oid_list(value: list[str]) -> list[str]:
    result = []
    for oid in value:
        oid = oid.strip().lower()
        if len(oid) > 64 or not oid.replace("-", "").replace(":", "").isalnum():
            raise ValueError("Ungültige Erwähnung.")
        if oid not in result:
            result.append(oid)
    return result


class AnchorIn(BaseModel):
    # Relative Positionen aus Yjs, Base64-kodiert
    from_: str = Field(alias="from", min_length=1, max_length=ANCHOR_MAX)
    to: str = Field(min_length=1, max_length=ANCHOR_MAX)

    @field_validator("from_", "to")
    @classmethod
    def _base64(cls, value: str) -> str:
        try:
            base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("Ungültige Textstelle.") from exc
        return value


class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=TEXT_MAX + 200)
    mentions: list[str] = Field(default_factory=list, max_length=MENTIONS_MAX)

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        return _clean_text(value)

    @field_validator("mentions")
    @classmethod
    def _mentions(cls, value: list[str]) -> list[str]:
        return _oid_list(value)


class ThreadIn(CommentIn):
    anchor: AnchorIn
    quote: str = Field(default="", max_length=2000)

    @field_validator("quote")
    @classmethod
    def _quote(cls, value: str) -> str:
        text = " ".join("".join(ch for ch in value if ord(ch) >= 32).split())
        return text[: QUOTE_MAX - 1] + "…" if len(text) > QUOTE_MAX else text


class ResolveIn(BaseModel):
    resolved: bool


class CommentOut(BaseModel):
    id: uuid.UUID
    author_name: str
    text: str
    mentions: list[str]
    created_at: datetime
    own: bool


class ThreadOut(BaseModel):
    id: uuid.UUID
    anchor: dict[str, str] | None
    quote: str
    created_by_name: str
    created_at: datetime
    resolved_at: datetime | None
    resolved_by_name: str
    comments: list[CommentOut]


def _commentable(db: Session, access: DokuAccess, page_id: uuid.UUID) -> DokuPage:
    page, _ = visible_page(db, access, page_id)
    if page.space_id in access.archived:
        raise forbidden("Im archivierten Arbeitsbereich lässt sich nicht kommentieren.")
    return page


def _thread(db: Session, access: DokuAccess, thread_id: uuid.UUID) -> tuple[DokuThread, DokuPage]:
    thread = db.get(DokuThread, thread_id)
    if thread is None:
        raise not_found("Kommentar")
    try:
        page = _commentable(db, access, thread.page_id)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            raise not_found("Kommentar") from exc
        raise
    return thread, page


def _check_mentions(db: Session, page: DokuPage, mentions: list[str]) -> None:
    for oid in mentions:
        if not can_read_page(db, oid, page):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Erwähnen kannst du nur Personen, die die Seite lesen dürfen.",
            )


def _threads_out(db: Session, access: DokuAccess, threads: list[DokuThread]) -> list[ThreadOut]:
    by_thread: dict[uuid.UUID, list[DokuComment]] = {t.id: [] for t in threads}
    if threads:
        for comment in db.scalars(
            select(DokuComment)
            .where(DokuComment.thread_id.in_(list(by_thread)))
            .order_by(DokuComment.created_at, DokuComment.id)
        ):
            by_thread[comment.thread_id].append(comment)
    return [
        ThreadOut(
            id=t.id,
            anchor=t.anchor,
            quote=t.quote,
            created_by_name=t.created_by_name,
            created_at=t.created_at,
            resolved_at=t.resolved_at,
            resolved_by_name=t.resolved_by_name,
            comments=[
                CommentOut(
                    id=c.id,
                    author_name=c.author_name,
                    text=c.text,
                    mentions=list(c.mentions or []),
                    created_at=c.created_at,
                    own=bool(access.oid) and c.author_oid == access.oid,
                )
                for c in by_thread[t.id]
            ],
        )
        for t in threads
    ]


@router.get("/pages/{page_id}/threads")
def list_threads(page_id: PageId, access: AccessDep, db: DbDep) -> list[ThreadOut]:
    """Alle Kommentare der Seite, offene und erledigte."""
    page, _ = visible_page(db, access, page_id)
    threads = list(
        db.scalars(
            select(DokuThread)
            .where(DokuThread.page_id == page.id)
            .order_by(DokuThread.created_at, DokuThread.id)
        )
    )
    return _threads_out(db, access, threads)


@router.post("/pages/{page_id}/threads", status_code=status.HTTP_201_CREATED)
def create_thread(page_id: PageId, body: ThreadIn, access: AccessDep, db: DbDep) -> ThreadOut:
    """Neuer Kommentar zu einer Textstelle."""
    page = _commentable(db, access, page_id)
    _check_mentions(db, page, body.mentions)
    thread = DokuThread(
        page_id=page.id,
        anchor={"from": body.anchor.from_, "to": body.anchor.to},
        quote=body.quote,
        created_by_oid=access.oid,
        created_by_name=access.name,
    )
    db.add(thread)
    db.flush()
    db.add(
        DokuComment(
            thread_id=thread.id,
            author_oid=access.oid,
            author_name=access.name,
            text=body.text,
            mentions=body.mentions,
            created_at=now_utc(),
        )
    )
    db.commit()
    return _threads_out(db, access, [thread])[0]


@router.post("/threads/{thread_id}/comments", status_code=status.HTTP_201_CREATED)
def reply(
    thread_id: Annotated[uuid.UUID, Path()], body: CommentIn, access: AccessDep, db: DbDep
) -> ThreadOut:
    """Antwort auf einen Kommentar."""
    thread, page = _thread(db, access, thread_id)
    _check_mentions(db, page, body.mentions)
    db.add(
        DokuComment(
            thread_id=thread.id,
            author_oid=access.oid,
            author_name=access.name,
            text=body.text,
            mentions=body.mentions,
            created_at=now_utc(),
        )
    )
    db.commit()
    return _threads_out(db, access, [thread])[0]


@router.put("/threads/{thread_id}/resolved")
def set_resolved(
    thread_id: Annotated[uuid.UUID, Path()], body: ResolveIn, access: AccessDep, db: DbDep
) -> ThreadOut:
    """Kommentar erledigen oder wieder öffnen."""
    thread, _ = _thread(db, access, thread_id)
    thread.resolved_at = now_utc() if body.resolved else None
    thread.resolved_by_name = access.name if body.resolved else ""
    db.commit()
    return _threads_out(db, access, [thread])[0]


@router.delete("/comments/{comment_id}")
def delete_comment(
    comment_id: Annotated[uuid.UUID, Path()], access: AccessDep, db: DbDep
) -> dict[str, bool]:
    """Eigenen Beitrag löschen; ist der Faden danach leer, fällt er weg."""
    comment = db.get(DokuComment, comment_id)
    if comment is None:
        raise not_found("Kommentar")
    thread, _ = _thread(db, access, comment.thread_id)
    if not access.oid or comment.author_oid != access.oid:
        raise forbidden("Löschen kannst du nur deine eigenen Kommentare.")
    db.delete(comment)
    db.flush()
    if db.scalar(select(DokuComment.id).where(DokuComment.thread_id == thread.id).limit(1)) is None:
        db.execute(delete(DokuThread).where(DokuThread.id == thread.id))
    db.commit()
    return {"ok": True}


class PersonOut(BaseModel):
    oid: str
    name: str


@router.get("/pages/{page_id}/mentionable")
def mentionable(
    page_id: PageId,
    access: AccessDep,
    db: DbDep,
    q: Annotated[str, Query(max_length=60)] = "",
) -> list[PersonOut]:
    """Personen, die die Seite lesen dürfen (für @-Erwähnungen)."""
    page, _ = visible_page(db, access, page_id)
    names: dict[str, str] = {}
    for oid, name in db.execute(
        select(DokuSpaceMember.oid, DokuSpaceMember.name).where(
            DokuSpaceMember.space_id == page.space_id
        )
    ):
        names[oid] = name
    pages = space_pages(db, page.space_id)
    for oid, name in db.execute(
        select(DokuPageRight.oid, DokuPageRight.name).where(
            DokuPageRight.page_id.in_([p.id for p in pages if p.own_rights]),
            DokuPageRight.role != ROLE_NONE,
        )
    ):
        names.setdefault(oid, name)
    needle = q.strip().lower()
    result: list[PersonOut] = []
    for oid, name in sorted(names.items(), key=lambda item: item[1].lower()):
        if needle and needle not in name.lower():
            continue
        other = access_for_oid(db, oid)
        if other is None:
            continue
        role = RightsResolver(db, other, pages).role(page)
        if LEVEL[role] >= LEVEL[ROLE_READ]:
            result.append(PersonOut(oid=oid, name=name))
        if len(result) >= 10:
            break
    return result


# --- Verweise und Live-Bausteine ----------------------------------------------------------


class RefIn(BaseModel):
    kind: Literal[REF_KINDS]  # type: ignore[valid-type]
    id: str = Field(pattern=r"^\d{1,12}$")


class ResolveRefsIn(BaseModel):
    refs: list[RefIn] = Field(max_length=200)


class RefOut(BaseModel):
    kind: str
    id: str
    allowed: bool
    found: bool
    title: str
    status: str
    detail: str
    href: str


@router.post("/refs/resolve")
def resolve_refs(
    body: ResolveRefsIn, access: AccessDep, db: DbDep, settings: SettingsDep
) -> list[RefOut]:
    """Stand der Verweise einer Seite, mit den Rechten der lesenden Person."""
    found = resolve(_rights(access, db, settings), [(r.kind, r.id) for r in body.refs])
    return [RefOut(**item.as_dict()) for item in found]


@router.get("/refs/search")
def search_refs(
    access: AccessDep,
    db: DbDep,
    settings: SettingsDep,
    kind: Annotated[Literal[REF_KINDS], Query()],  # type: ignore[valid-type]
    q: Annotated[str, Query(max_length=60)] = "",
) -> list[RefOut]:
    """Objekte für einen neuen Verweis suchen (nur in Bereichen mit Rechten)."""
    return [RefOut(**item.as_dict()) for item in search(_rights(access, db, settings), kind, q)]


class LiveIn(BaseModel):
    kind: Literal[LIVE_KINDS]  # type: ignore[valid-type]
    area: int | None = Field(default=None, gt=0)
    status: Literal["offen", "alle"] | None = None
    q: str | None = Field(default=None, max_length=60)
    floor: int | None = Field(default=None, gt=0)
    room: int | None = Field(default=None, gt=0)
    hwkind: int | None = Field(default=None, gt=0)
    project: int | None = Field(default=None, gt=0)
    months: Literal[3, 6, 12] | None = None


class LiveOut(BaseModel):
    kind: str
    allowed: bool
    title: str
    rows: list[dict[str, Any]] | None
    project: dict[str, Any] | None
    note: str


@router.post("/live-bausteine/daten")
def live_block(body: LiveIn, access: AccessDep, db: DbDep, settings: SettingsDep) -> LiveOut:
    """Daten eines Live-Bausteins mit den Rechten der lesenden Person."""
    out = live_data(_rights(access, db, settings), body.model_dump())
    return LiveOut(**out.as_dict())


@router.get("/live-bausteine/optionen")
def live_block_options(access: AccessDep, db: DbDep, settings: SettingsDep) -> dict[str, Any]:
    """Auswahl für die Einstellungen (Bereiche, Etagen und Räume, Arten, Projekte)."""
    return live_options(_rights(access, db, settings))


class BacklinkOut(BaseModel):
    id: uuid.UUID
    title: str
    path: str
    updated_at: datetime
    updated_by_name: str
    snippet: str


@router.get("/backlinks")
def backlinks(
    access: AccessDep,
    db: DbDep,
    settings: SettingsDep,
    kind: Annotated[Literal[REF_KINDS], Query()],  # type: ignore[valid-type]
    id: Annotated[str, Query(pattern=r"^\d{1,12}$")],
) -> list[BacklinkOut]:
    """Seiten, die auf ein Objekt verweisen. Nur Seiten, die die Person lesen darf; nur, wenn
    sie das Objekt selbst sehen darf."""
    rights = _rights(access, db, settings)
    target = resolve(rights, [(kind, id)])[0]
    if not target.found:
        return []
    result: list[BacklinkOut] = []
    resolvers: dict[int, RightsResolver] = {}
    for page_id in referencing_pages(db, kind, id):
        page = db.get(DokuPage, page_id)
        if page is None or page.space_id not in access.space_ids:
            continue
        if page.space_id not in resolvers:
            resolvers[page.space_id] = RightsResolver(db, access, space_pages(db, page.space_id))
        resolver = resolvers[page.space_id]
        if LEVEL[resolver.role(page)] < LEVEL[ROLE_READ]:
            continue
        crumbs: list[str] = []
        current = resolver.by_id.get(page.parent_id) if page.parent_id else None
        while current is not None and len(crumbs) < 5:
            crumbs.insert(0, current.title)
            current = resolver.by_id.get(current.parent_id) if current.parent_id else None
        result.append(
            BacklinkOut(
                id=page.id,
                title=page.title,
                path=SEP.join(crumbs),
                updated_at=page.updated_at,
                updated_by_name=page.updated_by_name,
                snippet=page.text[:160],
            )
        )
    return result


# --- Benachrichtigungen -------------------------------------------------------------------


def doku_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    """Erwähnungen und Antworten der letzten Tage; nur an Personen, die die Seite lesen dürfen."""
    users = {oid.lower(): uid for uid, oid in db.execute(select(User.id, User.entra_oid))}
    rows = db.execute(
        select(DokuComment, DokuThread, DokuPage)
        .join(DokuThread, DokuThread.id == DokuComment.thread_id)
        .join(DokuPage, DokuPage.id == DokuThread.page_id)
        .where(DokuComment.created_at >= now - RECENT, DokuPage.deleted_at.is_(None))
        .order_by(DokuComment.created_at)
    ).all()
    readable: dict[tuple[str, uuid.UUID], bool] = {}

    def can(oid: str, page: DokuPage) -> bool:
        key = (oid, page.id)
        if key not in readable:
            readable[key] = can_read_page(db, oid, page)
        return readable[key]

    for comment, thread, page in rows:
        link = f"/doku/seite/{page.id}?kommentar={thread.id}"
        mentioned = {
            oid for oid in (comment.mentions or []) if oid != comment.author_oid and can(oid, page)
        }
        mention_ids = frozenset(users[o] for o in mentioned if o in users)
        if mention_ids:
            yield Event(
                kind="doku.erwaehnung",
                key=f"{comment.id}",
                title="Du wurdest in einem Kommentar der Dokumentation erwähnt",
                link=link,
                user_ids=mention_ids,
            )
        earlier = db.scalars(
            select(DokuComment.author_oid).where(
                DokuComment.thread_id == thread.id, DokuComment.created_at < comment.created_at
            )
        ).all()
        participants = {thread.created_by_oid, *earlier} - {comment.author_oid, ""} - mentioned
        reply_ids = frozenset(users[o] for o in participants if o in users and can(o, page))
        if reply_ids:
            yield Event(
                kind="doku.antwort",
                key=f"{comment.id}",
                title="Neue Antwort auf einen Kommentar in der Dokumentation",
                link=link,
                user_ids=reply_ids,
            )
