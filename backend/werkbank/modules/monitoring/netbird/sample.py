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
    "g-extern": ("grp-beispiel-extern", "api"),
    "g-einkauf": ("grp-beispiel-einkauf", "integration"),
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


def _rule(sources: list[str], destinations: list[str], protocol: str, **extra: Any) -> Any:
    return {
        "name": "Regel",
        "enabled": True,
        "action": "accept",
        "bidirectional": False,
        "protocol": protocol,
        "sources": [{"id": g, "name": GROUPS[g][0]} for g in sources],
        "destinations": [{"id": g, "name": GROUPS[g][0]} for g in destinations],
        **extra,
    }


def _policies() -> list[dict[str, Any]]:
    return [
        {
            "id": "pol-admin",
            "name": "pol-beispiel-admin",
            "enabled": True,
            "source_posture_checks": [],
            "rules": [_rule(["g-all"], ["g-all"], "all", bidirectional=True)],
        },
        {
            "id": "pol-it",
            "name": "pol-beispiel-it",
            "enabled": True,
            "source_posture_checks": ["pc-1", "pc-2"],
            "rules": [
                _rule(
                    ["g-it"],
                    [],
                    "tcp",
                    ports=["22", "443", "3389"],
                    destinationResource={"id": "res-a", "type": "subnet"},
                )
            ],
        },
        {
            "id": "pol-server",
            "name": "pol-beispiel-server",
            "enabled": True,
            "source_posture_checks": [],
            "rules": [_rule(["g-vertrieb"], ["g-server"], "tcp", ports=["443"])],
        },
        {
            "id": "pol-dev",
            "name": "pol-beispiel-dev",
            "enabled": True,
            "source_posture_checks": ["pc-1"],
            "rules": [_rule(["g-it"], ["g-router"], "tcp")],
        },
        {
            "id": "pol-extern",
            "name": "pol-beispiel-extern",
            "enabled": True,
            "source_posture_checks": [],
            "rules": [_rule(["g-extern"], ["g-server"], "icmp")],
        },
        {
            "id": "pol-test",
            "name": "pol-beispiel-test",
            "enabled": False,
            "source_posture_checks": [],
            "rules": [
                _rule(["g-it"], [], "icmp", destinationResource={"id": "p-44", "type": "peer"})
            ],
        },
    ]


def _events(now: datetime) -> list[dict[str, Any]]:
    hour = timedelta(hours=1)
    return [
        {
            "id": "1005",
            "timestamp": _iso(now - hour),
            "activity": "Policy updated",
            "activity_code": "policy.update",
            "initiator_id": "u-ina",
            "initiator_name": "Ina Beispiel",
            "initiator_email": "ina@example.com",
            "target_id": "pol-admin",
            "meta": {"name": "pol-beispiel-admin"},
        },
        {
            "id": "1004",
            "timestamp": _iso(now - 2 * hour),
            "activity": "Peer added",
            "activity_code": "peer.setupkey.add",
            "initiator_id": "k-1",
            "initiator_name": "key-beispiel-server",
            "target_id": "p-44",
            "meta": {
                "name": "nb-peer-44",
                "fqdn": "nb-peer-44.netbird.example.com",
                "ip": "100.64.0.52",
                "location_connection_ip": "198.51.100.20",
                "serial_number": "SN-0000",
            },
        },
        {
            "id": "1003",
            "timestamp": _iso(now - 3 * hour),
            "activity": "Group added to peer",
            "activity_code": "peer.group.add",
            "initiator_id": "",
            "initiator_name": "",
            "target_id": "p-19",
            "meta": {
                "group": "grp-beispiel-vertrieb",
                "group_id": "g-vertrieb",
                "peer_fqdn": "nb-peer-19.netbird.example.com",
                "peer_ip": "100.64.0.45",
            },
        },
        {
            "id": "1002",
            "timestamp": _iso(now - 26 * hour),
            "activity": "Peer approved",
            "activity_code": "peer.approve",
            "initiator_id": "u-max",
            "initiator_name": "Max Muster",
            "target_id": "p-07",
            "meta": {"name": "nb-peer-07"},
        },
        {
            "id": "1001",
            "timestamp": _iso(now - timedelta(days=124)),
            "activity": "Policy updated",
            "activity_code": "policy.update",
            "initiator_id": "u-max",
            "initiator_name": "Max Muster",
            "target_id": "pol-test",
            "meta": {"name": "pol-beispiel-test"},
        },
    ]


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
        "policies": _policies(),
        "posture-checks": [
            {"id": "pc-1", "name": "Client-Version"},
            {"id": "pc-2", "name": "Betriebssystem"},
        ],
        "setup-keys": [
            {
                "id": "k-1",
                "name": "key-beispiel-server",
                "key": "A6160****",
                "type": "reusable",
                "expires": _iso(now + 6 * day),
                "valid": True,
                "revoked": False,
                "state": "valid",
                "used_times": 7,
                "usage_limit": 0,
                "auto_groups": ["g-server"],
            },
            {
                "id": "k-2",
                "name": "key-beispiel-kiosk",
                "key": "B7271****",
                "type": "one-off",
                "expires": _iso(now + 29 * day),
                "valid": True,
                "revoked": False,
                "state": "valid",
                "used_times": 0,
                "usage_limit": 1,
                "auto_groups": ["g-extern"],
            },
            {
                "id": "k-3",
                "name": "key-beispiel-router",
                "key": "C8382****",
                "type": "reusable",
                "expires": "0001-01-01T00:00:00Z",
                "valid": True,
                "revoked": False,
                "state": "valid",
                "used_times": 4,
                "usage_limit": 0,
                "auto_groups": ["g-router"],
            },
        ],
        "events/audit": _events(now),
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
