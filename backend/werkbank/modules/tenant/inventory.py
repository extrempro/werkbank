"""Abruf von Lizenzen und Benutzerzahlen aus Microsoft Graph.

Gespeichert werden nur Summen: je Lizenz gekauft und zugewiesen, für den Tenant die Zahl der
Konten. Namen von Personen werden nicht gelesen. Je Tag gibt es einen Eintrag für den Verlauf.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.audit import write_audit
from werkbank.core.sessions import now_utc
from werkbank.modules.m365_config.utcm import UtcmClient, UtcmError, graph_token_provider
from werkbank.modules.tenant.models import TenantLicense, TenantLicenseSample, TenantUserSample

FETCH_TENANT = "tenant.inventar"
MODULE = "tenant"
HTTP_TIMEOUT_SECONDS = 60.0
# Der Verlauf wird drei Jahre aufbewahrt.
RETENTION_DAYS = 3 * 365
# Abos in diesen Zuständen laufen noch und haben einen Stichtag, der zählt.
LIVE_SUBSCRIPTION_STATES = frozenset({"enabled", "warning"})


@dataclass(frozen=True)
class InventoryResult:
    licenses: int = 0
    new: int = 0
    removed: int = 0
    users: int = 0


def _count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return 0
    return value


def _text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.split())
    return cleaned[:limit] or None


def _moment(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def subscription_dates(
    subscriptions: list[dict[str, Any]],
) -> dict[str, tuple[datetime | None, bool]]:
    """Je Lizenz der früheste Stichtag der laufenden Abos und ob nur Testabos laufen."""
    result: dict[str, tuple[datetime | None, bool]] = {}
    for entry in subscriptions:
        sku_id = entry.get("skuId")
        status = entry.get("status")
        if not isinstance(sku_id, str) or not isinstance(status, str):
            continue
        if status.lower() not in LIVE_SUBSCRIPTION_STATES:
            continue
        moment = _moment(entry.get("nextLifecycleDateTime"))
        trial = entry.get("isTrial") is True
        key = sku_id.lower()
        if key not in result:
            result[key] = (moment, trial)
            continue
        earliest, all_trial = result[key]
        if moment is not None and (earliest is None or moment < earliest):
            earliest = moment
        result[key] = (earliest, all_trial and trial)
    return result


def _store_licenses(
    db: Session,
    skus: list[dict[str, Any]],
    subscriptions: list[dict[str, Any]],
    now: datetime,
    day: date,
) -> tuple[int, int, int]:
    dates = subscription_dates(subscriptions)
    existing = {row.sku_id: row for row in db.scalars(select(TenantLicense)).all()}
    seen: set[str] = set()
    new = 0
    for sku in skus:
        sku_id = sku.get("skuId")
        part_number = _text(sku.get("skuPartNumber"), 128)
        if not isinstance(sku_id, str) or not sku_id or len(sku_id) > 64 or part_number is None:
            continue
        key = sku_id.lower()
        if key in seen:
            continue
        seen.add(key)
        row = existing.get(key)
        if row is None:
            row = TenantLicense(sku_id=key, part_number=part_number)
            db.add(row)
            new += 1
        prepaid = sku.get("prepaidUnits")
        units: dict[str, Any] = prepaid if isinstance(prepaid, dict) else {}
        row.part_number = part_number
        row.applies_to = _text(sku.get("appliesTo"), 32)
        row.capability_status = _text(sku.get("capabilityStatus"), 32)
        row.total = _count(units.get("enabled"))
        row.warning = _count(units.get("warning"))
        row.suspended = _count(units.get("suspended"))
        row.locked_out = _count(units.get("lockedOut"))
        row.consumed = _count(sku.get("consumedUnits"))
        row.next_lifecycle, row.trial = dates.get(key, (None, False))
        row.active = True
        row.fetched_at = now
        db.flush()
        sample = db.get(TenantLicenseSample, (row.id, day))
        if sample is None:
            sample = TenantLicenseSample(license_id=row.id, day=day, total=0, consumed=0)
            db.add(sample)
        sample.total = row.total
        sample.consumed = row.consumed
    removed = 0
    for key, row in existing.items():
        if key not in seen and row.active:
            row.active = False
            removed += 1
    return len(seen), new, removed


def _store_users(db: Session, client: UtcmClient, now: datetime, day: date) -> int:
    total = client.user_count(None)
    guests = client.user_count("userType eq 'Guest'")
    disabled = client.user_count("accountEnabled eq false")
    guests_disabled = client.user_count("userType eq 'Guest' and accountEnabled eq false")
    try:
        licensed: int | None = client.user_count("assignedLicenses/$count ne 0")
    except UtcmError:
        # Diese Zahl ist eine Zugabe; fehlt sie, bleiben die übrigen Zahlen gültig.
        licensed = None
    sample = db.get(TenantUserSample, day)
    if sample is None:
        sample = TenantUserSample(day=day, total=0, guests=0, disabled=0, guests_disabled=0)
        db.add(sample)
    sample.total = total
    sample.guests = min(guests, total)
    sample.disabled = min(disabled, total)
    sample.guests_disabled = min(guests_disabled, sample.guests, sample.disabled)
    sample.licensed = licensed
    sample.fetched_at = now
    return total


def purge_old_samples(db: Session, today: date) -> None:
    """Löscht Verlaufseinträge, die älter als die Aufbewahrungsfrist sind."""
    limit = today - timedelta(days=RETENTION_DAYS)
    db.execute(delete(TenantLicenseSample).where(TenantLicenseSample.day < limit))
    db.execute(delete(TenantUserSample).where(TenantUserSample.day < limit))


def fetch_inventory(db: Session, client: UtcmClient) -> InventoryResult:
    """Liest Lizenzen und Benutzerzahlen und schreibt den Stand des Tages fort."""
    skus = client.subscribed_skus()
    subscriptions = client.directory_subscriptions()
    now = now_utc()
    day = now.date()
    licenses, new, removed = _store_licenses(db, skus, subscriptions, now, day)
    users = _store_users(db, client, now, day)
    purge_old_samples(db, day)
    write_audit(
        db,
        module=MODULE,
        action="inventar.abruf",
        object_type="tenant",
        details={"lizenzen": licenses, "neu": new, "entfallen": removed},
    )
    db.commit()
    return InventoryResult(licenses=licenses, new=new, removed=removed, users=users)


def fetch_inventory_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    """Regelmäßiger Abruf. Ohne die Berechtigungen bei Microsoft schlägt der Auftrag fehl."""
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False) as http:
        fetch_inventory(db, UtcmClient(http, graph_token_provider(settings)))
