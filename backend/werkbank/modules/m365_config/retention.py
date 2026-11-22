"""Aufbewahrung der Abrufe (Snapshots) der M365-Konfiguration.

Gelöscht werden nur Abrufe, an denen kein Verlauf hängt: keine Version einer Einstellung und
keine erkannte Änderung verweist auf sie. Abrufe mit Änderungen bleiben also immer erhalten,
ebenso die letzten ``KEEP_LATEST`` Abrufe (z. B. für den Vergleich und die Fehleranzeige).
"""

from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.audit import write_audit
from werkbank.core.sessions import now_utc
from werkbank.modules.m365_config.models import (
    CfgChange,
    CfgSettingVersion,
    CfgSnapshot,
    SnapshotStatus,
)

KEEP_LATEST = 10


def prune_snapshots(db: Session, settings: Settings) -> int:
    """Löscht alte Abrufe ohne Verlauf und liefert die Anzahl. Commit macht der Aufrufer."""
    days = settings.collector_snapshot_keep_days
    if days <= 0:
        return 0
    latest = select(CfgSnapshot.id).order_by(CfgSnapshot.id.desc()).limit(KEEP_LATEST)
    candidates = db.scalars(
        select(CfgSnapshot.id).where(
            CfgSnapshot.started_at < now_utc() - timedelta(days=days),
            CfgSnapshot.status != SnapshotStatus.RUNNING,
            CfgSnapshot.id.not_in(latest.scalar_subquery()),
            CfgSnapshot.id.not_in(select(CfgSettingVersion.snapshot_id).distinct()),
            CfgSnapshot.id.not_in(select(CfgChange.snapshot_id).distinct()),
        )
    ).all()
    if not candidates:
        return 0
    db.execute(delete(CfgSnapshot).where(CfgSnapshot.id.in_(candidates)))
    write_audit(
        db,
        module="m365_config",
        action="snapshots_bereinigt",
        details={"geloescht": len(candidates), "aelter_als_tage": days},
    )
    return len(candidates)
