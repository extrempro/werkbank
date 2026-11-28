"""Erfundene NetBird-Daten für Tests und die Test-Umgebung (keine echten Namen oder Netze).

Zeiten sind relativ zum Aufruf, damit Hinweise wie „läuft in 7 Tagen ab“ immer greifen.
"""

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from werkbank.modules.monitoring.netbird.client import NetBirdConfig, NotAvailableError

GROUPS = {
    "g-it": ("grp-beispiel-it", "integration"),
    "g-vertrieb": ("grp-beispiel-vertrieb", "integration"),
    "g-router": ("grp-beispiel-router", "api"),
    "g-server": ("grp-beispiel-server", "api"),
    "g-all": ("All", "api"),
}


def _iso(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _peer(
    pid: str,
    name: str,
    *,
    connected: bool,
    seen: timedelta,
    version: str,
    os: str,
    groups: list[str],
    user: str = "",
    login: timedelta | None = None,
    expired: bool = False,
    now: datetime,
) -> dict[str, Any]:
    return {
        "id": pid,
        "name": name,
        "hostname": name,
        "ip": f"100.64.0.{len(pid) * 7 % 200 + 10}",
        "dns_label": f"{name}.netbird.example.com",
        "connected": connected,
        "last_seen": _iso(now - seen),
        "last_login": _iso(now - login) if login is not None else "0001-01-01T00:00:00Z",
        "login_expiration_enabled": bool(user),
        "login_expired": expired,
        "os": os,
        "kernel_version": "",
        "version": version,
        "user_id": user,
        "groups": [{"id": g, "name": GROUPS[g][0]} for g in groups],
        "country_code": "DE",
        "city_name": "",
        "connection_ip": "198.51.100.20",
        "serial_number": "SN-0000",
    }


def responses(now: datetime | None = None) -> dict[str, Any]:
    now = now or datetime.now(UTC)
    minute = timedelta(minutes=1)
    day = timedelta(days=1)
    peers = [
        _peer(
            "p-router-01",
            "nb-router-01",
            connected=True,
            seen=minute,
            version="0.60.2",
            os="Linux",
            groups=["g-router", "g-all"],
            now=now,
        ),
        _peer(
            "p-router-02",
            "nb-router-02",
            connected=False,
            seen=40 * minute,
            version="0.60.2",
            os="Linux",
            groups=["g-router", "g-all"],
            now=now,
        ),
        _peer(
            "p-07",
            "nb-peer-07",
            connected=True,
            seen=minute,
            version="0.60.2",
            os="Windows 11",
            groups=["g-it", "g-all"],
            user="u-ina",
            login=25 * day,
            now=now,
        ),
        _peer(
            "p-19",
            "nb-peer-19",
            connected=False,
            seen=2 * day,
            version="0.58.1",
            os="macOS 15",
            groups=["g-vertrieb", "g-all"],
            user="u-max",
            login=31 * day,
            expired=True,
            now=now,
        ),
        _peer(
            "p-23",
            "nb-peer-23",
            connected=False,
            seen=97 * day,
            version="0.55.0",
            os="Windows 11",
            groups=["g-vertrieb", "g-all"],
            user="u-eva",
            login=120 * day,
            expired=True,
            now=now,
        ),
        _peer(
            "p-44",
            "nb-peer-44",
            connected=True,
            seen=minute,
            version="0.60.2",
            os="Linux",
            groups=["g-server", "g-all"],
            now=now,
        ),
    ]
    groups = []
    for gid, (name, issued) in GROUPS.items():
        members = [p["id"] for p in peers if any(g["id"] == gid for g in p["groups"])]
        groups.append(
            {
                "id": gid,
                "name": name,
                "issued": issued,
                "peers_count": len(members),
                "peers": [{"id": m, "name": m} for m in members],
            }
        )
    return {
        "peers": peers,
        "groups": groups,
        "users": [
            {"id": "u-ina", "name": "Ina Beispiel", "email": "ina@example.com"},
            {"id": "u-max", "name": "Max Muster", "email": "max@example.com"},
            {"id": "u-eva", "name": "", "email": "eva@example.com"},
        ],
        "networks/routers": [
            {"id": "r-1", "peer": "p-router-01", "enabled": True},
            {"id": "r-2", "peer": "p-router-02", "enabled": True},
        ],
        "routes": [],
        "accounts": [
            {
                "id": "acc-1",
                "settings": {
                    "peer_login_expiration_enabled": True,
                    "peer_login_expiration": 30 * 24 * 3600,
                },
            }
        ],
        "instance/version": {
            "management_current_version": "0.60.2",
            "management_available_version": "0.60.2",
        },
    }


def sample_transport(config: NetBirdConfig, path: str, params: Mapping[str, str]) -> Any:
    data = responses()
    if path in data:
        return data[path]
    raise NotAvailableError(f"Den Endpunkt {path} gibt es auf diesem Server nicht.")
