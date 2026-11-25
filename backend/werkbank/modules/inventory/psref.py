"""Technische Daten zu Lenovo-Rechnern aus der PSREF-Schnittstelle (psrefapi.lenovo.com).

Abgefragt wird je Maschinentyp-Modell (MTM, zehn Zeichen, z. B. 10T700BTGE):
``/psref/mobile/model/ModelDetails/<MTM>``. Die Antwort nennt Produktname, einen Link zur
PSREF-Seite und die Merkmale als Liste aus Name und Wert. Gesendet wird nur das MTM.
"""

import html
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any
from urllib.parse import quote, urlsplit

import httpx

BASE_URL = "https://psrefapi.lenovo.com"
DETAILS_PATH = "/psref/mobile/model/ModelDetails/"
PAGE_HOST = "psref.lenovo.com"
TIMEOUT_SECONDS = 20.0
SPECS_MAX = 120
TEXT_MAX = 400
NAME_MAX = 120
REFRESH_OK = timedelta(days=30)
REFRESH_FAILED = timedelta(days=7)
USER_AGENT = "Werkbank (IT-Bestand; liest technische Daten einmal je Modell)"
_MTM = re.compile(r"^[0-9A-Z]{4}[0-9A-Z]{6}$")
_TAG = re.compile(r"<[^>]+>")
# Angaben, die für den Bestand nichts sagen
SKIPPED = frozenset({"topseller", "region", "country/region", "ean / upc / jan"})


class PsrefError(Exception):
    """PSREF nicht erreichbar oder Antwort nicht lesbar."""


@dataclass(frozen=True)
class Spec:
    name: str
    value: str


@dataclass(frozen=True)
class PsrefResult:
    """Ergebnis eines Abrufs; ``specs`` leer heißt: nichts gefunden."""

    name: str
    url: str
    specs: tuple[Spec, ...] = field(default_factory=tuple)


def clean(value: Any, limit: int = TEXT_MAX) -> str:
    """Text aus PSREF: HTML-Zeichen auflösen, Tags entfernen, Leerraum zusammenfassen."""
    if not isinstance(value, str):
        return ""
    text = html.unescape(value)
    text = _TAG.sub(" ", text)
    text = re.sub(r"\s*\n\s*", "; ", text)
    return " ".join(text.split()).strip(" ;")[:limit]


def is_mtm(model: str) -> bool:
    return bool(_MTM.match(model.strip().upper()))


def page_url(value: Any, mtm: str) -> str:
    """Link zur PSREF-Seite; nur https://psref.lenovo.com/…, sonst die Suche nach dem MTM."""
    if isinstance(value, str):
        parts = urlsplit(value.strip())
        if parts.scheme in ("http", "https") and parts.hostname == PAGE_HOST and not parts.port:
            query = f"?{parts.query}" if parts.query else ""
            return f"https://{PAGE_HOST}{parts.path}{query}"[:300]
    return f"https://{PAGE_HOST}/Search?kw={quote(mtm)}"


def parse_details(data: Any, mtm: str) -> PsrefResult:
    """Antwort von ``ModelDetails`` → Name, Link, Merkmale (leer: nicht gefunden)."""
    if not isinstance(data, dict):
        return PsrefResult(name="", url=page_url(None, mtm))
    specs: list[Spec] = []
    for item in data.get("Detail") or []:
        if not isinstance(item, dict):
            continue
        name = clean(item.get("Name"), NAME_MAX)
        value = clean(item.get("Value"))
        if not name or not value or name.casefold() in SKIPPED:
            continue
        specs.append(Spec(name=name, value=value))
        if len(specs) >= SPECS_MAX:
            break
    return PsrefResult(
        name=clean(data.get("Name"), 160),
        url=page_url(data.get("ModelURL"), mtm),
        specs=tuple(specs),
    )


def fetch_with(http: httpx.Client, mtm: str) -> PsrefResult:
    code = mtm.strip().upper()
    if not is_mtm(code):
        raise PsrefError("Kein Maschinentyp-Modell (zehn Zeichen, z. B. 10T700BTGE).")
    try:
        response = http.get(
            f"{BASE_URL}{DETAILS_PATH}{quote(code)}",
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
        )
    except httpx.HTTPError as exc:
        raise PsrefError(f"PSREF nicht erreichbar: {type(exc).__name__}") from exc
    if response.status_code == 404:
        return PsrefResult(name="", url=page_url(None, code))
    if response.status_code >= 400:
        raise PsrefError(f"PSREF antwortet mit {response.status_code}.")
    if not response.content.strip() or response.text.strip() == "null":
        return PsrefResult(name="", url=page_url(None, code))
    try:
        data = response.json()
    except ValueError as exc:
        raise PsrefError("Antwort von PSREF ist kein JSON.") from exc
    return parse_details(data, code)


def fetch(mtm: str) -> PsrefResult:
    """Ein Abruf mit eigener Verbindung, ohne Weiterleitungen und mit Zeitlimit."""
    with httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False) as http:
        return fetch_with(http, mtm)


# MTM → Ergebnis; in Tests ersetzbar
Fetcher = Callable[[str], PsrefResult]
