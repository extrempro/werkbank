"""Aufträge des Kerns und das Verzeichnis aller Auftragsarten."""

from datetime import timedelta
from typing import Any

from sqlalchemy import delete, or_
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.models import AuthFlow, Job, JobStatus, UserSession
from werkbank.core.sessions import now_utc
from werkbank.modules.evergreen.jobs import (
    CHECK_IMPLEMENTATION,
    FETCH_MESSAGES,
    check_implementation_job,
    fetch_messages_job,
)
from werkbank.modules.m365_config.jobs import COLLECT, collect_job
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


REGISTRY: dict[str, JobType] = {
    CLEANUP: JobType(handler=cleanup, interval=timedelta(hours=1)),
    CHECK_IMPLEMENTATION: JobType(handler=check_implementation_job, interval=timedelta(hours=1)),
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
    return registry
