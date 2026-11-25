"""Verwaltung, Seite Datensicherung: Zeitplan, Aufbewahrung, Zustand, Läufe, jetzt sichern.

Nur Admins mit frischer Anmeldung. Zurückspielen gibt es hier bewusst nicht: Es ersetzt alle
Daten und geht nur per Kommando bei angehaltener Werkbank (deploy/README.md).
"""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from werkbank.backup.jobs import JOB
from werkbank.backup.service import (
    HOUR_DEFAULT,
    KEEP_DEFAULT,
    KEEP_MAX,
    KEEP_MIN,
    SETTINGS_KEY,
    list_backups,
    load_config,
    readiness,
)
from werkbank.config import Settings
from werkbank.core.app_settings import set_setting
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep, require_recent_login
from werkbank.core.models import BackupRun, Job, JobStatus
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser
from werkbank.worker.jobs import enqueue

router = APIRouter(prefix="/api/admin/backup")

AdminUser = Annotated[CurrentUser, Depends(require_recent_login(Role.WERKBANK_ADMIN))]
RUNS_SHOWN = 20


class BackupSettingsIn(BaseModel):
    enabled: bool
    hour: Annotated[int, Field(ge=0, le=23)] = HOUR_DEFAULT
    keep: Annotated[int, Field(ge=KEEP_MIN, le=KEEP_MAX)] = KEEP_DEFAULT


class ReadinessOut(BaseModel):
    key: bool
    folder: bool
    tools: bool
    ready: bool


class BackupOut(BaseModel):
    name: str
    created_at: datetime
    version: str
    size_bytes: int


class RunOut(BaseModel):
    id: int
    started_at: datetime
    finished_at: datetime | None
    status: str
    trigger: str
    started_by: str | None
    name: str
    size_bytes: int | None
    error: str | None


class BackupStateOut(BaseModel):
    enabled: bool
    hour: int
    keep: int
    keep_min: int
    keep_max: int
    readiness: ReadinessOut
    requested: bool
    backups: list[BackupOut]
    runs: list[RunOut]


def _requested(db: DbDep) -> bool:
    """Wartet eine Sicherung aus der Verwaltung auf den Worker oder läuft gerade eine?"""
    pending = db.scalar(
        select(Job.id)
        .where(
            Job.type == JOB,
            Job.status.in_((JobStatus.PLANNED, JobStatus.RUNNING)),
            Job.payload["manuell"].as_boolean().is_(True),
        )
        .limit(1)
    )
    running = db.scalar(select(BackupRun.id).where(BackupRun.status == "laeuft").limit(1))
    return pending is not None or running is not None


def _state(db: DbDep, settings: Settings) -> BackupStateOut:
    config = load_config(db)
    state = readiness(settings)
    runs = db.scalars(select(BackupRun).order_by(BackupRun.started_at.desc()).limit(RUNS_SHOWN))
    return BackupStateOut(
        enabled=config.enabled,
        hour=config.hour,
        keep=config.keep,
        keep_min=KEEP_MIN,
        keep_max=KEEP_MAX,
        readiness=ReadinessOut(
            key=state.key, folder=state.folder, tools=state.tools, ready=state.ready
        ),
        requested=_requested(db),
        backups=[
            BackupOut(
                name=b.name, created_at=b.created_at, version=b.version, size_bytes=b.size_bytes
            )
            for b in list_backups(settings)
        ],
        runs=[
            RunOut(
                id=r.id,
                started_at=r.started_at,
                finished_at=r.finished_at,
                status=r.status,
                trigger=r.trigger,
                started_by=r.started_by,
                name=r.name,
                size_bytes=r.size_bytes,
                error=r.error,
            )
            for r in runs
        ],
    )


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.get("")
def read_backup(user: AdminUser, db: DbDep, settings: SettingsDep) -> BackupStateOut:
    return _state(db, settings)


@router.put("")
def update_backup(
    request: Request,
    body: BackupSettingsIn,
    user: AdminUser,
    db: DbDep,
    settings: SettingsDep,
) -> BackupStateOut:
    before = load_config(db)
    value = {"enabled": body.enabled, "hour": body.hour, "keep": body.keep}
    set_setting(db, SETTINGS_KEY, value, user.user_id)
    write_audit(
        db,
        module="kern",
        action="sicherung.einstellungen_geaendert",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=SETTINGS_KEY,
        ip=_ip(request),
        details={
            "vorher": {"enabled": before.enabled, "hour": before.hour, "keep": before.keep},
            "nachher": value,
        },
    )
    db.commit()
    return _state(db, settings)


@router.post("/jetzt", status_code=status.HTTP_202_ACCEPTED)
def start_backup(
    request: Request, user: AdminUser, db: DbDep, settings: SettingsDep
) -> BackupStateOut:
    """Stößt eine Sicherung an; der Worker beginnt innerhalb weniger Sekunden."""
    if not readiness(settings).ready:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Die Sicherung ist noch nicht eingerichtet (Schlüssel, Zielordner).",
        )
    if _requested(db):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Eine Sicherung läuft bereits."
        )
    enqueue(db, JOB, payload={"manuell": True, "von": user.display_name})
    write_audit(
        db,
        module="kern",
        action="sicherung.angestossen",
        user_id=user.user_id,
        object_type="sicherung",
        ip=_ip(request),
    )
    db.commit()
    return _state(db, settings)
