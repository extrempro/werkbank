"""Benachrichtigungen der Gerätezuordnung: an die Person, die gescannt oder freigegeben hat."""

from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.notifications import Event
from werkbank.modules.devices.models import DeviceAssociation

LINK = "/m365/geraete/zuordnung"
RECENT_DAYS = 2


def devices_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    since = now - timedelta(days=RECENT_DAYS)
    rows = db.scalars(
        select(DeviceAssociation).where(
            or_(DeviceAssociation.associated_at >= since, DeviceAssociation.enrolled_at >= since)
        )
    ).all()
    for row in rows:
        people = frozenset(p for p in (row.scanned_by, row.approved_by) if p is not None)
        if not people:
            continue
        if row.associated_at is not None and row.associated_at >= since:
            yield Event(
                kind="geraete.zugeordnet",
                key=str(row.id),
                title=f"Gerät zugeordnet: {row.model} ({row.serial_number})",
                link=LINK,
                user_ids=people,
            )
        if row.enrolled_at is not None and row.enrolled_at >= since:
            yield Event(
                kind="geraete.registriert",
                key=str(row.id),
                title=f"Gerät in Intune registriert: {row.model} ({row.serial_number})",
                link=LINK,
                user_ids=people,
            )
