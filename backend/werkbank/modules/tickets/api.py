"""API des Moduls Tickets: Liste, Anlegen, Ticketseite, Status und Zuständigkeit, Notizen.

Jede Abfrage ist auf die Bereiche der Person beschränkt (serverseitig). Tickets aus fremden
Bereichen gibt es für sie nicht: 404 statt 403 (spec.md 8e, „Sichtbarkeit“).
"""

import re
import uuid
from datetime import datetime
from pathlib import Path as FilePath
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Path, Query, status
from fastapi.responses import FileResponse
from pydantic import AfterValidator, BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.admin_settings import ADDRESS_PATTERN
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep
from werkbank.core.sessions import now_utc
from werkbank.modules.inventory.search import escape_like
from werkbank.modules.tickets.access import (
    AccessDep,
    TicketAccess,
    area_people,
    forbidden,
    not_found,
)
from werkbank.modules.tickets.files import file_path
from werkbank.modules.tickets.inventory_link import ReporterInventory, reporter_inventory
from werkbank.modules.tickets.mail_texts import DEFAULT_EVENTS
from werkbank.modules.tickets.mailbox import (
    MailboxError,
    available,
    mime_bytes,
    new_http,
    open_mailbox,
)
from werkbank.modules.tickets.models import (
    AREA_ADMIN,
    AREA_EDIT,
    ENTRY_FORWARD,
    ENTRY_INBOUND,
    ENTRY_NOTE,
    OPEN_STATUSES,
    STATUS_CLOSED,
    STATUS_IN_PROGRESS,
    STATUS_REMINDER,
    STATUS_SOLVED,
    STATUS_WAITING,
    Ticket,
    TicketArea,
    TicketAttachment,
    TicketCategory,
    TicketEntry,
    TicketMailOut,
    TicketParticipant,
    TicketSolutionType,
)
from werkbank.modules.tickets.outbound import build_forward, event_text, send_to_reporter
from werkbank.modules.tickets.preview import (
    PreviewKind,
    matches,
    preview_kind,
    read_head,
    read_text,
)
from werkbank.modules.tickets.service import (
    PRIORITY_LABELS,
    SOLUTION_TEXT_MAX,
    STATUS_LABELS,
    Actor,
    apply_solution,
    assign,
    assign_new,
    protocol,
    set_status,
    system_entry,
)
from werkbank.modules.tickets.sla import on_first_response, recalc, work_zone

router = APIRouter(prefix="/api/tickets")

TicketNumber = Annotated[int, Path(ge=1, le=1_000_000_000_000)]
PAGE_SIZE = 50
BODY_MAX = 20_000
PARTICIPANTS_MAX = 20
# Status, die man im Ticketkopf von Hand wählen kann (Erinnerung folgt in Phase 3)
SETTABLE_STATUSES = (
    STATUS_IN_PROGRESS,
    STATUS_WAITING,
    STATUS_REMINDER,
    STATUS_SOLVED,
    STATUS_CLOSED,
)
_NUMBER = re.compile(r"^\s*(?:t-?)?(\d{1,12})\s*$", re.IGNORECASE)


def _mail(value: str) -> str:
    value = value.strip().lower()
    if not ADDRESS_PATTERN.match(value):
        raise ValueError("Bitte gib eine gültige Mailadresse an.")
    return value


Mail = Annotated[str, Field(max_length=320), AfterValidator(_mail)]
Priority = Literal["low", "medium", "high"]
View = Literal["open", "mine", "unassigned", "waiting", "reminder", "done", "all"]


def actor(access: TicketAccess) -> Actor:
    return Actor(oid=access.oid, name=access.user.display_name)


# --- Ausgaben ------------------------------------------------------------------------------


class AreaRef(BaseModel):
    id: int
    name: str
    role: str | None = None


class MeOut(BaseModel):
    manager: bool
    settings: bool
    areas: list[AreaRef]


class TicketItem(BaseModel):
    number: int
    subject: str
    area: AreaRef
    status: str
    priority: str
    assignee_oid: str | None
    assignee_name: str
    reporter_name: str
    channel: str
    created_at: datetime
    updated_at: datetime
    category: str
    reminder_at: datetime | None
    # Frist: nur bei Bereichen mit Fristen (sonst None und kein Feld in der Oberfläche)
    sla_solution_due: datetime | None
    sla_overdue: bool


class TicketListOut(BaseModel):
    items: list[TicketItem]
    total: int
    has_more: bool


class ParticipantOut(BaseModel):
    name: str
    mail: str


class AttachmentOut(BaseModel):
    id: str
    filename: str
    size: int
    original: bool
    # Grund, warum der Anhang entfernt wurde (dann ohne Download)
    removed_reason: str
    # Eingebettetes Bild: Nummer in der Nachricht („[Bild n]“ im Text)
    inline_number: int | None
    # Vorschau: image (im Browser), pdf (neuer Tab), text (Auszug), leer (nur Download)
    preview: PreviewKind


class TextPreviewOut(BaseModel):
    text: str
    # Nur die ersten 200 KB
    truncated: bool


class EntryOut(BaseModel):
    id: str
    kind: str
    # Eingehende Mails: reporter (Melder), participant (Beteiligte), external (von außen)
    origin: str
    # Empfänger gesendeter Antworten und Weiterleitungen
    recipients: str
    # Beim Zusammenführen übernommen: Nummer des Quelltickets
    from_number: int | None
    body: str
    quote: str
    author_name: str
    original: bool
    created_at: datetime
    attachments: list[AttachmentOut]


class PersonOut(BaseModel):
    oid: str
    name: str


class CategoryRef(BaseModel):
    id: int
    name: str
    default_priority: str


class SolutionTypeRef(BaseModel):
    id: int
    name: str


class SolutionOut(BaseModel):
    type_id: int | None
    type_name: str
    text: str
    # In der Mail an den Melder zeigen
    public: bool


class SolutionIn(BaseModel):
    """Lösung beim Wechsel auf „Gelöst“; alles freiwillig."""

    type_id: int | None = Field(default=None, ge=1, le=2_000_000_000)
    text: str = Field(default="", max_length=SOLUTION_TEXT_MAX)
    public: bool = True


class SlaOut(BaseModel):
    response_due: datetime | None
    solution_due: datetime | None
    response_met: bool | None
    solution_met: bool | None
    paused: bool


class PermissionsOut(BaseModel):
    edit: bool
    note: bool
    # Darf jede Zuständigkeit ändern (Bereichsverwaltung)
    assign_any: bool
    move: bool


class RetentionOut(BaseModel):
    """Aufbewahrung am Ticket: Ausnahme (bis, Begründung, von wem) und ob eine Frist gilt."""

    active: bool
    months: int
    action: str
    hold_until: datetime | None
    hold_reason: str
    hold_by: str
    can_manage: bool


class TicketOut(TicketItem):
    reporter_mail: str
    created_by: str
    participants: list[ParticipantOut]
    entries: list[EntryOut]
    permissions: PermissionsOut
    assignees: list[PersonOut]
    move_targets: list[AreaRef]
    # Eigene Objekt-ID (für „Mir zuweisen“)
    me_oid: str
    # Antwort an den Melder möglich? Sonst der Grund
    can_reply: bool
    reply_hint: str
    category_id: int | None
    categories: list[CategoryRef]
    # Lösung (bei „Gelöst“ und danach); Lösungsarten des Bereichs zur Auswahl
    solution: SolutionOut | None
    solution_types: list[SolutionTypeRef]
    reminder_note: str
    sla: SlaOut | None
    # Rechte im IT-Bestand: Angaben zum Melder sichtbar
    inventory: bool
    reporter_inventory: ReporterInventory | None
    merged_into: int | None
    retention: RetentionOut
    anonymized_at: datetime | None


def _solution_out(db: Session, ticket: Ticket) -> SolutionOut | None:
    kind = db.get(TicketSolutionType, ticket.solution_type_id) if ticket.solution_type_id else None
    if kind is None and not ticket.solution_text:
        return None
    return SolutionOut(
        type_id=kind.id if kind else None,
        type_name=kind.name if kind else "",
        text=ticket.solution_text,
        public=ticket.solution_public,
    )


def _set_solution(
    db: Session, ticket: Ticket, solution: SolutionIn | None, me: Actor, *, note: bool = True
) -> None:
    body = solution or SolutionIn()
    try:
        apply_solution(db, ticket, body.type_id, body.text, body.public, me, note=note)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


def _area_names(db: Session) -> dict[int, str]:
    return dict(db.execute(select(TicketArea.id, TicketArea.name)).tuples().all())


def _category_names(db: Session) -> dict[int, str]:
    return dict(db.execute(select(TicketCategory.id, TicketCategory.name)).tuples().all())


def _item(
    ticket: Ticket,
    names: dict[int, str],
    access: TicketAccess,
    categories: dict[int, str] | None = None,
) -> TicketItem:
    now = now_utc()
    open_ = ticket.status in OPEN_STATUSES
    return TicketItem(
        number=ticket.number,
        subject=ticket.subject,
        area=AreaRef(
            id=ticket.area_id, name=names.get(ticket.area_id, ""), role=access.role(ticket.area_id)
        ),
        status=ticket.status,
        priority=ticket.priority,
        assignee_oid=ticket.assignee_oid,
        assignee_name=ticket.assignee_name,
        reporter_name=ticket.reporter_name,
        channel=ticket.channel,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        category=(categories or {}).get(ticket.category_id or 0, ""),
        reminder_at=ticket.reminder_at,
        sla_solution_due=ticket.sla_solution_due,
        sla_overdue=bool(
            open_
            and ticket.sla_solution_due is not None
            and ticket.sla_paused_since is None
            and ticket.sla_solution_due < now
        ),
    )


def _visible_ticket(
    db: Session, access: TicketAccess, number: int, *, write: bool = False
) -> Ticket:
    """Ticket aus den eigenen Bereichen (sonst 404); zum Ändern nicht anonymisiert (409)."""
    ticket = db.scalar(select(Ticket).where(Ticket.number == number))
    if ticket is None or not access.can_read(ticket.area_id):
        raise not_found()
    if write and ticket.anonymized_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Das Ticket ist anonymisiert und lässt sich nicht mehr ändern.",
        )
    return ticket


def reply_problem(settings: Settings, area: TicketArea | None, ticket: Ticket) -> str:
    """Warum (noch) keine Antwort per Mail möglich ist; leer, wenn alles passt."""
    if not ticket.reporter_mail:
        return "Für den Melder ist keine Mailadresse eingetragen."
    if area is None or not area.mailbox:
        return "Für den Bereich ist kein Postfach eingetragen."
    if not available(settings):
        return "Die Postfächer der Tickets sind noch nicht eingerichtet."
    if ticket.status == "merged":
        return "Das Ticket ist zusammengeführt."
    return ""


def _detail(db: Session, settings: Settings, access: TicketAccess, ticket: Ticket) -> TicketOut:
    names = _area_names(db)
    item = _item(ticket, names, access, _category_names(db))
    entries = db.scalars(
        select(TicketEntry)
        .where(TicketEntry.ticket_id == ticket.id)
        .order_by(TicketEntry.original.desc(), TicketEntry.created_at, TicketEntry.id)
    ).all()
    participants = db.scalars(
        select(TicketParticipant)
        .where(TicketParticipant.ticket_id == ticket.id)
        .order_by(TicketParticipant.id)
    ).all()
    # Anonymisierte Tickets lassen sich nicht mehr bearbeiten
    can_edit = access.can_edit(ticket.area_id) and ticket.anonymized_at is None
    files: dict[object, list[AttachmentOut]] = {}
    for att in db.scalars(
        select(TicketAttachment)
        .where(TicketAttachment.ticket_id == ticket.id)
        .order_by(TicketAttachment.original, TicketAttachment.created_at)
    ):
        files.setdefault(att.entry_id, []).append(
            AttachmentOut(
                id=str(att.id),
                filename=att.filename,
                size=att.size,
                original=att.original,
                removed_reason=att.removed_reason,
                inline_number=att.inline_number,
                preview=preview_kind(att.content_type) if att.key else "",
            )
        )
    area = db.get(TicketArea, ticket.area_id)
    hint = reply_problem(settings, area, ticket)
    assignees = [PersonOut(oid=m.oid, name=m.name) for m, _ in area_people(db, ticket.area_id)]
    if ticket.assignee_oid and all(p.oid != ticket.assignee_oid for p in assignees):
        assignees.append(PersonOut(oid=ticket.assignee_oid, name=ticket.assignee_name))
    active = db.scalars(
        select(TicketArea).where(TicketArea.active.is_(True)).order_by(TicketArea.name)
    ).all()
    return TicketOut(
        **item.model_dump(),
        reporter_mail=ticket.reporter_mail,
        created_by=ticket.created_by,
        participants=[ParticipantOut(name=p.name, mail=p.mail) for p in participants],
        entries=[
            EntryOut(
                id=str(e.id),
                kind=e.kind,
                origin=_origin(e, ticket, {p.mail for p in participants}),
                recipients=e.recipients,
                body=e.body,
                quote=e.quote,
                from_number=e.from_number,
                author_name=e.author_name,
                original=e.original,
                created_at=e.created_at,
                attachments=files.get(e.id, []),
            )
            for e in entries
        ],
        permissions=PermissionsOut(
            edit=can_edit,
            note=access.can_read(ticket.area_id) and ticket.anonymized_at is None,
            assign_any=access.is_area_admin(ticket.area_id),
            move=can_edit,
        ),
        assignees=assignees,
        me_oid=access.oid,
        can_reply=can_edit and not hint,
        reply_hint=hint,
        move_targets=[
            AreaRef(id=a.id, name=a.name, role=access.role(a.id))
            for a in active
            if a.id != ticket.area_id
        ],
        category_id=ticket.category_id,
        categories=[
            CategoryRef(id=c.id, name=c.name, default_priority=c.default_priority)
            for c in db.scalars(
                select(TicketCategory)
                .where(TicketCategory.area_id == ticket.area_id, TicketCategory.active.is_(True))
                .order_by(TicketCategory.name)
            )
        ],
        solution=_solution_out(db, ticket),
        solution_types=[
            SolutionTypeRef(id=t.id, name=t.name)
            for t in db.scalars(
                select(TicketSolutionType)
                .where(
                    TicketSolutionType.area_id == ticket.area_id,
                    TicketSolutionType.active.is_(True),
                )
                .order_by(TicketSolutionType.name)
            )
        ],
        reminder_note=ticket.reminder_note,
        sla=SlaOut(
            response_due=ticket.sla_response_due,
            solution_due=ticket.sla_solution_due,
            response_met=ticket.sla_response_met,
            solution_met=ticket.sla_solution_met,
            paused=ticket.sla_paused_since is not None,
        )
        if area is not None and area.sla_enabled and ticket.sla_solution_due is not None
        else None,
        inventory=access.inventory,
        reporter_inventory=reporter_inventory(db, ticket.reporter_mail)
        if access.inventory and ticket.reporter_mail
        else None,
        merged_into=_merged_number(db, ticket),
        retention=_retention(db, access, area, ticket),
        anonymized_at=ticket.anonymized_at,
    )


def _retention(
    db: Session, access: TicketAccess, area: TicketArea | None, ticket: Ticket
) -> RetentionOut:
    from werkbank.modules.tickets.retention import default_policy, policy_for

    policy = policy_for(area, default_policy(db)) if area is not None else None
    return RetentionOut(
        active=bool(policy and policy.active),
        months=policy.months if policy else 0,
        action=policy.action if policy else "",
        hold_until=ticket.hold_until,
        hold_reason=ticket.hold_reason,
        hold_by=ticket.hold_by_name,
        can_manage=access.is_area_admin(ticket.area_id) and ticket.anonymized_at is None,
    )


def _origin(entry: TicketEntry, ticket: Ticket, participants: set[str]) -> str:
    """Wer eine eingehende Mail geschickt hat: Melder, Beteiligte oder jemand von außen."""
    if entry.kind != ENTRY_INBOUND:
        return ""
    sender = entry.author_mail.lower()
    if not sender or entry.original or sender == ticket.reporter_mail.lower():
        return "reporter"
    if sender in {p.lower() for p in participants}:
        return "participant"
    return "external"


def _merged_number(db: Session, ticket: Ticket) -> int | None:
    if ticket.merged_into_id is None:
        return None
    return db.scalar(select(Ticket.number).where(Ticket.id == ticket.merged_into_id))


# --- Endpunkte -----------------------------------------------------------------------------


@router.get("/me")
def me(access: AccessDep, db: DbDep, settings: SettingsDep) -> MeOut:
    """Eigene Rechte im Modul: Bereiche mit Rolle, Ticket-Verwaltung, Einstellungen sichtbar."""
    names = _area_names(db)
    return MeOut(
        manager=access.manager,
        settings=access.settings_visible,
        areas=[
            AreaRef(id=a, name=names.get(a, ""), role=access.role(a)) for a in access.visible_areas
        ],
    )


def _conditions(access: TicketAccess, view: View, area: int | None, q: str) -> list[Any]:
    areas = access.visible_areas
    if area is not None:
        areas = [a for a in areas if a == area]
    where: list[Any] = [Ticket.area_id.in_(areas)]
    if view == "open":
        where.append(Ticket.status.in_(OPEN_STATUSES))
    elif view == "mine":
        where += [Ticket.assignee_oid == access.oid, Ticket.status.in_(OPEN_STATUSES)]
    elif view == "unassigned":
        where += [Ticket.assignee_oid.is_(None), Ticket.status.in_(OPEN_STATUSES)]
    elif view == "waiting":
        where.append(Ticket.status == STATUS_WAITING)
    elif view == "reminder":
        where.append(Ticket.status == "reminder")
    elif view == "done":
        where.append(Ticket.status.in_((STATUS_SOLVED, STATUS_CLOSED)))
    text = q.strip()
    if text:
        number = _NUMBER.match(text)
        pattern = f"%{escape_like(text)}%"
        matches: list[Any] = [
            Ticket.subject.ilike(pattern, escape="\\"),
            Ticket.reporter_name.ilike(pattern, escape="\\"),
            Ticket.reporter_mail.ilike(pattern, escape="\\"),
        ]
        if number:
            matches.append(Ticket.number == int(number.group(1)))
        where.append(or_(*matches))
    return where


@router.get("")
def list_tickets(
    access: AccessDep,
    db: DbDep,
    view: View = "open",
    area: Annotated[int | None, Query(ge=1, le=2_000_000_000)] = None,
    q: Annotated[str, Query(max_length=100)] = "",
    offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
) -> TicketListOut:
    """Tickets der eigenen Bereiche, zuletzt geändert zuerst."""
    if not access.visible_areas:
        return TicketListOut(items=[], total=0, has_more=False)
    where = _conditions(access, view, area, q)
    total = db.scalar(select(func.count()).select_from(Ticket).where(*where)) or 0
    rows = db.scalars(
        select(Ticket)
        .where(*where)
        .order_by(Ticket.updated_at.desc(), Ticket.number.desc())
        .offset(offset)
        .limit(PAGE_SIZE)
    ).all()
    names = _area_names(db)
    return TicketListOut(
        items=[_item(t, names, access, _category_names(db)) for t in rows],
        total=total,
        has_more=offset + len(rows) < total,
    )


class ParticipantIn(BaseModel):
    name: str = Field(default="", max_length=200)
    mail: Mail

    @field_validator("name")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()


class TicketIn(BaseModel):
    area_id: int = Field(ge=1, le=2_000_000_000)
    subject: str = Field(min_length=1, max_length=250)
    reporter_name: str = Field(min_length=1, max_length=200)
    reporter_mail: Mail | None = None
    priority: Priority = "medium"
    channel: Literal["manual", "phone"] = "manual"
    body: str = Field(min_length=1, max_length=BODY_MAX)
    participants: list[ParticipantIn] = Field(default_factory=list, max_length=PARTICIPANTS_MAX)
    assign_to_me: bool = False
    category_id: int | None = Field(default=None, ge=1, le=2_000_000_000)

    @field_validator("subject", "reporter_name", "body")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Darf nicht leer sein.")
        return value


def _category_of(db: Session, area_id: int, category_id: int | None) -> int | None:
    """Kategorie muss zum Bereich gehören und aktiv sein."""
    if category_id is None:
        return None
    category = db.get(TicketCategory, category_id)
    if category is None or category.area_id != area_id or not category.active:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Diese Kategorie gibt es im Bereich nicht.",
        )
    return category.id


def _set_participants(db: Session, ticket: Ticket, participants: list[ParticipantIn]) -> None:
    seen: set[str] = set()
    for p in participants:
        mail = str(p.mail).lower()
        if mail in seen or mail == ticket.reporter_mail.lower():
            continue
        seen.add(mail)
        db.add(TicketParticipant(ticket_id=ticket.id, name=p.name, mail=mail))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_ticket(body: TicketIn, access: AccessDep, db: DbDep, settings: SettingsDep) -> TicketOut:
    """Ticket von Hand erfassen (Bearbeiten oder Bereichsverwaltung im gewählten Bereich)."""
    area = db.get(TicketArea, body.area_id)
    if area is None or not area.active or not access.can_read(area.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bereich nicht gefunden.")
    if not access.can_edit(area.id):
        raise forbidden("Dafür brauchst du im Bereich die Rolle „Bearbeiten“.")
    me_actor = actor(access)
    ticket = Ticket(
        area_id=area.id,
        subject=body.subject,
        reporter_name=body.reporter_name,
        reporter_mail=str(body.reporter_mail or "").lower(),
        priority=body.priority,
        channel=body.channel,
        created_by=me_actor.name,
        category_id=_category_of(db, area.id, body.category_id),
    )
    db.add(ticket)
    db.flush()
    db.refresh(ticket)
    recalc(db, ticket, area)
    db.add(
        TicketEntry(
            ticket_id=ticket.id,
            kind=ENTRY_INBOUND,
            body=body.body,
            author_oid=me_actor.oid,
            author_name=me_actor.name,
            original=True,
        )
    )
    _set_participants(db, ticket, body.participants)
    if body.assign_to_me:
        assign(ticket, access.oid, me_actor.name, access.oid)
        system_entry(db, ticket, f"Zuständig: {me_actor.name}", me_actor)
    else:
        assign_new(db, ticket, area)
    protocol(db, me_actor, "ticket_angelegt", ticket=ticket, details={"eingang": body.channel})
    db.commit()
    return _detail(db, settings, access, ticket)


@router.get("/{number}")
def read_ticket(
    number: TicketNumber, access: AccessDep, db: DbDep, settings: SettingsDep
) -> TicketOut:
    return _detail(db, settings, access, _visible_ticket(db, access, number))


class ChangeIn(BaseModel):
    """Status und Zuständigkeit; gelten erst nach „Bestätigen“ in der Oberfläche.

    expected_*: Stand, den die Oberfläche angezeigt hat (Schutz vor gleichzeitigen Änderungen).
    assignee_oid: leer = niemand zuständig. Nicht gesetzt = unverändert.
    """

    expected_status: str = Field(max_length=20)
    expected_assignee_oid: str | None = Field(default=None, max_length=64)
    status: str | None = Field(default=None, max_length=20)
    change_assignee: bool = False
    assignee_oid: str | None = Field(default=None, max_length=64)
    handover_note: str = Field(default="", max_length=BODY_MAX)
    # Bei einer Übergabe: neue Person benachrichtigen (Glocke, Mail, Teams, Push je Einstellung)
    notify_assignee: bool = True
    # Für „Erinnerung“: Zeitpunkt (in der Zukunft) und optionales Stichwort
    reminder_at: datetime | None = None
    reminder_note: str = Field(default="", max_length=120)
    # Bei „Gelöst“: Lösung (freiwillig)
    solution: SolutionIn | None = None


@router.patch("/{number}")
def change_ticket(
    number: TicketNumber, body: ChangeIn, access: AccessDep, db: DbDep, settings: SettingsDep
) -> TicketOut:
    """Status und/oder Zuständigkeit ändern (mit Prüfung der Rechte)."""
    ticket = _visible_ticket(db, access, number, write=True)
    if not access.can_edit(ticket.area_id):
        raise forbidden("Dafür brauchst du im Bereich die Rolle „Bearbeiten“.")
    if ticket.status != body.expected_status or (ticket.assignee_oid or None) != (
        body.expected_assignee_oid or None
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Das Ticket wurde inzwischen geändert. Lade es neu und prüfe die Angaben.",
        )
    me_actor = actor(access)
    changed = False
    # Ereignisse für automatische Mails an den Melder: (Art, Bearbeiter)
    events: list[tuple[str, str]] = []
    if body.status is not None and body.status != ticket.status:
        if body.status not in SETTABLE_STATUSES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Diesen Status kannst du hier nicht setzen.",
            )
        if ticket.status == "merged":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ein zusammengeführtes Ticket lässt sich nicht mehr ändern.",
            )
        old = ticket.status
        if body.status == STATUS_REMINDER:
            when = body.reminder_at
            if when is None or when.tzinfo is None or when <= now_utc():
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Für die Erinnerung brauchst du einen Zeitpunkt in der Zukunft.",
                )
        set_status(ticket, body.status, db)
        label = STATUS_LABELS[body.status]
        if body.status == STATUS_REMINDER and body.reminder_at is not None:
            ticket.reminder_at = body.reminder_at
            ticket.reminder_note = " ".join(body.reminder_note.split())
            local = body.reminder_at.astimezone(work_zone())
            label += f" am {local:%d.%m.%Y um %H:%M}" + (
                f" ({ticket.reminder_note})" if ticket.reminder_note else ""
            )
        system_entry(db, ticket, f"Status: {STATUS_LABELS[old]} → {label}", me_actor)
        if body.status == STATUS_SOLVED:
            _set_solution(db, ticket, body.solution, me_actor)
        protocol(
            db, me_actor, "ticket_status", ticket=ticket, details={"von": old, "nach": body.status}
        )
        events.append((body.status, me_actor.name))
        changed = True
    if body.change_assignee:
        new_oid = (body.assignee_oid or "").lower() or None
        if new_oid != ticket.assignee_oid:
            _check_handover(db, access, ticket, new_oid)
            old_name = ticket.assignee_name or "niemand"
            if new_oid is None:
                new_name = ""
            elif new_oid == access.oid:
                new_name = me_actor.name
            else:
                new_name = next(
                    m.name for m, _ in area_people(db, ticket.area_id) if m.oid == new_oid
                )
            assign(ticket, new_oid, new_name, access.oid, notify=body.notify_assignee)
            if new_oid is not None:
                events.append(("assignee", new_name))
            ticket.updated_at = now_utc()
            system_entry(db, ticket, f"Zuständig: {old_name} → {new_name or 'niemand'}", me_actor)
            protocol(
                db,
                me_actor,
                "ticket_zustaendig",
                ticket=ticket,
                details={"zugewiesen": new_oid is not None},
            )
            note = body.handover_note.strip()
            if note:
                db.add(
                    TicketEntry(
                        ticket_id=ticket.id,
                        kind=ENTRY_NOTE,
                        body=note,
                        author_oid=access.oid,
                        author_name=me_actor.name,
                    )
                )
            changed = True
    if changed:
        _status_mails(db, settings, ticket, events)
        db.commit()
        db.refresh(ticket)
    return _detail(db, settings, access, ticket)


def _status_mails(
    db: Session, settings: Settings, ticket: Ticket, events: list[tuple[str, str]]
) -> None:
    """Automatische Mails an den Melder nach Status- oder Zuständigkeitswechsel (je Bereich)."""
    area = db.get(TicketArea, ticket.area_id)
    if area is None or not events or reply_problem(settings, area, ticket):
        return
    wanted = {**DEFAULT_EVENTS, **(area.mail_events or {})}
    todo = [(event, worker) for event, worker in events if wanted.get(event)]
    if not todo:
        return
    with new_http() as http:
        try:
            mailbox = open_mailbox(settings, http)
        except MailboxError as exc:
            system_entry(
                db, ticket, f"Mail an den Melder nicht gesendet: {exc}", Actor(None, "Werkbank")
            )
            return
        for event, worker in todo:
            message_id, error = send_to_reporter(
                db, mailbox, area, ticket, event_text(event, ticket, worker), kind=event, auto=True
            )
            text = (
                f"Mail an den Melder gesendet ({STATUS_LABELS.get(event, 'Zuständigkeit')})"
                if message_id
                else f"Mail an den Melder nicht gesendet: {error}"
            )
            db.add(
                TicketEntry(
                    ticket_id=ticket.id,
                    kind="system",
                    body=text,
                    author_name="Werkbank",
                    message_id=message_id,
                )
            )


def _check_handover(db: Session, access: TicketAccess, ticket: Ticket, new_oid: str | None) -> None:
    """Wer darf die Zuständigkeit wie ändern (spec.md 8e)?

    - Bereichsverwaltung: jede Änderung.
    - Bearbeiten: ein freies Ticket sich selbst nehmen; ein eigenes Ticket übergeben oder freigeben.
    Neue zuständige Person muss im Bereich bearbeiten dürfen.
    """
    if new_oid is not None:
        allowed = {m.oid for m, _ in area_people(db, ticket.area_id, (AREA_ADMIN, AREA_EDIT))}
        if new_oid != access.oid and new_oid not in allowed:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Diese Person kann im Bereich keine Tickets bearbeiten.",
            )
    if access.is_area_admin(ticket.area_id):
        return
    if ticket.assignee_oid is None and new_oid == access.oid:
        return
    if ticket.assignee_oid == access.oid:
        return
    raise forbidden("Übergeben darf nur die zuständige Person oder die Bereichsverwaltung.")


class DetailsIn(BaseModel):
    priority: Priority
    participants: list[ParticipantIn] = Field(default_factory=list, max_length=PARTICIPANTS_MAX)
    category_id: int | None = Field(default=None, ge=1, le=2_000_000_000)


@router.put("/{number}/details")
def change_details(
    number: TicketNumber, body: DetailsIn, access: AccessDep, db: DbDep, settings: SettingsDep
) -> TicketOut:
    """Priorität und Beteiligte."""
    ticket = _visible_ticket(db, access, number, write=True)
    if not access.can_edit(ticket.area_id):
        raise forbidden("Dafür brauchst du im Bereich die Rolle „Bearbeiten“.")
    me_actor = actor(access)
    if body.priority != ticket.priority:
        system_entry(
            db,
            ticket,
            f"Priorität: {PRIORITY_LABELS[ticket.priority]} → {PRIORITY_LABELS[body.priority]}",
            me_actor,
        )
        ticket.priority = body.priority
        recalc(db, ticket)
    category_id = _category_of(db, ticket.area_id, body.category_id)
    if category_id != ticket.category_id:
        names = _category_names(db)
        system_entry(
            db,
            ticket,
            f"Kategorie: {names.get(ticket.category_id or 0, 'keine')} → "
            f"{names.get(category_id or 0, 'keine')}",
            me_actor,
        )
        ticket.category_id = category_id
    db.query(TicketParticipant).filter(TicketParticipant.ticket_id == ticket.id).delete()
    _set_participants(db, ticket, body.participants)
    ticket.updated_at = now_utc()
    db.commit()
    db.refresh(ticket)
    return _detail(db, settings, access, ticket)


class MoveIn(BaseModel):
    area_id: int = Field(ge=1, le=2_000_000_000)


class MoveOut(BaseModel):
    visible: bool
    ticket: TicketOut | None


@router.post("/{number}/move")
def move_ticket(
    number: TicketNumber, body: MoveIn, access: AccessDep, db: DbDep, settings: SettingsDep
) -> MoveOut:
    """In einen anderen Bereich verschieben. Wer das Ziel nicht sieht, verliert den Zugriff."""
    ticket = _visible_ticket(db, access, number, write=True)
    if not access.can_edit(ticket.area_id):
        raise forbidden("Dafür brauchst du im Bereich die Rolle „Bearbeiten“.")
    target = db.get(TicketArea, body.area_id)
    if target is None or not target.active or target.id == ticket.area_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Diesen Bereich gibt es nicht."
        )
    me_actor = actor(access)
    names = _area_names(db)
    old_area = ticket.area_id
    ticket.area_id = target.id
    assign(ticket, None, "", access.oid)
    ticket.category_id = None
    ticket.updated_at = now_utc()
    system_entry(db, ticket, f"Verschoben: {names.get(old_area, '')} → {target.name}", me_actor)
    protocol(
        db,
        me_actor,
        "ticket_verschoben",
        ticket=ticket,
        details={"von": old_area, "nach": target.id},
    )
    db.flush()
    recalc(db, ticket, target)
    assign_new(db, ticket, target)
    db.commit()
    db.refresh(ticket)
    if not access.can_read(target.id):
        return MoveOut(visible=False, ticket=None)
    return MoveOut(visible=True, ticket=_detail(db, settings, access, ticket))


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=BODY_MAX)

    @field_validator("body")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Darf nicht leer sein.")
        return value


@router.post("/{number}/notes", status_code=status.HTTP_201_CREATED)
def add_note(
    number: TicketNumber, body: NoteIn, access: AccessDep, db: DbDep, settings: SettingsDep
) -> TicketOut:
    """Interne Notiz. Der Melder sieht sie nicht und bekommt keine Mail."""
    ticket = _visible_ticket(db, access, number, write=True)
    db.add(
        TicketEntry(
            ticket_id=ticket.id,
            kind=ENTRY_NOTE,
            body=body.body,
            author_oid=access.oid,
            author_name=access.user.display_name,
        )
    )
    ticket.updated_at = now_utc()
    db.commit()
    db.refresh(ticket)
    return _detail(db, settings, access, ticket)


class ReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=BODY_MAX)
    # Status danach: "" = unverändert
    status_after: Literal["", "waiting", "solved"] = ""
    # An alle: Beteiligte in Kopie; sonst nur an den Melder
    reply_all: bool = False
    # Bei „Status danach: Gelöst“: Lösung (freiwillig), steht dann auch in dieser Mail
    solution: SolutionIn | None = None

    @field_validator("body")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Darf nicht leer sein.")
        return value


@router.post("/{number}/replies", status_code=status.HTTP_201_CREATED)
def send_reply(
    number: TicketNumber, body: ReplyIn, access: AccessDep, db: DbDep, settings: SettingsDep
) -> TicketOut:
    """Antwort an den Melder (Mail aus dem Postfach des Bereichs); „an alle“ mit den
    Beteiligten in Kopie."""
    ticket = _visible_ticket(db, access, number, write=True)
    if not access.can_edit(ticket.area_id):
        raise forbidden("Dafür brauchst du im Bereich die Rolle „Bearbeiten“.")
    area = db.get(TicketArea, ticket.area_id)
    problem = reply_problem(settings, area, ticket)
    if problem or area is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=problem)
    me_actor = actor(access)
    solving = body.status_after == STATUS_SOLVED and ticket.status != STATUS_SOLVED
    before = (ticket.solution_type_id, ticket.solution_text, ticket.solution_public)
    if solving:
        # Die Mail zeigt die Lösung schon; gesetzt bleibt sie nur, wenn die Mail rausgeht
        _set_solution(db, ticket, body.solution, me_actor, note=False)
    with new_http() as http:
        try:
            mailbox = open_mailbox(settings, http)
        except MailboxError as exc:
            ticket.solution_type_id, ticket.solution_text, ticket.solution_public = before
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
            ) from exc
        sent_to: list[str] = []
        message_id, error = send_to_reporter(
            db,
            mailbox,
            area,
            ticket,
            body.body,
            kind="antwort",
            auto=False,
            cc_all=body.reply_all,
            sent_to=sent_to,
            # Die Mail nennt den Status nach der Antwort
            status=body.status_after
            or (STATUS_IN_PROGRESS if ticket.status == "new" else ticket.status),
            author=me_actor.name,
        )
    if message_id is None:
        ticket.solution_type_id, ticket.solution_text, ticket.solution_public = before
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Die Antwort konnte nicht gesendet werden: {error}",
        )
    db.add(
        TicketEntry(
            ticket_id=ticket.id,
            kind="reply",
            body=body.body,
            author_oid=access.oid,
            author_name=me_actor.name,
            message_id=message_id,
            recipients=", ".join(sent_to)[:2000],
        )
    )
    now = now_utc()
    if ticket.first_response_at is None:
        ticket.first_response_at = now
        on_first_response(ticket)
    if body.status_after and body.status_after != ticket.status:
        old = ticket.status
        set_status(ticket, body.status_after, db)
        system_entry(
            db,
            ticket,
            f"Status: {STATUS_LABELS[old]} → {STATUS_LABELS[body.status_after]}",
            me_actor,
        )
        if solving:
            _set_solution(db, ticket, body.solution, me_actor)
        protocol(
            db,
            me_actor,
            "ticket_status",
            ticket=ticket,
            details={"von": old, "nach": body.status_after},
        )
    elif ticket.status == "new":
        old = ticket.status
        set_status(ticket, STATUS_IN_PROGRESS, db)
        system_entry(db, ticket, f"Status: {STATUS_LABELS[old]} → In Arbeit", me_actor)
    ticket.updated_at = now
    protocol(db, me_actor, "ticket_antwort", ticket=ticket, details={"an_alle": body.reply_all})
    db.commit()
    db.refresh(ticket)
    return _detail(db, settings, access, ticket)


class ForwardIn(BaseModel):
    to: list[Mail] = Field(min_length=1, max_length=10)
    text: str = Field(default="", max_length=4000)
    # Eintrag, der weitergeleitet wird; leer = die ursprüngliche Meldung
    entry_id: str | None = Field(default=None, max_length=36)
    attachments: bool = True


@router.post("/{number}/forward", status_code=status.HTTP_201_CREATED)
def forward(
    number: TicketNumber, body: ForwardIn, access: AccessDep, db: DbDep, settings: SettingsDep
) -> TicketOut:
    """Nachricht aus dem Postfach des Bereichs weiterleiten. Der Melder bekommt davon nichts mit;
    im Verlauf steht ein interner Eintrag. Antworten landen über die Nummer im Ticket."""
    ticket = _visible_ticket(db, access, number, write=True)
    if not access.can_edit(ticket.area_id):
        raise forbidden("Dafür brauchst du im Bereich die Rolle „Bearbeiten“.")
    area = db.get(TicketArea, ticket.area_id)
    if area is None or not area.mailbox:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Für den Bereich ist kein Postfach eingetragen.",
        )
    if not available(settings):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Die Postfächer der Tickets sind noch nicht eingerichtet.",
        )
    query = select(TicketEntry).where(TicketEntry.ticket_id == ticket.id)
    if body.entry_id:
        try:
            wanted = uuid.UUID(body.entry_id)
        except ValueError as exc:
            raise not_found() from exc
        source = db.scalar(query.where(TicketEntry.id == wanted))
    else:
        source = db.scalar(query.where(TicketEntry.original.is_(True)))
    if source is None or source.kind not in (ENTRY_INBOUND, "reply"):
        raise not_found()
    to = [str(m).lower() for m in body.to]
    stamp = source.created_at.astimezone(work_zone()).strftime("%d.%m.%Y %H:%M")
    quoted = (
        f"Von: {source.author_name}"
        + (f" <{source.author_mail}>" if source.author_mail else "")
        + f"\nDatum: {stamp}\nBetreff: {ticket.subject}\n\n{source.body}"
    )
    files: list[tuple[str, str, bytes]] = []
    if body.attachments:
        for att in db.scalars(
            select(TicketAttachment).where(
                TicketAttachment.entry_id == source.id,
                TicketAttachment.key.is_not(None),
                TicketAttachment.original.is_(False),
            )
        ):
            path = file_path(settings.tickets_files_dir, att.key or "")
            if path is not None and path.exists():
                files.append((att.filename, att.content_type, path.read_bytes()))
    message, message_id = build_forward(db, area, ticket, to, body.text, quoted, files)
    me = actor(access)
    with new_http() as http:
        try:
            mailbox = open_mailbox(settings, http)
            mailbox.send(area.mailbox, mime_bytes(message))
        except MailboxError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Die Weiterleitung konnte nicht gesendet werden: {exc}",
            ) from exc
    db.add(
        TicketMailOut(
            ticket_id=ticket.id,
            area_id=area.id,
            kind="weiterleitung",
            recipients=", ".join(to)[:2000],
            message_id=message_id,
        )
    )
    db.add(
        TicketEntry(
            ticket_id=ticket.id,
            kind=ENTRY_FORWARD,
            body=body.text.strip() or "(ohne eigenen Text)",
            author_oid=access.oid,
            author_name=me.name,
            message_id=message_id,
            recipients=", ".join(to)[:2000],
        )
    )
    ticket.updated_at = now_utc()
    protocol(
        db,
        me,
        "ticket_weitergeleitet",
        ticket=ticket,
        details={"empfaenger": len(to), "anhaenge": len(files)},
    )
    db.commit()
    db.refresh(ticket)
    return _detail(db, settings, access, ticket)


def _attachment_file(
    db: Session, settings: Settings, access: TicketAccess, number: int, attachment_id: str
) -> tuple[Ticket, TicketAttachment, FilePath]:
    ticket = _visible_ticket(db, access, number)
    try:
        att_uuid = uuid.UUID(attachment_id)
    except ValueError as exc:
        raise not_found() from exc
    att = db.get(TicketAttachment, att_uuid)
    if att is None or att.ticket_id != ticket.id or not att.key:
        raise not_found()
    path = file_path(settings.tickets_files_dir, att.key)
    if path is None or not path.is_file():
        raise not_found()
    return ticket, att, path


def _audit_file(db: Session, access: TicketAccess, ticket: Ticket) -> None:
    write_audit(
        db,
        module="tickets",
        action="anhang_geladen",
        object_type="ticket",
        object_id=f"T-{ticket.number}",
        user_id=access.user.user_id,
    )
    db.commit()


@router.get("/{number}/attachments/{attachment_id}")
def download_attachment(
    number: TicketNumber,
    attachment_id: Annotated[str, Path(min_length=36, max_length=36)],
    access: AccessDep,
    db: DbDep,
    settings: SettingsDep,
    view: Annotated[bool, Query()] = False,
) -> FileResponse:
    """Anhang herunterladen; mit `view` Bilder und PDF im Browser anzeigen.

    Angezeigt wird nur, was am Inhalt als Bild oder PDF erkannt wird. Bilder laufen in einer
    Sandbox ohne Skripte. Das Ansehen von Bildern (auch die Vorschaubilder im Verlauf) wird
    nicht protokolliert, Downloads und PDF schon.
    """
    ticket, att, path = _attachment_file(db, settings, access, number, attachment_id)
    headers = {"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"}
    if view:
        kind = preview_kind(att.content_type)
        if kind not in ("image", "pdf") or not matches(att.content_type, read_head(path)):
            raise not_found()
        if kind == "pdf":
            _audit_file(db, access, ticket)
            # Ohne Sandbox, sonst zeigt der Browser seine PDF-Ansicht nicht
            headers["Content-Security-Policy"] = (
                "default-src 'none'; object-src 'self'; frame-ancestors 'none'"
            )
        else:
            headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return FileResponse(
            path,
            media_type=att.content_type,
            filename=att.filename,
            content_disposition_type="inline",
            headers=headers,
        )
    _audit_file(db, access, ticket)
    return FileResponse(
        path,
        media_type=att.content_type
        if not att.content_type.startswith("text/")
        else "application/octet-stream",
        filename=att.filename,
        content_disposition_type="attachment",
        headers=headers,
    )


@router.get("/{number}/attachments/{attachment_id}/text")
def attachment_text(
    number: TicketNumber,
    attachment_id: Annotated[str, Path(min_length=36, max_length=36)],
    access: AccessDep,
    db: DbDep,
    settings: SettingsDep,
) -> TextPreviewOut:
    """Textdatei (.txt, .log, .csv, .eml) als Auszug: die ersten 200 KB."""
    ticket, att, path = _attachment_file(db, settings, access, number, attachment_id)
    if preview_kind(att.content_type) != "text":
        raise not_found()
    text, truncated = read_text(path)
    _audit_file(db, access, ticket)
    return TextPreviewOut(text=text, truncated=truncated)
