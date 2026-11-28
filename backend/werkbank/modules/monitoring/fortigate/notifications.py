"""Benachrichtigungen für FortiGate: ein Gerät lässt sich wiederholt nicht abrufen (an Admins),
neue Befunde der Stufe hoch oder mittel (an alle mit dem Recht „FortiGate lesen“)."""

from collections.abc import Iterable
from datetime import datetime
from urllib.parse import quote

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.notifications import Event
from werkbank.modules.monitoring.fortigate.models import FgDevice, FgFinding, FgRun

ADMIN_LINK = "/verwaltung/fortigate"
FINDINGS_LINK = "/monitoring/fortigate/befunde"
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
    # Neue Befunde: ein Ereignis je Gerät und jüngstem Befund (hoch oder mittel)
    newest = db.execute(
        select(FgFinding.device, func.max(FgFinding.first_seen))
        .where(FgFinding.severity.in_(("hoch", "mittel")))
        .group_by(FgFinding.device)
    ).all()
    for device_name, first_seen in newest:
        label = f"FortiGate „{device_name}“" if device_name else "FortiGate (alle Geräte)"
        link = (
            f"{FINDINGS_LINK}?geraet={quote(device_name, safe='')}"
            if device_name
            else FINDINGS_LINK
        )
        yield Event(
            kind="monitoring.fortigate_befund",
            key=f"{device_name}-{int(first_seen.timestamp())}",
            title=f"{label}: neuer Befund",
            link=link,
        )
