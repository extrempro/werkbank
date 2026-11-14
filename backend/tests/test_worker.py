import threading
from datetime import timedelta
from typing import Any

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.models import AuditLog, AuthFlow, Job, JobStatus, User, UserSession
from werkbank.core.sessions import now_utc
from werkbank.worker import runner
from werkbank.worker.__main__ import main
from werkbank.worker.jobs import (
    JobType,
    enqueue,
    ensure_scheduled,
    recover_interrupted,
    run_next,
)
from werkbank.worker.tasks import CLEANUP, REGISTRY, cleanup

SETTINGS = Settings(environment="test")


@pytest.fixture
def db(db_session: Session) -> Session:
    """Leere Auftragsliste für jeden Test."""
    db_session.execute(delete(Job))
    db_session.commit()
    return db_session


def reload(db: Session, job: Job) -> Job:
    db.expire_all()
    found = db.get(Job, job.id)
    assert found is not None
    return found


@pytest.mark.db
def test_job_runs_and_is_marked_done(db: Session) -> None:
    seen: list[dict[str, Any]] = []

    def handler(session: Session, settings: Settings, payload: dict[str, Any]) -> None:
        seen.append(payload)

    registry = {"test.ok": JobType(handler)}
    job = enqueue(db, "test.ok", payload={"wert": 1})
    db.commit()

    assert run_next(db, SETTINGS, registry) is True
    assert seen == [{"wert": 1}]
    done = reload(db, job)
    assert done.status == JobStatus.DONE
    assert done.attempts == 1
    assert done.started_at is not None and done.finished_at is not None
    assert done.error is None
    assert run_next(db, SETTINGS, registry) is False


@pytest.mark.db
def test_failed_job_keeps_error_and_is_audited(db: Session) -> None:
    def handler(session: Session, settings: Settings, payload: dict[str, Any]) -> None:
        raise RuntimeError("kaputt")

    job = enqueue(db, "test.fehler")
    db.commit()

    assert run_next(db, SETTINGS, {"test.fehler": JobType(handler)}) is True
    failed = reload(db, job)
    assert failed.status == JobStatus.FAILED
    assert failed.error == "RuntimeError: kaputt"
    entry = db.execute(
        select(AuditLog).where(
            AuditLog.action == "auftrag.fehlgeschlagen", AuditLog.object_id == str(job.id)
        )
    ).scalar_one()
    assert entry.result == "fehler"
    assert entry.details == {"art": "test.fehler"}


@pytest.mark.db
def test_unknown_job_type_fails(db: Session) -> None:
    job = enqueue(db, "gibt.es.nicht")
    db.commit()
    assert run_next(db, SETTINGS, {}) is True
    assert reload(db, job).status == JobStatus.FAILED


@pytest.mark.db
def test_future_job_is_not_started(db: Session) -> None:
    job = enqueue(db, CLEANUP, scheduled_at=now_utc() + timedelta(hours=1))
    db.commit()
    assert run_next(db, SETTINGS, REGISTRY) is False
    assert reload(db, job).status == JobStatus.PLANNED


@pytest.mark.db
def test_periodic_job_is_scheduled_once_and_again_after_interval(db: Session) -> None:
    ensure_scheduled(db, REGISTRY)
    ensure_scheduled(db, REGISTRY)
    jobs = db.scalars(select(Job).where(Job.type == CLEANUP)).all()
    assert len(jobs) == 1

    assert run_next(db, SETTINGS, REGISTRY) is True
    ensure_scheduled(db, REGISTRY)
    planned = db.scalars(
        select(Job).where(Job.type == CLEANUP, Job.status == JobStatus.PLANNED)
    ).all()
    assert len(planned) == 1
    # der nächste Lauf liegt ein Intervall nach dem letzten, also noch nicht jetzt
    assert planned[0].scheduled_at > now_utc() + timedelta(minutes=50)


@pytest.mark.db
def test_interrupted_jobs_are_closed_on_start(db: Session) -> None:
    job = enqueue(db, CLEANUP)
    job.status = JobStatus.RUNNING
    db.commit()
    recover_interrupted(db)
    closed = reload(db, job)
    assert closed.status == JobStatus.FAILED
    assert closed.error is not None and "neu gestartet" in closed.error


@pytest.mark.db
def test_cleanup_removes_expired_data_only(db: Session) -> None:
    now = now_utc()
    user = User(entra_oid="test:worker-aufraeumen", display_name="Wanda Worker")
    existing = db.execute(select(User).where(User.entra_oid == user.entra_oid)).scalar_one_or_none()
    if existing is None:
        db.add(user)
        db.flush()
    else:
        user = existing

    def add_session(token_hash: str, *, expires_in: timedelta, idle: timedelta) -> None:
        db.add(
            UserSession(
                token_hash=token_hash,
                user_id=user.id,
                roles=[],
                created_at=now - timedelta(hours=1),
                last_seen_at=now - idle,
                expires_at=now + expires_in,
                authenticated_at=now - timedelta(hours=1),
            )
        )

    db.execute(delete(UserSession).where(UserSession.user_id == user.id))
    add_session("w-aktiv", expires_in=timedelta(hours=1), idle=timedelta(minutes=1))
    add_session("w-abgelaufen", expires_in=-timedelta(minutes=1), idle=timedelta(minutes=1))
    add_session("w-leerlauf", expires_in=timedelta(hours=1), idle=timedelta(hours=2))
    db.merge(AuthFlow(id_hash="w-alt", flow={}, expires_at=now - timedelta(minutes=1)))
    db.merge(AuthFlow(id_hash="w-neu", flow={}, expires_at=now + timedelta(minutes=5)))
    old_job = enqueue(db, "test.alt")
    old_job.status = JobStatus.DONE
    old_job.finished_at = now - timedelta(days=31)
    recent_job = enqueue(db, "test.neu")
    recent_job.status = JobStatus.DONE
    recent_job.finished_at = now - timedelta(days=1)
    db.commit()

    cleanup(db, SETTINGS, {})
    db.commit()
    db.expire_all()

    hashes = db.scalars(select(UserSession.token_hash).where(UserSession.user_id == user.id)).all()
    assert hashes == ["w-aktiv"]
    assert db.get(AuthFlow, "w-alt") is None
    assert db.get(AuthFlow, "w-neu") is not None
    assert db.get(Job, old_job.id) is None
    assert db.get(Job, recent_job.id) is not None


@pytest.mark.db
def test_worker_loop_runs_jobs_and_writes_heartbeat(
    db: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    heartbeat = tmp_path / "lebenszeichen"
    monkeypatch.setattr(runner, "HEARTBEAT_FILE", heartbeat)
    assert runner.heartbeat_is_fresh() is False
    assert main(["--check"]) == 1

    stop = threading.Event()

    def handler(session: Session, settings: Settings, payload: dict[str, Any]) -> None:
        stop.set()

    job = enqueue(db, "test.schleife")
    db.commit()
    runner.run_forever(SETTINGS, stop, {"test.schleife": JobType(handler)})

    assert reload(db, job).status == JobStatus.DONE
    assert runner.heartbeat_is_fresh() is True
    assert main(["--check"]) == 0
