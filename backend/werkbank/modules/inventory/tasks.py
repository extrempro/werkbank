"""Aufgaben des Moduls IT-Bestand für die Startseite."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser
from werkbank.core.tasks import TaskItem
from werkbank.modules.inventory.models import InventoryCase
from werkbank.modules.inventory.sync import OPEN_STATES

MODULE_LABEL = "IT-Bestand"
CASES_LINK = "/bestand/vorgaenge"


def inventory_tasks(db: Session, user: CurrentUser, settings: Settings) -> list[TaskItem]:
    """Offene Vorgänge für die, die den Bestand pflegen."""
    if not user.has_any_role(Role.INVENTORY_EDITOR):
        return []
    open_cases = db.scalar(
        select(func.count()).select_from(InventoryCase).where(InventoryCase.status.in_(OPEN_STATES))
    )
    if not open_cases:
        return []
    return [
        TaskItem(
            module=MODULE_LABEL,
            title="Offene Vorgänge bearbeiten",
            subtitle="Neue und angefangene Vorgänge im IT-Bestand",
            link=CASES_LINK,
            count=open_cases,
        )
    ]
