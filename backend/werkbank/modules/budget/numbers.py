"""Feste Nummern der Budgetposten: BP-<Jahr>-<laufende Nummer>, z. B. BP-2026-012."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.modules.budget.models import BudgetItem

# Sperre für die Vergabe, damit zwei gleichzeitige Anlagen nicht dieselbe Nummer ziehen
_LOCK_KEY = 0x42500001


def item_number(year: int, seq: int) -> str:
    """Anzeige der Nummer: Jahr und laufende Nummer, mindestens dreistellig."""
    return f"BP-{year}-{seq:03d}"


def assign_item_number(db: Session, item: BudgetItem) -> None:
    """Vergibt die nächste freie Nummer im ersten Geschäftsjahr des Postens.

    Vor `db.add` aufrufen oder ohne Autoflush: Der Posten hat bis dahin keine Nummer.
    """
    db.execute(select(func.pg_advisory_xact_lock(_LOCK_KEY)))
    with db.no_autoflush:
        last = db.scalar(
            select(func.max(BudgetItem.number_seq)).where(BudgetItem.number_year == item.start_year)
        )
    item.number_year = item.start_year
    item.number_seq = (last or 0) + 1
