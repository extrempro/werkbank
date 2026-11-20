"""Lesender Zugriff auf NinjaOne (Public API v2) für den IT-Bestand.

Anmeldung als API-App mit Client-ID und Secret (OAuth 2.0 Client Credentials, Scope
„monitoring“). Gelesen werden nur Arbeitsplatzrechner (Windows, macOS, Linux) mit ihren
Kenndaten; Server, Netzwerkgeräte und andere Knoten bleiben außen vor.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

# Regionen von NinjaOne und ihre Hosts; die Adresse wird nie frei eingegeben
REGIONS: dict[str, tuple[str, str]] = {
    "eu": ("Europa", "eu.ninjarmm.com"),
    "app": ("USA", "app.ninjarmm.com"),
    "us2": ("USA 2", "us2.ninjarmm.com"),
    "ca": ("Kanada", "ca.ninjarmm.com"),
    "oc": ("Ozeanien", "oc.ninjarmm.com"),
}
WORKSTATION_CLASSES = frozenset({"WINDOWS_WORKSTATION", "MAC", "LINUX_WORKSTATION"})
LAPTOP_CHASSIS = frozenset({"LAPTOP", "NOTEBOOK", "PORTABLE", "SUB_NOTEBOOK", "TABLET"})
PAGE_SIZE = 500
MAX_PAGES = 100
TIMEOUT_SECONDS = 30.0
ERROR_TEXT = 200
TEXT_MAX = 200


class NinjaError(Exception):
    """NinjaOne ließ sich nicht lesen; die Meldung ist für Menschen gedacht."""


@dataclass(frozen=True)
class NinjaConfig:
    region: str
    client_id: str
    client_secret: str

    @property
    def base(self) -> str:
        return f"https://{REGIONS[self.region][1]}"


@dataclass(frozen=True)
class NinjaDevice:
    """Ein Arbeitsplatzrechner aus NinjaOne, auf das Nötige gekürzt."""

    ninja_id: int
    hostname: str
    serial: str
    # Notebook oder PC, abgeleitet aus der Bauform
    kind: str
    maker: str
    model: str
    os: str
    ip_addresses: tuple[str, ...]
    last_contact: datetime | None
    ram_gb: int | None
    policy: str
    node_class: str

    def facts(self) -> dict[str, Any]:
        """Was am Gerät gespeichert und im Reiter „Technik“ gezeigt wird."""
        return {
            "hostname": self.hostname,
            "serial": self.serial,
            "kind": self.kind,
            "maker": self.maker,
            "model": self.model,
            "os": self.os,
            "ip": list(self.ip_addresses),
            "last_contact": self.last_contact.isoformat() if self.last_contact else None,
            "ram_gb": self.ram_gb,
            "policy": self.policy,
        }


def _text(value: Any, limit: int = TEXT_MAX) -> str:
    return " ".join(value.split())[:limit] if isinstance(value, str) else ""


def _moment(value: Any) -> datetime | None:
    """NinjaOne liefert Zeitpunkte als Sekunden seit 1970 (auch mit Nachkommastellen)."""
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    try:
        return datetime.fromtimestamp(float(value), tz=UTC)
    except (OverflowError, OSError, ValueError):
        return None


def _serial(system: dict[str, Any]) -> str:
    """Seriennummer; Platzhalter mancher Hersteller zählen als leer."""
    for key in ("serialNumber", "biosSerialNumber"):
        value = _text(system.get(key), 80)
        if value and value.casefold() not in {
            "to be filled by o.e.m.",
            "default string",
            "system serial number",
            "0",
            "none",
        }:
            return value
    return ""


def _part(item: dict[str, Any], key: str) -> dict[str, Any]:
    value = item.get(key)
    return value if isinstance(value, dict) else {}


def parse_device(item: dict[str, Any], policies: dict[int, str]) -> NinjaDevice | None:
    """Ein Eintrag aus /v2/devices-detailed; None für Nicht-Arbeitsplatzrechner."""
    ninja_id = item.get("id")
    node_class = item.get("nodeClass")
    if isinstance(ninja_id, bool) or not isinstance(ninja_id, int) or ninja_id < 1:
        return None
    if node_class not in WORKSTATION_CLASSES:
        return None
    system = _part(item, "system")
    os_info = _part(item, "os")
    memory = _part(item, "memory")
    chassis = _text(system.get("chassisType"), 40).upper()
    kind = "Notebook" if chassis in LAPTOP_CHASSIS else "PC"
    capacity = memory.get("capacity")
    ram_gb = (
        round(capacity / 1024**3)
        if isinstance(capacity, int | float) and not isinstance(capacity, bool) and capacity > 0
        else None
    )
    addresses = item.get("ipAddresses")
    ips = tuple(
        _text(address, 45)
        for address in (addresses if isinstance(addresses, list) else [])
        if isinstance(address, str) and _text(address, 45)
    )[:8]
    policy_id = item.get("policyId")
    return NinjaDevice(
        ninja_id=ninja_id,
        hostname=_text(item.get("systemName"), 80) or _text(item.get("dnsName"), 80),
        serial=_serial(system),
        kind=kind,
        maker=_text(system.get("manufacturer"), 80),
        model=_text(system.get("model"), 120),
        os=_text(os_info.get("name"), 120),
        ip_addresses=ips,
        last_contact=_moment(item.get("lastContact")),
        ram_gb=ram_gb,
        policy=policies.get(policy_id, "") if isinstance(policy_id, int) else "",
        node_class=str(node_class),
    )


class NinjaClient:
    """Anmeldung und die zwei Abfragen, die der Abgleich braucht."""

    def __init__(self, config: NinjaConfig, http: httpx.Client) -> None:
        self._config = config
        self._http = http
        self._token: str | None = None

    def _login(self) -> str:
        try:
            response = self._http.post(
                f"{self._config.base}/ws/oauth/token",
                data={
                    "grant_type": "client_credentials",
                    "client_id": self._config.client_id,
                    "client_secret": self._config.client_secret,
                    "scope": "monitoring",
                },
                headers={"Accept": "application/json"},
            )
        except httpx.HTTPError as exc:
            raise NinjaError(f"NinjaOne nicht erreichbar: {type(exc).__name__}") from exc
        if response.status_code in (400, 401, 403):
            raise NinjaError("Anmeldung bei NinjaOne abgelehnt. Bitte Client-ID und Secret prüfen.")
        if response.status_code >= 400:
            raise NinjaError(f"NinjaOne antwortet bei der Anmeldung mit {response.status_code}.")
        try:
            token = response.json().get("access_token")
        except (ValueError, AttributeError) as exc:
            raise NinjaError("Unerwartete Antwort von NinjaOne bei der Anmeldung.") from exc
        if not isinstance(token, str) or not token:
            raise NinjaError("NinjaOne hat kein Zugriffstoken geliefert.")
        return token

    def get(self, path: str, params: dict[str, str] | None = None) -> Any:
        if self._token is None:
            self._token = self._login()
        try:
            response = self._http.get(
                f"{self._config.base}/api/v2/{path}",
                params=params or {},
                headers={"Authorization": f"Bearer {self._token}", "Accept": "application/json"},
            )
        except httpx.HTTPError as exc:
            raise NinjaError(f"NinjaOne nicht erreichbar: {type(exc).__name__}") from exc
        if response.status_code in (401, 403):
            raise NinjaError(
                "NinjaOne verweigert den Zugriff. Hat die API-App den Scope „Monitoring“?"
            )
        if response.status_code >= 400:
            raise NinjaError(
                f"NinjaOne antwortet mit {response.status_code}: {_text(response.text, ERROR_TEXT)}"
            )
        try:
            return response.json()
        except ValueError as exc:
            raise NinjaError("Antwort von NinjaOne ist kein JSON.") from exc


Fetcher = Callable[[NinjaConfig], list[NinjaDevice]]


def load_devices(client: NinjaClient) -> list[NinjaDevice]:
    """Alle Arbeitsplatzrechner, seitenweise (nach der letzten ID)."""
    policies: dict[int, str] = {}
    data = client.get("policies")
    for entry in data if isinstance(data, list) else []:
        if isinstance(entry, dict) and isinstance(entry.get("id"), int):
            policies[entry["id"]] = _text(entry.get("name"), 120)
    devices: list[NinjaDevice] = []
    after: int | None = None
    for _ in range(MAX_PAGES):
        params = {"pageSize": str(PAGE_SIZE)}
        if after is not None:
            params["after"] = str(after)
        page = client.get("devices-detailed", params)
        if not isinstance(page, list):
            raise NinjaError("Unerwartete Antwort von NinjaOne (Geräteliste).")
        ids = [item.get("id") for item in page if isinstance(item, dict)]
        for item in page:
            if isinstance(item, dict):
                device = parse_device(item, policies)
                if device is not None:
                    devices.append(device)
        numeric = [value for value in ids if isinstance(value, int)]
        if len(page) < PAGE_SIZE or not numeric:
            return devices
        after = max(numeric)
    raise NinjaError("Zu viele Geräte in NinjaOne; der Abgleich hat abgebrochen.")


def fetch_devices(config: NinjaConfig) -> list[NinjaDevice]:
    with httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False) as http:
        return load_devices(NinjaClient(config, http))
