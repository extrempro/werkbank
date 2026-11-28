"""Aufbereitung für die Seiten: Übersicht, Peers, Netze & Dienste, Richtlinien & Ereignisse."""

from collections import Counter
from collections.abc import Mapping
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import Integer, cast, func, select
from sqlalchemy.orm import Session

from werkbank.modules.monitoring.netbird.collector import last_run, latest_state, local_day
from werkbank.modules.monitoring.netbird.config import CHECK_DAYS, load_settings, stored
from werkbank.modules.monitoring.netbird.hints import (
    LEVELS,
    Hint,
    all_hints,
    login_expires,
    network_status,
    parse_time,
    releases_behind,
    status,
)
from werkbank.modules.monitoring.netbird.models import (
    NbBlock,
    NbChange,
    NbCheck,
    NbDaily,
    NbEvent,
    NbPeerDay,
)
from werkbank.modules.monitoring.netbird.policies import (
    CATEGORIES,
    event_change,
    event_label,
    event_object,
    findings,
    peer_targets,
    policy_rows,
    setup_key_rows,
)
from werkbank.modules.monitoring.netbird.watch import load_watch, preview

STATUS_LABELS = {
    "verbunden": "verbunden",
    "offline": "offline",
    "freigabe": "Freigabe offen",
    "abgelaufen": "Anmeldung abgelaufen",
}
CHART_DAYS = (14, 30, 90)


def os_family(value: str) -> str:
    text = (value or "").lower()
    for key, label in (
        ("windows", "Windows"),
        ("darwin", "macOS"),
        ("macos", "macOS"),
        ("ios", "iOS"),
        ("android", "Android"),
        ("linux", "Linux"),
        ("ubuntu", "Linux"),
        ("debian", "Linux"),
    ):
        if key in text:
            return label
    return "andere" if text else "unbekannt"


def routing_peers(data: Mapping[str, Any]) -> set[str]:
    """Peers, die als Routing-Peer eingetragen sind (direkt oder über eine Gruppe)."""
    members = {g["id"]: set(g.get("peers") or []) for g in data.get("groups") or []}
    out: set[str] = set()
    items = list(data.get("routers") or [])
    for network in (data.get("networks") or []) + (data.get("legacy_routes") or []):
        items.extend(network.get("routers") or [])
    for item in items:
        if not item.get("enabled", True):
            continue
        if item.get("peer"):
            out.add(item["peer"])
        for gid in item.get("peer_groups") or []:
            out |= members.get(gid, set())
    return out


def _users(data: Mapping[str, Any]) -> dict[str, str]:
    return {u["id"]: u["name"] for u in data.get("users") or [] if u.get("id")}


def _groups(data: Mapping[str, Any]) -> dict[str, str]:
    return {g["id"]: g["name"] for g in data.get("groups") or [] if g.get("id")}


def _base(db: Session) -> dict[str, Any]:
    state = latest_state(db)
    run = last_run(db)
    settings = load_settings(db)
    return {
        "configured": bool(settings.url and settings.token_set),
        "data_at": state.fetched_at if state else None,
        "last_run_at": run.started_at if run else None,
        "last_ok": run.ok if run else None,
        "error": run.error if run and not run.ok else None,
        "notes": (state.data.get("notes") if state else None) or [],
        "dashboard_url": settings.url,
    }


def hint_out(hint: Hint) -> dict[str, Any]:
    return {
        "key": hint.key,
        "level": hint.level,
        "code": hint.code,
        "title": hint.title,
        "text": hint.text,
        "link": hint.link,
    }


def overview(db: Session, now: datetime, days: int = 14) -> dict[str, Any]:
    out = _base(db)
    state = latest_state(db)
    data: Mapping[str, Any] = state.data if state else {}
    peers = data.get("peers") or []
    routers = routing_peers(data)
    hints = (all_hints(data, now) if state else []) + change_hints(db)
    order = {level: index for index, level in enumerate(LEVELS)}
    hints.sort(key=lambda h: order[h.level])
    latest = str((data.get("version") or {}).get("available") or "")
    versions: Counter[str] = Counter()
    systems: dict[str, dict[str, int]] = {}
    for peer in peers:
        behind = releases_behind(peer.get("version") or "", latest)
        bucket = (
            "unbekannt"
            if behind is None
            else ("neuestes" if behind == 0 else ("eins" if behind == 1 else "zwei"))
        )
        versions[bucket] += 1
        family = systems.setdefault(os_family(peer.get("os") or ""), {"total": 0, "online": 0})
        family["total"] += 1
        family["online"] += 1 if peer.get("connected") else 0
    days = days if days in CHART_DAYS else 14
    first = local_day(now) - timedelta(days=days - 1)
    daily = {
        row.day: row
        for row in db.scalars(select(NbDaily).where(NbDaily.day >= first).order_by(NbDaily.day))
    }
    chart = []
    for index in range(days):
        day = first + timedelta(days=index)
        row = daily.get(day)
        chart.append(
            {
                "day": day.isoformat(),
                "weekend": day.weekday() >= 5,
                "max_connected": row.max_connected if row else None,
                "total": row.total if row else None,
            }
        )
    nets = [network_status(n, data) for n in all_networks(data)]
    services = public_services(data)
    results = (data.get("checks") or {}).get("services") or {}
    out.update(
        {
            "networks_total": len(nets),
            "networks_ok": sum(1 for n in nets if n["state"] in ("erreichbar", "ohne_ausfallweg")),
            "networks_single": sum(1 for n in nets if n["state"] == "ohne_ausfallweg"),
            "services_total": len(services),
            "services_ok": sum(
                1 for item in services if (results.get(item["id"]) or {}).get("answered")
            ),
            "services_checked": sum(1 for item in services if item["id"] in results),
            "peers": len(peers),
            "connected": sum(1 for p in peers if p.get("connected")),
            "routers": len(routers & {p["id"] for p in peers}),
            "routers_offline": sum(
                1 for p in peers if p["id"] in routers and not p.get("connected")
            ),
            "hint_counts": {level: sum(1 for h in hints if h.level == level) for level in LEVELS},
            "hints": [hint_out(h) for h in hints],
            "latest_version": latest,
            "versions": {
                key: versions.get(key, 0) for key in ("neuestes", "eins", "zwei", "unbekannt")
            },
            "systems": [
                {"name": name, **counts}
                for name, counts in sorted(systems.items(), key=lambda kv: -kv[1]["total"])
            ],
            "chart_days": days,
            "chart": chart,
            "events_available": bool(data.get("events_available")),
            "events": [
                event_row(e)
                for e in db.scalars(select(NbEvent).order_by(NbEvent.at.desc()).limit(5))
            ],
        }
    )
    return out


def peer_row(
    peer: Mapping[str, Any],
    users: Mapping[str, str],
    routers: set[str],
    latest: str,
    hints: list[Hint],
) -> dict[str, Any]:
    state = status(peer)
    return {
        "id": peer["id"],
        "name": peer["name"],
        "person": users.get(peer.get("user_id") or "", ""),
        "status": state,
        "status_label": STATUS_LABELS[state],
        "last_seen": parse_time(peer.get("last_seen")),
        "ip": peer.get("ip") or "",
        "os": peer.get("os") or "",
        "os_family": os_family(peer.get("os") or ""),
        "version": peer.get("version") or "",
        "behind": releases_behind(peer.get("version") or "", latest),
        "router": peer["id"] in routers,
        "groups": peer.get("groups") or [],
        "hints": [hint_out(h) for h in hints],
    }


def peers(
    db: Session,
    now: datetime,
    *,
    query: str = "",
    state_filter: str = "",
    group: str = "",
    family: str = "",
    hinted: bool = False,
) -> dict[str, Any]:
    out = _base(db)
    state = latest_state(db)
    data: Mapping[str, Any] = state.data if state else {}
    users = _users(data)
    routers = routing_peers(data)
    latest = str((data.get("version") or {}).get("available") or "")
    by_peer: dict[str, list[Hint]] = {}
    for hint in all_hints(data, now) if state else []:
        if hint.subject.startswith("peer:"):
            by_peer.setdefault(hint.subject[5:], []).append(hint)
    rows = []
    counts: Counter[str] = Counter()
    families: Counter[str] = Counter()
    needle = query.strip().lower()
    for peer in data.get("peers") or []:
        row = peer_row(peer, users, routers, latest, by_peer.get(peer["id"], []))
        counts[row["status"]] += 1
        families[row["os_family"]] += 1
        if state_filter and row["status"] != state_filter:
            continue
        if group and group not in row["groups"]:
            continue
        if family and row["os_family"] != family:
            continue
        if hinted and not row["hints"]:
            continue
        if needle and not any(
            needle in str(value).lower() for value in (row["name"], row["person"], row["ip"])
        ):
            continue
        rows.append(row)
    rows.sort(key=lambda r: (not r["hints"], r["name"].lower()))
    groups = _groups(data)
    out.update(
        {
            "rows": rows,
            "total": len(data.get("peers") or []),
            "counts": {key: counts.get(key, 0) for key in STATUS_LABELS},
            "groups": [
                {"id": gid, "name": name}
                for gid, name in sorted(groups.items(), key=lambda kv: kv[1].lower())
            ],
            "families": sorted(families),
            "approval_known": any(
                p.get("approval_required") is not None for p in data.get("peers") or []
            ),
        }
    )
    return out


def peer_detail(db: Session, now: datetime, peer_id: str) -> dict[str, Any] | None:
    state = latest_state(db)
    if state is None:
        return None
    data = state.data
    peer = next((p for p in data.get("peers") or [] if p.get("id") == peer_id), None)
    if peer is None:
        return None
    users = _users(data)
    routers = routing_peers(data)
    latest = str((data.get("version") or {}).get("available") or "")
    hints = [h for h in all_hints(data, now) if h.subject == f"peer:{peer_id}"]
    row = peer_row(peer, users, routers, latest, hints)
    groups = _groups(data)
    today = local_day(now)
    first = today - timedelta(days=6)
    days_on = set(
        db.scalars(
            select(NbPeerDay.day).where(NbPeerDay.peer_id == peer_id, NbPeerDay.day >= first)
        )
    )
    first_tracked = db.scalar(select(func.min(NbPeerDay.day)))
    history = []
    for index in range(7):
        day = first + timedelta(days=index)
        history.append(
            {
                "day": day.isoformat(),
                "connected": day in days_on,
                "known": first_tracked is not None and day >= first_tracked,
            }
        )
    row.update(
        {
            "hostname": peer.get("hostname") or "",
            "dns_label": peer.get("dns_label") or "",
            "kernel": peer.get("kernel") or "",
            "login_expires": login_expires(peer, data.get("account")),
            "login_expired": bool(peer.get("login_expired")),
            "country": peer.get("country") or "",
            "group_names": sorted(groups.get(g, g) for g in peer.get("groups") or []),
            "history": history,
            "latest_version": latest,
            "policies_available": data.get("policies") is not None,
            "targets": peer_targets(data, peer_id),
        }
    )
    return row


# --- Netze & Dienste ----------------------------------------------------------------------

NETWORK_STATES = {
    "erreichbar": "erreichbar",
    "ohne_ausfallweg": "ohne Ausfallweg",
    "nicht_erreichbar": "nicht erreichbar",
    "ohne_router": "ohne Routing-Peer",
}


def all_networks(data: Mapping[str, Any]) -> list[dict[str, Any]]:
    return list(data.get("networks") or []) + list(data.get("legacy_routes") or [])


def public_services(data: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [s for s in data.get("services") or [] if s.get("enabled")]


def availability(db: Session, now: datetime) -> dict[str, float]:
    since = now - timedelta(days=CHECK_DAYS)
    rows = db.execute(
        select(NbCheck.service_id, func.count(), func.sum(cast(NbCheck.ok, Integer)))
        .where(NbCheck.checked_at >= since)
        .group_by(NbCheck.service_id)
    ).all()
    return {sid: round(100 * (ok or 0) / total, 1) for sid, total, ok in rows if total}


def blocks_24h(db: Session, now: datetime) -> dict[str, dict[str, int]]:
    """Abweisungen durch CrowdSec je Dienst in den letzten 24 Stunden (ganze Stunden)."""
    since = now - timedelta(hours=24)
    out: dict[str, dict[str, int]] = {}
    for service_id, observe, total in db.execute(
        select(NbBlock.service_id, NbBlock.observe, func.sum(NbBlock.count))
        .where(NbBlock.hour >= since.replace(minute=0, second=0, microsecond=0))
        .group_by(NbBlock.service_id, NbBlock.observe)
    ):
        entry = out.setdefault(service_id, {"blocked": 0, "observed": 0})
        entry["observed" if observe else "blocked"] += int(total or 0)
    return out


def networks_page(db: Session, now: datetime) -> dict[str, Any]:
    out = _base(db)
    state = latest_state(db)
    data: Mapping[str, Any] = state.data if state else {}
    checks = data.get("checks") or {}
    options = load_settings(db)
    clusters = data.get("clusters") or []
    services = public_services(data)
    results = checks.get("services") or {}
    uptime = availability(db, now)
    blocks = blocks_24h(db, now)
    proxy_log = data.get("proxy_log") or {}
    crowdsec = data.get("crowdsec") or {}

    def tcp(key: str) -> dict[str, Any] | None:
        value = checks.get(key)
        return dict(value) if isinstance(value, dict) else None

    components = {
        "management": {
            "ok": state is not None and out["last_ok"] is not False,
            "ms": data.get("management_ms"),
        },
        "signal": tcp("signal") if options.signal else None,
        "relay": tcp("relay") if options.relay else None,
        "proxy": {
            "services": len(services),
            "errors": sum(
                1
                for item in services
                if item["id"] in results and not results[item["id"]].get("answered")
            ),
            "online": any(c.get("online") for c in clusters) if clusters else None,
            "crowdsec": any(c.get("crowdsec") for c in clusters),
        },
        "crowdsec": {
            "configured": bool(crowdsec.get("configured")),
            "ok": crowdsec.get("ok"),
            "total": crowdsec.get("total"),
            "own": crowdsec.get("own"),
            "error": crowdsec.get("error") or "",
            "blocked_24h": sum(b["blocked"] for b in blocks.values())
            if proxy_log.get("available")
            else None,
            "observed_24h": sum(b["observed"] for b in blocks.values())
            if proxy_log.get("available")
            else None,
        },
    }
    networks = []
    for network in all_networks(data):
        info = network_status(network, data)
        networks.append(
            {
                "id": network["id"],
                "name": network.get("name") or network["id"],
                "kind": network.get("kind") or "network",
                "ranges": [
                    r.get("address")
                    for r in network.get("resources") or []
                    if r.get("enabled", True) and r.get("address")
                ],
                **info,
                "state_label": NETWORK_STATES[info["state"]],
            }
        )
    order = {"nicht_erreichbar": 0, "ohne_ausfallweg": 1, "ohne_router": 2, "erreichbar": 3}
    networks.sort(key=lambda n: (order[n["state"]], str(n["name"]).lower()))
    service_rows = []
    for item in services:
        result = results.get(item["id"])
        target = next((t for t in item.get("targets") or [] if t.get("enabled", True)), None)
        service_rows.append(
            {
                "id": item["id"],
                "domain": item.get("domain") or item.get("name"),
                "target": f"{target['host']}:{target['port']}"
                if target and target.get("port")
                else (target or {}).get("host", ""),
                "access": item.get("access") or "",
                "private": bool(item.get("private")),
                "status_code": result.get("status_code") if result else None,
                "answered": result.get("answered") if result else None,
                "error": result.get("error") if result else "",
                "ms": result.get("ms") if result else None,
                "availability": uptime.get(item["id"]),
                "cert_expires": parse_time(result.get("cert_expires")) if result else None,
                "crowdsec_mode": item.get("crowdsec_mode") or "off",
                "blocked_24h": (blocks.get(item["id"]) or {}).get("blocked", 0),
                "observed_24h": (blocks.get(item["id"]) or {}).get("observed", 0),
                "crowdsec_exempt": str(item.get("domain") or "").lower()
                in {d.lower() for d in options.crowdsec_exempt},
            }
        )
    service_rows.sort(key=lambda r: (r["answered"] is not False, str(r["domain"]).lower()))
    out.update(
        {
            "components": components,
            "ping_enabled": options.ping,
            "proxy_log_available": bool(proxy_log.get("available")),
            "networks": networks,
            "services": service_rows,
        }
    )
    return out


# --- Richtlinien & Ereignisse ------------------------------------------------------------

EVENT_DAYS = (7, 30, 90)


def event_row(event: NbEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "at": event.at,
        "category": event.category,
        "label": event_label(event.code, event.activity),
        "object": event_object(event.code, event.meta or {}, event.target_id),
        "initiator": event.initiator or "System",
        "change": event_change(event.code, event.meta or {}),
    }


def policies_page(db: Session, now: datetime) -> dict[str, Any]:
    out = _base(db)
    state = latest_state(db)
    data: Mapping[str, Any] = state.data if state else {}
    options = load_settings(db)
    out.update(
        {
            "policies_available": data.get("policies") is not None,
            "setup_keys_available": data.get("setup_keys") is not None,
            "events_available": bool(data.get("events_available")),
            "server_groups": list(options.server_groups),
            "findings": [
                {
                    "level": f.level,
                    "code": f.code,
                    "title": f.title,
                    "text": f.text,
                    "key": f"{f.code}|{f.subject}",
                }
                for f in findings(data, now, options.server_groups)
            ],
            "policies": policy_rows(data, now),
            "setup_keys": setup_key_rows(data, now),
            "categories": [{"value": k, "label": v} for k, v in CATEGORIES.items()],
        }
    )
    return out


def events(
    db: Session, now: datetime, *, kind: str = "", days: int = 7, offset: int = 0, limit: int = 50
) -> dict[str, Any]:
    days = days if days in EVENT_DAYS else 7
    query = select(NbEvent).where(NbEvent.at >= now - timedelta(days=days))
    if kind:
        query = query.where(NbEvent.category == kind)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(
        query.order_by(NbEvent.at.desc(), NbEvent.id.desc()).offset(offset).limit(limit)
    )
    return {"total": total, "days": days, "items": [event_row(e) for e in rows]}


# --- Gruppen & Policies ------------------------------------------------------------------

CHANGES_LINK = "/monitoring/netbird/gruppen"
ACTION_LABELS = {
    "angelegt": "angelegt",
    "geaendert": "geändert",
    "geloescht": "gelöscht",
    "aktiviert": "aktiviert",
    "deaktiviert": "deaktiviert",
    "umbenannt": "umbenannt",
    "mitglieder": "Mitglieder",
}
# Filter „Art“ fasst Aktionen zusammen
ACTION_FILTER = {
    "angelegt": ("angelegt",),
    "geaendert": ("geaendert", "aktiviert", "deaktiviert", "umbenannt"),
    "geloescht": ("geloescht",),
    "mitglieder": ("mitglieder",),
}
CHANGE_DAYS = (7, 30, 90, 0)


def change_hints(db: Session) -> list[Hint]:
    """Offene Änderungen bleiben als Hinweis, bis sie bestätigt sind."""
    out: list[Hint] = []
    open_count = 0
    for change in db.scalars(
        select(NbChange).where(NbChange.status == "offen").order_by(NbChange.detected_at.desc())
    ):
        open_count += 1
        if change.critical:
            label = "Policy" if change.kind == "policy" else "Gruppe"
            out.append(
                Hint(
                    "kritisch",
                    "aenderung_kritisch",
                    f"Unbestätigte kritische Änderung an {label} {change.object_name}",
                    change.flag_text or "Die Policy nutzt eine Gruppe ohne Präfix oder „All“.",
                    f"{CHANGES_LINK}?auswahl={change.id}",
                    f"aenderung:{change.id}",
                )
            )
    if open_count:
        out.append(
            Hint(
                "warnung",
                "aenderungen_offen",
                f"{open_count} offene Änderung{'en' if open_count != 1 else ''} an Gruppen und "
                "Policies",
                "Gemeldete Änderungen bleiben offen, bis jemand mit „NetBird: Bestätigen“ sie "
                "bestätigt.",
                f"{CHANGES_LINK}?status=offen",
                "aenderungen",
            )
        )
    return out


def change_row(change: NbChange) -> dict[str, Any]:
    return {
        "id": change.id,
        "detected_at": change.detected_at,
        "kind": change.kind,
        "object_id": change.object_id,
        "object_name": change.object_name,
        "action": change.action,
        "action_label": ACTION_LABELS.get(change.action, change.action),
        "summary": change.summary,
        "initiator": change.initiator,
        "initiator_kind": change.initiator_kind,
        "flag": change.flag,
        "critical": change.critical,
        "status": change.status,
    }


def change_detail(change: NbChange, related: int) -> dict[str, Any]:
    return {
        **change_row(change),
        "fields": change.fields,
        "via": change.via,
        "flag_text": change.flag_text,
        "notified": change.notified,
        "reported": change.reported,
        "confirmed_by_name": change.confirmed_by_name,
        "confirmed_at": change.confirmed_at,
        "comment": change.comment,
        "related": related,
    }


def changes_page(
    db: Session,
    now: datetime,
    *,
    status: str = "",
    kind: str = "",
    action: str = "",
    initiator: str = "",
    days: int = 30,
    query: str = "",
    object_id: str = "",
    offset: int = 0,
    limit: int = 50,
) -> dict[str, Any]:
    out = _base(db)
    state = latest_state(db)
    data: Mapping[str, Any] = state.data if state else {}
    watch = load_watch(stored(db))
    stmt = select(NbChange)
    if status:
        stmt = stmt.where(NbChange.status == status)
    if kind:
        stmt = stmt.where(NbChange.kind == kind)
    if action:
        stmt = stmt.where(NbChange.action.in_(ACTION_FILTER[action]))
    if initiator:
        stmt = stmt.where(NbChange.initiator_kind == initiator)
    if days:
        stmt = stmt.where(NbChange.detected_at >= now - timedelta(days=days))
    if object_id:
        stmt = stmt.where(NbChange.object_id == object_id)
    if query:
        pattern = f"%{query.lower()}%"
        stmt = stmt.where(
            func.lower(NbChange.object_name).like(pattern)
            | func.lower(NbChange.summary).like(pattern)
            | func.lower(NbChange.initiator).like(pattern)
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(NbChange.detected_at.desc(), NbChange.id.desc()).offset(offset).limit(limit)
    )
    open_count = db.scalar(
        select(func.count()).select_from(NbChange).where(NbChange.status == "offen")
    )
    out.update(
        {
            "watch": {
                "active": watch.active,
                "group_prefixes": list(watch.group_prefixes),
                "policy_prefixes": list(watch.policy_prefixes) if watch.by_prefix else [],
                "by_group": watch.by_group,
                **preview(data, watch),
            },
            "open_count": open_count or 0,
            "total": total,
            "items": [change_row(c) for c in rows],
        }
    )
    return out
