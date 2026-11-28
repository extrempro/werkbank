"""IT-Monitoring, NetBird: Übersicht und Peers (nur lesend).

Sichtbar nur mit `NetBird.Reader`; die Admin-Gruppe bekommt keinen automatischen Zugriff, weil
die Peer-Liste personenbezogen ist. „Jetzt abrufen“ und der CSV-Export brauchen zusätzlich
`Werkbank.Admin`.
"""

import csv
import io
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update

from werkbank.core.admin_settings import client_ip
from werkbank.core.audit import write_audit
from werkbank.core.audit_api import safe_cell
from werkbank.core.deps import DbDep, SettingsDep, require_roles
from werkbank.core.models import Job, JobStatus
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.monitoring.netbird import views
from werkbank.modules.monitoring.netbird.collector import NETBIRD_JOB
from werkbank.modules.monitoring.netbird.models import NbChange
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


ChangeStatus = Annotated[Literal["offen", "bestaetigt", "automatisch"] | None, Query()]
ChangeKind = Annotated[Literal["group", "policy"] | None, Query()]
ChangeAction = Annotated[
    Literal["angelegt", "geaendert", "geloescht", "mitglieder"] | None, Query()
]
ChangeInitiator = Annotated[Literal["person", "scim", "unbekannt"] | None, Query()]


@router.get("/changes")
def get_changes(
    user: ReaderUser,
    db: DbDep,
    state: ChangeStatus = None,
    kind: ChangeKind = None,
    action: ChangeAction = None,
    initiator: ChangeInitiator = None,
    days: Annotated[int, Query(ge=0, le=90)] = 30,
    q: TextQuery = "",
    object_id: Annotated[str, Query(max_length=64)] = "",
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=2000)] = 50,
) -> dict[str, Any]:
    """Erkannte Änderungen an überwachten Gruppen und Policies."""
    if days not in views.CHANGE_DAYS:
        raise HTTPException(status_code=422, detail="Zeitraum: 7, 30, 90 Tage oder alles (0).")
    data = views.changes_page(
        db,
        now_utc(),
        status=state or "",
        kind=kind or "",
        action=action or "",
        initiator=initiator or "",
        days=days,
        query=q.strip(),
        object_id=object_id,
        offset=offset,
        limit=limit,
    )
    data["can_confirm"] = user.has_any_role(Role.NETBIRD_APPROVER)
    data["can_configure"] = user.has_any_role(Role.WERKBANK_ADMIN)
    return data


def _change(db: DbDep, change_id: int) -> NbChange:
    change = db.get(NbChange, change_id)
    if change is None:
        raise HTTPException(status_code=404, detail="Diese Änderung gibt es nicht.")
    return change


@router.get("/changes/{change_id}")
def get_change(user: ReaderUser, db: DbDep, change_id: int) -> dict[str, Any]:
    change = _change(db, change_id)
    related = db.scalar(
        select(func.count()).select_from(NbChange).where(NbChange.object_id == change.object_id)
    )
    data = views.change_detail(change, related or 0)
    data["can_confirm"] = user.has_any_role(Role.NETBIRD_APPROVER)
    return data


def _approver(user: ReaderUser) -> CurrentUser:
    """Bestätigen nur mit NetBird.Approver (zusätzlich zu NetBird.Reader)."""
    if not user.has_any_role(Role.NETBIRD_APPROVER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Nur mit dem Recht „NetBird: Bestätigen“."
        )
    return user


ApproverUser = Annotated[CurrentUser, Depends(_approver)]


class ConfirmIn(BaseModel):
    comment: str = Field(default="", max_length=500)


def _confirm(db: DbDep, change: NbChange, user: CurrentUser, comment: str) -> None:
    from werkbank.core.models import Notification, User
    from werkbank.modules.monitoring.netbird.notifications import change_link

    person = db.get(User, user.user_id)
    now = now_utc()
    change.status = "bestaetigt"
    change.confirmed_by = user.user_id
    change.confirmed_by_name = (person.display_name if person else "")[:200]
    change.confirmed_at = now
    change.comment = comment.strip()[:500]
    # Meldungen zur Änderung in der Glocke gelten als erledigt
    db.execute(
        update(Notification)
        .where(Notification.link == change_link(change.id), Notification.read_at.is_(None))
        .values(read_at=now)
    )


@router.post("/changes/{change_id}/confirm")
def confirm_change(
    request: Request, body: ConfirmIn, user: ApproverUser, db: DbDep, change_id: int
) -> dict[str, Any]:
    """Bestätigen mit freiwilligem Kommentar; danach nicht mehr änderbar."""
    change = _change(db, change_id)
    if change.status != "offen":
        raise HTTPException(
            status_code=409, detail="Die Änderung ist schon bestätigt und lässt sich nicht ändern."
        )
    _confirm(db, change, user, body.comment)
    write_audit(
        db,
        module=MODULE,
        action="netbird.aenderung_bestaetigt",
        user_id=user.user_id,
        object_type="netbird_aenderung",
        object_id=str(change.id),
        ip=client_ip(request),
        details={"objekt": change.object_name, "kommentar": bool(change.comment)},
    )
    db.commit()
    return views.change_detail(change, 0)


class ConfirmAllOut(BaseModel):
    confirmed: int


@router.post("/changes/confirm-all")
def confirm_all(request: Request, user: ApproverUser, db: DbDep) -> ConfirmAllOut:
    """Alle offenen Änderungen bestätigen (ohne Kommentar)."""
    changes = list(db.scalars(select(NbChange).where(NbChange.status == "offen")))
    for change in changes:
        _confirm(db, change, user, "")
    write_audit(
        db,
        module=MODULE,
        action="netbird.aenderungen_alle_bestaetigt",
        user_id=user.user_id,
        object_type="netbird_aenderung",
        object_id="alle",
        ip=client_ip(request),
        details={"anzahl": len(changes)},
    )
    db.commit()
    return ConfirmAllOut(confirmed=len(changes))


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
        WATCH,
        changed_transport,
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
    data["watch"] = {**WATCH, **(data.get("watch") or {})}
    set_setting(db, NETBIRD_KEY, data, user.user_id)
    db.commit()
    collect(db, settings, transport=sample_transport, checker=sample_checker(), lapi=sample_lapi)
    # Gruppen & Policies: zweiter Stand mit Änderungen, alte Beispieländerungen vorher weg
    db.execute(delete(NbChange))
    db.commit()
    collect(db, settings, transport=changed_transport, checker=sample_checker(), lapi=sample_lapi)
