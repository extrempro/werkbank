"""Aufgaben des Moduls Evergreen für die Startseite."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser
from werkbank.core.tasks import TaskItem
from werkbank.modules.evergreen.models import EvMessage, MessageStatus
from werkbank.modules.evergreen.service import ALL_ROLES, count_waiting, own_steps
from werkbank.modules.evergreen.workflow import evergreen_workflow


def evergreen_tasks(db: Session, user: CurrentUser, settings: Settings) -> list[TaskItem]:
    """Je Schritt, für den die Person zuständig ist: wie viele Vorgänge dort warten."""
    if not user.has_any_role(*ALL_ROLES):
        return []
    flow = evergreen_workflow()
    tasks: list[TaskItem] = []
    for step in own_steps(user):
        waiting = count_waiting(db, user, step)
        if waiting:
            tasks.append(
                TaskItem(
                    module="Evergreen",
                    title=f"{flow.title_of(step)}: Vorgänge bearbeiten",
                    subtitle="Vorgänge, die in diesem Schritt auf eine Entscheidung warten",
                    link="/evergreen",
                    count=waiting,
                )
            )
    if user.has_any_role(Role.EVERGREEN_IT):
        new_messages = db.scalar(
            select(func.count()).select_from(EvMessage).where(EvMessage.status == MessageStatus.NEW)
        )
        if new_messages:
            tasks.append(
                TaskItem(
                    module="Evergreen",
                    title="Eingang: neue Meldungen von Microsoft sichten",
                    subtitle="Als Vorgang übernehmen oder beiseitelegen",
                    link="/evergreen/eingang",
                    count=int(new_messages),
                )
            )
    return tasks
