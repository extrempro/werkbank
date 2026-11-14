"""Aufgaben des Moduls M365-Konfiguration für die Startseite."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser
from werkbank.core.tasks import TaskItem
from werkbank.modules.m365_config.api import CURRENT_VERSION, DEVIATION
from werkbank.modules.m365_config.models import (
    CfgChange,
    CfgSetting,
    CfgSettingMeta,
    CfgSettingVersion,
    CfgSnapshot,
    ChangeStatus,
    SnapshotStatus,
)

MODULE_LABEL = "M365-Konfiguration"


def m365_config_tasks(db: Session, user: CurrentUser, settings: Settings) -> list[TaskItem]:
    """Offene Änderungen und Abweichungen für Reviewer, fehlgeschlagener Abruf für Admins."""
    tasks: list[TaskItem] = []
    can_read = user.has_any_role(Role.CONFIG_READER, Role.CONFIG_REVIEWER)

    if user.has_any_role(Role.CONFIG_REVIEWER):
        open_changes = (
            db.scalar(
                select(func.count())
                .select_from(CfgChange)
                .where(CfgChange.status == ChangeStatus.OPEN)
            )
            or 0
        )
        if open_changes:
            tasks.append(
                TaskItem(
                    module=MODULE_LABEL,
                    title="Änderungen bewerten",
                    subtitle="Erkannte Änderungen als gewollt oder ungewollt einordnen",
                    link="/m365/aenderungen",
                    count=open_changes,
                )
            )
        deviations = (
            db.scalar(
                select(func.count())
                .select_from(CfgSetting)
                .join(CfgSettingVersion, CURRENT_VERSION)
                .join(CfgSettingMeta, CfgSettingMeta.setting_id == CfgSetting.id)
                .where(DEVIATION)
            )
            or 0
        )
        if deviations:
            tasks.append(
                TaskItem(
                    module=MODULE_LABEL,
                    title="Abweichungen vom Soll-Wert prüfen",
                    subtitle="Der gelesene Wert entspricht nicht dem festgelegten Soll-Wert",
                    link="/m365/einstellungen",
                    count=deviations,
                )
            )

    if user.has_any_role(Role.WERKBANK_ADMIN) and settings.collector_configured:
        last_status = db.scalar(select(CfgSnapshot.status).order_by(CfgSnapshot.id.desc()).limit(1))
        if last_status == SnapshotStatus.FAILED:
            tasks.append(
                TaskItem(
                    module=MODULE_LABEL,
                    title="Abruf aus dem Tenant ist fehlgeschlagen",
                    subtitle="Der letzte Abruf der Einstellungen hat nicht funktioniert",
                    link="/m365/snapshots" if can_read else "/audit",
                )
            )
    return tasks
