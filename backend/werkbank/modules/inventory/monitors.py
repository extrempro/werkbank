"""Angeschlossene Monitore aus einem Custom Field in NinjaOne.

Ein Skript auf den Rechnern schreibt je externem Monitor eine Zeile in ein mehrzeiliges
Textfeld, die Felder mit `|` getrennt:

    Hersteller|Modell|Seriennummer|ProductCode|Baujahr-KW|Anschluss|ZuletztGesehen
    LEN|T24D-4t|V5A00000|62B5|2024-KW12|DisplayPort|2026-11-20

Der Hersteller ist die dreistellige Kennung aus den EDID-Daten (PNP-ID). Erkannt wird ein
Monitor an seiner Seriennummer; ohne Seriennummer wird die Zeile übergangen.
"""

import re
from dataclasses import dataclass
from typing import Any

# Bekannte PNP-IDs aus den EDID-Daten; unbekannte bleiben als Kennung stehen
PNP_MAKERS: dict[str, str] = {
    "ACI": "ASUS",
    "ACR": "Acer",
    "AOC": "AOC",
    "AUS": "ASUS",
    "BNQ": "BenQ",
    "DEL": "Dell",
    "EIZ": "EIZO",
    "ENC": "EIZO",
    "FUS": "Fujitsu",
    "GSM": "LG",
    "HPN": "HP",
    "HWP": "HP",
    "IVM": "iiyama",
    "LEN": "Lenovo",
    "LGD": "LG",
    "MSI": "MSI",
    "NEC": "NEC",
    "PHL": "Philips",
    "SAM": "Samsung",
    "SNY": "Sony",
    "VSC": "ViewSonic",
}
FIELD_COUNT = 7
LINES_MAX = 16
TEXT_MAX = 80
_FIELD_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass(frozen=True)
class MonitorLine:
    """Ein Monitor aus dem Custom Field."""

    maker_code: str
    maker: str
    model: str
    serial: str
    product_code: str
    built: str
    connector: str
    last_seen: str

    def facts(self) -> dict[str, Any]:
        return {
            "maker_code": self.maker_code,
            "maker": self.maker,
            "model": self.model,
            "serial": self.serial,
            "product_code": self.product_code,
            "built": self.built,
            "connector": self.connector,
            "monitor_seen": self.last_seen,
        }


def valid_field_name(value: str) -> bool:
    """Interner Name eines Custom Fields in NinjaOne (Buchstaben, Ziffern, Unterstrich)."""
    return bool(_FIELD_NAME.match(value))


def _clean(value: str, limit: int = TEXT_MAX) -> str:
    return " ".join(value.split())[:limit]


def parse_monitor_field(text: Any) -> list[MonitorLine]:
    """Liest die Zeilen des Custom Fields; Kopfzeile und unvollständige Zeilen fallen weg."""
    if not isinstance(text, str):
        return []
    monitors: list[MonitorLine] = []
    seen: set[str] = set()
    for raw in text.replace("\r", "\n").split("\n")[: LINES_MAX * 2]:
        parts = [_clean(part) for part in raw.split("|")]
        if len(parts) < 3 or parts[0].casefold() == "hersteller":
            continue
        parts += [""] * (FIELD_COUNT - len(parts))
        code, model, serial = parts[0].upper()[:8], parts[1], parts[2]
        if not serial or serial.casefold() in seen:
            continue
        seen.add(serial.casefold())
        monitors.append(
            MonitorLine(
                maker_code=code,
                maker=PNP_MAKERS.get(code, code),
                model=model,
                serial=serial,
                product_code=parts[3][:16],
                built=parts[4][:16],
                connector=parts[5][:40],
                last_seen=parts[6] if _DATE.match(parts[6]) else "",
            )
        )
        if len(monitors) >= LINES_MAX:
            break
    return monitors
