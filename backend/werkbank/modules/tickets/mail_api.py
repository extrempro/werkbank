"""Einstellungen rund um E-Mail im Modul Tickets (spec.md 8e).

- Je Bereich (Bereichsverwaltung, Ticket-Verwaltung): E-Mail-Eingang (externe Absender,
  Anhänge, Ordner und Löschfristen, Antwort auf geschlossene Tickets), Mails an den Melder
  (Eingangsbestätigung, automatische Mails, Absendername, Titel, Signatur), Sperrliste,
  „Zu prüfen“ und „Letzte Eingänge“.
- Global (nur Ticket-Verwaltung): Gestaltung aller Mails (Akzentfarbe, Fußzeile,
  Datenschutz-Link, Logo).
"""

import base64
import binascii
import contextlib
import re
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Path, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from werkbank.core.branding import ImageError, inspect_image
from werkbank.core.deps import DbDep, SettingsDep
from werkbank.modules.tickets.access import AccessDep, TicketAccess, forbidden
from werkbank.modules.tickets.api import actor
from werkbank.modules.tickets.inbound import process_raw
from werkbank.modules.tickets.mail_texts import (
    ALL_TYPES,
    DEFAULT_ACK,
    DEFAULT_EVENTS,
    EVENT_TEXTS,
    EVENTS,
)
from werkbank.modules.tickets.mailbox import (
    FOLDER_IGNORED,
    FOLDER_PROCESSED,
    MailboxError,
    available,
    is_test,
    new_http,
    open_mailbox,
)
from werkbank.modules.tickets.models import (
    TicketArea,
    TicketBlock,
    TicketMailDesign,
    TicketMailLog,
    TicketMailOut,
    TicketReview,
)
from werkbank.modules.tickets.outbound import DEFAULT_ACCENT
from werkbank.modules.tickets.service import protocol
from werkbank.modules.tickets.settings_api import _area_for_settings

router = APIRouter(prefix="/api/tickets/settings")
AreaId = Annotated[int, Path(ge=1, le=2_000_000_000)]
ItemId = Annotated[int, Path(ge=1, le=2_000_000_000)]
_ACCENT = re.compile(r"^#[0-9a-fA-F]{6}$")
_BLOCK = re.compile(
    r"^(@[a-z0-9.-]{1,253}\.[a-z]{2,63}|[^@\s<>,;\"]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,63})$"
)
LOG_LIMIT = 100


class MailSettings(BaseModel):
    external_policy: Literal["accept", "review", "reject"]
    max_attachment_mb: int = Field(ge=1, le=50)
    allowed_types: list[str] = Field(max_length=len(ALL_TYPES))
    processed_days: int = Field(ge=1, le=365)
    ignored_days: int = Field(ge=1, le=365)
    reopen_policy: Literal["days", "always", "new"]
    reopen_days: int = Field(ge=0, le=365)
    sender_name: str = Field(max_length=120)
    header_title: str = Field(max_length=120)
    signature: str = Field(max_length=2000)
    ack_enabled: bool
    ack_text: str = Field(max_length=4000)
    mail_events: dict[str, bool]

    @field_validator("allowed_types")
    @classmethod
    def _types(cls, value: list[str]) -> list[str]:
        unknown = [v for v in value if v not in ALL_TYPES]
        if unknown:
            raise ValueError("Unbekannter Dateityp.")
        return [t for t in ALL_TYPES if t in value]

    @field_validator("mail_events")
    @classmethod
    def _events(cls, value: dict[str, bool]) -> dict[str, bool]:
        if any(key not in EVENTS for key in value):
            raise ValueError("Unbekannte Art einer automatischen Mail.")
        return {key: bool(value.get(key, DEFAULT_EVENTS[key])) for key in EVENTS}

    @field_validator("sender_name", "header_title")
    @classmethod
    def _line(cls, value: str) -> str:
        return " ".join(value.split())


class MailSettingsOut(MailSettings):
    area_id: int
    mailbox: str
    mail_configured: bool
    internal_domains: list[str]
    checked_at: datetime | None
    error: str
    default_ack: str
    event_texts: dict[str, str]
    all_types: list[str]


def _out(area: TicketArea, settings_ok: bool, domains: list[str]) -> MailSettingsOut:
    return MailSettingsOut(
        area_id=area.id,
        mailbox=area.mailbox,
        mail_configured=settings_ok,
        internal_domains=domains,
        checked_at=area.mailbox_checked_at,
        error=area.mailbox_error,
        external_policy=area.external_policy,  # type: ignore[arg-type]
        max_attachment_mb=area.max_attachment_mb,
        allowed_types=list(area.allowed_types or []),
        processed_days=area.processed_days,
        ignored_days=area.ignored_days,
        reopen_policy=area.reopen_policy,  # type: ignore[arg-type]
        reopen_days=area.reopen_days,
        sender_name=area.sender_name,
        header_title=area.header_title,
        signature=area.signature,
        ack_enabled=area.ack_enabled,
        ack_text=area.ack_text,
        mail_events={**DEFAULT_EVENTS, **(area.mail_events or {})},
        default_ack=DEFAULT_ACK,
        event_texts=EVENT_TEXTS,
        all_types=list(ALL_TYPES),
    )


@router.get("/areas/{area_id}/mail")
def read_mail_settings(
    area_id: AreaId, access: AccessDep, db: DbDep, settings: SettingsDep
) -> MailSettingsOut:
    area = _area_for_settings(db, access, area_id)
    return _out(area, available(settings), settings.tickets_internal_domain_list())


@router.put("/areas/{area_id}/mail")
def update_mail_settings(
    area_id: AreaId, body: MailSettings, access: AccessDep, db: DbDep, settings: SettingsDep
) -> MailSettingsOut:
    area = _area_for_settings(db, access, area_id)
    changed: list[str] = []
    for field, value in body.model_dump().items():
        if getattr(area, field) != value:
            setattr(area, field, value)
            changed.append(field)
    if changed:
        # Nur die Namen der geänderten Felder, keine Texte
        protocol(
            db,
            actor(access),
            "bereich_mail_geaendert",
            area_id=area.id,
            details={"felder": changed},
        )
        db.commit()
    return _out(area, available(settings), settings.tickets_internal_domain_list())


# --- Sperrliste ----------------------------------------------------------------------------


class BlockOut(BaseModel):
    id: int
    value: str


class BlockIn(BaseModel):
    value: str = Field(min_length=3, max_length=320)

    @field_validator("value")
    @classmethod
    def _check(cls, value: str) -> str:
        value = value.strip().lower()
        if not _BLOCK.match(value):
            raise ValueError("Bitte eine Mailadresse oder @domain angeben.")
        return value


def _blocks(db: Session, area_id: int) -> list[BlockOut]:
    rows = db.scalars(
        select(TicketBlock).where(TicketBlock.area_id == area_id).order_by(TicketBlock.value)
    )
    return [BlockOut(id=r.id, value=r.value) for r in rows]


@router.get("/areas/{area_id}/blocks")
def read_blocks(area_id: AreaId, access: AccessDep, db: DbDep) -> list[BlockOut]:
    _area_for_settings(db, access, area_id)
    return _blocks(db, area_id)


def _add_block(db: Session, access: TicketAccess, area: TicketArea, value: str) -> None:
    exists = db.scalar(
        select(TicketBlock.id).where(TicketBlock.area_id == area.id, TicketBlock.value == value)
    )
    if exists is None:
        db.add(TicketBlock(area_id=area.id, value=value))
        protocol(db, actor(access), "absender_gesperrt", area_id=area.id, details={"wert": value})


@router.post("/areas/{area_id}/blocks", status_code=status.HTTP_201_CREATED)
def add_block(area_id: AreaId, body: BlockIn, access: AccessDep, db: DbDep) -> list[BlockOut]:
    area = _area_for_settings(db, access, area_id)
    try:
        _add_block(db, access, area, body.value)
        db.commit()
    except IntegrityError:
        db.rollback()
    return _blocks(db, area_id)


@router.delete("/areas/{area_id}/blocks/{block_id}")
def remove_block(area_id: AreaId, block_id: ItemId, access: AccessDep, db: DbDep) -> list[BlockOut]:
    area = _area_for_settings(db, access, area_id)
    block = db.get(TicketBlock, block_id)
    if block is None or block.area_id != area.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Eintrag nicht gefunden.")
    protocol(
        db, actor(access), "absender_freigegeben", area_id=area.id, details={"wert": block.value}
    )
    db.delete(block)
    db.commit()
    return _blocks(db, area_id)


# --- Letzte Eingänge -----------------------------------------------------------------------


class IntakeOut(BaseModel):
    created_at: datetime
    sender: str
    subject: str
    result: str
    detail: str
    ticket_number: int | None


@router.get("/areas/{area_id}/intake")
def read_intake(area_id: AreaId, access: AccessDep, db: DbDep) -> list[IntakeOut]:
    """Protokoll „Letzte Eingänge“: was mit jeder Mail passiert ist (neueste zuerst)."""
    _area_for_settings(db, access, area_id)
    rows = db.scalars(
        select(TicketMailLog)
        .where(TicketMailLog.area_id == area_id)
        .order_by(TicketMailLog.id.desc())
        .limit(LOG_LIMIT)
    )
    return [
        IntakeOut(
            created_at=r.created_at,
            sender=r.sender,
            subject=r.subject,
            result=r.result,
            detail=r.detail,
            ticket_number=r.ticket_number,
        )
        for r in rows
    ]


# --- Zu prüfen -----------------------------------------------------------------------------


class ReviewOut(BaseModel):
    id: int
    sender: str
    sender_name: str
    subject: str
    received_at: datetime


def _reviews(db: Session, area_id: int) -> list[ReviewOut]:
    rows = db.scalars(
        select(TicketReview)
        .where(TicketReview.area_id == area_id)
        .order_by(TicketReview.received_at)
    )
    return [
        ReviewOut(
            id=r.id,
            sender=r.sender,
            sender_name=r.sender_name,
            subject=r.subject,
            received_at=r.received_at,
        )
        for r in rows
    ]


@router.get("/areas/{area_id}/review")
def read_review(area_id: AreaId, access: AccessDep, db: DbDep) -> list[ReviewOut]:
    _area_for_settings(db, access, area_id)
    return _reviews(db, area_id)


class ReviewResult(BaseModel):
    items: list[ReviewOut]
    ticket_number: int | None = None


@router.post("/areas/{area_id}/review/{review_id}/{action}")
def act_on_review(
    area_id: AreaId,
    review_id: ItemId,
    action: Literal["anlegen", "verwerfen", "sperren"],
    access: AccessDep,
    db: DbDep,
    settings: SettingsDep,
) -> ReviewResult:
    """„Als Ticket anlegen“, „Verwerfen“ oder „Absender sperren“."""
    area = _area_for_settings(db, access, area_id)
    review = db.get(TicketReview, review_id)
    if review is None or review.area_id != area.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Eintrag nicht gefunden.")
    number: int | None = None
    with new_http() as http:
        try:
            mailbox = open_mailbox(settings, http) if available(settings) else None
        except MailboxError:
            mailbox = None
        raw, graph_id, sender = review.raw, review.graph_id, review.sender
        db.delete(review)
        db.flush()
        if action == "anlegen":
            outcome = process_raw(
                db, settings, mailbox, area, raw, graph_id=graph_id, accept_unknown=True
            )
            number = outcome.ticket.number if outcome.ticket else None
            folder = FOLDER_PROCESSED
        else:
            if action == "sperren":
                _add_block(db, access, area, sender)
            folder = FOLDER_IGNORED
        protocol(
            db, actor(access), f"pruefen_{action}", area_id=area.id, details={"ticket": number}
        )
        db.commit()
        if mailbox is not None and graph_id:
            # Klappt das Verschieben nicht, bleibt die Mail im Posteingang; der nächste Abruf
            # erkennt sie an der Message-ID und legt sie ab.
            with contextlib.suppress(MailboxError):
                mailbox.move(area.mailbox, graph_id, folder)
    return ReviewResult(items=_reviews(db, area_id), ticket_number=number)


# --- Gestaltung (global) -------------------------------------------------------------------


class DesignIn(BaseModel):
    accent: str = Field(max_length=7)
    footer: str = Field(max_length=2000)
    privacy_url: str = Field(max_length=500)

    @field_validator("accent")
    @classmethod
    def _accent(cls, value: str) -> str:
        if value and not _ACCENT.match(value):
            raise ValueError("Farbe als #rrggbb angeben.")
        return value.lower()

    @field_validator("privacy_url")
    @classmethod
    def _url(cls, value: str) -> str:
        value = value.strip()
        if value and (not value.startswith("https://") or any(c.isspace() for c in value)):
            raise ValueError("Nur eine https-Adresse ist erlaubt.")
        return value


class DesignOut(DesignIn):
    has_logo: bool
    default_accent: str


def _design(db: Session) -> TicketMailDesign:
    row = db.get(TicketMailDesign, 1)
    if row is None:
        row = TicketMailDesign(id=1, accent="", footer="", privacy_url="")
        db.add(row)
        db.flush()
    return row


def _design_out(row: TicketMailDesign) -> DesignOut:
    return DesignOut(
        accent=row.accent,
        footer=row.footer,
        privacy_url=row.privacy_url,
        has_logo=row.logo_png is not None,
        default_accent=DEFAULT_ACCENT,
    )


def _require_manager(access: TicketAccess) -> None:
    if not access.manager:
        raise forbidden("Die Gestaltung der Mails ändert nur die Ticket-Verwaltung.")


@router.get("/design")
def read_design(access: AccessDep, db: DbDep) -> DesignOut:
    if not access.settings_visible:
        raise forbidden("Keine Berechtigung für die Einstellungen der Tickets.")
    row = db.get(TicketMailDesign, 1)
    if row is None:
        return DesignOut(
            accent="", footer="", privacy_url="", has_logo=False, default_accent=DEFAULT_ACCENT
        )
    return _design_out(row)


@router.put("/design")
def update_design(body: DesignIn, access: AccessDep, db: DbDep) -> DesignOut:
    _require_manager(access)
    row = _design(db)
    row.accent, row.footer, row.privacy_url = body.accent, body.footer, body.privacy_url
    protocol(db, actor(access), "gestaltung_geaendert")
    db.commit()
    return _design_out(row)


class LogoIn(BaseModel):
    content_base64: str = Field(min_length=1, max_length=700_000)


@router.put("/design/logo")
def upload_logo(body: LogoIn, access: AccessDep, db: DbDep) -> DesignOut:
    """Logo für die Mails: nur PNG (viele Mailprogramme zeigen WebP nicht)."""
    _require_manager(access)
    try:
        data = base64.b64decode(body.content_base64, validate=True)
        info = inspect_image("logo", data)
    except binascii.Error as exc:
        raise HTTPException(status_code=422, detail="Die Datei ist nicht lesbar.") from exc
    except ImageError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if info.content_type != "image/png":
        raise HTTPException(status_code=422, detail="Für Mails ist nur PNG erlaubt.")
    row = _design(db)
    row.logo_png = data
    protocol(db, actor(access), "gestaltung_logo")
    db.commit()
    return _design_out(row)


@router.delete("/design/logo")
def delete_logo(access: AccessDep, db: DbDep) -> DesignOut:
    _require_manager(access)
    row = _design(db)
    row.logo_png = None
    protocol(db, actor(access), "gestaltung_logo_entfernt")
    db.commit()
    return _design_out(row)


# --- nur für automatische Tests -------------------------------------------------------------

test_router = APIRouter(prefix="/api/tickets/test")


class TestMailIn(BaseModel):
    area_id: int = Field(ge=1)
    raw: str = Field(min_length=1, max_length=2_000_000)


class TestMailOut(BaseModel):
    result: str
    detail: str
    ticket_number: int | None


@test_router.post("/mail")
def test_mail(body: TestMailIn, db: DbDep, settings: SettingsDep) -> TestMailOut:
    """Eine Mail so verarbeiten, als käme sie im Postfach an. In Produktion 404."""
    if not is_test(settings):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    area = db.get(TicketArea, body.area_id)
    if area is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    with new_http() as http:
        mailbox = open_mailbox(settings, http)
        outcome = process_raw(db, settings, mailbox, area, body.raw.encode("utf-8"))
    db.commit()
    return TestMailOut(
        result=outcome.result,
        detail=outcome.detail,
        ticket_number=outcome.ticket.number if outcome.ticket else None,
    )


class OutboxOut(BaseModel):
    kind: str
    recipients: str
    error: str


@test_router.get("/outbox")
def test_outbox(db: DbDep, settings: SettingsDep, ticket: int = 0) -> list[OutboxOut]:
    """Gesendete Mails eines Tickets (Testumgebung). In Produktion 404."""
    if not is_test(settings):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    from werkbank.modules.tickets.models import Ticket

    row = db.scalar(select(Ticket).where(Ticket.number == ticket))
    if row is None:
        return []
    mails = db.scalars(
        select(TicketMailOut).where(TicketMailOut.ticket_id == row.id).order_by(TicketMailOut.id)
    )
    return [OutboxOut(kind=m.kind, recipients=m.recipients, error=m.error) for m in mails]
