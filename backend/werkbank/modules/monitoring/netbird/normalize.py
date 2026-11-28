"""Abruf von NetBird und Umformung in eine schlanke Form.

Gespeichert wird nur, was die Seiten brauchen. Nicht gespeichert werden öffentliche
Verbindungsadressen, Seriennummern, Netzwerkkarten und E-Mail-Adressen (bis auf den Fall, dass
ein Konto keinen Namen hat).
"""

import time
from dataclasses import dataclass, field
from typing import Any

from werkbank.modules.monitoring.netbird.client import (
    NetBirdClient,
    NetBirdError,
    NotAvailableError,
)

TEXT_MAX = 255


def _text(value: object, limit: int = TEXT_MAX) -> str:
    return str(value)[:limit] if isinstance(value, (str, int, float)) else ""


def _ids(value: object) -> list[str]:
    """[{"id": "a"}, "b", …] → ["a", "b", …]"""
    if not isinstance(value, list):
        return []
    out = []
    for item in value:
        if isinstance(item, dict) and item.get("id"):
            out.append(_text(item["id"]))
        elif isinstance(item, str):
            out.append(item[:TEXT_MAX])
    return out


def peer(item: dict[str, Any]) -> dict[str, Any]:
    approval = item.get("approval_required")
    return {
        "id": _text(item.get("id")),
        "name": _text(item.get("name")),
        "hostname": _text(item.get("hostname")),
        "ip": _text(item.get("ip")),
        "dns_label": _text(item.get("dns_label")),
        "connected": item.get("connected") is True,
        "last_seen": _text(item.get("last_seen")),
        "last_login": _text(item.get("last_login")),
        "login_expiration_enabled": item.get("login_expiration_enabled") is True,
        "login_expired": item.get("login_expired") is True,
        # Nur NetBird Cloud liefert die Freigabe; None: unbekannt (selbst gehostet)
        "approval_required": approval if isinstance(approval, bool) else None,
        "os": _text(item.get("os")),
        "kernel": _text(item.get("kernel_version")),
        "version": _text(item.get("version")),
        "user_id": _text(item.get("user_id")),
        "groups": _ids(item.get("groups")),
        "country": _text(item.get("country_code")),
        "city": _text(item.get("city_name")),
    }


def group(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _text(item.get("id")),
        "name": _text(item.get("name")),
        "issued": _text(item.get("issued")),
        "peers": _ids(item.get("peers")),
        "peers_count": item.get("peers_count") if isinstance(item.get("peers_count"), int) else 0,
        "resources_count": (
            item.get("resources_count") if isinstance(item.get("resources_count"), int) else 0
        ),
    }


def user(item: dict[str, Any]) -> dict[str, Any]:
    name = _text(item.get("name")) or _text(item.get("email"))
    return {
        "id": _text(item.get("id")),
        "name": name,
        "service": item.get("is_service_user") is True,
    }


def router(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _text(item.get("id")),
        "peer": _text(item.get("peer")),
        "peer_groups": _ids(item.get("peer_groups")),
        "enabled": item.get("enabled") is not False,
    }


def resource(item: dict[str, Any]) -> dict[str, Any]:
    kind = item.get("type")
    return {
        "id": _text(item.get("id")),
        "name": _text(item.get("name")),
        "address": _text(item.get("address")),
        "type": _text(kind) if isinstance(kind, str) else "",
        "enabled": item.get("enabled") is not False,
    }


def access_label(auth: object, private: bool) -> str:
    """Zugriff auf einen Dienst am Reverse Proxy; Passwörter und PINs werden nie übernommen."""
    if private:
        return "nur NetBird"
    data = auth if isinstance(auth, dict) else {}

    def on(key: str) -> bool:
        part = data.get(key)
        return isinstance(part, dict) and part.get("enabled") is True

    labels = []
    if on("bearer_auth"):
        labels.append("SSO")
    if on("password_auth"):
        labels.append("Passwort")
    if on("pin_auth"):
        labels.append("PIN")
    if on("link_auth"):
        labels.append("Link")
    if data.get("header_auths"):
        labels.append("Header")
    return " · ".join(labels) or "öffentlich"


def service(item: dict[str, Any]) -> dict[str, Any]:
    restrictions = item.get("access_restrictions")
    restrictions = restrictions if isinstance(restrictions, dict) else {}
    meta = item.get("meta")
    meta = meta if isinstance(meta, dict) else {}
    targets = []
    for target in item.get("targets") or []:
        if isinstance(target, dict):
            port = target.get("port")
            targets.append(
                {
                    "host": _text(target.get("host")),
                    "port": port if isinstance(port, int) else None,
                    "protocol": _text(target.get("protocol")),
                    "path": _text(target.get("path")),
                    "enabled": target.get("enabled") is not False,
                }
            )
    private = item.get("private") is True
    return {
        "id": _text(item.get("id")),
        "name": _text(item.get("name")),
        "domain": _text(item.get("domain")),
        "mode": _text(item.get("mode")) or "http",
        "enabled": item.get("enabled") is not False,
        "private": private,
        "status": _text(meta.get("status")),
        "targets": targets,
        "access": access_label(item.get("auth"), private),
        "crowdsec_mode": _text(restrictions.get("crowdsec_mode")) or "off",
        "cluster": _text(item.get("proxy_cluster")),
    }


def cluster(item: dict[str, Any]) -> dict[str, Any]:
    count = item.get("connected_proxies")
    return {
        "address": _text(item.get("address")),
        "online": item.get("online") is True,
        "connected": count if isinstance(count, int) else 0,
        "crowdsec": item.get("supports_crowdsec") is True,
    }


def _resource_ref(value: object) -> dict[str, str] | None:
    if not isinstance(value, dict) or not value.get("id"):
        return None
    return {"id": _text(value.get("id")), "type": _text(value.get("type"))}


def _port_ranges(value: object) -> list[list[int]]:
    out = []
    for item in value if isinstance(value, list) else []:
        if isinstance(item, dict):
            start, end = item.get("start"), item.get("end")
            if isinstance(start, int) and isinstance(end, int):
                out.append([start, end])
    return out


def policy_rule(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _text(item.get("name")),
        "enabled": item.get("enabled") is not False,
        "action": _text(item.get("action")) or "accept",
        "bidirectional": item.get("bidirectional") is True,
        "protocol": _text(item.get("protocol")) or "all",
        "ports": [_text(p, 20) for p in item.get("ports") or [] if isinstance(p, (str, int))],
        "port_ranges": _port_ranges(item.get("port_ranges")),
        "sources": _ids(item.get("sources")),
        "destinations": _ids(item.get("destinations")),
        "source_resource": _resource_ref(item.get("sourceResource")),
        "destination_resource": _resource_ref(item.get("destinationResource")),
    }


def policy(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": _text(item.get("id")),
        "name": _text(item.get("name")),
        "enabled": item.get("enabled") is True,
        "posture_checks": _ids(item.get("source_posture_checks")),
        "rules": [policy_rule(r) for r in item.get("rules") or [] if isinstance(r, dict)],
    }


def setup_key(item: dict[str, Any]) -> dict[str, Any]:
    """Setup-Key ohne den Schlüssel selbst."""
    used, limit = item.get("used_times"), item.get("usage_limit")
    return {
        "id": _text(item.get("id")),
        "name": _text(item.get("name")),
        "type": _text(item.get("type")),
        "expires": _text(item.get("expires")),
        "valid": item.get("valid") is True,
        "revoked": item.get("revoked") is True,
        "state": _text(item.get("state")),
        "used_times": used if isinstance(used, int) else 0,
        "usage_limit": limit if isinstance(limit, int) else 0,
        "last_used": _text(item.get("last_used")),
        "groups": _ids(item.get("auto_groups")),
        "ephemeral": item.get("ephemeral") is True,
    }


def posture_check(item: dict[str, Any]) -> dict[str, Any]:
    return {"id": _text(item.get("id")), "name": _text(item.get("name"))}


# Nur diese Angaben eines Ereignisses werden übernommen; nie Verbindungsadressen, Seriennummern
# oder Schlüssel (NetBird liefert bei Peers und Setup-Keys mehr mit).
EVENT_META = (
    "name",
    "fqdn",
    "ip",
    "peer_fqdn",
    "peer_ip",
    "group",
    "group_id",
    "type",
    "resource_name",
    "resource_type",
    "email",
    "role",
)


def event(item: dict[str, Any]) -> dict[str, Any]:
    meta = item.get("meta")
    meta = meta if isinstance(meta, dict) else {}
    return {
        "id": _text(item.get("id"), 64),
        "at": _text(item.get("timestamp")),
        "code": _text(item.get("activity_code"), 80),
        "activity": _text(item.get("activity")),
        "target_id": _text(item.get("target_id"), 64),
        "initiator_id": _text(item.get("initiator_id")),
        "initiator": _text(item.get("initiator_name")) or _text(item.get("initiator_email")),
        "meta": {key: _text(meta[key]) for key in EVENT_META if _text(meta.get(key))},
    }


def route_network(item: dict[str, Any]) -> dict[str, Any]:
    """Alte Route (vor „Networks“) als Netz mit einem Router-Eintrag."""
    return {
        "id": f"route:{_text(item.get('id'))}",
        "name": _text(item.get("network_id")) or _text(item.get("network")),
        "kind": "route",
        "routers": [router(item)],
        "resources": [
            {
                "id": _text(item.get("id")),
                "name": "",
                "address": _text(item.get("network")) or ", ".join(item.get("domains") or []),
                "type": "subnet",
                "enabled": item.get("enabled") is not False,
            }
        ],
    }


def networks(client: NetBirdClient) -> list[dict[str, Any]]:
    out = []
    for item in client.list("networks"):
        nid = _text(item.get("id"))
        out.append(
            {
                "id": nid,
                "name": _text(item.get("name")),
                "kind": "network",
                "routers": [router(r) for r in client.list(f"networks/{nid}/routers")],
                "resources": [resource(r) for r in client.list(f"networks/{nid}/resources")],
            }
        )
    return out


@dataclass
class Fetched:
    data: dict[str, Any]
    notes: list[str] = field(default_factory=list)
    # Ereignisprotokoll; None, wenn nicht lesbar (wird getrennt vom Stand gespeichert)
    events: list[dict[str, Any]] | None = None


def fetch(client: NetBirdClient) -> Fetched:
    """Liest den aktuellen Stand. Peers und Gruppen sind Pflicht, der Rest ist freiwillig."""
    notes: list[str] = []
    started = time.monotonic()
    peers = [peer(item) for item in client.list("peers")]
    data: dict[str, Any] = {
        "management_ms": int((time.monotonic() - started) * 1000),
        "peers": peers,
        "groups": [group(item) for item in client.list("groups")],
    }

    def optional(key: str, label: str, load: Any) -> None:
        try:
            data[key] = load()
        except NotAvailableError:
            data[key] = None
        except NetBirdError as error:
            data[key] = None
            notes.append(f"{label}: {error}")

    optional("users", "Benutzer", lambda: [user(item) for item in client.list("users")])
    optional(
        "routers",
        "Routing-Peers",
        lambda: [router(item) for item in client.list("networks/routers")],
    )
    optional(
        "legacy_routes", "Routen", lambda: [route_network(item) for item in client.list("routes")]
    )

    def account() -> dict[str, Any]:
        rows = client.list("accounts")
        settings = rows[0].get("settings") if rows else None
        settings = settings if isinstance(settings, dict) else {}
        expiration = settings.get("peer_login_expiration")
        return {
            "login_expiration_enabled": settings.get("peer_login_expiration_enabled") is True,
            "login_expiration_seconds": expiration if isinstance(expiration, int) else None,
        }

    optional("account", "Kontoeinstellungen", account)

    def version() -> dict[str, Any]:
        body = client.get("instance/version")
        body = body if isinstance(body, dict) else {}
        return {
            "current": _text(body.get("management_current_version")),
            "available": _text(body.get("management_available_version")),
        }

    optional("version", "Version", version)
    optional("networks", "Netze", lambda: networks(client))
    optional(
        "services",
        "Dienste am Reverse Proxy",
        lambda: [service(item) for item in client.list("reverse-proxies/services")],
    )
    optional(
        "clusters",
        "Reverse Proxy",
        lambda: [cluster(item) for item in client.list("reverse-proxies/clusters")],
    )
    optional("policies", "Richtlinien", lambda: [policy(i) for i in client.list("policies")])
    optional("setup_keys", "Setup-Keys", lambda: [setup_key(i) for i in client.list("setup-keys")])
    optional(
        "posture_checks",
        "Posture Checks",
        lambda: [posture_check(i) for i in client.list("posture-checks")],
    )
    events: list[dict[str, Any]] | None = None
    try:
        events = [event(item) for item in client.list("events/audit")]
    except NotAvailableError:
        events = None
    except NetBirdError as error:
        notes.append(f"Ereignisse: {error}")
    data["notes"] = notes
    return Fetched(data=data, notes=notes, events=events)
