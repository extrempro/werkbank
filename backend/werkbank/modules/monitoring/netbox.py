"""Lesender Zugriff auf NetBox (Plugin netbox-dns) vom Server aus.

Adresse, Token und optional ein eigenes CA-Zertifikat trägt ein Admin in der Verwaltung ein.
NetBox steht meist im internen Netz; anders als die IT-Tools darf dieser Zugriff deshalb interne
Adressen erreichen, aber nur über https und nur die eine eingetragene Adresse.
"""

import ssl
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx

API = "plugins/netbox-dns"
PAGE_LIMIT = 1000
TIMEOUT_SECONDS = 30.0
MAX_PAGES = 200
URL_MAX = 300


class NetboxError(Exception):
    """NetBox ließ sich nicht lesen; die Meldung ist für Menschen gedacht."""


def valid_netbox_url(value: str) -> bool:
    """https-Adresse ohne Benutzerangaben, ohne Abfrage und Fragment."""
    if not value or len(value) > URL_MAX or any(ord(char) < 33 for char in value):
        return False
    parts = urlsplit(value)
    return (
        parts.scheme == "https"
        and bool(parts.hostname)
        and parts.username is None
        and parts.password is None
        and not parts.query
        and not parts.fragment
    )


def auth_header(token: str) -> str:
    """NetBox ab 4.5 vergibt „nbt_…“-Tokens (Bearer), ältere heißen „Token …“."""
    return f"Bearer {token}" if token.startswith("nbt_") else f"Token {token}"


@dataclass(frozen=True)
class NetboxConfig:
    url: str
    token: str
    # PEM eines eigenen CA-Zertifikats (interne PKI); None: Zertifikate wie üblich prüfen
    ca_pem: str | None = None


# Pfad (ohne /api/), Parameter → JSON
Getter = Callable[[NetboxConfig, str, list[tuple[str, str]]], Any]


def _verify(config: NetboxConfig) -> ssl.SSLContext | bool:
    if not config.ca_pem:
        return True
    context = ssl.create_default_context()
    try:
        context.load_verify_locations(cadata=config.ca_pem)
    except ssl.SSLError as error:
        raise NetboxError("Das CA-Zertifikat für NetBox lässt sich nicht lesen.") from error
    return context


def http_get(config: NetboxConfig, path: str, params: list[tuple[str, str]]) -> Any:
    url = f"{config.url.rstrip('/')}/api/{path.lstrip('/')}"
    try:
        response = httpx.get(
            url,
            params=httpx.QueryParams(params),
            headers={"Authorization": auth_header(config.token), "Accept": "application/json"},
            timeout=TIMEOUT_SECONDS,
            follow_redirects=False,
            verify=_verify(config),
        )
    except httpx.TimeoutException as error:
        raise NetboxError("NetBox antwortet nicht rechtzeitig.") from error
    except httpx.ConnectError as error:
        text = str(error)
        if "CERTIFICATE_VERIFY_FAILED" in text or "certificate" in text.lower():
            raise NetboxError(
                "Das Zertifikat von NetBox ist nicht vertrauenswürdig. "
                "Bitte das CA-Zertifikat in der Verwaltung hinterlegen."
            ) from error
        raise NetboxError("NetBox ist nicht erreichbar. Bitte die Adresse prüfen.") from error
    except httpx.HTTPError as error:
        raise NetboxError("NetBox ist nicht erreichbar. Bitte die Adresse prüfen.") from error
    if response.status_code in (401, 403):
        raise NetboxError("NetBox lehnt den Token ab (ungültig, abgelaufen oder ohne Leserecht).")
    if response.status_code == 404:
        raise NetboxError(
            "NetBox kennt die Schnittstelle nicht. Ist das Plugin netbox-dns installiert?"
        )
    if response.status_code != 200:
        raise NetboxError(f"NetBox antwortet mit HTTP {response.status_code}.")
    try:
        return response.json()
    except ValueError as error:
        raise NetboxError("Die Antwort von NetBox ist kein JSON. Stimmt die Adresse?") from error


def list_all(
    get: Getter, config: NetboxConfig, path: str, params: list[tuple[str, str]] | None = None
) -> list[dict[str, Any]]:
    """Alle Seiten einer Liste; NetBox begrenzt die Seitengröße selbst (MAX_PAGE_SIZE)."""
    out: list[dict[str, Any]] = []
    offset = 0
    for _ in range(MAX_PAGES):
        page = get(
            config, path, [*(params or []), ("limit", str(PAGE_LIMIT)), ("offset", str(offset))]
        )
        if not isinstance(page, dict) or not isinstance(page.get("results"), list):
            raise NetboxError("Die Antwort von NetBox hat ein unerwartetes Format.")
        results = [item for item in page["results"] if isinstance(item, dict)]
        out.extend(results)
        offset += len(page["results"])
        more = bool(page.get("next")) if "next" in page else len(out) < int(page.get("count", 0))
        if not more or not page["results"]:
            return out
    raise NetboxError("NetBox liefert zu viele Seiten.")


def netbox_status(get: Getter, config: NetboxConfig) -> tuple[str, str | None]:
    """Version von NetBox und des Plugins netbox-dns (None, wenn es fehlt)."""
    data = get(config, "status/", [])
    if not isinstance(data, dict):
        raise NetboxError("Die Antwort von NetBox hat ein unerwartetes Format.")
    plugins = data.get("plugins") if isinstance(data.get("plugins"), dict) else {}
    dns = next(
        (
            str(version)
            for name, version in (plugins or {}).items()
            if "netbox" in name.lower() and "dns" in name.lower()
        ),
        None,
    )
    return str(data.get("netbox-version", "?")), dns


def load_views(get: Getter, config: NetboxConfig) -> list[dict[str, Any]]:
    return list_all(get, config, f"{API}/views/")


def load_zones(get: Getter, config: NetboxConfig, view_id: int | None) -> list[dict[str, Any]]:
    params = [] if view_id is None else [("view_id", str(view_id))]
    return list_all(get, config, f"{API}/zones/", params)


def load_records(get: Getter, config: NetboxConfig, zone_ids: list[int]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    # mehrere Zonen je Anfrage, die Adresse bleibt kurz
    for start in range(0, len(zone_ids), 40):
        chunk = zone_ids[start : start + 40]
        records.extend(
            list_all(get, config, f"{API}/records/", [("zone_id", str(zone)) for zone in chunk])
        )
    return records
