"""Snapshots vergleichen und exportieren (spec.md 10, Seite M365-Snapshots).

Der Stand zu einem Abruf ergibt sich aus den Versionen: gültig ist je Einstellung die Version,
die beim Ende des Abrufs galt (valid_from ≤ Ende < valid_to). Exportiert werden nur Einstellungen
des Tenants, wie sie die Werkbank gelesen hat; Bewertungen und Kommentare nicht.
"""

import csv
import io
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from werkbank.core.audit import write_audit
from werkbank.core.audit_api import safe_cell
from werkbank.core.deps import DbDep, require_roles
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser
from werkbank.modules.m365_config.collector import MODULE
from werkbank.modules.m365_config.models import (
    CfgSetting,
    CfgSettingVersion,
    CfgSnapshot,
    SnapshotStatus,
)
from werkbank.modules.m365_config.versioning import same_value

router = APIRouter(prefix="/api/m365-config/snapshots")

Reader = Annotated[CurrentUser, Depends(require_roles(Role.CONFIG_READER, Role.CONFIG_REVIEWER))]
# Export des vollständigen Stands (alle Einstellungen des Tenants): nur Systemadmins
Exporter = Annotated[CurrentUser, Depends(require_roles(Role.WERKBANK_ADMIN))]
SnapshotId = Annotated[int, Path(ge=1, le=2_000_000_000)]
# Höchstzahl Unterschiede in einer Antwort; der Rest steht im Export
COMPARE_LIMIT = 2000


@dataclass(frozen=True)
class Entry:
    path: str
    workload: str
    area: str
    object_id: str
    object_name: str | None
    property: str
    value: Any
    valid_from: datetime


def _snapshot(db: Session, snapshot_id: int) -> CfgSnapshot:
    snapshot = db.get(CfgSnapshot, snapshot_id)
    if snapshot is None or snapshot.finished_at is None:
        raise HTTPException(status_code=404, detail="Diesen Abruf gibt es nicht.")
    if snapshot.status == SnapshotStatus.FAILED:
        raise HTTPException(
            status_code=409, detail="Der Abruf ist fehlgeschlagen und hat keinen eigenen Stand."
        )
    return snapshot


def state_at(db: Session, snapshot: CfgSnapshot) -> dict[str, Entry]:
    """Alle Einstellungen mit dem Wert, der am Ende des Abrufs galt."""
    moment = snapshot.finished_at or snapshot.started_at
    rows = db.execute(
        select(CfgSetting, CfgSettingVersion)
        .join(CfgSettingVersion, CfgSettingVersion.setting_id == CfgSetting.id)
        .where(
            CfgSettingVersion.valid_from <= moment,
            or_(CfgSettingVersion.valid_to.is_(None), CfgSettingVersion.valid_to > moment),
        )
        .order_by(CfgSetting.path)
    ).all()
    return {
        setting.path: Entry(
            path=setting.path,
            workload=setting.workload,
            area=setting.area,
            object_id=setting.object_id,
            object_name=setting.object_name,
            property=setting.property,
            value=version.value,
            valid_from=version.valid_from,
        )
        for setting, version in rows
    }


class DifferenceOut(BaseModel):
    path: str
    workload: str
    area: str
    object_name: str | None
    property: str
    kind: Literal["neu", "geaendert", "entfernt"]
    old_value: Any
    new_value: Any


class CompareOut(BaseModel):
    from_id: int
    to_id: int
    from_at: datetime
    to_at: datetime
    total: int
    counts: dict[str, int]
    # Höchstens COMPARE_LIMIT Einträge; truncated, wenn es mehr gibt
    differences: list[DifferenceOut]
    truncated: bool


def compare_states(older: dict[str, Entry], newer: dict[str, Entry]) -> list[DifferenceOut]:
    differences: list[DifferenceOut] = []
    for path in sorted(older.keys() | newer.keys()):
        before = older.get(path)
        after = newer.get(path)
        if before is not None and after is not None and same_value(before.value, after.value):
            continue
        base = after if after is not None else before
        if base is None:
            continue
        differences.append(
            DifferenceOut(
                path=path,
                workload=base.workload,
                area=base.area,
                object_name=base.object_name,
                property=base.property,
                kind="neu" if before is None else "entfernt" if after is None else "geaendert",
                old_value=before.value if before else None,
                new_value=after.value if after else None,
            )
        )
    return differences


@router.get("/compare")
def compare(
    user: Reader,
    db: DbDep,
    from_id: Annotated[int, Query(alias="from", ge=1, le=2_000_000_000)],
    to_id: Annotated[int, Query(alias="to", ge=1, le=2_000_000_000)],
) -> CompareOut:
    """Unterschiede zwischen zwei Abrufen; der ältere ist immer „vorher“."""
    first = _snapshot(db, from_id)
    second = _snapshot(db, to_id)
    older, newer = sorted((first, second), key=lambda item: item.finished_at or datetime.min)
    differences = compare_states(state_at(db, older), state_at(db, newer))
    counts = {"neu": 0, "geaendert": 0, "entfernt": 0}
    for difference in differences:
        counts[difference.kind] += 1
    return CompareOut(
        from_id=older.id,
        to_id=newer.id,
        from_at=older.finished_at or older.started_at,
        to_at=newer.finished_at or newer.started_at,
        total=len(differences),
        counts=counts,
        differences=differences[:COMPARE_LIMIT],
        truncated=len(differences) > COMPARE_LIMIT,
    )


def _filename(snapshot: CfgSnapshot, extension: str) -> str:
    moment = (snapshot.finished_at or snapshot.started_at).astimezone(UTC)
    return f"werkbank-snapshot-{snapshot.id}-{moment:%Y%m%d-%H%M}.{extension}"


def _audit(
    request: Request, db: Session, user: CurrentUser, snapshot: CfgSnapshot, kind: str, count: int
) -> None:
    write_audit(
        db,
        module=MODULE,
        action="snapshot.export",
        user_id=user.user_id,
        object_type="snapshot",
        object_id=str(snapshot.id),
        ip=request.client.host if request.client else None,
        details={"format": kind, "anzahl": count},
    )
    db.commit()


@router.get("/{snapshot_id}/export.json")
def export_json(request: Request, snapshot_id: SnapshotId, user: Exporter, db: DbDep) -> Response:
    """Stand eines Abrufs als JSON zum Herunterladen."""
    snapshot = _snapshot(db, snapshot_id)
    state = state_at(db, snapshot)
    document = {
        "snapshot": {
            "id": snapshot.id,
            "beginn": snapshot.started_at.astimezone(UTC).isoformat(),
            "ende": snapshot.finished_at.astimezone(UTC).isoformat()
            if snapshot.finished_at
            else None,
            "status": snapshot.status,
        },
        "einstellungen": [
            {
                "pfad": entry.path,
                "dienst": entry.workload,
                "bereich": entry.area,
                "objekt_id": entry.object_id,
                "objekt": entry.object_name,
                "eigenschaft": entry.property,
                "wert": entry.value,
                "gilt_seit": entry.valid_from.astimezone(UTC).isoformat(),
            }
            for entry in state.values()
        ],
    }
    _audit(request, db, user, snapshot, "json", len(state))
    return Response(
        content=json.dumps(document, ensure_ascii=False, indent=2),
        media_type="application/json; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{_filename(snapshot, "json")}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/{snapshot_id}/export.csv")
def export_csv(request: Request, snapshot_id: SnapshotId, user: Exporter, db: DbDep) -> Response:
    """Stand eines Abrufs als CSV (Semikolon, UTF-8 mit BOM für Excel)."""
    snapshot = _snapshot(db, snapshot_id)
    state = state_at(db, snapshot)
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(
        [
            "Dienst",
            "Bereich",
            "Objekt",
            "Objekt-ID",
            "Eigenschaft",
            "Wert",
            "Gilt seit (UTC)",
            "Pfad",
        ]
    )
    for entry in state.values():
        value = (
            entry.value
            if isinstance(entry.value, str)
            else json.dumps(entry.value, ensure_ascii=False)
        )
        writer.writerow(
            [
                safe_cell(entry.workload),
                safe_cell(entry.area),
                safe_cell(entry.object_name),
                safe_cell(entry.object_id),
                safe_cell(entry.property),
                safe_cell(value),
                safe_cell(entry.valid_from.astimezone(UTC).isoformat()),
                safe_cell(entry.path),
            ]
        )
    _audit(request, db, user, snapshot, "csv", len(state))
    return Response(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{_filename(snapshot, "csv")}"',
            "Cache-Control": "no-store",
        },
    )
