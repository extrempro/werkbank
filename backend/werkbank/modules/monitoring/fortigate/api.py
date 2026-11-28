"""IT-Monitoring, FortiGate: Übersicht, Policies, Adressen und Dienste (nur lesend)."""

import csv
import io
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import select

from werkbank.core.admin_settings import client_ip
from werkbank.core.audit import write_audit
from werkbank.core.audit_api import safe_cell
from werkbank.core.deps import DbDep, SettingsDep, require_roles
from werkbank.core.models import Job, JobStatus
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.monitoring.fortigate import analysis, views
from werkbank.modules.monitoring.fortigate.collector import FORTIGATE_JOB
from werkbank.modules.monitoring.fortigate.models import FgDevice
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


def _time(value: int | None) -> datetime | None:
    return datetime.fromtimestamp(value, UTC) if value else None


@router.get("/overview")
def get_overview(user: ReaderUser, db: DbDep) -> dict[str, Any]:
    """Kennzahlen und Geräte mit HA, Version und letztem Abruf."""
    data = views.overview(db, now_utc())
    data["configured"] = db.scalar(select(FgDevice.id).limit(1)) is not None
    data["can_refresh"] = user.has_any_role(Role.FORTIGATE_EDITOR)
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
    data["rows"] = [_policy_out(row) for row in data["rows"]]
    data["query"] = _query_kind(query)
    return data


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
) -> dict[str, Any]:
    """Adressen, Gruppen, Dienste und VIPs aller Geräte, nach Namen zusammengefasst."""
    query = analysis.parse_query(q)
    data = views.objects(db, kind, query, device)
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
) -> Response:
    data = views.objects(db, kind, analysis.parse_query(q), device)
    lines: list[list[Any]] = [["Name", "Wert", "Geräte", "Fabric-Objekt", "Verwendungen"]]
    for row in data["rows"]:
        lines.append(
            [
                row["name"],
                row["value"],
                ", ".join(d["device"] for d in row["devices"]),
                ", ".join(d["device"] for d in row["devices"] if d["fabric"]),
                row["uses"],
            ]
        )
    _audit_export(db, request, user, kind, len(lines) - 1)
    return _csv(lines, f"fortigate-{kind}.csv")


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
