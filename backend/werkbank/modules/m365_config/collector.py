"""Abruf der Einstellungen aus dem Tenant über UTCM (spec.md 7.1).

Ablauf: Die Typen werden nach Workload gruppiert (entra, exchange, teams, …). Je Gruppe stößt
die Werkbank nacheinander einen Snapshot bei UTCM an, wartet auf das Ergebnis und lädt es
herunter. Alle Ergebnisse werden in einzelne Einstellungen zerlegt und zusammen mit dem Bestand
verglichen (versioning.py, ein Snapshot der Werkbank). Scheitert eine Gruppe, gelten nur ihre
Typen als nicht gelesen; ihr Bestand bleibt unverändert. Der Verlauf liegt danach in der
Werkbank; UTCM selbst bewahrt Snapshots nur wenige Tage auf.
"""

import hashlib
import logging
import re
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
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
from werkbank.modules.m365_config.utcm import JOB_TEXT_MAX, UtcmClient, UtcmError
from werkbank.modules.m365_config.versioning import SnapshotResult, apply_snapshot

logger = logging.getLogger(__name__)

MODULE = "m365_config"
SOURCE_PREFIX = "utcm:"
# SharePoint liest die Werkbank selbst über Microsoft Graph, nicht über UTCM
SHAREPOINT_SOURCE = "graph:sharepoint"
SHAREPOINT_WORKLOAD = "sharepoint"
SHAREPOINT_AREA = "tenantsettings"
SHAREPOINT_OBJECT = "tenant"
SHAREPOINT_NAME = "SharePoint und OneDrive"
# Snapshot-Aufträge der Werkbank in UTCM (nur diese räumt sie auch wieder weg), je höchstens
# JOB_TEXT_MAX Zeichen, nur Buchstaben, Ziffern und Leerzeichen:
# Name „Werkbank <JJMMTT> <HHMMSS> <4 Zeichen der Kennung>“, Beschreibung „Werkbank <workload>
# <Kennung der Typengruppe>“. Ältere Namen (bis 0.144) gelten als eigene, werden aber nur
# aufgeräumt.
JOB_NAME_PREFIX = "Werkbank "
_JOB_NAME = re.compile(r"^Werkbank \d{6} \d{6} [0-9a-f]{4}$")
# UTCM zeigt höchstens so viele Aufträge je Tenant; darüber lässt sich keiner mehr anlegen
MAX_VISIBLE_JOBS = 12
# Ein fertiger, nicht abgeholter Auftrag wird so lange im nächsten Lauf übernommen
REUSE_JOB_MAX_AGE = timedelta(hours=24)
WORKLOAD_LABELS = {
    "entra": "Entra",
    "exchange": "Exchange",
    "teams": "Teams",
    "intune": "Intune",
    "securityandcompliance": "Security & Compliance",
    "sharepoint": "SharePoint",
    "onedrive": "OneDrive",
    "powerplatform": "Power Platform",
    "defender": "Defender",
}
# Schritte im Fehlertext
STEP_CREATE = "Auftrag anlegen"
STEP_STATUS = "Status"
STEP_TIMEOUT = "Zeitüberschreitung"
STEP_DOWNLOAD = "Download"
STEP_FAILED = "UTCM meldet Fehler"
# UTCM liest höchstens so viele Objekte pro Tenant und Monat
MONTHLY_RESOURCE_LIMIT = 20_000
QUOTA_WARNING_SHARE = 0.8
# Kennung des Objekts und interne Felder von UTCM sind keine Einstellungen
UTCM_IGNORED_FIELDS = DEFAULT_IGNORED_FIELDS | {
    "Id",
    "Ensure",
    "IsSingleInstance",
    # Angaben zur Anmeldung des Abrufs, keine Einstellungen des Tenants
    "Credential",
    "ApplicationId",
    "TenantId",
    "CertificateThumbprint",
    "CertificatePath",
    "CertificatePassword",
    "ApplicationSecret",
    "ManagedIdentity",
    "AccessTokens",
}
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


def source_errors(requested: list[str], job: Mapping[str, Any]) -> dict[str, str]:
    """Fehlertext je Ressourcentyp: die Fehlerangaben der Quelle, in denen der Typ vorkommt."""
    details = [str(item) for item in job.get("errorDetails") or []]
    errors: dict[str, str] = {}
    for name in requested:
        own = [detail for detail in details if name.lower() in detail.lower()]
        if own:
            errors[source_name(name)] = "; ".join(own)[:ERROR_LENGTH]
    return errors


def _first_text(*candidates: Any) -> str | None:
    """Erster Kandidat, der ein nicht leerer Text ist."""
    for candidate in candidates:
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def parse_snapshot(document: Mapping[str, Any]) -> tuple[list[SettingValue], int]:
    """Zerlegt einen UTCM-Snapshot in Einstellungen. Liefert sie und die Zahl der Objekte."""
    items: list[SettingValue] = []
    count = 0
    seen: dict[tuple[str, str], int] = {}
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
        # Entra-Objekte tragen eine Id, Exchange-Objekte ihre Kennung in „Identity“.
        object_id = _first_text(
            properties.get("Id"),
            properties.get("Identity"),
            display_name,
            properties.get("DisplayName"),
            properties.get("Name"),
        )
        if not object_id:
            # ohne Kennung nicht eindeutig adressierbar (z. B. Einzelobjekt): Typ als Kennung
            object_id = parts[-1]
        # Zwei Objekte desselben Typs dürfen sich nie denselben Pfad teilen.
        key = (resource_type, object_id.lower())
        seen[key] = seen.get(key, 0) + 1
        if seen[key] > 1:
            logger.warning("Typ %s: Kennung mehrfach vorhanden, Objekt nummeriert", resource_type)
            object_id = f"{object_id} #{seen[key]}"
        object_name = _first_text(
            properties.get("DisplayName"),
            display_name,
            properties.get("Name"),
            properties.get("Identity"),
        )
        try:
            items.extend(
                normalize_object(
                    workload=parts[1],
                    area=".".join(parts[2:]),
                    object_id=object_id,
                    object_name=object_name[:512] if object_name else None,
                    properties=properties,
                    source=source_name(resource_type),
                    ignored=UTCM_IGNORED_FIELDS,
                )
            )
        except ValueError:
            logger.warning("Objekt vom Typ %s übersprungen: Pfad zu lang", resource_type)
    return items, count


def parse_sharepoint(document: Mapping[str, Any]) -> list[SettingValue]:
    """Mandanteneinstellungen von SharePoint und OneDrive als ein Objekt mit Eigenschaften."""
    properties = {
        key: value
        for key, value in document.items()
        if isinstance(key, str) and not key.startswith("@") and key != "id"
    }
    return normalize_object(
        workload=SHAREPOINT_WORKLOAD,
        area=SHAREPOINT_AREA,
        object_id=SHAREPOINT_OBJECT,
        object_name=SHAREPOINT_NAME,
        properties=properties,
        source=SHAREPOINT_SOURCE,
    )


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


def workload_of(resource_type: str) -> str:
    """Workload eines Typs: „microsoft.exchange.accepteddomain“ → „exchange“."""
    parts = resource_type.lower().split(".")
    return parts[1] if len(parts) >= 3 and parts[0] == "microsoft" else "sonstige"


def workload_label(workload: str) -> str:
    return WORKLOAD_LABELS.get(workload, workload.capitalize())


def group_resources(resources: list[str]) -> dict[str, list[str]]:
    """Typen nach Workload, in der Reihenfolge des ersten Vorkommens."""
    groups: dict[str, list[str]] = {}
    for name in resources:
        groups.setdefault(workload_of(name), []).append(name)
    return groups


def group_key(workload: str, resources: list[str]) -> str:
    """Kennung einer Typengruppe im Namen des Auftrags (ändert sich mit der Typenliste)."""
    digest = hashlib.sha256(",".join(sorted(resources)).encode()).hexdigest()[:8]
    return f"{workload} {digest}"


def job_name(key: str, started_at: datetime) -> str:
    """Name des Auftrags, z. B. „Werkbank 261126 075220 3f9a“ (27 Zeichen)."""
    digest = key.split(" ")[-1][:4]
    return f"{JOB_NAME_PREFIX}{started_at:%y%m%d %H%M%S} {digest}"


def job_description(key: str) -> str:
    """Beschreibung mit der Typengruppe, z. B. „Werkbank entra 3f9a2c1b“.

    Lange Workload-Namen werden gekürzt, damit die Grenze von UTCM eingehalten wird.
    """
    workload, digest = key.split(" ", 1)
    room = JOB_TEXT_MAX - len(JOB_NAME_PREFIX) - len(digest) - 1
    return f"{JOB_NAME_PREFIX}{workload[:room]} {digest}"


def _job_key(job: Mapping[str, Any], keys: set[str]) -> str | None:
    """Typengruppe eines eigenen Auftrags aus seiner Beschreibung.

    Nur Aufträge mit dem aktuellen Namensformat kommen in Frage; ältere Formate (ohne Gruppe in
    der Beschreibung) liefern None und werden damit nur aufgeräumt, nie übernommen.
    """
    name = job.get("displayName")
    if not isinstance(name, str) or not _JOB_NAME.match(name):
        return None
    description = job.get("description")
    wanted = {job_description(key): key for key in keys}
    return wanted.get(description) if isinstance(description, str) else None


def _created(job: Mapping[str, Any]) -> datetime | None:
    value = job.get("createdDateTime")
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


@dataclass
class JobPlan:
    """Fertige, noch nicht abgeholte Aufträge je Typengruppe und die Zahl sichtbarer Aufträge."""

    reusable: dict[str, dict[str, Any]] = field(default_factory=dict)
    visible: int = 0


def plan_jobs(client: UtcmClient, keys: set[str], now: datetime) -> JobPlan:
    """Räumt alte eigene Aufträge in UTCM weg (dort sind nur wenige erlaubt).

    Ein fertiger, nicht abgeholter Auftrag derselben Typengruppe, jünger als 24 Stunden, bleibt
    stehen und wird in diesem Lauf übernommen. Laufende und fremde Aufträge bleiben unberührt.
    """
    plan = JobPlan()
    for job in client.list_jobs():
        name = job.get("displayName")
        job_id = job.get("id")
        status = job.get("status")
        own = isinstance(name, str) and name.startswith(JOB_NAME_PREFIX) and bool(job_id)
        if not own or status not in FINAL_STATES:
            plan.visible += 1
            continue
        key = _job_key(job, keys)
        created = _created(job)
        location = job.get("resourceLocation")
        if (
            key is not None
            and key not in plan.reusable
            and status in USABLE_STATES
            and isinstance(location, str)
            and location
            and created is not None
            and now - created <= REUSE_JOB_MAX_AGE
        ):
            plan.reusable[key] = job
            plan.visible += 1
            continue
        try:
            client.delete_job(str(job_id))
        except UtcmError:
            logger.warning("Alter Snapshot-Auftrag konnte nicht entfernt werden", exc_info=True)
            plan.visible += 1
    return plan


class GroupError(RuntimeError):
    """Eine Typengruppe konnte nicht gelesen werden; der Text nennt Workload und Schritt."""


@dataclass
class GroupResult:
    document: dict[str, Any]
    job: dict[str, Any]
    job_id: str


def _text(label: str, step: str, detail: object) -> str:
    """Fehlertext einer Gruppe, z. B. „Exchange · Download: Microsoft Graph antwortet mit 502“."""
    return f"{label} · {step}: {detail}"[:ERROR_LENGTH]


def _fail(label: str, step: str, detail: object) -> GroupError:
    return GroupError(_text(label, step, detail))


def _run_group(
    client: UtcmClient,
    settings: Settings,
    key: str,
    resources: list[str],
    started_at: datetime,
    plan: JobPlan,
    *,
    sleep: Callable[[float], None],
    clock: Callable[[], float],
) -> GroupResult:
    """Ein Snapshot-Auftrag für eine Typengruppe: anlegen (oder übernehmen), warten, laden."""
    label = workload_label(key.split(" ")[0])
    job = plan.reusable.get(key)
    if job is not None:
        job_id = str(job["id"])
        logger.info("%s: fertiger Snapshot-Auftrag aus einem früheren Lauf wird übernommen", label)
    else:
        if plan.visible >= MAX_VISIBLE_JOBS:
            raise _fail(
                label,
                STEP_CREATE,
                f"In UTCM stehen schon {plan.visible} Aufträge (höchstens {MAX_VISIBLE_JOBS})",
            )
        try:
            job_id = client.create_snapshot(
                job_name(key, started_at), job_description(key), resources
            )
        except UtcmError as exc:
            raise _fail(label, STEP_CREATE, exc) from exc
        plan.visible += 1
        deadline = clock() + settings.collector_timeout_minutes * 60
        while True:
            try:
                job = client.get_job(job_id)
            except UtcmError as exc:
                raise _fail(label, STEP_STATUS, exc) from exc
            if job.get("status") in FINAL_STATES:
                break
            if clock() >= deadline:
                raise _fail(
                    label, STEP_TIMEOUT, "UTCM hat den Snapshot nicht rechtzeitig fertiggestellt"
                )
            sleep(settings.collector_poll_seconds)
    location = job.get("resourceLocation")
    if job.get("status") not in USABLE_STATES or not isinstance(location, str) or not location:
        details = "; ".join(str(item) for item in job.get("errorDetails") or [])
        # Ein gescheiterter Auftrag nützt nichts mehr: gleich wegräumen
        try:
            client.delete_job(job_id)
            plan.visible -= 1
        except UtcmError:
            logger.warning("Snapshot-Auftrag konnte nicht entfernt werden", exc_info=True)
        raise _fail(label, STEP_FAILED, details or "ohne Angabe")
    try:
        document = client.download(location)
    except UtcmError as exc:
        # Der fertige Auftrag bleibt stehen; der nächste Lauf holt ihn ab
        raise _fail(label, STEP_DOWNLOAD, exc) from exc
    return GroupResult(document=document, job=job, job_id=job_id)


def collect(
    db: Session,
    settings: Settings,
    client: UtcmClient,
    *,
    sleep: Callable[[float], None] = time.sleep,
    clock: Callable[[], float] = time.monotonic,
) -> SnapshotResult:
    """Holt die Einstellungen und übernimmt sie in einen Snapshot.

    Je Workload ein UTCM-Auftrag; scheitert einer, gelten nur seine Typen als nicht gelesen.
    Wirft CollectorError, wenn gar nichts gelesen werden konnte (der Snapshot steht dann mit
    Fehlertext je Quelle als fehlgeschlagen in der Werkbank).
    """
    started_at = now_utc()
    resources = settings.collector_resource_list()
    if not resources:
        raise CollectorError("Keine Ressourcentypen für den Abruf eingetragen")
    used = resources_used_this_month(db, started_at)
    previous = db.scalar(
        select(func.max(CfgSnapshot.started_at)).where(
            CfgSnapshot.status.in_((SnapshotStatus.OK, SnapshotStatus.PARTIAL))
        )
    )
    groups = {
        group_key(workload, names): names for workload, names in group_resources(resources).items()
    }

    items: list[SettingValue] = []
    status: dict[str, bool] = {}
    errors: dict[str, str] = {}
    resource_count = 0
    finished_jobs: list[str] = []

    def fail_group(names: list[str], text: str) -> None:
        for name in names:
            status[source_name(name)] = False
            errors[source_name(name)] = text

    if used >= MONTHLY_RESOURCE_LIMIT:
        for key, names in groups.items():
            fail_group(
                names,
                _text(
                    workload_label(key.split(" ")[0]),
                    STEP_CREATE,
                    "Monatskontingent von UTCM ist ausgeschöpft, kein Abruf",
                ),
            )
    else:
        try:
            plan = plan_jobs(client, set(groups), started_at)
        except UtcmError as exc:
            logger.warning("Snapshot-Aufträge in UTCM konnten nicht gelesen werden: %s", exc)
            plan = JobPlan()
        for key, names in groups.items():
            if used + resource_count >= MONTHLY_RESOURCE_LIMIT:
                fail_group(
                    names,
                    _text(
                        workload_label(key.split(" ")[0]),
                        STEP_CREATE,
                        "Monatskontingent von UTCM ist ausgeschöpft, kein Abruf",
                    ),
                )
                continue
            try:
                group = _run_group(
                    client, settings, key, names, started_at, plan, sleep=sleep, clock=clock
                )
            except GroupError as exc:
                logger.warning("Abruf aus UTCM: %s", exc)
                fail_group(names, str(exc))
                continue
            group_items, count = parse_snapshot(group.document)
            items.extend(group_items)
            resource_count += count
            status.update(source_status(names, group.job))
            errors.update(source_errors(names, group.job))
            finished_jobs.append(group.job_id)

    if settings.collector_sharepoint_enabled:
        # Unabhängig von UTCM und ohne Kontingent. Schlägt es fehl, bleibt der Bestand stehen.
        try:
            items.extend(parse_sharepoint(client.sharepoint_settings()))
            status[SHAREPOINT_SOURCE] = True
        except UtcmError as exc:
            logger.warning("SharePoint-Einstellungen konnten nicht gelesen werden: %s", exc)
            status[SHAREPOINT_SOURCE] = False
            errors[SHAREPOINT_SOURCE] = f"SharePoint · Lesen: {exc}"[:ERROR_LENGTH]

    result = apply_snapshot(
        db,
        items,
        status,
        errors,
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
    failed_groups = sum(
        1 for names in groups.values() if not all(status.get(source_name(n)) for n in names)
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
            "gruppen": len(groups),
            "gruppen_mit_fehler": failed_groups,
            "ausgangsstand": result.baseline,
            "neu": result.new,
            "geaendert": result.changed,
            "entfernt": result.removed,
            "geaendert_von_ermittelt": attributed,
        },
    )
    db.commit()

    for job_id in finished_jobs:
        try:
            client.delete_job(job_id)
        except UtcmError:
            logger.warning("Snapshot-Auftrag konnte nicht entfernt werden", exc_info=True)

    if result.status == SnapshotStatus.FAILED:
        texts = list(dict.fromkeys(errors.values()))
        raise CollectorError("; ".join(texts)[:ERROR_LENGTH] or "Abruf fehlgeschlagen")
    return result
