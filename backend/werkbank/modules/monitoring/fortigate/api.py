"""IT-Monitoring, FortiGate: Übersicht, Policies, Adressen und Dienste (nur lesend)."""

import csv
import io
import ipaddress
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from werkbank.core.admin_settings import client_ip
from werkbank.core.audit import write_audit
from werkbank.core.audit_api import safe_cell
from werkbank.core.deps import DbDep, SettingsDep, require_roles
from werkbank.core.models import Job, JobStatus
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.monitoring.fortigate import analysis, path, views
from werkbank.modules.monitoring.fortigate.admin import get_fortigate_transport
from werkbank.modules.monitoring.fortigate.client import FortiGateClient, FortiGateError, Transport
from werkbank.modules.monitoring.fortigate.collector import FORTIGATE_JOB
from werkbank.modules.monitoring.fortigate.config import device_config, load_options, load_settings
from werkbank.modules.monitoring.fortigate.findings import RULES_BY_CODE, SEVERITY_LABELS
from werkbank.modules.monitoring.fortigate.models import FgDevice, FgException
from werkbank.worker.jobs import enqueue

router = APIRouter(prefix="/api/monitoring/fortigate")
MODULE = "monitoring"

ReaderUser = Annotated[CurrentUser, Depends(require_roles(Role.FORTIGATE_READER))]
EditorUser = Annotated[CurrentUser, Depends(require_roles(Role.FORTIGATE_EDITOR))]

SearchQuery = Annotated[str, Query(max_length=200)]
NameQuery = Annotated[str | None, Query(max_length=200)]
KindQuery = Annotated[
    Literal["addresses", "address_groups", "services", "service_groups", "vips"], Query()
]
SyncQuery = Annotated[
    Literal["synchronisiert", "abweichend", "lokal", "lokal_mehrfach"] | None, Query()
]
UnusedKindQuery = Annotated[
    Literal["addresses", "address_groups", "services", "service_groups", "vips", "ippools"] | None,
    Query(),
]
DaysQuery = Annotated[int | None, Query(ge=1, le=3650)]
DAYS = (30, 90, 365)


def _time(value: int | None) -> datetime | None:
    return datetime.fromtimestamp(value, UTC) if value else None


@router.get("/overview")
def get_overview(user: ReaderUser, db: DbDep) -> dict[str, Any]:
    """Kennzahlen und Geräte mit HA, Version und letztem Abruf."""
    data = views.overview(db, now_utc())
    data["configured"] = db.scalar(select(FgDevice.id).limit(1)) is not None
    data["can_refresh"] = user.has_any_role(Role.FORTIGATE_EDITOR)
    found = views.findings(db, load_options(db), now_utc())
    data["findings"] = {**found["counts"], "excepted": found["excepted"]}
    return data


def _policy_out(row: dict[str, Any]) -> dict[str, Any]:
    return {
        **row,
        "last_used": _time(row.get("last_used")),
        "first_used": _time(row.get("first_used")),
    }


@router.get("/policies")
def get_policies(
    user: ReaderUser,
    db: DbDep,
    q: SearchQuery = "",
    device: NameQuery = None,
    pair: Annotated[str | None, Query(max_length=600)] = None,
    action: NameQuery = None,
    state: NameQuery = None,
) -> dict[str, Any]:
    """Policies aller Geräte in FortiOS-Reihenfolge, gefiltert und durchsucht."""
    query = analysis.parse_query(q)
    data = views.policies(db, query, device, pair, action, state)
    by_policy = _findings_by_policy(db)
    data["rows"] = [
        {**_policy_out(row), "findings": by_policy.get(f"{row['device']}:{row['id']}", [])}
        for row in data["rows"]
    ]
    data["query"] = _query_kind(query)
    return data


def _findings_by_policy(db: DbDep) -> dict[str, list[dict[str, Any]]]:
    """Befunde (ohne Ausnahmen) je „Gerät:Policy-ID“."""
    by_policy: dict[str, list[dict[str, Any]]] = {}
    for item in views.findings(db, load_options(db), now_utc())["rows"]:
        if item["policy_id"] is not None:
            by_policy.setdefault(f"{item['device']}:{item['policy_id']}", []).append(
                {"code": item["code"], "rule": item["rule"], "severity": item["severity"]}
            )
    return by_policy


def _query_kind(query: analysis.Query) -> str:
    if query.empty:
        return ""
    if query.ip is not None:
        return "ip"
    if query.port is not None:
        return "port"
    if query.policy_id is not None:
        return "id"
    return "text"


def _csv(rows: list[list[Any]], filename: str) -> Response:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    for row in rows:
        writer.writerow([safe_cell(value) if isinstance(value, str) else value for value in row])
    return Response(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


def _audit_export(db: DbDep, request: Request, user: CurrentUser, what: str, count: int) -> None:
    write_audit(
        db,
        module=MODULE,
        action="fortigate.export",
        user_id=user.user_id,
        object_type="export",
        object_id=what,
        ip=client_ip(request),
        details={"zeilen": count},
    )
    db.commit()


@router.get("/policies.csv")
def export_policies(
    request: Request,
    user: ReaderUser,
    db: DbDep,
    q: SearchQuery = "",
    device: NameQuery = None,
    pair: Annotated[str | None, Query(max_length=600)] = None,
    action: NameQuery = None,
    state: NameQuery = None,
) -> Response:
    data = views.policies(db, analysis.parse_query(q), device, pair, action, state)
    lines: list[list[Any]] = [
        [
            "Gerät",
            "Position",
            "ID",
            "Name",
            "Aktiv",
            "Quell-Interface",
            "Ziel-Interface",
            "Quelle",
            "Ziel",
            "Dienst",
            "Aktion",
            "NAT",
            "Log",
            "Profile",
            "Treffer",
            "Zuletzt genutzt",
        ]
    ]
    for row in data["rows"]:
        last = _time(row.get("last_used"))
        lines.append(
            [
                row["device"],
                row["position"],
                row["id"],
                row["name"],
                "ja" if row["status"] else "nein",
                ", ".join(row["srcintf"]),
                ", ".join(row["dstintf"]),
                ("nicht " if row["srcaddr_negate"] else "") + ", ".join(row["srcaddr"]),
                ("nicht " if row["dstaddr_negate"] else "")
                + ", ".join(row["dstaddr"] + row["internet_service"]),
                ("nicht " if row["service_negate"] else "") + ", ".join(row["service"]),
                row["action"],
                row["nat"],
                row["log"],
                ", ".join(f"{k}: {v}" for k, v in row["profiles"].items()),
                "" if row["hits"] is None else row["hits"],
                last.strftime("%d.%m.%Y %H:%M") if last else "",
            ]
        )
    _audit_export(db, request, user, "policies", len(lines) - 1)
    return _csv(lines, "fortigate-policies.csv")


@router.get("/objects")
def get_objects(
    user: ReaderUser,
    db: DbDep,
    kind: KindQuery = "addresses",
    q: SearchQuery = "",
    device: NameQuery = None,
    sync: SyncQuery = None,
) -> dict[str, Any]:
    """Adressen, Gruppen, Dienste und VIPs aller Geräte, nach Namen zusammengefasst."""
    query = analysis.parse_query(q)
    data = views.objects(db, kind, query, device, sync)
    data["sync_bar"] = views.sync_bar(views.states(db))
    data["query"] = _query_kind(query)
    return data


@router.get("/objects.csv")
def export_objects(
    request: Request,
    user: ReaderUser,
    db: DbDep,
    kind: KindQuery = "addresses",
    q: SearchQuery = "",
    device: NameQuery = None,
    sync: SyncQuery = None,
) -> Response:
    data = views.objects(db, kind, analysis.parse_query(q), device, sync)
    lines: list[list[Any]] = [
        ["Name", "Wert", "Geräte", "Fabric-Objekt", "Fabric-Sync", "Verwendungen"]
    ]
    for row in data["rows"]:
        lines.append(
            [
                row["name"],
                row["value"],
                ", ".join(d["device"] for d in row["devices"]),
                ", ".join(d["device"] for d in row["devices"] if d["fabric"]),
                row["sync"]["label"] if row.get("sync") else "",
                row["uses"],
            ]
        )
    _audit_export(db, request, user, kind, len(lines) - 1)
    return _csv(lines, f"fortigate-{kind}.csv")


UNUSED_LABELS = {
    "addresses": "Adresse",
    "address_groups": "Adressgruppe",
    "services": "Dienst",
    "service_groups": "Dienstgruppe",
    "vips": "VIP",
    "ippools": "IP-Pool",
}


def _unused(
    db: DbDep,
    device: str | None,
    kind: str | None,
    days: int | None,
    disabled: bool,
    groups: bool,
    defaults: bool,
) -> list[dict[str, Any]]:
    if days is not None and days not in DAYS:
        raise HTTPException(status_code=422, detail="Erlaubt sind 30, 90 oder 365 Tage.")
    return views.unused_rows(
        db,
        device=device,
        kind=kind,
        min_days=days,
        disabled_is_unused=disabled,
        unused_groups_count=groups,
        hide_defaults=not defaults,
    )


@router.get("/unused")
def get_unused(
    user: ReaderUser,
    db: DbDep,
    device: NameQuery = None,
    kind: UnusedKindQuery = None,
    days: DaysQuery = None,
    disabled: bool = True,
    groups: bool = True,
    defaults: bool = False,
) -> dict[str, Any]:
    """Unbenutzte Objekte. `disabled`/`groups`: Verweise nur aus deaktivierten Einträgen bzw.
    nur aus unbenutzten Gruppen zählen als unbenutzt. `defaults`: Standardobjekte zeigen."""
    rows = _unused(db, device, kind, days, disabled, groups, defaults)
    counts = {key: 0 for key in UNUSED_LABELS}
    for row in rows:
        counts[row["kind"]] += 1
    return {
        "rows": rows,
        "counts": counts,
        "devices": [state.device.name for state in views.states(db)],
    }


def _unused_lines(rows: list[dict[str, Any]]) -> list[list[Any]]:
    lines: list[list[Any]] = [
        ["Art", "Name", "Wert", "Geräte", "Fabric-Objekt", "Unbenutzt seit", "Grund"]
    ]
    for row in rows:
        since = row.get("since")
        lines.append(
            [
                UNUSED_LABELS.get(row["kind"], row["kind"]),
                row["name"],
                row["value"],
                ", ".join(row["devices"]),
                "ja" if row["fabric"] else "nein",
                since.strftime("%d.%m.%Y") if since else "",
                "; ".join(row["reasons"]),
            ]
        )
    return lines


@router.get("/unused.csv")
def export_unused(
    request: Request,
    user: ReaderUser,
    db: DbDep,
    device: NameQuery = None,
    kind: UnusedKindQuery = None,
    days: DaysQuery = None,
    disabled: bool = True,
    groups: bool = True,
    defaults: bool = False,
) -> Response:
    rows = _unused(db, device, kind, days, disabled, groups, defaults)
    _audit_export(db, request, user, "unbenutzt", len(rows))
    return _csv(_unused_lines(rows), "fortigate-unbenutzte-objekte.csv")


class CleanupItem(BaseModel):
    kind: Literal["addresses", "address_groups", "services", "service_groups", "vips", "ippools"]
    name: str = Field(min_length=1, max_length=255)


class CleanupIn(BaseModel):
    items: list[CleanupItem] = Field(min_length=1, max_length=2000)
    disabled: bool = True
    groups: bool = True
    defaults: bool = False


@router.post("/unused/cleanup.csv")
def cleanup_list(request: Request, body: CleanupIn, user: ReaderUser, db: DbDep) -> Response:
    """Aufräumliste der gewählten unbenutzten Objekte als CSV. Gelöscht wird nichts."""
    wanted = {(item.kind, item.name) for item in body.items}
    rows = [
        row
        for row in _unused(db, None, None, None, body.disabled, body.groups, body.defaults)
        if (row["kind"], row["name"]) in wanted
    ]
    _audit_export(db, request, user, "aufraeumliste", len(rows))
    return _csv(_unused_lines(rows), "fortigate-aufraeumliste.csv")


# --- Befunde und Ausnahmen -----------------------------------------------------------------

SeverityQuery = Annotated[Literal["hoch", "mittel", "hinweis"] | None, Query()]
CodeQuery = Annotated[str | None, Query(max_length=40, pattern=r"^[a-z_]*$")]


def _findings(
    db: DbDep,
    severity: str | None,
    device: str | None,
    code: str | None,
    excepted: bool,
) -> dict[str, Any]:
    if code and code not in RULES_BY_CODE:
        raise HTTPException(status_code=422, detail="Diese Regel gibt es nicht.")
    return views.findings(
        db,
        load_options(db),
        now_utc(),
        severity=severity,
        device=device,
        code=code or None,
        excepted=excepted,
    )


@router.get("/findings")
def get_findings(
    user: ReaderUser,
    db: DbDep,
    severity: SeverityQuery = None,
    device: NameQuery = None,
    code: CodeQuery = None,
    excepted: bool = False,
) -> dict[str, Any]:
    """Befunde nach Stufe; mit `excepted` die bewusst hingenommenen (Ausnahmen)."""
    data = _findings(db, severity, device, code, excepted)
    data["can_except"] = user.has_any_role(Role.FORTIGATE_EDITOR)
    return data


@router.get("/findings.csv")
def export_findings(
    request: Request,
    user: ReaderUser,
    db: DbDep,
    severity: SeverityQuery = None,
    device: NameQuery = None,
    code: CodeQuery = None,
    excepted: bool = False,
) -> Response:
    rows = _findings(db, severity, device, code, excepted)["rows"]
    lines: list[list[Any]] = [
        ["Stufe", "Regel", "Gerät", "Gegenstand", "Hinweis", "Seit", "Ausnahme", "Ausnahme bis"]
    ]
    for row in rows:
        exception = row["exception"] or {}
        lines.append(
            [
                SEVERITY_LABELS[row["severity"]],
                row["rule"],
                row["device"] or "alle Geräte",
                row["label"],
                row["detail"],
                row["since"].strftime("%d.%m.%Y") if row["since"] else "",
                exception.get("reason", ""),
                exception["expires_at"].strftime("%d.%m.%Y")
                if exception.get("expires_at")
                else ("unbegrenzt" if exception else ""),
            ]
        )
    _audit_export(db, request, user, "befunde", len(rows))
    return _csv(lines, "fortigate-befunde.csv")


class ExceptionIn(BaseModel):
    key: str = Field(min_length=3, max_length=600)
    reason: str = Field(min_length=3, max_length=500)
    # 6 oder 12 Monate; 0: unbegrenzt
    months: Literal[0, 6, 12] = 12


class ExceptionOut(BaseModel):
    id: int
    expires_at: datetime | None


@router.post("/exceptions", status_code=status.HTTP_201_CREATED)
def create_exception(
    request: Request, body: ExceptionIn, user: EditorUser, db: DbDep
) -> ExceptionOut:
    """Befund als Ausnahme hinnehmen. Gilt bis zur Frist oder bis sich der Gegenstand ändert."""
    now = now_utc()
    finding = views.finding_by_key(db, load_options(db), now, body.key)
    if finding is None:
        raise HTTPException(
            status_code=404, detail="Den Befund gibt es nicht mehr. Bitte lade die Seite neu."
        )
    reason = " ".join(body.reason.split())
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="Bitte gib eine Begründung an.")
    expires = now + timedelta(days=round(body.months * 30.44)) if body.months else None
    existing = db.scalars(select(FgException).where(FgException.key == finding.key)).first()
    if existing is not None:
        db.delete(existing)
        db.flush()
    exception = FgException(
        key=finding.key,
        device=finding.device,
        code=finding.code,
        subject=finding.subject[:500],
        label=finding.label[:300],
        digest=finding.digest,
        reason=reason,
        expires_at=expires,
        created_by=user.user_id,
    )
    db.add(exception)
    db.flush()
    write_audit(
        db,
        module=MODULE,
        action="fortigate.ausnahme_angelegt",
        user_id=user.user_id,
        object_type="fortigate_ausnahme",
        object_id=str(exception.id),
        ip=client_ip(request),
        details={
            "regel": finding.code,
            "geraet": finding.device,
            "gegenstand": finding.subject,
            "monate": body.months or "unbegrenzt",
        },
    )
    db.commit()
    return ExceptionOut(id=exception.id, expires_at=expires)


@router.delete("/exceptions/{exception_id}")
def delete_exception(
    request: Request, exception_id: int, user: EditorUser, db: DbDep
) -> dict[str, int]:
    exception = db.get(FgException, exception_id)
    if exception is None:
        raise HTTPException(status_code=404, detail="Die Ausnahme gibt es nicht mehr.")
    write_audit(
        db,
        module=MODULE,
        action="fortigate.ausnahme_aufgehoben",
        user_id=user.user_id,
        object_type="fortigate_ausnahme",
        object_id=str(exception.id),
        ip=client_ip(request),
        details={"regel": exception.code, "geraet": exception.device},
    )
    db.delete(exception)
    db.commit()
    return {"id": exception_id}


# --- Pfad-Analyse, Internet-Ausgang, Topologie --------------------------------------------

ProtoQuery = Annotated[Literal["tcp", "udp", "icmp"], Query()]
TransportDep = Annotated[Transport, Depends(get_fortigate_transport)]


def _ip(value: str, label: str) -> ipaddress.IPv4Address:
    try:
        return ipaddress.IPv4Address(value.strip())
    except ValueError as error:
        raise HTTPException(
            status_code=422, detail=f"Bitte gib als {label} eine IPv4-Adresse an."
        ) from error


def _lookup(
    db: DbDep, settings: SettingsDep, transport: Transport, hop: path.Hop, flow: path.Flow
) -> dict[str, Any]:
    """Gegenprüfung mit dem Policy-Lookup des Geräts (nur lesend, live)."""
    device = db.scalars(select(FgDevice).where(FgDevice.name == hop.device)).first()
    config = (
        device_config(device, settings, load_settings(db).ca_pem) if device is not None else None
    )
    if config is None:
        return {"ok": False, "text": "Kein Zugang zum Gerät."}
    params = {
        "sourceip": hop.src,
        "dest": str(flow.dst),
        "protocol": str(path.PROTOCOLS[flow.proto]),
        "srcintf": hop.ingress,
    }
    if flow.proto == "icmp":
        params |= {"icmptype": "8", "icmpcode": "0"}
    else:
        params |= {"sourceport": "50000", "destport": str(flow.port or 0)}
    try:
        answer = FortiGateClient(config, transport).monitor("firewall/policy-lookup", **params)
    except FortiGateError as error:
        return {"ok": False, "text": f"Gegenprüfung nicht möglich: {error}"}
    result = (
        answer.results[0] if isinstance(answer.results, list) and answer.results else answer.results
    )
    found = result.get("policy_id") if isinstance(result, dict) else None
    expected = hop.policy["id"] if hop.policy else None
    if found == expected:
        return {"ok": True, "text": f"Policy-Lookup bestätigt #{found}"}
    shown = f"#{found}" if found else "keine Policy"
    return {"ok": False, "text": f"Policy-Lookup des Geräts nennt {shown}"}


@router.get("/path")
def get_path(
    user: ReaderUser,
    db: DbDep,
    settings: SettingsDep,
    transport: TransportDep,
    src: Annotated[str, Query(max_length=15)],
    dst: Annotated[str, Query(max_length=15)],
    proto: ProtoQuery = "tcp",
    port: Annotated[int | None, Query(ge=1, le=65535)] = None,
    device: NameQuery = None,
    check: bool = False,
) -> dict[str, Any]:
    """Weg einer Verbindung über die FortiGates, berechnet aus dem letzten Abruf."""
    if proto != "icmp" and port is None:
        raise HTTPException(status_code=422, detail="Bitte gib für TCP und UDP einen Port an.")
    flow = path.Flow(_ip(src, "Quelle"), _ip(dst, "Ziel"), proto, port if proto != "icmp" else None)
    rows_state = views.states(db)
    result = path.trace(views.path_devices(rows_state), flow, start=device or None)
    if result.error:
        raise HTTPException(status_code=422, detail=result.error)
    by_policy = _findings_by_policy(db)
    hops = []
    for hop in result.hops:
        item = asdict(hop)
        item["findings"] = (
            by_policy.get(f"{hop.device}:{hop.policy['id']}", []) if hop.policy else []
        )
        if check and hop.policy:
            hop_flow = path.Flow(
                ipaddress.IPv4Address(hop.src), ipaddress.IPv4Address(hop.dst), proto, flow.port
            )
            item["check"] = _lookup(db, settings, transport, hop, hop_flow)
        hops.append(item)
    return {
        "hops": hops,
        "verdict": result.verdict,
        "allowed": result.allowed,
        "limits": path.LIMITS,
        "devices": [state.device.name for state in rows_state],
        "data_at": max(
            (state.snapshot.seen_at for state in rows_state if state.snapshot), default=None
        ),
    }


@router.get("/exits")
def get_exits(user: ReaderUser, db: DbDep) -> dict[str, Any]:
    """Internet-Ausgang je internem Netz und die Topologie der Geräte."""
    devices = views.path_devices(views.states(db))
    return {
        "exits": path.internet_exits(devices),
        "topology": path.topology(devices),
        "probe": str(path.INTERNET_PROBE),
        "limits": path.LIMITS,
    }


# --- Änderungen ----------------------------------------------------------------------------

ChangeKindQuery = Annotated[
    Literal["policy", "adresse", "gruppe", "dienst", "route", "sonstiges"] | None, Query()
]


@router.get("/changes")
def get_changes(
    user: ReaderUser,
    db: DbDep,
    device: NameQuery = None,
    kind: ChangeKindQuery = None,
    days: Annotated[int, Query(ge=0, le=3650)] = 30,
) -> dict[str, Any]:
    """Änderungen der Konfiguration je Stand; `days=0`: ganze Aufbewahrung."""
    return views.changes(db, now_utc(), device=device, kind=kind, days=days or None)


@router.get("/snapshots")
def get_snapshots(
    user: ReaderUser, db: DbDep, device: Annotated[str, Query(max_length=200)]
) -> dict[str, Any]:
    rows = views.snapshot_list(db, device)
    if rows is None:
        raise HTTPException(status_code=404, detail="Dieses Gerät gibt es nicht.")
    return {"device": device, "snapshots": rows}


@router.get("/compare")
def get_compare(
    user: ReaderUser,
    db: DbDep,
    device: Annotated[str, Query(max_length=200)],
    first: Annotated[int, Query(alias="a")],
    second: Annotated[int, Query(alias="b")],
) -> dict[str, Any]:
    """Zwei Abrufe (Stände) desselben Geräts vergleichen."""
    data = views.compare(db, device, first, second)
    if data is None:
        raise HTTPException(status_code=404, detail="Diese Stände gibt es nicht (mehr).")
    return data


class RefreshOut(BaseModel):
    scheduled_at: datetime


@router.post("/refresh")
def refresh(request: Request, user: EditorUser, db: DbDep) -> RefreshOut:
    """Alle Geräte gleich abrufen. Ist schon ein Abruf eingeplant, wird er vorgezogen."""
    now = now_utc()
    planned = db.scalars(
        select(Job)
        .where(Job.type == FORTIGATE_JOB, Job.status == JobStatus.PLANNED)
        .order_by(Job.scheduled_at)
        .limit(1)
    ).first()
    if planned is None:
        planned = enqueue(db, FORTIGATE_JOB, payload={"force": True}, scheduled_at=now)
    else:
        planned.payload = {**(planned.payload or {}), "force": True}
        planned.scheduled_at = min(planned.scheduled_at, now)
    write_audit(
        db,
        module=MODULE,
        action="fortigate.abruf_angestossen",
        user_id=user.user_id,
        object_type="auftrag",
        object_id=FORTIGATE_JOB,
        ip=client_ip(request),
    )
    db.commit()
    return RefreshOut(scheduled_at=planned.scheduled_at)


@router.post("/test/sample", status_code=status.HTTP_204_NO_CONTENT)
def load_sample(
    user: Annotated[CurrentUser, Depends(require_roles(Role.WERKBANK_ADMIN))],
    db: DbDep,
    settings: SettingsDep,
) -> None:
    """Nur für automatische Tests: erfundene Geräte anlegen und abrufen. In Produktion 404."""
    if not settings.enable_test_login or settings.environment not in ("test", "development"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    from werkbank.core.app_settings import encrypt_secret
    from werkbank.modules.monitoring.fortigate.collector import collect
    from werkbank.modules.monitoring.fortigate.sample import DEVICES, sample_transport

    for position, name in enumerate(DEVICES):
        if db.scalar(select(FgDevice.id).where(FgDevice.name == name)) is None:
            db.add(
                FgDevice(
                    name=name,
                    url=f"https://{name}.example.com",
                    token_encrypted=encrypt_secret(settings, "beispiel-token"),
                    position=position,
                )
            )
    db.commit()
    collect(db, settings, force=True, transport=sample_transport)
