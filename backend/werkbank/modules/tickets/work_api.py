"""Arbeitshilfen im Modul Tickets (spec.md 8e, Phase 3): Zusammenführen, Geräte aus dem
IT-Bestand, Textbausteine; dazu ihre Einstellungen je Bereich (Kategorien, Fristen, Geräte,
Textbausteine). Alles mit Prüfung von Bereich und Recht auf dem Server."""

import re
from collections.abc import Sequence
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Path, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from werkbank.core.deps import DbDep, SettingsDep
from werkbank.core.sessions import now_utc
from werkbank.modules.inventory.models import (
    InventoryPosition,
)
from werkbank.modules.inventory.search import escape_like
from werkbank.modules.tickets.access import AccessDep, TicketAccess, forbidden, not_found
from werkbank.modules.tickets.api import (
    TicketNumber,
    TicketOut,
    _detail,
    _visible_ticket,
    actor,
)
from werkbank.modules.tickets.mailbox import MailboxError, new_http, open_mailbox
from werkbank.modules.tickets.models import (
    OPEN_STATUSES,
    PRIORITIES,
    STATUS_MERGED,
    Ticket,
    TicketArea,
    TicketCategory,
    TicketSla,
    TicketTemplate,
)
from werkbank.modules.tickets.outbound import send_to_reporter, values_for
from werkbank.modules.tickets.service import merge, protocol, system_entry
from werkbank.modules.tickets.settings_api import _area_for_settings
from werkbank.modules.tickets.sla import save_sla, work_zone

router = APIRouter(prefix="/api/tickets")
AreaId = Annotated[int, Path(ge=1, le=2_000_000_000)]
ItemId = Annotated[int, Path(ge=1, le=2_000_000_000)]
SUGGESTIONS = 3
HITS = 5
_WORDS = re.compile(r"[\wäöüß]{3,}", re.IGNORECASE)
_SHORTCUT = re.compile(r"^[a-z0-9äöüß_-]{1,30}$")


# --- Zusammenführen ------------------------------------------------------------------------


class CandidateOut(BaseModel):
    number: int
    subject: str
    reporter_name: str
    status: str


def _words(text: str) -> set[str]:
    return {w.lower() for w in _WORDS.findall(text)}


@router.get("/{number}/merge-candidates")
def merge_candidates(
    number: TicketNumber,
    access: AccessDep,
    db: DbDep,
    q: Annotated[str, Query(max_length=100)] = "",
) -> list[CandidateOut]:
    """Offene Tickets desselben Bereichs: ohne Suche bis zu 3 mit ähnlichem Betreff, mit Suche
    (Nr., Betreff, Melder) bis zu 5 Treffer."""
    ticket = _visible_ticket(db, access, number)
    if not access.can_edit(ticket.area_id):
        raise forbidden("Mit „Nur lesen“ kannst du nicht zusammenführen.")
    base = select(Ticket).where(
        Ticket.area_id == ticket.area_id,
        Ticket.status.in_(OPEN_STATUSES),
        Ticket.id != ticket.id,
    )
    text = q.strip()
    if text:
        pattern = f"%{escape_like(text)}%"
        conditions: list[Any] = [
            Ticket.subject.ilike(pattern, escape="\\"),
            Ticket.reporter_name.ilike(pattern, escape="\\"),
            Ticket.reporter_mail.ilike(pattern, escape="\\"),
        ]
        digits = re.sub(r"^\s*t-?", "", text, flags=re.IGNORECASE)
        if digits.isdigit() and len(digits) <= 12:
            conditions.append(Ticket.number == int(digits))
        rows = db.scalars(
            base.where(or_(*conditions)).order_by(Ticket.updated_at.desc()).limit(HITS)
        ).all()
    else:
        mine = _words(ticket.subject)
        recent = db.scalars(base.order_by(Ticket.updated_at.desc()).limit(200)).all()
        scored = [(len(mine & _words(t.subject)), t) for t in recent]
        rows = [t for score, t in sorted(scored, key=lambda x: -x[0]) if score > 0][:SUGGESTIONS]
    return [
        CandidateOut(
            number=t.number, subject=t.subject, reporter_name=t.reporter_name, status=t.status
        )
        for t in rows
    ]


class MergeIn(BaseModel):
    target: int = Field(ge=1, le=1_000_000_000_000)
    notify_reporter: bool = False


@router.post("/{number}/merge")
def merge_ticket(
    number: TicketNumber, body: MergeIn, access: AccessDep, db: DbDep, settings: SettingsDep
) -> TicketOut:
    """Dieses Ticket in ein offenes Ticket desselben Bereichs zusammenführen (ohne Rückgängig)."""
    source = _visible_ticket(db, access, number, write=True)
    if not access.can_edit(source.area_id):
        raise forbidden("Mit „Nur lesen“ kannst du nicht zusammenführen.")
    if source.status == STATUS_MERGED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Das Ticket ist schon zusammengeführt."
        )
    target = db.scalar(select(Ticket).where(Ticket.number == body.target))
    if (
        target is None
        or target.id == source.id
        or target.area_id != source.area_id
        or target.status not in OPEN_STATUSES
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ziel muss ein anderes offenes Ticket desselben Bereichs sein.",
        )
    me = actor(access)
    merge(db, source, target, me)
    if body.notify_reporter and source.reporter_mail:
        area = db.get(TicketArea, target.area_id)
        if area is not None:
            text = (
                f"Hallo {source.reporter_name or source.reporter_mail},\n\n"
                f"dein Anliegen „{source.subject}“ (T-{source.number}) bearbeiten wir jetzt "
                f"zusammen mit T-{target.number}. Antworte bitte künftig auf Mails mit "
                "dieser Nummer."
            )
            with new_http() as http:
                try:
                    mailbox = open_mailbox(settings, http)
                except MailboxError:
                    mailbox = None
                # An den Melder der Quelle (er ist jetzt Beteiligter im Ziel)
                original = (target.reporter_name, target.reporter_mail)
                target.reporter_name, target.reporter_mail = (
                    source.reporter_name,
                    source.reporter_mail,
                )
                message_id, error = send_to_reporter(
                    db, mailbox, area, target, text, kind="zusammengefuehrt", auto=True
                )
                target.reporter_name, target.reporter_mail = original
            system_entry(
                db,
                target,
                "Mail an den Melder von "
                f"T-{source.number} {'gesendet' if message_id else f'nicht gesendet: {error}'}",
                me,
            )
    db.commit()
    db.refresh(target)
    return _detail(db, settings, access, target)


# --- IT-Bestand: Tickets der Person an einer Stelle -----------------------------------------


def _require_inventory(access: TicketAccess) -> None:
    """Geräte am Ticket nur mit Rechten im IT-Bestand (lesen oder bearbeiten)."""
    if not access.inventory:
        raise forbidden("Geräte siehst du nur mit Rechten im IT-Bestand.")


class TicketRefOut(BaseModel):
    number: int | None
    subject: str
    status: str


class TicketRefsOut(BaseModel):
    items: list[TicketRefOut]
    # Tickets in Bereichen, die die Person nicht sieht (nur die Anzahl)
    hidden: int


def _ticket_refs(access: TicketAccess, rows: Sequence[Ticket]) -> TicketRefsOut:
    """Tickets aus eigenen Bereichen einzeln, die übrigen nur als Anzahl."""
    items: list[TicketRefOut] = []
    hidden = 0
    for ticket in rows:
        if access.can_read(ticket.area_id):
            items.append(
                TicketRefOut(number=ticket.number, subject=ticket.subject, status=ticket.status)
            )
        else:
            hidden += 1
    return TicketRefsOut(items=items, hidden=hidden)


@router.get("/by-position/{position_id}")
def tickets_for_position(position_id: ItemId, access: AccessDep, db: DbDep) -> TicketRefsOut:
    """Tickets der Person an einer Stelle (Melder-Mail = UPN); nur mit Rechten im IT-Bestand."""
    _require_inventory(access)
    position = db.get(InventoryPosition, position_id)
    if position is None:
        raise not_found()
    upn = position.person_upn.strip().lower()
    if not upn:
        return TicketRefsOut(items=[], hidden=0)
    rows = db.scalars(
        select(Ticket)
        .where(func.lower(Ticket.reporter_mail) == upn)
        .order_by(Ticket.updated_at.desc())
        .limit(50)
    ).all()
    return _ticket_refs(access, rows)


# --- Textbausteine (Auswahl im Ticket) ------------------------------------------------------


class TemplateOut(BaseModel):
    id: int
    name: str
    shortcut: str
    kind: str
    status_after: str
    body: str


def _templates(db: Session, area_id: int) -> list[TemplateOut]:
    rows = db.scalars(
        select(TicketTemplate)
        .where(TicketTemplate.area_id == area_id)
        .order_by(TicketTemplate.name)
    )
    return [
        TemplateOut(
            id=t.id,
            name=t.name,
            shortcut=t.shortcut,
            kind=t.kind,
            status_after=t.status_after,
            body=t.body,
        )
        for t in rows
    ]


class TemplatesForTicket(BaseModel):
    templates: list[TemplateOut]
    # Werte für die Platzhalter ({Vorname}, {Name}, {Nr}, {Betreff}, {Bearbeiter}, {Datum})
    values: dict[str, str]
    signature: str


@router.get("/{number}/templates")
def templates_for_ticket(number: TicketNumber, access: AccessDep, db: DbDep) -> TemplatesForTicket:
    ticket = _visible_ticket(db, access, number)
    area = db.get(TicketArea, ticket.area_id)
    if area is None:
        raise not_found()
    templates = _templates(db, area.id)
    if not access.can_edit(area.id):
        templates = [t for t in templates if t.kind == "note"]
    values = values_for(ticket, access.user.display_name)
    values["Datum"] = now_utc().astimezone(work_zone()).strftime("%d.%m.%Y")
    return TemplatesForTicket(templates=templates, values=values, signature=area.signature)


# --- Einstellungen je Bereich ---------------------------------------------------------------


class CategoryOut(BaseModel):
    id: int
    name: str
    default_priority: str
    active: bool


class CategoryIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    default_priority: Literal["low", "medium", "high"] = "medium"
    active: bool = True

    @field_validator("name")
    @classmethod
    def _strip(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Darf nicht leer sein.")
        return value


def _categories(db: Session, area_id: int) -> list[CategoryOut]:
    rows = db.scalars(
        select(TicketCategory)
        .where(TicketCategory.area_id == area_id)
        .order_by(TicketCategory.name)
    )
    return [
        CategoryOut(id=c.id, name=c.name, default_priority=c.default_priority, active=c.active)
        for c in rows
    ]


@router.get("/settings/areas/{area_id}/categories")
def read_categories(area_id: AreaId, access: AccessDep, db: DbDep) -> list[CategoryOut]:
    _area_for_settings(db, access, area_id)
    return _categories(db, area_id)


@router.post("/settings/areas/{area_id}/categories", status_code=status.HTTP_201_CREATED)
def add_category(
    area_id: AreaId, body: CategoryIn, access: AccessDep, db: DbDep
) -> list[CategoryOut]:
    area = _area_for_settings(db, access, area_id)
    db.add(
        TicketCategory(
            area_id=area.id,
            name=body.name,
            default_priority=body.default_priority,
            active=body.active,
        )
    )
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Diese Kategorie gibt es schon."
        ) from exc
    protocol(db, actor(access), "kategorie_angelegt", area_id=area.id, details={"name": body.name})
    db.commit()
    return _categories(db, area_id)


@router.put("/settings/areas/{area_id}/categories/{category_id}")
def update_category(
    area_id: AreaId, category_id: ItemId, body: CategoryIn, access: AccessDep, db: DbDep
) -> list[CategoryOut]:
    area = _area_for_settings(db, access, area_id)
    category = db.get(TicketCategory, category_id)
    if category is None or category.area_id != area.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Kategorie nicht gefunden."
        )
    category.name, category.default_priority, category.active = (
        body.name,
        body.default_priority,
        body.active,
    )
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Diese Kategorie gibt es schon."
        ) from exc
    protocol(
        db,
        actor(access),
        "kategorie_geaendert",
        area_id=area.id,
        details={"name": body.name, "aktiv": body.active},
    )
    db.commit()
    return _categories(db, area_id)


class SlaRow(BaseModel):
    priority: Literal["low", "medium", "high"]
    response_minutes: int = Field(ge=1, le=60 * 24 * 60)
    solution_minutes: int = Field(ge=1, le=60 * 24 * 365)


class WorkSettings(BaseModel):
    sla_enabled: bool
    work_days: list[int] = Field(max_length=7)
    work_start: int = Field(ge=0, le=24 * 60)
    work_end: int = Field(ge=0, le=24 * 60)
    sla: list[SlaRow] = Field(max_length=3)

    @field_validator("work_days")
    @classmethod
    def _days(cls, value: list[int]) -> list[int]:
        if any(d < 0 or d > 6 for d in value):
            raise ValueError("Wochentag 0 bis 6.")
        return sorted(set(value))


class WorkSettingsOut(WorkSettings):
    pass


def _work_out(db: Session, area: TicketArea) -> WorkSettingsOut:
    slas = {
        s.priority: s for s in db.scalars(select(TicketSla).where(TicketSla.area_id == area.id))
    }
    defaults = {"high": (60, 8 * 60), "medium": (4 * 60, 3 * 8 * 60), "low": (8 * 60, 10 * 8 * 60)}
    return WorkSettingsOut(
        sla_enabled=area.sla_enabled,
        work_days=list(area.work_days or []),
        work_start=area.work_start,
        work_end=area.work_end,
        sla=[
            SlaRow(
                priority=p,
                response_minutes=slas[p].response_minutes if p in slas else defaults[p][0],
                solution_minutes=slas[p].solution_minutes if p in slas else defaults[p][1],
            )
            for p in ("high", "medium", "low")
        ],
    )


@router.get("/settings/areas/{area_id}/work")
def read_work_settings(area_id: AreaId, access: AccessDep, db: DbDep) -> WorkSettingsOut:
    """Fristen eines Bereichs."""
    return _work_out(db, _area_for_settings(db, access, area_id))


@router.put("/settings/areas/{area_id}/work")
def update_work_settings(
    area_id: AreaId, body: WorkSettings, access: AccessDep, db: DbDep
) -> WorkSettingsOut:
    area = _area_for_settings(db, access, area_id)
    if body.work_end <= body.work_start:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Die Arbeitszeit muss nach dem Beginn enden.",
        )
    if body.sla_enabled and not body.work_days:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Für Fristen braucht es mindestens einen Arbeitstag.",
        )
    if any(r.solution_minutes < r.response_minutes for r in body.sla):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Die Lösung darf nicht vor der ersten Reaktion fällig sein.",
        )
    area.sla_enabled = body.sla_enabled
    area.work_days = body.work_days
    area.work_start, area.work_end = body.work_start, body.work_end
    save_sla(
        db,
        area,
        [
            (r.priority, r.response_minutes, r.solution_minutes)
            for r in body.sla
            if r.priority in PRIORITIES
        ],
    )
    protocol(
        db,
        actor(access),
        "bereich_fristen",
        area_id=area.id,
        details={"fristen": body.sla_enabled},
    )
    db.commit()
    return _work_out(db, area)


class TemplateIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    shortcut: str = Field(min_length=1, max_length=30)
    kind: Literal["reply", "note"]
    status_after: Literal["", "waiting", "solved"] = ""
    body: str = Field(min_length=1, max_length=8000)

    @field_validator("shortcut")
    @classmethod
    def _shortcut(cls, value: str) -> str:
        value = value.strip().lower().lstrip("/")
        if not _SHORTCUT.match(value):
            raise ValueError("Kürzel nur aus Buchstaben, Ziffern, - und _ (ohne Leerzeichen).")
        return value

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        return " ".join(value.split())


@router.get("/settings/areas/{area_id}/templates")
def read_templates(area_id: AreaId, access: AccessDep, db: DbDep) -> list[TemplateOut]:
    _area_for_settings(db, access, area_id)
    return _templates(db, area_id)


@router.post("/settings/areas/{area_id}/templates", status_code=status.HTTP_201_CREATED)
def add_template(
    area_id: AreaId, body: TemplateIn, access: AccessDep, db: DbDep
) -> list[TemplateOut]:
    area = _area_for_settings(db, access, area_id)
    db.add(TicketTemplate(area_id=area.id, **body.model_dump()))
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Dieses Kürzel gibt es schon."
        ) from exc
    protocol(
        db, actor(access), "baustein_angelegt", area_id=area.id, details={"kuerzel": body.shortcut}
    )
    db.commit()
    return _templates(db, area_id)


@router.put("/settings/areas/{area_id}/templates/{template_id}")
def update_template(
    area_id: AreaId, template_id: ItemId, body: TemplateIn, access: AccessDep, db: DbDep
) -> list[TemplateOut]:
    area = _area_for_settings(db, access, area_id)
    template = db.get(TicketTemplate, template_id)
    if template is None or template.area_id != area.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Textbaustein nicht gefunden."
        )
    for key, value in body.model_dump().items():
        setattr(template, key, value)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Dieses Kürzel gibt es schon."
        ) from exc
    protocol(
        db, actor(access), "baustein_geaendert", area_id=area.id, details={"kuerzel": body.shortcut}
    )
    db.commit()
    return _templates(db, area_id)


@router.delete("/settings/areas/{area_id}/templates/{template_id}")
def delete_template(
    area_id: AreaId, template_id: ItemId, access: AccessDep, db: DbDep
) -> list[TemplateOut]:
    area = _area_for_settings(db, access, area_id)
    template = db.get(TicketTemplate, template_id)
    if template is None or template.area_id != area.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Textbaustein nicht gefunden."
        )
    protocol(
        db,
        actor(access),
        "baustein_geloescht",
        area_id=area.id,
        details={"kuerzel": template.shortcut},
    )
    db.delete(template)
    db.commit()
    return _templates(db, area_id)


@router.get("/areas/{area_id}/categories")
def categories_for_members(area_id: AreaId, access: AccessDep, db: DbDep) -> list[CategoryOut]:
    """Aktive Kategorien eines Bereichs für Mitglieder (z. B. beim Anlegen eines Tickets)."""
    if not access.can_read(area_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bereich nicht gefunden.")
    return [c for c in _categories(db, area_id) if c.active]
