"""Aufbereitung für die Seiten: jüngster Stand je Gerät, Policies, Objekte, Übersicht."""

from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.modules.monitoring.fortigate.analysis import (
    KINDS,
    Query,
    Resolver,
    interface_pair,
    object_matches,
    object_value,
    policies_using,
    policy_matches,
    policy_rows,
    usages,
)
from werkbank.modules.monitoring.fortigate.collector import last_run, latest_snapshot
from werkbank.modules.monitoring.fortigate.models import FgDevice, FgRun, FgSnapshot


@dataclass
class DeviceState:
    device: FgDevice
    snapshot: FgSnapshot | None
    run: FgRun | None

    @property
    def config(self) -> dict[str, Any]:
        return self.snapshot.data if self.snapshot is not None else {}

    @property
    def runtime(self) -> dict[str, Any]:
        return self.device.runtime or {}


def states(db: Session) -> list[DeviceState]:
    """Eingeschaltete Geräte in ihrer Reihenfolge mit jüngstem Stand und letztem Abruf."""
    devices = db.scalars(
        select(FgDevice).where(FgDevice.enabled.is_(True)).order_by(FgDevice.position, FgDevice.id)
    ).all()
    return [DeviceState(d, latest_snapshot(db, d.id), last_run(db, d.id)) for d in devices]


# --- Übersicht -----------------------------------------------------------------------------


def fabric_role(config: dict[str, Any]) -> str:
    fabric = config.get("fabric") or {}
    if fabric.get("status") != "enable":
        return "ohne Fabric"
    return "Mitglied" if fabric.get("upstream") else "Root"


def ha_text(config: dict[str, Any], runtime: dict[str, Any]) -> str:
    mode = (config.get("ha") or {}).get("mode") or ""
    if mode in ("", "standalone"):
        return "kein HA"
    label = {"a-p": "Aktiv-Passiv", "a-a": "Aktiv-Aktiv"}.get(mode, mode)
    peers = runtime.get("ha_peers") or []
    return f"{label} · {len(peers)} Mitglieder" if peers else label


def overview(db: Session, now: datetime) -> dict[str, Any]:
    rows = states(db)
    devices = []
    policies = disabled = 0
    for state in rows:
        config, runtime = state.config, state.runtime
        items = config.get("policies") or []
        policies += len(items)
        disabled += sum(1 for p in items if p.get("status") is False)
        devices.append(
            {
                "id": state.device.id,
                "name": state.device.name,
                "hostname": runtime.get("hostname") or config.get("hostname") or "",
                "model": runtime.get("model") or "",
                "version": runtime.get("version") or "",
                "ha": ha_text(config, runtime),
                "fabric": fabric_role(config),
                "policies": len(items),
                "last_run_at": state.run.started_at if state.run else None,
                "last_ok": state.run.ok if state.run else None,
                "error": state.run.error if state.run and not state.run.ok else None,
                "data_at": state.snapshot.seen_at if state.snapshot else None,
                "notes": runtime.get("notes") or [],
            }
        )
    since = now - timedelta(days=1)
    changed = int(
        db.scalar(
            select(func.count())
            .select_from(FgRun)
            .where(FgRun.changed.is_(True), FgRun.started_at >= since)
        )
        or 0
    )
    # Der erste Stand eines Geräts ist keine Änderung
    first = int(
        db.scalar(
            select(func.count()).select_from(
                select(FgSnapshot.device_id)
                .group_by(FgSnapshot.device_id)
                .having(func.min(FgSnapshot.taken_at) >= since)
                .subquery()
            )
        )
        or 0
    )
    return {
        "devices": devices,
        "reachable": sum(1 for d in devices if d["last_ok"]),
        "policies": policies,
        "disabled": disabled,
        "changes_24h": max(changed - first, 0),
    }


# --- Policies ------------------------------------------------------------------------------


def policies(
    db: Session,
    query: Query,
    device: str | None = None,
    pair: str | None = None,
    action: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    pairs: Counter[str] = Counter()
    total = 0
    names = []
    for state in states(db):
        names.append(state.device.name)
        if state.snapshot is None:
            continue
        resolver = Resolver(state.config)
        for row in policy_rows(state.device.name, state.config, state.runtime):
            total += 1
            row["pair"] = interface_pair(row)
            pairs[row["pair"]] += 1
            if device and row["device"] != device:
                continue
            if pair and row["pair"] != pair:
                continue
            if action and row["action"] != action:
                continue
            if status == "aktiv" and not row["status"]:
                continue
            if status == "deaktiviert" and row["status"]:
                continue
            reason = policy_matches(row, query, resolver)
            if reason is None:
                continue
            row["match"] = reason
            rows.append(row)
    return {
        "rows": rows,
        "total": total,
        "devices": names,
        "pairs": sorted(pairs),
    }


# --- Objekte -------------------------------------------------------------------------------


def objects(db: Session, kind: str, query: Query, device: str | None = None) -> dict[str, Any]:
    """Objekte einer Art über alle Geräte, nach Namen zusammengefasst."""
    if kind not in KINDS:
        kind = "addresses"
    counts = {key: 0 for key in KINDS}
    merged: dict[str, dict[str, Any]] = {}
    device_names: list[str] = []
    for state in states(db):
        device_names.append(state.device.name)
        if state.snapshot is None:
            continue
        config = state.config
        for key in KINDS:
            counts[key] += len(config.get(key) or [])
        if device and state.device.name != device:
            continue
        resolver = Resolver(config)
        uses = usages(config)
        for entry in config.get(kind) or []:
            name = str(entry.get("name") or "")
            reason = object_matches(kind, entry, query, resolver)
            target = merged.setdefault(
                name, {"name": name, "devices": [], "uses": 0, "used_in": [], "match": None}
            )
            if reason is not None and target["match"] is None:
                target["match"] = reason
            usage = uses.get(name)
            target["uses"] += usage.count if usage else 0
            target["devices"].append(
                {
                    "device": state.device.name,
                    "value": object_value(kind, entry),
                    "fabric": bool(entry.get("fabric")),
                    "members": entry.get("members") or [],
                    "groups": usage.groups if usage else [],
                    "comment": entry.get("comment") or "",
                }
            )
            for pid, pname, field_name, via_group in policies_using(name, config, uses):
                target["used_in"].append(
                    {
                        "device": state.device.name,
                        "id": pid,
                        "name": pname,
                        "field": field_name,
                        "via_group": via_group,
                    }
                )
    rows = []
    for entry in merged.values():
        if entry["match"] is None:
            continue
        values = {d["value"] for d in entry["devices"]}
        entry["value"] = next(iter(values)) if len(values) == 1 else "unterschiedlich je Gerät"
        entry["same_value"] = len(values) == 1
        if kind in ("address_groups", "service_groups"):
            members = sorted({m for d in entry["devices"] for m in d["members"]})
            entry["member_table"] = [
                {"member": m, "devices": {d["device"]: m in d["members"] for d in entry["devices"]}}
                for m in members
            ]
        rows.append(entry)
    rows.sort(key=lambda e: e["name"].lower())
    return {"kind": kind, "rows": rows, "counts": counts, "devices": device_names}
