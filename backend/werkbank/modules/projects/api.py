"""API des Bereichs IT-Projekte: Projekte, Budget, Aufgaben und Jour Fixe mit PDF-Anhängen."""

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep, require_roles
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.budget.documents import (
    PDF_TYPE,
    clean_name,
    document_path,
    looks_like_pdf,
    remove_document,
    store_document,
)
from werkbank.modules.budget.models import (
    BudgetAccount,
    BudgetInvoice,
    BudgetInvoiceLine,
    BudgetItem,
)
from werkbank.modules.budget.plan import YearLines, expected_in, forecast
from werkbank.modules.budget.settings import (
    YEAR_MAX,
    YEAR_MIN,
    fiscal_year_name,
    fiscal_year_of,
    load_settings,
)
from werkbank.modules.projects.models import (
    Project,
    ProjectLink,
    ProjectMeeting,
    ProjectMeetingFile,
    ProjectPerson,
    ProjectTask,
)

router = APIRouter(prefix="/api/projects")

MODULE = "projekte"
STATUSES = ("geplant", "aktiv", "pausiert", "abgeschlossen")
STATUS_CLOSED = "abgeschlossen"
KINDS = ("intern", "extern")
# Obergrenzen je Projekt und Eintrag
PEOPLE_MAX = 50
LINKS_MAX = 30
TASKS_MAX = 500
FILES_MAX = 10
BODY_MAX = 50_000
# Obergrenze je Betrag: 10 Milliarden Euro in Cent (wie im IT-Budget)
AMOUNT_MAX = 1_000_000_000_000
# So viele offene Aufgaben zeigt die Übersicht eines Projekts.
OVERVIEW_TASKS = 5
BUDGET_STATUS = "gebucht"

Reader = Annotated[CurrentUser, Depends(require_roles(Role.PROJECTS_READER, Role.PROJECTS_EDITOR))]
Editor = Annotated[CurrentUser, Depends(require_roles(Role.PROJECTS_EDITOR))]
# Die Auswahl „Projekt“ am Budgetposten brauchen auch Personen aus dem IT-Budget.
Chooser = Annotated[
    CurrentUser,
    Depends(
        require_roles(
            Role.PROJECTS_READER,
            Role.PROJECTS_EDITOR,
            Role.BUDGET_READER,
            Role.BUDGET_EDITOR,
            Role.BUDGET_MANAGER,
        )
    ),
]
ProjectId = Annotated[int, Path(ge=1)]
TaskId = Annotated[int, Path(ge=1)]
MeetingId = Annotated[int, Path(ge=1)]
FileId = Annotated[int, Path(ge=1)]


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _single_line(value: str) -> str:
    value = value.strip()
    if any(ord(char) < 32 for char in value):
        raise ValueError("Keine Zeilenumbrüche oder Steuerzeichen")
    return value


def valid_link(value: str) -> bool:
    """Nur vollständige https-Adressen mit Host, ohne Zugangsdaten und Leerzeichen."""
    if not value or any(char.isspace() or ord(char) < 32 for char in value):
        return False
    try:
        parts = urlsplit(value)
    except ValueError:
        return False
    return (
        parts.scheme == "https"
        and bool(parts.hostname)
        and parts.username is None
        and parts.password is None
    )


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")


# --- Schemas ------------------------------------------------------------------------------


class PersonIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    role: str = Field(default="", max_length=120)
    kind: Literal["intern", "extern"] = "intern"
    organisation: str = Field(default="", max_length=160)
    contact: str = Field(default="", max_length=200)

    @field_validator("name", "role", "organisation", "contact")
    @classmethod
    def plain(cls, value: str) -> str:
        return _single_line(value)

    @field_validator("name")
    @classmethod
    def not_empty(cls, value: str) -> str:
        if not value:
            raise ValueError("Darf nicht leer sein")
        return value


class PersonOut(BaseModel):
    name: str
    role: str
    kind: str
    organisation: str
    contact: str


class LinkIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=1, max_length=500)

    @field_validator("label", "url")
    @classmethod
    def plain(cls, value: str) -> str:
        return _single_line(value)

    @field_validator("label")
    @classmethod
    def not_empty(cls, value: str) -> str:
        if not value:
            raise ValueError("Darf nicht leer sein")
        return value

    @field_validator("url")
    @classmethod
    def https_only(cls, value: str) -> str:
        if not valid_link(value):
            raise ValueError("Nur vollständige https-Adressen")
        return value


class LinkOut(BaseModel):
    label: str
    url: str


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=500)
    status: Literal["geplant", "aktiv", "pausiert", "abgeschlossen"] = "aktiv"
    starts_on: date | None = None
    ends_on: date | None = None
    budget_cents: int | None = Field(default=None, ge=0, le=AMOUNT_MAX)
    budget_approved_on: date | None = None
    budget_note: str = Field(default="", max_length=200)
    people: list[PersonIn] = Field(default_factory=list, max_length=PEOPLE_MAX)
    links: list[LinkIn] = Field(default_factory=list, max_length=LINKS_MAX)

    @field_validator("name", "description", "budget_note")
    @classmethod
    def plain(cls, value: str) -> str:
        return _single_line(value)

    @field_validator("name")
    @classmethod
    def not_empty(cls, value: str) -> str:
        if not value:
            raise ValueError("Darf nicht leer sein")
        return value

    @model_validator(mode="after")
    def end_after_start(self) -> "ProjectIn":
        if self.starts_on and self.ends_on and self.ends_on < self.starts_on:
            raise ValueError("Das Projekt endet vor seinem Beginn")
        return self


class BudgetSums(BaseModel):
    # Veranschlagt im Projekt; None: nicht hinterlegt
    budget_cents: int | None
    # Erwartete Kosten der Posten, für die noch keine gebuchte Rechnung da ist
    planned_cents: int
    # Gebuchte Rechnungspositionen der Posten
    actual_cents: int
    # Veranschlagt minus geplant minus Ist; None ohne veranschlagtes Budget
    remaining_cents: int | None
    items: int


class ProjectSummary(BaseModel):
    id: int
    name: str
    description: str
    status: str
    starts_on: date | None
    ends_on: date | None
    budget: BudgetSums
    open_tasks: int
    last_meeting_on: date | None


class TaskOut(BaseModel):
    id: int
    text: str
    owner: str
    due_on: date | None
    done: bool
    done_at: datetime | None


class MeetingFileOut(BaseModel):
    id: int
    name: str
    size: int


class MeetingListOut(BaseModel):
    id: int
    held_on: date
    title: str
    files: int
    updated_at: datetime


class MeetingOut(BaseModel):
    id: int
    held_on: date
    title: str
    body: str
    files: list[MeetingFileOut]
    created_at: datetime
    updated_at: datetime


class ProjectOut(BaseModel):
    id: int
    name: str
    description: str
    status: str
    starts_on: date | None
    ends_on: date | None
    budget_approved_on: date | None
    budget_note: str
    budget: BudgetSums
    people: list[PersonOut]
    links: list[LinkOut]
    open_tasks: int
    # Die ersten offenen Aufgaben für die Übersicht
    tasks: list[TaskOut]
    last_meeting: MeetingOut | None
    year_label: str


class ChoiceOut(BaseModel):
    id: int
    name: str
    status: str


# --- Budget aus dem IT-Budget --------------------------------------------------------------


@dataclass
class ItemCosts:
    """Was ein Budgetposten über alle Geschäftsjahre zum Projekt beiträgt."""

    planned: int = 0
    actual: int = 0
    # Je Geschäftsjahr: (geplant, Ist)
    years: dict[int, tuple[int, int]] = field(default_factory=dict)


def _item_lines(
    db: Session, item_ids: list[int], start_month: int
) -> dict[tuple[int, int], YearLines]:
    """Rechnungspositionen der Posten je (Posten, Geschäftsjahr), über alle Jahre."""
    by_item: dict[tuple[int, int], YearLines] = {}
    if not item_ids:
        return by_item
    rows = db.execute(
        select(BudgetInvoiceLine, BudgetInvoice.invoice_date, BudgetInvoice.status)
        .join(BudgetInvoice, BudgetInvoice.id == BudgetInvoiceLine.invoice_id)
        .where(BudgetInvoiceLine.item_id.in_(item_ids))
    ).all()
    for line, invoice_date, invoice_status in rows:
        year = fiscal_year_of(invoice_date, start_month)
        entry = by_item.setdefault((line.item_id, year), YearLines())
        entry.invoiced = True
        if invoice_status == BUDGET_STATUS:
            entry.actual_cents += line.gross_cents
            entry.closed = entry.closed or line.closes_item
    return by_item


def item_costs(
    item: BudgetItem, lines: dict[tuple[int, int], YearLines], current_year: int
) -> ItemCosts:
    """Geplant und Ist eines Postens über seine Laufzeit.

    Geplant ist je Geschäftsjahr, was von den erwarteten Kosten noch nicht durch gebuchte
    Rechnungen gedeckt ist (Prognose minus Ist); ein abgeschlossenes Jahr plant nichts mehr.
    Ohne Ende läuft ein Posten bis zum laufenden Geschäftsjahr. Stillgelegte Posten planen
    nichts, ihre gebuchten Rechnungen zählen weiter.
    """
    last = item.end_year if item.end_year is not None else max(current_year, item.start_year)
    years = set(range(item.start_year, last + 1))
    years.update(year for (item_id, year) in lines if item_id == item.id)
    costs = ItemCosts()
    for year in sorted(years):
        year_lines = lines.get((item.id, year))
        actual = year_lines.actual_cents if year_lines else 0
        closed = year_lines.closed if year_lines else False
        expected = expected_in(item, year) if item.active else None
        planned = max(forecast(expected, actual, closed) - actual, 0)
        if planned == 0 and actual == 0:
            continue
        costs.years[year] = (planned, actual)
        costs.planned += planned
        costs.actual += actual
    return costs


def _project_items(db: Session, project_ids: list[int]) -> dict[int, list[BudgetItem]]:
    by_project: dict[int, list[BudgetItem]] = {project_id: [] for project_id in project_ids}
    if not project_ids:
        return by_project
    rows = db.scalars(
        select(BudgetItem)
        .where(BudgetItem.project_id.in_(project_ids))
        .order_by(BudgetItem.name, BudgetItem.id)
    ).all()
    for row in rows:
        if row.project_id is not None:
            by_project[row.project_id].append(row)
    return by_project


def _sums(budget_cents: int | None, costs: list[ItemCosts]) -> BudgetSums:
    planned = sum(entry.planned for entry in costs)
    actual = sum(entry.actual for entry in costs)
    return BudgetSums(
        budget_cents=budget_cents,
        planned_cents=planned,
        actual_cents=actual,
        remaining_cents=budget_cents - planned - actual if budget_cents is not None else None,
        items=len(costs),
    )


def _budget_sums(db: Session, projects: list[Project]) -> dict[int, BudgetSums]:
    start_month = load_settings(db).start_month
    current = fiscal_year_of(now_utc().date(), start_month)
    items = _project_items(db, [project.id for project in projects])
    lines = _item_lines(db, [item.id for rows in items.values() for item in rows], start_month)
    return {
        project.id: _sums(
            project.budget_cents, [item_costs(item, lines, current) for item in items[project.id]]
        )
        for project in projects
    }


# --- Hilfen für Projekte ------------------------------------------------------------------


def _project(db: Session, project_id: int) -> Project:
    row: Project | None = db.get(Project, project_id)
    if row is None:
        raise _not_found()
    return row


def _open_tasks(db: Session, project_ids: list[int]) -> dict[int, int]:
    if not project_ids:
        return {}
    rows = db.execute(
        select(ProjectTask.project_id, func.count())
        .where(ProjectTask.project_id.in_(project_ids), ProjectTask.done.is_(False))
        .group_by(ProjectTask.project_id)
    ).all()
    return {project_id: count for project_id, count in rows}


def _last_meetings(db: Session, project_ids: list[int]) -> dict[int, date]:
    if not project_ids:
        return {}
    rows = db.execute(
        select(ProjectMeeting.project_id, func.max(ProjectMeeting.held_on))
        .where(ProjectMeeting.project_id.in_(project_ids))
        .group_by(ProjectMeeting.project_id)
    ).all()
    return {project_id: held_on for project_id, held_on in rows}


def task_out(row: ProjectTask) -> TaskOut:
    return TaskOut(
        id=row.id,
        text=row.text,
        owner=row.owner,
        due_on=row.due_on,
        done=row.done,
        done_at=row.done_at,
    )


def _meeting_files(db: Session, meeting_id: int) -> list[ProjectMeetingFile]:
    return list(
        db.scalars(
            select(ProjectMeetingFile)
            .where(ProjectMeetingFile.meeting_id == meeting_id)
            .order_by(ProjectMeetingFile.id)
        ).all()
    )


def meeting_out(db: Session, row: ProjectMeeting) -> MeetingOut:
    return MeetingOut(
        id=row.id,
        held_on=row.held_on,
        title=row.title,
        body=row.body,
        files=[
            MeetingFileOut(id=entry.id, name=entry.name, size=entry.size)
            for entry in _meeting_files(db, row.id)
        ],
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _ordered_tasks(db: Session, project_id: int) -> list[ProjectTask]:
    """Offene zuerst (nach Fälligkeit, ohne Datum zuletzt), dann erledigte, jüngste zuerst."""
    rows = db.scalars(select(ProjectTask).where(ProjectTask.project_id == project_id)).all()
    open_rows = sorted(
        (row for row in rows if not row.done),
        key=lambda row: (row.due_on is None, row.due_on or date.max, row.id),
    )
    done_rows = sorted(
        (row for row in rows if row.done),
        key=lambda row: (row.done_at or row.created_at, row.id),
        reverse=True,
    )
    return [*open_rows, *done_rows]


def project_out(db: Session, row: Project) -> ProjectOut:
    people = db.scalars(
        select(ProjectPerson)
        .where(ProjectPerson.project_id == row.id)
        .order_by(ProjectPerson.position)
    ).all()
    links = db.scalars(
        select(ProjectLink).where(ProjectLink.project_id == row.id).order_by(ProjectLink.position)
    ).all()
    tasks = [task for task in _ordered_tasks(db, row.id) if not task.done]
    last = db.scalars(
        select(ProjectMeeting)
        .where(ProjectMeeting.project_id == row.id)
        .order_by(ProjectMeeting.held_on.desc(), ProjectMeeting.id.desc())
        .limit(1)
    ).first()
    return ProjectOut(
        id=row.id,
        name=row.name,
        description=row.description,
        status=row.status,
        starts_on=row.starts_on,
        ends_on=row.ends_on,
        budget_approved_on=row.budget_approved_on,
        budget_note=row.budget_note,
        budget=_budget_sums(db, [row])[row.id],
        people=[
            PersonOut(
                name=person.name,
                role=person.role,
                kind=person.kind,
                organisation=person.organisation,
                contact=person.contact,
            )
            for person in people
        ],
        links=[LinkOut(label=link.label, url=link.url) for link in links],
        open_tasks=len(tasks),
        tasks=[task_out(task) for task in tasks[:OVERVIEW_TASKS]],
        last_meeting=meeting_out(db, last) if last else None,
        year_label=load_settings(db).year_label,
    )


def _name_taken(db: Session, name: str, own_id: int | None) -> None:
    other = db.scalars(select(Project).where(func.lower(Project.name) == name.lower())).first()
    if other is not None and other.id != own_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ein Projekt mit diesem Namen gibt es schon.",
        )


def _apply_project(db: Session, row: Project, body: ProjectIn) -> None:
    row.name = body.name
    row.description = body.description
    row.status = body.status
    row.starts_on = body.starts_on
    row.ends_on = body.ends_on
    row.budget_cents = body.budget_cents
    row.budget_approved_on = body.budget_approved_on
    row.budget_note = body.budget_note
    db.flush()
    db.execute(delete(ProjectPerson).where(ProjectPerson.project_id == row.id))
    db.execute(delete(ProjectLink).where(ProjectLink.project_id == row.id))
    for position, person in enumerate(body.people):
        db.add(
            ProjectPerson(
                project_id=row.id,
                position=position,
                name=person.name,
                role=person.role,
                kind=person.kind,
                organisation=person.organisation,
                contact=person.contact,
            )
        )
    for position, link in enumerate(body.links):
        db.add(ProjectLink(project_id=row.id, position=position, label=link.label, url=link.url))
    db.flush()


def _project_details(row: Project) -> dict[str, object]:
    """Was ins Audit-Log kommt: keine Namen von Personen, nur Zahlen."""
    return {
        "name": row.name,
        "status": row.status,
        "starts_on": row.starts_on.isoformat() if row.starts_on else None,
        "ends_on": row.ends_on.isoformat() if row.ends_on else None,
        "budget_cents": row.budget_cents,
    }


def _audit(
    db: Session,
    request: Request,
    user: CurrentUser,
    action: str,
    object_type: str,
    object_id: int,
    details: dict[str, object] | None = None,
) -> None:
    write_audit(
        db,
        module=MODULE,
        action=f"projekte.{action}",
        user_id=user.user_id,
        object_type=object_type,
        object_id=str(object_id),
        ip=client_ip(request),
        details=details,
    )


# --- Projekte ------------------------------------------------------------------------------


@router.get("")
def list_projects(user: Reader, db: DbDep) -> list[ProjectSummary]:
    """Alle Projekte mit Budget, offenen Aufgaben und letztem Jour Fixe."""
    rows = list(db.scalars(select(Project).order_by(func.lower(Project.name), Project.id)).all())
    ids = [row.id for row in rows]
    sums = _budget_sums(db, rows)
    open_tasks = _open_tasks(db, ids)
    meetings = _last_meetings(db, ids)
    return [
        ProjectSummary(
            id=row.id,
            name=row.name,
            description=row.description,
            status=row.status,
            starts_on=row.starts_on,
            ends_on=row.ends_on,
            budget=sums[row.id],
            open_tasks=open_tasks.get(row.id, 0),
            last_meeting_on=meetings.get(row.id),
        )
        for row in rows
    ]


@router.get("/choices")
def list_choices(user: Chooser, db: DbDep) -> list[ChoiceOut]:
    """Projekte zur Auswahl am Budgetposten (nur Name und Status)."""
    rows = db.scalars(select(Project).order_by(func.lower(Project.name), Project.id)).all()
    return [ChoiceOut(id=row.id, name=row.name, status=row.status) for row in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_project(request: Request, body: ProjectIn, user: Editor, db: DbDep) -> ProjectOut:
    _name_taken(db, body.name, None)
    row = Project(name=body.name)
    db.add(row)
    db.flush()
    _apply_project(db, row, body)
    _audit(db, request, user, "projekt_angelegt", "projekt", row.id, _project_details(row))
    db.commit()
    return project_out(db, row)


@router.get("/{project_id}")
def read_project(project_id: ProjectId, user: Reader, db: DbDep) -> ProjectOut:
    return project_out(db, _project(db, project_id))


@router.put("/{project_id}")
def update_project(
    request: Request, project_id: ProjectId, body: ProjectIn, user: Editor, db: DbDep
) -> ProjectOut:
    row = _project(db, project_id)
    _name_taken(db, body.name, row.id)
    before = _project_details(row)
    _apply_project(db, row, body)
    _audit(
        db,
        request,
        user,
        "projekt_geaendert",
        "projekt",
        row.id,
        {
            "vorher": before,
            "nachher": _project_details(row),
            "personen": len(body.people),
            "links": len(body.links),
        },
    )
    db.commit()
    db.refresh(row)
    return project_out(db, row)


@router.delete("/{project_id}")
def delete_project(
    request: Request, project_id: ProjectId, user: Editor, db: DbDep, settings: SettingsDep
) -> dict[str, bool]:
    """Löscht das Projekt samt Aufgaben, Jour Fixe und Anhängen. Budgetposten bleiben,
    sie verlieren nur die Zuordnung."""
    row = _project(db, project_id)
    keys = list(
        db.scalars(
            select(ProjectMeetingFile.key)
            .join(ProjectMeeting, ProjectMeeting.id == ProjectMeetingFile.meeting_id)
            .where(ProjectMeeting.project_id == row.id)
        ).all()
    )
    released = (
        db.scalar(
            select(func.count()).select_from(BudgetItem).where(BudgetItem.project_id == row.id)
        )
        or 0
    )
    db.execute(update(BudgetItem).where(BudgetItem.project_id == row.id).values(project_id=None))
    name = row.name
    db.delete(row)
    _audit(
        db,
        request,
        user,
        "projekt_geloescht",
        "projekt",
        project_id,
        {"name": name, "posten_geloest": released, "anhaenge": len(keys)},
    )
    db.commit()
    for key in keys:
        remove_document(settings.project_documents_dir, key)
    return {"deleted": True}


# --- Budget --------------------------------------------------------------------------------


class BudgetItemOut(BaseModel):
    id: int
    name: str
    account_number: str
    account_name: str
    active: bool
    start_year_name: str
    end_year_name: str | None
    planned_cents: int
    actual_cents: int


class BudgetYearOut(BaseModel):
    year: int
    name: str
    planned_cents: int
    actual_cents: int


class ProjectBudgetOut(BaseModel):
    sums: BudgetSums
    budget_approved_on: date | None
    budget_note: str
    year_label: str
    items: list[BudgetItemOut]
    years: list[BudgetYearOut]


@router.get("/{project_id}/budget")
def read_budget(project_id: ProjectId, user: Reader, db: DbDep) -> ProjectBudgetOut:
    """Die Budgetposten des Projekts mit geplant und Ist, gesamt und je Geschäftsjahr."""
    row = _project(db, project_id)
    settings = load_settings(db)
    current = fiscal_year_of(now_utc().date(), settings.start_month)
    items = _project_items(db, [row.id])[row.id]
    lines = _item_lines(db, [item.id for item in items], settings.start_month)
    accounts = {
        account.id: account
        for account in db.scalars(
            select(BudgetAccount).where(BudgetAccount.id.in_({item.account_id for item in items}))
        ).all()
    }
    costs = [item_costs(item, lines, current) for item in items]
    years: dict[int, tuple[int, int]] = {}
    for entry in costs:
        for year, (planned, actual) in entry.years.items():
            old_planned, old_actual = years.get(year, (0, 0))
            years[year] = (old_planned + planned, old_actual + actual)
    out_items = []
    for item, entry in zip(items, costs, strict=True):
        account = accounts.get(item.account_id)
        out_items.append(
            BudgetItemOut(
                id=item.id,
                name=item.name,
                account_number=account.number if account else "",
                account_name=account.name if account else "",
                active=item.active,
                start_year_name=fiscal_year_name(item.start_year, settings.start_month),
                end_year_name=(
                    fiscal_year_name(item.end_year, settings.start_month)
                    if item.end_year is not None
                    else None
                ),
                planned_cents=entry.planned,
                actual_cents=entry.actual,
            )
        )
    return ProjectBudgetOut(
        sums=_sums(row.budget_cents, costs),
        budget_approved_on=row.budget_approved_on,
        budget_note=row.budget_note,
        year_label=settings.year_label,
        items=out_items,
        years=[
            BudgetYearOut(
                year=year,
                name=fiscal_year_name(year, settings.start_month),
                planned_cents=planned,
                actual_cents=actual,
            )
            for year, (planned, actual) in sorted(years.items())
            if YEAR_MIN <= year <= YEAR_MAX
        ],
    )


# --- Aufgaben ------------------------------------------------------------------------------


class TaskIn(BaseModel):
    text: str = Field(min_length=1, max_length=300)
    owner: str = Field(default="", max_length=120)
    due_on: date | None = None
    done: bool = False

    @field_validator("text", "owner")
    @classmethod
    def plain(cls, value: str) -> str:
        return _single_line(value)

    @field_validator("text")
    @classmethod
    def not_empty(cls, value: str) -> str:
        if not value:
            raise ValueError("Darf nicht leer sein")
        return value


def _task(db: Session, project_id: int, task_id: int) -> ProjectTask:
    row: ProjectTask | None = db.get(ProjectTask, task_id)
    if row is None or row.project_id != project_id:
        raise _not_found()
    return row


def _apply_task(row: ProjectTask, body: TaskIn) -> None:
    row.text = body.text
    row.owner = body.owner
    row.due_on = body.due_on
    if body.done and not row.done:
        row.done_at = now_utc()
    elif not body.done:
        row.done_at = None
    row.done = body.done


@router.get("/{project_id}/tasks")
def list_tasks(project_id: ProjectId, user: Reader, db: DbDep) -> list[TaskOut]:
    _project(db, project_id)
    return [task_out(row) for row in _ordered_tasks(db, project_id)]


@router.post("/{project_id}/tasks", status_code=status.HTTP_201_CREATED)
def create_task(
    request: Request, project_id: ProjectId, body: TaskIn, user: Editor, db: DbDep
) -> TaskOut:
    _project(db, project_id)
    count = db.scalar(
        select(func.count()).select_from(ProjectTask).where(ProjectTask.project_id == project_id)
    )
    if (count or 0) >= TASKS_MAX:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Ein Projekt hat höchstens {TASKS_MAX} Aufgaben.",
        )
    row = ProjectTask(project_id=project_id, done=False)
    _apply_task(row, body)
    db.add(row)
    db.flush()
    _audit(db, request, user, "aufgabe_angelegt", "aufgabe", row.id, {"projekt": project_id})
    db.commit()
    return task_out(row)


@router.put("/{project_id}/tasks/{task_id}")
def update_task(
    request: Request,
    project_id: ProjectId,
    task_id: TaskId,
    body: TaskIn,
    user: Editor,
    db: DbDep,
) -> TaskOut:
    row = _task(db, project_id, task_id)
    _apply_task(row, body)
    _audit(
        db,
        request,
        user,
        "aufgabe_geaendert",
        "aufgabe",
        row.id,
        {"projekt": project_id, "erledigt": row.done},
    )
    db.commit()
    return task_out(row)


@router.delete("/{project_id}/tasks/{task_id}")
def delete_task(
    request: Request, project_id: ProjectId, task_id: TaskId, user: Editor, db: DbDep
) -> dict[str, bool]:
    row = _task(db, project_id, task_id)
    db.delete(row)
    _audit(db, request, user, "aufgabe_geloescht", "aufgabe", task_id, {"projekt": project_id})
    db.commit()
    return {"deleted": True}


# --- Jour Fixe -----------------------------------------------------------------------------


class MeetingIn(BaseModel):
    held_on: date
    title: str = Field(min_length=1, max_length=160)
    body: str = Field(default="", max_length=BODY_MAX)

    @field_validator("title")
    @classmethod
    def plain(cls, value: str) -> str:
        value = _single_line(value)
        if not value:
            raise ValueError("Darf nicht leer sein")
        return value

    @field_validator("body")
    @classmethod
    def text_only(cls, value: str) -> str:
        # Zeilenumbrüche und Tabulatoren sind erlaubt, andere Steuerzeichen nicht.
        if any(ord(char) < 32 and char not in "\n\r\t" for char in value):
            raise ValueError("Keine Steuerzeichen")
        return value.replace("\r\n", "\n").replace("\r", "\n")

    @field_validator("held_on")
    @classmethod
    def plausible(cls, value: date) -> date:
        if not YEAR_MIN <= value.year <= YEAR_MAX:
            raise ValueError("Datum außerhalb des erlaubten Bereichs")
        return value


def _meeting(db: Session, project_id: int, meeting_id: int) -> ProjectMeeting:
    row: ProjectMeeting | None = db.get(ProjectMeeting, meeting_id)
    if row is None or row.project_id != project_id:
        raise _not_found()
    return row


@router.get("/{project_id}/meetings")
def list_meetings(project_id: ProjectId, user: Reader, db: DbDep) -> list[MeetingListOut]:
    """Alle Jour-Fixe-Einträge, neueste zuerst (ohne Protokolltext)."""
    _project(db, project_id)
    rows = db.scalars(
        select(ProjectMeeting)
        .where(ProjectMeeting.project_id == project_id)
        .order_by(ProjectMeeting.held_on.desc(), ProjectMeeting.id.desc())
    ).all()
    counts: dict[int, int] = {}
    if rows:
        for meeting_id, count in db.execute(
            select(ProjectMeetingFile.meeting_id, func.count())
            .where(ProjectMeetingFile.meeting_id.in_([row.id for row in rows]))
            .group_by(ProjectMeetingFile.meeting_id)
        ).all():
            counts[meeting_id] = count
    return [
        MeetingListOut(
            id=row.id,
            held_on=row.held_on,
            title=row.title,
            files=counts.get(row.id, 0),
            updated_at=row.updated_at,
        )
        for row in rows
    ]


@router.get("/{project_id}/meetings/{meeting_id}")
def read_meeting(
    project_id: ProjectId, meeting_id: MeetingId, user: Reader, db: DbDep
) -> MeetingOut:
    return meeting_out(db, _meeting(db, project_id, meeting_id))


@router.post("/{project_id}/meetings", status_code=status.HTTP_201_CREATED)
def create_meeting(
    request: Request, project_id: ProjectId, body: MeetingIn, user: Editor, db: DbDep
) -> MeetingOut:
    _project(db, project_id)
    row = ProjectMeeting(
        project_id=project_id,
        held_on=body.held_on,
        title=body.title,
        body=body.body,
        created_by=user.user_id,
        updated_by=user.user_id,
    )
    db.add(row)
    db.flush()
    _audit(
        db,
        request,
        user,
        "jour_fixe_angelegt",
        "jour_fixe",
        row.id,
        {"projekt": project_id, "datum": body.held_on.isoformat()},
    )
    db.commit()
    db.refresh(row)
    return meeting_out(db, row)


@router.put("/{project_id}/meetings/{meeting_id}")
def update_meeting(
    request: Request,
    project_id: ProjectId,
    meeting_id: MeetingId,
    body: MeetingIn,
    user: Editor,
    db: DbDep,
) -> MeetingOut:
    row = _meeting(db, project_id, meeting_id)
    row.held_on = body.held_on
    row.title = body.title
    row.body = body.body
    row.updated_by = user.user_id
    _audit(
        db,
        request,
        user,
        "jour_fixe_geaendert",
        "jour_fixe",
        row.id,
        {"projekt": project_id, "datum": body.held_on.isoformat()},
    )
    db.commit()
    db.refresh(row)
    return meeting_out(db, row)


@router.delete("/{project_id}/meetings/{meeting_id}")
def delete_meeting(
    request: Request,
    project_id: ProjectId,
    meeting_id: MeetingId,
    user: Editor,
    db: DbDep,
    settings: SettingsDep,
) -> dict[str, bool]:
    row = _meeting(db, project_id, meeting_id)
    keys = [entry.key for entry in _meeting_files(db, row.id)]
    db.delete(row)
    _audit(
        db,
        request,
        user,
        "jour_fixe_geloescht",
        "jour_fixe",
        meeting_id,
        {"projekt": project_id, "anhaenge": len(keys)},
    )
    db.commit()
    for key in keys:
        remove_document(settings.project_documents_dir, key)
    return {"deleted": True}


@router.post("/{project_id}/meetings/{meeting_id}/files", status_code=status.HTTP_201_CREATED)
async def upload_file(
    request: Request,
    project_id: ProjectId,
    meeting_id: MeetingId,
    user: Editor,
    db: DbDep,
    settings: SettingsDep,
) -> MeetingOut:
    """Hängt ein PDF an den Eintrag. Der Inhalt der Anfrage ist die Datei selbst,
    der Dateiname steht im Kopf `X-Dateiname`."""
    row = _meeting(db, project_id, meeting_id)
    if len(_meeting_files(db, row.id)) >= FILES_MAX:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Ein Eintrag hat höchstens {FILES_MAX} Anhänge.",
        )
    limit = settings.project_document_max_mb * 1024 * 1024
    too_large = HTTPException(
        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
        detail=f"Die Datei ist größer als {settings.project_document_max_mb} MB.",
    )
    if not request.headers.get("content-type", "").lower().startswith(PDF_TYPE):
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Nur PDF-Dateien."
        )
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > limit:
        raise too_large
    # Auch ohne ehrliche Längenangabe nie mehr als die Höchstgröße in den Speicher lesen.
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > limit:
            raise too_large
        chunks.append(chunk)
    data = b"".join(chunks)
    if not looks_like_pdf(data):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Die Datei ist kein PDF."
        )
    entry = ProjectMeetingFile(
        meeting_id=row.id,
        name=clean_name(request.headers.get("x-dateiname", "")),
        key=store_document(settings.project_documents_dir, data),
        size=len(data),
        created_by=user.user_id,
    )
    db.add(entry)
    db.flush()
    _audit(
        db,
        request,
        user,
        "anhang_hochgeladen",
        "jour_fixe",
        row.id,
        {"projekt": project_id, "name": entry.name, "bytes": entry.size},
    )
    db.commit()
    return meeting_out(db, row)


def _file(db: Session, project_id: int, meeting_id: int, file_id: int) -> ProjectMeetingFile:
    _meeting(db, project_id, meeting_id)
    entry: ProjectMeetingFile | None = db.get(ProjectMeetingFile, file_id)
    if entry is None or entry.meeting_id != meeting_id:
        raise _not_found()
    return entry


@router.get("/{project_id}/meetings/{meeting_id}/files/{file_id}")
def download_file(
    project_id: ProjectId,
    meeting_id: MeetingId,
    file_id: FileId,
    user: Reader,
    db: DbDep,
    settings: SettingsDep,
) -> FileResponse:
    """Liefert den Anhang als Download, nie zur Anzeige im Browser."""
    entry = _file(db, project_id, meeting_id, file_id)
    path = document_path(settings.project_documents_dir, entry.key)
    if path is None or not path.is_file():
        raise _not_found()
    return FileResponse(
        path,
        media_type=PDF_TYPE,
        filename=entry.name,
        content_disposition_type="attachment",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
    )


@router.delete("/{project_id}/meetings/{meeting_id}/files/{file_id}")
def delete_file(
    request: Request,
    project_id: ProjectId,
    meeting_id: MeetingId,
    file_id: FileId,
    user: Editor,
    db: DbDep,
    settings: SettingsDep,
) -> MeetingOut:
    entry = _file(db, project_id, meeting_id, file_id)
    key, name = entry.key, entry.name
    db.delete(entry)
    _audit(
        db,
        request,
        user,
        "anhang_entfernt",
        "jour_fixe",
        meeting_id,
        {"projekt": project_id, "name": name},
    )
    db.commit()
    remove_document(settings.project_documents_dir, key)
    return meeting_out(db, _meeting(db, project_id, meeting_id))
