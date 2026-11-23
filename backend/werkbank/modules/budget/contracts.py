"""Rechenregeln für Verträge: erwartete Kosten in einem Zeitraum und Kündigungstermin."""

import calendar
from datetime import date

from werkbank.modules.budget.models import BudgetContract

INTERVAL_ONCE = "einmalig"
# Abstand zwischen zwei Zahlungen in Monaten
INTERVAL_MONTHS: dict[str, int] = {
    "monatlich": 1,
    "vierteljaehrlich": 3,
    "halbjaehrlich": 6,
    "jaehrlich": 12,
}
INTERVALS: frozenset[str] = frozenset({*INTERVAL_MONTHS, INTERVAL_ONCE})
# So viele Tage vor dem Kündigungstermin wird ein Vertrag zur Aufgabe.
NOTICE_WARN_DAYS = 60


def add_months(day: date, months: int) -> date:
    """Derselbe Tag im Monat `months` später; gibt es ihn nicht, der letzte Tag des Monats."""
    index = day.year * 12 + (day.month - 1) + months
    year, month = divmod(index, 12)
    last = calendar.monthrange(year, month + 1)[1]
    return date(year, month + 1, min(day.day, last))


def cost_end(contract: BudgetContract) -> date | None:
    """Letzter Tag, an dem noch Kosten anfallen; None: läuft ohne festes Ende weiter."""
    if contract.cancelled_to is not None:
        return contract.cancelled_to
    if contract.renewal_months:
        # Verlängert sich von selbst, solange niemand kündigt.
        return None
    return contract.ends_on


def expected_cents(contract: BudgetContract, first: date, last: date) -> int:
    """Summe der Zahlungen, die zwischen `first` und `last` (einschließlich) fällig werden.

    Die erste Zahlung ist am Vertragsbeginn fällig, die weiteren im Abstand des Turnus.
    """
    return contract.amount_cents * len(due_dates(contract, first, last))


def due_dates(contract: BudgetContract, first: date, last: date) -> list[date]:
    """Tage, an denen zwischen `first` und `last` (einschließlich) eine Zahlung fällig wird."""
    end = cost_end(contract)
    upper = last if end is None else min(last, end)
    if upper < first or contract.starts_on > upper:
        return []
    if contract.interval == INTERVAL_ONCE:
        return [contract.starts_on] if contract.starts_on >= first else []
    step = INTERVAL_MONTHS[contract.interval]
    months_before = (first.year - contract.starts_on.year) * 12 + (
        first.month - contract.starts_on.month
    )
    index = max(0, months_before // step - 1)
    days: list[date] = []
    while True:
        due = add_months(contract.starts_on, index * step)
        if due > upper:
            return days
        if due >= first:
            days.append(due)
        index += 1


def term_end(contract: BudgetContract, today: date) -> date | None:
    """Ende der laufenden Laufzeit; bei Verlängerung das nächste Ende ab heute."""
    if contract.ends_on is None:
        return None
    end = contract.ends_on
    if contract.renewal_months:
        while end < today:
            end = add_months(end, contract.renewal_months)
    return end


def notice_deadline(contract: BudgetContract, today: date) -> date | None:
    """Tag, bis zu dem gekündigt sein muss, damit der Vertrag zum Ende der Laufzeit endet.

    None, wenn es keinen solchen Tag gibt: schon gekündigt, unbefristet oder ohne Frist.
    """
    if contract.cancelled_to is not None or contract.notice_months is None:
        return None
    end = term_end(contract, today)
    if end is None:
        return None
    deadline = add_months(end, -contract.notice_months)
    if deadline < today and contract.renewal_months:
        # Für diese Laufzeit ist es zu spät: Es gilt der Termin der nächsten.
        deadline = add_months(add_months(end, contract.renewal_months), -contract.notice_months)
    return deadline


def is_running(contract: BudgetContract, today: date) -> bool:
    """Der Vertrag hat begonnen und ist weder ausgelaufen noch beendet."""
    end = cost_end(contract)
    return end is None or end >= today


def yearly_cents(contract: BudgetContract) -> int | None:
    """Kosten eines vollen Jahres; None bei einer einmaligen Zahlung."""
    if contract.interval == INTERVAL_ONCE:
        return None
    return contract.amount_cents * (12 // INTERVAL_MONTHS[contract.interval])


def net_from_gross(gross_cents: int, tax_rate_bp: int) -> int:
    """Netto aus Brutto, kaufmännisch gerundet."""
    divisor = 10_000 + tax_rate_bp
    return (gross_cents * 10_000 * 2 + divisor) // (2 * divisor)


def gross_cents(net_cents: int, tax_rate_bp: int) -> int:
    """Brutto aus Netto und Steuersatz (in Hundertstel Prozent), kaufmännisch gerundet."""
    return (net_cents * (10_000 + tax_rate_bp) + 5_000) // 10_000
