"""API der Quelle Zabbix. Liest nur aus der Werkbank-Datenbank, nie live aus Zabbix."""

import re
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.core.admin_settings import AdminUser, client_ip
from werkbank.core.app_settings import ZABBIX_OPTIONS_KEY, set_setting
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, require_roles
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.inventory.api import add_event
from werkbank.modules.inventory.models import (
    InventoryCity,
    InventoryHardware,
    InventoryKind,
    InventorySite,
)
from werkbank.modules.monitoring.zabbix.client import NEEDED_METHODS
from werkbank.modules.monitoring.zabbix.collector import (
    TASK_FAST,
    TASK_INTERVALS,
    TASK_LABELS,
    TASK_METHODS,
    assign_sites,
    last_runs,
)
from werkbank.modules.monitoring.zabbix.config import (
    TAG_MAX,
    TARGET_DEFAULT,
    TARGET_MAX,
    TARGET_MIN,
    frontend_url,
    load_options,
    stored_connection,
)
from werkbank.modules.monitoring.zabbix.inventory import Match, match_inventory
from werkbank.modules.monitoring.zabbix.models import (
    ZbxGroupSite,
    ZbxHost,
    ZbxHostLink,
    ZbxMaintenance,
    ZbxProblem,
    ZbxProblemHour,
    ZbxRun,
    ZbxStatus,
    ZbxUnmonitored,
)

router = APIRouter(prefix="/api/monitoring/zabbix")
MODULE = "monitoring"

ReaderUser = Annotated[CurrentUser, Depends(require_roles(Role.MONITORING_READER))]
AdminReader = Annotated[CurrentUser, Depends(require_roles(Role.WERKBANK_ADMIN))]


def _require_linker(user: ReaderUser) -> CurrentUser:
    """Verknüpfen mit dem IT-Bestand: Monitoring lesen und den Bestand pflegen."""
    if not user.has_any_role(Role.INVENTORY_EDITOR):
        raise HTTPException(
            status_code=403, detail="Dafür brauchst du zusätzlich die Rolle Bestand.Editor."
        )
    return user


LinkUser = Annotated[CurrentUser, Depends(_require_linker)]

# Probleme, die so lange offen sind, stehen unter „Zu erledigen“
LONG_OPEN = timedelta(days=7)
# Daten älter als das gelten als veraltet
STALE_AFTER = timedelta(minutes=5)
# Abgelaufene Wartungen so lange zeigen
EXPIRED_DAYS = 30
TOKEN_WARN_DAYS = 30
_ID = re.compile(r"^\d{1,20}$")


# ---------- Hilfen ----------


def _site_names(db: Session) -> dict[int, str]:
    rows = db.execute(
        select(InventorySite.id, InventorySite.name, InventoryCity.name).join(
            InventoryCity, InventoryCity.id == InventorySite.city_id
        )
    )
    return {site_id: f"{name} ({city})" for site_id, name, city in rows}


def _link(db: Session, user: CurrentUser, path: str) -> str | None:
    """Sprung nach Zabbix; nur Kennungen aus Ziffern, nie das Token."""
    base = frontend_url(db)
    if base is None or not user.has_any_role(Role.MONITORING_READER):
        return None
    return f"{base}/{path}"


def host_link(db: Session, user: CurrentUser, hostid: str) -> str | None:
    if not _ID.match(hostid):
        return None
    return _link(db, user, f"zabbix.php?action=problem.view&filter_set=1&hostids%5B%5D={hostid}")


def problem_link(db: Session, user: CurrentUser, problem: ZbxProblem) -> str | None:
    if not (_ID.match(problem.triggerid) and _ID.match(problem.eventid)):
        return None
    return _link(db, user, f"tr_events.php?triggerid={problem.triggerid}&eventid={problem.eventid}")


class DeviceRef(BaseModel):
    id: int
    name: str
    inventory_no: str | None
    serial: str
    kind: str


def _devices(db: Session, ids: set[int]) -> dict[int, DeviceRef]:
    if not ids:
        return {}
    rows = db.execute(
        select(
            InventoryHardware.id,
            InventoryHardware.name,
            InventoryHardware.inventory_no,
            InventoryHardware.serial,
            InventoryKind.name,
        )
        .join(InventoryKind, InventoryKind.id == InventoryHardware.kind_id)
        .where(InventoryHardware.id.in_(ids))
    )
    return {
        device_id: DeviceRef(id=device_id, name=name, inventory_no=number, serial=serial, kind=kind)
        for device_id, name, number, serial, kind in rows
    }


class DataState(BaseModel):
    """Stand der Daten, immer sichtbar."""

    configured: bool
    data_at: datetime | None
    stale: bool
    error: str | None
    failures: int
    next_at: datetime | None
    zabbix_url: str | None


def data_state(db: Session, user: CurrentUser) -> DataState:
    configured = stored_connection(db).get("enabled") is True
    ok = db.scalars(
        select(ZbxRun)
        .where(ZbxRun.task == TASK_FAST, ZbxRun.ok.is_(True))
        .order_by(ZbxRun.id.desc())
        .limit(1)
    ).first()
    recent = list(
        db.scalars(
            select(ZbxRun).where(ZbxRun.task == TASK_FAST).order_by(ZbxRun.id.desc()).limit(10)
        )
    )
    failures = 0
    for run in recent:
        if run.ok:
            break
        failures += 1
    last = recent[0] if recent else None
    now = now_utc()
    return DataState(
        configured=configured,
        data_at=ok.started_at if ok else None,
        stale=ok is None or now - ok.started_at > STALE_AFTER,
        error=last.error if last is not None and not last.ok else None,
        failures=failures,
        next_at=(last.started_at + TASK_INTERVALS[TASK_FAST]) if last and configured else None,
        zabbix_url=_link(db, user, "") if configured else None,
    )


class ProblemOut(BaseModel):
    eventid: str
    name: str
    severity: int
    since: datetime
    acknowledged: bool
    suppressed: bool
    tags: list[str]
    hostid: str | None
    host: str | None
    site: str | None
    link: str | None


def _problem_out(
    db: Session,
    user: CurrentUser,
    problem: ZbxProblem,
    hosts: dict[str, ZbxHost],
    sites: dict[int, str],
) -> ProblemOut:
    host = hosts.get(problem.hostid or "")
    return ProblemOut(
        eventid=problem.eventid,
        name=problem.name,
        severity=problem.severity,
        since=problem.since,
        acknowledged=problem.acknowledged,
        suppressed=problem.suppressed,
        tags=[
            f"{tag[0]}: {tag[1]}" if tag[1] else str(tag[0])
            for tag in problem.tags or []
            if isinstance(tag, list) and len(tag) == 2
        ][:6],
        hostid=problem.hostid,
        host=host.name if host else None,
        site=sites.get(host.site_id) if host and host.site_id else None,
        link=problem_link(db, user, problem),
    )


def maintenance_state(item: ZbxMaintenance, running: set[str], now: datetime) -> str:
    """läuft, demnächst, geplant (im Zeitraum, wartet auf ein Zeitfenster) oder abgelaufen."""
    if item.maintenanceid in running:
        return "laeuft"
    if now < item.active_since:
        return "demnaechst"
    if now >= item.active_till:
        return "abgelaufen"
    once = [period for period in item.once or [] if isinstance(period, list) and len(period) == 2]
    if once and not item.recurring:
        if any(int(period[0]) > now.timestamp() for period in once):
            return "demnaechst"
        if all(int(period[1]) <= now.timestamp() for period in once):
            return "abgelaufen"
    return "geplant"


class MaintenanceOut(BaseModel):
    maintenanceid: str
    name: str
    state: str
    with_data: bool
    active_since: datetime
    active_till: datetime
    windows: list[list[datetime]]
    recurring: list[str]
    hosts: int
    host_names: list[str]
    groups: list[str]


def _maintenances(db: Session) -> list[MaintenanceOut]:
    now = now_utc()
    hosts = {row.hostid: row for row in db.scalars(select(ZbxHost))}
    groups: dict[str, str] = {}
    for host in hosts.values():
        for group in host.groups or []:
            if isinstance(group, dict):
                groups[str(group.get("id"))] = str(group.get("name"))
    running = {host.maintenanceid for host in hosts.values() if host.maintenanceid}
    out: list[MaintenanceOut] = []
    for item in db.scalars(select(ZbxMaintenance)):
        state = maintenance_state(item, running, now)
        if state == "abgelaufen" and item.active_till < now - timedelta(days=EXPIRED_DAYS):
            # Zeitraum lange vorbei; einmalige Fenster können früher enden
            continue
        affected = {
            hostid
            for hostid, host in hosts.items()
            if hostid in (item.hostids or [])
            or any(
                isinstance(group, dict) and str(group.get("id")) in (item.groupids or [])
                for group in host.groups or []
            )
        }
        windows = [
            [
                datetime.fromtimestamp(int(period[0]), now.tzinfo),
                datetime.fromtimestamp(int(period[1]), now.tzinfo),
            ]
            for period in item.once or []
            if isinstance(period, list) and len(period) == 2
        ]
        out.append(
            MaintenanceOut(
                maintenanceid=item.maintenanceid,
                name=item.name,
                state=state,
                with_data=item.with_data,
                active_since=item.active_since,
                active_till=item.active_till,
                windows=windows[:20],
                recurring=[str(text) for text in item.recurring or []],
                hosts=len(affected),
                host_names=sorted(hosts[hostid].name for hostid in affected)[:50],
                groups=sorted(groups.get(str(groupid), "") for groupid in item.groupids or [])[:20],
            )
        )
    order = {"laeuft": 0, "demnaechst": 1, "geplant": 2, "abgelaufen": 3}
    out.sort(key=lambda entry: (order[entry.state], entry.active_since))
    return out


# ---------- Übersicht ----------


class KpisOut(BaseModel):
    problems: int
    by_severity: dict[str, int]
    hosts: int
    unreachable: int
    maintenance: int


class HostBrief(BaseModel):
    hostid: str
    name: str
    site: str | None
    since: datetime | None
    link: str | None


class TodoOut(BaseModel):
    long_open: int
    unmonitored: int
    no_inventory: int
    no_serial: int
    certificates: list[ProblemOut]
    certificate_tag: str | None


class HostCell(BaseModel):
    """Ein Host als Kästchen: ok, 1 bis 5 (schlimmster offener Schweregrad), down, wartung."""

    hostid: str
    name: str
    state: str


class SiteHealthOut(BaseModel):
    # None: ohne Standort
    name: str | None
    hosts: int
    unreachable: int
    maintenance: int
    problems: int
    worst: int | None
    cells: list[HostCell]


class HourOut(BaseModel):
    hour: datetime
    # None: kein Abruf in dieser Stunde
    open: int | None
    high: int | None


class OverviewOut(BaseModel):
    state: DataState
    kpis: KpisOut
    problems: list[ProblemOut]
    unreachable: list[HostBrief]
    maintenances: list[MaintenanceOut]
    todo: TodoOut
    sites: list[str]
    site_health: list[SiteHealthOut]
    history: list[HourOut]


# Höchstens so viele Kästchen je Standort; die Zahlen zählen trotzdem alle Hosts
CELLS_MAX = 400


def _cell_state(host: ZbxHost, worst: int | None) -> str:
    if host.in_maintenance:
        return "wartung"
    if host.reachable is False:
        return "down"
    return str(worst) if worst else "ok"


def _site_health(
    monitored: list[ZbxHost], visible: list[ZbxProblem], sites: dict[int, str]
) -> list[SiteHealthOut]:
    """Je Standort Hosts, Ausfälle, Wartung, Probleme und ein Kästchen je Host."""
    worst: dict[str, int] = {}
    count: dict[str, int] = {}
    for problem in visible:
        if problem.hostid:
            worst[problem.hostid] = max(worst.get(problem.hostid, 0), problem.severity)
            count[problem.hostid] = count.get(problem.hostid, 0) + 1
    groups: dict[str | None, list[ZbxHost]] = {}
    for host in monitored:
        name = sites.get(host.site_id) if host.site_id else None
        groups.setdefault(name, []).append(host)
    out: list[SiteHealthOut] = []
    for name in sorted(groups, key=lambda entry: (entry is None, (entry or "").lower())):
        members = sorted(groups[name], key=lambda host: host.name.lower())
        site_worst = max((worst.get(host.hostid, 0) for host in members), default=0)
        out.append(
            SiteHealthOut(
                name=name,
                hosts=len(members),
                unreachable=sum(
                    1 for host in members if host.reachable is False and not host.in_maintenance
                ),
                maintenance=sum(1 for host in members if host.in_maintenance),
                problems=sum(count.get(host.hostid, 0) for host in members),
                worst=site_worst or None,
                cells=[
                    HostCell(
                        hostid=host.hostid,
                        name=host.name,
                        state=_cell_state(host, worst.get(host.hostid)),
                    )
                    for host in members[:CELLS_MAX]
                ],
            )
        )
    return out


def _history(db: Session, now: datetime) -> list[HourOut]:
    """Die letzten 24 Stunden, älteste zuerst; Stunden ohne Abruf bleiben leer."""
    current = now.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    start = current - timedelta(hours=23)
    rows = {
        row.hour.astimezone(UTC): row
        for row in db.scalars(select(ZbxProblemHour).where(ZbxProblemHour.hour >= start))
    }
    out: list[HourOut] = []
    for index in range(24):
        hour = start + timedelta(hours=index)
        row = rows.get(hour)
        out.append(
            HourOut(hour=hour, open=row.open if row else None, high=row.high if row else None)
        )
    return out


@router.get("")
def overview(user: ReaderUser, db: DbDep) -> OverviewOut:
    """Übersicht: Kennzahlen, aktuelle Probleme, nicht erreichbare Hosts, Wartungen."""
    sites = _site_names(db)
    hosts = {row.hostid: row for row in db.scalars(select(ZbxHost))}
    problems = list(
        db.scalars(select(ZbxProblem).order_by(ZbxProblem.severity.desc(), ZbxProblem.since))
    )
    now = now_utc()
    visible = [problem for problem in problems if not problem.suppressed]
    by_severity: dict[str, int] = {}
    for problem in visible:
        by_severity[str(problem.severity)] = by_severity.get(str(problem.severity), 0) + 1
    monitored = [host for host in hosts.values() if host.monitored]
    unreachable = [
        host for host in monitored if host.reachable is False and not host.in_maintenance
    ]
    options = load_options(db)
    matched = match_inventory(db)
    certificates: list[ProblemOut] = []
    if options.certificate_tag is not None:
        tag, value = options.certificate_tag
        certificates = [
            _problem_out(db, user, problem, hosts, sites)
            for problem in visible
            if any(
                isinstance(entry, list)
                and len(entry) == 2
                and entry[0] == tag
                and (not value or entry[1] == value)
                for entry in problem.tags or []
            )
        ]
    return OverviewOut(
        state=data_state(db, user),
        kpis=KpisOut(
            problems=len(visible),
            by_severity=by_severity,
            hosts=len(monitored),
            unreachable=len(unreachable),
            maintenance=sum(1 for host in monitored if host.in_maintenance),
        ),
        problems=[_problem_out(db, user, problem, hosts, sites) for problem in visible][:500],
        unreachable=[
            HostBrief(
                hostid=host.hostid,
                name=host.name,
                site=sites.get(host.site_id) if host.site_id else None,
                since=host.last_seen_at,
                link=host_link(db, user, host.hostid),
            )
            for host in sorted(unreachable, key=lambda entry: entry.name.lower())
        ],
        maintenances=[
            entry for entry in _maintenances(db) if entry.state in ("laeuft", "demnaechst")
        ][:10],
        todo=TodoOut(
            long_open=sum(1 for problem in visible if now - problem.since > LONG_OPEN),
            unmonitored=len(matched.unmonitored),
            no_inventory=sum(1 for gap in matched.gaps.values() if gap == "ohne_bestand"),
            no_serial=sum(1 for gap in matched.gaps.values() if gap == "seriennummer_fehlt"),
            certificates=certificates[:50],
            certificate_tag=(
                f"{options.certificate_tag[0]}: {options.certificate_tag[1]}"
                if options.certificate_tag and options.certificate_tag[1]
                else (options.certificate_tag[0] if options.certificate_tag else None)
            ),
        ),
        sites=sorted({sites[host.site_id] for host in monitored if host.site_id in sites}),
        site_health=_site_health(monitored, visible, sites),
        history=_history(db, now),
    )


# ---------- Hosts ----------


class HostRow(BaseModel):
    hostid: str
    name: str
    host: str
    monitored: bool
    reachable: bool | None
    in_maintenance: bool
    site: str | None
    groups: list[str]
    problems: int
    worst: int | None
    serial: str
    device: DeviceRef | None
    match: str | None
    gap: str | None


def _device_of(matched: Match, devices: dict[int, DeviceRef], hostid: str) -> DeviceRef | None:
    link = matched.linked.get(hostid)
    return devices.get(link[0]) if link else None


@router.get("/hosts")
def hosts_list(user: ReaderUser, db: DbDep) -> list[HostRow]:
    """Alle Hosts mit Zustand und Zahl der offenen Probleme."""
    sites = _site_names(db)
    matched = match_inventory(db)
    devices = _devices(db, {device for device, _ in matched.linked.values()})
    counts: dict[str, list[int]] = {}
    for problem in db.scalars(select(ZbxProblem).where(ZbxProblem.suppressed.is_(False))):
        if problem.hostid:
            counts.setdefault(problem.hostid, []).append(problem.severity)
    return [
        HostRow(
            hostid=host.hostid,
            name=host.name,
            host=host.host,
            monitored=host.monitored,
            reachable=host.reachable,
            in_maintenance=host.in_maintenance,
            site=sites.get(host.site_id) if host.site_id else None,
            groups=[
                str(group.get("name")) for group in host.groups or [] if isinstance(group, dict)
            ],
            problems=len(counts.get(host.hostid, [])),
            worst=max(counts[host.hostid]) if counts.get(host.hostid) else None,
            serial=host.serial,
            device=_device_of(matched, devices, host.hostid),
            match=matched.linked[host.hostid][1] if host.hostid in matched.linked else None,
            gap=matched.gaps.get(host.hostid),
        )
        for host in db.scalars(select(ZbxHost).order_by(ZbxHost.name))
    ]


def _bool_or_none(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


class InterfaceOut(BaseModel):
    type: str
    address: str
    port: str
    main: bool
    available: bool | None


class HostDetail(BaseModel):
    hostid: str
    name: str
    host: str
    monitored: bool
    reachable: bool | None
    in_maintenance: bool
    maintenance: str | None
    site: str | None
    groups: list[str]
    templates: list[str]
    interfaces: list[InterfaceOut]
    serial: str
    model: str
    kind: str
    last_seen_at: datetime | None
    updated_at: datetime
    problems: list[ProblemOut]
    link: str | None
    device: DeviceRef | None
    match: str | None
    gap: str | None
    # Gerät von Hand zuordnen geht nur ohne Seriennummer im Inventar
    can_link: bool


@router.get("/hosts/{hostid}")
def host_detail(hostid: str, user: ReaderUser, db: DbDep) -> HostDetail:
    host = db.get(ZbxHost, hostid) if _ID.match(hostid) else None
    if host is None:
        raise HTTPException(status_code=404, detail="Diesen Host gibt es nicht (mehr).")
    sites = _site_names(db)
    matched = match_inventory(db)
    devices = _devices(db, {device for device, _ in matched.linked.values()})
    maintenance = db.get(ZbxMaintenance, host.maintenanceid) if host.maintenanceid else None
    problems = db.scalars(
        select(ZbxProblem)
        .where(ZbxProblem.hostid == hostid)
        .order_by(ZbxProblem.severity.desc(), ZbxProblem.since)
    )
    return HostDetail(
        hostid=host.hostid,
        name=host.name,
        host=host.host,
        monitored=host.monitored,
        reachable=host.reachable,
        in_maintenance=host.in_maintenance,
        maintenance=maintenance.name if maintenance else None,
        site=sites.get(host.site_id) if host.site_id else None,
        groups=[str(group.get("name")) for group in host.groups or [] if isinstance(group, dict)],
        templates=[str(name) for name in host.templates or []],
        interfaces=[
            InterfaceOut(
                type=str(item.get("type", "")),
                address=str(item.get("address", "")),
                port=str(item.get("port", "")),
                main=item.get("main") is True,
                available=_bool_or_none(item.get("available")),
            )
            for item in host.interfaces or []
            if isinstance(item, dict)
        ],
        serial=host.serial,
        model=host.model,
        kind=host.kind,
        last_seen_at=host.last_seen_at,
        updated_at=host.updated_at,
        problems=[_problem_out(db, user, problem, {hostid: host}, sites) for problem in problems],
        link=host_link(db, user, host.hostid),
        device=_device_of(matched, devices, hostid),
        match=matched.linked[hostid][1] if hostid in matched.linked else None,
        gap=matched.gaps.get(hostid),
        can_link=not host.serial.strip(),
    )


@router.get("/maintenances")
def maintenances(user: ReaderUser, db: DbDep) -> list[MaintenanceOut]:
    """Laufende, kommende und in den letzten 30 Tagen abgelaufene Wartungen."""
    return _maintenances(db)


@router.get("/state")
def state(user: ReaderUser, db: DbDep) -> DataState:
    """Nur der Stand der Daten (für Seiten, die sonst nichts aus Zabbix brauchen)."""
    return data_state(db, user)


# ---------- Verbindung (Admins) ----------


class TaskOut(BaseModel):
    task: str
    label: str
    methods: list[str]
    interval_minutes: int
    last_at: datetime | None
    duration_ms: int | None
    ok: bool | None
    error: str | None
    counts: dict[str, int]


class GroupOut(BaseModel):
    groupid: str
    name: str
    hosts: int
    site_id: int | None
    position: int | None


class SiteOut(BaseModel):
    id: int
    name: str


class ConnectionOut(BaseModel):
    state: DataState
    enabled: bool
    url: str | None
    version: str | None
    checked_at: datetime | None
    role: str | None
    methods: list[str]
    needed: list[str]
    findings: list[str]
    token_expires_at: datetime | None
    token_never_expires: bool
    token_warning: bool
    tasks: list[TaskOut]
    groups: list[GroupOut]
    sites: list[SiteOut]
    certificate_tag: str
    certificate_value: str
    kinds: list[SiteOut]
    kind_ids: list[int]
    target: float


@router.get("/connection")
def connection(user: AdminReader, db: DbDep) -> ConnectionOut:
    """Zustand der Verbindung, Abfragen, Dienstkonto und Zuordnung der Hostgruppen."""
    stored = stored_connection(db)
    status = db.get(ZbxStatus, 1)
    account: dict[str, Any] = status.account if status and isinstance(status.account, dict) else {}
    runs = last_runs(db)
    expires = account.get("token_ablauf")
    expires_at = (
        datetime.fromtimestamp(expires, now_utc().tzinfo)
        if isinstance(expires, int) and expires > 0
        else None
    )
    mapping = {entry.groupid: entry for entry in db.scalars(select(ZbxGroupSite))}
    groups: dict[str, list[str]] = {}
    for host in db.scalars(select(ZbxHost)):
        for group in host.groups or []:
            if isinstance(group, dict):
                groups.setdefault(str(group.get("id")), [str(group.get("name")), "0"])
                groups[str(group.get("id"))][1] = str(int(groups[str(group.get("id"))][1]) + 1)
    for groupid, entry in mapping.items():
        groups.setdefault(groupid, [entry.group_name, "0"])
    options = load_options(db)
    return ConnectionOut(
        state=data_state(db, user),
        enabled=stored.get("enabled") is True,
        url=str(stored.get("url") or "") or None,
        version=status.version if status else None,
        checked_at=status.checked_at if status else None,
        role=account.get("rolle") if isinstance(account.get("rolle"), str) else None,
        methods=[str(m) for m in account.get("methoden") or []],
        needed=list(NEEDED_METHODS),
        findings=[str(f) for f in account.get("hinweise") or []],
        token_expires_at=expires_at,
        token_never_expires=expires == 0,
        token_warning=expires_at is not None
        and expires_at - now_utc() < timedelta(days=TOKEN_WARN_DAYS),
        tasks=[
            TaskOut(
                task=task,
                label=TASK_LABELS[task],
                methods=TASK_METHODS[task],
                interval_minutes=int(TASK_INTERVALS[task].total_seconds() // 60),
                last_at=runs[task].started_at if task in runs else None,
                duration_ms=runs[task].duration_ms if task in runs else None,
                ok=runs[task].ok if task in runs else None,
                error=runs[task].error if task in runs else None,
                counts={str(k): int(v) for k, v in (runs[task].counts or {}).items()}
                if task in runs
                else {},
            )
            for task in TASK_INTERVALS
        ],
        groups=sorted(
            (
                GroupOut(
                    groupid=groupid,
                    name=name,
                    hosts=int(count),
                    site_id=mapping[groupid].site_id if groupid in mapping else None,
                    position=mapping[groupid].position if groupid in mapping else None,
                )
                for groupid, (name, count) in groups.items()
            ),
            key=lambda entry: entry.name.lower(),
        ),
        sites=[
            SiteOut(id=site_id, name=name)
            for site_id, name in sorted(_site_names(db).items(), key=lambda item: item[1].lower())
        ],
        certificate_tag=options.certificate_tag[0] if options.certificate_tag else "",
        certificate_value=options.certificate_tag[1] if options.certificate_tag else "",
        kinds=[
            SiteOut(id=kind_id, name=name)
            for kind_id, name in db.execute(
                select(InventoryKind.id, InventoryKind.name).order_by(InventoryKind.name)
            )
        ],
        kind_ids=list(options.kind_ids),
        target=options.target,
    )


class MappingEntry(BaseModel):
    groupid: str = Field(pattern=r"^\d{1,20}$")
    group_name: str = Field(max_length=255)
    site_id: int = Field(ge=1)


class OptionsIn(BaseModel):
    mapping: list[MappingEntry] = Field(max_length=500)
    certificate_tag: str = Field(default="", max_length=TAG_MAX)
    certificate_value: str = Field(default="", max_length=TAG_MAX)
    kind_ids: list[int] = Field(default_factory=list, max_length=200)
    target: float = Field(default=TARGET_DEFAULT, ge=TARGET_MIN, le=TARGET_MAX)


@router.put("/connection")
def save_connection_options(
    request: Request, body: OptionsIn, user: AdminUser, db: DbDep
) -> ConnectionOut:
    """Speichert die Zuordnung Hostgruppe → Standort und den Tag für Zertifikate."""
    known_sites = set(_site_names(db))
    if any(entry.site_id not in known_sites for entry in body.mapping):
        raise HTTPException(status_code=422, detail="Unbekannter Standort.")
    if len({entry.groupid for entry in body.mapping}) != len(body.mapping):
        raise HTTPException(status_code=422, detail="Eine Hostgruppe ist doppelt zugeordnet.")
    db.execute(delete(ZbxGroupSite))
    for position, entry in enumerate(body.mapping):
        db.add(
            ZbxGroupSite(
                groupid=entry.groupid,
                group_name=entry.group_name.strip()[:255],
                site_id=entry.site_id,
                position=position,
            )
        )
    known_kinds = set(db.scalars(select(InventoryKind.id)))
    if any(kind_id not in known_kinds for kind_id in body.kind_ids):
        raise HTTPException(status_code=422, detail="Unbekannte Hardware-Art.")
    tag = body.certificate_tag.strip()
    set_setting(
        db,
        ZABBIX_OPTIONS_KEY,
        {
            "certificate_tag": {"tag": tag, "value": body.certificate_value.strip()}
            if tag
            else None,
            "kind_ids": sorted(set(body.kind_ids)),
            "target": round(body.target, 2),
        },
        user.user_id,
    )
    db.flush()
    assign_sites(db)
    write_audit(
        db,
        module=MODULE,
        action="zabbix.zuordnung_geaendert",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=ZABBIX_OPTIONS_KEY,
        ip=client_ip(request),
        details={
            "zuordnungen": len(body.mapping),
            "zertifikat_tag": bool(tag),
            "hardware_arten": len(set(body.kind_ids)),
            "zielwert": round(body.target, 2),
        },
    )
    db.commit()
    return connection(user, db)


# ---------- Abgleich mit dem IT-Bestand ----------


class UnmonitoredRow(DeviceRef):
    reason: str | None


class UnmonitoredOut(BaseModel):
    # Geräte der festgelegten Arten ohne passenden Host
    missing: list[UnmonitoredRow]
    # bewusst nicht überwacht
    excluded: list[UnmonitoredRow]
    kinds_set: bool


@router.get("/unmonitored")
def unmonitored(user: ReaderUser, db: DbDep) -> UnmonitoredOut:
    """Geräte im IT-Bestand, die in Zabbix fehlen, und die bewusst nicht überwachten."""
    matched = match_inventory(db)
    devices = _devices(db, set(matched.unmonitored) | set(matched.excluded))
    return UnmonitoredOut(
        missing=[
            UnmonitoredRow(**devices[device_id].model_dump(), reason=None)
            for device_id in matched.unmonitored
            if device_id in devices
        ],
        excluded=sorted(
            (
                UnmonitoredRow(**devices[device_id].model_dump(), reason=reason)
                for device_id, reason in matched.excluded.items()
                if device_id in devices
            ),
            key=lambda row: row.name.lower(),
        ),
        kinds_set=bool(load_options(db).kind_ids),
    )


class LinkIn(BaseModel):
    hardware_id: int = Field(ge=1)


def _active_device(db: Session, hardware_id: int) -> InventoryHardware:
    device = db.get(InventoryHardware, hardware_id)
    if device is None or device.status != "aktiv":
        raise HTTPException(status_code=404, detail="Dieses Gerät gibt es im Bestand nicht.")
    return device


@router.post("/hosts/{hostid}/link")
def link_host(hostid: str, body: LinkIn, request: Request, user: LinkUser, db: DbDep) -> HostDetail:
    """Ordnet einem Host ohne Seriennummer ein Gerät von Hand zu."""
    host = db.get(ZbxHost, hostid) if _ID.match(hostid) else None
    if host is None:
        raise HTTPException(status_code=404, detail="Diesen Host gibt es nicht (mehr).")
    if host.serial.strip():
        raise HTTPException(
            status_code=409,
            detail="Der Host hat eine Seriennummer; er wird darüber verknüpft.",
        )
    device = _active_device(db, body.hardware_id)
    existing = db.get(ZbxHostLink, hostid)
    if existing is None:
        db.add(ZbxHostLink(hostid=hostid, hardware_id=device.id))
    else:
        existing.hardware_id = device.id
    add_event(db, device.id, user, f"In Zabbix dem Host „{host.name}“ zugeordnet")
    write_audit(
        db,
        module=MODULE,
        action="zabbix.host_zugeordnet",
        user_id=user.user_id,
        object_type="zabbix_host",
        object_id=hostid,
        ip=client_ip(request),
        details={"geraet": device.id},
    )
    db.commit()
    return host_detail(hostid, user, db)


@router.delete("/hosts/{hostid}/link")
def unlink_host(hostid: str, request: Request, user: LinkUser, db: DbDep) -> HostDetail:
    """Löst die Zuordnung von Hand."""
    link = db.get(ZbxHostLink, hostid) if _ID.match(hostid) else None
    host = db.get(ZbxHost, hostid) if _ID.match(hostid) else None
    if link is None or host is None:
        raise HTTPException(status_code=404, detail="Für diesen Host gibt es keine Zuordnung.")
    add_event(db, link.hardware_id, user, f"In Zabbix vom Host „{host.name}“ gelöst")
    db.delete(link)
    write_audit(
        db,
        module=MODULE,
        action="zabbix.zuordnung_geloest",
        user_id=user.user_id,
        object_type="zabbix_host",
        object_id=hostid,
        ip=client_ip(request),
    )
    db.commit()
    return host_detail(hostid, user, db)


class UnmonitoredIn(BaseModel):
    reason: str = Field(min_length=1, max_length=200)


@router.put("/devices/{hardware_id}/unmonitored")
def mark_unmonitored(
    hardware_id: int, body: UnmonitoredIn, request: Request, user: LinkUser, db: DbDep
) -> UnmonitoredOut:
    """Markiert ein Gerät als „bewusst nicht überwacht“ (mit Begründung, im Verlauf)."""
    device = _active_device(db, hardware_id)
    reason = body.reason.strip()[:200]
    if not reason:
        raise HTTPException(status_code=422, detail="Bitte begründe kurz.")
    entry = db.get(ZbxUnmonitored, device.id)
    if entry is None:
        db.add(ZbxUnmonitored(hardware_id=device.id, reason=reason))
    else:
        entry.reason = reason
    add_event(db, device.id, user, f"Bewusst nicht in Zabbix überwacht: {reason}")
    write_audit(
        db,
        module=MODULE,
        action="zabbix.nicht_ueberwacht",
        user_id=user.user_id,
        object_type="geraet",
        object_id=str(device.id),
        ip=client_ip(request),
    )
    db.commit()
    return unmonitored(user, db)


@router.delete("/devices/{hardware_id}/unmonitored")
def unmark_unmonitored(
    hardware_id: int, request: Request, user: LinkUser, db: DbDep
) -> UnmonitoredOut:
    """Hebt „bewusst nicht überwacht“ auf."""
    entry = db.get(ZbxUnmonitored, hardware_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Das Gerät ist nicht markiert.")
    db.delete(entry)
    add_event(db, hardware_id, user, "Soll wieder in Zabbix überwacht werden")
    write_audit(
        db,
        module=MODULE,
        action="zabbix.wieder_ueberwachen",
        user_id=user.user_id,
        object_type="geraet",
        object_id=str(hardware_id),
        ip=client_ip(request),
    )
    db.commit()
    return unmonitored(user, db)
