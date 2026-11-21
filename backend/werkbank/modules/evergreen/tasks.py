"""Aufgaben des Bereichs Evergreen für die Startseite (nur Bearbeiter)."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.sessions import CurrentUser
from werkbank.core.tasks import TaskItem
from werkbank.modules.evergreen.models import SOFTWARE, EntryStatus, EvEntry
from werkbank.modules.evergreen.service import EDITOR_ROLES


def evergreen_tasks(db: Session, user: CurrentUser, settings: Settings) -> list[TaskItem]:
    """Je Software: wie viele neue Einträge noch gesichtet werden müssen."""
    if not user.has_any_role(*EDITOR_ROLES):
        return []
    rows = db.execute(
        select(EvEntry.software, func.count())
        .where(EvEntry.status == EntryStatus.NEW)
        .group_by(EvEntry.software)
    ).all()
    return [
        TaskItem(
            module="Evergreen",
            title=f"{SOFTWARE.get(software, software)}: neue Einträge sichten",
            subtitle="Notiz anfügen oder abschließen",
            link=f"/evergreen/{software}",
            count=int(count),
        )
        for software, count in sorted(rows)
        if count
    ]
