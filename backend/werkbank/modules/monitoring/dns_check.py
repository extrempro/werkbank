"""DNS-Abgleich mit NetBox: Ablauf, Einstellungen und Auftrag (alle 4 Stunden).

NetBox lesen, jeden Eintrag (Name und Typ) einmal öffentlich abfragen (DNS über HTTPS bei einem
festen öffentlichen Resolver), vergleichen und das Ergebnis speichern. Gesucht wird nichts Neues.
"""

import logging
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import NETBOX_KEY, decrypt_secret, get_setting
from werkbank.core.sessions import now_utc
from werkbank.modules.monitoring.compare import (
    CHECKED_TYPES,
    PROBLEMS,
    PublicAnswer,
    Row,
    build_row,
    excluded_by_delegation,
    find_delegations,
    is_private_reverse_zone,
    record_fqdn,
    strip_dot,
)
from werkbank.modules.monitoring.dnswire import WireError, parse_response
from werkbank.modules.monitoring.models import MonDnsRow, MonDnsRun
from werkbank.modules.monitoring.netbox import (
    Getter,
    NetboxConfig,
    NetboxError,
    http_get,
    load_records,
    load_zones,
)
from werkbank.modules.tools.net import RESOLVERS, Fetcher, NetError, dns_query, http_fetch

logger = logging.getLogger(__name__)

DNS_CHECK = "monitoring.dns_netbox"
DNS_CHECK_INTERVAL = timedelta(hours=4)
DEFAULT_RESOLVER = "cloudflare"
PARALLEL = 8
RETRIES = 2
# Zeilen behalten nur die letzten Läufe (für „neu seit dem letzten Lauf“), Zahlen 90 Tage
KEEP_ROW_RUNS = 2
KEEP_RUNS_DAYS = 90
STATUS_OK = "ok"
STATUS_FAILED = "fehlgeschlagen"
RCODE_NAMES = {2: "SERVFAIL", 5: "REFUSED"}
NXDOMAIN = 3


@dataclass(frozen=True)
class DnsCheckConfig:
    netbox: NetboxConfig
    view_id: int | None
    resolver: str
    compare_ttl: bool


def load_config(
    db: Session, settings: Settings, *, require_enabled: bool = True
) -> DnsCheckConfig | None:
    """Einstellungen aus der Verwaltung; None, wenn ausgeschaltet oder unvollständig."""
    stored: Any = get_setting(db, NETBOX_KEY)
    if not isinstance(stored, dict):
        return None
    if require_enabled and stored.get("enabled") is not True:
        return None
    url = stored.get("url")
    token_encrypted = stored.get("token_encrypted")
    token = (
        decrypt_secret(settings, token_encrypted)
        if isinstance(token_encrypted, str) and token_encrypted
        else None
    )
    if not isinstance(url, str) or not url or not token:
        return None
    view_id = stored.get("view_id")
    resolver = stored.get("resolver")
    ca_pem = stored.get("ca_pem")
    return DnsCheckConfig(
        netbox=NetboxConfig(
            url=url, token=token, ca_pem=ca_pem if isinstance(ca_pem, str) and ca_pem else None
        ),
        view_id=view_id if isinstance(view_id, int) else None,
        resolver=resolver if resolver in RESOLVERS else DEFAULT_RESOLVER,
        compare_ttl=stored.get("compare_ttl") is not False,
    )


def resolve(fetch: Fetcher, resolver: str, fqdn: str, type_name: str) -> PublicAnswer:
    """Öffentliche Antwort für Name und Typ; zwei Wiederholungen bei Netzfehlern."""
    for attempt in range(RETRIES + 1):
        try:
            wire, _ = dns_query(fetch, resolver, fqdn, type_name)
            response = parse_response(wire)
        except (NetError, WireError) as error:
            if attempt < RETRIES:
                time.sleep(0.5 * (attempt + 1))
                continue
            return PublicAnswer(error=str(error))
        if response.rcode in RCODE_NAMES:
            return PublicAnswer(error=f"Resolver meldet {RCODE_NAMES[response.rcode]}.")
        if response.rcode not in (0, NXDOMAIN):
            return PublicAnswer(error=f"Resolver meldet Fehler {response.rcode}.")
        own = [answer for answer in response.answers if strip_dot(answer.name) == fqdn]
        matching = [answer for answer in own if answer.type == type_name]
        cname = next((answer.data for answer in own if answer.type == "CNAME"), None)
        return PublicAnswer(
            values=[answer.data for answer in matching],
            ttl=matching[0].ttl if matching else None,
            cname=strip_dot(cname) if cname and type_name != "CNAME" else None,
        )
    return PublicAnswer(error="Keine Antwort.")


@dataclass
class CheckResult:
    rows: list[Row]
    zones: int
    records: int
    queries: int
    delegations: list[str]
    skipped_types: dict[str, int]


def _ttl(record: dict[str, Any], zone: dict[str, Any] | None) -> int | None:
    for value in (record.get("ttl"), (zone or {}).get("default_ttl")):
        if isinstance(value, int):
            return value
    return None


def run_check(
    config: DnsCheckConfig, *, get: Getter = http_get, fetch: Fetcher = http_fetch
) -> CheckResult:
    """Ein Abgleich. NetboxError, wenn NetBox nicht lesbar ist."""
    all_zones = load_zones(get, config.netbox, config.view_id)
    zones = [
        zone
        for zone in all_zones
        if zone.get("status", "active") == "active"
        and not is_private_reverse_zone(str(zone.get("name", "")))
    ]
    zone_by_id = {zone["id"]: zone for zone in zones if isinstance(zone.get("id"), int)}
    records = [
        record
        for record in load_records(get, config.netbox, list(zone_by_id))
        if isinstance(record.get("zone"), dict) and record["zone"].get("id") in zone_by_id
    ]
    zone_names = {strip_dot(str(zone.get("name", ""))) for zone in all_zones}
    delegations = find_delegations(records, zone_names)

    expected: dict[str, list[dict[str, Any]]] = {}
    inactive: dict[str, list[dict[str, Any]]] = {}
    places: dict[str, tuple[str, str, dict[str, Any]]] = {}
    skipped: dict[str, int] = {}
    counted = 0
    for record in records:
        type_name = str(record.get("type", "")).upper()
        fqdn = record_fqdn(record)
        if excluded_by_delegation(fqdn, type_name, delegations):
            continue
        if type_name not in CHECKED_TYPES:
            skipped[type_name] = skipped.get(type_name, 0) + 1
            continue
        counted += 1
        key = f"{fqdn}|{type_name}"
        target = inactive if record.get("status", "active") != "active" else expected
        target.setdefault(key, []).append(record)
        places.setdefault(key, (fqdn, type_name, zone_by_id[record["zone"]["id"]]))

    keys = sorted(places)

    def ask(key: str) -> tuple[str, PublicAnswer]:
        fqdn, type_name, _ = places[key]
        return key, resolve(fetch, config.resolver, fqdn, type_name)

    answers: dict[str, PublicAnswer] = {}
    if keys:
        with ThreadPoolExecutor(max_workers=min(PARALLEL, len(keys))) as pool:
            answers = dict(pool.map(ask, keys))

    rows = []
    for key in keys:
        fqdn, type_name, zone = places[key]
        mine = expected.get(key, [])
        first = (mine or inactive.get(key) or [{}])[0]
        url = first.get("display_url")
        rows.append(
            build_row(
                fqdn=fqdn,
                type_name=type_name,
                zone=strip_dot(str(zone.get("name", ""))),
                expected=[str(record.get("value", "")) for record in mine],
                inactive=[str(record.get("value", "")) for record in inactive.get(key, [])],
                answer=answers[key],
                configured_ttl=_ttl(first, zone),
                compare_ttl=config.compare_ttl,
                netbox_url=url if isinstance(url, str) and url.startswith("https://") else None,
            )
        )
    return CheckResult(
        rows=rows,
        zones=len(zones),
        records=counted,
        queries=len(keys),
        delegations=[delegation.fqdn for delegation in delegations],
        skipped_types=skipped,
    )


def counts_of(rows: list[Row]) -> dict[str, int]:
    out: dict[str, int] = {}
    for row in rows:
        out[row.status] = out.get(row.status, 0) + 1
    return out


Checker = Callable[[DnsCheckConfig], CheckResult]


def record_run(
    db: Session, settings: Settings, *, checker: Checker = run_check, now: datetime | None = None
) -> MonDnsRun | None:
    """Führt den Abgleich aus und speichert ihn. None, wenn er nicht eingerichtet ist."""
    config = load_config(db, settings)
    if config is None:
        return None
    started = now or now_utc()
    run = MonDnsRun(
        started_at=started, status=STATUS_OK, zones=0, records=0, queries=0, counts={}, details={}
    )
    try:
        result = checker(config)
    except NetboxError as error:
        run.status = STATUS_FAILED
        run.error = str(error)
    else:
        run.zones, run.records, run.queries = result.zones, result.records, result.queries
        run.counts = counts_of(result.rows)
        run.details = {
            "delegations": result.delegations,
            "skipped_types": result.skipped_types,
            "resolver": config.resolver,
        }
        db.add(run)
        db.flush()
        for row in result.rows:
            db.add(
                MonDnsRow(
                    run_id=run.id,
                    key=row.key[:300],
                    fqdn=row.fqdn[:260],
                    type=row.type[:12],
                    zone=row.zone[:260],
                    status=row.status,
                    data={
                        "netbox": row.netbox,
                        "inactive": row.inactive,
                        "public": row.public,
                        "missing": row.missing,
                        "extra": row.extra,
                        "notes": row.notes,
                        "netbox_url": row.netbox_url,
                    },
                )
            )
    run.finished_at = now or now_utc()
    db.add(run)
    db.flush()
    purge(db, now=started)
    db.commit()
    return run


def purge(db: Session, *, now: datetime) -> None:
    """Alte Läufe löschen; Zeilen nur für die letzten Läufe behalten."""
    db.execute(delete(MonDnsRun).where(MonDnsRun.started_at < now - timedelta(days=KEEP_RUNS_DAYS)))
    keep = list(
        db.scalars(
            select(MonDnsRun.id)
            .where(MonDnsRun.status == STATUS_OK)
            .order_by(MonDnsRun.id.desc())
            .limit(KEEP_ROW_RUNS)
        )
    )
    db.execute(delete(MonDnsRow).where(MonDnsRow.run_id.not_in(keep or [0])))


def latest_ok_runs(db: Session, count: int = KEEP_ROW_RUNS) -> list[MonDnsRun]:
    return list(
        db.scalars(
            select(MonDnsRun)
            .where(MonDnsRun.status == STATUS_OK)
            .order_by(MonDnsRun.id.desc())
            .limit(count)
        )
    )


def problem_keys(db: Session, run_id: int) -> set[str]:
    return set(
        db.scalars(
            select(MonDnsRow.key).where(MonDnsRow.run_id == run_id, MonDnsRow.status.in_(PROBLEMS))
        )
    )


def new_problem_keys(db: Session) -> tuple[MonDnsRun | None, set[str]]:
    """Probleme des letzten Laufs, die im vorletzten noch nicht da waren."""
    runs = latest_ok_runs(db)
    if not runs:
        return None, set()
    current = problem_keys(db, runs[0].id)
    previous = problem_keys(db, runs[1].id) if len(runs) > 1 else set()
    return runs[0], current - previous


def dns_check_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    record_run(db, settings)
