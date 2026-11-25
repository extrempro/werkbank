"""Auftrag der Datensicherung im Worker: täglich zur eingestellten Stunde oder auf Anstoß."""

from datetime import timedelta
from typing import Any

from sqlalchemy.orm import Session

from werkbank.backup.service import (
    TRIGGER_MANUAL,
    TRIGGER_SCHEDULE,
    load_config,
    run_backup,
    scheduled_due,
)
from werkbank.config import Settings
from werkbank.core.audit import write_audit
from werkbank.core.sessions import now_utc

JOB = "kern.sicherung"
JOB_INTERVAL = timedelta(minutes=10)


def backup_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    """Sichert, wenn aus der Verwaltung angestoßen oder heute laut Zeitplan fällig.

    Schlägt die Sicherung fehl, schlägt der Auftrag fehl: Die Admins bekommen eine
    Benachrichtigung, der Lauf steht mit Fehler in der Verwaltung.
    """
    manual = payload.get("manuell") is True
    if not manual and not scheduled_due(db, load_config(db), now_utc()):
        return
    by = payload.get("von") if manual and isinstance(payload.get("von"), str) else None
    run = run_backup(
        db, settings, trigger=TRIGGER_MANUAL if manual else TRIGGER_SCHEDULE, started_by=by
    )
    write_audit(
        db,
        module="kern",
        action="sicherung.erstellt",
        object_type="sicherung",
        object_id=run.name,
        details={"anlass": run.trigger, "bytes": run.size_bytes},
    )
