"""Benachrichtigungen des Bereichs IT-Monitoring."""

import hashlib
from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.notifications import Event
from werkbank.modules.monitoring.dns_check import STATUS_FAILED, new_problem_keys
from werkbank.modules.monitoring.models import MonDnsRun
from werkbank.modules.monitoring.zabbix.collector import TASK_FAST
from werkbank.modules.monitoring.zabbix.models import ZbxRun, ZbxStatus

DNS_LINK = "/monitoring/dns"
ZABBIX_LINK = "/verwaltung/zabbix"
# So viele fehlgeschlagene Abfragen in Folge, bevor die Glocke meldet
ZABBIX_FAILURES = 3
TOKEN_WARN = timedelta(days=30)


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


def zabbix_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    """Zabbix: wiederholt nicht erreichbar, Token läuft bald ab, Rolle erlaubt zu viel."""
    recent = list(
        db.scalars(
            select(ZbxRun)
            .where(ZbxRun.task == TASK_FAST)
            .order_by(ZbxRun.id.desc())
            .limit(ZABBIX_FAILURES)
        )
    )
    if len(recent) == ZABBIX_FAILURES and not any(run.ok for run in recent):
        # Ein Ereignis je Ausfall: Schlüssel ist der erste fehlgeschlagene Lauf der Reihe
        first_ok = db.scalars(
            select(ZbxRun.id)
            .where(ZbxRun.task == TASK_FAST, ZbxRun.ok.is_(True))
            .order_by(ZbxRun.id.desc())
            .limit(1)
        ).first()
        yield Event(
            kind="monitoring.zabbix_fehler",
            key=str(first_ok or 0),
            title="Zabbix lässt sich nicht abfragen",
            link=ZABBIX_LINK,
        )
    status = db.get(ZbxStatus, 1)
    account = status.account if status is not None and isinstance(status.account, dict) else {}
    expires = account.get("token_ablauf")
    if isinstance(expires, int) and expires > 0:
        expires_at = datetime.fromtimestamp(expires, now.tzinfo)
        if expires_at - now < TOKEN_WARN:
            yield Event(
                kind="monitoring.zabbix_dienstkonto",
                key=f"token-{expires}",
                title="Das Token für Zabbix läuft bald ab",
                link=ZABBIX_LINK,
            )
    findings = account.get("hinweise")
    if isinstance(findings, list) and findings and account.get("rolle"):
        yield Event(
            kind="monitoring.zabbix_dienstkonto",
            key="rolle-"
            + hashlib.sha256("|".join(str(item) for item in findings).encode()).hexdigest()[:16],
            title="Die Rolle des Dienstkontos in Zabbix passt nicht",
            link=ZABBIX_LINK,
        )
