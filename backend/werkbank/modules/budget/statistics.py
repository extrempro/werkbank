"""Statistik des IT-Budgets: Überblick eines Geschäftsjahrs und Vergleich über mehrere Jahre.

Plan sind die erwarteten Kosten der Budgetposten (je Geschäftsjahr, ohne Monat), Ist sind
gebuchte Rechnungspositionen nach Rechnungsdatum. Alle Beträge sind brutto.
"""

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.modules.budget.contracts import is_running, notice_deadline, yearly_cents
from werkbank.modules.budget.models import (
    BudgetContract,
    BudgetInvoice,
    BudgetInvoiceLine,
    BudgetItem,
    BudgetPartner,
)
from werkbank.modules.budget.plan import expected_in
from werkbank.modules.budget.settings import fiscal_year_of, fiscal_year_range

BOOKED = "gebucht"
# Verträge, deren Kündigungstermin in so vielen Tagen erreicht ist, zählen als „bald kündbar“.
CONTRACT_SOON_DAYS = 90
# So viele nächste Kündigungstermine zeigt der Überblick.
CONTRACT_NEXT = 3


def same_day_in(day: date, year: int) -> date:
    """Derselbe Tag in einem anderen Kalenderjahr; aus dem 29. Februar wird sonst der 28."""
    try:
        return day.replace(year=year)
    except ValueError:
        return day.replace(year=year, day=28)


def cutoff_for(today: date, current: int, year: int) -> date:
    """Stichtag in einem Geschäftsjahr: derselbe Tag wie heute, um die Jahre verschoben."""
    return same_day_in(today, today.year - (current - year))


def fiscal_month(day: date, start_month: int) -> int:
    """Monat im Geschäftsjahr, 0 für den ersten."""
    return (day.month - start_month) % 12


def elapsed_months(year: int, current: int, today: date, start_month: int) -> int:
    """Angefangene Monate des Geschäftsjahrs: 12 für vergangene, 0 für künftige."""
    if year < current:
        return 12
    if year > current:
        return 0
    return fiscal_month(today, start_month) + 1


@dataclass
class BookedLine:
    item_id: int
    invoicer_id: int
    invoice_date: date
    gross_cents: int


def booked_lines(db: Session, first: date, last: date) -> list[BookedLine]:
    """Gebuchte Rechnungspositionen mit Rechnungsdatum im Zeitraum."""
    rows = db.execute(
        select(
            BudgetInvoiceLine.item_id,
            BudgetInvoice.invoicer_id,
            BudgetInvoice.invoice_date,
            BudgetInvoiceLine.gross_cents,
        )
        .join(BudgetInvoice, BudgetInvoice.id == BudgetInvoiceLine.invoice_id)
        .where(BudgetInvoice.status == BOOKED, BudgetInvoice.invoice_date.between(first, last))
    ).all()
    return [BookedLine(*row) for row in rows]


@dataclass
class AccountYear:
    expected_cents: int = 0
    actual_cents: int = 0
    # Ist bis zum Stichtag; ohne Stichtag gleich dem Ist
    actual_to_date_cents: int = 0


@dataclass
class Comparison:
    """Plan und Ist je Konto und Geschäftsjahr."""

    years: list[int]
    cutoff: date | None
    accounts: dict[int, dict[int, AccountYear]] = field(default_factory=dict)


def compare_accounts(
    db: Session,
    items: list[BudgetItem],
    years: list[int],
    start_month: int,
    today: date,
    current: int,
    with_cutoff: bool,
) -> Comparison:
    """Plan und Ist je Konto über die Jahre; mit Stichtag zusätzlich das Ist bis dahin."""
    result = Comparison(years=years, cutoff=today if with_cutoff else None)
    if not years:
        return result
    for item in items:
        for year in years:
            amount = expected_in(item, year)
            if amount is not None:
                entry = result.accounts.setdefault(item.account_id, {}).setdefault(
                    year, AccountYear()
                )
                entry.expected_cents += amount
    account_of = {item.id: item.account_id for item in items}
    first = fiscal_year_range(years[0], start_month)[0]
    last = fiscal_year_range(years[-1], start_month)[1]
    for line in booked_lines(db, first, last):
        account = account_of.get(line.item_id)
        if account is None:
            continue
        year = fiscal_year_of(line.invoice_date, start_month)
        entry = result.accounts.setdefault(account, {}).setdefault(year, AccountYear())
        entry.actual_cents += line.gross_cents
        if not with_cutoff or line.invoice_date <= cutoff_for(today, current, year):
            entry.actual_to_date_cents += line.gross_cents
    return result


@dataclass
class TagYear:
    expected_cents: int = 0
    actual_cents: int = 0
    actual_to_date_cents: int = 0


def tag_years(
    db: Session,
    items: list[BudgetItem],
    years: list[int],
    start_month: int,
    today: date,
    current: int,
) -> dict[int, TagYear]:
    """Plan, Ist und Ist bis zum Stichtag der Posten je Geschäftsjahr."""
    out = {year: TagYear() for year in years}
    if not years or not items:
        return out
    for item in items:
        for year in years:
            amount = expected_in(item, year)
            if amount is not None:
                out[year].expected_cents += amount
    ids = {item.id for item in items}
    first = fiscal_year_range(years[0], start_month)[0]
    last = fiscal_year_range(years[-1], start_month)[1]
    for line in booked_lines(db, first, last):
        if line.item_id not in ids:
            continue
        year = fiscal_year_of(line.invoice_date, start_month)
        if year not in out:
            continue
        out[year].actual_cents += line.gross_cents
        if line.invoice_date <= cutoff_for(today, current, year):
            out[year].actual_to_date_cents += line.gross_cents
    return out


@dataclass
class YearSummary:
    expected_cents: int
    actual_cents: int
    # Ist je Monat des Geschäftsjahrs
    months: list[int]
    # Ist je Konto
    accounts_actual: dict[int, int]
    accounts_expected: dict[int, int]
    # Ist je Rechnungssteller
    partners: dict[int, int]


def summarize_year(
    db: Session, items: list[BudgetItem], year: int, start_month: int
) -> YearSummary:
    """Plan, Ist, Ist je Monat, je Konto und je Rechnungssteller eines Geschäftsjahrs."""
    expected = 0
    accounts_expected: dict[int, int] = {}
    for item in items:
        amount = expected_in(item, year)
        if amount is not None:
            expected += amount
            accounts_expected[item.account_id] = accounts_expected.get(item.account_id, 0) + amount
    account_of = {item.id: item.account_id for item in items}
    months = [0] * 12
    accounts_actual: dict[int, int] = {}
    partners: dict[int, int] = {}
    first, last = fiscal_year_range(year, start_month)
    for line in booked_lines(db, first, last):
        months[fiscal_month(line.invoice_date, start_month)] += line.gross_cents
        account = account_of.get(line.item_id)
        if account is not None:
            accounts_actual[account] = accounts_actual.get(account, 0) + line.gross_cents
        partners[line.invoicer_id] = partners.get(line.invoicer_id, 0) + line.gross_cents
    return YearSummary(
        expected_cents=expected,
        actual_cents=sum(months),
        months=months,
        accounts_actual=accounts_actual,
        accounts_expected=accounts_expected,
        partners=partners,
    )


def actual_until(db: Session, year: int, start_month: int, until: date | None) -> int:
    """Ist eines Geschäftsjahrs, auf Wunsch nur bis zu einem Tag."""
    first, last = fiscal_year_range(year, start_month)
    if until is not None:
        last = min(last, until)
    if last < first:
        return 0
    return sum(line.gross_cents for line in booked_lines(db, first, last))


@dataclass
class ContractDeadline:
    contract: BudgetContract
    partner: str
    deadline: date
    yearly_cents: int | None


@dataclass
class ContractSummary:
    yearly_cents: int
    soon: int
    next: list[ContractDeadline]


def summarize_contracts(db: Session, today: date) -> ContractSummary:
    """Wiederkehrende Kosten laufender Verträge und die nächsten Kündigungstermine."""
    names = {row.id: row.name for row in db.scalars(select(BudgetPartner)).all()}
    total = 0
    upcoming: list[ContractDeadline] = []
    for contract in db.scalars(select(BudgetContract)).all():
        if not is_running(contract, today):
            continue
        cost = yearly_cents(contract)
        total += cost or 0
        deadline = notice_deadline(contract, today)
        if deadline is not None and deadline >= today:
            upcoming.append(
                ContractDeadline(contract, names.get(contract.partner_id, ""), deadline, cost)
            )
    upcoming.sort(key=lambda entry: (entry.deadline, entry.contract.title.lower()))
    soon = sum(1 for entry in upcoming if (entry.deadline - today).days <= CONTRACT_SOON_DAYS)
    return ContractSummary(yearly_cents=total, soon=soon, next=upcoming[:CONTRACT_NEXT])
