"""IT-Monitoring, NetBird: Übersicht und Peers (nur lesend).

Sichtbar nur mit `NetBird.Reader`; die Admin-Gruppe bekommt keinen automatischen Zugriff, weil
die Peer-Liste personenbezogen ist. „Jetzt abrufen“ und der CSV-Export brauchen zusätzlich
`Werkbank.Admin`.
"""

import csv
import io
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select

from werkbank.core.admin_settings import client_ip
from werkbank.core.audit import write_audit
from werkbank.core.audit_api import safe_cell
from werkbank.core.deps import DbDep, SettingsDep, require_roles
from werkbank.core.models import Job, JobStatus
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.monitoring.netbird import views
from werkbank.modules.monitoring.netbird.collector import NETBIRD_JOB
from werkbank.worker.jobs import enqueue

router = APIRouter(prefix="/api/monitoring/netbird")
MODULE = "monitoring"

ReaderUser = Annotated[CurrentUser, Depends(require_roles(Role.NETBIRD_READER))]
TextQuery = Annotated[str, Query(max_length=200)]
StatusQuery = Annotated[Literal["verbunden", "offline", "freigabe", "abgelaufen"] | None, Query()]


def _admin(user: CurrentUser) -> None:
    if not user.has_any_role(Role.WERKBANK_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Nur für System-Admins.")


@router.get("/overview")
def get_overview(
    user: ReaderUser, db: DbDep, days: Annotated[int, Query(ge=1, le=90)] = 14
) -> dict[str, Any]:
    data = views.overview(db, now_utc(), days)
    data["can_refresh"] = user.has_any_role(Role.WERKBANK_ADMIN)
    return data


@router.get("/networks")
def get_networks(user: ReaderUser, db: DbDep) -> dict[str, Any]:
    """Server-Komponenten, Netze mit Routing-Peers und Dienste am Reverse Proxy."""
    return views.networks_page(db, now_utc())


@router.get("/policies")
def get_policies(user: ReaderUser, db: DbDep) -> dict[str, Any]:
    """Prüfung der Richtlinien, Richtlinien und Setup-Keys (ohne Schlüssel)."""
    return views.policies_page(db, now_utc())


EventKind = Annotated[
    Literal["peer", "policy", "group", "setupkey", "user", "network", "service", "account", "other"]
    | None,
    Query(),
]


@router.get("/events")
def get_events(
    user: ReaderUser,
    db: DbDep,
    kind: EventKind = None,
    days: Annotated[int, Query(ge=1, le=90)] = 7,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict[str, Any]:
    if days not in views.EVENT_DAYS:
        raise HTTPException(status_code=422, detail="Zeitraum: 7, 30 oder 90 Tage.")
    return views.events(db, now_utc(), kind=kind or "", days=days, offset=offset, limit=limit)


@router.get("/peers")
def get_peers(
    user: ReaderUser,
    db: DbDep,
    q: TextQuery = "",
    state: StatusQuery = None,
    group: Annotated[str, Query(max_length=64)] = "",
    os: Annotated[str, Query(max_length=40)] = "",
    hinted: bool = False,
) -> dict[str, Any]:
    data = views.peers(
        db, now_utc(), query=q, state_filter=state or "", group=group, family=os, hinted=hinted
    )
    data["can_export"] = user.has_any_role(Role.WERKBANK_ADMIN)
    return data


@router.get("/peers/{peer_id}")
def get_peer(user: ReaderUser, db: DbDep, peer_id: str) -> dict[str, Any]:
    if len(peer_id) > 64:
        raise HTTPException(status_code=404, detail="Diesen Peer gibt es nicht.")
    data = views.peer_detail(db, now_utc(), peer_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Diesen Peer gibt es nicht.")
    data["asset"] = None
    if user.has_any_role(Role.INVENTORY_READER, Role.INVENTORY_EDITOR) and data["hostname"]:
        # Nur ein Hinweis über den Hostnamen, keine feste Zuordnung
        from werkbank.modules.inventory.models import InventoryHardware

        found = db.scalars(
            select(InventoryHardware)
            .where(func.lower(InventoryHardware.hostname) == data["hostname"].casefold())
            .limit(1)
        ).first()
        if found is not None:
            data["asset"] = {
                "id": found.id,
                "name": found.name,
                "inventory_no": found.inventory_no or "",
            }
    return data


@router.get("/peers.csv")
def export_peers(request: Request, user: ReaderUser, db: DbDep) -> Response:
    """CSV der Peers, nur für System-Admins (personenbezogen), im Audit."""
    _admin(user)
    data = views.peers(db, now_utc())
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(
        ["Name", "Person", "Status", "NetBird-IP", "System", "Version", "Zuletzt gesehen"]
    )
    for row in data["rows"]:
        seen = row["last_seen"].strftime("%d.%m.%Y %H:%M") if row["last_seen"] else ""
        writer.writerow(
            [
                safe_cell(str(value))
                for value in (
                    row["name"],
                    row["person"],
                    row["status_label"],
                    row["ip"],
                    row["os"],
                    row["version"],
                    seen,
                )
            ]
        )
    write_audit(
        db,
        module=MODULE,
        action="netbird.export",
        user_id=user.user_id,
        object_type="export",
        object_id="peers",
        ip=client_ip(request),
        details={"zeilen": len(data["rows"])},
    )
    db.commit()
    return Response(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="netbird-peers.csv"',
            "Cache-Control": "no-store",
        },
    )


class RefreshOut(BaseModel):
    scheduled: bool


@router.post("/refresh")
def refresh(request: Request, user: ReaderUser, db: DbDep) -> RefreshOut:
    """Gleich abrufen: nur System-Admins, die auch NetBird.Reader haben."""
    _admin(user)
    now = now_utc()
    planned = db.scalars(
        select(Job)
        .where(Job.type == NETBIRD_JOB, Job.status == JobStatus.PLANNED)
        .order_by(Job.scheduled_at)
        .limit(1)
    ).first()
    if planned is None:
        enqueue(db, NETBIRD_JOB, payload={}, scheduled_at=now)
    else:
        planned.scheduled_at = min(planned.scheduled_at, now)
    write_audit(
        db,
        module=MODULE,
        action="netbird.abruf_angestossen",
        user_id=user.user_id,
        object_type="auftrag",
        object_id=NETBIRD_JOB,
        ip=client_ip(request),
    )
    db.commit()
    return RefreshOut(scheduled=True)


@router.post("/test/sample", status_code=status.HTTP_204_NO_CONTENT)
def load_sample(
    user: Annotated[CurrentUser, Depends(require_roles(Role.WERKBANK_ADMIN))],
    db: DbDep,
    settings: SettingsDep,
) -> None:
    """Nur für automatische Tests: erfundene Daten einrichten und abrufen. In Produktion 404."""
    if not settings.enable_test_login or settings.environment not in ("test", "development"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    from werkbank.core.app_settings import NETBIRD_KEY, encrypt_secret, get_setting, set_setting
    from werkbank.modules.monitoring.netbird.collector import collect
    from werkbank.modules.monitoring.netbird.sample import (
        sample_checker,
        sample_lapi,
        sample_transport,
    )

    current = get_setting(db, NETBIRD_KEY)
    data = dict(current) if isinstance(current, dict) else {}
    data["url"] = data.get("url") or "https://netbird.example.com"
    data["token_encrypted"] = encrypt_secret(settings, "beispiel-token")
    data["crowdsec_url"] = data.get("crowdsec_url") or "http://crowdsec.example.com:8080"
    data["crowdsec_key_encrypted"] = encrypt_secret(settings, "beispiel-bouncer")
    set_setting(db, NETBIRD_KEY, data, user.user_id)
    db.commit()
    collect(db, settings, transport=sample_transport, checker=sample_checker(), lapi=sample_lapi)
