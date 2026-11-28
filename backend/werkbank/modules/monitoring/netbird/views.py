"""Aufbereitung für die Seiten: Übersicht und Peers."""

from collections import Counter
from collections.abc import Mapping
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.modules.monitoring.netbird.collector import last_run, latest_state, local_day
from werkbank.modules.monitoring.netbird.config import load_settings
from werkbank.modules.monitoring.netbird.hints import (
    LEVELS,
    Hint,
    all_hints,
    login_expires,
    parse_time,
    releases_behind,
    status,
)
from werkbank.modules.monitoring.netbird.models import NbDaily, NbPeerDay

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
    for item in (data.get("routers") or []) + (data.get("legacy_routes") or []):
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
    hints = all_hints(data, now) if state else []
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
    out.update(
        {
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
        }
    )
    return row
