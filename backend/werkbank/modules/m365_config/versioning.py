"""Versionierung und Änderungserkennung (spec.md 7.3).

Ein Abruf liefert den vollständigen Ist-Stand je Quelle. Daraus entstehen neue Versionen
und Änderungen (neu, geändert, entfernt). Regeln:

- Eine neue Version nur, wenn sich der Wert geändert hat.
- Eine Quelle mit Fehler markiert ihre Einstellungen nicht als entfernt.
- Der erste erfolgreiche Abruf einer Quelle ist der Ausgangsstand: Die Einstellungen werden
  gespeichert, aber nicht als Änderungen zur Bewertung vorgelegt.
"""

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.core.sessions import now_utc
from werkbank.modules.m365_config.models import (
    CfgChange,
    CfgSetting,
    CfgSettingVersion,
    CfgSnapshot,
    ChangeKind,
    SnapshotStatus,
)
from werkbank.modules.m365_config.normalize import SettingValue


@dataclass(frozen=True)
class SnapshotResult:
    snapshot_id: int
    status: str
    new: int = 0
    changed: int = 0
    removed: int = 0
    baseline: int = 0

    @property
    def changes(self) -> int:
        return self.new + self.changed + self.removed


def same_value(left: Any, right: Any) -> bool:
    """Vergleicht JSON-Werte unabhängig von der Reihenfolge der Schlüssel in Objekten."""
    return json.dumps(left, sort_keys=True) == json.dumps(right, sort_keys=True)


def apply_snapshot(
    db: Session,
    items: Iterable[SettingValue],
    source_status: Mapping[str, bool],
    *,
    started_at: datetime | None = None,
) -> SnapshotResult:
    """Übernimmt einen Abruf. Der Aufrufer entscheidet über das Commit.

    items: alle gelesenen Einstellungen. source_status: je Quelle, ob sie vollständig gelesen
    wurde. Einstellungen aus Quellen mit Fehler werden nicht übernommen.
    """
    now = now_utc()
    ok_sources = {source for source, ok in source_status.items() if ok}
    if not source_status:
        status = SnapshotStatus.FAILED
    elif len(ok_sources) == len(source_status):
        status = SnapshotStatus.OK
    elif ok_sources:
        status = SnapshotStatus.PARTIAL
    else:
        status = SnapshotStatus.FAILED
    snapshot = CfgSnapshot(
        started_at=started_at or now,
        finished_at=now,
        status=status,
        source_status=dict(source_status),
    )
    db.add(snapshot)
    db.flush()

    # Bestand der betroffenen Quellen samt gültiger Version laden
    known: dict[str, tuple[CfgSetting, CfgSettingVersion | None]] = {}
    known_sources: set[str] = set()
    if ok_sources:
        rows = db.execute(
            select(CfgSetting, CfgSettingVersion)
            .outerjoin(
                CfgSettingVersion,
                (CfgSettingVersion.setting_id == CfgSetting.id)
                & CfgSettingVersion.valid_to.is_(None),
            )
            .where(CfgSetting.source.in_(ok_sources))
        ).all()
        for setting, version in rows:
            known[setting.path] = (setting, version)
            known_sources.add(setting.source)

    new = changed = removed = baseline = 0
    seen: set[str] = set()

    def add_version(setting: CfgSetting, value: Any) -> None:
        db.add(
            CfgSettingVersion(
                setting_id=setting.id, value=value, valid_from=now, snapshot_id=snapshot.id
            )
        )

    def add_change(setting: CfgSetting, kind: ChangeKind, old: Any, new_value: Any) -> None:
        db.add(
            CfgChange(
                setting_id=setting.id,
                kind=kind,
                old_value=old,
                new_value=new_value,
                snapshot_id=snapshot.id,
                detected_at=now,
            )
        )

    for item in items:
        if item.source not in ok_sources or item.path in seen:
            continue
        seen.add(item.path)
        entry = known.get(item.path)
        if entry is None:
            setting = CfgSetting(
                path=item.path,
                workload=item.workload,
                area=item.area,
                object_id=item.object_id,
                object_name=item.object_name,
                property=item.property,
                source=item.source,
                active=True,
            )
            db.add(setting)
            db.flush()
            add_version(setting, item.value)
            if item.source in known_sources:
                add_change(setting, ChangeKind.NEW, None, item.value)
                new += 1
            else:
                baseline += 1
            continue

        setting, version = entry
        setting.object_name = item.object_name
        if not setting.active or version is None:
            # war entfernt und ist wieder da
            setting.active = True
            add_version(setting, item.value)
            add_change(setting, ChangeKind.NEW, None, item.value)
            new += 1
        elif not same_value(version.value, item.value):
            version.valid_to = now
            add_version(setting, item.value)
            add_change(setting, ChangeKind.CHANGED, version.value, item.value)
            changed += 1

    for path, (setting, version) in known.items():
        if path in seen or not setting.active:
            continue
        setting.active = False
        old = None
        if version is not None:
            version.valid_to = now
            old = version.value
        add_change(setting, ChangeKind.REMOVED, old, None)
        removed += 1

    snapshot.change_count = new + changed + removed
    db.flush()
    return SnapshotResult(
        snapshot_id=snapshot.id,
        status=status,
        new=new,
        changed=changed,
        removed=removed,
        baseline=baseline,
    )
