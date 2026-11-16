"""Benachrichtigungen des Bereichs IT-Monitoring."""

from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.notifications import Event
from werkbank.modules.monitoring.dns_check import STATUS_FAILED, new_problem_keys
from werkbank.modules.monitoring.models import MonDnsRun

DNS_LINK = "/monitoring/dns"


def monitoring_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    """Neue Abweichungen im letzten Abgleich und ein fehlgeschlagener letzter Lauf."""
    last = db.scalars(select(MonDnsRun).order_by(MonDnsRun.id.desc()).limit(1)).first()
    if last is not None and last.status == STATUS_FAILED:
        yield Event(
            kind="monitoring.dns_fehlgeschlagen",
            key=str(last.id),
            title="DNS-Abgleich mit NetBox ist fehlgeschlagen",
            link=DNS_LINK,
        )
    run, new = new_problem_keys(db)
    if run is not None and new:
        count = len(new)
        yield Event(
            kind="monitoring.dns_abweichung",
            key=str(run.id),
            title=(
                "DNS-Abgleich: eine neue Abweichung zu NetBox"
                if count == 1
                else f"DNS-Abgleich: {count} neue Abweichungen zu NetBox"
            ),
            link=f"{DNS_LINK}?ansicht=neu",
        )
