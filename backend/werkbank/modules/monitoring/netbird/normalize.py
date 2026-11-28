"""Abruf von NetBird und Umformung in eine schlanke Form.

Gespeichert wird nur, was die Seiten brauchen. Nicht gespeichert werden öffentliche
Verbindungsadressen, Seriennummern, Netzwerkkarten und E-Mail-Adressen (bis auf den Fall, dass
ein Konto keinen Namen hat).
"""

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


@dataclass
class Fetched:
    data: dict[str, Any]
    notes: list[str] = field(default_factory=list)


def fetch(client: NetBirdClient) -> Fetched:
    """Liest den aktuellen Stand. Peers und Gruppen sind Pflicht, der Rest ist freiwillig."""
    notes: list[str] = []
    data: dict[str, Any] = {
        "peers": [peer(item) for item in client.list("peers")],
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
    optional("legacy_routes", "Routen", lambda: [router(item) for item in client.list("routes")])

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
    data["notes"] = notes
    return Fetched(data=data, notes=notes)
