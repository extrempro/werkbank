"""Ablage der PDF-Belege: Dateien liegen unter zufälligen Namen außerhalb der Datenbank."""

import re
import secrets
from pathlib import Path
from urllib.parse import unquote

PDF_TYPE = "application/pdf"
DEFAULT_NAME = "Beleg.pdf"
NAME_MAX = 200
# Namen in der Ablage sind 32 Hex-Zeichen; nichts anderes wird je zu einem Pfad.
KEY_PATTERN = re.compile(r"^[0-9a-f]{32}$")


def looks_like_pdf(data: bytes) -> bool:
    """Prüft den Anfang der Datei, nicht ihre Endung."""
    return data.startswith(b"%PDF-")


def clean_name(raw: str) -> str:
    """Dateiname nur zur Anzeige: ohne Pfad und Steuerzeichen, mit der Endung .pdf."""
    name = unquote(raw).replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(char for char in name if char.isprintable() and char not in '"<>|:*?').strip()
    name = name.strip(". ")
    if not name:
        return DEFAULT_NAME
    if not name.lower().endswith(".pdf"):
        name = f"{name}.pdf"
    if len(name) > NAME_MAX:
        name = f"{name[: NAME_MAX - 4]}.pdf"
    return name


def document_path(directory: Path, key: str) -> Path | None:
    """Pfad der Datei zu einem Schlüssel aus der Datenbank; None bei einem ungültigen Schlüssel."""
    if not KEY_PATTERN.fullmatch(key):
        return None
    return directory / f"{key}.pdf"


def store_document(directory: Path, data: bytes) -> str:
    """Schreibt die Datei unter einem neuen zufälligen Namen und liefert den Schlüssel."""
    directory.mkdir(parents=True, exist_ok=True)
    key = secrets.token_hex(16)
    # Erst vollständig schreiben, dann umbenennen: Es liegt nie eine halbe Datei am Ziel.
    partial = directory / f"{key}.teil"
    partial.write_bytes(data)
    partial.replace(directory / f"{key}.pdf")
    return key


def remove_document(directory: Path, key: str) -> None:
    """Löscht die Datei, wenn es sie gibt. Fehlt sie schon, ist das kein Fehler."""
    path = document_path(directory, key)
    if path is not None:
        path.unlink(missing_ok=True)
