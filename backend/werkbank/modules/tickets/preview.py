"""Vorschau von Anhängen (spec.md 8e): Bilder und PDF im Browser, Textdateien als Auszug.

Angezeigt wird nur, was am Inhalt als der gespeicherte Typ erkannt wird. Alles andere
(Office-Dateien, ZIP, Outlook-Nachrichten) gibt es nur als Download.
"""

from pathlib import Path
from typing import Literal

PreviewKind = Literal["image", "pdf", "text", ""]

IMAGE_TYPES = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})
TEXT_TYPES = frozenset({"text/plain", "text/csv", "message/rfc822"})
# Textvorschau: höchstens so viele Bytes vom Anfang der Datei
TEXT_PREVIEW_MAX = 200 * 1024


def preview_kind(content_type: str) -> PreviewKind:
    if content_type in IMAGE_TYPES:
        return "image"
    if content_type == "application/pdf":
        return "pdf"
    if content_type in TEXT_TYPES:
        return "text"
    return ""


def matches(content_type: str, head: bytes) -> bool:
    """Passt der Anfang der Datei zum gespeicherten Typ? (Bilder und PDF)"""
    checks = {
        "image/png": head.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": head.startswith(b"\xff\xd8\xff"),
        "image/gif": head.startswith((b"GIF87a", b"GIF89a")),
        "image/webp": head.startswith(b"RIFF") and head[8:12] == b"WEBP",
        "application/pdf": head.startswith(b"%PDF-"),
    }
    return checks.get(content_type, False)


def read_head(path: Path, size: int = 16) -> bytes:
    with path.open("rb") as handle:
        return handle.read(size)


def read_text(path: Path) -> tuple[str, bool]:
    """Anfang einer Textdatei als Text; zweiter Wert: gekürzt."""
    with path.open("rb") as handle:
        data = handle.read(TEXT_PREVIEW_MAX + 1)
    truncated = len(data) > TEXT_PREVIEW_MAX
    data = data[:TEXT_PREVIEW_MAX].replace(b"\x00", b"")
    # Beim Kürzen kann ein UTF-8-Zeichen zerschnitten sein: bis zu drei Bytes am Ende weglassen
    for cut in range(4 if truncated else 1):
        try:
            return data[: len(data) - cut].decode("utf-8"), truncated
        except UnicodeDecodeError:
            continue
    return data.decode("cp1252", "replace"), truncated
