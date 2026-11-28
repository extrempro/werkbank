"""Lesender Zugriff auf die Management-API eines selbst gehosteten NetBird.

Die Werkbank liest nur (GET) und nur von der eingetragenen https-Adresse, ohne Weiterleitungen,
mit TLS-Prüfung, Zeit- und Größenlimit. Anmeldung mit dem Token eines Dienstkontos im Header
`Authorization: Token …`.
"""

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

import httpx

from werkbank.modules.monitoring.fortigate.client import valid_url

TIMEOUT_SECONDS = 20.0
MAX_RESPONSE_BYTES = 40 * 1024 * 1024

__all__ = ["NetBirdClient", "NetBirdConfig", "NetBirdError", "NotAvailableError", "valid_url"]


class NetBirdError(Exception):
    """NetBird ließ sich nicht lesen; die Meldung ist für Menschen gedacht."""


class NotAvailableError(NetBirdError):
    """Den Endpunkt gibt es auf diesem Server nicht (HTTP 404)."""


@dataclass(frozen=True)
class NetBirdConfig:
    url: str
    token: str


# Holt einen Pfad unter /api/: Zugang, Pfad, Parameter → JSON-Antwort
Transport = Callable[[NetBirdConfig, str, Mapping[str, str]], Any]


def http_transport(config: NetBirdConfig, path: str, params: Mapping[str, str]) -> Any:
    url = f"{config.url.rstrip('/')}/api/{path}"
    headers = {"Accept": "application/json", "Authorization": f"Token {config.token}"}
    try:
        with (
            httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False) as client,
            client.stream("GET", url, params=dict(params), headers=headers) as res,
        ):
            if 300 <= res.status_code < 400:
                raise NetBirdError(
                    f"NetBird leitet weiter (HTTP {res.status_code}). Bitte die Adresse direkt "
                    "eintragen."
                )
            if res.status_code == 401:
                raise NetBirdError("Das API-Token wird abgelehnt (HTTP 401).")
            if res.status_code == 403:
                raise NetBirdError("Zugriff verweigert (HTTP 403). Hat das Dienstkonto Leserechte?")
            if res.status_code == 404:
                raise NotAvailableError(f"Den Endpunkt {path} gibt es auf diesem Server nicht.")
            if res.status_code != 200:
                raise NetBirdError(f"NetBird antwortet mit HTTP {res.status_code}.")
            data = bytearray()
            for chunk in res.iter_bytes():
                data.extend(chunk)
                if len(data) > MAX_RESPONSE_BYTES:
                    raise NetBirdError("Die Antwort von NetBird ist zu groß.")
    except httpx.TimeoutException as error:
        raise NetBirdError("NetBird antwortet nicht rechtzeitig.") from error
    except httpx.ConnectError as error:
        if "certificate" in str(error).lower():
            raise NetBirdError("Das Zertifikat von NetBird ist nicht vertrauenswürdig.") from error
        raise NetBirdError("NetBird ist nicht erreichbar.") from error
    except httpx.HTTPError as error:
        raise NetBirdError("Verbindung zu NetBird fehlgeschlagen.") from error
    try:
        return json.loads(bytes(data))
    except ValueError as error:
        raise NetBirdError("Die Antwort von NetBird ist kein JSON.") from error


class NetBirdClient:
    def __init__(self, config: NetBirdConfig, transport: Transport | None = None) -> None:
        self.config = config
        self.transport = transport or http_transport

    def get(self, path: str, **params: str) -> Any:
        return self.transport(self.config, path, params)

    def list(self, path: str, **params: str) -> list[dict[str, Any]]:
        body = self.get(path, **params)
        if not isinstance(body, list):
            raise NetBirdError(f"Unerwartete Antwort von NetBird bei {path}.")
        return [item for item in body if isinstance(item, dict)]
