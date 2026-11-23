"""Collector für Zabbix: ein Auftrag jede Minute, der fällige Abfragen ausführt.

- schnell (jede Minute): offene Probleme mit Host, Zustand der Hosts
- wartungen (alle 15 Minuten)
- stammdaten (stündlich): Version, Hosts mit Gruppen, Templates und Inventar, Prüfung des
  Dienstkontos
- berichte (stündlich geprüft): Ausfallzeiten und Auslöser der abgeschlossenen Tage

Ein ausgefallenes Zabbix blockiert die Werkbank nicht: Fehler landen im Lauf, die Seiten
zeigen den letzten Stand mit Zeit. Der Auftrag selbst schlägt deshalb nie fehl.
"""

import logging
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.sessions import now_utc
from werkbank.modules.monitoring.zabbix.client import (
    Host,
    Transport,
    ZabbixClient,
    ZabbixError,
    http_transport,
    role_findings,
)
from werkbank.modules.monitoring.zabbix.config import load_config
from werkbank.modules.monitoring.zabbix.models import (
    ZbxGroupSite,
    ZbxHost,
    ZbxMaintenance,
    ZbxProblem,
    ZbxRun,
    ZbxStatus,
)
from werkbank.modules.monitoring.zabbix.reports import observe_maintenance, run_reports

logger = logging.getLogger(__name__)

ZABBIX_JOB = "monitoring.zabbix"
ZABBIX_JOB_INTERVAL = timedelta(minutes=1)
TASK_FAST = "schnell"
TASK_MAINTENANCE = "wartungen"
TASK_MASTER = "stammdaten"
TASK_REPORTS = "berichte"
TASK_INTERVALS: dict[str, timedelta] = {
    TASK_FAST: timedelta(minutes=1),
    TASK_MAINTENANCE: timedelta(minutes=15),
    TASK_MASTER: timedelta(hours=1),
    TASK_REPORTS: timedelta(hours=1),
}
TASK_LABELS = {
    TASK_FAST: "Probleme und Zustand",
    TASK_MAINTENANCE: "Wartungen",
    TASK_MASTER: "Hosts, Gruppen und Dienstkonto",
    TASK_REPORTS: "Ausfallzeiten für die Berichte",
}
TASK_METHODS = {
    TASK_FAST: ["problem.get", "trigger.get", "host.get"],
    TASK_MAINTENANCE: ["maintenance.get"],
    TASK_MASTER: ["apiinfo.version", "host.get", "hostgroup.get", "role.get", "token.get"],
    TASK_REPORTS: ["event.get"],
}
KEEP_RUNS_DAYS = 30
# Kleiner Vorlauf, damit ein Auftrag, der ein paar Sekunden früher startet, nicht ausfällt
SLACK = timedelta(seconds=5)
ERROR_MAX = 500

# Dient in Tests als Ersatz für http_transport
_transport: Transport = http_transport


def set_transport(transport: Transport) -> None:
    """Nur für Tests."""
    global _transport
    _transport = transport


def _ts(value: int) -> datetime:
    return datetime.fromtimestamp(max(value, 0), UTC)


def last_runs(db: Session) -> dict[str, ZbxRun]:
    out: dict[str, ZbxRun] = {}
    for task in TASK_INTERVALS:
        run = db.scalars(
            select(ZbxRun).where(ZbxRun.task == task).order_by(ZbxRun.id.desc()).limit(1)
        ).first()
        if run is not None:
            out[task] = run
    return out


def due_tasks(db: Session, now: datetime, *, force_master: bool = False) -> list[str]:
    """Fällige Abfragen: Stammdaten zuerst, damit neue Hosts gleich Gruppen bekommen."""
    runs = last_runs(db)
    due: list[str] = []
    for task in (TASK_MASTER, TASK_MAINTENANCE, TASK_FAST, TASK_REPORTS):
        last = runs.get(task)
        if (
            last is None
            or now - last.started_at >= TASK_INTERVALS[task] - SLACK
            or (task == TASK_MASTER and force_master)
        ):
            due.append(task)
    return due


def site_for(groups: list[tuple[str, str]], mapping: list[ZbxGroupSite]) -> int | None:
    """Standort aus der ersten passenden Zuordnung (Reihenfolge der Zuordnung zählt)."""
    ids = {groupid for groupid, _ in groups}
    for entry in mapping:
        if entry.groupid in ids:
            return entry.site_id
    return None


def _interfaces(host: Host) -> list[dict[str, Any]]:
    return [
        {
            "type": item.type,
            "address": item.address,
            "port": item.port,
            "main": item.main,
            "available": item.available,
        }
        for item in host.interfaces
    ]


def _apply_state(row: ZbxHost, host: Host, now: datetime) -> None:
    row.host = host.host
    row.name = host.name
    row.monitored = host.monitored
    row.reachable = host.reachable
    row.in_maintenance = host.in_maintenance
    row.maintenanceid = host.maintenanceid
    row.interfaces = _interfaces(host)
    if host.reachable:
        row.last_seen_at = now
    row.updated_at = now


def run_fast(db: Session, client: ZabbixClient, now: datetime) -> dict[str, int]:
    """Probleme und Zustand der Hosts. Neue Hosts kommen mit, Gruppen erst mit den Stammdaten."""
    hosts = client.hosts(details=False)
    existing = {row.hostid: row for row in db.scalars(select(ZbxHost))}
    for host in hosts:
        row = existing.get(host.hostid)
        if row is None:
            row = ZbxHost(hostid=host.hostid, groups=[], templates=[])
            db.add(row)
            existing[host.hostid] = row
        _apply_state(row, host, now)
    observe_maintenance(db, existing.values(), now)
    found = client.problems()
    trigger_hosts = client.trigger_hosts(sorted({problem.triggerid for problem in found}))
    # Probleme abgeschalteter Trigger, Items oder Hosts bleiben in Zabbix offen, zählen aber nicht
    problems = [problem for problem in found if problem.triggerid in trigger_hosts]
    db.execute(delete(ZbxProblem))
    for problem in problems:
        hostids = trigger_hosts.get(problem.triggerid) or []
        db.add(
            ZbxProblem(
                eventid=problem.eventid,
                triggerid=problem.triggerid,
                hostid=next((hostid for hostid in hostids if hostid in existing), None),
                name=problem.name,
                severity=problem.severity,
                since=_ts(problem.clock),
                acknowledged=problem.acknowledged,
                suppressed=problem.suppressed,
                tags=[list(tag) for tag in problem.tags],
            )
        )
    return {"hosts": len(hosts), "probleme": len(problems)}


def run_maintenances(db: Session, client: ZabbixClient, now: datetime) -> dict[str, int]:
    maintenances = client.maintenances()
    db.execute(delete(ZbxMaintenance))
    for item in maintenances:
        db.add(
            ZbxMaintenance(
                maintenanceid=item.maintenanceid,
                name=item.name,
                with_data=item.with_data,
                active_since=_ts(item.active_since),
                active_till=_ts(item.active_till),
                hostids=item.hostids,
                groupids=item.groupids,
                once=[list(period) for period in item.once],
                recurring=item.recurring,
            )
        )
    return {"wartungen": len(maintenances)}


def assign_sites(db: Session) -> None:
    """Standort aller Hosts neu aus der Zuordnung der Hostgruppen."""
    mapping = list(db.scalars(select(ZbxGroupSite).order_by(ZbxGroupSite.position)))
    for row in db.scalars(select(ZbxHost)):
        groups = [
            (str(group.get("id")), str(group.get("name")))
            for group in row.groups or []
            if isinstance(group, dict)
        ]
        row.site_id = site_for(groups, mapping)


def run_master(db: Session, client: ZabbixClient, now: datetime) -> dict[str, int]:
    """Version, Hosts mit Details, Prüfung des Dienstkontos. Verschwundene Hosts fallen weg."""
    version = client.version()
    hosts = client.hosts(details=True)
    existing = {row.hostid: row for row in db.scalars(select(ZbxHost))}
    seen: set[str] = set()
    for host in hosts:
        seen.add(host.hostid)
        row = existing.get(host.hostid)
        if row is None:
            row = ZbxHost(hostid=host.hostid)
            db.add(row)
        _apply_state(row, host, now)
        row.groups = [{"id": groupid, "name": name} for groupid, name in host.groups]
        row.templates = host.templates[:50]
        row.serial = host.serial
        row.model = host.model
        row.kind = host.kind
    for hostid, row in existing.items():
        if hostid not in seen:
            db.delete(row)
    db.flush()
    assign_sites(db)
    account: dict[str, Any] = {}
    try:
        userid, roleid = client.own_user()
        check = client.role(roleid)
        expires = client.token_expiry(userid)
        account = {
            "rolle": check.role,
            "modus": check.mode,
            "methoden": check.methods,
            "hinweise": role_findings(check),
            "token_ablauf": expires,
        }
    except ZabbixError as error:
        account = {"hinweise": [f"Rolle oder Token ließen sich nicht prüfen: {error}"]}
    status = db.get(ZbxStatus, 1)
    if status is None:
        status = ZbxStatus(id=1)
        db.add(status)
    status.version = version.text
    status.checked_at = now
    status.account = account
    db.execute(delete(ZbxRun).where(ZbxRun.started_at < now - timedelta(days=KEEP_RUNS_DAYS)))
    return {"hosts": len(hosts)}


TASKS: dict[str, Callable[[Session, ZabbixClient, datetime], dict[str, int]]] = {
    TASK_MASTER: run_master,
    TASK_MAINTENANCE: run_maintenances,
    TASK_FAST: run_fast,
    TASK_REPORTS: run_reports,
}


def collect(db: Session, settings: Settings, transport: Transport | None = None) -> list[ZbxRun]:
    """Führt alle fälligen Abfragen aus; jede in eigener Transaktion."""
    config = load_config(db, settings)
    if config is None:
        return []
    client = ZabbixClient(config, transport or _transport)
    now = now_utc()
    known = db.scalar(select(ZbxHost.hostid).limit(1)) is not None
    runs: list[ZbxRun] = []
    for task in due_tasks(db, now, force_master=not known):
        started = time.monotonic()
        run = ZbxRun(task=task, started_at=now, ok=True, counts={})
        try:
            run.counts = TASKS[task](db, client, now)
        except ZabbixError as error:
            db.rollback()
            run = ZbxRun(task=task, started_at=now, ok=False, error=str(error)[:ERROR_MAX])
        except Exception:
            # Zabbix darf den Worker nie anhalten
            logger.exception("Zabbix: Abfrage %s fehlgeschlagen", task)
            db.rollback()
            run = ZbxRun(
                task=task,
                started_at=now,
                ok=False,
                error="Unerwarteter Fehler beim Verarbeiten der Antwort von Zabbix.",
            )
        run.duration_ms = int((time.monotonic() - started) * 1000)
        db.add(run)
        db.commit()
        runs.append(run)
    return runs


def zabbix_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    collect(db, settings)
