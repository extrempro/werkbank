"""Rückmeldungen (Fehler und Ideen) aus der Werkbank.

Jede angemeldete Person kann eine Rückmeldung zu der Seite geben, auf der sie gerade ist, und
sieht unter „Meine Rückmeldungen“ ihre eigenen mit Stand und Antworten. Lesen, Stand setzen und
antworten dürfen nur Werkbank-Admins. Ideen bleiben privat. Bei Fehlern gehen technische
Angaben (Version, Fenstergröße, Browser, letzte Fehlermeldungen des Browsers) und auf Wunsch ein
Bildschirmfoto mit; beides sehen nur Admins. Abgeschlossene Rückmeldungen werden 30 Tage nach
Abschluss ganz gelöscht. Benachrichtigungen (Glocke) nennen nur die Nummer.
"""

import base64
import binascii
import re
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from werkbank.core.audit import truncate_ip, write_audit
from werkbank.core.deps import CurrentUserDep, DbDep, require_roles
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.feedback.models import FeedbackEntry, FeedbackReply

router = APIRouter(prefix="/api/feedback")

Admin = Annotated[CurrentUser, Depends(require_roles(Role.WERKBANK_ADMIN))]

MODULE = "rueckmeldungen"
KINDS = ("fehler", "idee")
STATUSES = ("neu", "in_arbeit", "erledigt", "abgelehnt")
CLOSED = ("erledigt", "abgelehnt")
TEXT_MIN = 5
TEXT_MAX = 2000
REPLY_MAX = 2000
SCREENSHOT_MAX = 300 * 1024
KEEP_AFTER_CLOSE = timedelta(days=30)
PER_HOUR = 10
BROWSER_ERRORS_MAX = 5
LIST_MAX = 200

_IMAGE_TYPES = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
)


# Fenstergröße wie im Browser ermittelt: Breite, Malzeichen (U+00D7), Höhe
_WINDOW = re.compile(r"\d{1,5} \u00d7 \d{1,5}")


def number(entry_id: int) -> str:
    return f"RM-{entry_id:04d}"


def _clean_line(value: Any, limit: int) -> str | None:
    """Ohne Steuerzeichen, gekürzt; leer → None."""
    if not isinstance(value, str):
        return None
    text = "".join(" " if ord(c) < 32 or ord(c) == 127 else c for c in value)
    text = " ".join(text.split())[:limit]
    return text or None


def _clean_text(value: str) -> str:
    """Mehrzeiliger Text: Zeilenumbrüche erlaubt, sonst keine Steuerzeichen."""
    value = value.replace("\r\n", "\n").strip()
    if any((ord(c) < 32 and c not in "\n\t") or ord(c) == 127 for c in value):
        raise ValueError("Keine Steuerzeichen")
    return value


def image_type(data: bytes) -> str | None:
    """Bildtyp am Inhalt (PNG, JPEG, WebP), sonst None."""
    for magic, kind in _IMAGE_TYPES:
        if data.startswith(magic):
            return kind
    if len(data) > 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


# --- Schemas -----------------------------------------------------------------------------


class TechnicalIn(BaseModel):
    version: str | None = None
    window: str | None = None
    browser_errors: list[str] = Field(default_factory=list, max_length=20)


class FeedbackIn(BaseModel):
    kind: Literal["fehler", "idee"]
    text: str = Field(max_length=TEXT_MAX * 2)
    page: str = Field(default="", max_length=500)
    technical: TechnicalIn | None = None
    # Bildschirmfoto als Base64 (ohne „data:“-Präfix), nur bei Fehlern
    screenshot: str | None = Field(default=None, max_length=SCREENSHOT_MAX * 2)

    @field_validator("text")
    @classmethod
    def plain_text(cls, value: str) -> str:
        value = _clean_text(value)
        if len(value) < TEXT_MIN:
            raise ValueError("Beschreib es bitte etwas genauer.")
        if len(value) > TEXT_MAX:
            raise ValueError(f"Höchstens {TEXT_MAX} Zeichen.")
        return value

    @field_validator("page")
    @classmethod
    def own_path(cls, value: str) -> str:
        value = value.strip()
        if value and (not value.startswith("/") or value.startswith("//") or "\\" in value):
            raise ValueError("Nur ein Pfad der Werkbank")
        return _clean_line(value, 500) or ""


class StatusIn(BaseModel):
    status: Literal["neu", "in_arbeit", "erledigt", "abgelehnt"]


class ReplyIn(BaseModel):
    text: str = Field(min_length=1, max_length=REPLY_MAX)

    @field_validator("text")
    @classmethod
    def plain_text(cls, value: str) -> str:
        value = _clean_text(value)
        if not value:
            raise ValueError("Die Antwort ist leer.")
        return value


class ReplyOut(BaseModel):
    id: int
    author: str
    text: str
    created_at: datetime


class FeedbackSummary(BaseModel):
    id: int
    number: str
    kind: str
    status: str
    title: str
    page: str
    user_name: str
    has_screenshot: bool
    replies: int
    created_at: datetime


class FeedbackOut(FeedbackSummary):
    text: str
    technical: dict[str, Any]
    reply_list: list[ReplyOut]
    status_changed_at: datetime | None
    closed_at: datetime | None


class FeedbackListOut(BaseModel):
    entries: list[FeedbackSummary]
    open: int


# --- Hilfsfunktionen ---------------------------------------------------------------------


def _title(text: str) -> str:
    first = text.strip().splitlines()[0] if text.strip() else ""
    return first[:80] + ("…" if len(first) > 80 else "")


def _replies(db: Session, entry_ids: list[int]) -> dict[int, list[FeedbackReply]]:
    result: dict[int, list[FeedbackReply]] = {}
    if not entry_ids:
        return result
    for row in db.scalars(
        select(FeedbackReply)
        .where(FeedbackReply.entry_id.in_(entry_ids))
        .order_by(FeedbackReply.created_at, FeedbackReply.id)
    ).all():
        result.setdefault(row.entry_id, []).append(row)
    return result


def _summary(entry: FeedbackEntry, replies: list[FeedbackReply]) -> FeedbackSummary:
    return FeedbackSummary(
        id=entry.id,
        number=number(entry.id),
        kind=entry.kind,
        status=entry.status,
        title=_title(entry.text),
        page=entry.page,
        user_name=entry.user_name,
        has_screenshot=entry.screenshot is not None,
        replies=len(replies),
        created_at=entry.created_at,
    )


def _out(db: Session, entry: FeedbackEntry, *, admin: bool) -> FeedbackOut:
    replies = _replies(db, [entry.id]).get(entry.id, [])
    summary = _summary(entry, replies)
    if not admin:
        summary.has_screenshot = False
    return FeedbackOut(
        **summary.model_dump(),
        text=entry.text,
        technical=dict(entry.technical or {}) if admin else {},
        reply_list=[
            ReplyOut(id=row.id, author=row.author_name, text=row.text, created_at=row.created_at)
            for row in replies
        ],
        status_changed_at=entry.status_changed_at,
        closed_at=entry.closed_at,
    )


def _entry(db: Session, entry_id: int) -> FeedbackEntry:
    row = db.get(FeedbackEntry, entry_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    return row


def _audit(
    db: Session, request: Request, user: CurrentUser, action: str, entry_id: int, **details: Any
) -> None:
    write_audit(
        db,
        module=MODULE,
        action=f"rueckmeldung.{action}",
        user_id=user.user_id,
        object_type="rueckmeldung",
        object_id=str(entry_id),
        ip=truncate_ip(request.client.host if request.client else None),
        details=details or None,
    )


def _technical(body: FeedbackIn, request: Request) -> dict[str, Any]:
    tech = body.technical or TechnicalIn()
    version = _clean_line(tech.version, 20)
    window = _clean_line(tech.window, 20)
    browser = _clean_line(request.headers.get("user-agent"), 400)
    errors = [
        line
        for line in (_clean_line(item, 280) for item in tech.browser_errors[-BROWSER_ERRORS_MAX:])
        if line
    ]
    result: dict[str, Any] = {"browser_errors": errors}
    if version and all(part.isdigit() for part in version.split(".")) and version.count(".") == 2:
        result["version"] = version
    if window and _WINDOW.fullmatch(window):
        result["window"] = window
    if browser:
        result["browser"] = browser
    return result


# --- Endpunkte für alle ------------------------------------------------------------------


@router.post("")
def create_feedback(
    request: Request, body: FeedbackIn, user: CurrentUserDep, db: DbDep
) -> FeedbackOut:
    """Neue Rückmeldung; höchstens 10 je Stunde und Person."""
    recent = db.scalar(
        select(func.count())
        .select_from(FeedbackEntry)
        .where(
            FeedbackEntry.user_id == user.user_id,
            FeedbackEntry.created_at >= now_utc() - timedelta(hours=1),
        )
    )
    if (recent or 0) >= PER_HOUR:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Du hast in der letzten Stunde schon viele Rückmeldungen gegeben. "
            "Versuch es bitte später noch einmal.",
        )
    screenshot: bytes | None = None
    kind_of_image = ""
    if body.screenshot:
        if body.kind != "fehler":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Ein Bildschirmfoto gibt es nur bei Fehlern.",
            )
        try:
            screenshot = base64.b64decode(body.screenshot, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Das Bildschirmfoto ließ sich nicht lesen.",
            ) from exc
        detected = image_type(screenshot)
        if detected is None or len(screenshot) > SCREENSHOT_MAX:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Das Bildschirmfoto muss ein PNG, JPEG oder WebP bis 300 KB sein.",
            )
        kind_of_image = detected
    entry = FeedbackEntry(
        user_id=user.user_id,
        user_name=user.display_name[:256],
        kind=body.kind,
        text=body.text,
        page=body.page,
        technical=_technical(body, request) if body.kind == "fehler" else {},
        screenshot=screenshot,
        screenshot_type=kind_of_image,
    )
    db.add(entry)
    db.flush()
    _audit(db, request, user, "neu", entry.id, art=body.kind, bild=screenshot is not None)
    db.commit()
    return _out(db, entry, admin=False)


@router.get("/mine")
def my_feedback(user: CurrentUserDep, db: DbDep) -> list[FeedbackOut]:
    """Eigene Rückmeldungen mit Antworten, neueste zuerst."""
    rows = db.scalars(
        select(FeedbackEntry)
        .where(FeedbackEntry.user_id == user.user_id)
        .order_by(FeedbackEntry.created_at.desc(), FeedbackEntry.id.desc())
        .limit(LIST_MAX)
    ).all()
    return [_out(db, row, admin=False) for row in rows]


# --- Endpunkte für Admins ----------------------------------------------------------------


@router.get("")
def list_feedback(
    user: Admin,
    db: DbDep,
    state: Annotated[Literal["offen", "fehler", "idee", "erledigt", "alle"], Query()] = "offen",
) -> FeedbackListOut:
    query = select(FeedbackEntry)
    if state == "offen":
        query = query.where(FeedbackEntry.status.not_in(CLOSED))
    elif state in KINDS:
        query = query.where(FeedbackEntry.kind == state, FeedbackEntry.status.not_in(CLOSED))
    elif state == "erledigt":
        query = query.where(FeedbackEntry.status.in_(CLOSED))
    rows = db.scalars(
        query.order_by(FeedbackEntry.created_at.desc(), FeedbackEntry.id.desc()).limit(LIST_MAX)
    ).all()
    replies = _replies(db, [row.id for row in rows])
    open_count = db.scalar(
        select(func.count()).select_from(FeedbackEntry).where(FeedbackEntry.status.not_in(CLOSED))
    )
    return FeedbackListOut(
        entries=[_summary(row, replies.get(row.id, [])) for row in rows], open=open_count or 0
    )


@router.get("/{entry_id}")
def read_feedback(
    entry_id: Annotated[int, Path(ge=1)], user: CurrentUserDep, db: DbDep
) -> FeedbackOut:
    """Admins sehen alle; sonst nur die eigene (ohne technische Angaben)."""
    entry = _entry(db, entry_id)
    admin = user.has_any_role(Role.WERKBANK_ADMIN)
    if not admin and entry.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    return _out(db, entry, admin=admin)


@router.get("/{entry_id}/screenshot")
def read_screenshot(entry_id: Annotated[int, Path(ge=1)], user: Admin, db: DbDep) -> Response:
    entry = _entry(db, entry_id)
    if entry.screenshot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    return Response(
        content=entry.screenshot,
        media_type=entry.screenshot_type or "application/octet-stream",
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
        },
    )


@router.put("/{entry_id}/status")
def set_status(
    request: Request,
    entry_id: Annotated[int, Path(ge=1)],
    body: StatusIn,
    user: Admin,
    db: DbDep,
) -> FeedbackOut:
    entry = _entry(db, entry_id)
    if entry.status != body.status:
        before = entry.status
        entry.status = body.status
        entry.status_changed_at = now_utc()
        entry.closed_at = entry.status_changed_at if body.status in CLOSED else None
        _audit(db, request, user, "stand", entry.id, vorher=before, nachher=body.status)
        db.commit()
    return _out(db, entry, admin=True)


@router.post("/{entry_id}/replies")
def add_reply(
    request: Request,
    entry_id: Annotated[int, Path(ge=1)],
    body: ReplyIn,
    user: Admin,
    db: DbDep,
) -> FeedbackOut:
    entry = _entry(db, entry_id)
    db.add(
        FeedbackReply(
            entry_id=entry.id,
            author_id=user.user_id,
            author_name=user.display_name[:256],
            text=body.text,
        )
    )
    _audit(db, request, user, "antwort", entry.id)
    db.commit()
    return _out(db, entry, admin=True)


# --- Aufräumen ----------------------------------------------------------------------------


def purge_feedback(db: Session, now: datetime | None = None) -> int:
    """Abgeschlossene Rückmeldungen 30 Tage nach Abschluss ganz löschen (mit Antworten und Bild)."""
    now = now or now_utc()
    result = db.execute(
        delete(FeedbackEntry).where(
            FeedbackEntry.closed_at.is_not(None),
            FeedbackEntry.closed_at < now - KEEP_AFTER_CLOSE,
        )
    )
    return int(getattr(result, "rowcount", 0) or 0)
