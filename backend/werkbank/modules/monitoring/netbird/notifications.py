"""Benachrichtigungen für NetBird: wiederholt fehlgeschlagener Abruf (an Admins)."""

from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.notifications import Event
from werkbank.modules.monitoring.netbird.models import NbRun

ADMIN_LINK = "/verwaltung/netbird"
FAILURES = 3


def netbird_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    recent = list(db.scalars(select(NbRun).order_by(NbRun.id.desc()).limit(FAILURES)))
    if len(recent) == FAILURES and not any(run.ok for run in recent):
        last_ok = db.scalars(
            select(NbRun.id).where(NbRun.ok.is_(True)).order_by(NbRun.id.desc()).limit(1)
        ).first()
        yield Event(
            kind="monitoring.netbird_fehler",
            key=str(last_ok or 0),
            title="NetBird lässt sich nicht abrufen",
            link=ADMIN_LINK,
        )
