"""Meine Aufgaben (spec.md 6.2): Module melden, was für die angemeldete Person zu tun ist.

Die Aufgaben werden bei jeder Abfrage aus dem aktuellen Stand der Module ermittelt und nicht
gespeichert. Eine Tabelle für einzeln zugewiesene Aufgaben kommt mit der Workflow-Engine.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from fastapi import APIRouter, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.deps import CurrentUserDep, DbDep, SettingsDep
from werkbank.core.sessions import CurrentUser


@dataclass(frozen=True)
class TaskItem:
    """Eine Aufgabe für die Startseite. count: wie viele Dinge dahinter stehen."""

    module: str
    title: str
    link: str
    subtitle: str | None = None
    count: int = 1


TaskProvider = Callable[[Session, CurrentUser, Settings], list[TaskItem]]

router = APIRouter(prefix="/api")


class TaskOut(BaseModel):
    module: str
    title: str
    subtitle: str | None
    link: str
    count: int


class TasksOut(BaseModel):
    tasks: list[TaskOut]
    total: int


@router.get("/tasks")
def list_tasks(
    request: Request, user: CurrentUserDep, db: DbDep, settings: SettingsDep
) -> TasksOut:
    """Aufgaben der angemeldeten Person aus allen Modulen."""
    providers: Sequence[TaskProvider] = getattr(request.app.state, "task_providers", ())
    items = [item for provider in providers for item in provider(db, user, settings)]
    return TasksOut(
        tasks=[
            TaskOut(
                module=item.module,
                title=item.title,
                subtitle=item.subtitle,
                link=item.link,
                count=item.count,
            )
            for item in items
        ],
        total=sum(item.count for item in items),
    )
