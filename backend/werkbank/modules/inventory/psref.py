"""Technische Daten zu Lenovo-Geräten aus PSREF (psref.lenovo.com).

PSREF hat keine offizielle Schnittstelle. Genutzt werden die Endpunkte, die auch die Webseite
verwendet; sie können sich jederzeit ändern. Deshalb fragt die Werkbank je Modell höchstens
einmal am Tag, speichert das Ergebnis und zeigt bei Fehlern nur den Link.

- Rechner mit Maschinentyp-Modell (MTM, zehn Zeichen, z. B. 10T7004BGE):
  ``/api/model/Info/SpecData?model_code=<MTM>``
- Monitore über den Produktschlüssel (z. B. ThinkVision_T24D_4t_Monitor):
  ``/api/product/Compare/LoadSpecData?ProductKey=<Key>``
"""

import html
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any
from urllib.parse import quote

import httpx

BASE_URL = "https://psref.lenovo.com"
TIMEOUT_SECONDS = 20.0
SPECS_MAX = 250
TEXT_MAX = 400
REFRESH_OK = timedelta(days=30)
REFRESH_FAILED = timedelta(days=7)
USER_AGENT = "Werkbank (IT-Bestand; liest technische Daten einmal je Modell)"
_MTM = re.compile(r"^[0-9A-Z]{4}[0-9A-Z]{6}$")
_TAG = re.compile(r"<[^>]+>")
_KEY = re.compile(r"^[A-Za-z0-9_]{2,120}$")
# Merkmale für Kamera, Mikrofon und Lautsprecher (englische Namen in PSREF)
AV_FEATURES = {
    "camera": ("camera", "webcam"),
    "microphone": ("microphone",),
    "speakers": ("speaker",),
}


class PsrefError(Exception):
    """PSREF nicht erreichbar oder Antwort nicht lesbar."""


@dataclass(frozen=True)
class Spec:
    group: str
    name: str
    value: str


@dataclass(frozen=True)
class PsrefResult:
    """Ergebnis eines Abrufs; ``specs`` leer heißt: nichts gefunden."""

    key: str
    name: str
    url: str
    specs: tuple[Spec, ...] = field(default_factory=tuple)


def clean(value: Any, limit: int = TEXT_MAX) -> str:
    """Text aus PSREF: HTML-Zeichen auflösen, Tags entfernen, Leerraum zusammenfassen."""
    if not isinstance(value, str):
        return ""
    text = html.unescape(value)
    text = _TAG.sub(" ", text).replace("\\n", "; ")
    text = re.sub(r"\s*\n\s*", "; ", text)
    return " ".join(text.split()).strip(" ;")[:limit]


def is_mtm(model: str) -> bool:
    return bool(_MTM.match(model.strip().upper()))


def product_key(name: str) -> str:
    """Produktname → Schlüssel, z. B. „ThinkVision T24D-4t“ → ThinkVision_T24D_4t."""
    return re.sub(r"[^A-Za-z0-9]+", "_", name.strip()).strip("_")[:120]


def monitor_keys(model: str) -> list[str]:
    """Mögliche Produktschlüssel für ein Monitormodell aus den EDID-Daten (z. B. T24D-4t)."""
    base = product_key(model)
    if not base:
        return []
    if base.casefold().startswith("thinkvision"):
        return [base, f"{base}_Monitor"]
    return [f"ThinkVision_{base}_Monitor", f"ThinkVision_{base}"]


def model_url(key: str, mtm: str) -> str:
    if key:
        return f"{BASE_URL}/detail/{quote(key)}?M={quote(mtm)}"
    return f"{BASE_URL}/Search?kw={quote(mtm)}"


def product_url(key: str) -> str:
    brand = key.split("_", 1)[0] or "ThinkVision"
    return f"{BASE_URL}/product/{quote(brand)}/{quote(key)}"


def search_url(text: str) -> str:
    return f"{BASE_URL}/Search?kw={quote(text)}"


# GET-Abruf (Pfad, Parameter) → JSON; in Tests ersetzbar
Getter = Callable[[str, dict[str, str]], Any]


# Lenovo zeigt Abrufen ohne Browser-Kennung diese Seite (mit Status 403)
BLOCKED_PAGE = "PSREF page not found"
# Zeichen, die in der Absenderkennung erlaubt sind (sichtbares ASCII und Leerzeichen)
_AGENT = re.compile(r"^[\x20-\x7e]{1,300}$")


def valid_user_agent(value: str) -> bool:
    return bool(_AGENT.match(value))


def http_getter(http: httpx.Client, user_agent: str = USER_AGENT) -> Getter:
    def get(path: str, params: dict[str, str]) -> Any:
        try:
            response = http.get(
                f"{BASE_URL}{path}",
                params=params,
                headers={
                    "Accept": "application/json",
                    "Referer": f"{BASE_URL}/",
                    "User-Agent": user_agent,
                },
            )
        except httpx.HTTPError as exc:
            raise PsrefError(f"PSREF nicht erreichbar: {type(exc).__name__}") from exc
        if response.status_code == 404:
            return None
        if response.status_code == 403 and BLOCKED_PAGE in response.text[:2000]:
            raise PsrefError(
                "PSREF lehnt den Abruf ab (403). Lenovo lässt nur Abrufe mit Browser-Kennung zu; "
                "trag sie in der Verwaltung als Absenderkennung ein."
            )
        if response.status_code >= 400:
            raise PsrefError(f"PSREF antwortet mit {response.status_code}.")
        try:
            return response.json()
        except ValueError as exc:
            raise PsrefError("Antwort von PSREF ist kein JSON.") from exc

    return get


def parse_model_specs(data: Any) -> tuple[str, str, tuple[Spec, ...]]:
    """Antwort von /api/model/Info/SpecData → (Produktschlüssel, Name, Merkmale)."""
    body = data.get("data") if isinstance(data, dict) else None
    if not isinstance(body, dict):
        return "", "", ()
    key = body.get("ProductKey")
    name = clean(body.get("ProductName") or body.get("Name"), 160)
    specs: list[Spec] = []
    for item in body.get("SpecData") or []:
        if not isinstance(item, dict):
            continue
        spec_name = clean(item.get("Name"), 120)
        value = clean(item.get("Content"))
        if spec_name and value:
            specs.append(Spec(group=clean(item.get("Title"), 120), name=spec_name, value=value))
        if len(specs) >= SPECS_MAX:
            break
    return (key if isinstance(key, str) and _KEY.match(key) else ""), name, tuple(specs)


def parse_product_specs(data: Any) -> tuple[str, tuple[Spec, ...]]:
    """Antwort von /api/product/Compare/LoadSpecData → (Name, Merkmale).

    Die Merkmale stecken als JSON-Text in ``GeneralSpecJson`` (Ebenen L1, L2, Features).
    """
    if not isinstance(data, dict) or str(data.get("code")) != "1":
        return "", ()
    body = data.get("data")
    general = body.get("GeneralSpecData") if isinstance(body, dict) else None
    first = general[0] if isinstance(general, list) and general else None
    raw = first.get("GeneralSpecJson") if isinstance(first, dict) else None
    if not isinstance(raw, str) or not raw.strip():
        return "", ()
    try:
        spec = json.loads(raw.strip().strip("'"))
    except ValueError:
        return "", ()
    name = clean(first.get("ProductName"), 160) if isinstance(first, dict) else ""
    specs: list[Spec] = []
    levels = spec.get("data", {}).get("SpecData") if isinstance(spec, dict) else None
    for level1 in levels if isinstance(levels, list) else []:
        for level2 in level1.get("L2") or [] if isinstance(level1, dict) else []:
            if not isinstance(level2, dict):
                continue
            group = clean(level2.get("L2"), 120)
            for feature in level2.get("Features") or []:
                if not isinstance(feature, dict):
                    continue
                feature_name = clean(feature.get("FName"), 120)
                for value_set in feature.get("FVs") or []:
                    for group_values in (value_set or {}).get("FVGs") or []:
                        items = sorted(
                            (item for item in (group_values or {}).get("FVGItem") or [] if item),
                            key=lambda item: (
                                int(item.get("AttNo") or 0)
                                if str(item.get("AttNo") or "0").isdigit()
                                else 0
                            ),
                        )
                        value = ": ".join(
                            text for text in (clean(item.get("AttV")) for item in items) if text
                        )
                        if feature_name and value:
                            specs.append(
                                Spec(group=group, name=feature_name, value=value[:TEXT_MAX])
                            )
                        if len(specs) >= SPECS_MAX:
                            return name, tuple(specs)
    return name, tuple(specs)


def lookup_model(get: Getter, mtm: str) -> PsrefResult:
    """Rechner über das MTM, z. B. 10T7004BGE."""
    code = mtm.strip().upper()
    key, name, specs = parse_model_specs(get("/api/model/Info/SpecData", {"model_code": code}))
    return PsrefResult(key=key, name=name, url=model_url(key, code), specs=specs)


def lookup_monitor(get: Getter, model: str) -> PsrefResult:
    """Monitor über den Produktschlüssel; probiert die üblichen Schreibweisen durch."""
    for key in monitor_keys(model):
        name, specs = parse_product_specs(
            get("/api/product/Compare/LoadSpecData", {"ProductKey": key})
        )
        if specs:
            return PsrefResult(key=key, name=name, url=product_url(key), specs=specs)
    return PsrefResult(key="", name="", url=search_url(model), specs=())


def av_summary(specs: list[dict[str, str]] | tuple[Spec, ...]) -> dict[str, str]:
    """Kamera, Mikrofon und Lautsprecher aus den Merkmalen (leer, wenn PSREF nichts nennt)."""
    found: dict[str, str] = {}
    for item in specs:
        name = (item.name if isinstance(item, Spec) else str(item.get("name", ""))).casefold()
        value = item.value if isinstance(item, Spec) else str(item.get("value", ""))
        for key, words in AV_FEATURES.items():
            if key not in found and any(word in name for word in words):
                found[key] = value
    return found


def fetch(lookup: str, value: str, user_agent: str = USER_AGENT) -> PsrefResult:
    """Ein Abruf mit eigener Verbindung; ``lookup`` ist „modell“ (MTM) oder „monitor“."""
    with httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False) as http:
        get = http_getter(http, user_agent)
        return lookup_model(get, value) if lookup == "modell" else lookup_monitor(get, value)


# (Art, Wert, Absenderkennung) → Ergebnis
Fetcher = Callable[[str, str, str], PsrefResult]
