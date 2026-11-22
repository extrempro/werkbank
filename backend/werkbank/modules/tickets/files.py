"""Ablage von Anhängen und Originalen (.eml) im Volume, außerhalb des Webroots.

Dateinamen auf der Platte sind zufällige Schlüssel; der ursprüngliche Name steht nur in der
Datenbank. Ausgeliefert wird nur über das Ticket mit Prüfung des Bereichs.
"""

import re
import secrets
from pathlib import Path

KEY_PATTERN = re.compile(r"^[0-9a-f]{32}$")


def file_path(directory: Path, key: str) -> Path | None:
    if not KEY_PATTERN.fullmatch(key):
        return None
    return directory / key[:2] / f"{key}.bin"


def store_file(directory: Path, data: bytes) -> str:
    """Schreibt erst vollständig, dann umbenennen: Es liegt nie eine halbe Datei am Ziel."""
    key = secrets.token_hex(16)
    target = directory / key[:2]
    target.mkdir(parents=True, exist_ok=True)
    partial = target / f"{key}.teil"
    partial.write_bytes(data)
    partial.replace(target / f"{key}.bin")
    return key


def remove_file(directory: Path, key: str | None) -> None:
    if key:
        path = file_path(directory, key)
        if path is not None:
            path.unlink(missing_ok=True)
