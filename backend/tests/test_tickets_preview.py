"""Vorschau von Anhängen ohne Datenbank: Typen, Inhaltsprüfung, Textauszug."""

from pathlib import Path

from werkbank.modules.tickets.preview import TEXT_PREVIEW_MAX, matches, preview_kind, read_text


def test_preview_kind() -> None:
    assert preview_kind("image/png") == "image"
    assert preview_kind("application/pdf") == "pdf"
    assert preview_kind("text/csv") == "text"
    assert preview_kind("message/rfc822") == "text"
    assert preview_kind("application/zip") == ""
    assert preview_kind("image/svg+xml") == ""


def test_matches_checks_content() -> None:
    assert matches("image/png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 8)
    assert not matches("image/png", b"<svg onload=alert(1)>")
    assert matches("application/pdf", b"%PDF-1.7")
    assert not matches("text/plain", b"hallo")


def test_read_text_truncates_and_keeps_utf8(tmp_path: Path) -> None:
    small = tmp_path / "a.txt"
    small.write_bytes("Grüße\x00".encode())
    assert read_text(small) == ("Grüße", False)
    big = tmp_path / "b.txt"
    # „ü“ (2 Bytes) liegt genau auf der Grenze und wird nicht zerschnitten
    big.write_bytes(b"a" * (TEXT_PREVIEW_MAX - 1) + "ü".encode() + b"rest")
    text, truncated = read_text(big)
    assert truncated
    assert text == "a" * (TEXT_PREVIEW_MAX - 1)
    legacy = tmp_path / "c.txt"
    legacy.write_bytes("Größe".encode("cp1252"))
    assert read_text(legacy) == ("Größe", False)
