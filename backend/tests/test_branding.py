"""Branding: Name, Akzentfarbe, Logos und Favicon."""

import base64
import struct

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_auth import ORIGIN, client_for, login_as, make_app, make_settings
from werkbank.core.branding import (
    BRANDING_KEY,
    MAX_IMAGE_BYTES,
    ImageError,
    inspect_image,
)
from werkbank.core.models import AppSetting, AuditLog, BrandingAsset

HEADERS = {"Origin": ORIGIN}
ADMIN = "/api/admin/branding"


def png(width: int, height: int, padding: int = 0) -> bytes:
    """Anfang einer PNG-Datei mit den angegebenen Abmessungen (genügt für die Prüfung)."""
    header = struct.pack(">II", width, height) + b"\x08\x06\x00\x00\x00"
    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + header
        + b"\x00\x00\x00\x00"
        + b"\x00" * padding
    )


def webp_extended(width: int, height: int) -> bytes:
    body = (
        b"WEBPVP8X"
        + struct.pack("<I", 10)
        + b"\x00\x00\x00\x00"
        + (width - 1).to_bytes(3, "little")
        + (height - 1).to_bytes(3, "little")
    )
    return b"RIFF" + struct.pack("<I", len(body)) + body


def webp_lossless(width: int, height: int) -> bytes:
    bits = (width - 1) | ((height - 1) << 14)
    body = b"WEBPVP8L" + struct.pack("<I", 5) + b"\x2f" + bits.to_bytes(4, "little") + b"\x00"
    return b"RIFF" + struct.pack("<I", len(body)) + body


def encoded(data: bytes) -> dict[str, str]:
    return {"content_base64": base64.b64encode(data).decode("ascii")}


def admin() -> TestClient:
    client = client_for(make_app())
    login_as(client, ["Werkbank.Admin"], oid="branding-admin")
    return client


@pytest.fixture
def clean(migrated_db: None, db_session: Session) -> Session:
    db_session.execute(delete(BrandingAsset))
    db_session.execute(delete(AppSetting).where(AppSetting.key == BRANDING_KEY))
    db_session.commit()
    return db_session


def test_inspect_image_accepts_png_and_webp() -> None:
    assert inspect_image("logo-hell", png(320, 80)).content_type == "image/png"
    info = inspect_image("logo-dunkel", webp_extended(640, 120))
    assert (info.content_type, info.width, info.height) == ("image/webp", 640, 120)
    lossless = inspect_image("logo-hell", webp_lossless(200, 50))
    assert (lossless.width, lossless.height) == (200, 50)
    assert inspect_image("favicon", png(64, 64)).width == 64


@pytest.mark.parametrize(
    ("kind", "data", "fragment"),
    [
        ("logo-hell", b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>", "PNG- und WebP"),
        ("logo-hell", b"\xff\xd8\xff\xe0" + b"\x00" * 40, "PNG- und WebP"),
        ("logo-hell", png(4000, 80), "zwischen"),
        ("logo-hell", png(8, 8), "zwischen"),
        ("logo-hell", png(100, 100, padding=MAX_IMAGE_BYTES), "zu groß"),
        ("favicon", webp_extended(64, 64), "PNG-Datei"),
        ("favicon", png(64, 32), "quadratisch"),
        ("favicon", png(16, 16), "zwischen"),
    ],
)
def test_inspect_image_rejects(kind: str, data: bytes, fragment: str) -> None:
    with pytest.raises(ImageError, match=fragment):
        inspect_image(kind, data)


@pytest.mark.db
def test_branding_is_public_with_defaults(clean: Session) -> None:
    anonymous = client_for(make_app())
    response = anonymous.get("/api/branding")
    assert response.status_code == 200
    assert response.json() == {
        "app_name": "Werkbank",
        "accent": None,
        "show_name": True,
        "logo_light_url": None,
        "logo_dark_url": None,
        "favicon_url": None,
        "max_image_bytes": MAX_IMAGE_BYTES,
    }
    assert anonymous.get("/api/branding/assets/favicon").status_code == 404
    assert anonymous.get("/api/branding/assets/unbekannt").status_code == 422


@pytest.mark.db
def test_changes_need_admin_and_recent_login(clean: Session) -> None:
    body = {"app_name": "IT-Portal", "accent": "#0a7d5a", "show_name": True}
    anonymous = client_for(make_app())
    assert anonymous.put(ADMIN, json=body, headers=HEADERS).status_code == 401
    reader = client_for(make_app())
    login_as(reader, ["Config.Reviewer"], oid="branding-leser")
    assert reader.put(ADMIN, json=body, headers=HEADERS).status_code == 403
    upload = reader.put(f"{ADMIN}/assets/favicon", json=encoded(png(64, 64)), headers=HEADERS)
    assert upload.status_code == 403
    assert reader.delete(f"{ADMIN}/assets/favicon", headers=HEADERS).status_code == 403

    stale = client_for(make_app(make_settings(step_up_minutes=0)))
    login_as(stale, ["Werkbank.Admin"], oid="branding-admin")
    response = stale.put(ADMIN, json=body, headers=HEADERS)
    assert response.status_code == 403
    assert response.headers["x-werkbank-step-up"] == "required"


@pytest.mark.db
def test_update_name_and_accent(clean: Session) -> None:
    client = admin()
    response = client.put(
        ADMIN,
        json={"app_name": "  IT-Portal ", "accent": "#0A7D5A", "show_name": False},
        headers=HEADERS,
    )
    assert response.status_code == 200, response.text
    data = response.json()
    assert (data["app_name"], data["accent"], data["show_name"]) == ("IT-Portal", "#0a7d5a", False)
    assert client_for(make_app()).get("/api/branding").json()["app_name"] == "IT-Portal"
    entry = clean.scalars(
        select(AuditLog).where(AuditLog.action == "einstellungen.branding_geaendert")
    ).first()
    assert entry is not None and entry.details["app_name"] == "IT-Portal"

    # leerer Name und leere Farbe: zurück zum Standard
    reset = client.put(ADMIN, json={"app_name": " ", "accent": ""}, headers=HEADERS).json()
    assert (reset["app_name"], reset["accent"], reset["show_name"]) == ("Werkbank", None, True)

    for bad in ("rot", "#12345", "#1234567", "url(x)", "#gggggg"):
        invalid = client.put(ADMIN, json={"app_name": "X", "accent": bad}, headers=HEADERS)
        assert invalid.status_code == 422, bad
    too_long = client.put(ADMIN, json={"app_name": "x" * 41}, headers=HEADERS)
    assert too_long.status_code == 422
    control = client.put(ADMIN, json={"app_name": "A\nB"}, headers=HEADERS)
    assert control.status_code == 422


@pytest.mark.db
def test_upload_serve_and_remove_images(clean: Session) -> None:
    client = admin()
    logo = png(320, 80)
    response = client.put(f"{ADMIN}/assets/logo-hell", json=encoded(logo), headers=HEADERS)
    assert response.status_code == 200, response.text
    url = response.json()["logo_light_url"]
    assert url.startswith("/api/branding/assets/logo-hell?v=")
    assert response.json()["logo_dark_url"] is None

    # ohne Anmeldung abrufbar, mit festem Inhaltstyp
    served = client_for(make_app()).get(url)
    assert served.status_code == 200
    assert served.content == logo
    assert served.headers["content-type"] == "image/png"
    assert served.headers["x-content-type-options"] == "nosniff"

    # ersetzen ändert die Adresse
    replaced = client.put(
        f"{ADMIN}/assets/logo-hell", json=encoded(webp_extended(400, 100)), headers=HEADERS
    )
    assert replaced.json()["logo_light_url"] != url
    assert client.get(replaced.json()["logo_light_url"]).headers["content-type"] == "image/webp"

    favicon = client.put(f"{ADMIN}/assets/favicon", json=encoded(png(64, 64)), headers=HEADERS)
    assert favicon.json()["favicon_url"] is not None

    for bad in (b"<svg/>", png(64, 32)):
        rejected = client.put(f"{ADMIN}/assets/favicon", json=encoded(bad), headers=HEADERS)
        assert rejected.status_code == 422
        assert isinstance(rejected.json()["detail"], str)
    broken = client.put(
        f"{ADMIN}/assets/favicon", json={"content_base64": "kein base64!"}, headers=HEADERS
    )
    assert broken.status_code == 422
    unknown = client.put(f"{ADMIN}/assets/banner", json=encoded(logo), headers=HEADERS)
    assert unknown.status_code == 422

    removed = client.delete(f"{ADMIN}/assets/logo-hell", headers=HEADERS)
    assert removed.status_code == 200
    assert removed.json()["logo_light_url"] is None
    assert removed.json()["favicon_url"] is not None
    assert client.get(url).status_code == 404
    actions = clean.scalars(
        select(AuditLog.action).where(AuditLog.object_type == "branding_bild")
    ).all()
    assert "einstellungen.branding_bild_gesetzt" in actions
    assert "einstellungen.branding_bild_entfernt" in actions
