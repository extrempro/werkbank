"""Benachrichtigungen des Bereichs M365-Tenant: Störungen, Zugangsdaten, Lizenzen."""

from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import warn_days
from werkbank.core.notifications import Event
from werkbank.modules.tenant.credentials import (
    KIND_CERTIFICATE,
    LEVEL_EXPIRED,
    LEVEL_URGENT,
    LEVEL_WARN,
    days_left,
    level_for,
)
from werkbank.modules.tenant.health import SERVICES
from werkbank.modules.tenant.models import TenantCredential, TenantLicense, TenantServiceIssue
from werkbank.modules.tenant.names import license_name

HEALTH_LINK = "/m365/dienststatus"
CREDENTIALS_LINK = "/m365/zugangsdaten"
LIFECYCLE_DAYS = 30
NOTIFY_LEVELS = {
    LEVEL_WARN: "läuft bald ab",
    LEVEL_URGENT: "läuft in Kürze ab",
    LEVEL_EXPIRED: "ist abgelaufen",
}


def tenant_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    """Störungen (Beginn und Ende), ablaufende Zugangsdaten, volle Lizenzen und Stichtage."""
    for issue in db.scalars(
        select(TenantServiceIssue).where(TenantServiceIssue.classification == "incident")
    ):
        service = SERVICES.get(issue.service_id, issue.service_name)
        link = f"{HEALTH_LINK}#{issue.issue_id}"
        yield Event(
            kind="tenant.stoerung",
            key=f"{issue.issue_id}:begonnen",
            title=f"Störung bei {service}: {issue.title}",
            link=link,
        )
        if issue.resolved:
            yield Event(
                kind="tenant.stoerung",
                key=f"{issue.issue_id}:behoben",
                title=f"Störung bei {service} behoben: {issue.title}",
                link=link,
            )

    levels = warn_days(db)
    for credential in db.scalars(
        select(TenantCredential).where(
            TenantCredential.active.is_(True), TenantCredential.expires_at.is_not(None)
        )
    ):
        level = level_for(days_left(credential.expires_at, now), levels)
        if level not in NOTIFY_LEVELS:
            continue
        what = "Zertifikat" if credential.kind == KIND_CERTIFICATE else "Geheimnis"
        yield Event(
            kind="tenant.zugangsdaten",
            key=f"{credential.id}:{level}",
            title=f"{what} von {credential.owner_name} {NOTIFY_LEVELS[level]}",
            link=CREDENTIALS_LINK,
        )

    for lic in db.scalars(select(TenantLicense).where(TenantLicense.active.is_(True))):
        name = license_name(lic.part_number)
        link = f"/m365/lizenzen/{lic.id}"
        if lic.total > 0 and lic.consumed > lic.total:
            yield Event(
                kind="tenant.lizenzen",
                key=f"{lic.id}:ueberbucht:{lic.total}",
                title=f"{name}: mehr Lizenzen vergeben als vorhanden",
                link=link,
            )
        elif lic.total > 0 and lic.consumed == lic.total:
            yield Event(
                kind="tenant.lizenzen",
                key=f"{lic.id}:voll:{lic.total}",
                title=f"{name}: alle Lizenzen sind vergeben",
                link=link,
            )
        if lic.next_lifecycle and now <= lic.next_lifecycle <= now + timedelta(days=LIFECYCLE_DAYS):
            yield Event(
                kind="tenant.lizenzen",
                key=f"{lic.id}:stichtag:{lic.next_lifecycle.date().isoformat()}",
                title=f"{name}: Stichtag am {lic.next_lifecycle:%d.%m.%Y}",
                link=link,
            )
