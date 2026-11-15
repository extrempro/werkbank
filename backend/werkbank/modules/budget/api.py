"""API des Moduls IT-Budget: Einstellungen, Konten, Plan je Geschäftsjahr und Übersicht."""

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select

from werkbank.core.app_settings import set_setting
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, require_roles
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.budget.models import BudgetAccount, BudgetPlan
from werkbank.modules.budget.settings import (
    SETTINGS_KEY,
    YEAR_MAX,
    YEAR_MIN,
    BudgetSettings,
    fiscal_year_name,
    fiscal_year_of,
    fiscal_year_range,
    load_settings,
)

router = APIRouter(prefix="/api/budget")

MODULE = "budget"
KIND_RUNNING = "laufend"
KIND_INVESTMENT = "investition"
# Obergrenze je Betrag: 10 Milliarden Euro in Cent
AMOUNT_MAX = 1_000_000_000_000

Reader = Annotated[
    CurrentUser,
    Depends(require_roles(Role.BUDGET_READER, Role.BUDGET_EDITOR, Role.BUDGET_MANAGER)),
]
Editor = Annotated[CurrentUser, Depends(require_roles(Role.BUDGET_EDITOR, Role.BUDGET_MANAGER))]
Manager = Annotated[CurrentUser, Depends(require_roles(Role.BUDGET_MANAGER))]
AccountId = Annotated[int, Path(ge=1)]
Year = Annotated[int, Path(ge=YEAR_MIN, le=YEAR_MAX)]
YearQuery = Annotated[int | None, Query(ge=YEAR_MIN, le=YEAR_MAX)]


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _single_line(value: str) -> str:
    value = value.strip()
    if any(ord(char) < 32 for char in value):
        raise ValueError("Keine Zeilenumbrüche oder Steuerzeichen")
    return value


class SettingsOut(BaseModel):
    start_month: int
    year_label: str
    cost_center: str
    # Das laufende Geschäftsjahr (Kalenderjahr des Beginns) und sein Name
    current_year: int
    current_year_name: str


class SettingsIn(BaseModel):
    start_month: int = Field(ge=1, le=12)
    year_label: str = Field(min_length=1, max_length=30)
    cost_center: str = Field(default="", max_length=40)

    @field_validator("year_label", "cost_center")
    @classmethod
    def plain(cls, value: str) -> str:
        return _single_line(value)

    @field_validator("year_label")
    @classmethod
    def not_empty(cls, value: str) -> str:
        if not value:
            raise ValueError("Bitte eine Bezeichnung angeben")
        return value


class AccountOut(BaseModel):
    id: int
    number: str
    name: str
    kind: str
    note: str
    active: bool


class AccountIn(BaseModel):
    number: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=120)
    kind: Literal["laufend", "investition"]
    note: str = Field(default="", max_length=500)
    active: bool = True

    @field_validator("number", "name", "note")
    @classmethod
    def plain(cls, value: str) -> str:
        return _single_line(value)

    @field_validator("number", "name")
    @classmethod
    def not_empty(cls, value: str) -> str:
        if not value:
            raise ValueError("Darf nicht leer sein")
        return value


class OverviewRow(BaseModel):
    account: AccountOut
    # Geplanter Betrag brutto in Cent; None: für dieses Jahr ist nichts geplant
    plan_cents: int | None
    previous_cents: int | None


class Totals(BaseModel):
    running_cents: int
    investment_cents: int
    total_cents: int


class YearOut(BaseModel):
    year: int
    name: str


class OverviewOut(BaseModel):
    settings: SettingsOut
    year: int
    year_name: str
    first_day: date
    last_day: date
    years: list[YearOut]
    rows: list[OverviewRow]
    plan: Totals
    previous: Totals


class PlanEntryIn(BaseModel):
    account_id: int = Field(ge=1)
    # None: Plan für dieses Konto entfernen
    amount_cents: int | None = Field(default=None, ge=0, le=AMOUNT_MAX)


class PlanIn(BaseModel):
    entries: list[PlanEntryIn] = Field(max_length=500)


def settings_out(settings: BudgetSettings) -> SettingsOut:
    current = fiscal_year_of(now_utc().date(), settings.start_month)
    return SettingsOut(
        start_month=settings.start_month,
        year_label=settings.year_label,
        cost_center=settings.cost_center,
        current_year=current,
        current_year_name=fiscal_year_name(current, settings.start_month),
    )


def account_out(row: BudgetAccount) -> AccountOut:
    return AccountOut(
        id=row.id,
        number=row.number,
        name=row.name,
        kind=row.kind,
        note=row.note,
        active=row.active,
    )


def _totals(rows: list[tuple[str, int | None]]) -> Totals:
    running = sum(amount or 0 for kind, amount in rows if kind == KIND_RUNNING)
    investment = sum(amount or 0 for kind, amount in rows if kind == KIND_INVESTMENT)
    return Totals(
        running_cents=running, investment_cents=investment, total_cents=running + investment
    )


@router.get("/settings")
def read_settings(user: Reader, db: DbDep) -> SettingsOut:
    return settings_out(load_settings(db))


@router.put("/settings")
def update_settings(request: Request, body: SettingsIn, user: Manager, db: DbDep) -> SettingsOut:
    """Beginn und Bezeichnung des Geschäftsjahrs und die Kostenstelle."""
    before = load_settings(db)
    value = {
        "start_month": body.start_month,
        "year_label": body.year_label,
        "cost_center": body.cost_center,
    }
    set_setting(db, SETTINGS_KEY, value, user.user_id)
    write_audit(
        db,
        module=MODULE,
        action="budget.einstellungen_geaendert",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=SETTINGS_KEY,
        ip=client_ip(request),
        details={
            "vorher": {
                "start_month": before.start_month,
                "year_label": before.year_label,
                "cost_center": before.cost_center,
            },
            "nachher": value,
        },
    )
    db.commit()
    return settings_out(load_settings(db))


def _accounts(db: DbDep) -> list[BudgetAccount]:
    rows = db.scalars(select(BudgetAccount)).all()
    return sorted(rows, key=lambda row: (row.number.lower(), row.id))


@router.get("/accounts")
def list_accounts(user: Reader, db: DbDep) -> list[AccountOut]:
    return [account_out(row) for row in _accounts(db)]


def _number_taken(db: DbDep, number: str, own_id: int | None) -> bool:
    other = db.scalars(
        select(BudgetAccount).where(func.lower(BudgetAccount.number) == number.lower())
    ).first()
    return other is not None and other.id != own_id


def _account_details(body: AccountIn) -> dict[str, object]:
    return {"number": body.number, "name": body.name, "kind": body.kind, "active": body.active}


@router.post("/accounts", status_code=status.HTTP_201_CREATED)
def create_account(request: Request, body: AccountIn, user: Editor, db: DbDep) -> AccountOut:
    if _number_taken(db, body.number, None):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Diese Kontonummer gibt es schon."
        )
    row = BudgetAccount(
        number=body.number, name=body.name, kind=body.kind, note=body.note, active=body.active
    )
    db.add(row)
    db.flush()
    write_audit(
        db,
        module=MODULE,
        action="budget.konto_angelegt",
        user_id=user.user_id,
        object_type="konto",
        object_id=str(row.id),
        ip=client_ip(request),
        details=_account_details(body),
    )
    db.commit()
    return account_out(row)


@router.put("/accounts/{account_id}")
def update_account(
    request: Request, account_id: AccountId, body: AccountIn, user: Editor, db: DbDep
) -> AccountOut:
    row: BudgetAccount | None = db.get(BudgetAccount, account_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    if _number_taken(db, body.number, row.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Diese Kontonummer gibt es schon."
        )
    before = {"number": row.number, "name": row.name, "kind": row.kind, "active": row.active}
    row.number = body.number
    row.name = body.name
    row.kind = body.kind
    row.note = body.note
    row.active = body.active
    write_audit(
        db,
        module=MODULE,
        action="budget.konto_geaendert",
        user_id=user.user_id,
        object_type="konto",
        object_id=str(row.id),
        ip=client_ip(request),
        details={"vorher": before, "nachher": _account_details(body)},
    )
    db.commit()
    return account_out(row)


def _plans(db: DbDep, year: int) -> dict[int, int]:
    rows = db.scalars(select(BudgetPlan).where(BudgetPlan.fiscal_year == year)).all()
    return {row.account_id: row.amount_cents for row in rows}


def _overview(db: DbDep, year: int) -> OverviewOut:
    settings = load_settings(db)
    out = settings_out(settings)
    plans = _plans(db, year)
    previous = _plans(db, year - 1)
    rows = []
    for account in _accounts(db):
        plan = plans.get(account.id)
        before = previous.get(account.id)
        # Stillgelegte Konten erscheinen nur, solange für sie etwas geplant ist oder war.
        if not account.active and plan is None and before is None:
            continue
        rows.append(
            OverviewRow(account=account_out(account), plan_cents=plan, previous_cents=before)
        )
    planned_years = set(db.scalars(select(BudgetPlan.fiscal_year).distinct()).all())
    years = sorted(
        {*planned_years, *range(out.current_year - 5, out.current_year + 2), year}, reverse=True
    )
    first_day, last_day = fiscal_year_range(year, settings.start_month)
    return OverviewOut(
        settings=out,
        year=year,
        year_name=fiscal_year_name(year, settings.start_month),
        first_day=first_day,
        last_day=last_day,
        years=[
            YearOut(year=entry, name=fiscal_year_name(entry, settings.start_month))
            for entry in years
            if YEAR_MIN <= entry <= YEAR_MAX
        ],
        rows=rows,
        plan=_totals([(row.account.kind, row.plan_cents) for row in rows]),
        previous=_totals([(row.account.kind, row.previous_cents) for row in rows]),
    )


@router.get("/overview")
def overview(user: Reader, db: DbDep, year: YearQuery = None) -> OverviewOut:
    """Plan je Konto für ein Geschäftsjahr, mit dem Vorjahr zum Vergleich."""
    if year is None:
        year = fiscal_year_of(now_utc().date(), load_settings(db).start_month)
    return _overview(db, year)


@router.put("/plans/{year}")
def update_plan(
    request: Request, year: Year, body: PlanIn, user: Manager, db: DbDep
) -> OverviewOut:
    """Legt den Plan für die genannten Konten fest. Nicht genannte Konten bleiben, wie sie sind."""
    known = {row.id for row in db.scalars(select(BudgetAccount)).all()}
    wanted = {entry.account_id: entry.amount_cents for entry in body.entries}
    if len(wanted) != len(body.entries) or not set(wanted) <= known:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Jedes Konto darf nur einmal vorkommen und muss vorhanden sein.",
        )
    existing = {
        row.account_id: row
        for row in db.scalars(select(BudgetPlan).where(BudgetPlan.fiscal_year == year)).all()
    }
    changes: dict[str, dict[str, int | None]] = {}
    for account_id, amount in wanted.items():
        row = existing.get(account_id)
        before = row.amount_cents if row is not None else None
        if before == amount:
            continue
        changes[str(account_id)] = {"vorher": before, "nachher": amount}
        if amount is None:
            if row is not None:
                db.delete(row)
        elif row is None:
            db.add(
                BudgetPlan(
                    account_id=account_id,
                    fiscal_year=year,
                    amount_cents=amount,
                    updated_by=user.user_id,
                    updated_at=now_utc(),
                )
            )
        else:
            row.amount_cents = amount
            row.updated_by = user.user_id
            row.updated_at = now_utc()
    if changes:
        write_audit(
            db,
            module=MODULE,
            action="budget.plan_geaendert",
            user_id=user.user_id,
            object_type="plan",
            object_id=str(year),
            ip=client_ip(request),
            details={"konten": changes},
        )
    db.commit()
    return _overview(db, year)
