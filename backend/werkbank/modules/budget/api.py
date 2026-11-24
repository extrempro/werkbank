"""API des Moduls IT-Budget: Konten, Posten, Plan, Verträge, Rechnungen und Statistik."""

from datetime import date, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import ColumnElement, delete, func, select

from werkbank.core.app_settings import set_setting
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep, require_roles
from werkbank.core.models import User
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.core.xlsx import XLSX_TYPE, Cell, Money, Sheet, workbook
from werkbank.db import Base
from werkbank.modules.budget.contracts import (
    INTERVALS,
    NOTICE_WARN_DAYS,
    due_dates,
    expected_cents,
    gross_cents,
    is_running,
    net_from_gross,
    notice_deadline,
    term_end,
    yearly_cents,
)
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
    BudgetContract,
    BudgetContractItem,
    BudgetInvoice,
    BudgetInvoiceLine,
    BudgetItem,
    BudgetItemClosure,
    BudgetPartner,
    BudgetStatistic,
    BudgetTag,
)
from werkbank.modules.budget.numbers import assign_item_number, item_number
from werkbank.modules.budget.plan import (
    ITEM_CLOSED,
    ITEM_INVOICED,
    ITEM_OPEN,
    YearLines,
    expected_in,
    forecast,
    item_status,
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
from werkbank.modules.budget.statistics import (
    CONTRACT_SOON_DAYS,
    actual_until,
    compare_accounts,
    cutoff_for,
    elapsed_months,
    summarize_contracts,
    summarize_year,
    tag_years,
)
from werkbank.modules.budget.tags import (
    adopt_spelling,
    clean_tag,
    clean_tags,
    matches,
)
from werkbank.modules.projects.models import Project

router = APIRouter(prefix="/api/budget")

MODULE = "budget"
KIND_RUNNING = "laufend"
KIND_INVESTMENT = "investition"
STATUS_OPEN = "zu_pruefen"
STATUS_BOOKED = "gebucht"
STATUS_LABELS = {STATUS_OPEN: "zu prüfen", STATUS_BOOKED: "gebucht"}
# So weit darf ein von Hand eingetragenes Brutto vom gerechneten abweichen (in Cent).
GROSS_TOLERANCE = 100
# Netto aus Brutto gerechnet kann um einen Cent vom Brutto zurück abweichen
ROUNDING_CENTS = 1
# So viele Geschäftsjahre nach dem laufenden stehen in der Jahresauswahl.
PLAN_AHEAD = 5
# So viele Geschäftsjahre zeigen Mehrjahresübersicht, Statistik und Export.
WINDOW_YEARS = 5
# Obergrenze je Betrag: 10 Milliarden Euro in Cent
AMOUNT_MAX = 1_000_000_000_000

Reader = Annotated[
    CurrentUser,
    Depends(require_roles(Role.BUDGET_READER, Role.BUDGET_EDITOR, Role.BUDGET_MANAGER)),
]
Editor = Annotated[CurrentUser, Depends(require_roles(Role.BUDGET_EDITOR, Role.BUDGET_MANAGER))]
Manager = Annotated[CurrentUser, Depends(require_roles(Role.BUDGET_MANAGER))]
AccountId = Annotated[int, Path(ge=1)]
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
            raise ValueError("Bitte gib eine Bezeichnung an")
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


class InvoiceRef(BaseModel):
    """Eine Rechnung zu einem Budgetposten, für Links und das PDF-Symbol."""

    id: int
    number: str
    invoice_date: date
    # Geschäftsjahr der Rechnung (für den Link in die Liste dieses Jahres)
    year: int
    status: str
    # Es gibt einen PDF-Beleg
    has_document: bool


class ItemOut(BaseModel):
    id: int
    # Feste Nummer, z. B. BP-2026-012
    number: str
    account_id: int
    account_number: str
    account_name: str
    # Art des Kontos: laufend oder investition
    kind: str
    name: str
    # Erwartete Kosten je Geschäftsjahr (brutto) und Laufzeit; ohne Ende: bis auf Weiteres
    amount_cents: int
    # Dasselbe netto und der Steuersatz in Hundertstel Prozent (1900 = 19 %)
    net_cents: int
    tax_rate_bp: int
    start_year: int
    start_year_name: str
    end_year: int | None
    end_year_name: str | None
    note: str
    tags: list[str]
    active: bool
    # Nur mit Angabe eines Geschäftsjahrs: offen, rechnung, abgeschlossen oder None
    status: str | None = None
    # Zugeordneter Vertrag (höchstens einer)
    contract_id: int | None = None
    contract_title: str | None = None
    # IT-Projekt, zu dem der Posten gehört (höchstens eins)
    project_id: int | None = None
    project_name: str | None = None
    # Partner (Firma) des Postens; ältere Posten haben noch keinen
    partner_id: int | None = None
    partner_name: str | None = None
    # Rechnungen mit Positionen auf diesem Posten, neueste zuerst
    invoices: list[InvoiceRef] = Field(default_factory=list)


class ItemIn(BaseModel):
    account_id: int = Field(ge=1)
    # Partner (Firma) des Postens, Pflicht
    partner_id: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=160)
    # Erwartete Kosten brutto; fürs Budget zählt das Brutto
    amount_cents: int = Field(default=0, ge=0, le=AMOUNT_MAX)
    # Steuersatz in Hundertstel Prozent (1900 = 19 %), frei wählbar
    tax_rate_bp: int = Field(default=1900, ge=0, le=10_000)
    # Netto; None: aus Brutto und Steuersatz rechnen. Angegeben muss es zum Brutto passen.
    net_cents: int | None = Field(default=None, ge=0, le=AMOUNT_MAX)
    # Erstes Geschäftsjahr. None: beim Anlegen das laufende, beim Ändern bleibt es.
    start_year: int | None = Field(default=None, ge=YEAR_MIN, le=YEAR_MAX)
    # None: bis auf Weiteres; gleich start_year: einmalig
    end_year: int | None = Field(default=None, ge=YEAR_MIN, le=YEAR_MAX)
    note: str = Field(default="", max_length=500)
    tags: list[str] = Field(default_factory=list, max_length=50)
    active: bool = True
    # Zugeordneter Vertrag; None: keiner. Ohne Angabe bleibt die Zuordnung beim Ändern.
    contract_id: int | None = Field(default=None, ge=1)
    # IT-Projekt; None: keins. Ohne Angabe bleibt die Zuordnung beim Ändern.
    project_id: int | None = Field(default=None, ge=1)

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

    @field_validator("tags")
    @classmethod
    def tidy_tags(cls, value: list[str]) -> list[str]:
        return clean_tags(value)

    @model_validator(mode="after")
    def end_after_start(self) -> ItemIn:
        start, end = self.start_year, self.end_year
        if start is not None and end is not None and end < start:
            raise ValueError("Die Laufzeit endet vor ihrem Beginn")
        return self


class OverviewRow(BaseModel):
    """Ein Konto mit den Summen seiner Budgetposten."""

    account: AccountOut
    # Erwartete Kosten brutto in Cent; None: in diesem Jahr läuft kein Posten des Kontos
    expected_cents: int | None
    previous_cents: int | None
    # Summe der gebuchten Rechnungspositionen und die Prognose
    actual_cents: int
    forecast_cents: int


class ItemRow(BaseModel):
    item: ItemOut
    expected_cents: int | None
    previous_cents: int | None
    actual_cents: int
    forecast_cents: int
    # offen, rechnung (Rechnung liegt vor) oder abgeschlossen
    status: str | None
    # Abgeschlossen von Hand („Abschließen“ am Posten) bzw. durch eine Rechnungsposition
    closed_by_hand: bool = False
    closed_by_invoice: bool = False
    # Zahl der laufenden Verträge, die diesem Posten zugeordnet sind
    contracts: int


class Totals(BaseModel):
    running_cents: int
    investment_cents: int
    total_cents: int


class YearOut(BaseModel):
    year: int
    name: str


class StatusCounts(BaseModel):
    open: int
    invoiced: int
    closed: int


class OverviewOut(BaseModel):
    settings: SettingsOut
    year: int
    year_name: str
    first_day: date
    last_day: date
    years: list[YearOut]
    rows: list[OverviewRow]
    items: list[ItemRow]
    expected: Totals
    previous: Totals
    actual: Totals
    forecast: Totals
    # Budgetposten dieses Jahres nach Status
    statuses: StatusCounts
    # Rechnungen dieses Jahres, die noch auf die Prüfung warten
    open_invoices: int


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


def item_out(
    row: BudgetItem,
    accounts: dict[int, BudgetAccount],
    start_month: int,
    status_text: str | None = None,
    contract: BudgetContract | None = None,
    projects: dict[int, str] | None = None,
    invoices: dict[int, list[InvoiceRef]] | None = None,
) -> ItemOut:
    account = accounts.get(row.account_id)
    return ItemOut(
        id=row.id,
        number=item_number(row.number_year, row.number_seq),
        account_id=row.account_id,
        account_number=account.number if account else "",
        account_name=account.name if account else "",
        kind=account.kind if account else KIND_RUNNING,
        name=row.name,
        amount_cents=row.amount_cents,
        net_cents=row.net_cents,
        tax_rate_bp=row.tax_rate_bp,
        start_year=row.start_year,
        start_year_name=fiscal_year_name(row.start_year, start_month),
        end_year=row.end_year,
        end_year_name=(
            fiscal_year_name(row.end_year, start_month) if row.end_year is not None else None
        ),
        note=row.note,
        tags=list(row.tags),
        active=row.active,
        status=status_text,
        contract_id=contract.id if contract else None,
        contract_title=contract.title if contract else None,
        project_id=row.project_id,
        project_name=(
            projects.get(row.project_id)
            if projects is not None and row.project_id is not None
            else None
        ),
        partner_id=row.partner_id,
        partner_name=row.partner.name if row.partner is not None else None,
        invoices=(invoices or {}).get(row.id, []),
    )


# Höchstens so viele Rechnungen je Posten in Listen und Ansichten
INVOICES_PER_ITEM = 20


def item_invoices(db: DbDep) -> dict[int, list[InvoiceRef]]:
    """Rechnungen je Budgetposten (über ihre Positionen), neueste zuerst."""
    rows = db.execute(
        select(
            BudgetInvoiceLine.item_id,
            BudgetInvoice.id,
            BudgetInvoice.number,
            BudgetInvoice.invoice_date,
            BudgetInvoice.status,
            BudgetInvoice.doc_key,
        )
        .join(BudgetInvoice, BudgetInvoice.id == BudgetInvoiceLine.invoice_id)
        .order_by(BudgetInvoice.invoice_date.desc(), BudgetInvoice.id.desc())
    ).all()
    start_month = load_settings(db).start_month
    out: dict[int, list[InvoiceRef]] = {}
    for item_id, invoice_id, number, invoice_date, invoice_status, doc_key in rows:
        refs = out.setdefault(item_id, [])
        if len(refs) >= INVOICES_PER_ITEM or any(ref.id == invoice_id for ref in refs):
            continue
        refs.append(
            InvoiceRef(
                id=invoice_id,
                number=number,
                invoice_date=invoice_date,
                year=fiscal_year_of(invoice_date, start_month),
                status=invoice_status,
                has_document=doc_key is not None,
            )
        )
    return out


def _year_lines(db: DbDep, years: list[int], start_month: int) -> dict[tuple[int, int], YearLines]:
    """Rechnungspositionen der Jahre je (Posten, Jahr)."""
    by_item: dict[tuple[int, int], YearLines] = {}
    if not years:
        return by_item
    first_day = fiscal_year_range(min(years), start_month)[0]
    last_day = fiscal_year_range(max(years), start_month)[1]
    rows = db.execute(
        select(BudgetInvoiceLine, BudgetInvoice.invoice_date, BudgetInvoice.status)
        .join(BudgetInvoice, BudgetInvoice.id == BudgetInvoiceLine.invoice_id)
        .where(BudgetInvoice.invoice_date.between(first_day, last_day))
    ).all()
    for line, invoice_date, invoice_status in rows:
        year = fiscal_year_of(invoice_date, start_month)
        entry = by_item.setdefault((line.item_id, year), YearLines())
        entry.invoiced = True
        if invoice_status == STATUS_BOOKED:
            entry.actual_cents += line.gross_cents
            if line.closes_item:
                entry.closed = entry.closed_by_invoice = True
    for closure in db.scalars(
        select(BudgetItemClosure).where(BudgetItemClosure.year.between(min(years), max(years)))
    ).all():
        entry = by_item.setdefault((closure.item_id, closure.year), YearLines())
        entry.closed = entry.closed_by_hand = True
    return by_item


def _items(db: DbDep, accounts: dict[int, BudgetAccount]) -> list[BudgetItem]:
    """Budgetposten, sortiert nach Kontonummer und Name."""

    def key(row: BudgetItem) -> tuple[str, str, int]:
        account = accounts.get(row.account_id)
        return (account.number.lower() if account else "", row.name.lower(), row.id)

    return sorted(db.scalars(select(BudgetItem)).all(), key=key)


def _item_contracts(db: DbDep) -> dict[int, BudgetContract]:
    """Der zugeordnete Vertrag je Budgetposten."""
    rows = db.execute(
        select(BudgetContractItem.item_id, BudgetContract).join(
            BudgetContract, BudgetContract.id == BudgetContractItem.contract_id
        )
    ).all()
    return {item_id: contract for item_id, contract in rows}


def _project_names(db: DbDep) -> dict[int, str]:
    """Name je IT-Projekt, für die Anzeige am Budgetposten."""
    return {row.id: row.name for row in db.scalars(select(Project)).all()}


def _sum(values: list[int | None]) -> int | None:
    """Summe der vorhandenen Werte; None, wenn keiner vorhanden ist."""
    known = [value for value in values if value is not None]
    return sum(known) if known else None


def _overview(db: DbDep, year: int) -> OverviewOut:
    settings = load_settings(db)
    out = settings_out(settings)
    first_day, last_day = fiscal_year_range(year, settings.start_month)
    lines = _year_lines(db, [year], settings.start_month)
    today = now_utc().date()
    contracts: dict[int, int] = {}
    linked = _contract_items(db)
    for contract in db.scalars(select(BudgetContract)).all():
        if is_running(contract, today):
            for item_id in linked.get(contract.id, []):
                contracts[item_id] = contracts.get(item_id, 0) + 1
    open_invoices = (
        db.scalar(
            select(func.count())
            .select_from(BudgetInvoice)
            .where(
                BudgetInvoice.invoice_date.between(first_day, last_day),
                BudgetInvoice.status != STATUS_BOOKED,
            )
        )
        or 0
    )
    accounts = {row.id: row for row in _accounts(db)}
    item_contracts = _item_contracts(db)
    projects = _project_names(db)
    invoices = item_invoices(db)
    items: list[ItemRow] = []
    for item in _items(db, accounts):
        expected = expected_in(item, year)
        year_lines = lines.get((item.id, year))
        status_text = item_status(item, year, year_lines)
        spent = year_lines.actual_cents if year_lines else 0
        closed = status_text == ITEM_CLOSED
        # Ein Posten erscheint, solange er läuft oder in dem Jahr Rechnungen hat;
        # stillgelegte nur mit Rechnungen.
        if status_text is None:
            continue
        if not item.active and year_lines is None:
            continue
        items.append(
            ItemRow(
                item=item_out(
                    item,
                    accounts,
                    settings.start_month,
                    contract=item_contracts.get(item.id),
                    projects=projects,
                    invoices=invoices,
                ),
                expected_cents=expected,
                previous_cents=expected_in(item, year - 1),
                actual_cents=spent,
                forecast_cents=forecast(expected, spent, closed),
                status=status_text,
                closed_by_hand=bool(year_lines and year_lines.closed_by_hand),
                closed_by_invoice=bool(year_lines and year_lines.closed_by_invoice),
                contracts=contracts.get(item.id, 0),
            )
        )
    rows = []
    for account in accounts.values():
        own = [entry for entry in items if entry.item.account_id == account.id]
        # Stillgelegte Konten erscheinen nur, solange sie Posten in diesem Jahr haben.
        if not account.active and not own:
            continue
        rows.append(
            OverviewRow(
                account=account_out(account),
                expected_cents=_sum([entry.expected_cents for entry in own]),
                previous_cents=_sum([entry.previous_cents for entry in own]),
                actual_cents=sum(entry.actual_cents for entry in own),
                forecast_cents=sum(entry.forecast_cents for entry in own),
            )
        )
    start_years = set(db.scalars(select(BudgetItem.start_year).distinct()).all())
    years = sorted(
        {*start_years, *range(out.current_year - 5, out.current_year + PLAN_AHEAD + 1), year},
        reverse=True,
    )
    states = [entry.status for entry in items]
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
        items=items,
        expected=_totals([(row.account.kind, row.expected_cents) for row in rows]),
        previous=_totals([(row.account.kind, row.previous_cents) for row in rows]),
        actual=_totals([(row.account.kind, row.actual_cents) for row in rows]),
        forecast=_totals([(row.account.kind, row.forecast_cents) for row in rows]),
        statuses=StatusCounts(
            open=states.count(ITEM_OPEN),
            invoiced=states.count(ITEM_INVOICED),
            closed=states.count(ITEM_CLOSED),
        ),
        open_invoices=open_invoices,
    )


@router.get("/overview")
def overview(user: Reader, db: DbDep, year: YearQuery = None) -> OverviewOut:
    if year is None:
        year = fiscal_year_of(now_utc().date(), load_settings(db).start_month)
    return _overview(db, year)


# --- Budgetposten ---

ItemId = Annotated[int, Path(ge=1)]


def _check_item(db: DbDep, body: ItemIn, own_id: int | None) -> None:
    if db.get(BudgetAccount, body.account_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Das Konto gibt es nicht."
        )
    if db.get(BudgetPartner, body.partner_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Den Partner gibt es nicht."
        )
    if body.contract_id is not None and db.get(BudgetContract, body.contract_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Den Vertrag gibt es nicht."
        )
    if (
        body.net_cents is not None
        and abs(gross_cents(body.net_cents, body.tax_rate_bp) - body.amount_cents) > ROUNDING_CENTS
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Netto, Steuersatz und Brutto passen nicht zusammen.",
        )
    _check_project(db, body, own_id)
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


def _check_project(db: DbDep, body: ItemIn, own_id: int | None) -> None:
    """Das Projekt muss es geben; ein abgeschlossenes nur, wenn der Posten schon dazugehört."""
    if body.project_id is None:
        return
    project: Project | None = db.get(Project, body.project_id)
    if project is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Das Projekt gibt es nicht."
        )
    current = db.get(BudgetItem, own_id) if own_id is not None else None
    if project.status == "abgeschlossen" and (current is None or current.project_id != project.id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Das Projekt ist abgeschlossen. Ihm lassen sich keine Posten mehr zuordnen.",
        )


def _known_tags(db: DbDep) -> list[str]:
    """Die Tags aus der Liste des Budgetverwalters."""
    return list(db.scalars(select(BudgetTag.name).order_by(BudgetTag.id)).all())


def _listed_tags(db: DbDep, tags: list[str]) -> list[str]:
    """Tags in der Schreibweise der Liste; 422, wenn einer nicht in der Liste steht."""
    known = {tag.casefold(): tag for tag in _known_tags(db)}
    missing = [tag for tag in tags if tag.casefold() not in known]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Den Tag „{missing[0]}“ gibt es nicht. "
            "Tags legt der Budgetverwalter unter Einstellungen an.",
        )
    return [known[tag.casefold()] for tag in tags]


@router.get("/items")
def list_items(user: Reader, db: DbDep, year: YearQuery = None) -> list[ItemOut]:
    """Alle Budgetposten; mit Geschäftsjahr samt ihrem Status in diesem Jahr."""
    start_month = load_settings(db).start_month
    accounts = {row.id: row for row in _accounts(db)}
    rows = _items(db, accounts)
    contracts = _item_contracts(db)
    projects = _project_names(db)
    invoices = item_invoices(db)
    if year is None:
        return [
            item_out(
                row,
                accounts,
                start_month,
                contract=contracts.get(row.id),
                projects=projects,
                invoices=invoices,
            )
            for row in rows
        ]
    lines = _year_lines(db, [year], start_month)
    return [
        item_out(
            row,
            accounts,
            start_month,
            item_status(row, year, lines.get((row.id, year))),
            contracts.get(row.id),
            projects,
            invoices,
        )
        for row in rows
    ]


def _set_item_contract(db: DbDep, item_id: int, contract_id: int | None) -> None:
    """Ordnet dem Budgetposten einen Vertrag zu oder löst die Zuordnung (None)."""
    db.execute(delete(BudgetContractItem).where(BudgetContractItem.item_id == item_id))
    if contract_id is not None:
        db.add(BudgetContractItem(contract_id=contract_id, item_id=item_id))
    db.flush()


def _item_contract_id(db: DbDep, item_id: int) -> int | None:
    return db.scalar(
        select(BudgetContractItem.contract_id).where(BudgetContractItem.item_id == item_id)
    )


def _one_item(db: DbDep, row: BudgetItem) -> ItemOut:
    contract_id = _item_contract_id(db, row.id)
    return item_out(
        row,
        {entry.id: entry for entry in _accounts(db)},
        load_settings(db).start_month,
        contract=db.get(BudgetContract, contract_id) if contract_id is not None else None,
        projects=_project_names(db),
        invoices=item_invoices(db),
    )


def _item_details(row: BudgetItem) -> dict[str, object]:
    return {
        "account_id": row.account_id,
        "partner_id": row.partner_id,
        "name": row.name,
        "amount_cents": row.amount_cents,
        "start_year": row.start_year,
        "end_year": row.end_year,
        "active": row.active,
        "tags": list(row.tags),
        "project_id": row.project_id,
    }


def _apply_item(db: DbDep, row: BudgetItem, body: ItemIn) -> None:
    if body.start_year is not None:
        row.start_year = body.start_year
    elif row.start_year is None:
        row.start_year = fiscal_year_of(now_utc().date(), load_settings(db).start_month)
    if body.end_year is not None and body.end_year < row.start_year:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Die Laufzeit endet vor ihrem Beginn.",
        )
    row.account_id = body.account_id
    # Auch die Beziehung setzen, damit der Name gleich in der Antwort steht
    row.partner_id = body.partner_id
    row.partner = db.get(BudgetPartner, body.partner_id)
    row.name = body.name
    row.amount_cents = body.amount_cents
    row.tax_rate_bp = body.tax_rate_bp
    row.net_cents = (
        net_from_gross(body.amount_cents, body.tax_rate_bp)
        if body.net_cents is None
        else body.net_cents
    )
    row.end_year = body.end_year
    row.note = body.note
    row.active = body.active


@router.post("/items", status_code=status.HTTP_201_CREATED)
def create_item(request: Request, body: ItemIn, user: Editor, db: DbDep) -> ItemOut:
    """Legt einen Budgetposten an: Konto, Bezeichnung, erwartete Kosten und Laufzeit."""
    _check_item(db, body, None)
    row = BudgetItem(tags=_listed_tags(db, body.tags), project_id=body.project_id)
    _apply_item(db, row, body)
    assign_item_number(db, row)
    db.add(row)
    db.flush()
    _set_item_contract(db, row.id, body.contract_id)
    write_audit(
        db,
        module=MODULE,
        action="budget.posten_angelegt",
        user_id=user.user_id,
        object_type="posten",
        object_id=str(row.id),
        ip=client_ip(request),
        details={**_item_details(row), "contract_id": body.contract_id},
    )
    db.commit()
    return _one_item(db, row)


@router.put("/items/{item_id}")
def update_item(
    request: Request, item_id: ItemId, body: ItemIn, user: Editor, db: DbDep
) -> ItemOut:
    row: BudgetItem | None = db.get(BudgetItem, item_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    _check_item(db, body, row.id)
    before = {**_item_details(row), "contract_id": _item_contract_id(db, row.id)}
    _apply_item(db, row, body)
    row.tags = _listed_tags(db, body.tags)
    if "project_id" in body.model_fields_set:
        row.project_id = body.project_id
    if "contract_id" in body.model_fields_set:
        _set_item_contract(db, row.id, body.contract_id)
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
            "nachher": {**_item_details(row), "contract_id": _item_contract_id(db, row.id)},
        },
    )
    db.commit()
    return _one_item(db, row)


class ClosureIn(BaseModel):
    year: int = Field(ge=YEAR_MIN, le=YEAR_MAX)


class ClosureOut(BaseModel):
    item_id: int
    year: int
    status: str | None
    closed_by_hand: bool
    closed_by_invoice: bool


def _closure_out(db: DbDep, row: BudgetItem, year: int) -> ClosureOut:
    lines = _year_lines(db, [year], load_settings(db).start_month).get((row.id, year))
    return ClosureOut(
        item_id=row.id,
        year=year,
        status=item_status(row, year, lines),
        closed_by_hand=bool(lines and lines.closed_by_hand),
        closed_by_invoice=bool(lines and lines.closed_by_invoice),
    )


@router.post("/items/{item_id}/close")
def close_item(
    request: Request, item_id: ItemId, body: ClosureIn, user: Editor, db: DbDep
) -> ClosureOut:
    """Hakt einen Budgetposten für ein Geschäftsjahr ab: Er gilt dort als abgeschlossen."""
    row: BudgetItem | None = db.get(BudgetItem, item_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    current = _closure_out(db, row, body.year)
    if current.status is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Der Posten läuft in diesem Geschäftsjahr nicht.",
        )
    if db.get(BudgetItemClosure, (row.id, body.year)) is None:
        db.add(BudgetItemClosure(item_id=row.id, year=body.year, closed_by=user.user_id))
        write_audit(
            db,
            module=MODULE,
            action="budget.posten_abgeschlossen",
            user_id=user.user_id,
            object_type="posten",
            object_id=str(row.id),
            ip=client_ip(request),
            details={"jahr": body.year, "name": row.name},
        )
        db.commit()
    return _closure_out(db, row, body.year)


@router.post("/items/{item_id}/reopen")
def reopen_item(
    request: Request, item_id: ItemId, body: ClosureIn, user: Editor, db: DbDep
) -> ClosureOut:
    """Nimmt das Abhaken zurück. Schließt eine Rechnungsposition den Posten, bleibt er zu."""
    row: BudgetItem | None = db.get(BudgetItem, item_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    closure = db.get(BudgetItemClosure, (row.id, body.year))
    if closure is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Der Posten ist in diesem Geschäftsjahr nicht von Hand abgeschlossen.",
        )
    db.delete(closure)
    write_audit(
        db,
        module=MODULE,
        action="budget.posten_wieder_geoeffnet",
        user_id=user.user_id,
        object_type="posten",
        object_id=str(row.id),
        ip=client_ip(request),
        details={"jahr": body.year, "name": row.name},
    )
    db.commit()
    return _closure_out(db, row, body.year)


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
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
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


class ContractItemOut(BaseModel):
    id: int
    number: str
    name: str
    account_number: str
    account_name: str
    # Rechnungen des Postens, neueste zuerst
    invoices: list[InvoiceRef] = Field(default_factory=list)


class ContractOut(BaseModel):
    id: int
    title: str
    partner_id: int
    partner_name: str
    # Zugeordnete Budgetposten
    items: list[ContractItemOut]
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
    # Soll: Zahlungen, die im gewählten Geschäftsjahr fällig werden (bis zur Kündigung)
    current_year_cents: int
    # Ist: gebuchte Rechnungen der zugeordneten Posten, die im Geschäftsjahr abgeschlossen sind
    year_actual_cents: int
    # So viele der zugeordneten Posten sind im Geschäftsjahr abgeschlossen
    closed_items: int


class ContractListOut(BaseModel):
    # Gewähltes Geschäftsjahr (Vorgabe: das laufende)
    year: int
    current_year_name: str
    years: list[YearOut]
    notice_warn_days: int
    entries: list[ContractOut]


class ContractIn(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    partner_id: int = Field(ge=1)
    # Zugeordnete Budgetposten; ein Vertrag kann auch ohne Posten bestehen.
    item_ids: list[int] = Field(default_factory=list, max_length=50)
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
    # Brutto, wenn es eingegeben wurde (Netto dann daraus gerechnet); muss dazu passen
    gross_cents: int | None = Field(default=None, ge=0, le=2 * AMOUNT_MAX)
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

    @field_validator("item_ids")
    @classmethod
    def distinct_items(cls, value: list[int]) -> list[int]:
        if any(item_id < 1 for item_id in value):
            raise ValueError("Ungültiger Budgetposten")
        return list(dict.fromkeys(value))

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
    item_ids: list[int],
    actuals: dict[int, int] | None = None,
    invoices: dict[int, list[InvoiceRef]] | None = None,
) -> ContractOut:
    deadline = notice_deadline(row, today)
    days = (deadline - today).days if deadline is not None else None
    partner = partners.get(row.partner_id)
    linked: list[ContractItemOut] = []
    for item_id in item_ids:
        item = items.get(item_id)
        if item is None:
            continue
        account = accounts.get(item.account_id)
        linked.append(
            ContractItemOut(
                id=item.id,
                number=item_number(item.number_year, item.number_seq),
                name=item.name,
                account_number=account.number if account else "",
                account_name=account.name if account else "",
                invoices=(invoices or {}).get(item.id, []),
            )
        )
    linked.sort(key=lambda entry: (entry.account_number, entry.name.lower(), entry.id))
    invoicer = partners.get(row.invoicer_id) if row.invoicer_id is not None else None
    running = is_running(row, today)
    return ContractOut(
        id=row.id,
        title=row.title,
        partner_id=row.partner_id,
        partner_name=partner.name if partner else "",
        items=linked,
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
        year_actual_cents=sum((actuals or {}).get(item_id, 0) for item_id in item_ids),
        closed_items=sum(1 for item_id in item_ids if item_id in (actuals or {})),
    )


def _contract_context(
    db: DbDep,
    year: int | None = None,
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
    if year is None:
        year = fiscal_year_of(today, settings.start_month)
    return (
        {row.id: row for row in db.scalars(select(BudgetPartner)).all()},
        {row.id: row for row in db.scalars(select(BudgetAccount)).all()},
        {row.id: row for row in db.scalars(select(BudgetItem)).all()},
        today,
        fiscal_year_range(year, settings.start_month),
        fiscal_year_name(year, settings.start_month),
    )


def _contract_items(db: DbDep) -> dict[int, list[int]]:
    """Zugeordnete Budgetposten je Vertrag."""
    linked: dict[int, list[int]] = {}
    for entry in db.scalars(select(BudgetContractItem)).all():
        linked.setdefault(entry.contract_id, []).append(entry.item_id)
    return linked


def _contract_actuals(db: DbDep, year: int) -> dict[int, int]:
    """Ist je Budgetposten, der im Geschäftsjahr abgeschlossen ist (gebuchte Rechnungen)."""
    lines = _year_lines(db, [year], load_settings(db).start_month)
    return {
        item_id: entry.actual_cents
        for (item_id, line_year), entry in lines.items()
        if line_year == year and entry.closed
    }


def _one_contract(db: DbDep, row: BudgetContract) -> ContractOut:
    partners, accounts, items, today, year_range, _ = _contract_context(db)
    linked = _contract_items(db).get(row.id, [])
    year = fiscal_year_of(today, load_settings(db).start_month)
    return contract_out(
        row,
        partners,
        accounts,
        items,
        today,
        year_range,
        linked,
        _contract_actuals(db, year),
        item_invoices(db),
    )


def _check_contract(db: DbDep, body: ContractIn, own_id: int | None) -> None:
    problem: str | None = None
    if db.get(BudgetPartner, body.partner_id) is None:
        problem = "Den Partner gibt es nicht."
    elif len(
        db.scalars(select(BudgetItem.id).where(BudgetItem.id.in_(body.item_ids))).all()
    ) != len(body.item_ids):
        problem = "Einen der Budgetposten gibt es nicht."
    elif body.invoicer_id is not None and db.get(BudgetPartner, body.invoicer_id) is None:
        problem = "Den Rechnungssteller gibt es nicht."
    elif body.ends_on is not None and body.ends_on < body.starts_on:
        problem = "Das Ende der Laufzeit liegt vor dem Beginn."
    elif body.cancelled_to is not None and body.cancelled_to < body.starts_on:
        problem = "Der Kündigungstag liegt vor dem Beginn."
    elif body.ends_on is None and body.renewal_months is not None:
        problem = "Eine Verlängerung gibt es nur bei einem Ende der Laufzeit."
    elif (
        body.gross_cents is not None
        and abs(gross_cents(body.net_cents, body.tax_rate_bp) - body.gross_cents) > ROUNDING_CENTS
    ):
        problem = "Netto, Steuersatz und Brutto passen nicht zusammen."
    if problem:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=problem)
    # Ein Budgetposten hat höchstens einen Vertrag.
    taken = db.execute(
        select(BudgetItem.name, BudgetContract.title)
        .join(BudgetContractItem, BudgetContractItem.item_id == BudgetItem.id)
        .join(BudgetContract, BudgetContract.id == BudgetContractItem.contract_id)
        .where(BudgetItem.id.in_(body.item_ids), BudgetContract.id != (own_id or 0))
    ).first()
    if taken is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Der Budgetposten „{taken[0]}“ gehört schon zum Vertrag „{taken[1]}“. "
            "Ein Budgetposten hat höchstens einen Vertrag.",
        )


def _link_items(db: DbDep, contract_id: int, item_ids: list[int]) -> None:
    """Ersetzt die zugeordneten Budgetposten eines Vertrags."""
    db.execute(delete(BudgetContractItem).where(BudgetContractItem.contract_id == contract_id))
    for item_id in item_ids:
        db.add(BudgetContractItem(contract_id=contract_id, item_id=item_id))


def _apply_contract(row: BudgetContract, body: ContractIn) -> None:
    row.title = body.title
    row.partner_id = body.partner_id
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
    row.amount_cents = (
        gross_cents(body.net_cents, body.tax_rate_bp)
        if body.gross_cents is None
        else body.gross_cents
    )
    row.interval = body.interval
    row.note = body.note


def _contract_details(body: ContractIn) -> dict[str, object]:
    return {
        "title": body.title,
        "partner_id": body.partner_id,
        "item_ids": body.item_ids,
        "net_cents": body.net_cents,
        "tax_rate_bp": body.tax_rate_bp,
        "interval": body.interval,
        "starts_on": body.starts_on.isoformat(),
        "ends_on": body.ends_on.isoformat() if body.ends_on else None,
        "cancelled_to": body.cancelled_to.isoformat() if body.cancelled_to else None,
    }


@router.get("/contracts")
def list_contracts(user: Reader, db: DbDep, year: YearQuery = None) -> ContractListOut:
    """Alle Verträge mit Soll und Ist im gewählten Geschäftsjahr (Vorgabe: das laufende)."""
    start_month = load_settings(db).start_month
    current = fiscal_year_of(now_utc().date(), start_month)
    chosen = current if year is None else year
    partners, accounts, items, today, year_range, year_name = _contract_context(db, chosen)
    linked = _contract_items(db)
    actuals = _contract_actuals(db, chosen)
    invoices = item_invoices(db)
    entries = [
        contract_out(
            row,
            partners,
            accounts,
            items,
            today,
            year_range,
            linked.get(row.id, []),
            actuals,
            invoices,
        )
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
    years = sorted({*range(current - 5, current + PLAN_AHEAD + 1), chosen}, reverse=True)
    return ContractListOut(
        year=chosen,
        current_year_name=year_name,
        years=[
            YearOut(year=entry, name=fiscal_year_name(entry, start_month))
            for entry in years
            if YEAR_MIN <= entry <= YEAR_MAX
        ],
        notice_warn_days=NOTICE_WARN_DAYS,
        entries=entries,
    )


@router.post("/contracts", status_code=status.HTTP_201_CREATED)
def create_contract(request: Request, body: ContractIn, user: Editor, db: DbDep) -> ContractOut:
    _check_contract(db, body, None)
    row = BudgetContract()
    _apply_contract(row, body)
    db.add(row)
    db.flush()
    _link_items(db, row.id, body.item_ids)
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
    _check_contract(db, body, row.id)
    before = {
        "title": row.title,
        "item_ids": _contract_items(db).get(row.id, []),
        "amount_cents": row.amount_cents,
        "interval": row.interval,
        "ends_on": row.ends_on.isoformat() if row.ends_on else None,
        "cancelled_to": row.cancelled_to.isoformat() if row.cancelled_to else None,
    }
    _apply_contract(row, body)
    _link_items(db, row.id, body.item_ids)
    db.flush()
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


MONTH_NAMES = (
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
)


class MonthlyItemsIn(BaseModel):
    # Geschäftsjahr, für das je fälliger Zahlung ein Posten entsteht
    year: int = Field(ge=YEAR_MIN, le=YEAR_MAX)
    account_id: int = Field(ge=1)


class MonthlyItemsOut(BaseModel):
    created: list[ItemOut]
    # Monate, für die es im Konto schon einen Posten mit diesem Namen gibt
    skipped: int


def _monthly_name(title: str, due: date) -> str:
    return f"{title[:140]} {MONTH_NAMES[due.month - 1]} {due.year}"


@router.post("/contracts/{contract_id}/monthly-items", status_code=status.HTTP_201_CREATED)
def create_monthly_items(
    request: Request, contract_id: ContractId, body: MonthlyItemsIn, user: Editor, db: DbDep
) -> MonthlyItemsOut:
    """Legt für einen monatlichen Vertrag je fälliger Zahlung im Geschäftsjahr einen Posten an.

    Partner und Betrag kommen aus dem Vertrag, die Posten werden ihm zugeordnet. Gibt es im
    Konto schon einen Posten mit demselben Namen, entsteht für diesen Monat keiner.
    """
    row: BudgetContract | None = db.get(BudgetContract, contract_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    if row.interval != "monatlich":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Monatsposten gibt es nur für Verträge mit monatlicher Zahlung.",
        )
    account: BudgetAccount | None = db.get(BudgetAccount, body.account_id)
    if account is None or not account.active:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Das Konto gibt es nicht oder es ist stillgelegt.",
        )
    first, last = fiscal_year_range(body.year, load_settings(db).start_month)
    days = due_dates(row, first, last)
    if not days:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="In diesem Geschäftsjahr ist aus dem Vertrag keine Zahlung fällig.",
        )
    taken = {
        name.casefold()
        for name in db.scalars(select(BudgetItem.name).where(BudgetItem.account_id == account.id))
    }
    partner = db.get(BudgetPartner, row.partner_id)
    created: list[BudgetItem] = []
    skipped = 0
    for due in days:
        name = _monthly_name(row.title, due)
        if name.casefold() in taken:
            skipped += 1
            continue
        item = BudgetItem(
            account_id=account.id,
            partner_id=row.partner_id,
            partner=partner,
            name=name,
            amount_cents=row.amount_cents,
            net_cents=row.net_cents,
            tax_rate_bp=row.tax_rate_bp,
            start_year=body.year,
            end_year=body.year,
            note=f"Monatsposten aus dem Vertrag {row.title}"[:500],
            tags=[],
            active=True,
        )
        assign_item_number(db, item)
        db.add(item)
        db.flush()
        db.add(BudgetContractItem(contract_id=row.id, item_id=item.id))
        taken.add(name.casefold())
        created.append(item)
    write_audit(
        db,
        module=MODULE,
        action="budget.monatsposten_angelegt",
        user_id=user.user_id,
        object_type="vertrag",
        object_id=str(row.id),
        ip=client_ip(request),
        details={
            "year": body.year,
            "account_id": account.id,
            "item_ids": [item.id for item in created],
            "skipped": skipped,
        },
    )
    db.commit()
    return MonthlyItemsOut(created=[_one_item(db, item) for item in created], skipped=skipped)


# --- Rechnungen ---

InvoiceId = Annotated[int, Path(ge=1)]


class InvoiceLineOut(BaseModel):
    id: int
    item_id: int
    # Feste Nummer des Budgetpostens, z. B. BP-2026-012
    item_number: str
    item_name: str
    account_number: str
    account_name: str
    # Vertrag des Budgetpostens, wie er jetzt zugeordnet ist
    contract_id: int | None
    contract_title: str | None
    net_cents: int
    tax_rate_bp: int
    gross_cents: int
    description: str
    is_project: bool
    is_yearly: bool
    closes_item: bool


class InvoiceOut(BaseModel):
    id: int
    invoicer_id: int
    invoicer_name: str
    number: str
    internal_number: str
    invoice_date: date
    # Summen der Positionen
    net_cents: int
    gross_cents: int
    lines: list[InvoiceLineOut]
    status: str
    created_by_name: str | None
    booked_by_name: str | None
    booked_at: datetime | None
    # PDF-Beleg: Dateiname und Größe in Bytes; None: kein Beleg
    doc_name: str | None
    doc_size: int | None


class InvoiceListOut(BaseModel):
    year: int
    year_name: str
    years: list[YearOut]
    entries: list[InvoiceOut]


LINES_MAX = 50


class InvoiceLineIn(BaseModel):
    item_id: int = Field(ge=1)
    net_cents: int = Field(ge=0, le=AMOUNT_MAX)
    tax_rate_bp: int = Field(default=1900, ge=0, le=10_000)
    # None: Brutto aus Netto und Steuersatz rechnen. Sonst das Brutto laut Rechnung.
    gross_cents: int | None = Field(default=None, ge=0, le=2 * AMOUNT_MAX)
    description: str = Field(default="", max_length=200)
    is_project: bool = False
    is_yearly: bool = False
    # Schließt den Budgetposten für das Geschäftsjahr der Rechnung ab, sobald sie gebucht ist.
    # Ohne Angabe: ja, außer der Budgetposten hat einen Vertrag (laufende Zahlungen).
    closes_item: bool | None = None

    @field_validator("description")
    @classmethod
    def plain(cls, value: str) -> str:
        return _single_line(value)


class InvoiceIn(BaseModel):
    invoicer_id: int = Field(ge=1)
    number: str = Field(min_length=1, max_length=80)
    internal_number: str = Field(default="", max_length=60)
    invoice_date: date
    # Eine Rechnung hat mindestens eine Position; jede gehört zu genau einem Budgetposten.
    lines: list[InvoiceLineIn] = Field(min_length=1, max_length=LINES_MAX)
    # Rechnungsbetrag laut Beleg (brutto). Angegeben muss er der Summe der Positionen entsprechen.
    total_gross_cents: int | None = Field(default=None, ge=0, le=2 * AMOUNT_MAX * LINES_MAX)

    @field_validator("number", "internal_number")
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
    contracts = _item_contracts(db)
    user_ids = {uid for row in rows for uid in (row.created_by, row.booked_by) if uid is not None}
    names: dict[object, str] = {}
    if user_ids:
        names = {
            user.id: user.display_name
            for user in db.scalars(select(User).where(User.id.in_(user_ids))).all()
        }

    def line_out(line: BudgetInvoiceLine) -> InvoiceLineOut:
        item = items.get(line.item_id)
        account = accounts.get(item.account_id) if item else None
        contract = contracts.get(line.item_id)
        return InvoiceLineOut(
            id=line.id,
            item_id=line.item_id,
            item_number=item_number(item.number_year, item.number_seq) if item else "",
            item_name=item.name if item else "",
            account_number=account.number if account else "",
            account_name=account.name if account else "",
            contract_id=contract.id if contract else None,
            contract_title=contract.title if contract else None,
            net_cents=line.net_cents,
            tax_rate_bp=line.tax_rate_bp,
            gross_cents=line.gross_cents,
            description=line.description,
            is_project=line.is_project,
            is_yearly=line.is_yearly,
            closes_item=line.closes_item,
        )

    out = []
    for row in rows:
        partner = partners.get(row.invoicer_id)
        out.append(
            InvoiceOut(
                id=row.id,
                invoicer_id=row.invoicer_id,
                invoicer_name=partner.name if partner else "",
                number=row.number,
                internal_number=row.internal_number,
                invoice_date=row.invoice_date,
                net_cents=row.net_cents,
                gross_cents=row.gross_cents,
                lines=[line_out(line) for line in row.lines],
                status=row.status,
                created_by_name=names.get(row.created_by),
                booked_by_name=names.get(row.booked_by),
                booked_at=row.booked_at,
                doc_name=row.doc_name,
                doc_size=row.doc_size,
            )
        )
    return out


def _invoice_gross(db: DbDep, body: InvoiceIn) -> list[int]:
    """Prüft die Bezüge der Rechnung und liefert das Brutto je Position."""
    if db.get(BudgetPartner, body.invoicer_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Den Rechnungssteller gibt es nicht.",
        )
    gross: list[int] = []
    for number, line in enumerate(body.lines, start=1):
        problem: str | None = None
        computed = gross_cents(line.net_cents, line.tax_rate_bp)
        if db.get(BudgetItem, line.item_id) is None:
            problem = "Den Budgetposten gibt es nicht."
        elif line.gross_cents is not None and abs(line.gross_cents - computed) > GROSS_TOLERANCE:
            problem = "Das Brutto weicht um mehr als 1 Euro vom gerechneten Betrag ab."
        if problem:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Position {number}: {problem}",
            )
        gross.append(computed if line.gross_cents is None else line.gross_cents)
    if body.total_gross_cents is not None and body.total_gross_cents != sum(gross):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Die Positionen ergeben nicht den Rechnungsbetrag. "
            "Bitte verteil den ganzen Betrag auf Positionen.",
        )
    return gross


def _apply_invoice(db: DbDep, row: BudgetInvoice, body: InvoiceIn, gross: list[int]) -> None:
    with_contract = set(_item_contracts(db))
    row.invoicer_id = body.invoicer_id
    row.number = body.number
    row.internal_number = body.internal_number
    row.invoice_date = body.invoice_date
    row.net_cents = sum(line.net_cents for line in body.lines)
    row.gross_cents = sum(gross)
    row.lines = [
        BudgetInvoiceLine(
            position=position,
            item_id=line.item_id,
            net_cents=line.net_cents,
            tax_rate_bp=line.tax_rate_bp,
            gross_cents=gross[position],
            description=line.description,
            is_project=line.is_project,
            is_yearly=line.is_yearly,
            closes_item=(
                line.closes_item
                if line.closes_item is not None
                else line.item_id not in with_contract
            ),
        )
        for position, line in enumerate(body.lines)
    ]


def _invoice_details(row: BudgetInvoice) -> dict[str, object]:
    return {
        "number": row.number,
        "invoicer_id": row.invoicer_id,
        "invoice_date": row.invoice_date.isoformat(),
        "gross_cents": row.gross_cents,
        "status": row.status,
        "positionen": [
            {
                "item_id": line.item_id,
                "gross_cents": line.gross_cents,
            }
            for line in row.lines
        ],
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
    _apply_invoice(db, row, body, gross)
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
    _apply_invoice(db, row, body, gross)
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
    request: Request, invoice_id: InvoiceId, user: Editor, db: DbDep, settings: SettingsDep
) -> dict[str, bool]:
    row = _own_invoice(db, invoice_id, user)
    doc_key = row.doc_key
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
    if doc_key:
        remove_document(settings.budget_documents_dir, doc_key)
    return {"deleted": True}


# --- Partner: Detail und Zusammenlegen ---


class PartnerDetailOut(BaseModel):
    partner: PartnerOut
    # Verträge, in denen die Firma Vertragspartner oder Rechnungssteller ist
    contracts: list[ContractOut]
    # Rechnungen der Firma aus allen Jahren, die neueste zuerst (höchstens 500)
    invoices: list[InvoiceOut]
    invoice_total: int
    # Budgetposten, deren Partner die Firma ist
    items: list[ItemOut] = Field(default_factory=list)


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
    linked = _contract_items(db)
    contracts = [
        contract_out(entry, partners, accounts, items, today, year_range, linked.get(entry.id, []))
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
    item_accounts = {entry.id: entry for entry in _accounts(db)}
    own_items = [
        item_out(item, item_accounts, load_settings(db).start_month)
        for item in _items(db, item_accounts)
        if item.partner_id == row.id
    ]
    return PartnerDetailOut(
        partner=partner_out(row),
        contracts=contracts,
        invoices=_invoice_rows(db, invoices),
        invoice_total=total,
        items=own_items,
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
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Bitte wähle einen anderen vorhandenen Partner als Ziel.",
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
    moved_invoices = 0
    for invoice in db.scalars(
        select(BudgetInvoice).where(BudgetInvoice.invoicer_id == source.id)
    ).all():
        invoice.invoicer_id = target.id
        moved_invoices += 1
    moved_items = 0
    for item in db.scalars(select(BudgetItem).where(BudgetItem.partner_id == source.id)).all():
        item.partner_id = target.id
        moved_items += 1
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
            "posten": moved_items,
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
    """Löscht einen Vertrag. Seine Budgetposten bleiben und haben danach keinen Vertrag."""
    row: BudgetContract | None = db.get(BudgetContract, contract_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    db.execute(delete(BudgetContractItem).where(BudgetContractItem.contract_id == row.id))
    title = row.title
    db.delete(row)
    return _deleted(db, request, user, "vertrag", contract_id, title)


@router.delete("/items/{item_id}")
def delete_item(request: Request, item_id: ItemId, user: Editor, db: DbDep) -> dict[str, bool]:
    """Löscht einen Budgetposten samt Plänen, wenn kein Vertrag und keine Rechnung auf ihm liegt."""
    row: BudgetItem | None = db.get(BudgetItem, item_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    contracts = _count(db, BudgetContractItem, BudgetContractItem.item_id == row.id)
    invoices = _count(db, BudgetInvoiceLine, BudgetInvoiceLine.item_id == row.id)
    if contracts or invoices:
        raise _blocked(
            f"Auf dem Budgetposten liegen noch {contracts} Vertrag/Verträge und {invoices} "
            "Rechnungsposition(en). Bitte erst diese umhängen oder löschen, "
            "oder den Posten stilllegen."
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
            f"{items} Budgetposten. Bitte erst diese umhängen oder löschen, den Partner "
            "zusammenlegen oder stilllegen."
        )
    name = row.name
    db.delete(row)
    return _deleted(db, request, user, "partner", partner_id, name)


# --- Mehrjahresübersicht und Export ---


class PlanYearOut(BaseModel):
    year: int
    name: str
    expected_cents: int
    actual_cents: int


class PlanCell(BaseModel):
    # None: der Posten läuft in dem Jahr nicht
    expected_cents: int | None
    actual_cents: int
    status: str | None


class PlanningRow(BaseModel):
    item: ItemOut
    # Je Geschäftsjahr (Schlüssel: Jahr)
    years: dict[int, PlanCell]


class PlanningOut(BaseModel):
    year_label: str
    current_year: int
    years: list[PlanYearOut]
    rows: list[PlanningRow]


WindowStart = Annotated[int | None, Query(ge=YEAR_MIN, le=YEAR_MAX)]


def _planning(db: DbDep, start: int | None) -> PlanningOut:
    settings = load_settings(db)
    current = fiscal_year_of(now_utc().date(), settings.start_month)
    first = current if start is None else start
    years = [year for year in range(first, first + WINDOW_YEARS) if year <= YEAR_MAX]
    lines = _year_lines(db, years, settings.start_month)
    accounts = {row.id: row for row in _accounts(db)}
    rows: list[PlanningRow] = []
    for item in _items(db, accounts):
        cells: dict[int, PlanCell] = {}
        for year in years:
            year_lines = lines.get((item.id, year))
            cells[year] = PlanCell(
                expected_cents=expected_in(item, year),
                actual_cents=year_lines.actual_cents if year_lines else 0,
                status=item_status(item, year, year_lines),
            )
        if all(cell.status is None for cell in cells.values()):
            continue
        rows.append(PlanningRow(item=item_out(item, accounts, settings.start_month), years=cells))
    return PlanningOut(
        year_label=settings.year_label,
        current_year=current,
        years=[
            PlanYearOut(
                year=year,
                name=fiscal_year_name(year, settings.start_month),
                expected_cents=sum(row.years[year].expected_cents or 0 for row in rows),
                actual_cents=sum(row.years[year].actual_cents for row in rows),
            )
            for year in years
        ],
        rows=rows,
    )


@router.get("/planning")
def planning(user: Reader, db: DbDep, start: WindowStart = None) -> PlanningOut:
    """Erwartete Kosten, Ist und Status aller Budgetposten über fünf Geschäftsjahre.

    Ohne Angabe beginnt der Zeitraum mit dem laufenden Geschäftsjahr.
    """
    return _planning(db, start)


STATUS_TEXT = {
    ITEM_OPEN: "offen",
    ITEM_INVOICED: "Rechnung liegt vor",
    ITEM_CLOSED: "abgeschlossen",
}


@router.get("/export")
def export(user: Reader, db: DbDep, start: WindowStart = None) -> Response:
    """Mehrjahresübersicht und Rechnungspositionen desselben Zeitraums als Excel-Datei."""
    data = _planning(db, start)
    settings = load_settings(db)
    overview_rows: list[list[Cell]] = []
    head: list[Cell] = ["Konto", "Kontoname", "Art", "Budgetposten", "Laufzeit", "Tags"]
    for year in data.years:
        head += [f"Erwartet {year.name}", f"Ist {year.name}", f"Status {year.name}"]
    for row in data.rows:
        item = row.item
        until = item.end_year_name or "bis auf Weiteres"
        runtime = (
            item.start_year_name
            if item.end_year == item.start_year
            else (f"{item.start_year_name} bis {until}")
        )
        cells: list[Cell] = [
            item.account_number,
            item.account_name,
            "Investition" if item.kind == KIND_INVESTMENT else "laufend",
            item.name,
            runtime,
            ", ".join(item.tags),
        ]
        for year in data.years:
            cell = row.years[year.year]
            cells += [
                Money(cell.expected_cents) if cell.expected_cents is not None else None,
                Money(cell.actual_cents),
                STATUS_TEXT.get(cell.status or "", ""),
            ]
        overview_rows.append(cells)
    total: list[Cell] = ["Summe", None, None, None, None, None]
    for year in data.years:
        total += [Money(year.expected_cents), Money(year.actual_cents), None]
    overview_rows.append(total)

    line_rows: list[list[Cell]] = []
    if data.years:
        first_day = fiscal_year_range(data.years[0].year, settings.start_month)[0]
        last_day = fiscal_year_range(data.years[-1].year, settings.start_month)[1]
        invoices = list(
            db.scalars(
                select(BudgetInvoice)
                .where(BudgetInvoice.invoice_date.between(first_day, last_day))
                .order_by(BudgetInvoice.invoice_date, BudgetInvoice.id)
            ).all()
        )
        for invoice in _invoice_rows(db, invoices):
            for line in invoice.lines:
                line_rows.append(
                    [
                        invoice.invoice_date,
                        fiscal_year_name(
                            fiscal_year_of(invoice.invoice_date, settings.start_month),
                            settings.start_month,
                        ),
                        invoice.invoicer_name,
                        invoice.number,
                        invoice.internal_number,
                        STATUS_LABELS.get(invoice.status, invoice.status),
                        line.account_number,
                        line.item_name,
                        line.contract_title or "",
                        Money(line.net_cents),
                        line.tax_rate_bp / 100,
                        Money(line.gross_cents),
                        line.description,
                        "ja" if line.is_project else "",
                        "ja" if line.is_yearly else "",
                        "ja" if line.closes_item else "",
                    ]
                )
    line_head: list[Cell] = [
        "Rechnungsdatum",
        settings.year_label,
        "Rechnungssteller",
        "Rechnungsnummer",
        "Interne Nummer",
        "Status",
        "Konto",
        "Budgetposten",
        "Vertrag",
        "Netto",
        "Steuersatz %",
        "Brutto",
        "Bezeichnung",
        "Projekt",
        "jährlich",
        "schließt ab",
    ]
    first_name = data.years[0].name if data.years else ""
    last_name = data.years[-1].name if data.years else ""
    content = workbook(
        [
            Sheet("Mehrjahresübersicht", [head, *overview_rows]),
            Sheet("Rechnungspositionen", [line_head, *line_rows]),
        ]
    )
    filename = f"it-budget-{first_name}-bis-{last_name}.xlsx".replace("/", "-")
    return Response(
        content=content,
        media_type=XLSX_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


# --- PDF-Beleg an der Rechnung ---


@router.put("/invoices/{invoice_id}/document")
async def upload_document(
    request: Request, invoice_id: InvoiceId, user: Editor, db: DbDep, settings: SettingsDep
) -> InvoiceOut:
    """Hängt einen PDF-Beleg an die Rechnung; ein vorhandener wird ersetzt.

    Der Inhalt der Anfrage ist die Datei selbst, der Dateiname steht im Kopf `X-Dateiname`.
    """
    row = _own_invoice(db, invoice_id, user)
    limit = settings.budget_document_max_mb * 1024 * 1024
    too_large = HTTPException(
        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        detail=f"Die Datei ist größer als {settings.budget_document_max_mb} MB.",
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
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Die Datei ist kein PDF.",
        )
    old_key = row.doc_key
    row.doc_key = store_document(settings.budget_documents_dir, data)
    row.doc_name = clean_name(request.headers.get("x-dateiname", ""))
    row.doc_size = len(data)
    write_audit(
        db,
        module=MODULE,
        action="budget.beleg_hochgeladen",
        user_id=user.user_id,
        object_type="rechnung",
        object_id=str(row.id),
        ip=client_ip(request),
        details={"name": row.doc_name, "bytes": row.doc_size, "ersetzt": old_key is not None},
    )
    db.commit()
    if old_key:
        remove_document(settings.budget_documents_dir, old_key)
    return _invoice_rows(db, [row])[0]


@router.get("/invoices/{invoice_id}/document")
def download_document(
    invoice_id: InvoiceId, user: Reader, db: DbDep, settings: SettingsDep
) -> FileResponse:
    """Liefert den Beleg als Download, nie zur Anzeige im Browser."""
    row: BudgetInvoice | None = db.get(BudgetInvoice, invoice_id)
    path = (
        document_path(settings.budget_documents_dir, row.doc_key)
        if row is not None and row.doc_key
        else None
    )
    if row is None or path is None or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    return FileResponse(
        path,
        media_type=PDF_TYPE,
        filename=row.doc_name or "Beleg.pdf",
        content_disposition_type="attachment",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"},
    )


@router.delete("/invoices/{invoice_id}/document")
def delete_document(
    request: Request, invoice_id: InvoiceId, user: Editor, db: DbDep, settings: SettingsDep
) -> InvoiceOut:
    row = _own_invoice(db, invoice_id, user)
    if not row.doc_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    old_key, old_name = row.doc_key, row.doc_name
    row.doc_key = None
    row.doc_name = None
    row.doc_size = None
    write_audit(
        db,
        module=MODULE,
        action="budget.beleg_entfernt",
        user_id=user.user_id,
        object_type="rechnung",
        object_id=str(row.id),
        ip=client_ip(request),
        details={"name": old_name},
    )
    db.commit()
    remove_document(settings.budget_documents_dir, old_key)
    return _invoice_rows(db, [row])[0]


# --- Tags und Statistik ---

StatisticId = Annotated[int, Path(ge=1)]
# So viele Geschäftsjahre zeigt eine Statistik.
STATISTIC_YEARS = 5


class TagOut(BaseModel):
    id: int
    tag: str
    # Anzahl der Budgetposten mit diesem Tag
    items: int


class StatisticQuery(BaseModel):
    tags: list[str] = Field(min_length=1, max_length=50)
    # any: einer der Tags reicht; all: alle Tags müssen am Posten stehen
    mode: Literal["any", "all"] = "any"
    # Erstes Geschäftsjahr des Zeitraums; ohne Angabe enden die fünf Jahre mit dem laufenden
    start: int | None = Field(default=None, ge=YEAR_MIN, le=YEAR_MAX)

    @field_validator("tags")
    @classmethod
    def tidy_tags(cls, value: list[str]) -> list[str]:
        return clean_tags(value)


class StatisticYear(BaseModel):
    year: int
    name: str
    expected_cents: int
    actual_cents: int
    # Ist bis zum selben Tag wie heute (im laufenden Jahr gleich dem Ist)
    actual_to_date_cents: int = 0


class StatisticTag(BaseModel):
    tag: str
    years: list[StatisticYear]


class StatisticItem(BaseModel):
    item: ItemOut
    # Summen über den gezeigten Zeitraum
    expected_cents: int
    actual_cents: int


class StatisticOut(BaseModel):
    year_label: str
    current_year: int
    tags: list[str]
    mode: str
    years: list[StatisticYear]
    items: list[StatisticItem]
    # Dieselben Jahre je einzelnem Tag (ein Posten kann bei mehreren Tags mitzählen)
    per_tag: list[StatisticTag] = []


class SavedStatisticIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    tags: list[str] = Field(min_length=1, max_length=50)
    mode: Literal["any", "all"] = "any"

    @field_validator("name")
    @classmethod
    def plain(cls, value: str) -> str:
        value = _single_line(value)
        if not value:
            raise ValueError("Darf nicht leer sein")
        return value

    @field_validator("tags")
    @classmethod
    def tidy_tags(cls, value: list[str]) -> list[str]:
        return clean_tags(value)


class SavedStatisticOut(BaseModel):
    id: int
    name: str
    tags: list[str]
    mode: str


def saved_statistic_out(row: BudgetStatistic) -> SavedStatisticOut:
    return SavedStatisticOut(id=row.id, name=row.name, tags=list(row.tags), mode=row.mode)


class TagIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)

    @field_validator("name")
    @classmethod
    def tidy(cls, value: str) -> str:
        return clean_tag(value)


TagId = Annotated[int, Path(ge=1)]


def _tag_out(row: BudgetTag, counts: dict[str, int]) -> TagOut:
    return TagOut(id=row.id, tag=row.name, items=counts.get(row.name.casefold(), 0))


def _tag_counts(db: DbDep) -> dict[str, int]:
    counts: dict[str, int] = {}
    for tags in db.scalars(select(BudgetItem.tags)).all():
        for key in {tag.casefold() for tag in tags}:
            counts[key] = counts.get(key, 0) + 1
    return counts


def _tag_taken(db: DbDep, name: str, own_id: int | None) -> None:
    other = db.scalars(select(BudgetTag).where(func.lower(BudgetTag.name) == name.lower())).first()
    if other is not None and other.id != own_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Diesen Tag gibt es schon."
        )


def _replace_tag(db: DbDep, old: str, new: str | None) -> tuple[int, int]:
    """Benennt einen Tag an Posten und Statistiken um (new) oder entfernt ihn (None).

    Statistiken, denen danach kein Tag mehr bleibt, werden gelöscht.
    Liefert die Zahl der geänderten Posten und Statistiken.
    """
    key = old.casefold()

    def swap(tags: list[str]) -> list[str]:
        out: list[str] = []
        for tag in tags:
            value = (new if new is not None else None) if tag.casefold() == key else tag
            if value is not None and value.casefold() not in {entry.casefold() for entry in out}:
                out.append(value)
        return out

    items = 0
    for item in db.scalars(select(BudgetItem)).all():
        if any(tag.casefold() == key for tag in item.tags):
            item.tags = swap(list(item.tags))
            items += 1
    statistics = 0
    for statistic in db.scalars(select(BudgetStatistic)).all():
        if any(tag.casefold() == key for tag in statistic.tags):
            remaining = swap(list(statistic.tags))
            if remaining:
                statistic.tags = remaining
            else:
                db.delete(statistic)
            statistics += 1
    return items, statistics


@router.get("/tags")
def list_tags(user: Reader, db: DbDep) -> list[TagOut]:
    """Die Tag-Liste mit der Zahl der Budgetposten je Tag, nach Name sortiert."""
    counts = _tag_counts(db)
    rows = db.scalars(select(BudgetTag).order_by(func.lower(BudgetTag.name))).all()
    return [_tag_out(row, counts) for row in rows]


@router.post("/tags", status_code=status.HTTP_201_CREATED)
def create_tag(request: Request, body: TagIn, user: Manager, db: DbDep) -> TagOut:
    _tag_taken(db, body.name, None)
    row = BudgetTag(name=body.name)
    db.add(row)
    db.flush()
    write_audit(
        db,
        module=MODULE,
        action="budget.tag_angelegt",
        user_id=user.user_id,
        object_type="tag",
        object_id=str(row.id),
        ip=client_ip(request),
        details={"name": row.name},
    )
    db.commit()
    return _tag_out(row, {})


@router.put("/tags/{tag_id}")
def rename_tag(request: Request, tag_id: TagId, body: TagIn, user: Manager, db: DbDep) -> TagOut:
    """Benennt einen Tag um, auch an allen Budgetposten und gespeicherten Statistiken."""
    row: BudgetTag | None = db.get(BudgetTag, tag_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    _tag_taken(db, body.name, row.id)
    before = row.name
    items, statistics = _replace_tag(db, before, body.name)
    row.name = body.name
    write_audit(
        db,
        module=MODULE,
        action="budget.tag_umbenannt",
        user_id=user.user_id,
        object_type="tag",
        object_id=str(row.id),
        ip=client_ip(request),
        details={
            "vorher": before,
            "nachher": body.name,
            "posten": items,
            "statistiken": statistics,
        },
    )
    db.commit()
    return _tag_out(row, _tag_counts(db))


@router.delete("/tags/{tag_id}")
def delete_tag(request: Request, tag_id: TagId, user: Manager, db: DbDep) -> dict[str, bool]:
    """Löscht einen Tag aus der Liste und von allen Budgetposten und Statistiken."""
    row: BudgetTag | None = db.get(BudgetTag, tag_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    items, statistics = _replace_tag(db, row.name, None)
    write_audit(
        db,
        module=MODULE,
        action="budget.tag_geloescht",
        user_id=user.user_id,
        object_type="tag",
        object_id=str(row.id),
        ip=client_ip(request),
        details={"name": row.name, "posten": items, "statistiken": statistics},
    )
    db.delete(row)
    db.commit()
    return {"deleted": True}


@router.post("/statistics/query")
def query_statistic(body: StatisticQuery, user: Reader, db: DbDep) -> StatisticOut:
    """Plan und Ist der Budgetposten mit den gewählten Tags über fünf Geschäftsjahre.

    Liest nur; POST, damit die Tags nicht in der Adresse und in Protokollen stehen.
    """
    settings = load_settings(db)
    current = fiscal_year_of(now_utc().date(), settings.start_month)
    start = body.start if body.start is not None else current - STATISTIC_YEARS + 1
    years = [year for year in range(start, start + STATISTIC_YEARS) if YEAR_MIN <= year <= YEAR_MAX]
    accounts = {row.id: row for row in _accounts(db)}
    all_items = _items(db, accounts)
    chosen = [item for item in all_items if matches(item.tags, body.tags, body.mode)]
    today = now_utc().date()

    def year_rows(items: list[BudgetItem]) -> list[StatisticYear]:
        sums = tag_years(db, items, years, settings.start_month, today, current)
        return [
            StatisticYear(
                year=year,
                name=fiscal_year_name(year, settings.start_month),
                expected_cents=sums[year].expected_cents,
                actual_cents=sums[year].actual_cents,
                actual_to_date_cents=sums[year].actual_to_date_cents,
            )
            for year in years
        ]

    plan: dict[int, dict[int, int]] = {}
    actual: dict[int, dict[int, int]] = {}
    ids = [item.id for item in chosen]
    for item in chosen:
        for year in years:
            amount = expected_in(item, year)
            if amount is not None:
                plan.setdefault(year, {})[item.id] = amount
    if ids and years:
        first_day = fiscal_year_range(years[0], settings.start_month)[0]
        last_day = fiscal_year_range(years[-1], settings.start_month)[1]
        for line, invoice_date in db.execute(
            select(BudgetInvoiceLine, BudgetInvoice.invoice_date)
            .join(BudgetInvoice, BudgetInvoice.id == BudgetInvoiceLine.invoice_id)
            .where(
                BudgetInvoiceLine.item_id.in_(ids),
                BudgetInvoice.status == STATUS_BOOKED,
                BudgetInvoice.invoice_date.between(first_day, last_day),
            )
        ).all():
            year = fiscal_year_of(invoice_date, settings.start_month)
            by_item = actual.setdefault(year, {})
            by_item[line.item_id] = by_item.get(line.item_id, 0) + line.gross_cents
    spelled = adopt_spelling(body.tags, _known_tags(db))
    return StatisticOut(
        year_label=settings.year_label,
        current_year=current,
        tags=spelled,
        mode=body.mode,
        years=year_rows(chosen),
        items=[
            StatisticItem(
                item=item_out(item, accounts, settings.start_month),
                expected_cents=sum(plan.get(year, {}).get(item.id, 0) for year in years),
                actual_cents=sum(actual.get(year, {}).get(item.id, 0) for year in years),
            )
            for item in chosen
        ],
        per_tag=[
            StatisticTag(
                tag=tag,
                years=year_rows([item for item in all_items if matches(item.tags, [tag], "any")]),
            )
            for tag in spelled
        ],
    )


# --- Statistik: Überblick eines Geschäftsjahrs und Jahresvergleich der Konten ---

# So viele Jahre vor dem gewählten zeigt der Jahresvergleich höchstens.
COMPARE_BACK = 4


class SummaryMonth(BaseModel):
    name: str
    actual_cents: int
    # Ist desselben Monats im Vergleichsjahr; None ohne Vergleich
    compare_cents: int | None


class SummaryAccount(BaseModel):
    account: AccountOut
    expected_cents: int
    actual_cents: int


class SummaryPartner(BaseModel):
    id: int
    name: str
    actual_cents: int


class SummaryContract(BaseModel):
    id: int
    title: str
    partner_name: str
    yearly_cents: int | None
    notice_deadline: date


class SummaryContracts(BaseModel):
    # Jahreskosten aller laufenden Verträge (ohne einmalige Zahlungen)
    yearly_cents: int
    soon_days: int
    # Verträge, deren Kündigungstermin in soon_days Tagen erreicht ist
    soon: int
    next: list[SummaryContract]


class StatisticSummaryOut(BaseModel):
    year_label: str
    current_year: int
    year: int
    year_name: str
    years: list[YearOut]
    compare: int | None
    compare_name: str | None
    # Angefangene Monate des Jahrs: 12 vergangen, 0 künftig
    elapsed_months: int
    expected_cents: int
    actual_cents: int
    # Ist des Vergleichsjahrs bis zum selben Tag bzw. im ganzen Jahr
    compare_to_date_cents: int | None
    compare_actual_cents: int | None
    months: list[SummaryMonth]
    accounts: list[SummaryAccount]
    partners: list[SummaryPartner]
    contracts: SummaryContracts


class CompareValue(BaseModel):
    year: int
    expected_cents: int
    actual_cents: int
    actual_to_date_cents: int


class CompareAccount(BaseModel):
    account: AccountOut
    values: list[CompareValue]


class StatisticCompareOut(BaseModel):
    year_label: str
    current_year: int
    year: int
    years: list[YearOut]
    # Stichtag für „bis heute“; nur, wenn das gewählte Jahr das laufende ist
    cutoff: date | None
    accounts: list[CompareAccount]


def _statistic_years(current: int, chosen: int, start_month: int) -> list[YearOut]:
    first_years = range(current - 10, current + PLAN_AHEAD + 1)
    return [
        YearOut(year=year, name=fiscal_year_name(year, start_month))
        for year in sorted({*first_years, chosen}, reverse=True)
        if YEAR_MIN <= year <= YEAR_MAX
    ]


@router.get("/statistics/summary")
def statistic_summary(
    user: Reader, db: DbDep, year: YearQuery = None, compare: YearQuery = None
) -> StatisticSummaryOut:
    """Plan, Ist je Monat, Konten, Rechnungssteller und Verträge eines Geschäftsjahrs.

    Mit `compare` (ein früheres Jahr) zusätzlich dessen Ist je Monat und bis zum selben Tag.
    """
    settings = load_settings(db)
    today = now_utc().date()
    current = fiscal_year_of(today, settings.start_month)
    chosen = current if year is None else year
    if compare is not None and compare >= chosen:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Vergleich nur mit früheren Jahren"
        )
    accounts = {row.id: row for row in _accounts(db)}
    items = _items(db, accounts)
    summary = summarize_year(db, items, chosen, settings.start_month)
    other = (
        summarize_year(db, items, compare, settings.start_month) if compare is not None else None
    )
    to_date: int | None = None
    if compare is not None:
        until = cutoff_for(today, current, compare) if chosen == current else None
        to_date = actual_until(db, compare, settings.start_month, until)
    names = [MONTH_NAMES[(settings.start_month - 1 + index) % 12] for index in range(12)]
    partner_names = {row.id: row.name for row in db.scalars(select(BudgetPartner)).all()}
    contracts = summarize_contracts(db, today)
    rows = [
        SummaryAccount(
            account=account_out(account),
            expected_cents=summary.accounts_expected.get(account.id, 0),
            actual_cents=summary.accounts_actual.get(account.id, 0),
        )
        for account in accounts.values()
        if account.active
        or account.id in summary.accounts_expected
        or account.id in summary.accounts_actual
    ]
    return StatisticSummaryOut(
        year_label=settings.year_label,
        current_year=current,
        year=chosen,
        year_name=fiscal_year_name(chosen, settings.start_month),
        years=_statistic_years(current, chosen, settings.start_month),
        compare=compare,
        compare_name=fiscal_year_name(compare, settings.start_month)
        if compare is not None
        else None,
        elapsed_months=elapsed_months(chosen, current, today, settings.start_month),
        expected_cents=summary.expected_cents,
        actual_cents=summary.actual_cents,
        compare_to_date_cents=to_date,
        compare_actual_cents=other.actual_cents if other is not None else None,
        months=[
            SummaryMonth(
                name=names[index],
                actual_cents=summary.months[index],
                compare_cents=other.months[index] if other is not None else None,
            )
            for index in range(12)
        ],
        accounts=rows,
        partners=sorted(
            (
                SummaryPartner(id=pid, name=partner_names.get(pid, ""), actual_cents=cents)
                for pid, cents in summary.partners.items()
                if cents
            ),
            key=lambda entry: (-entry.actual_cents, entry.name.lower()),
        ),
        contracts=SummaryContracts(
            yearly_cents=contracts.yearly_cents,
            soon_days=CONTRACT_SOON_DAYS,
            soon=contracts.soon,
            next=[
                SummaryContract(
                    id=entry.contract.id,
                    title=entry.contract.title,
                    partner_name=entry.partner,
                    yearly_cents=entry.yearly_cents,
                    notice_deadline=entry.deadline,
                )
                for entry in contracts.next
            ],
        ),
    )


@router.get("/statistics/compare")
def statistic_compare(user: Reader, db: DbDep, year: YearQuery = None) -> StatisticCompareOut:
    """Plan und Ist je Konto im gewählten Geschäftsjahr und den vier davor.

    Ist das gewählte Jahr das laufende, steht je Jahr auch das Ist bis zum selben Tag wie heute.
    """
    settings = load_settings(db)
    today = now_utc().date()
    current = fiscal_year_of(today, settings.start_month)
    chosen = current if year is None else year
    years = [entry for entry in range(chosen - COMPARE_BACK, chosen + 1) if entry >= YEAR_MIN]
    accounts = {row.id: row for row in _accounts(db)}
    data = compare_accounts(
        db, _items(db, accounts), years, settings.start_month, today, current, chosen == current
    )
    rows = []
    for account in accounts.values():
        own = data.accounts.get(account.id, {})
        if not account.active and not own:
            continue
        values = []
        for entry in years:
            cell = own.get(entry)
            values.append(
                CompareValue(
                    year=entry,
                    expected_cents=cell.expected_cents if cell else 0,
                    actual_cents=cell.actual_cents if cell else 0,
                    actual_to_date_cents=cell.actual_to_date_cents if cell else 0,
                )
            )
        rows.append(CompareAccount(account=account_out(account), values=values))
    return StatisticCompareOut(
        year_label=settings.year_label,
        current_year=current,
        year=chosen,
        years=[
            YearOut(year=entry, name=fiscal_year_name(entry, settings.start_month))
            for entry in years
        ],
        cutoff=data.cutoff,
        accounts=rows,
    )


@router.get("/statistics")
def list_statistics(user: Reader, db: DbDep) -> list[SavedStatisticOut]:
    rows = db.scalars(select(BudgetStatistic).order_by(func.lower(BudgetStatistic.name))).all()
    return [saved_statistic_out(row) for row in rows]


@router.post("/statistics", status_code=status.HTTP_201_CREATED)
def save_statistic(
    request: Request, body: SavedStatisticIn, user: Editor, db: DbDep
) -> SavedStatisticOut:
    """Speichert eine Auswahl von Tags unter einem Namen. Sichtbar für alle Rollen des Budgets."""
    taken = db.scalars(
        select(BudgetStatistic).where(func.lower(BudgetStatistic.name) == body.name.lower())
    ).first()
    if taken is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Eine Statistik mit diesem Namen gibt es schon.",
        )
    row = BudgetStatistic(
        name=body.name,
        tags=adopt_spelling(body.tags, _known_tags(db)),
        mode=body.mode,
        created_by=user.user_id,
    )
    db.add(row)
    db.flush()
    write_audit(
        db,
        module=MODULE,
        action="budget.statistik_gespeichert",
        user_id=user.user_id,
        object_type="statistik",
        object_id=str(row.id),
        ip=client_ip(request),
        details={"name": row.name, "tags": row.tags, "mode": row.mode},
    )
    db.commit()
    return saved_statistic_out(row)


@router.delete("/statistics/{statistic_id}")
def delete_statistic(
    request: Request, statistic_id: StatisticId, user: Editor, db: DbDep
) -> dict[str, bool]:
    row: BudgetStatistic | None = db.get(BudgetStatistic, statistic_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    name = row.name
    db.delete(row)
    return _deleted(db, request, user, "statistik", statistic_id, name)
