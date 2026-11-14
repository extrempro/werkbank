"""Auftragsliste in PostgreSQL (spec.md, Kapitel 5).

Ausgelegt für genau einen Worker. Aufträge werden trotzdem mit einer Zeilensperre geholt,
damit ein versehentlich doppelt gestarteter Worker keinen Auftrag zweimal ausführt.
"""

import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.audit import write_audit
from werkbank.core.models import Job, JobStatus
from werkbank.core.sessions import now_utc

logger = logging.getLogger(__name__)

ERROR_MAX_LENGTH = 2000

Handler = Callable[[Session, Settings, dict[str, Any]], None]


@dataclass(frozen=True)
class JobType:
    """Art eines Auftrags: was auszuführen ist und ob er sich regelmäßig wiederholt."""

    handler: Handler
    interval: timedelta | None = None


Registry = Mapping[str, JobType]


def enqueue(
    db: Session,
    job_type: str,
    *,
    payload: dict[str, Any] | None = None,
    scheduled_at: datetime | None = None,
) -> Job:
    """Trägt einen Auftrag ein. Der Aufrufer entscheidet über das Commit."""
    job = Job(
        type=job_type,
        status=JobStatus.PLANNED,
        payload=payload,
        scheduled_at=scheduled_at or now_utc(),
    )
    db.add(job)
    return job


def recover_interrupted(db: Session) -> None:
    """Beim Start: Aufträge, die ein früherer Worker nicht beendet hat, als Fehler abschließen."""
    db.execute(
        update(Job)
        .where(Job.status == JobStatus.RUNNING)
        .values(
            status=JobStatus.FAILED,
            finished_at=now_utc(),
            error="Abgebrochen: Der Worker wurde neu gestartet.",
        )
    )
    db.commit()


def ensure_scheduled(db: Session, registry: Registry) -> None:
    """Sorgt dafür, dass für jeden regelmäßigen Auftrag genau ein nächster Lauf geplant ist."""
    now = now_utc()
    for name, job_type in registry.items():
        if job_type.interval is None:
            continue
        pending = db.scalar(
            select(Job.id)
            .where(Job.type == name, Job.status.in_((JobStatus.PLANNED, JobStatus.RUNNING)))
            .limit(1)
        )
        if pending is not None:
            continue
        last: datetime | None = db.scalar(select(func.max(Job.finished_at)).where(Job.type == name))
        due = max(now, last + job_type.interval) if last else now
        enqueue(db, name, scheduled_at=due)
    db.commit()


def run_next(db: Session, settings: Settings, registry: Registry) -> bool:
    """Führt den nächsten fälligen Auftrag aus. Liefert False, wenn keiner fällig ist."""
    now = now_utc()
    job = db.execute(
        select(Job)
        .where(Job.status == JobStatus.PLANNED, Job.scheduled_at <= now)
        .order_by(Job.scheduled_at, Job.id)
        .limit(1)
        .with_for_update(skip_locked=True)
    ).scalar_one_or_none()
    if job is None:
        db.rollback()
        return False
    job.status = JobStatus.RUNNING
    job.started_at = now
    job.attempts += 1
    job_id, name, payload = job.id, job.type, dict(job.payload or {})
    db.commit()

    error: str | None = None
    job_type = registry.get(name)
    if job_type is None:
        error = "Unbekannte Art von Auftrag"
    else:
        try:
            job_type.handler(db, settings, payload)
            db.commit()
        except Exception as exc:
            db.rollback()
            logger.exception("Auftrag %s (%s) ist fehlgeschlagen", job_id, name)
            error = f"{type(exc).__name__}: {exc}"[:ERROR_MAX_LENGTH]

    finished = db.get(Job, job_id)
    if finished is None:
        return True
    finished.status = JobStatus.FAILED if error else JobStatus.DONE
    finished.finished_at = now_utc()
    finished.error = error
    if error:
        write_audit(
            db,
            module="kern",
            action="auftrag.fehlgeschlagen",
            object_type="job",
            object_id=str(job_id),
            result="fehler",
            details={"art": name},
        )
    db.commit()
    return True
