"""Prüfung von Grundriss-Bildern: nur PNG, JPEG und WebP, erkannt am Inhalt der Datei.

SVG ist bewusst ausgeschlossen, weil darin Skripte stecken können.
"""

from dataclasses import dataclass

from werkbank.core.branding import ImageError, _png_size, _webp_size

# Größter Grundriss in Pixeln je Seite
PLAN_MAX_SIDE = 12000
PLAN_MIN_SIDE = 50
PLAN_TYPES = ("image/png", "image/jpeg", "image/webp")

# JPEG-Marker mit Bildgröße (Start of Frame), ohne DHT/JPG/DAC
_SOF_MARKERS = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


@dataclass(frozen=True)
class PlanInfo:
    content_type: str
    width: int
    height: int


def jpeg_size(data: bytes) -> tuple[int, int] | None:
    """Breite und Höhe aus dem ersten Start-of-Frame-Block; None, wenn kein JPEG."""
    if not data.startswith(b"\xff\xd8\xff"):
        return None
    pos = 2
    length = len(data)
    while pos + 4 <= length:
        if data[pos] != 0xFF:
            return None
        marker = data[pos + 1]
        # Füllbytes und Marker ohne Länge überspringen
        if marker == 0xFF:
            pos += 1
            continue
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            pos += 2
            continue
        if marker in (0xD9, 0xDA):
            return None
        segment = int.from_bytes(data[pos + 2 : pos + 4], "big")
        if segment < 2:
            return None
        if marker in _SOF_MARKERS:
            if pos + 9 > length:
                return None
            height = int.from_bytes(data[pos + 5 : pos + 7], "big")
            width = int.from_bytes(data[pos + 7 : pos + 9], "big")
            return width, height
        pos += 2 + segment
    return None


def inspect_plan(data: bytes) -> PlanInfo:
    """Erkennt das Format am Inhalt und prüft die Abmessungen."""
    for content_type, reader in (
        ("image/png", _png_size),
        ("image/jpeg", jpeg_size),
        ("image/webp", _webp_size),
    ):
        size = reader(data)
        if size is None:
            continue
        width, height = size
        if not (
            PLAN_MIN_SIDE <= width <= PLAN_MAX_SIDE and PLAN_MIN_SIDE <= height <= PLAN_MAX_SIDE
        ):
            raise ImageError(
                f"Der Grundriss muss in Breite und Höhe zwischen {PLAN_MIN_SIDE} und "
                f"{PLAN_MAX_SIDE} Pixel haben."
            )
        return PlanInfo(content_type, width, height)
    raise ImageError("Erlaubt sind nur PNG-, JPEG- und WebP-Dateien.")
