"""Auftrag der Gerätezuordnung für den Worker (alle 5 Minuten)."""

from datetime import timedelta
from typing import Any

from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.modules.devices.api import JOB_TYPE
from werkbank.modules.devices.service import (
    app_graph,
    check_open,
    expire_pending,
    remove_expired_admin_tokens,
)

STATUS_JOB = JOB_TYPE
STATUS_JOB_INTERVAL = timedelta(minutes=5)


def status_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    """Abgelaufene Gerätedaten und Admin-Tokens löschen; offene Einträge prüfen (nur mit der
    Collector-App und eingeschalteter Prüfung), nach 7 Tagen „Nicht abgeschlossen“."""
    expire_pending(db)
    remove_expired_admin_tokens(db)
    check_open(db, app_graph(settings))
    db.commit()
