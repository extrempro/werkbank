"""Einstellungen des IT-Budgets: Beginn und Bezeichnung des Geschäftsjahrs, Kostenstelle."""

from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from werkbank.core.app_settings import get_setting

SETTINGS_KEY = "budget.settings"
YEAR_LABEL_DEFAULT = "Geschäftsjahr"
YEAR_MIN = 2000
YEAR_MAX = 2100


@dataclass(frozen=True)
class BudgetSettings:
    # Monat, mit dessen erstem Tag das Geschäftsjahr beginnt (1 bis 12)
    start_month: int = 1
    # So heißt das Geschäftsjahr in der Oberfläche
    year_label: str = YEAR_LABEL_DEFAULT
    cost_center: str = ""


def load_settings(db: Session) -> BudgetSettings:
    """Die gespeicherten Einstellungen; Fehlendes oder Unbrauchbares fällt auf den Standard."""
    stored: Any = get_setting(db, SETTINGS_KEY)
    data = stored if isinstance(stored, dict) else {}
    month = data.get("start_month")
    if isinstance(month, bool) or not isinstance(month, int) or not 1 <= month <= 12:
        month = 1
    label = data.get("year_label")
    center = data.get("cost_center")
    return BudgetSettings(
        start_month=month,
        year_label=label if isinstance(label, str) and label.strip() else YEAR_LABEL_DEFAULT,
        cost_center=center if isinstance(center, str) else "",
    )


def fiscal_year_of(day: date, start_month: int) -> int:
    """Geschäftsjahr eines Tages, benannt nach dem Kalenderjahr, in dem es beginnt."""
    return day.year if day.month >= start_month else day.year - 1


def fiscal_year_range(year: int, start_month: int) -> tuple[date, date]:
    """Erster und letzter Tag des Geschäftsjahrs."""
    first = date(year, start_month, 1)
    following = date(year + 1, start_month, 1)
    return first, date.fromordinal(following.toordinal() - 1)


def fiscal_year_name(year: int, start_month: int) -> str:
    """„2026“ bei Beginn im Januar, sonst „2026/27“."""
    if start_month == 1:
        return str(year)
    return f"{year}/{(year + 1) % 100:02d}"
