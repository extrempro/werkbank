"""Aufgaben des Moduls IT-Budget für die Startseite."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.core.tasks import TaskItem
from werkbank.modules.budget.contracts import NOTICE_WARN_DAYS, is_running, notice_deadline
from werkbank.modules.budget.models import BudgetContract

MODULE_LABEL = "IT-Budget"
CONTRACTS_LINK = "/budget/vertraege"


def budget_tasks(db: Session, user: CurrentUser, settings: Settings) -> list[TaskItem]:
    """Verträge, deren Kündigungstermin bald ansteht, für die, die Verträge pflegen."""
    if not user.has_any_role(Role.BUDGET_EDITOR, Role.BUDGET_MANAGER):
        return []
    today = now_utc().date()
    soon = 0
    for contract in db.scalars(select(BudgetContract)).all():
        deadline = notice_deadline(contract, today)
        if (
            deadline is not None
            and is_running(contract, today)
            and 0 <= (deadline - today).days <= NOTICE_WARN_DAYS
        ):
            soon += 1
    if not soon:
        return []
    return [
        TaskItem(
            module=MODULE_LABEL,
            title="Kündigungstermin von Verträgen steht an",
            subtitle=f"Termin in höchstens {NOTICE_WARN_DAYS} Tagen: verlängern oder kündigen",
            link=CONTRACTS_LINK,
            count=soon,
        )
    ]
