"""Aufgabe der Gerätezuordnung für die Startseite."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser
from werkbank.core.tasks import TaskItem
from werkbank.modules.devices.models import AssociationStatus, DeviceAssociation


def devices_tasks(db: Session, user: CurrentUser, settings: Settings) -> list[TaskItem]:
    if not user.has_any_role(Role.DEVICES_ASSOCIATION):
        return []
    waiting = db.scalar(
        select(func.count())
        .select_from(DeviceAssociation)
        .where(DeviceAssociation.status == AssociationStatus.PENDING)
    )
    if not waiting:
        return []
    return [
        TaskItem(
            module="Microsoft 365",
            title="Geräte warten auf Freigabe",
            subtitle="Mit dem Admin-Konto freigeben oder verwerfen",
            link="/m365/geraete/zuordnung?ansicht=freigabe",
            count=int(waiting),
        )
    ]
