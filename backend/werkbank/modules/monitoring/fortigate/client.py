"""Lesender Zugriff auf die REST-API von FortiOS (7.6).

Die Werkbank fragt jedes Gerät direkt ab, nie über den Fabric Root, und nur mit GET. Anmeldung
mit dem API-Token eines Nur-Lese-Benutzers im Header `Authorization: Bearer …`. Erreicht wird
nur die eingetragene https-Adresse, ohne Weiterleitungen, mit TLS-Prüfung (optional gegen ein
eigenes CA-Zertifikat, z. B. das der internen PKI).
"""

import json
import ssl
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx

TIMEOUT_SECONDS = 20.0
MAX_RESPONSE_BYTES = 40 * 1024 * 1024
URL_MAX = 300
API_PREFIX = "/api/v2/"


class FortiGateError(Exception):
    """Das Gerät ließ sich nicht lesen; die Meldung ist für Menschen gedacht."""


class NotAvailableError(FortiGateError):
    """Den Endpunkt gibt es auf diesem Gerät nicht (HTTP 404)."""


def valid_url(value: str) -> bool:
    """https-Adresse der Verwaltung ohne Benutzerangaben, Pfad, Abfrage und Fragment."""
    if not value or len(value) > URL_MAX or any(ord(char) < 33 for char in value):
        return False
    parts = urlsplit(value)
    return (
        parts.scheme == "https"
        and bool(parts.hostname)
        and parts.username is None
        and parts.password is None
        and parts.path in ("", "/")
        and not parts.query
        and not parts.fragment
    )


@dataclass(frozen=True)
class DeviceConfig:
    name: str
    url: str
    token: str
    ca_pem: str | None = None


# Holt einen Pfad unter /api/v2/: Gerät, Pfad, Parameter → JSON-Antwort
Transport = Callable[[DeviceConfig, str, Mapping[str, str]], Any]


def _verify(config: DeviceConfig) -> ssl.SSLContext | bool:
    if not config.ca_pem:
        return True
    context = ssl.create_default_context()
    try:
        context.load_verify_locations(cadata=config.ca_pem)
    except ssl.SSLError as error:
        raise FortiGateError(
            "Das CA-Zertifikat für die FortiGates lässt sich nicht lesen."
        ) from error
    return context


def http_transport(config: DeviceConfig, path: str, params: Mapping[str, str]) -> Any:
    url = f"{config.url.rstrip('/')}{API_PREFIX}{path}"
    headers = {"Accept": "application/json", "Authorization": f"Bearer {config.token}"}
    try:
        with (
            httpx.Client(
                timeout=TIMEOUT_SECONDS, follow_redirects=False, verify=_verify(config)
            ) as client,
            client.stream("GET", url, params=dict(params), headers=headers) as res,
        ):
            if 300 <= res.status_code < 400:
                raise FortiGateError(
                    f"Das Gerät leitet weiter (HTTP {res.status_code}). Bitte die Adresse der "
                    "Verwaltung direkt eintragen."
                )
            if res.status_code == 401:
                raise FortiGateError("Das API-Token wird abgelehnt (HTTP 401).")
            if res.status_code == 403:
                raise FortiGateError(
                    "Zugriff verweigert (HTTP 403). Stimmen die Trusted Hosts des API-Benutzers "
                    "und das Nur-Lese-Profil?"
                )
            if res.status_code == 404:
                raise NotAvailableError(f"Den Endpunkt {path} gibt es auf diesem Gerät nicht.")
            if res.status_code != 200:
                raise FortiGateError(f"Das Gerät antwortet mit HTTP {res.status_code}.")
            data = bytearray()
            for chunk in res.iter_bytes():
                data.extend(chunk)
                if len(data) > MAX_RESPONSE_BYTES:
                    raise FortiGateError("Die Antwort des Geräts ist zu groß.")
    except httpx.TimeoutException as error:
        raise FortiGateError("Das Gerät antwortet nicht rechtzeitig.") from error
    except httpx.ConnectError as error:
        text = str(error)
        if "CERTIFICATE_VERIFY_FAILED" in text or "certificate" in text.lower():
            raise FortiGateError(
                "Das Zertifikat des Geräts ist nicht vertrauenswürdig. Ist das CA-Zertifikat "
                "hinterlegt und passt der Name in der Adresse zum Zertifikat?"
            ) from error
        raise FortiGateError("Das Gerät ist nicht erreichbar.") from error
    except httpx.HTTPError as error:
        raise FortiGateError("Verbindung zum Gerät fehlgeschlagen.") from error
    try:
        return json.loads(bytes(data))
    except ValueError as error:
        raise FortiGateError("Die Antwort des Geräts ist kein JSON.") from error


@dataclass(frozen=True)
class Answer:
    """Antwort von FortiOS: `results` und die Angaben aus dem Umschlag."""

    results: Any
    version: str
    serial: str
    build: int | None


class FortiGateClient:
    def __init__(self, config: DeviceConfig, transport: Transport | None = None) -> None:
        self.config = config
        self.transport = transport or http_transport

    def get(self, path: str, **params: str) -> Answer:
        body = self.transport(self.config, path, params)
        if not isinstance(body, dict):
            raise FortiGateError("Unerwartete Antwort des Geräts.")
        if body.get("status") not in (None, "success"):
            raise FortiGateError(f"Das Gerät meldet einen Fehler bei {path}.")
        build = body.get("build")
        return Answer(
            results=body.get("results"),
            version=str(body.get("version") or ""),
            serial=str(body.get("serial") or ""),
            build=build if isinstance(build, int) else None,
        )

    def cmdb(self, path: str) -> list[dict[str, Any]]:
        """Liste aus der Konfiguration (z. B. firewall/policy) in der Reihenfolge des Geräts."""
        results = self.get(f"cmdb/{path}").results
        if isinstance(results, dict):
            return [results]
        return [item for item in results or [] if isinstance(item, dict)]

    def monitor(self, path: str, **params: str) -> Answer:
        return self.get(f"monitor/{path}", **params)
