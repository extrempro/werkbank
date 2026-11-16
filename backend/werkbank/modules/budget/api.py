"""API des Moduls IT-Budget: Einstellungen, Konten, Plan je Geschäftsjahr und Übersicht."""

from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import ColumnElement, func, select

from werkbank.core.app_settings import set_setting
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, require_roles
from werkbank.core.models import User
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.db import Base
from werkbank.modules.budget.contracts import (
    INTERVALS,
    NOTICE_WARN_DAYS,
    expected_cents,
    gross_cents,
    is_running,
    notice_deadline,
    term_end,
    yearly_cents,
)
from werkbank.modules.budget.models import (
    BudgetAccount,
    BudgetContract,
    BudgetInvoice,
    BudgetItem,
    BudgetPartner,
    BudgetPlan,
    BudgetYear,
)
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
STATUS_OPEN = "zu_pruefen"
STATUS_BOOKED = "gebucht"
# So weit darf ein von Hand eingetragenes Brutto vom gerechneten abweichen (in Cent).
GROSS_TOLERANCE = 100
YEAR_DRAFT = "entwurf"
YEAR_RELEASED = "freigegeben"
# So viele Geschäftsjahre nach dem laufenden lassen sich planen.
PLAN_AHEAD = 5
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


class ItemOut(BaseModel):
    id: int
    account_id: int
    account_number: str
    account_name: str
    # Art des Kontos: laufend oder investition
    kind: str
    name: str
    # Üblicher Partner des Postens (Vorgabe beim Erfassen einer Rechnung)
    partner_id: int | None
    partner_name: str | None
    note: str
    active: bool


class ItemIn(BaseModel):
    account_id: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=160)
    partner_id: int | None = Field(default=None, ge=1)
    # Nur beim Anlegen: Plan für dieses Geschäftsjahr gleich mit eintragen
    plan_year: int | None = Field(default=None, ge=YEAR_MIN, le=YEAR_MAX)
    plan_cents: int | None = Field(default=None, ge=0, le=AMOUNT_MAX)
    note: str = Field(default="", max_length=500)
    active: bool = True

    @field_validator("name", "note")
    @classmethod
    def plain(cls, value: str) -> str:
        return _single_line(value)

    @field_validator("name")
    @classmethod
    def not_empty(cls, value: str) -> str:
        if not value:
            raise ValueError("Darf nicht leer sein")
        return value


class OverviewRow(BaseModel):
    """Ein Konto mit den Summen seiner Budgetposten."""

    account: AccountOut
    # Geplanter Betrag brutto in Cent; None: für dieses Jahr ist nichts geplant
    plan_cents: int | None
    previous_cents: int | None
    # Was aus Verträgen in diesem Geschäftsjahr noch zu erwarten ist (ohne schon Gebuchtes)
    committed_cents: int
    # Summe der gebuchten Rechnungen und die Prognose (Ist plus noch gebunden)
    actual_cents: int
    forecast_cents: int


class ItemRow(BaseModel):
    item: ItemOut
    plan_cents: int | None
    previous_cents: int | None
    committed_cents: int
    actual_cents: int
    forecast_cents: int
    # Zahl der Verträge, die auf diesem Posten laufen und in diesem Jahr Kosten haben
    contracts: int


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
    # Stand der Planung dieses Jahres: entwurf oder freigegeben
    year_status: str
    rows: list[OverviewRow]
    items: list[ItemRow]
    plan: Totals
    previous: Totals
    committed: Totals
    actual: Totals
    forecast: Totals
    # Rechnungen dieses Jahres, die noch auf die Prüfung warten
    open_invoices: int
    # Zahl der Verträge, aus denen in diesem Jahr Kosten zu erwarten sind
    committed_contracts: int


class PlanEntryIn(BaseModel):
    item_id: int = Field(ge=1)
    # None: Plan für diesen Budgetposten entfernen
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
    return {row.item_id: row.amount_cents for row in rows}


def _year_status(db: DbDep, year: int) -> str:
    row: BudgetYear | None = db.get(BudgetYear, year)
    return row.status if row is not None else YEAR_DRAFT


def _require_draft(db: DbDep, year: int) -> None:
    if _year_status(db, year) == YEAR_RELEASED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Der Plan dieses Geschäftsjahrs ist freigegeben und lässt sich nicht ändern. "
            "Der Budgetverwalter kann die Freigabe aufheben.",
        )


def item_out(
    row: BudgetItem,
    accounts: dict[int, BudgetAccount],
    partners: dict[int, BudgetPartner] | None = None,
) -> ItemOut:
    account = accounts.get(row.account_id)
    partner = (partners or {}).get(row.partner_id) if row.partner_id is not None else None
    return ItemOut(
        id=row.id,
        account_id=row.account_id,
        account_number=account.number if account else "",
        account_name=account.name if account else "",
        kind=account.kind if account else KIND_RUNNING,
        name=row.name,
        partner_id=row.partner_id,
        partner_name=partner.name if partner else None,
        note=row.note,
        active=row.active,
    )


def _partner_map(db: DbDep) -> dict[int, BudgetPartner]:
    return {row.id: row for row in db.scalars(select(BudgetPartner)).all()}


def _items(db: DbDep, accounts: dict[int, BudgetAccount]) -> list[BudgetItem]:
    """Budgetposten, sortiert nach Kontonummer und Name."""

    def key(row: BudgetItem) -> tuple[str, str, int]:
        account = accounts.get(row.account_id)
        return (account.number.lower() if account else "", row.name.lower(), row.id)

    return sorted(db.scalars(select(BudgetItem)).all(), key=key)


def _sum(values: list[int | None]) -> int | None:
    """Summe der vorhandenen Werte; None, wenn keiner vorhanden ist."""
    known = [value for value in values if value is not None]
    return sum(known) if known else None


def _overview(db: DbDep, year: int) -> OverviewOut:
    settings = load_settings(db)
    out = settings_out(settings)
    plans = _plans(db, year)
    previous = _plans(db, year - 1)
    first_day, last_day = fiscal_year_range(year, settings.start_month)
    committed: dict[int, int] = {}
    contracts: dict[int, int] = {}
    actual: dict[int, int] = {}
    paid: dict[int, int] = {}
    open_invoices = 0
    for invoice in db.scalars(
        select(BudgetInvoice).where(BudgetInvoice.invoice_date.between(first_day, last_day))
    ).all():
        if invoice.status != STATUS_BOOKED:
            open_invoices += 1
            continue
        actual[invoice.item_id] = actual.get(invoice.item_id, 0) + invoice.gross_cents
        if invoice.contract_id is not None:
            paid[invoice.contract_id] = paid.get(invoice.contract_id, 0) + invoice.gross_cents
    for contract in db.scalars(select(BudgetContract)).all():
        cents = expected_cents(contract, first_day, last_day)
        if cents:
            # Was zu diesem Vertrag schon gebucht ist, zählt im Ist und nicht mehr als gebunden.
            remaining = max(0, cents - paid.get(contract.id, 0))
            committed[contract.item_id] = committed.get(contract.item_id, 0) + remaining
            contracts[contract.item_id] = contracts.get(contract.item_id, 0) + 1
    accounts = {row.id: row for row in _accounts(db)}
    partner_map = _partner_map(db)
    items: list[ItemRow] = []
    for item in _items(db, accounts):
        plan = plans.get(item.id)
        before = previous.get(item.id)
        bound = committed.get(item.id, 0)
        spent = actual.get(item.id, 0)
        # Stillgelegte Posten erscheinen nur, solange für sie etwas geplant, gebunden oder
        # gebucht ist.
        if not item.active and plan is None and before is None and not bound and not spent:
            continue
        items.append(
            ItemRow(
                item=item_out(item, accounts, partner_map),
                plan_cents=plan,
                previous_cents=before,
                committed_cents=bound,
                actual_cents=spent,
                forecast_cents=spent + bound,
                contracts=contracts.get(item.id, 0),
            )
        )
    rows = []
    for account in accounts.values():
        own = [entry for entry in items if entry.item.account_id == account.id]
        # Stillgelegte Konten erscheinen nur, solange sie Posten mit Plan oder Kosten haben.
        if not account.active and not own:
            continue
        rows.append(
            OverviewRow(
                account=account_out(account),
                plan_cents=_sum([entry.plan_cents for entry in own]),
                previous_cents=_sum([entry.previous_cents for entry in own]),
                committed_cents=sum(entry.committed_cents for entry in own),
                actual_cents=sum(entry.actual_cents for entry in own),
                forecast_cents=sum(entry.forecast_cents for entry in own),
            )
        )
    planned_years = set(db.scalars(select(BudgetPlan.fiscal_year).distinct()).all())
    years = sorted(
        {*planned_years, *range(out.current_year - 5, out.current_year + PLAN_AHEAD + 1), year},
        reverse=True,
    )
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
        year_status=_year_status(db, year),
        rows=rows,
        items=items,
        plan=_totals([(row.account.kind, row.plan_cents) for row in rows]),
        previous=_totals([(row.account.kind, row.previous_cents) for row in rows]),
        committed=_totals([(row.account.kind, row.committed_cents) for row in rows]),
        actual=_totals([(row.account.kind, row.actual_cents) for row in rows]),
        forecast=_totals([(row.account.kind, row.forecast_cents) for row in rows]),
        open_invoices=open_invoices,
        committed_contracts=sum(contracts.values()),
    )


@router.get("/overview")
def overview(user: Reader, db: DbDep, year: YearQuery = None) -> OverviewOut:
    """Plan und gebundene Kosten je Konto und Budgetposten für ein Geschäftsjahr."""
    if year is None:
        year = fiscal_year_of(now_utc().date(), load_settings(db).start_month)
    return _overview(db, year)


@router.put("/plans/{year}")
def update_plan(request: Request, year: Year, body: PlanIn, user: Editor, db: DbDep) -> OverviewOut:
    """Legt den Plan für die genannten Budgetposten fest. Nicht genannte bleiben unverändert.

    Geplant wird nur, solange das Geschäftsjahr ein Entwurf ist.
    """
    _require_draft(db, year)
    known = {row.id for row in db.scalars(select(BudgetItem)).all()}
    wanted = {entry.item_id: entry.amount_cents for entry in body.entries}
    if len(wanted) != len(body.entries) or not set(wanted) <= known:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Jeder Budgetposten darf nur einmal vorkommen und muss vorhanden sein.",
        )
    existing = {
        row.item_id: row
        for row in db.scalars(select(BudgetPlan).where(BudgetPlan.fiscal_year == year)).all()
    }
    changes: dict[str, dict[str, int | None]] = {}
    for item_id, amount in wanted.items():
        row = existing.get(item_id)
        before = row.amount_cents if row is not None else None
        if before == amount:
            continue
        changes[str(item_id)] = {"vorher": before, "nachher": amount}
        if amount is None:
            if row is not None:
                db.delete(row)
        elif row is None:
            db.add(
                BudgetPlan(
                    item_id=item_id,
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
            details={"posten": changes},
        )
    db.commit()
    return _overview(db, year)


# --- Budgetposten ---

ItemId = Annotated[int, Path(ge=1)]


def _check_item(db: DbDep, body: ItemIn, own_id: int | None) -> None:
    if db.get(BudgetAccount, body.account_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Das Konto gibt es nicht."
        )
    if body.partner_id is not None and db.get(BudgetPartner, body.partner_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Den Partner gibt es nicht."
        )
    other = db.scalars(
        select(BudgetItem).where(
            BudgetItem.account_id == body.account_id,
            func.lower(BudgetItem.name) == body.name.lower(),
        )
    ).first()
    if other is not None and other.id != own_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Diesen Budgetposten gibt es in dem Konto schon.",
        )


@router.get("/items")
def list_items(user: Reader, db: DbDep) -> list[ItemOut]:
    accounts = {row.id: row for row in _accounts(db)}
    partners = _partner_map(db)
    return [item_out(row, accounts, partners) for row in _items(db, accounts)]


@router.post("/items", status_code=status.HTTP_201_CREATED)
def create_item(request: Request, body: ItemIn, user: Editor, db: DbDep) -> ItemOut:
    _check_item(db, body, None)
    wants_plan = body.plan_year is not None and body.plan_cents is not None
    if wants_plan and body.plan_year is not None:
        _require_draft(db, body.plan_year)
    row = BudgetItem(
        account_id=body.account_id,
        name=body.name,
        partner_id=body.partner_id,
        note=body.note,
        active=body.active,
    )
    db.add(row)
    db.flush()
    write_audit(
        db,
        module=MODULE,
        action="budget.posten_angelegt",
        user_id=user.user_id,
        object_type="posten",
        object_id=str(row.id),
        ip=client_ip(request),
        details={"account_id": body.account_id, "name": body.name},
    )
    if body.plan_year is not None and body.plan_cents is not None:
        db.add(
            BudgetPlan(
                item_id=row.id,
                fiscal_year=body.plan_year,
                amount_cents=body.plan_cents,
                updated_by=user.user_id,
                updated_at=now_utc(),
            )
        )
        write_audit(
            db,
            module=MODULE,
            action="budget.plan_geaendert",
            user_id=user.user_id,
            object_type="plan",
            object_id=str(body.plan_year),
            ip=client_ip(request),
            details={"posten": {str(row.id): {"vorher": None, "nachher": body.plan_cents}}},
        )
    db.commit()
    return item_out(row, {entry.id: entry for entry in _accounts(db)}, _partner_map(db))


@router.put("/items/{item_id}")
def update_item(
    request: Request, item_id: ItemId, body: ItemIn, user: Editor, db: DbDep
) -> ItemOut:
    row: BudgetItem | None = db.get(BudgetItem, item_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    _check_item(db, body, row.id)
    before = {"account_id": row.account_id, "name": row.name, "active": row.active}
    row.account_id = body.account_id
    row.name = body.name
    row.partner_id = body.partner_id
    row.note = body.note
    row.active = body.active
    write_audit(
        db,
        module=MODULE,
        action="budget.posten_geaendert",
        user_id=user.user_id,
        object_type="posten",
        object_id=str(row.id),
        ip=client_ip(request),
        details={
            "vorher": before,
            "nachher": {"account_id": body.account_id, "name": body.name, "active": body.active},
        },
    )
    db.commit()
    return item_out(row, {entry.id: entry for entry in _accounts(db)}, _partner_map(db))


# --- Partner ---

PartnerId = Annotated[int, Path(ge=1)]
ContractId = Annotated[int, Path(ge=1)]


class PartnerOut(BaseModel):
    id: int
    name: str
    is_contract_partner: bool
    is_invoicer: bool
    customer_number: str
    note: str
    active: bool


class PartnerIn(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    is_contract_partner: bool = True
    is_invoicer: bool = True
    customer_number: str = Field(default="", max_length=60)
    note: str = Field(default="", max_length=500)
    active: bool = True

    @field_validator("name", "customer_number", "note")
    @classmethod
    def plain(cls, value: str) -> str:
        return _single_line(value)

    @field_validator("name")
    @classmethod
    def not_empty(cls, value: str) -> str:
        if not value:
            raise ValueError("Darf nicht leer sein")
        return value


def partner_out(row: BudgetPartner) -> PartnerOut:
    return PartnerOut(
        id=row.id,
        name=row.name,
        is_contract_partner=row.is_contract_partner,
        is_invoicer=row.is_invoicer,
        customer_number=row.customer_number,
        note=row.note,
        active=row.active,
    )


def _partner_taken(db: DbDep, name: str, own_id: int | None) -> bool:
    other = db.scalars(
        select(BudgetPartner).where(func.lower(BudgetPartner.name) == name.lower())
    ).first()
    return other is not None and other.id != own_id


def _check_partner(body: PartnerIn) -> None:
    if not (body.is_contract_partner or body.is_invoicer):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Ein Partner ist Vertragspartner, Rechnungssteller oder beides.",
        )


def _apply_partner(row: BudgetPartner, body: PartnerIn) -> None:
    row.name = body.name
    row.is_contract_partner = body.is_contract_partner
    row.is_invoicer = body.is_invoicer
    row.customer_number = body.customer_number
    row.note = body.note
    row.active = body.active


@router.get("/partners")
def list_partners(user: Reader, db: DbDep) -> list[PartnerOut]:
    rows = db.scalars(select(BudgetPartner)).all()
    return [partner_out(row) for row in sorted(rows, key=lambda row: (row.name.lower(), row.id))]


@router.post("/partners", status_code=status.HTTP_201_CREATED)
def create_partner(request: Request, body: PartnerIn, user: Editor, db: DbDep) -> PartnerOut:
    _check_partner(body)
    if _partner_taken(db, body.name, None):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Diesen Partner gibt es schon."
        )
    row = BudgetPartner()
    _apply_partner(row, body)
    db.add(row)
    db.flush()
    write_audit(
        db,
        module=MODULE,
        action="budget.partner_angelegt",
        user_id=user.user_id,
        object_type="partner",
        object_id=str(row.id),
        ip=client_ip(request),
        details={"name": body.name},
    )
    db.commit()
    return partner_out(row)


@router.put("/partners/{partner_id}")
def update_partner(
    request: Request, partner_id: PartnerId, body: PartnerIn, user: Editor, db: DbDep
) -> PartnerOut:
    row: BudgetPartner | None = db.get(BudgetPartner, partner_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    _check_partner(body)
    if _partner_taken(db, body.name, row.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Diesen Partner gibt es schon."
        )
    before = {"name": row.name, "active": row.active}
    _apply_partner(row, body)
    write_audit(
        db,
        module=MODULE,
        action="budget.partner_geaendert",
        user_id=user.user_id,
        object_type="partner",
        object_id=str(row.id),
        ip=client_ip(request),
        details={"vorher": before, "nachher": {"name": body.name, "active": body.active}},
    )
    db.commit()
    return partner_out(row)


# --- Verträge ---

DATE_MIN = date(YEAR_MIN, 1, 1)
DATE_MAX = date(YEAR_MAX, 12, 31)


class ContractOut(BaseModel):
    id: int
    title: str
    partner_id: int
    partner_name: str
    item_id: int
    item_name: str
    account_number: str
    account_name: str
    # Rechnungssteller, wenn er vom Vertragspartner abweicht
    invoicer_id: int | None
    invoicer_name: str | None
    dpa_status: str
    # Kosten eines vollen Jahres; None bei einmaliger Zahlung
    yearly_cents: int | None
    number: str
    starts_on: date
    ends_on: date | None
    renewal_months: int | None
    notice_months: int | None
    cancelled_to: date | None
    # Betrag je Zahlung: netto, Steuersatz in Hundertstel Prozent, brutto
    net_cents: int
    tax_rate_bp: int
    amount_cents: int
    interval: str
    note: str
    # Hat begonnen oder beginnt noch und ist nicht beendet
    running: bool
    # Ende der laufenden Laufzeit (bei Verlängerung das nächste)
    term_end: date | None
    # Bis zu diesem Tag muss gekündigt sein; None: kein Termin
    notice_deadline: date | None
    days_to_deadline: int | None
    # Der Kündigungstermin liegt in den nächsten Wochen
    deadline_soon: bool
    # Erwartete Kosten im laufenden Geschäftsjahr
    current_year_cents: int


class ContractListOut(BaseModel):
    current_year_name: str
    notice_warn_days: int
    entries: list[ContractOut]


class ContractIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    partner_id: int = Field(ge=1)
    item_id: int = Field(ge=1)
    invoicer_id: int | None = Field(default=None, ge=1)
    dpa_status: Literal["vorhanden", "fehlt", "nicht_erforderlich"] = "nicht_erforderlich"
    number: str = Field(default="", max_length=60)
    starts_on: date
    ends_on: date | None = None
    renewal_months: int | None = Field(default=None, ge=1, le=120)
    notice_months: int | None = Field(default=None, ge=0, le=120)
    cancelled_to: date | None = None
    # Betrag je Zahlung netto; das Brutto rechnet der Server aus dem Steuersatz
    net_cents: int = Field(ge=0, le=AMOUNT_MAX)
    # Steuersatz in Hundertstel Prozent: 1900 = 19 %
    tax_rate_bp: int = Field(default=1900, ge=0, le=10_000)
    interval: str
    note: str = Field(default="", max_length=500)

    @field_validator("title", "number", "note")
    @classmethod
    def plain(cls, value: str) -> str:
        return _single_line(value)

    @field_validator("title")
    @classmethod
    def not_empty(cls, value: str) -> str:
        if not value:
            raise ValueError("Darf nicht leer sein")
        return value

    @field_validator("interval")
    @classmethod
    def known_interval(cls, value: str) -> str:
        if value not in INTERVALS:
            raise ValueError("Unbekannter Turnus")
        return value

    @field_validator("starts_on", "ends_on", "cancelled_to")
    @classmethod
    def in_range(cls, value: date | None) -> date | None:
        if value is not None and not DATE_MIN <= value <= DATE_MAX:
            raise ValueError("Das Datum liegt außerhalb des erlaubten Bereichs")
        return value


def contract_out(
    row: BudgetContract,
    partners: dict[int, BudgetPartner],
    accounts: dict[int, BudgetAccount],
    items: dict[int, BudgetItem],
    today: date,
    year_range: tuple[date, date],
) -> ContractOut:
    deadline = notice_deadline(row, today)
    days = (deadline - today).days if deadline is not None else None
    partner = partners.get(row.partner_id)
    item = items.get(row.item_id)
    account = accounts.get(item.account_id) if item else None
    invoicer = partners.get(row.invoicer_id) if row.invoicer_id is not None else None
    running = is_running(row, today)
    return ContractOut(
        id=row.id,
        title=row.title,
        partner_id=row.partner_id,
        partner_name=partner.name if partner else "",
        item_id=row.item_id,
        item_name=item.name if item else "",
        account_number=account.number if account else "",
        account_name=account.name if account else "",
        invoicer_id=row.invoicer_id,
        invoicer_name=invoicer.name if invoicer else None,
        dpa_status=row.dpa_status,
        yearly_cents=yearly_cents(row),
        number=row.number,
        starts_on=row.starts_on,
        ends_on=row.ends_on,
        renewal_months=row.renewal_months,
        notice_months=row.notice_months,
        cancelled_to=row.cancelled_to,
        net_cents=row.net_cents,
        tax_rate_bp=row.tax_rate_bp,
        amount_cents=row.amount_cents,
        interval=row.interval,
        note=row.note,
        running=running,
        term_end=term_end(row, today),
        notice_deadline=deadline,
        days_to_deadline=days,
        deadline_soon=running and days is not None and 0 <= days <= NOTICE_WARN_DAYS,
        current_year_cents=expected_cents(row, *year_range),
    )


def _contract_context(
    db: DbDep,
) -> tuple[
    dict[int, BudgetPartner],
    dict[int, BudgetAccount],
    dict[int, BudgetItem],
    date,
    tuple[date, date],
    str,
]:
    settings = load_settings(db)
    today = now_utc().date()
    year = fiscal_year_of(today, settings.start_month)
    return (
        {row.id: row for row in db.scalars(select(BudgetPartner)).all()},
        {row.id: row for row in db.scalars(select(BudgetAccount)).all()},
        {row.id: row for row in db.scalars(select(BudgetItem)).all()},
        today,
        fiscal_year_range(year, settings.start_month),
        fiscal_year_name(year, settings.start_month),
    )


def _one_contract(db: DbDep, row: BudgetContract) -> ContractOut:
    partners, accounts, items, today, year_range, _ = _contract_context(db)
    return contract_out(row, partners, accounts, items, today, year_range)


def _check_contract(db: DbDep, body: ContractIn) -> None:
    problem: str | None = None
    if db.get(BudgetPartner, body.partner_id) is None:
        problem = "Den Partner gibt es nicht."
    elif db.get(BudgetItem, body.item_id) is None:
        problem = "Den Budgetposten gibt es nicht."
    elif body.invoicer_id is not None and db.get(BudgetPartner, body.invoicer_id) is None:
        problem = "Den Rechnungssteller gibt es nicht."
    elif body.ends_on is not None and body.ends_on < body.starts_on:
        problem = "Das Ende der Laufzeit liegt vor dem Beginn."
    elif body.cancelled_to is not None and body.cancelled_to < body.starts_on:
        problem = "Der Kündigungstag liegt vor dem Beginn."
    elif body.ends_on is None and body.renewal_months is not None:
        problem = "Eine Verlängerung gibt es nur bei einem Ende der Laufzeit."
    if problem:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=problem)


def _apply_contract(row: BudgetContract, body: ContractIn) -> None:
    row.title = body.title
    row.partner_id = body.partner_id
    row.item_id = body.item_id
    # Derselbe Partner als Rechnungssteller ist keine Abweichung.
    row.invoicer_id = body.invoicer_id if body.invoicer_id != body.partner_id else None
    row.dpa_status = body.dpa_status
    row.number = body.number
    row.starts_on = body.starts_on
    row.ends_on = body.ends_on
    row.renewal_months = body.renewal_months
    row.notice_months = body.notice_months
    row.cancelled_to = body.cancelled_to
    row.net_cents = body.net_cents
    row.tax_rate_bp = body.tax_rate_bp
    row.amount_cents = gross_cents(body.net_cents, body.tax_rate_bp)
    row.interval = body.interval
    row.note = body.note


def _contract_details(body: ContractIn) -> dict[str, object]:
    return {
        "title": body.title,
        "partner_id": body.partner_id,
        "item_id": body.item_id,
        "net_cents": body.net_cents,
        "tax_rate_bp": body.tax_rate_bp,
        "interval": body.interval,
        "starts_on": body.starts_on.isoformat(),
        "ends_on": body.ends_on.isoformat() if body.ends_on else None,
        "cancelled_to": body.cancelled_to.isoformat() if body.cancelled_to else None,
    }


@router.get("/contracts")
def list_contracts(user: Reader, db: DbDep) -> ContractListOut:
    partners, accounts, items, today, year_range, year_name = _contract_context(db)
    entries = [
        contract_out(row, partners, accounts, items, today, year_range)
        for row in db.scalars(select(BudgetContract)).all()
    ]
    # Laufende zuerst, darin der nächste Kündigungstermin oben.
    entries.sort(
        key=lambda entry: (
            not entry.running,
            entry.notice_deadline is None,
            entry.notice_deadline or DATE_MAX,
            entry.title.lower(),
            entry.id,
        )
    )
    return ContractListOut(
        current_year_name=year_name, notice_warn_days=NOTICE_WARN_DAYS, entries=entries
    )


@router.post("/contracts", status_code=status.HTTP_201_CREATED)
def create_contract(request: Request, body: ContractIn, user: Editor, db: DbDep) -> ContractOut:
    _check_contract(db, body)
    row = BudgetContract()
    _apply_contract(row, body)
    db.add(row)
    db.flush()
    write_audit(
        db,
        module=MODULE,
        action="budget.vertrag_angelegt",
        user_id=user.user_id,
        object_type="vertrag",
        object_id=str(row.id),
        ip=client_ip(request),
        details=_contract_details(body),
    )
    db.commit()
    return _one_contract(db, row)


@router.put("/contracts/{contract_id}")
def update_contract(
    request: Request, contract_id: ContractId, body: ContractIn, user: Editor, db: DbDep
) -> ContractOut:
    row: BudgetContract | None = db.get(BudgetContract, contract_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    _check_contract(db, body)
    before = {
        "title": row.title,
        "amount_cents": row.amount_cents,
        "interval": row.interval,
        "ends_on": row.ends_on.isoformat() if row.ends_on else None,
        "cancelled_to": row.cancelled_to.isoformat() if row.cancelled_to else None,
    }
    _apply_contract(row, body)
    write_audit(
        db,
        module=MODULE,
        action="budget.vertrag_geaendert",
        user_id=user.user_id,
        object_type="vertrag",
        object_id=str(row.id),
        ip=client_ip(request),
        details={"vorher": before, "nachher": _contract_details(body)},
    )
    db.commit()
    return _one_contract(db, row)


# --- Rechnungen ---

InvoiceId = Annotated[int, Path(ge=1)]


class InvoiceOut(BaseModel):
    id: int
    invoicer_id: int
    invoicer_name: str
    number: str
    internal_number: str
    invoice_date: date
    item_id: int
    item_name: str
    account_number: str
    account_name: str
    contract_id: int | None
    contract_title: str | None
    net_cents: int
    tax_rate_bp: int
    gross_cents: int
    description: str
    is_project: bool
    is_yearly: bool
    status: str
    created_by_name: str | None
    booked_by_name: str | None
    booked_at: datetime | None


class InvoiceListOut(BaseModel):
    year: int
    year_name: str
    years: list[YearOut]
    entries: list[InvoiceOut]


class InvoiceIn(BaseModel):
    invoicer_id: int = Field(ge=1)
    number: str = Field(min_length=1, max_length=80)
    internal_number: str = Field(default="", max_length=60)
    invoice_date: date
    item_id: int = Field(ge=1)
    contract_id: int | None = Field(default=None, ge=1)
    net_cents: int = Field(ge=0, le=AMOUNT_MAX)
    tax_rate_bp: int = Field(default=1900, ge=0, le=10_000)
    # None: Brutto aus Netto und Steuersatz rechnen. Sonst das Brutto laut Rechnung.
    gross_cents: int | None = Field(default=None, ge=0, le=2 * AMOUNT_MAX)
    description: str = Field(default="", max_length=200)
    is_project: bool = False
    is_yearly: bool = False

    @field_validator("number", "internal_number", "description")
    @classmethod
    def plain(cls, value: str) -> str:
        return _single_line(value)

    @field_validator("number")
    @classmethod
    def not_empty(cls, value: str) -> str:
        if not value:
            raise ValueError("Darf nicht leer sein")
        return value

    @field_validator("invoice_date")
    @classmethod
    def in_range(cls, value: date) -> date:
        if not DATE_MIN <= value <= DATE_MAX:
            raise ValueError("Das Datum liegt außerhalb des erlaubten Bereichs")
        return value


def _invoice_rows(db: DbDep, rows: list[BudgetInvoice]) -> list[InvoiceOut]:
    partners = {row.id: row for row in db.scalars(select(BudgetPartner)).all()}
    accounts = {row.id: row for row in db.scalars(select(BudgetAccount)).all()}
    items = {row.id: row for row in db.scalars(select(BudgetItem)).all()}
    contracts = {row.id: row for row in db.scalars(select(BudgetContract)).all()}
    user_ids = {uid for row in rows for uid in (row.created_by, row.booked_by) if uid is not None}
    names: dict[object, str] = {}
    if user_ids:
        names = {
            user.id: user.display_name
            for user in db.scalars(select(User).where(User.id.in_(user_ids))).all()
        }
    out = []
    for row in rows:
        item = items.get(row.item_id)
        account = accounts.get(item.account_id) if item else None
        partner = partners.get(row.invoicer_id)
        contract = contracts.get(row.contract_id) if row.contract_id is not None else None
        out.append(
            InvoiceOut(
                id=row.id,
                invoicer_id=row.invoicer_id,
                invoicer_name=partner.name if partner else "",
                number=row.number,
                internal_number=row.internal_number,
                invoice_date=row.invoice_date,
                item_id=row.item_id,
                item_name=item.name if item else "",
                account_number=account.number if account else "",
                account_name=account.name if account else "",
                contract_id=row.contract_id,
                contract_title=contract.title if contract else None,
                net_cents=row.net_cents,
                tax_rate_bp=row.tax_rate_bp,
                gross_cents=row.gross_cents,
                description=row.description,
                is_project=row.is_project,
                is_yearly=row.is_yearly,
                status=row.status,
                created_by_name=names.get(row.created_by),
                booked_by_name=names.get(row.booked_by),
                booked_at=row.booked_at,
            )
        )
    return out


def _invoice_gross(db: DbDep, body: InvoiceIn) -> int:
    """Prüft die Bezüge der Rechnung und liefert ihr Brutto."""
    problem: str | None = None
    computed = gross_cents(body.net_cents, body.tax_rate_bp)
    if db.get(BudgetPartner, body.invoicer_id) is None:
        problem = "Den Rechnungssteller gibt es nicht."
    elif db.get(BudgetItem, body.item_id) is None:
        problem = "Den Budgetposten gibt es nicht."
    elif body.contract_id is not None and db.get(BudgetContract, body.contract_id) is None:
        problem = "Den Vertrag gibt es nicht."
    elif body.gross_cents is not None and abs(body.gross_cents - computed) > GROSS_TOLERANCE:
        problem = "Das Brutto weicht um mehr als 1 Euro vom gerechneten Betrag ab."
    if problem:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=problem)
    return computed if body.gross_cents is None else body.gross_cents


def _apply_invoice(row: BudgetInvoice, body: InvoiceIn, gross: int) -> None:
    row.invoicer_id = body.invoicer_id
    row.number = body.number
    row.internal_number = body.internal_number
    row.invoice_date = body.invoice_date
    row.item_id = body.item_id
    row.contract_id = body.contract_id
    row.net_cents = body.net_cents
    row.tax_rate_bp = body.tax_rate_bp
    row.gross_cents = gross
    row.description = body.description
    row.is_project = body.is_project
    row.is_yearly = body.is_yearly


def _invoice_details(row: BudgetInvoice) -> dict[str, object]:
    return {
        "number": row.number,
        "invoicer_id": row.invoicer_id,
        "item_id": row.item_id,
        "contract_id": row.contract_id,
        "invoice_date": row.invoice_date.isoformat(),
        "gross_cents": row.gross_cents,
        "status": row.status,
    }


def _own_invoice(db: DbDep, invoice_id: int, user: CurrentUser) -> BudgetInvoice:
    """Die Rechnung, wenn die Person sie ändern darf: Gebuchtes ändert nur der Budgetverwalter."""
    row: BudgetInvoice | None = db.get(BudgetInvoice, invoice_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    if row.status == STATUS_BOOKED and not user.has_any_role(Role.BUDGET_MANAGER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Gebuchte Rechnungen ändert nur der Budgetverwalter.",
        )
    return row


@router.get("/invoices")
def list_invoices(user: Reader, db: DbDep, year: YearQuery = None) -> InvoiceListOut:
    """Rechnungen eines Geschäftsjahrs (nach Rechnungsdatum), die neueste zuerst."""
    settings = load_settings(db)
    current = fiscal_year_of(now_utc().date(), settings.start_month)
    if year is None:
        year = current
    first_day, last_day = fiscal_year_range(year, settings.start_month)
    rows = list(
        db.scalars(
            select(BudgetInvoice)
            .where(BudgetInvoice.invoice_date.between(first_day, last_day))
            .order_by(BudgetInvoice.invoice_date.desc(), BudgetInvoice.id.desc())
        ).all()
    )
    years = sorted({*range(current - 5, current + PLAN_AHEAD + 1), year}, reverse=True)
    return InvoiceListOut(
        year=year,
        year_name=fiscal_year_name(year, settings.start_month),
        years=[
            YearOut(year=entry, name=fiscal_year_name(entry, settings.start_month))
            for entry in years
            if YEAR_MIN <= entry <= YEAR_MAX
        ],
        entries=_invoice_rows(db, rows),
    )


@router.post("/invoices", status_code=status.HTTP_201_CREATED)
def create_invoice(request: Request, body: InvoiceIn, user: Editor, db: DbDep) -> InvoiceOut:
    """Erfasst eine Rechnung. Der Budgetverwalter bucht dabei sofort, alle anderen legen vor."""
    gross = _invoice_gross(db, body)
    row = BudgetInvoice(status=STATUS_OPEN, created_by=user.user_id)
    _apply_invoice(row, body, gross)
    if user.has_any_role(Role.BUDGET_MANAGER):
        row.status = STATUS_BOOKED
        row.booked_by = user.user_id
        row.booked_at = now_utc()
    db.add(row)
    db.flush()
    write_audit(
        db,
        module=MODULE,
        action="budget.rechnung_erfasst",
        user_id=user.user_id,
        object_type="rechnung",
        object_id=str(row.id),
        ip=client_ip(request),
        details=_invoice_details(row),
    )
    db.commit()
    return _invoice_rows(db, [row])[0]


@router.put("/invoices/{invoice_id}")
def update_invoice(
    request: Request, invoice_id: InvoiceId, body: InvoiceIn, user: Editor, db: DbDep
) -> InvoiceOut:
    row = _own_invoice(db, invoice_id, user)
    gross = _invoice_gross(db, body)
    before = _invoice_details(row)
    _apply_invoice(row, body, gross)
    write_audit(
        db,
        module=MODULE,
        action="budget.rechnung_geaendert",
        user_id=user.user_id,
        object_type="rechnung",
        object_id=str(row.id),
        ip=client_ip(request),
        details={"vorher": before, "nachher": _invoice_details(row)},
    )
    db.commit()
    return _invoice_rows(db, [row])[0]


@router.post("/invoices/{invoice_id}/book")
def book_invoice(request: Request, invoice_id: InvoiceId, user: Manager, db: DbDep) -> InvoiceOut:
    """Prüft und bucht eine Rechnung; erst danach zählt sie zum Ist."""
    row: BudgetInvoice | None = db.get(BudgetInvoice, invoice_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    if row.status == STATUS_BOOKED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Die Rechnung ist schon gebucht."
        )
    row.status = STATUS_BOOKED
    row.booked_by = user.user_id
    row.booked_at = now_utc()
    write_audit(
        db,
        module=MODULE,
        action="budget.rechnung_gebucht",
        user_id=user.user_id,
        object_type="rechnung",
        object_id=str(row.id),
        ip=client_ip(request),
        details=_invoice_details(row),
    )
    db.commit()
    return _invoice_rows(db, [row])[0]


@router.delete("/invoices/{invoice_id}")
def delete_invoice(
    request: Request, invoice_id: InvoiceId, user: Editor, db: DbDep
) -> dict[str, bool]:
    row = _own_invoice(db, invoice_id, user)
    write_audit(
        db,
        module=MODULE,
        action="budget.rechnung_geloescht",
        user_id=user.user_id,
        object_type="rechnung",
        object_id=str(row.id),
        ip=client_ip(request),
        details=_invoice_details(row),
    )
    db.delete(row)
    db.commit()
    return {"deleted": True}


# --- Partner: Detail und Zusammenlegen ---


class PartnerDetailOut(BaseModel):
    partner: PartnerOut
    # Verträge, in denen die Firma Vertragspartner oder Rechnungssteller ist
    contracts: list[ContractOut]
    # Rechnungen der Firma aus allen Jahren, die neueste zuerst (höchstens 500)
    invoices: list[InvoiceOut]
    invoice_total: int


class MergeIn(BaseModel):
    # In diesen Partner geht der im Pfad genannte auf
    into_id: int = Field(ge=1)


class MergeOut(BaseModel):
    partner: PartnerOut
    moved_contracts: int
    moved_invoices: int


INVOICE_LIMIT = 500


@router.get("/partners/{partner_id}")
def partner_detail(partner_id: PartnerId, user: Reader, db: DbDep) -> PartnerDetailOut:
    row: BudgetPartner | None = db.get(BudgetPartner, partner_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    partners, accounts, items, today, year_range, _ = _contract_context(db)
    contracts = [
        contract_out(entry, partners, accounts, items, today, year_range)
        for entry in db.scalars(
            select(BudgetContract).where(
                (BudgetContract.partner_id == row.id) | (BudgetContract.invoicer_id == row.id)
            )
        ).all()
    ]
    contracts.sort(key=lambda entry: (not entry.running, entry.title.lower(), entry.id))
    where = BudgetInvoice.invoicer_id == row.id
    invoices = list(
        db.scalars(
            select(BudgetInvoice)
            .where(where)
            .order_by(BudgetInvoice.invoice_date.desc(), BudgetInvoice.id.desc())
            .limit(INVOICE_LIMIT)
        ).all()
    )
    total = db.scalar(select(func.count()).select_from(BudgetInvoice).where(where)) or 0
    return PartnerDetailOut(
        partner=partner_out(row),
        contracts=contracts,
        invoices=_invoice_rows(db, invoices),
        invoice_total=total,
    )


@router.post("/partners/{partner_id}/merge")
def merge_partner(
    request: Request, partner_id: PartnerId, body: MergeIn, user: Manager, db: DbDep
) -> MergeOut:
    """Legt einen doppelt angelegten Partner mit einem anderen zusammen.

    Verträge und Rechnungen wandern zum Ziel, der Partner aus dem Pfad wird gelöscht.
    """
    source: BudgetPartner | None = db.get(BudgetPartner, partner_id)
    target: BudgetPartner | None = db.get(BudgetPartner, body.into_id)
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    if target is None or target.id == source.id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Bitte einen anderen vorhandenen Partner als Ziel wählen.",
        )
    moved_contracts = 0
    for contract in db.scalars(
        select(BudgetContract).where(
            (BudgetContract.partner_id == source.id) | (BudgetContract.invoicer_id == source.id)
        )
    ).all():
        if contract.partner_id == source.id:
            contract.partner_id = target.id
        if contract.invoicer_id == source.id:
            contract.invoicer_id = target.id
        # Derselbe Partner als Rechnungssteller ist keine Abweichung mehr.
        if contract.invoicer_id == contract.partner_id:
            contract.invoicer_id = None
        moved_contracts += 1
    for item in db.scalars(select(BudgetItem).where(BudgetItem.partner_id == source.id)).all():
        item.partner_id = target.id
    moved_invoices = 0
    for invoice in db.scalars(
        select(BudgetInvoice).where(BudgetInvoice.invoicer_id == source.id)
    ).all():
        invoice.invoicer_id = target.id
        moved_invoices += 1
    # Das Ziel übernimmt, was dem Quellpartner erlaubt war, und fehlende Angaben.
    target.is_contract_partner = target.is_contract_partner or source.is_contract_partner
    target.is_invoicer = target.is_invoicer or source.is_invoicer
    target.active = target.active or source.active
    if not target.customer_number:
        target.customer_number = source.customer_number
    if not target.note:
        target.note = source.note
    write_audit(
        db,
        module=MODULE,
        action="budget.partner_zusammengelegt",
        user_id=user.user_id,
        object_type="partner",
        object_id=str(target.id),
        ip=client_ip(request),
        details={
            "quelle": {"id": source.id, "name": source.name},
            "ziel": target.name,
            "vertraege": moved_contracts,
            "rechnungen": moved_invoices,
        },
    )
    db.flush()
    db.delete(source)
    db.commit()
    return MergeOut(
        partner=partner_out(target), moved_contracts=moved_contracts, moved_invoices=moved_invoices
    )


# --- Löschen ---


def _deleted(
    db: DbDep, request: Request, user: CurrentUser, kind: str, object_id: int, name: str
) -> dict[str, bool]:
    write_audit(
        db,
        module=MODULE,
        action=f"budget.{kind}_geloescht",
        user_id=user.user_id,
        object_type=kind,
        object_id=str(object_id),
        ip=client_ip(request),
        details={"name": name},
    )
    db.commit()
    return {"deleted": True}


def _count(db: DbDep, model: type[Base], condition: ColumnElement[bool]) -> int:
    return db.scalar(select(func.count()).select_from(model).where(condition)) or 0


def _blocked(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


@router.delete("/contracts/{contract_id}")
def delete_contract(
    request: Request, contract_id: ContractId, user: Editor, db: DbDep
) -> dict[str, bool]:
    """Löscht einen Vertrag, solange keine Rechnung an ihm hängt."""
    row: BudgetContract | None = db.get(BudgetContract, contract_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    invoices = _count(db, BudgetInvoice, BudgetInvoice.contract_id == row.id)
    if invoices:
        raise _blocked(
            f"Am Vertrag hängen noch {invoices} Rechnung(en). "
            "Bitte erst diese umhängen oder löschen."
        )
    title = row.title
    db.delete(row)
    return _deleted(db, request, user, "vertrag", contract_id, title)


@router.delete("/items/{item_id}")
def delete_item(request: Request, item_id: ItemId, user: Editor, db: DbDep) -> dict[str, bool]:
    """Löscht einen Budgetposten samt Plänen, wenn kein Vertrag und keine Rechnung auf ihm liegt."""
    row: BudgetItem | None = db.get(BudgetItem, item_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    contracts = _count(db, BudgetContract, BudgetContract.item_id == row.id)
    invoices = _count(db, BudgetInvoice, BudgetInvoice.item_id == row.id)
    if contracts or invoices:
        raise _blocked(
            f"Auf dem Budgetposten liegen noch {contracts} Vertrag/Verträge und {invoices} "
            "Rechnung(en). Bitte erst diese umhängen oder löschen, oder den Posten stilllegen."
        )
    name = row.name
    db.delete(row)
    return _deleted(db, request, user, "posten", item_id, name)


@router.delete("/partners/{partner_id}")
def delete_partner(
    request: Request, partner_id: PartnerId, user: Editor, db: DbDep
) -> dict[str, bool]:
    """Löscht einen Partner, solange kein Vertrag und keine Rechnung auf ihn verweist."""
    row: BudgetPartner | None = db.get(BudgetPartner, partner_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    contracts = _count(
        db,
        BudgetContract,
        (BudgetContract.partner_id == row.id) | (BudgetContract.invoicer_id == row.id),
    )
    invoices = _count(db, BudgetInvoice, BudgetInvoice.invoicer_id == row.id)
    items = _count(db, BudgetItem, BudgetItem.partner_id == row.id)
    if contracts or invoices or items:
        raise _blocked(
            f"Der Partner hat noch {contracts} Vertrag/Verträge, {invoices} Rechnung(en) und "
            f"{items} Budgetposten. "
            "Bitte erst diese umhängen oder löschen, den Partner zusammenlegen oder stilllegen."
        )
    name = row.name
    db.delete(row)
    return _deleted(db, request, user, "partner", partner_id, name)


# --- Planung über mehrere Jahre ---


class YearStatusIn(BaseModel):
    status: Literal["entwurf", "freigegeben"]


class PlanYearOut(BaseModel):
    year: int
    name: str
    status: str


class PlanningRow(BaseModel):
    item: ItemOut
    # Plan je Geschäftsjahr (Schlüssel: Jahr); fehlt ein Jahr, ist nichts geplant
    plans: dict[int, int]
    # Erwartete Vertragskosten je Geschäftsjahr als Vorschlag
    proposals: dict[int, int]


class PlanningOut(BaseModel):
    year_label: str
    years: list[PlanYearOut]
    rows: list[PlanningRow]


@router.put("/years/{year}/status")
def set_year_status(
    request: Request, year: Year, body: YearStatusIn, user: Manager, db: DbDep
) -> PlanYearOut:
    """Gibt den Plan eines Geschäftsjahrs frei oder hebt die Freigabe auf."""
    row: BudgetYear | None = db.get(BudgetYear, year)
    before = row.status if row is not None else YEAR_DRAFT
    if row is None:
        row = BudgetYear(fiscal_year=year, status=body.status)
        db.add(row)
    row.status = body.status
    released = body.status == YEAR_RELEASED
    row.released_at = now_utc() if released else None
    row.released_by = user.user_id if released else None
    if before != body.status:
        write_audit(
            db,
            module=MODULE,
            action="budget.jahr_freigegeben" if released else "budget.jahr_freigabe_aufgehoben",
            user_id=user.user_id,
            object_type="geschaeftsjahr",
            object_id=str(year),
            ip=client_ip(request),
            details={"vorher": before, "nachher": body.status},
        )
    db.commit()
    start_month = load_settings(db).start_month
    return PlanYearOut(year=year, name=fiscal_year_name(year, start_month), status=body.status)


@router.get("/planning")
def planning(user: Reader, db: DbDep) -> PlanningOut:
    """Plan aller Budgetposten für das laufende und die folgenden Geschäftsjahre."""
    settings = load_settings(db)
    current = fiscal_year_of(now_utc().date(), settings.start_month)
    years = [year for year in range(current, current + PLAN_AHEAD + 1) if year <= YEAR_MAX]
    plans: dict[int, dict[int, int]] = {}
    for plan in db.scalars(select(BudgetPlan).where(BudgetPlan.fiscal_year.in_(years))).all():
        plans.setdefault(plan.item_id, {})[plan.fiscal_year] = plan.amount_cents
    proposals: dict[int, dict[int, int]] = {}
    contracts = db.scalars(select(BudgetContract)).all()
    for year in years:
        first_day, last_day = fiscal_year_range(year, settings.start_month)
        for contract in contracts:
            cents = expected_cents(contract, first_day, last_day)
            if cents:
                by_year = proposals.setdefault(contract.item_id, {})
                by_year[year] = by_year.get(year, 0) + cents
    accounts = {row.id: row for row in _accounts(db)}
    partners = _partner_map(db)
    rows = [
        PlanningRow(
            item=item_out(item, accounts, partners),
            plans=plans.get(item.id, {}),
            proposals=proposals.get(item.id, {}),
        )
        for item in _items(db, accounts)
        if item.active or item.id in plans or item.id in proposals
    ]
    return PlanningOut(
        year_label=settings.year_label,
        years=[
            PlanYearOut(
                year=year,
                name=fiscal_year_name(year, settings.start_month),
                status=_year_status(db, year),
            )
            for year in years
        ],
        rows=rows,
    )
