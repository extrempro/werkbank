"""Aufgaben des Moduls IT-Budget für die Startseite."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.core.tasks import TaskItem
from werkbank.modules.budget.contracts import NOTICE_WARN_DAYS, is_running, notice_deadline
from werkbank.modules.budget.models import BudgetContract, BudgetImport, BudgetInvoice

MODULE_LABEL = "IT-Budget"
CONTRACTS_LINK = "/budget/vertraege"
INVOICES_LINK = "/budget/rechnungen"
IMPORT_LINK = "/budget/import"


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
    tasks = []
    if user.has_any_role(Role.BUDGET_MANAGER):
        waiting = db.scalar(
            select(func.count()).select_from(BudgetInvoice).where(BudgetInvoice.status != "gebucht")
        )
        imports = db.scalar(
            select(func.count()).select_from(BudgetImport).where(BudgetImport.status == "offen")
        )
        if imports:
            tasks.append(
                TaskItem(
                    module=MODULE_LABEL,
                    title="Import aus Excel abarbeiten",
                    subtitle="Offene Zeilen übernehmen oder überspringen",
                    link=IMPORT_LINK,
                    count=imports,
                )
            )
        if waiting:
            tasks.append(
                TaskItem(
                    module=MODULE_LABEL,
                    title="Rechnungen prüfen und buchen",
                    subtitle="Erst gebuchte Rechnungen zählen zum Ist",
                    link=INVOICES_LINK,
                    count=waiting,
                )
            )
    if not soon:
        return tasks
    return [
        *tasks,
        TaskItem(
            module=MODULE_LABEL,
            title="Kündigungstermin von Verträgen steht an",
            subtitle=f"Termin in höchstens {NOTICE_WARN_DAYS} Tagen: verlängern oder kündigen",
            link=CONTRACTS_LINK,
            count=soon,
        ),
    ]
