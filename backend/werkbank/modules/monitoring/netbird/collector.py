"""Abruf von NetBird alle fünf Minuten: jüngster Stand, Tageswerte, Aufräumen nach 90 Tagen.

Ein Fehler steht im Abruf; die Seiten zeigen dann den letzten Stand mit Zeit.
"""

import hashlib
import logging
import time
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.models import Notification
from werkbank.core.sessions import now_utc
from werkbank.modules.monitoring.netbird.checks import Checker, run_https
from werkbank.modules.monitoring.netbird.client import (
    NetBirdClient,
    NetBirdError,
    NotAvailableError,
    Transport,
)
from werkbank.modules.monitoring.netbird.config import (
    CHECK_DAYS,
    HISTORY_DAYS,
    client_config,
    lapi_config,
    load_settings,
    stored,
)
from werkbank.modules.monitoring.netbird.crowdsec import (
    CrowdSecError,
    LapiTransport,
    read_lapi,
    read_proxy_blocks,
)
from werkbank.modules.monitoring.netbird.hints import all_hints
from werkbank.modules.monitoring.netbird.models import (
    NbBlock,
    NbChange,
    NbCheck,
    NbDaily,
    NbEvent,
    NbHint,
    NbPeerDay,
    NbPolicySeen,
    NbRun,
    NbState,
)
from werkbank.modules.monitoring.netbird.normalize import fetch
from werkbank.modules.monitoring.netbird.policies import (
    POLICY_EVENTS,
    category,
    digest,
    parse_iso,
)
from werkbank.modules.monitoring.netbird.watch import (
    EVENT_SLACK,
    RETENTIONS,
    detect,
    load_watch,
    who,
)

logger = logging.getLogger(__name__)

NETBIRD_JOB = "monitoring.netbird"
NETBIRD_JOB_INTERVAL = timedelta(minutes=5)
LOCAL_TZ = ZoneInfo("Europe/Berlin")
ERROR_MAX = 500


def local_day(moment: datetime) -> date:
    return moment.astimezone(LOCAL_TZ).date()


def latest_state(db: Session) -> NbState | None:
    return db.get(NbState, 1)


def last_run(db: Session) -> NbRun | None:
    return db.scalars(select(NbRun).order_by(NbRun.id.desc()).limit(1)).first()


def store(db: Session, data: dict[str, Any], now: datetime) -> None:
    state = latest_state(db)
    if state is None:
        db.add(NbState(id=1, fetched_at=now, data=data))
    else:
        state.fetched_at = now
        state.data = data
    day = local_day(now)
    peers = data.get("peers") or []
    connected = [p["id"] for p in peers if p.get("connected") and p.get("id")]
    daily = db.get(NbDaily, day)
    if daily is None:
        db.add(NbDaily(day=day, max_connected=len(connected), total=len(peers)))
    else:
        daily.max_connected = max(daily.max_connected, len(connected))
        daily.total = len(peers)
    known = set(db.scalars(select(NbPeerDay.peer_id).where(NbPeerDay.day == day)))
    for peer_id in set(connected) - known:
        db.add(NbPeerDay(peer_id=peer_id[:64], day=day))


def ping_target(network: dict[str, Any]) -> str:
    """Testziel eines Netzes: die erste eingeschaltete einzelne Adresse (Ressource „host“)."""
    for item in network.get("resources") or []:
        address = str(item.get("address") or "")
        if item.get("enabled", True) and item.get("type") == "host" and address:
            return address.removesuffix("/32")
    return ""


def run_checks(
    db: Session, data: dict[str, Any], now: datetime, checker: Checker
) -> dict[str, Any]:
    """HTTPS-Abruf der öffentlichen Dienste, TCP zu Signal und Relay, optional Ping."""
    options = load_settings(db)
    services = [
        s
        for s in data.get("services") or []
        if s.get("enabled") and not s.get("private") and s.get("mode") == "http" and s.get("domain")
    ]
    results = run_https(checker, [s["domain"] for s in services])
    out: dict[str, Any] = {"services": {}, "ping": {}, "ping_enabled": options.ping}
    for item in services:
        result = results[item["domain"]]
        out["services"][item["id"]] = {
            "status_code": result.status_code,
            "ms": result.ms,
            "cert_expires": result.cert_expires.isoformat() if result.cert_expires else None,
            "error": result.error,
            "answered": result.answered,
        }
        db.add(
            NbCheck(
                service_id=item["id"][:64],
                checked_at=now,
                ok=result.answered,
                status_code=result.status_code,
                ms=result.ms,
            )
        )
    for key, target in (("signal", options.signal), ("relay", options.relay)):
        if target:
            tcp = checker.tcp(target)
            out[key] = {"target": target, "ok": tcp.ok, "ms": tcp.ms, "error": tcp.error}
    if options.ping:
        for network in (data.get("networks") or []) + (data.get("legacy_routes") or []):
            target = ping_target(network)
            if target:
                out["ping"][network["id"]] = {"target": target, "ok": checker.ping(target)}
    return out


def store_events(db: Session, events: list[dict[str, Any]], now: datetime) -> int:
    """Neue Ereignisse der letzten 90 Tage übernehmen; liefert die Zahl der neuen."""
    cutoff = now - timedelta(days=HISTORY_DAYS)
    fresh = {}
    for item in events:
        at = parse_iso(item.get("at"))
        if item.get("id") and at is not None and at >= cutoff:
            fresh[item["id"]] = (item, at)
    if not fresh:
        return 0
    known = set(db.scalars(select(NbEvent.id).where(NbEvent.id.in_(list(fresh)))))
    added = 0
    for eid, (item, at) in fresh.items():
        if eid in known:
            continue
        db.add(
            NbEvent(
                id=eid,
                at=at,
                code=item["code"],
                category=category(item["code"]),
                activity=item["activity"],
                target_id=item["target_id"],
                initiator=item["initiator"],
                initiator_id=item["initiator_id"][:255],
                meta=item["meta"],
            )
        )
        added += 1
    db.flush()
    return added


def track_policies(
    db: Session,
    data: dict[str, Any],
    now: datetime,
    events: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Wann eine Richtlinie zuletzt geändert wurde und seit wann sie aus ist.

    Quelle ist das Ereignisprotokoll, sonst der eigene Abgleich. Ist eine Richtlinie beim ersten
    Abruf schon aus, gilt die letzte Änderung laut Protokoll (aus sein kann sie nur länger).
    """
    policies = data.get("policies")
    if policies is None:
        return {}
    seen = {row.policy_id: row for row in db.scalars(select(NbPolicySeen))}
    last_event: dict[str, datetime] = {}
    for target, at in db.execute(
        select(NbEvent.target_id, NbEvent.at).where(NbEvent.code.in_(POLICY_EVENTS))
    ):
        if target not in last_event or at > last_event[target]:
            last_event[target] = at
    # Auch ältere Einträge, die nicht gespeichert werden (über 90 Tage)
    for item in events or []:
        moment = parse_iso(item.get("at"))
        target = item.get("target_id") or ""
        if (
            item.get("code") in POLICY_EVENTS
            and moment is not None
            and (target not in last_event or moment > last_event[target])
        ):
            last_event[target] = moment
    out: dict[str, Any] = {}
    ids = set()
    for policy in policies:
        pid = policy["id"][:64]
        ids.add(pid)
        fingerprint = digest(policy)
        row = seen.get(pid)
        enabled = bool(policy.get("enabled"))
        if row is None:
            event_at = last_event.get(pid)
            row = NbPolicySeen(
                policy_id=pid,
                digest=fingerprint,
                first_seen=now,
                changed_at=None,
                disabled_since=None if enabled else min(filter(None, (now, event_at))),
            )
            db.add(row)
        elif row.digest != fingerprint:
            row.digest = fingerprint
            row.changed_at = now
            if enabled:
                row.disabled_since = None
            elif row.disabled_since is None:
                row.disabled_since = now
        changed = max(filter(None, (row.changed_at, last_event.get(pid))), default=None)
        out[pid] = {
            "changed_at": changed.isoformat() if changed else None,
            "disabled_since": row.disabled_since.isoformat() if row.disabled_since else None,
        }
    for pid in set(seen) - ids:
        db.delete(seen[pid])
    db.flush()
    return out


def hint_marker(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()[:12]


def hint_link(link: str, key: str) -> str:
    """Link für die Glocke; der Marker erlaubt, die Meldung später als erledigt zu markieren."""
    return f"{link}{'&' if '?' in link else '?'}hinweis={hint_marker(key)}"


def sync_hints(db: Session, data: dict[str, Any], now: datetime) -> None:
    """Offene Hinweise abgleichen. Trifft einer nicht mehr zu, wird er geschlossen und seine
    ungelesenen Meldungen in der Glocke gelten als gelesen."""
    current = {hint.key[:300]: hint for hint in all_hints(data, now)}
    stored = {row.key: row for row in db.scalars(select(NbHint))}
    for key, hint in current.items():
        row = stored.get(key)
        if row is None:
            db.add(
                NbHint(
                    key=key,
                    level=hint.level,
                    title=hint.title[:300],
                    link=hint_link(hint.link, key)[:300],
                    since=now,
                )
            )
        else:
            row.level, row.title = hint.level, hint.title[:300]
    for key in set(stored) - set(current):
        marker = hint_marker(key)
        db.execute(
            update(Notification)
            .where(
                Notification.kind.in_(HINT_KINDS),
                Notification.read_at.is_(None),
                Notification.link.like(f"%hinweis={marker}"),
            )
            .values(read_at=now)
        )
        db.delete(stored[key])
    db.flush()


HINT_KINDS = ("monitoring.netbird_hinweis", "monitoring.netbird_info")


BLOCK_DAYS = 7


def collect_blocks(db: Session, client: NetBirdClient, data: dict[str, Any], now: datetime) -> None:
    """Abweisungen durch CrowdSec aus dem Zugriffsprotokoll seit dem letzten Abruf zählen."""
    previous = latest_state(db)
    old = previous.data if previous else {}
    try:
        blocks = read_proxy_blocks(
            client,
            str(old.get("proxy_cursor") or ""),
            [str(i) for i in old.get("proxy_cursor_ids") or []],
            now,
        )
    except NotAvailableError:
        data["proxy_log"] = {"available": False, "complete": True}
        return
    except NetBirdError as error:
        data["notes"] = [*(data.get("notes") or []), f"Zugriffsprotokoll: {error}"]
        data["proxy_log"] = {"available": True, "complete": False}
        data["proxy_cursor"] = old.get("proxy_cursor") or ""
        data["proxy_cursor_ids"] = old.get("proxy_cursor_ids") or []
        return
    for (service_id, hour, observe), count in blocks.counts.items():
        row = db.get(NbBlock, (service_id, hour, observe))
        if row is None:
            db.add(NbBlock(service_id=service_id, hour=hour, observe=observe, count=count))
        else:
            row.count += count
    db.flush()
    data["proxy_log"] = {"available": True, "complete": blocks.complete}
    data["proxy_cursor"] = blocks.cursor
    data["proxy_cursor_ids"] = blocks.cursor_ids
    if not blocks.complete:
        data["notes"] = [
            *(data.get("notes") or []),
            "Zugriffsprotokoll: mehr Einträge als in einem Abruf gelesen werden; die Zahlen "
            "holen beim nächsten Abruf auf.",
        ]


def collect_lapi(
    db: Session, settings: Settings, data: dict[str, Any], transport: LapiTransport | None
) -> None:
    data["crowdsec_exempt"] = list(load_settings(db).crowdsec_exempt)
    config = lapi_config(db, settings)
    if config is None:
        data["crowdsec"] = {"configured": False}
        return
    try:
        data["crowdsec"] = {"configured": True, "ok": True, **read_lapi(config, transport)}
    except CrowdSecError as error:
        data["crowdsec"] = {"configured": True, "ok": False, "error": str(error)[:300]}


def record_changes(
    db: Session,
    old: dict[str, Any] | None,
    old_at: datetime | None,
    new: dict[str, Any],
    now: datetime,
) -> list[NbChange]:
    """Änderungen an überwachten Gruppen und Policies seit dem letzten Stand speichern."""
    watch = load_watch(stored(db))
    if old is None or old_at is None or not watch.active:
        return []
    drafts = detect(old, new, watch)
    if not drafts:
        return []
    events = [
        {"code": e.code, "target_id": e.target_id, "initiator": e.initiator, "meta": e.meta}
        for e in db.scalars(select(NbEvent).where(NbEvent.at >= old_at - EVENT_SLACK))
    ]
    created = []
    for draft in drafts:
        author = who(draft, events)
        category = draft.category
        if draft.action == "mitglieder":
            category = (
                "members_scim"
                if author.kind == "scim" or (draft.scim_group and author.kind != "person")
                else "members_manual"
            )
        reported = bool(watch.notify.get(category)) or draft.flag == "fremde_gruppe"
        critical = draft.flag == "fremde_gruppe"
        notified = []
        if reported:
            notified.append("Glocke an NetBird-Leser")
            if critical and watch.critical_mail:
                notified.append("Mail und Teams an Bestätiger")
        change = NbChange(
            detected_at=now,
            kind=draft.kind,
            object_id=draft.object_id[:64],
            object_name=draft.object_name[:255],
            action=draft.action,
            summary=draft.summary[:300],
            fields=draft.fields,
            initiator=author.name,
            initiator_kind=author.kind,
            via=author.via,
            flag=draft.flag,
            flag_text=draft.flag_text[:300],
            critical=critical,
            reported=reported,
            notified=" · ".join(notified) or "nicht gemeldet (nur protokolliert)",
            status="offen" if reported or not watch.auto_confirm else "automatisch",
        )
        db.add(change)
        created.append(change)
    db.flush()
    return created


def purge(db: Session, now: datetime) -> None:
    db.execute(delete(NbCheck).where(NbCheck.checked_at < now - timedelta(days=CHECK_DAYS + 1)))
    cutoff = local_day(now) - timedelta(days=HISTORY_DAYS)
    db.execute(delete(NbDaily).where(NbDaily.day < cutoff))
    db.execute(delete(NbPeerDay).where(NbPeerDay.day < cutoff))
    db.execute(delete(NbRun).where(NbRun.started_at < now - timedelta(days=HISTORY_DAYS)))
    db.execute(delete(NbEvent).where(NbEvent.at < now - timedelta(days=HISTORY_DAYS)))
    db.execute(delete(NbBlock).where(NbBlock.hour < now - timedelta(days=BLOCK_DAYS)))
    days = RETENTIONS.get(load_watch(stored(db)).retention)
    if days is not None:
        db.execute(delete(NbChange).where(NbChange.detected_at < now - timedelta(days=days)))


def collect(
    db: Session,
    settings: Settings,
    *,
    transport: Transport | None = None,
    checker: Checker | None = None,
    lapi: LapiTransport | None = None,
) -> NbRun | None:
    """Ein Abruf; None, wenn NetBird nicht eingerichtet ist."""
    config = client_config(db, settings)
    if config is None:
        return None
    now = now_utc()
    started = time.monotonic()
    run = NbRun(started_at=now, ok=True)
    try:
        client = NetBirdClient(config, transport)
        fetched = fetch(client)
        fetched.data["events_available"] = fetched.events is not None
        if fetched.events is not None:
            store_events(db, fetched.events, now)
        fetched.data["policy_meta"] = track_policies(db, fetched.data, now, fetched.events)
        fetched.data["checks"] = run_checks(db, fetched.data, now, checker or Checker())
        if fetched.data.get("services") is not None:
            collect_blocks(db, client, fetched.data, now)
        collect_lapi(db, settings, fetched.data, lapi)
        previous = latest_state(db)
        old_data = dict(previous.data) if previous else None
        old_at = previous.fetched_at if previous else None
        record_changes(db, old_data, old_at, fetched.data, now)
        store(db, fetched.data, now)
        sync_hints(db, fetched.data, now)
    except NetBirdError as error:
        db.rollback()
        run = NbRun(started_at=now, ok=False, error=str(error)[:ERROR_MAX])
    except Exception:
        logger.exception("NetBird: Abruf fehlgeschlagen")
        db.rollback()
        run = NbRun(
            started_at=now, ok=False, error="Unerwarteter Fehler beim Verarbeiten der Antwort."
        )
    run.duration_ms = int((time.monotonic() - started) * 1000)
    db.add(run)
    purge(db, now)
    db.commit()
    return run


def netbird_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    collect(db, settings)
