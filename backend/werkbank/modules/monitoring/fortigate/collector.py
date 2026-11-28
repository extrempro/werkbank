"""Abruf der FortiGates: ein Auftrag alle fünf Minuten fragt die fälligen Geräte ab.

Jedes Gerät einzeln, in eigener Transaktion. Ein nicht erreichbares Gerät hält die anderen nicht
auf; der Fehler steht im Abruf, die Seiten zeigen den letzten Stand mit Zeit. Die Konfiguration
wird nur gespeichert, wenn sie sich geändert hat. Danach werden Abrufe und Stände gelöscht, die
älter sind als die eingestellte Aufbewahrung (der jüngste Stand je Gerät bleibt immer).
"""

import logging
import time
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select, tuple_
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.sessions import now_utc
from werkbank.modules.monitoring.fortigate.client import (
    FortiGateClient,
    FortiGateError,
    Transport,
)
from werkbank.modules.monitoring.fortigate.config import (
    device_config,
    load_settings,
    months_ago,
)
from werkbank.modules.monitoring.fortigate.models import FgDevice, FgRun, FgSnapshot, FgUnused
from werkbank.modules.monitoring.fortigate.normalize import Fetched, digest, fetch
from werkbank.modules.monitoring.fortigate.unused import unused

logger = logging.getLogger(__name__)

FORTIGATE_JOB = "monitoring.fortigate"
FORTIGATE_JOB_INTERVAL = timedelta(minutes=5)
SLACK = timedelta(seconds=30)
ERROR_MAX = 500


def last_run(db: Session, device_id: int) -> FgRun | None:
    return db.scalars(
        select(FgRun).where(FgRun.device_id == device_id).order_by(FgRun.id.desc()).limit(1)
    ).first()


def latest_snapshot(db: Session, device_id: int) -> FgSnapshot | None:
    return db.scalars(
        select(FgSnapshot)
        .where(FgSnapshot.device_id == device_id)
        .order_by(FgSnapshot.taken_at.desc(), FgSnapshot.id.desc())
        .limit(1)
    ).first()


def due_devices(db: Session, now: datetime, interval: timedelta, force: bool) -> list[FgDevice]:
    devices = db.scalars(
        select(FgDevice).where(FgDevice.enabled.is_(True)).order_by(FgDevice.position, FgDevice.id)
    ).all()
    if force:
        return list(devices)
    due: list[FgDevice] = []
    for device in devices:
        run = last_run(db, device.id)
        if run is None or now - run.started_at >= interval - SLACK:
            due.append(device)
    return due


def store(
    db: Session, device: FgDevice, fetched: Fetched, now: datetime
) -> tuple[FgSnapshot, bool]:
    """Neuer Stand nur bei Änderung; sonst wird der letzte als gesehen markiert."""
    value = digest(fetched.config)
    previous = latest_snapshot(db, device.id)
    device.runtime = fetched.runtime
    device.runtime_at = now
    if previous is not None and previous.digest == value:
        previous.seen_at = now
        return previous, False
    snapshot = FgSnapshot(
        device_id=device.id, taken_at=now, seen_at=now, digest=value, data=fetched.config
    )
    db.add(snapshot)
    db.flush()
    return snapshot, True


def track_unused(db: Session, device_id: int, config: dict[str, Any], now: datetime) -> None:
    """Merkt sich, seit wann Objekte unbenutzt sind (weite Prüfung: deaktivierte Policies und
    unbenutzte Gruppen zählen nicht als Verwendung). Nicht mehr unbenutzte fallen heraus."""
    current = {(item.kind, item.name) for item in unused(config)}
    known = {
        (row.kind, row.name): row
        for row in db.scalars(select(FgUnused).where(FgUnused.device_id == device_id))
    }
    for key, row in known.items():
        if key not in current:
            db.delete(row)
    for kind, name in current - set(known):
        db.add(FgUnused(device_id=device_id, kind=kind, name=name[:255], since=now))


def collect_device(
    db: Session,
    settings: Settings,
    device: FgDevice,
    ca_pem: str | None,
    transport: Transport | None,
) -> FgRun:
    now = now_utc()
    started = time.monotonic()
    run = FgRun(device_id=device.id, started_at=now, ok=True)
    config = device_config(device, settings, ca_pem)
    try:
        if config is None:
            raise FortiGateError(
                "Das API-Token lässt sich nicht entschlüsseln. "
                "Bitte in der Verwaltung neu eintragen."
            )
        fetched = fetch(FortiGateClient(config, transport))
        snapshot, changed = store(db, device, fetched, now)
        track_unused(db, device.id, fetched.config, now)
        run.snapshot_id = snapshot.id
        run.changed = changed
    except FortiGateError as error:
        db.rollback()
        run = FgRun(device_id=device.id, started_at=now, ok=False, error=str(error)[:ERROR_MAX])
    except Exception:
        # Ein Gerät darf den Worker nie anhalten
        logger.exception("FortiGate: Abruf von Gerät %s fehlgeschlagen", device.id)
        db.rollback()
        run = FgRun(
            device_id=device.id,
            started_at=now,
            ok=False,
            error="Unerwarteter Fehler beim Verarbeiten der Antwort des Geräts.",
        )
    run.duration_ms = int((time.monotonic() - started) * 1000)
    db.add(run)
    db.commit()
    return run


def _expired(db: Session, cutoff: datetime) -> tuple[Any, Any]:
    """Bedingungen für zu alte Abrufe und Stände. Der jüngste Stand je Gerät bleibt."""
    latest = select(FgSnapshot.device_id, func.max(FgSnapshot.taken_at)).group_by(
        FgSnapshot.device_id
    )
    newest = select(FgSnapshot.id).where(
        tuple_(FgSnapshot.device_id, FgSnapshot.taken_at).in_(latest)
    )
    old_snapshots = (FgSnapshot.seen_at < cutoff) & FgSnapshot.id.not_in(newest)
    old_runs = FgRun.started_at < cutoff
    return old_runs, old_snapshots


def retention_preview(db: Session, months: int, now: datetime | None = None) -> dict[str, int]:
    """Wie viele Abrufe und Stände bei dieser Aufbewahrung wegfallen würden."""
    cutoff = months_ago(now or now_utc(), months)
    old_runs, old_snapshots = _expired(db, cutoff)
    runs = int(db.scalar(select(func.count()).select_from(FgRun).where(old_runs)) or 0)
    snapshots = int(
        db.scalar(select(func.count()).select_from(FgSnapshot).where(old_snapshots)) or 0
    )
    return {"runs": runs, "snapshots": snapshots}


def purge(db: Session, months: int, now: datetime | None = None) -> dict[str, int]:
    """Löscht Abrufe und Stände außerhalb der Aufbewahrung."""
    cutoff = months_ago(now or now_utc(), months)
    old_runs, old_snapshots = _expired(db, cutoff)
    runs = getattr(db.execute(delete(FgRun).where(old_runs)), "rowcount", 0) or 0
    snapshots = getattr(db.execute(delete(FgSnapshot).where(old_snapshots)), "rowcount", 0) or 0
    return {"runs": int(runs), "snapshots": int(snapshots)}


def collect(
    db: Session,
    settings: Settings,
    *,
    force: bool = False,
    transport: Transport | None = None,
) -> list[FgRun]:
    options = load_settings(db)
    now = now_utc()
    runs = [
        collect_device(db, settings, device, options.ca_pem, transport)
        for device in due_devices(db, now, timedelta(minutes=options.interval_minutes), force)
    ]
    removed = purge(db, options.retention_months)
    db.commit()
    if removed["runs"] or removed["snapshots"]:
        logger.info(
            "FortiGate: %s Abrufe und %s Stände gelöscht", removed["runs"], removed["snapshots"]
        )
    return runs


def fortigate_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    collect(db, settings, force=bool(payload and payload.get("force")))
