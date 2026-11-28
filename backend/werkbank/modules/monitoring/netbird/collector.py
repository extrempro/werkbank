"""Abruf von NetBird alle fünf Minuten: jüngster Stand, Tageswerte, Aufräumen nach 90 Tagen.

Ein Fehler steht im Abruf; die Seiten zeigen dann den letzten Stand mit Zeit.
"""

import logging
import time
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.sessions import now_utc
from werkbank.modules.monitoring.netbird.client import NetBirdClient, NetBirdError, Transport
from werkbank.modules.monitoring.netbird.config import HISTORY_DAYS, client_config
from werkbank.modules.monitoring.netbird.models import NbDaily, NbPeerDay, NbRun, NbState
from werkbank.modules.monitoring.netbird.normalize import fetch

logger = logging.getLogger(__name__)

NETBIRD_JOB = "monitoring.netbird"
NETBIRD_JOB_INTERVAL = timedelta(minutes=5)
LOCAL_TZ = ZoneInfo("Europe/Berlin")
ERROR_MAX = 500


def local_day(moment: datetime) -> date:
    return moment.astimezone(LOCAL_TZ).date()


def latest_state(db: Session) -> NbState | None:
    return db.get(NbState, 1)


def last_run(db: Session) -> NbRun | None:
    return db.scalars(select(NbRun).order_by(NbRun.id.desc()).limit(1)).first()


def store(db: Session, data: dict[str, Any], now: datetime) -> None:
    state = latest_state(db)
    if state is None:
        db.add(NbState(id=1, fetched_at=now, data=data))
    else:
        state.fetched_at = now
        state.data = data
    day = local_day(now)
    peers = data.get("peers") or []
    connected = [p["id"] for p in peers if p.get("connected") and p.get("id")]
    daily = db.get(NbDaily, day)
    if daily is None:
        db.add(NbDaily(day=day, max_connected=len(connected), total=len(peers)))
    else:
        daily.max_connected = max(daily.max_connected, len(connected))
        daily.total = len(peers)
    known = set(db.scalars(select(NbPeerDay.peer_id).where(NbPeerDay.day == day)))
    for peer_id in set(connected) - known:
        db.add(NbPeerDay(peer_id=peer_id[:64], day=day))


def purge(db: Session, now: datetime) -> None:
    cutoff = local_day(now) - timedelta(days=HISTORY_DAYS)
    db.execute(delete(NbDaily).where(NbDaily.day < cutoff))
    db.execute(delete(NbPeerDay).where(NbPeerDay.day < cutoff))
    db.execute(delete(NbRun).where(NbRun.started_at < now - timedelta(days=HISTORY_DAYS)))


def collect(db: Session, settings: Settings, *, transport: Transport | None = None) -> NbRun | None:
    """Ein Abruf; None, wenn NetBird nicht eingerichtet ist."""
    config = client_config(db, settings)
    if config is None:
        return None
    now = now_utc()
    started = time.monotonic()
    run = NbRun(started_at=now, ok=True)
    try:
        fetched = fetch(NetBirdClient(config, transport))
        store(db, fetched.data, now)
    except NetBirdError as error:
        db.rollback()
        run = NbRun(started_at=now, ok=False, error=str(error)[:ERROR_MAX])
    except Exception:
        logger.exception("NetBird: Abruf fehlgeschlagen")
        db.rollback()
        run = NbRun(
            started_at=now, ok=False, error="Unerwarteter Fehler beim Verarbeiten der Antwort."
        )
    run.duration_ms = int((time.monotonic() - started) * 1000)
    db.add(run)
    purge(db, now)
    db.commit()
    return run


def netbird_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    collect(db, settings)
