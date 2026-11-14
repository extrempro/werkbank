"""Abruf der Einstellungen aus dem Tenant über UTCM (spec.md 7.1).

Ablauf: Snapshot bei UTCM anstoßen, auf das Ergebnis warten, herunterladen, in einzelne
Einstellungen zerlegen und mit dem Bestand vergleichen (versioning.py). Der Verlauf liegt
danach in der Werkbank; UTCM selbst bewahrt Snapshots nur wenige Tage auf.
"""

import logging
import time
from collections.abc import Callable, Mapping
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.audit import write_audit
from werkbank.core.sessions import now_utc
from werkbank.modules.m365_config.models import CfgChange, CfgSetting, CfgSnapshot, SnapshotStatus
from werkbank.modules.m365_config.normalize import (
    DEFAULT_IGNORED_FIELDS,
    SettingValue,
    normalize_object,
)
from werkbank.modules.m365_config.utcm import UtcmClient, UtcmError
from werkbank.modules.m365_config.versioning import SnapshotResult, apply_snapshot

logger = logging.getLogger(__name__)

MODULE = "m365_config"
SOURCE_PREFIX = "utcm:"
# Namen der Snapshot-Aufträge der Werkbank in UTCM (nur diese räumt sie auch wieder weg)
JOB_NAME_PREFIX = "Werkbank "
# UTCM liest höchstens so viele Objekte pro Tenant und Monat
MONTHLY_RESOURCE_LIMIT = 20_000
QUOTA_WARNING_SHARE = 0.8
# Kennung des Objekts und interne Felder von UTCM sind keine Einstellungen
UTCM_IGNORED_FIELDS = DEFAULT_IGNORED_FIELDS | {"Id", "Ensure", "IsSingleInstance"}
MAX_AUDIT_LOOKBACK = timedelta(days=30)
ERROR_LENGTH = 500

FINAL_STATES = frozenset({"succeeded", "partiallySuccessful", "failed"})
USABLE_STATES = frozenset({"succeeded", "partiallySuccessful"})


class CollectorError(RuntimeError):
    """Der Abruf konnte nicht abgeschlossen werden."""


def source_name(resource_type: str) -> str:
    return f"{SOURCE_PREFIX}{resource_type.lower()}"


def resources_used_this_month(db: Session, now: datetime) -> int:
    """Summe der in diesem Kalendermonat (UTC) gelesenen Objekte."""
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    used = db.scalar(
        select(func.coalesce(func.sum(CfgSnapshot.resource_count), 0)).where(
            CfgSnapshot.started_at >= month_start
        )
    )
    return int(used or 0)


def source_status(requested: list[str], job: Mapping[str, Any]) -> dict[str, bool]:
    """Welche Ressourcentypen vollständig gelesen wurden.

    Bei einem nur teilweise erfolgreichen Snapshot gilt ein Typ als unvollständig, wenn er in
    den Fehlerangaben vorkommt. Ohne Fehlerangaben gilt vorsichtshalber keiner als vollständig,
    damit nichts fälschlich als entfernt erkannt wird.
    """
    status = job.get("status")
    if status == "succeeded":
        return {source_name(name): True for name in requested}
    details = [str(item).lower() for item in job.get("errorDetails") or []]
    if status != "partiallySuccessful" or not details:
        return {source_name(name): False for name in requested}
    return {
        source_name(name): not any(name.lower() in detail for detail in details)
        for name in requested
    }


def parse_snapshot(document: Mapping[str, Any]) -> tuple[list[SettingValue], int]:
    """Zerlegt einen UTCM-Snapshot in Einstellungen. Liefert sie und die Zahl der Objekte."""
    items: list[SettingValue] = []
    count = 0
    for resource in document.get("resources") or []:
        if not isinstance(resource, Mapping):
            continue
        resource_type = str(resource.get("resourceType") or "").lower()
        properties = resource.get("properties")
        parts = resource_type.split(".")
        if len(parts) < 3 or not isinstance(properties, Mapping):
            continue
        count += 1
        display_name = resource.get("displayName")
        object_id = properties.get("Id") or display_name or properties.get("DisplayName")
        if not object_id:
            # ohne Kennung nicht eindeutig adressierbar (z. B. Einzelobjekt): Typ als Kennung
            object_id = parts[-1]
        object_name = properties.get("DisplayName") or display_name
        try:
            items.extend(
                normalize_object(
                    workload=parts[1],
                    area=".".join(parts[2:]),
                    object_id=str(object_id),
                    object_name=str(object_name)[:512] if object_name else None,
                    properties=properties,
                    source=source_name(resource_type),
                    ignored=UTCM_IGNORED_FIELDS,
                )
            )
        except ValueError:
            logger.warning("Objekt vom Typ %s übersprungen: Pfad zu lang", resource_type)
    return items, count


def _initiator(audit: Mapping[str, Any]) -> str | None:
    """Wer eine Änderung laut Entra-Audit-Log ausgelöst hat (Konto oder Anwendung)."""
    initiated_by = audit.get("initiatedBy")
    if not isinstance(initiated_by, Mapping):
        return None
    user = initiated_by.get("user")
    if isinstance(user, Mapping):
        name = user.get("userPrincipalName") or user.get("displayName")
        if name:
            return str(name)
    app = initiated_by.get("app")
    if isinstance(app, Mapping) and app.get("displayName"):
        return f"Anwendung: {app['displayName']}"
    return None


def attribute_changes(db: Session, client: UtcmClient, snapshot_id: int, since: datetime) -> int:
    """Trägt „Geändert von“ nach, wenn das Entra-Audit-Log einen passenden Eintrag hat."""
    rows = db.execute(
        select(CfgChange, CfgSetting.object_id)
        .join(CfgSetting, CfgSetting.id == CfgChange.setting_id)
        .where(CfgChange.snapshot_id == snapshot_id)
    ).all()
    if not rows:
        return 0
    audits = client.directory_audits(since)
    audits.sort(key=lambda audit: str(audit.get("activityDateTime") or ""))
    latest: dict[str, tuple[str, str]] = {}
    for audit in audits:
        who = _initiator(audit)
        if not who:
            continue
        for target in audit.get("targetResources") or []:
            target_id = target.get("id") if isinstance(target, Mapping) else None
            if target_id:
                latest[str(target_id).lower()] = (who, str(audit.get("id") or ""))
    found = 0
    for change, object_id in rows:
        hit = latest.get(object_id.lower())
        if hit:
            change.changed_by = hit[0][:320]
            change.audit_ref = hit[1][:256] or None
            found += 1
    return found


def _remove_own_jobs(client: UtcmClient) -> None:
    """Räumt alte Snapshot-Aufträge der Werkbank in UTCM weg (dort sind nur wenige erlaubt)."""
    for job in client.list_jobs():
        name = job.get("displayName")
        job_id = job.get("id")
        finished = job.get("status") in FINAL_STATES
        if isinstance(name, str) and name.startswith(JOB_NAME_PREFIX) and finished and job_id:
            client.delete_job(str(job_id))


def _record_failure(db: Session, resources: list[str], started_at: datetime) -> None:
    apply_snapshot(db, [], {source_name(name): False for name in resources}, started_at=started_at)
    db.commit()


def collect(
    db: Session,
    settings: Settings,
    client: UtcmClient,
    *,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> SnapshotResult:
    """Holt einen Snapshot und übernimmt ihn. Wirft CollectorError, wenn das nicht gelingt."""
    started_at = now_utc()
    resources = settings.collector_resource_list()
    if not resources:
        raise CollectorError("Keine Ressourcentypen für den Abruf eingetragen")
    used = resources_used_this_month(db, started_at)
    if used >= MONTHLY_RESOURCE_LIMIT:
        raise CollectorError("Monatskontingent von UTCM ist ausgeschöpft, kein Abruf")
    previous = db.scalar(
        select(func.max(CfgSnapshot.started_at)).where(
            CfgSnapshot.status.in_((SnapshotStatus.OK, SnapshotStatus.PARTIAL))
        )
    )

    try:
        _remove_own_jobs(client)
    except UtcmError:
        logger.warning("Alte Snapshot-Aufträge konnten nicht entfernt werden", exc_info=True)

    job_id = ""
    try:
        job_id = client.create_snapshot(f"{JOB_NAME_PREFIX}{started_at:%Y%m%d %H%M%S}", resources)
        deadline = clock() + settings.collector_timeout_minutes * 60
        while True:
            job = client.get_job(job_id)
            if job.get("status") in FINAL_STATES:
                break
            if clock() >= deadline:
                raise CollectorError("UTCM hat den Snapshot nicht rechtzeitig fertiggestellt")
            sleep(settings.collector_poll_seconds)
        location = job.get("resourceLocation")
        if job.get("status") not in USABLE_STATES or not isinstance(location, str) or not location:
            details = "; ".join(str(item) for item in job.get("errorDetails") or [])
            raise CollectorError(
                f"Snapshot fehlgeschlagen: {details or 'ohne Angabe'}"[:ERROR_LENGTH]
            )
        document = client.download(location)
    except (UtcmError, CollectorError) as exc:
        db.rollback()
        _record_failure(db, resources, started_at)
        if isinstance(exc, CollectorError):
            raise
        raise CollectorError(str(exc)[:ERROR_LENGTH]) from exc

    items, resource_count = parse_snapshot(document)
    result = apply_snapshot(
        db,
        items,
        source_status(resources, job),
        started_at=started_at,
        resource_count=resource_count,
    )

    attributed = 0
    if result.changes:
        since = max(previous or started_at - timedelta(days=1), started_at - MAX_AUDIT_LOOKBACK)
        try:
            attributed = attribute_changes(db, client, result.snapshot_id, since)
        except UtcmError:
            logger.warning("„Geändert von“ konnte nicht ermittelt werden", exc_info=True)

    total = used + resource_count
    if total >= MONTHLY_RESOURCE_LIMIT * QUOTA_WARNING_SHARE:
        logger.warning(
            "UTCM-Monatskontingent zu %d %% verbraucht", round(100 * total / MONTHLY_RESOURCE_LIMIT)
        )
    write_audit(
        db,
        module=MODULE,
        action="abruf.abgeschlossen",
        object_type="snapshot",
        object_id=str(result.snapshot_id),
        result="ok" if result.status == SnapshotStatus.OK else str(result.status),
        details={
            "objekte": resource_count,
            "objekte_im_monat": total,
            "ausgangsstand": result.baseline,
            "neu": result.new,
            "geaendert": result.changed,
            "entfernt": result.removed,
            "geaendert_von_ermittelt": attributed,
        },
    )
    db.commit()

    try:
        client.delete_job(job_id)
    except UtcmError:
        logger.warning("Snapshot-Auftrag konnte nicht entfernt werden", exc_info=True)
    return result
