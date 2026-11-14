"""Schleife des Workers und Lebenszeichen für den Docker-Healthcheck."""

import logging
import tempfile
import threading
import time
from pathlib import Path

from werkbank.config import Settings
from werkbank.db import get_sessionmaker
from werkbank.worker.jobs import Registry, ensure_scheduled, recover_interrupted, run_next

logger = logging.getLogger(__name__)

HEARTBEAT_FILE = Path(tempfile.gettempdir()) / "werkbank-worker.lebenszeichen"
HEARTBEAT_MAX_AGE_SECONDS = 120


def heartbeat_is_fresh() -> bool:
    """Für den Healthcheck: Hat die Schleife vor Kurzem erfolgreich gearbeitet?"""
    try:
        age = time.time() - HEARTBEAT_FILE.stat().st_mtime
    except OSError:
        return False
    return age < HEARTBEAT_MAX_AGE_SECONDS


def run_forever(settings: Settings, stop: threading.Event, registry: Registry) -> None:
    """Arbeitet Aufträge ab, bis stop gesetzt wird."""
    factory = get_sessionmaker()
    with factory() as db:
        recover_interrupted(db)
    logger.info("Worker gestartet (%d Auftragsarten)", len(registry))
    while not stop.is_set():
        worked = False
        try:
            with factory() as db:
                ensure_scheduled(db, registry)
                worked = run_next(db, settings, registry)
            HEARTBEAT_FILE.touch()
        except Exception:
            logger.exception("Fehler in der Auftragsschleife")
        if not worked:
            stop.wait(settings.worker_poll_seconds)
    logger.info("Worker beendet")
