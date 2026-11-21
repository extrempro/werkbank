"""Erwartete Kosten, Status und Prognose eines Budgetpostens je Geschäftsjahr."""

from dataclasses import dataclass

from werkbank.modules.budget.models import BudgetItem

ITEM_OPEN = "offen"
ITEM_INVOICED = "rechnung"
ITEM_CLOSED = "abgeschlossen"


def runs_in(item: BudgetItem, year: int) -> bool:
    """Ob der Posten in diesem Geschäftsjahr läuft (Laufzeit ohne Ende: bis auf Weiteres)."""
    return item.start_year <= year and (item.end_year is None or year <= item.end_year)


def expected_in(item: BudgetItem, year: int) -> int | None:
    """Erwartete Kosten im Geschäftsjahr; None, wenn der Posten in dem Jahr nicht läuft."""
    return item.amount_cents if runs_in(item, year) else None


@dataclass
class YearLines:
    """Was die Rechnungspositionen eines Postens in einem Geschäftsjahr ergeben."""

    # Summe der gebuchten Positionen (brutto)
    actual_cents: int = 0
    # Ob es überhaupt eine Position gibt, gebucht oder nicht
    invoiced: bool = False
    # Ob der Posten abgeschlossen ist (durch eine Position oder von Hand)
    closed: bool = False
    # Wodurch: eine gebuchte Position mit „schließt ab“ bzw. „Abschließen“ am Posten
    closed_by_invoice: bool = False
    closed_by_hand: bool = False


def item_status(item: BudgetItem, year: int, lines: YearLines | None) -> str | None:
    """offen, rechnung (Rechnung liegt vor) oder abgeschlossen; None ohne Laufzeit und Rechnung."""
    if lines is not None and lines.closed:
        return ITEM_CLOSED
    if lines is not None and lines.invoiced:
        return ITEM_INVOICED
    return ITEM_OPEN if runs_in(item, year) else None


def forecast(expected: int | None, actual: int, closed: bool) -> int:
    """Prognose: abgeschlossen das Ist, sonst das Höhere aus erwarteten Kosten und Ist."""
    if closed:
        return actual
    return max(expected or 0, actual)
