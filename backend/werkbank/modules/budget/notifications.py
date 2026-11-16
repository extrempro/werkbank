"""Benachrichtigungen des Bereichs IT-Budget."""

from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.notifications import Event
from werkbank.modules.budget.api import STATUS_BOOKED, _year_lines
from werkbank.modules.budget.contracts import is_running, notice_deadline
from werkbank.modules.budget.models import BudgetContract, BudgetInvoice, BudgetItem, BudgetPartner
from werkbank.modules.budget.plan import expected_in
from werkbank.modules.budget.settings import fiscal_year_name, fiscal_year_of, load_settings

INVOICES_LINK = "/budget/rechnungen"
OVERVIEW_LINK = "/budget"
# Erinnerung vor dem Kündigungstermin, sobald höchstens so viele Tage fehlen (engste Stufe)
NOTICE_STEPS = (7, 30, 60)
EURO = 100


def _euro(cents: int) -> str:
    return f"{cents / EURO:,.2f} €".replace(",", "X").replace(".", ",").replace("X", ".")


def budget_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    """Rechnungen zur Prüfung und gebuchte, Kündigungstermine, Ist über Plan."""
    partners = dict(db.execute(select(BudgetPartner.id, BudgetPartner.name)).all())
    for invoice in db.scalars(select(BudgetInvoice)):
        invoicer = partners.get(invoice.invoicer_id, "")
        if invoice.status != STATUS_BOOKED:
            yield Event(
                kind="budget.rechnung_pruefen",
                key=str(invoice.id),
                title=f"Rechnung {invoice.number} von {invoicer} prüfen",
                link=INVOICES_LINK,
            )
        elif (
            invoice.created_by is not None
            and invoice.booked_by is not None
            and invoice.booked_by != invoice.created_by
        ):
            yield Event(
                kind="budget.rechnung_gebucht",
                key=str(invoice.id),
                title=f"Rechnung {invoice.number} von {invoicer} wurde gebucht",
                link=INVOICES_LINK,
                user_ids=frozenset({invoice.created_by}),
            )

    today = now.date()
    for contract in db.scalars(select(BudgetContract)):
        deadline = notice_deadline(contract, today)
        if deadline is None or not is_running(contract, today):
            continue
        left = (deadline - today).days
        reached = [days for days in NOTICE_STEPS if 0 <= left <= days]
        if reached:
            yield Event(
                kind="budget.kuendigung",
                key=f"{contract.id}:{deadline.isoformat()}:{reached[0]}",
                title=f"Kündigen bis {deadline:%d.%m.%Y}: {contract.title}",
                link=f"/budget/vertraege/{contract.id}",
            )

    budget = load_settings(db)
    year = fiscal_year_of(today, budget.start_month)
    lines = _year_lines(db, [year], budget.start_month)
    for item in db.scalars(select(BudgetItem)):
        expected = expected_in(item, year)
        spent = lines.get((item.id, year))
        if expected is None or spent is None or spent.actual_cents <= expected:
            continue
        yield Event(
            kind="budget.prognose",
            key=f"{item.id}:{year}",
            title=(
                f"{item.name}: Ist {_euro(spent.actual_cents)} über dem Plan "
                f"{_euro(expected)} ({fiscal_year_name(year, budget.start_month)})"
            ),
            link=OVERVIEW_LINK,
        )
