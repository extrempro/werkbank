"""Erfundene NetBird-Daten für Tests und die Test-Umgebung (keine echten Namen oder Netze).

Zeiten sind relativ zum Aufruf, damit Hinweise wie „läuft in 7 Tagen ab“ immer greifen.
"""

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from werkbank.modules.monitoring.netbird.client import NetBirdConfig, NotAvailableError

if TYPE_CHECKING:
    from werkbank.modules.monitoring.netbird.checks import Checker

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
            {"id": "r-3", "peer_groups": ["g-router"], "enabled": True},
        ],
        "networks": [
            {"id": "n-a", "name": "net-beispiel-a", "routers": ["r-1"], "resources": ["res-a"]},
            {"id": "n-b", "name": "net-beispiel-b", "routers": ["r-2"], "resources": ["res-b"]},
            {"id": "n-s", "name": "net-beispiel-server", "routers": ["r-3"], "resources": []},
        ],
        "networks/n-a/routers": [{"id": "r-1", "peer": "p-router-01", "enabled": True}],
        "networks/n-a/resources": [
            {"id": "res-a", "name": "Büronetz", "address": "10.0.0.0/24", "type": "subnet"},
            {"id": "res-a2", "name": "Drucker", "address": "10.0.0.20/32", "type": "host"},
        ],
        "networks/n-b/routers": [{"id": "r-2", "peer": "p-router-02", "enabled": True}],
        "networks/n-b/resources": [
            {"id": "res-b", "name": "Labor", "address": "10.0.20.0/24", "type": "subnet"}
        ],
        "networks/n-s/routers": [{"id": "r-3", "peer_groups": ["g-router"], "enabled": True}],
        "networks/n-s/resources": [],
        "reverse-proxies/services": [
            {
                "id": "s-wiki",
                "name": "wiki",
                "domain": "wiki.example.com",
                "mode": "http",
                "enabled": True,
                "targets": [{"host": "10.0.30.21", "port": 3000, "protocol": "http"}],
                "auth": {"bearer_auth": {"enabled": True}},
                "access_restrictions": {"crowdsec_mode": "enforce"},
                "meta": {"status": "active"},
            },
            {
                "id": "s-git",
                "name": "git",
                "domain": "git.example.com",
                "mode": "http",
                "enabled": True,
                "targets": [{"host": "10.0.30.22", "port": 3000, "protocol": "http"}],
                "auth": {"bearer_auth": {"enabled": True}},
                "access_restrictions": {"crowdsec_mode": "enforce"},
                "meta": {"status": "active"},
            },
            {
                "id": "s-files",
                "name": "files",
                "domain": "files.example.com",
                "mode": "http",
                "enabled": True,
                "targets": [{"host": "10.0.30.27", "port": 443, "protocol": "https"}],
                "auth": {"password_auth": {"enabled": True, "password": "geheim-beispiel"}},
                "meta": {"status": "active"},
            },
            {
                "id": "s-intern",
                "name": "intern",
                "domain": "intern.example.com",
                "mode": "http",
                "enabled": True,
                "private": True,
                "targets": [{"host": "10.0.30.30", "port": 80, "protocol": "http"}],
                "meta": {"status": "active"},
            },
        ],
        "reverse-proxies/clusters": [
            {
                "address": "proxy.example.com",
                "online": True,
                "connected_proxies": 1,
                "supports_crowdsec": True,
            }
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


def sample_checker() -> Checker:
    """Prüfungen ohne Netz: wiki antwortet mit 502, git mit Zertifikat kurz vor Ablauf."""
    from werkbank.modules.monitoring.netbird.checks import Checker, HttpsResult, TcpResult

    now = datetime.now(UTC)

    def https(domain: str) -> HttpsResult:
        if domain == "wiki.example.com":
            return HttpsResult(502, 120, now + timedelta(days=80), "")
        if domain == "git.example.com":
            return HttpsResult(302, 142, now + timedelta(days=21), "")
        return HttpsResult(200, 210, now + timedelta(days=60), "")

    return Checker(
        https=https,
        tcp=lambda target: TcpResult(True, 12, ""),
        ping=lambda address: True,
    )
