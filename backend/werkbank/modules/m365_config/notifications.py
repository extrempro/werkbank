"""Benachrichtigungen des Bereichs M365-Konfiguration."""

from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.notifications import Event
from werkbank.modules.m365_config.api import CURRENT_VERSION, DEVIATION
from werkbank.modules.m365_config.models import (
    CfgChange,
    CfgSetting,
    CfgSettingMeta,
    CfgSettingVersion,
    CfgSnapshot,
    ChangeStatus,
    Criticality,
    SnapshotStatus,
)

# Änderungen, die älter sind, meldet die Glocke nicht mehr
RECENT_DAYS = 7


def _name(setting: CfgSetting) -> str:
    return f"{setting.object_name or setting.object_id}: {setting.property}"


def m365_config_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    """Kritische Änderungen, neue Abweichungen vom Soll-Wert, fehlgeschlagene Abrufe."""
    for change, setting in db.execute(
        select(CfgChange, CfgSetting)
        .join(CfgSetting, CfgSetting.id == CfgChange.setting_id)
        .join(CfgSettingMeta, CfgSettingMeta.setting_id == CfgSetting.id)
        .where(
            CfgSettingMeta.criticality == Criticality.HIGH,
            CfgChange.status == ChangeStatus.OPEN,
            CfgChange.detected_at >= now - timedelta(days=RECENT_DAYS),
        )
    ):
        yield Event(
            kind="config.aenderung_kritisch",
            key=str(change.id),
            title=f"Kritische Einstellung geändert: {_name(setting)}",
            link=f"/m365/einstellungen/{setting.id}",
        )

    for setting, version_id in db.execute(
        select(CfgSetting, CfgSettingVersion.id)
        .join(CfgSettingVersion, CURRENT_VERSION)
        .join(CfgSettingMeta, CfgSettingMeta.setting_id == CfgSetting.id)
        .where(DEVIATION)
    ):
        yield Event(
            kind="config.abweichung",
            key=f"{setting.id}:{version_id}",
            title=f"Abweichung vom Soll-Wert: {_name(setting)}",
            link=f"/m365/einstellungen/{setting.id}",
        )

    if settings.collector_configured:
        last = db.scalars(select(CfgSnapshot).order_by(CfgSnapshot.id.desc()).limit(1)).first()
        if last is not None and last.status == SnapshotStatus.FAILED:
            yield Event(
                kind="config.abruf_fehlgeschlagen",
                key=str(last.id),
                title="Abruf der Einstellungen aus dem Tenant ist fehlgeschlagen",
                link="/audit",
            )
