"""Aufträge der Dokumentation für den Worker."""

from datetime import timedelta
from typing import Any

from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.modules.doku.service import cleanup, flush_versions

VERSIONS = "doku.versionen"
VERSIONS_INTERVAL = timedelta(minutes=5)
CLEANUP = "doku.aufraeumen"
CLEANUP_INTERVAL = timedelta(days=1)


def versions_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    flush_versions(db)


def cleanup_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    cleanup(db)
