"""Aufträge des Kerns und das Verzeichnis aller Auftragsarten."""

from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import audit_retention_days
from werkbank.core.audit import write_audit
from werkbank.core.models import AuditLog, AuthFlow, Job, JobStatus, UserSession
from werkbank.core.notifications import NOTIFY, NOTIFY_INTERVAL, Event, make_notify_job
from werkbank.core.notify_channels import DELIVER, DELIVER_INTERVAL, deliver_job
from werkbank.core.push import PUSH_DELIVER, PUSH_DELIVER_INTERVAL, push_job
from werkbank.core.sessions import now_utc
from werkbank.modules.budget.notifications import budget_notifications
from werkbank.modules.evergreen.jobs import (
    CHECK_IMPLEMENTATION,
    FETCH_MESSAGES,
    check_implementation_job,
    fetch_messages_job,
)
from werkbank.modules.evergreen.notifications import evergreen_notifications
from werkbank.modules.inventory.notifications import inventory_notifications
from werkbank.modules.inventory.sync import NINJA_SYNC, NINJA_SYNC_INTERVAL, ninja_sync_job
from werkbank.modules.m365_config.ai_texts import GENERATE_AI_TEXTS, generate_ai_texts_job
from werkbank.modules.m365_config.jobs import COLLECT, collect_job
from werkbank.modules.m365_config.notifications import m365_config_notifications
from werkbank.modules.m365_config.secure_score import FETCH_SECURE_SCORE, fetch_secure_score_job
from werkbank.modules.monitoring.dns_check import DNS_CHECK, DNS_CHECK_INTERVAL, dns_check_job
from werkbank.modules.monitoring.notifications import monitoring_notifications
from werkbank.modules.tenant.credentials import FETCH_CREDENTIALS, fetch_credentials_job
from werkbank.modules.tenant.health import FETCH_HEALTH, fetch_health_job
from werkbank.modules.tenant.inventory import FETCH_TENANT, fetch_inventory_job
from werkbank.modules.tenant.notifications import tenant_notifications
from werkbank.modules.tenant.usage import FETCH_USAGE, USAGE_INTERVAL, fetch_usage_job
from werkbank.worker.jobs import JobType

CLEANUP = "kern.aufraeumen"
JOB_RETENTION_DAYS = 30


def cleanup(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    """Löscht abgelaufene Sitzungen und Anmeldevorgänge sowie alte, erledigte Aufträge."""
    now = now_utc()
    idle_limit = now - timedelta(minutes=settings.session_idle_minutes)
    db.execute(
        delete(UserSession).where(
            or_(UserSession.expires_at < now, UserSession.last_seen_at < idle_limit)
        )
    )
    db.execute(delete(AuthFlow).where(AuthFlow.expires_at < now))
    db.execute(
        delete(Job).where(
            Job.status.in_((JobStatus.DONE, JobStatus.FAILED)),
            Job.finished_at < now - timedelta(days=JOB_RETENTION_DAYS),
        )
    )
    purge_audit_log(db)


def purge_audit_log(db: Session) -> int:
    """Löscht Audit-Einträge, die älter sind als die Aufbewahrungsfrist aus der Verwaltung.

    Das Audit-Log ist sonst nur anhängend. Der Datenbank-Trigger lässt das Löschen nur zu, wenn
    es für diese Transaktion angekündigt ist, und nie für Einträge, die jünger als 30 Tage sind.
    """
    days = audit_retention_days(db)
    limit = now_utc() - timedelta(days=days)
    too_old = AuditLog.occurred_at < limit
    removed = int(db.scalar(select(func.count()).select_from(AuditLog).where(too_old)) or 0)
    if removed:
        db.execute(select(func.set_config("werkbank.audit_purge", "on", True)))
        db.execute(delete(AuditLog).where(too_old))
        db.execute(select(func.set_config("werkbank.audit_purge", "off", True)))
        write_audit(
            db,
            module="kern",
            action="audit.bereinigt",
            object_type="audit_log",
            details={"geloescht": removed, "aufbewahrung_tage": days},
        )
    return removed


# Fehlgeschlagene Aufträge, die jünger sind, meldet die Glocke
FAILED_JOB_DAYS = 2


def core_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    """Fehlgeschlagene Hintergrundaufträge (der Abruf der Einstellungen meldet sich selbst)."""
    for job in db.scalars(
        select(Job).where(
            Job.status == JobStatus.FAILED,
            Job.type != COLLECT,
            Job.finished_at >= now - timedelta(days=FAILED_JOB_DAYS),
        )
    ):
        yield Event(
            kind="kern.auftrag_fehlgeschlagen",
            key=str(job.id),
            title=f"Hintergrundauftrag „{job.type}“ ist fehlgeschlagen",
            link="/audit",
        )


NOTIFICATION_SOURCES = (
    core_notifications,
    m365_config_notifications,
    tenant_notifications,
    evergreen_notifications,
    budget_notifications,
    monitoring_notifications,
    inventory_notifications,
)

REGISTRY: dict[str, JobType] = {
    CLEANUP: JobType(handler=cleanup, interval=timedelta(hours=1)),
    NOTIFY: JobType(handler=make_notify_job(NOTIFICATION_SOURCES), interval=NOTIFY_INTERVAL),
    DELIVER: JobType(handler=deliver_job, interval=DELIVER_INTERVAL),
    PUSH_DELIVER: JobType(handler=push_job, interval=PUSH_DELIVER_INTERVAL),
    DNS_CHECK: JobType(handler=dns_check_job, interval=DNS_CHECK_INTERVAL),
    NINJA_SYNC: JobType(handler=ninja_sync_job, interval=NINJA_SYNC_INTERVAL),
    CHECK_IMPLEMENTATION: JobType(handler=check_implementation_job, interval=timedelta(hours=1)),
    GENERATE_AI_TEXTS: JobType(handler=generate_ai_texts_job, interval=timedelta(hours=1)),
}


def build_registry(settings: Settings) -> dict[str, JobType]:
    """Auftragsarten dieser Installation: Kern und, wenn eingerichtet, der Abruf aus dem Tenant."""
    registry = dict(REGISTRY)
    if settings.collector_configured:
        registry[COLLECT] = JobType(
            handler=collect_job, interval=timedelta(hours=max(settings.collector_interval_hours, 1))
        )
        registry[FETCH_MESSAGES] = JobType(
            handler=fetch_messages_job,
            interval=timedelta(hours=max(settings.message_center_interval_hours, 1)),
        )
        if settings.secure_score_enabled:
            registry[FETCH_SECURE_SCORE] = JobType(
                handler=fetch_secure_score_job,
                interval=timedelta(hours=max(settings.secure_score_interval_hours, 1)),
            )
        if settings.tenant_monitor_enabled:
            registry[FETCH_TENANT] = JobType(
                handler=fetch_inventory_job,
                interval=timedelta(hours=max(settings.tenant_monitor_interval_hours, 1)),
            )
        if settings.tenant_credentials_enabled:
            registry[FETCH_CREDENTIALS] = JobType(
                handler=fetch_credentials_job,
                interval=timedelta(hours=max(settings.tenant_monitor_interval_hours, 1)),
            )
        if settings.tenant_health_enabled:
            registry[FETCH_HEALTH] = JobType(
                handler=fetch_health_job,
                interval=timedelta(minutes=max(settings.tenant_health_interval_minutes, 5)),
            )
        if settings.tenant_usage_enabled:
            registry[FETCH_USAGE] = JobType(handler=fetch_usage_job, interval=USAGE_INTERVAL)
    return registry
