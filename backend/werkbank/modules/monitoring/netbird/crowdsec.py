"""CrowdSec (Phase 4): aktive Sperren aus der Local API und Abweisungen je Dienst aus dem
Zugriffsprotokoll des NetBird Reverse Proxy.

Local API: nur lesend mit einem eigenen Bouncer-Schlüssel (`GET /v1/decisions`, Header
`X-Api-Key`), ohne Weiterleitungen, mit Zeit- und Größenlimit. Eigene Sperren sind die, die die
eigene CrowdSec-Instanz erkannt oder jemand von Hand gesetzt hat (Herkunft `crowdsec`, `cscli`);
der Rest stammt aus Listen der Community.

Zugriffsprotokoll: `GET /api/events/proxy` seitenweise ab dem letzten gelesenen Zeitpunkt. Die
Werkbank zählt nur Einträge mit `metadata.crowdsec_verdict` je Dienst und Stunde; Adressen,
Personen und Pfade werden nicht gespeichert. Im Modus „beobachten“ steht zusätzlich
`crowdsec_mode = observe`: Die Anfrage ging durch, wäre aber abgewiesen worden.
"""

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

import httpx

from werkbank.modules.monitoring.netbird.client import NetBirdClient, NetBirdError
from werkbank.modules.monitoring.netbird.policies import parse_iso

TIMEOUT_SECONDS = 10.0
MAX_RESPONSE_BYTES = 40 * 1024 * 1024
URL_MAX = 300
OWN_ORIGINS = ("crowdsec", "cscli")
PAGE_SIZE = 100
MAX_PAGES = 30
FIRST_WINDOW = timedelta(hours=24)


class CrowdSecError(Exception):
    """Die Local API ließ sich nicht lesen; die Meldung ist für Menschen gedacht."""


@dataclass(frozen=True)
class LapiConfig:
    url: str
    key: str


# Holt die aktiven Sperren: Zugang → JSON-Antwort (Liste oder null)
LapiTransport = Callable[[LapiConfig], Any]


def valid_lapi_url(value: str) -> bool:
    """http- oder https-Adresse der Local API ohne Benutzerangaben, Pfad, Abfrage und Fragment."""
    if not value or len(value) > URL_MAX or any(ord(char) < 33 for char in value):
        return False
    parts = urlsplit(value)
    try:
        port = parts.port
    except ValueError:
        return False
    return (
        parts.scheme in ("http", "https")
        and bool(parts.hostname)
        and parts.username is None
        and parts.password is None
        and parts.path in ("", "/")
        and not parts.query
        and not parts.fragment
        and (port is None or 0 < port < 65536)
    )


def http_lapi(config: LapiConfig) -> Any:
    url = f"{config.url.rstrip('/')}/v1/decisions"
    headers = {"Accept": "application/json", "X-Api-Key": config.key}
    try:
        with (
            httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False) as client,
            client.stream("GET", url, headers=headers) as res,
        ):
            if 300 <= res.status_code < 400:
                raise CrowdSecError(f"Die Local API leitet weiter (HTTP {res.status_code}).")
            if res.status_code in (401, 403):
                raise CrowdSecError(
                    f"Der Bouncer-Schlüssel wird abgelehnt (HTTP {res.status_code})."
                )
            if res.status_code != 200:
                raise CrowdSecError(f"Die Local API antwortet mit HTTP {res.status_code}.")
            data = bytearray()
            for chunk in res.iter_bytes():
                data.extend(chunk)
                if len(data) > MAX_RESPONSE_BYTES:
                    raise CrowdSecError("Die Antwort der Local API ist zu groß.")
    except httpx.TimeoutException as error:
        raise CrowdSecError("Die Local API antwortet nicht rechtzeitig.") from error
    except httpx.ConnectError as error:
        if "certificate" in str(error).lower():
            raise CrowdSecError(
                "Das Zertifikat der Local API ist nicht vertrauenswürdig."
            ) from error
        raise CrowdSecError("Die Local API ist nicht erreichbar.") from error
    except httpx.HTTPError as error:
        raise CrowdSecError("Verbindung zur Local API fehlgeschlagen.") from error
    try:
        return json.loads(bytes(data) or b"null")
    except ValueError as error:
        raise CrowdSecError("Die Antwort der Local API ist kein JSON.") from error


def summarize(body: Any) -> dict[str, int]:
    """Aktive Sperren zählen: gesamt und eigene (nicht aus Community-Listen)."""
    if body is None:
        return {"total": 0, "own": 0}
    if not isinstance(body, list):
        raise CrowdSecError("Unerwartete Antwort der Local API.")
    total = own = 0
    for item in body:
        if not isinstance(item, dict):
            continue
        total += 1
        if str(item.get("origin") or "").lower() in OWN_ORIGINS:
            own += 1
    return {"total": total, "own": own}


def read_lapi(config: LapiConfig, transport: LapiTransport | None = None) -> dict[str, int]:
    return summarize((transport or http_lapi)(config))


# --- Zugriffsprotokoll des Reverse Proxy -----------------------------------------------------


@dataclass
class ProxyBlocks:
    # (Dienst, Stunde, beobachtet) → Anzahl
    counts: dict[tuple[str, datetime, bool], int] = field(default_factory=dict)
    cursor: str = ""
    cursor_ids: list[str] = field(default_factory=list)
    complete: bool = True


def _hour(moment: datetime) -> datetime:
    return moment.replace(minute=0, second=0, microsecond=0)


def read_proxy_blocks(
    client: NetBirdClient, cursor: str, cursor_ids: list[str], now: datetime
) -> ProxyBlocks:
    """Liest das Zugriffsprotokoll seit `cursor` (sonst 24 Stunden) und zählt Abweisungen.

    Höchstens MAX_PAGES Seiten je Abruf; der Rest folgt beim nächsten Abruf (complete = False).
    """
    start = parse_iso(cursor) or now - FIRST_WINDOW
    start = max(start, now - FIRST_WINDOW)
    seen = set(cursor_ids)
    out = ProxyBlocks(cursor=cursor, cursor_ids=list(cursor_ids))
    last = start
    last_ids: set[str] = set(cursor_ids) if cursor else set()
    for page in range(1, MAX_PAGES + 1):
        body = client.get(
            "events/proxy",
            start_date=start.isoformat().replace("+00:00", "Z"),
            page=str(page),
            page_size=str(PAGE_SIZE),
            sort_by="timestamp",
            sort_order="asc",
        )
        if not isinstance(body, Mapping) or not isinstance(body.get("data"), list):
            raise NetBirdError("Unerwartete Antwort von NetBird beim Zugriffsprotokoll.")
        rows = [row for row in body["data"] if isinstance(row, Mapping)]
        for row in rows:
            rid = str(row.get("id") or "")
            at = parse_iso(row.get("timestamp"))
            if at is None or rid in seen or at < start:
                continue
            if at > last:
                last, last_ids = at, set()
            if at == last:
                last_ids.add(rid)
            meta = row.get("metadata")
            meta = meta if isinstance(meta, Mapping) else {}
            verdict = str(meta.get("crowdsec_verdict") or "")
            if not verdict.startswith("crowdsec_") or verdict == "crowdsec_unavailable":
                continue
            key = (
                str(row.get("service_id") or "")[:64],
                _hour(at),
                meta.get("crowdsec_mode") == "observe",
            )
            out.counts[key] = out.counts.get(key, 0) + 1
        pages = body.get("total_pages")
        if not rows or not isinstance(pages, int) or page >= pages:
            break
    else:
        out.complete = False
    out.cursor = last.isoformat()
    out.cursor_ids = sorted(last_ids)[:500]
    return out
