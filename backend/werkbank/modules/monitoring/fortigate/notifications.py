"""Benachrichtigungen für FortiGate: ein Gerät lässt sich wiederholt nicht abrufen (an Admins)."""

from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.notifications import Event
from werkbank.modules.monitoring.fortigate.models import FgDevice, FgRun

ADMIN_LINK = "/verwaltung/fortigate"
# So viele fehlgeschlagene Abrufe in Folge, bevor die Glocke meldet
FAILURES = 3


def fortigate_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    for device in db.scalars(select(FgDevice).where(FgDevice.enabled.is_(True))):
        recent = list(
            db.scalars(
                select(FgRun)
                .where(FgRun.device_id == device.id)
                .order_by(FgRun.id.desc())
                .limit(FAILURES)
            )
        )
        if len(recent) < FAILURES or any(run.ok for run in recent):
            continue
        # Ein Ereignis je Ausfall: Schlüssel ist der letzte gelungene Abruf davor
        last_ok = db.scalars(
            select(FgRun.id)
            .where(FgRun.device_id == device.id, FgRun.ok.is_(True))
            .order_by(FgRun.id.desc())
            .limit(1)
        ).first()
        yield Event(
            kind="monitoring.fortigate_fehler",
            key=f"{device.id}-{last_ok or 0}",
            title=f"FortiGate „{device.name}“ lässt sich nicht abrufen",
            link=ADMIN_LINK,
        )
