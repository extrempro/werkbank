"""FortiAnalyzer: Wer hat etwas an einer FortiGate geändert? (nur lesend)

Gelesen werden Event-Logs der Konfiguration (Log-ID 0100044547, „Attribute configured“) über
die JSON-RPC-API (`/jsonrpc`, Log-Suche: anlegen, Ergebnis holen). Anmeldung mit dem
API-Schlüssel eines Benutzers mit Leserecht. Wie bei den FortiGates: nur die eingetragene
https-Adresse, keine Weiterleitungen, TLS-Prüfung, Zeitlimit und Größenlimit.
"""

import json
import ssl
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx

from werkbank.modules.monitoring.fortigate.client import (
    MAX_RESPONSE_BYTES,
    TIMEOUT_SECONDS,
    FortiGateError,
)

CONFIG_LOGID = "0100044547"
EVENTS_MAX = 200
POLL_TRIES = 10
POLL_WAIT = 0.5
TEXT_MAX = 255


class AnalyzerError(FortiGateError):
    """Der FortiAnalyzer ließ sich nicht abfragen; die Meldung ist für Menschen gedacht."""


@dataclass(frozen=True)
class AnalyzerConfig:
    url: str
    adom: str
    key: str
    ca_pem: str | None = None


# Schickt eine JSON-RPC-Anfrage und liefert die Antwort
AnalyzerTransport = Callable[[AnalyzerConfig, dict[str, Any]], dict[str, Any]]


def http_transport(config: AnalyzerConfig, payload: dict[str, Any]) -> dict[str, Any]:
    verify: ssl.SSLContext | bool = True
    if config.ca_pem:
        verify = ssl.create_default_context()
        try:
            verify.load_verify_locations(cadata=config.ca_pem)
        except ssl.SSLError as error:
            raise AnalyzerError("Das CA-Zertifikat lässt sich nicht lesen.") from error
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": f"Bearer {config.key}",
    }
    try:
        with (
            httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False, verify=verify) as client,
            client.stream(
                "POST", f"{config.url.rstrip('/')}/jsonrpc", json=payload, headers=headers
            ) as res,
        ):
            if res.status_code in (401, 403):
                raise AnalyzerError(
                    f"Der FortiAnalyzer lehnt den API-Schlüssel ab (HTTP {res.status_code})."
                )
            if res.status_code != 200:
                raise AnalyzerError(f"Der FortiAnalyzer antwortet mit HTTP {res.status_code}.")
            data = bytearray()
            for chunk in res.iter_bytes():
                data.extend(chunk)
                if len(data) > MAX_RESPONSE_BYTES:
                    raise AnalyzerError("Die Antwort des FortiAnalyzers ist zu groß.")
    except httpx.TimeoutException as error:
        raise AnalyzerError("Der FortiAnalyzer antwortet nicht rechtzeitig.") from error
    except httpx.HTTPError as error:
        raise AnalyzerError("Der FortiAnalyzer ist nicht erreichbar.") from error
    try:
        body = json.loads(bytes(data))
    except ValueError as error:
        raise AnalyzerError("Die Antwort des FortiAnalyzers ist kein JSON.") from error
    if not isinstance(body, dict):
        raise AnalyzerError("Unerwartete Antwort des FortiAnalyzers.")
    return body


def _result(body: dict[str, Any]) -> dict[str, Any]:
    result = body.get("result")
    if isinstance(result, list):
        result = result[0] if result else {}
    if not isinstance(result, dict):
        raise AnalyzerError("Unerwartete Antwort des FortiAnalyzers.")
    status = result.get("status")
    if isinstance(status, dict) and status.get("code") not in (0, None):
        raise AnalyzerError(
            f"Der FortiAnalyzer meldet einen Fehler: {str(status.get('message'))[:200]}"
        )
    return result


def _clip(value: object) -> str:
    return str(value)[:TEXT_MAX] if isinstance(value, (str, int, float)) else ""


def config_events(
    config: AnalyzerConfig,
    devname: str,
    start: datetime,
    end: datetime,
    transport: AnalyzerTransport | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> list[dict[str, Any]]:
    """Änderungen an der Konfiguration eines Geräts im Zeitraum (höchstens EVENTS_MAX)."""
    send = transport or http_transport
    url = f"/logview/adom/{config.adom}/logsearch"
    created = _result(
        send(
            config,
            {
                "id": 1,
                "jsonrpc": "2.0",
                "method": "add",
                "params": [
                    {
                        "apiver": 3,
                        "url": url,
                        "logtype": "event",
                        "device": [{"devname": devname}],
                        "filter": f"logid=={CONFIG_LOGID}",
                        "time-order": "asc",
                        "time-range": {
                            "start": start.strftime("%Y-%m-%d %H:%M:%S"),
                            "end": end.strftime("%Y-%m-%d %H:%M:%S"),
                        },
                    }
                ],
            },
        )
    )
    tid = created.get("tid")
    if not isinstance(tid, int):
        raise AnalyzerError("Der FortiAnalyzer hat die Suche nicht angelegt.")
    for _ in range(POLL_TRIES):
        answer = _result(
            send(
                config,
                {
                    "id": 2,
                    "jsonrpc": "2.0",
                    "method": "get",
                    "params": [
                        {"apiver": 3, "url": f"{url}/{tid}", "offset": 0, "limit": EVENTS_MAX}
                    ],
                },
            )
        )
        if answer.get("percentage", 100) >= 100:
            rows = answer.get("data") or []
            return [
                {
                    "time": _clip(row.get("itime") or f"{row.get('date')} {row.get('time')}"),
                    "user": _clip(row.get("user")),
                    "ui": _clip(row.get("ui")),
                    "action": _clip(row.get("action")),
                    "cfgpath": _clip(row.get("cfgpath")),
                    "cfgobj": _clip(row.get("cfgobj")),
                    "cfgattr": _clip(row.get("cfgattr"))[:TEXT_MAX],
                }
                for row in rows[:EVENTS_MAX]
                if isinstance(row, dict)
            ]
        sleep(POLL_WAIT)
    raise AnalyzerError("Die Suche im FortiAnalyzer dauert zu lange.")
