"""Betrieb im Modul Tickets (spec.md 8e, Phase 4): Übersicht mit Kennzahlen, Export als Excel,
Aufbewahrung (Vorgabe, Abweichung je Bereich, Ausnahmen, Läufe) und Protokoll.

Alles nur für die eigenen Bereiche; der Export nur für die Bereichsverwaltung."""

from datetime import date, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select

from werkbank.core.deps import DbDep, SettingsDep
from werkbank.core.sessions import now_utc
from werkbank.core.xlsx import XLSX_TYPE, Cell, Sheet, workbook
from werkbank.modules.inventory.people import PeopleError, PeopleFinder, get_people_finder
from werkbank.modules.tickets.access import AccessDep, forbidden, not_found
from werkbank.modules.tickets.api import (
    TicketItem,
    TicketNumber,
    TicketOut,
    View,
    _area_names,
    _category_names,
    _conditions,
    _detail,
    _item,
    _visible_ticket,
    actor,
)
from werkbank.modules.tickets.models import (
    CHANNELS,
    OPEN_STATUSES,
    STATUS_CLOSED,
    STATUS_MERGED,
    STATUS_NEW,
    STATUS_REMINDER,
    STATUS_SOLVED,
    STATUS_WAITING,
    Ticket,
    TicketArea,
    TicketAudit,
    TicketRetentionRun,
    TicketSolutionType,
)
from werkbank.modules.tickets.retention import (
    Policy,
    clear_hold,
    default_policy,
    due_query,
    preview,
    set_hold,
)
from werkbank.modules.tickets.service import protocol
from werkbank.modules.tickets.settings_api import _area_for_settings
from werkbank.modules.tickets.sla import work_zone

router = APIRouter(prefix="/api/tickets")
AreaQuery = Annotated[int | None, Query(ge=1, le=2_000_000_000)]
LIST_SHORT = 5
RECENT_DAYS = 30
SLA_DAYS = 90
EXPORT_MAX = 10_000
AUDIT_PAGE = 50

STATUS_NAMES = {
    "new": "Neu",
    "in_progress": "In Arbeit",
    "waiting": "Wartet auf Rückmeldung",
    "reminder": "Erinnerung",
    "solved": "Gelöst",
    "closed": "Geschlossen",
    "merged": "Zusammengeführt",
}
PRIORITY_NAMES = {"low": "Niedrig", "medium": "Mittel", "high": "Hoch"}
CHANNEL_NAMES = {"mail": "E-Mail", "manual": "Von Hand", "phone": "Telefon"}


# --- Übersicht -----------------------------------------------------------------------------


class Count(BaseModel):
    key: str
    label: str
    count: int


class SlaShare(BaseModel):
    met: int
    total: int


class StatsOut(BaseModel):
    open: int
    mine: int
    unassigned_new: int
    waiting: int
    reminder: int
    # Nur, wenn mindestens ein gewählter Bereich Fristen hat
    overdue: int | None
    sla: SlaShare | None
    solved_recent: int
    created_by_channel: list[Count]
    open_by_category: list[Count]
    # Gelöst oder geschlossen in den letzten Tagen, nach Lösungsart
    solved_by_type: list[Count]
    mine_list: list[TicketItem]
    unassigned_list: list[TicketItem]


@router.get("/stats")
def stats(access: AccessDep, db: DbDep, area: AreaQuery = None) -> StatsOut:
    """Kennzahlen der eigenen Bereiche (oder eines davon)."""
    areas = [a for a in access.visible_areas if area is None or a == area]
    if area is not None and not areas:
        raise not_found()
    now = now_utc()
    in_areas = Ticket.area_id.in_(areas)
    open_ = [in_areas, Ticket.status.in_(OPEN_STATUSES)]

    def count(*where: Any) -> int:
        return db.scalar(select(func.count()).select_from(Ticket).where(*where)) or 0

    sla_areas = list(
        db.scalars(select(TicketArea.id).where(TicketArea.id.in_(areas), TicketArea.sla_enabled))
    )
    overdue: int | None = None
    sla: SlaShare | None = None
    if sla_areas:
        overdue = count(
            Ticket.area_id.in_(sla_areas),
            Ticket.status.in_(OPEN_STATUSES),
            Ticket.sla_solution_due < now,
            Ticket.sla_paused_since.is_(None),
        )
        decided = [
            Ticket.area_id.in_(sla_areas),
            Ticket.sla_solution_met.is_not(None),
            Ticket.updated_at >= now - timedelta(days=SLA_DAYS),
        ]
        sla = SlaShare(
            met=count(*decided, Ticket.sla_solution_met.is_(True)), total=count(*decided)
        )
    recent = now - timedelta(days=RECENT_DAYS)
    channels = dict(
        db.execute(
            select(Ticket.channel, func.count())
            .where(in_areas, Ticket.created_at >= recent)
            .group_by(Ticket.channel)
        )
        .tuples()
        .all()
    )
    categories = dict(
        db.execute(
            select(Ticket.category_id, func.count()).where(*open_).group_by(Ticket.category_id)
        )
        .tuples()
        .all()
    )
    names = _category_names(db)
    by_category = sorted(
        (
            Count(key=str(cid or 0), label=names.get(cid or 0, "") or "Ohne Kategorie", count=n)
            for cid, n in categories.items()
        ),
        key=lambda c: (-c.count, c.label),
    )
    solved = (
        db.execute(
            select(TicketSolutionType.name, func.count())
            .select_from(Ticket)
            .outerjoin(TicketSolutionType, Ticket.solution_type_id == TicketSolutionType.id)
            .where(
                in_areas,
                Ticket.status.in_((STATUS_SOLVED, STATUS_CLOSED)),
                or_(Ticket.solved_at >= recent, Ticket.closed_at >= recent),
            )
            .group_by(TicketSolutionType.name)
        )
        .tuples()
        .all()
    )
    solved_by_type = sorted(
        (Count(key=name or "", label=name or "Ohne Lösungsart", count=n) for name, n in solved),
        key=lambda c: (-c.count, c.label),
    )
    area_names = _area_names(db)

    def short(*where: Any) -> list[TicketItem]:
        rows = db.scalars(
            select(Ticket)
            .where(*where)
            .order_by(Ticket.updated_at.desc(), Ticket.number.desc())
            .limit(LIST_SHORT)
        ).all()
        return [_item(t, area_names, access, names) for t in rows]

    unassigned_new = [*open_, Ticket.status == STATUS_NEW, Ticket.assignee_oid.is_(None)]
    mine = [*open_, Ticket.assignee_oid == access.oid]
    return StatsOut(
        open=count(*open_),
        mine=count(*mine),
        unassigned_new=count(*unassigned_new),
        waiting=count(in_areas, Ticket.status == STATUS_WAITING),
        reminder=count(in_areas, Ticket.status == STATUS_REMINDER),
        overdue=overdue,
        sla=sla,
        solved_recent=count(
            in_areas,
            Ticket.status != STATUS_MERGED,
            or_(Ticket.solved_at >= recent, Ticket.closed_at >= recent),
        ),
        created_by_channel=[
            Count(key=c, label=CHANNEL_NAMES[c], count=channels.get(c, 0)) for c in CHANNELS
        ],
        open_by_category=by_category,
        solved_by_type=solved_by_type,
        mine_list=short(*mine),
        unassigned_list=short(*unassigned_new),
    )


# --- Melder aus Entra ----------------------------------------------------------------------


class PersonOut(BaseModel):
    name: str
    mail: str
    detail: str


@router.get("/people")
def search_reporters(
    access: AccessDep,
    finder: Annotated[PeopleFinder, Depends(get_people_finder)],
    q: Annotated[str, Query(max_length=60)] = "",
) -> list[PersonOut]:
    """Personen in Entra für das Feld „Melder“ (wer in einem Bereich Tickets anlegen darf)."""
    if not access.can_create:
        raise forbidden("Tickets anlegen darf, wer in einem Bereich „Bearbeiten“ hat.")
    if len(q.strip()) < 2:
        return []
    try:
        people = finder(q.strip())
    except PeopleError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
        ) from exc
    return [
        PersonOut(name=p.name, mail=p.mail or p.upn, detail=p.department)
        for p in people
        if p.enabled
    ][:8]


# --- Export --------------------------------------------------------------------------------


def _local(value: datetime | None) -> str:
    if value is None:
        return ""
    return value.astimezone(work_zone()).strftime("%d.%m.%Y %H:%M")


@router.get("/export")
def export(
    access: AccessDep,
    db: DbDep,
    view: View = "open",
    area: AreaQuery = None,
    q: Annotated[str, Query(max_length=100)] = "",
) -> Response:
    """Liste als Excel-Datei, nur aus Bereichen mit Bereichsverwaltung; ohne Texte."""
    allowed = access.admin_areas
    if not allowed:
        raise forbidden("Exportieren darf nur die Bereichsverwaltung.")
    if area is not None and area not in allowed:
        raise not_found()
    where = [*_conditions(access, view, area, q), Ticket.area_id.in_(allowed)]
    rows = db.scalars(
        select(Ticket)
        .where(*where)
        .order_by(Ticket.updated_at.desc(), Ticket.number.desc())
        .limit(EXPORT_MAX)
    ).all()
    area_rows = {a.id: a for a in db.scalars(select(TicketArea))}
    categories = _category_names(db)
    with_sla = any(area_rows[t.area_id].sla_enabled for t in rows if t.area_id in area_rows)
    header: list[Cell] = [
        "Nr.",
        "Betreff",
        "Bereich",
        "Status",
        "Kategorie",
        "Priorität",
        "Zuständig",
        "Melder",
        "Mail des Melders",
        "Eingang",
        "Angelegt",
        "Geändert",
        "Gelöst",
        "Geschlossen",
    ]
    if with_sla:
        header += ["Frist Lösung", "Frist eingehalten"]
    table: list[list[Cell]] = [header]
    for t in rows:
        a = area_rows.get(t.area_id)
        row: list[Cell] = [
            f"T-{t.number}",
            t.subject,
            a.name if a else "",
            STATUS_NAMES.get(t.status, t.status),
            categories.get(t.category_id or 0, ""),
            PRIORITY_NAMES.get(t.priority, t.priority),
            t.assignee_name,
            t.reporter_name,
            t.reporter_mail,
            CHANNEL_NAMES.get(t.channel, t.channel),
            _local(t.created_at),
            _local(t.updated_at),
            _local(t.solved_at),
            _local(t.closed_at),
        ]
        if with_sla:
            if a is not None and a.sla_enabled and t.sla_solution_due is not None:
                met = "" if t.sla_solution_met is None else ("ja" if t.sla_solution_met else "nein")
                row += [_local(t.sla_solution_due), met]
            else:
                row += ["", ""]
        table.append(row)
    data = workbook([Sheet(name="Tickets", rows=table)])
    # Je betroffenem Bereich ein Eintrag, damit jede Bereichsverwaltung ihn sieht
    per_area: dict[int, int] = {}
    for t in rows:
        per_area[t.area_id] = per_area.get(t.area_id, 0) + 1
    for area_id in [area] if area is not None else allowed:
        protocol(
            db,
            actor(access),
            "export",
            area_id=area_id,
            details={
                "anzahl": per_area.get(area_id, 0),
                "ansicht": view,
                "suche": bool(q.strip()),
            },
        )
    db.commit()
    filename = f"tickets-{date.today().isoformat()}.xlsx"
    return Response(
        content=data,
        media_type=XLSX_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-store",
        },
    )


# --- Aufbewahrung --------------------------------------------------------------------------


Action = Literal["anonymize", "delete"]


class RetentionDefault(BaseModel):
    months: int = Field(ge=0, le=1200)
    action: Action


@router.get("/settings/retention")
def read_retention_default(access: AccessDep, db: DbDep) -> RetentionDefault:
    if not access.settings_visible:
        raise not_found()
    row = default_policy(db)
    db.commit()
    return RetentionDefault(months=row.months, action=row.action)  # type: ignore[arg-type]


@router.put("/settings/retention")
def update_retention_default(
    body: RetentionDefault, access: AccessDep, db: DbDep
) -> RetentionDefault:
    """Vorgabe für alle Bereiche (nur Ticket-Verwaltung)."""
    if not access.manager:
        raise not_found()
    row = default_policy(db)
    before = {"monate": row.months, "aktion": row.action}
    row.months = body.months
    row.action = body.action
    protocol(
        db,
        actor(access),
        "aufbewahrung_vorgabe",
        details={"vorher": before, "nachher": {"monate": body.months, "aktion": body.action}},
    )
    db.commit()
    return body


class RunOut(BaseModel):
    started_at: datetime
    anonymized: int
    deleted: int
    holds_expired: int


class RetentionAreaOut(BaseModel):
    custom: bool
    months: int
    action: str
    default: RetentionDefault
    # Wirksam (Vorgabe oder Abweichung)
    effective_months: int
    effective_action: str
    due: int
    due_numbers: list[int]
    holds: int
    holds_expiring: list[int]
    runs: list[RunOut]


class RetentionAreaIn(BaseModel):
    custom: bool
    months: int = Field(ge=0, le=1200)
    action: Action


def _retention_out(db: DbDep, area: TicketArea) -> RetentionAreaOut:
    default = default_policy(db)
    pre = preview(db, area)
    runs: list[RunOut] = []
    for run in db.scalars(
        select(TicketRetentionRun).order_by(TicketRetentionRun.id.desc()).limit(10)
    ):
        stats = run.areas.get(str(area.id))
        values = stats if isinstance(stats, dict) else {}
        runs.append(
            RunOut(
                started_at=run.started_at,
                anonymized=int(values.get("anonymized", 0)),
                deleted=int(values.get("deleted", 0)),
                holds_expired=int(values.get("holds_expired", 0)),
            )
        )
    return RetentionAreaOut(
        custom=area.retention_custom,
        months=area.retention_months,
        action=area.retention_action,
        default=RetentionDefault(months=default.months, action=default.action),  # type: ignore[arg-type]
        effective_months=pre.policy.months,
        effective_action=pre.policy.action,
        due=pre.count,
        due_numbers=pre.numbers,
        holds=pre.holds,
        holds_expiring=pre.holds_expiring,
        runs=runs,
    )


@router.get("/settings/areas/{area_id}/retention")
def read_area_retention(area_id: int, access: AccessDep, db: DbDep) -> RetentionAreaOut:
    area = _area_for_settings(db, access, area_id)
    out = _retention_out(db, area)
    db.commit()
    return out


@router.put("/settings/areas/{area_id}/retention")
def update_area_retention(
    area_id: int, body: RetentionAreaIn, access: AccessDep, db: DbDep
) -> RetentionAreaOut:
    """Abweichung je Bereich (Bereichsverwaltung oder Ticket-Verwaltung)."""
    area = _area_for_settings(db, access, area_id)
    before = {
        "abweichung": area.retention_custom,
        "monate": area.retention_months,
        "aktion": area.retention_action,
    }
    area.retention_custom = body.custom
    if body.custom:
        area.retention_months = body.months
        area.retention_action = body.action
    protocol(
        db,
        actor(access),
        "aufbewahrung_bereich",
        area_id=area.id,
        details={
            "vorher": before,
            "nachher": {"abweichung": body.custom, "monate": body.months, "aktion": body.action},
        },
    )
    db.commit()
    return _retention_out(db, area)


class DueOut(BaseModel):
    due: int


@router.post("/settings/areas/{area_id}/retention/preview")
def preview_area_retention(
    area_id: int, body: RetentionAreaIn, access: AccessDep, db: DbDep
) -> DueOut:
    """Wie viele Tickets wären mit dieser Regel beim nächsten Lauf dran? (ohne zu speichern)"""
    area = _area_for_settings(db, access, area_id)
    default = default_policy(db)
    policy = (
        Policy(body.months, body.action, True)
        if body.custom
        else Policy(default.months, default.action, False)
    )
    db.rollback()
    if not policy.active:
        return DueOut(due=0)
    query = due_query(area.id, policy, now_utc())
    return DueOut(due=db.scalar(select(func.count()).select_from(query.subquery())) or 0)


class HoldIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)

    @field_validator("reason")
    @classmethod
    def _reason(cls, value: str) -> str:
        value = " ".join(value.split())
        if not value:
            raise ValueError("Bitte gib eine Begründung an.")
        return value


@router.put("/{number}/hold")
def put_hold(
    number: TicketNumber, body: HoldIn, access: AccessDep, db: DbDep, settings: SettingsDep
) -> TicketOut:
    """Ausnahme von der Aufbewahrung setzen oder für ein weiteres Jahr bestätigen."""
    ticket = _visible_ticket(db, access, number)
    if not access.is_area_admin(ticket.area_id):
        raise forbidden("Ausnahmen setzt nur die Bereichsverwaltung.")
    if ticket.anonymized_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Das Ticket ist schon anonymisiert."
        )
    renewed = ticket.hold_until is not None
    set_hold(ticket, body.reason, access.user.display_name, now_utc())
    protocol(
        db,
        actor(access),
        "aufbewahrung_ausnahme_bestaetigt" if renewed else "aufbewahrung_ausnahme",
        ticket=ticket,
        details={"bis": ticket.hold_until.date().isoformat() if ticket.hold_until else ""},
    )
    db.commit()
    db.refresh(ticket)
    return _detail(db, settings, access, ticket)


@router.delete("/{number}/hold")
def delete_hold(
    number: TicketNumber, access: AccessDep, db: DbDep, settings: SettingsDep
) -> TicketOut:
    ticket = _visible_ticket(db, access, number)
    if not access.is_area_admin(ticket.area_id):
        raise forbidden("Ausnahmen hebt nur die Bereichsverwaltung auf.")
    if ticket.hold_until is not None:
        clear_hold(ticket)
        protocol(db, actor(access), "aufbewahrung_ausnahme_aufgehoben", ticket=ticket)
        db.commit()
        db.refresh(ticket)
    return _detail(db, settings, access, ticket)


# --- Protokoll -----------------------------------------------------------------------------


class AuditOut(BaseModel):
    occurred_at: datetime
    actor_name: str
    area: str
    action: str
    ticket_number: int | None
    details: dict[str, Any]


class AuditPage(BaseModel):
    items: list[AuditOut]
    has_more: bool


@router.get("/settings/audit")
def read_audit(
    access: AccessDep,
    db: DbDep,
    area: AreaQuery = None,
    offset: Annotated[int, Query(ge=0, le=1_000_000)] = 0,
) -> AuditPage:
    """Protokoll des Moduls: Ticket-Verwaltung alles, Bereichsverwaltung ihre Bereiche."""
    if not access.settings_visible:
        raise not_found()
    where: list[Any] = []
    if area is not None:
        if not (access.manager or access.is_area_admin(area)):
            raise not_found()
        where.append(TicketAudit.area_id == area)
    elif not access.manager:
        where.append(TicketAudit.area_id.in_(access.admin_areas))
    rows = db.scalars(
        select(TicketAudit)
        .where(*where)
        .order_by(TicketAudit.occurred_at.desc(), TicketAudit.id.desc())
        .offset(offset)
        .limit(AUDIT_PAGE + 1)
    ).all()
    names = _area_names(db)
    return AuditPage(
        items=[
            AuditOut(
                occurred_at=r.occurred_at,
                actor_name=r.actor_name,
                area=names.get(r.area_id or 0, ""),
                action=r.action,
                ticket_number=r.ticket_number,
                details=dict(r.details or {}),
            )
            for r in rows[:AUDIT_PAGE]
        ],
        has_more=len(rows) > AUDIT_PAGE,
    )
