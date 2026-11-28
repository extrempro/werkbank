"""Aufbereitung für die Seiten: jüngster Stand je Gerät, Policies, Objekte, Übersicht."""

from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import quote

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from werkbank.core.audit import write_audit
from werkbank.core.models import User
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
from werkbank.modules.monitoring.fortigate.fabric import (
    SYNC_KINDS,
    Entry,
    device_role,
    object_state,
)
from werkbank.modules.monitoring.fortigate.findings import (
    RULES,
    SEVERITIES,
    Finding,
    Options,
    object_findings,
    policy_findings,
    unused_finding,
)
from werkbank.modules.monitoring.fortigate.models import (
    FgDevice,
    FgException,
    FgFinding,
    FgRun,
    FgSnapshot,
    FgUnused,
)
from werkbank.modules.monitoring.fortigate.unused import UNUSED_KINDS, is_default, unused


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
        "sync": sync_bar(rows),
        "reachable": sum(1 for d in devices if d["last_ok"]),
        "policies": policies,
        "disabled": disabled,
        "changes_24h": max(changed - first, 0),
    }


# --- Fabric-Sync ---------------------------------------------------------------------------


def _sync_rows(rows: list[DeviceState]) -> tuple[dict[str, str], dict[tuple[str, str], Any]]:
    """Rollen je Gerät und Zustand je (Art, Name) über alle Geräte."""
    roles = {state.device.name: device_role(state.config) for state in rows if state.snapshot}
    entries: dict[tuple[str, str], list[Entry]] = {}
    for state in rows:
        if state.snapshot is None:
            continue
        uses = usages(state.config)
        for kind in SYNC_KINDS:
            for entry in state.config.get(kind) or []:
                name = str(entry.get("name") or "")
                if is_default(kind, entry):
                    # Standardobjekte bringt jedes Gerät mit; kein Thema für den Sync
                    continue
                usage = uses.get(name)
                entries.setdefault((kind, name), []).append(
                    Entry(
                        device=state.device.name,
                        value=object_value(kind, entry),
                        fabric=bool(entry.get("fabric")),
                        used=bool(usage and usage.count),
                    )
                )
    return roles, {key: (items, object_state(items, roles)) for key, items in entries.items()}


def sync_bar(rows: list[DeviceState]) -> list[dict[str, Any]]:
    """Je Gerät: Rolle beim Objekt-Sync und Zahl synchronisierter, lokaler, abweichender Objekte."""
    roles, states_by_key = _sync_rows(rows)
    out = []
    for name, role in roles.items():
        counts = {"synchronisiert": 0, "lokal": 0, "abweichend": 0, "kandidaten": 0}
        for items, state in states_by_key.values():
            if not any(entry.device == name for entry in items):
                continue
            if state.state == "synchronisiert":
                counts["synchronisiert"] += 1
            elif state.state == "abweichend":
                counts["abweichend"] += 1
            else:
                counts["lokal"] += 1
                if state.candidate:
                    counts["kandidaten"] += 1
        out.append({"device": name, "role": role, **counts})
    return out


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


def objects(
    db: Session, kind: str, query: Query, device: str | None = None, sync: str | None = None
) -> dict[str, Any]:
    """Objekte einer Art über alle Geräte, nach Namen zusammengefasst, mit Fabric-Sync."""
    if kind not in KINDS:
        kind = "addresses"
    counts = {key: 0 for key in KINDS}
    merged: dict[str, dict[str, Any]] = {}
    device_names: list[str] = []
    rows_state = states(db)
    _, sync_states = _sync_rows(rows_state)
    for state in rows_state:
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
        found = sync_states.get((kind, entry["name"]))
        entry["sync"] = (
            {"state": found[1].state, "label": found[1].label, "candidate": found[1].candidate}
            if found
            else None
        )
        if entry["match"] is None:
            continue
        if sync and (entry["sync"] is None or entry["sync"]["state"] != sync):
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
    return {
        "kind": kind,
        "rows": rows,
        "counts": counts,
        "devices": device_names,
        "unused": len(unused_rows(db, rows_state)),
    }


# --- Unbenutzte Objekte --------------------------------------------------------------------

DAY = timedelta(days=1)


def unused_rows(
    db: Session,
    rows_state: list[DeviceState] | None = None,
    *,
    device: str | None = None,
    kind: str | None = None,
    min_days: int | None = None,
    disabled_is_unused: bool = True,
    unused_groups_count: bool = True,
    hide_defaults: bool = True,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Unbenutzte Objekte. Fabric-Objekte erst, wenn sie auf keinem Gerät genutzt werden."""
    rows_state = rows_state if rows_state is not None else states(db)
    since: dict[tuple[str, str, str], datetime] = {}
    ids = {state.device.id: state.device.name for state in rows_state}
    for row in db.scalars(select(FgUnused).where(FgUnused.device_id.in_(list(ids) or [0]))):
        since[(ids[row.device_id], row.kind, row.name)] = row.since
    found: dict[tuple[str, str], dict[str, Any]] = {}
    present: dict[tuple[str, str], list[str]] = {}
    fabric_names: set[tuple[str, str]] = set()
    for state in rows_state:
        if state.snapshot is None:
            continue
        config = state.config
        for key in UNUSED_KINDS:
            for entry in config.get(key) or []:
                name = str(entry.get("name") or "")
                present.setdefault((key, name), []).append(state.device.name)
                if entry.get("fabric"):
                    fabric_names.add((key, name))
        entries = {
            (key, str(e.get("name") or "")): e
            for key in UNUSED_KINDS
            for e in config.get(key) or []
        }
        for item in unused(
            config,
            disabled_is_unused=disabled_is_unused,
            unused_groups_count=unused_groups_count,
        ):
            entry = entries.get((item.kind, item.name), {})
            if hide_defaults and is_default(item.kind, entry):
                continue
            target = found.setdefault(
                (item.kind, item.name),
                {
                    "kind": item.kind,
                    "name": item.name,
                    "value": object_value(item.kind, entry)
                    if item.kind in KINDS
                    else (f"{entry.get('start') or ''}-{entry.get('end') or ''}"),
                    "devices": [],
                    "reasons": [],
                    "since": None,
                    "fabric": False,
                },
            )
            target["devices"].append(state.device.name)
            if item.reason not in target["reasons"]:
                target["reasons"].append(item.reason)
            seen = since.get((state.device.name, item.kind, item.name))
            if seen is not None and (target["since"] is None or seen > target["since"]):
                # Über alle Geräte zählt der späteste Beginn: erst ab dann überall unbenutzt
                target["since"] = seen
    out = []
    limit = (now or datetime.now(UTC)) - DAY * min_days if min_days else None
    for object_key, entry in found.items():
        if object_key in fabric_names:
            # Fabric-Objekt: nur, wenn es auf keinem Gerät genutzt wird
            if set(entry["devices"]) != set(present.get(object_key, [])):
                continue
            entry["fabric"] = True
        if device and device not in entry["devices"]:
            continue
        if kind and entry["kind"] != kind:
            continue
        if limit is not None and (entry["since"] is None or entry["since"] > limit):
            continue
        out.append(entry)
    out.sort(key=lambda e: (e["kind"], e["name"].lower()))
    return out


# --- Befunde -------------------------------------------------------------------------------


def current_findings(
    db: Session, rows_state: list[DeviceState], options: Options, now: datetime
) -> list[Finding]:
    """Alle Befunde aus den jüngsten Ständen (ohne Rücksicht auf Ausnahmen)."""
    out: list[Finding] = []
    unused_by_device: dict[str, list[str]] = {}
    if options.active("unused_objects"):
        for entry in unused_rows(db, rows_state, min_days=options.unused_days, now=now):
            for name in entry["devices"]:
                unused_by_device.setdefault(name, []).append(f"{entry['kind']}:{entry['name']}")
    for state in rows_state:
        if state.snapshot is None:
            continue
        name = state.device.name
        out.extend(
            policy_findings(
                name,
                state.config,
                state.runtime,
                options,
                now=now,
                observed_since=state.device.created_at,
            )
        )
        extra = unused_finding(name, unused_by_device.get(name, []), options)
        if extra is not None:
            out.append(extra)
    _, sync_states = _sync_rows(rows_state)
    out.extend(object_findings(sync_states, options))
    return out


def exception_active(exception: FgException, finding: Finding, now: datetime) -> bool:
    return exception.digest == finding.digest and (
        exception.expires_at is None or exception.expires_at > now
    )


def track_findings(db: Session, options: Options, now: datetime) -> None:
    """Nach dem Abruf: merkt sich neue Befunde (für „seit“ und die Glocke), vergisst
    verschwundene und entfernt Ausnahmen, deren Frist abgelaufen ist oder deren Gegenstand sich
    geändert hat oder weg ist. Das Entfernen steht im Audit."""
    rows_state = states(db)
    current = {f.key: f for f in current_findings(db, rows_state, options, now)}
    known = {row.key: row for row in db.scalars(select(FgFinding))}
    gone = [key for key in known if key not in current]
    if gone:
        db.execute(delete(FgFinding).where(FgFinding.key.in_(gone)))
    for key, finding in current.items():
        if key not in known:
            db.add(
                FgFinding(
                    key=key[:600],
                    device=finding.device,
                    code=finding.code,
                    severity=finding.severity,
                    first_seen=now,
                )
            )
    evaluated = {state.device.name for state in rows_state if state.snapshot is not None}
    for exception in db.scalars(select(FgException)):
        match = current.get(exception.key)
        reason = None
        if exception.expires_at is not None and exception.expires_at <= now:
            reason = "frist_abgelaufen"
        elif match is not None and match.digest != exception.digest:
            reason = "gegenstand_geaendert"
        elif (
            match is None
            and options.active(exception.code)
            and (exception.device == "" or exception.device in evaluated)
        ):
            reason = "befund_entfallen"
        if reason is None:
            continue
        write_audit(
            db,
            module="monitoring",
            action="fortigate.ausnahme_entfernt",
            object_type="fortigate_ausnahme",
            object_id=str(exception.id),
            details={"grund": reason, "regel": exception.code, "geraet": exception.device},
        )
        db.delete(exception)


def finding_link(finding: Finding) -> str:
    device = quote(finding.device, safe="")
    if finding.policy_id is not None:
        selection = quote(f"{finding.device}:{finding.policy_id}", safe="")
        return (
            f"/monitoring/fortigate/policies?geraet={device}&q=%23{finding.policy_id}"
            f"&auswahl={selection}"
        )
    if finding.code == "unused_objects":
        return f"/monitoring/fortigate/unbenutzt?geraet={device}"
    kind, _, name = finding.subject.partition(":")
    name = quote(name, safe="")
    return f"/monitoring/fortigate/objekte?art={kind}&q={name}&auswahl={name}"


def findings(
    db: Session,
    options: Options,
    now: datetime,
    *,
    severity: str | None = None,
    device: str | None = None,
    code: str | None = None,
    excepted: bool = False,
) -> dict[str, Any]:
    """Befunde für die Seite: Zahlen je Stufe, Liste mit Ausnahmen, Regeln und Geräte."""
    rows_state = states(db)
    items = current_findings(db, rows_state, options, now)
    since = {row.key: row.first_seen for row in db.scalars(select(FgFinding))}
    exceptions = {row.key: row for row in db.scalars(select(FgException))}
    names = {
        user.id: user.display_name
        for user in db.scalars(
            select(User).where(
                User.id.in_([e.created_by for e in exceptions.values() if e.created_by])
            )
        )
    }
    counts = {key: 0 for key in SEVERITIES}
    excepted_count = 0
    rows: list[dict[str, Any]] = []
    for finding in items:
        exception = exceptions.get(finding.key)
        active = exception is not None and exception_active(exception, finding, now)
        if active:
            excepted_count += 1
        else:
            counts[finding.severity] += 1
        if active != excepted:
            continue
        if severity and finding.severity != severity:
            continue
        if device and finding.device != device:
            continue
        if code and finding.code != code:
            continue
        rows.append(
            {
                "key": finding.key,
                "code": finding.code,
                "rule": finding.rule.title,
                "severity": finding.severity,
                "device": finding.device,
                "label": finding.label,
                "detail": finding.detail,
                "policy_id": finding.policy_id,
                "since": since.get(finding.key),
                "link": finding_link(finding),
                "exception": {
                    "id": exception.id,
                    "reason": exception.reason,
                    "expires_at": exception.expires_at,
                    "created_at": exception.created_at,
                    "created_by": names.get(exception.created_by, "")
                    if exception.created_by
                    else "",
                }
                if exception is not None and active
                else None,
            }
        )
    order = {key: index for index, key in enumerate(SEVERITIES)}
    rows.sort(key=lambda r: (order[r["severity"]], r["device"], str(r["label"]).lower()))
    return {
        "rows": rows,
        "counts": counts,
        "excepted": excepted_count,
        "devices": [state.device.name for state in rows_state],
        "rules": [
            {
                "code": rule.code,
                "severity": rule.severity,
                "title": rule.title,
                "description": rule.description,
                "active": options.active(rule.code),
            }
            for rule in RULES
        ],
    }


def finding_by_key(db: Session, options: Options, now: datetime, key: str) -> Finding | None:
    for finding in current_findings(db, states(db), options, now):
        if finding.key == key:
            return finding
    return None
