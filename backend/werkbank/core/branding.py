"""Branding: Name, Akzentfarbe, Logos und Favicon aus der Verwaltung.

Name und Bilder erscheinen auch auf der Anmeldeseite und sind deshalb ohne Anmeldung abrufbar.
Geändert werden sie nur von Admins kurz nach einer Anmeldung. Angenommen werden ausschließlich
PNG und WebP (kein SVG: darin könnten Skripte stecken); geprüft wird der Inhalt der Datei, nicht
der Dateiname.
"""

import base64
import binascii
import hashlib
import re
import struct
from dataclasses import dataclass
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.core.app_settings import get_setting, set_setting
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, require_recent_login
from werkbank.core.models import BrandingAsset
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc

BRANDING_KEY = "branding"
DEFAULT_NAME = "Werkbank"
MODULE = "kern"

AssetKind = Literal["logo-hell", "logo-dunkel", "favicon"]
ASSET_KINDS: tuple[str, ...] = ("logo-hell", "logo-dunkel", "favicon")

MAX_IMAGE_BYTES = 256 * 1024
# Base64 braucht vier Zeichen je drei Bytes.
MAX_BASE64_LENGTH = (MAX_IMAGE_BYTES // 3 + 1) * 4
LOGO_MIN_SIZE = 16
LOGO_MAX_SIZE = 2000
FAVICON_MIN_SIZE = 32
FAVICON_MAX_SIZE = 512

ACCENT_PATTERN = re.compile(r"^#[0-9a-f]{6}$")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

router = APIRouter(prefix="/api")

AdminUser = Annotated[CurrentUser, Depends(require_recent_login(Role.WERKBANK_ADMIN))]


class ImageError(ValueError):
    """Die Datei ist kein zulässiges Bild. Der Text ist für die Oberfläche gedacht."""


@dataclass(frozen=True)
class ImageInfo:
    content_type: str
    width: int
    height: int


def _png_size(data: bytes) -> tuple[int, int] | None:
    if not data.startswith(PNG_SIGNATURE) or len(data) < 33 or data[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", data[16:24])
    return int(width), int(height)


def _webp_size(data: bytes) -> tuple[int, int] | None:
    if len(data) < 30 or data[0:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    chunk = data[12:16]
    if chunk == b"VP8 ":
        if data[23:26] != b"\x9d\x01\x2a":
            return None
        width, height = struct.unpack("<HH", data[26:30])
        return width & 0x3FFF, height & 0x3FFF
    if chunk == b"VP8L":
        if data[20] != 0x2F:
            return None
        bits = int.from_bytes(data[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    if chunk == b"VP8X":
        width = int.from_bytes(data[24:27], "little") + 1
        height = int.from_bytes(data[27:30], "little") + 1
        return width, height
    return None


def inspect_image(kind: str, data: bytes) -> ImageInfo:
    """Prüft Format, Dateigröße und Abmessungen eines hochgeladenen Bildes."""
    if len(data) > MAX_IMAGE_BYTES:
        raise ImageError(f"Die Datei ist zu groß (höchstens {MAX_IMAGE_BYTES // 1024} KB).")
    png = _png_size(data)
    webp = None if png else _webp_size(data)
    if kind == "favicon":
        if png is None:
            raise ImageError("Das Favicon muss eine PNG-Datei sein.")
        width, height = png
        if width != height:
            raise ImageError("Das Favicon muss quadratisch sein.")
        if not FAVICON_MIN_SIZE <= width <= FAVICON_MAX_SIZE:
            raise ImageError(
                f"Das Favicon muss zwischen {FAVICON_MIN_SIZE} und {FAVICON_MAX_SIZE} "
                "Pixel breit sein."
            )
        return ImageInfo("image/png", width, height)
    size = png or webp
    if size is None:
        raise ImageError("Erlaubt sind nur PNG- und WebP-Dateien.")
    width, height = size
    if not (LOGO_MIN_SIZE <= width <= LOGO_MAX_SIZE and LOGO_MIN_SIZE <= height <= LOGO_MAX_SIZE):
        raise ImageError(
            f"Das Logo muss in Breite und Höhe zwischen {LOGO_MIN_SIZE} und {LOGO_MAX_SIZE} "
            "Pixel haben."
        )
    return ImageInfo("image/png" if png else "image/webp", width, height)


class BrandingOut(BaseModel):
    app_name: str
    # Eigene Akzentfarbe als #rrggbb, oder None für die Farben der Werkbank.
    accent: str | None
    # Name neben dem Logo anzeigen (ohne Logo steht der Name immer da).
    show_name: bool
    logo_light_url: str | None
    logo_dark_url: str | None
    favicon_url: str | None
    max_image_bytes: int


class BrandingIn(BaseModel):
    app_name: str = Field(max_length=40)
    accent: str | None = Field(default=None, max_length=7)
    show_name: bool = True

    @field_validator("app_name")
    @classmethod
    def name_is_plain(cls, value: str) -> str:
        value = value.strip()
        if any(ord(char) < 32 for char in value):
            raise ValueError("Keine Zeilenumbrüche oder Steuerzeichen")
        return value or DEFAULT_NAME

    @field_validator("accent")
    @classmethod
    def accent_is_hex(cls, value: str | None) -> str | None:
        if value is None or value.strip() == "":
            return None
        value = value.strip().lower()
        if not ACCENT_PATTERN.match(value):
            raise ValueError("Farbe als #rrggbb angeben, z. B. #1f57c3")
        return value


class AssetIn(BaseModel):
    content_base64: str = Field(min_length=1, max_length=MAX_BASE64_LENGTH)


def _stored(db: Session) -> dict[str, Any]:
    value = get_setting(db, BRANDING_KEY)
    return value if isinstance(value, dict) else {}


def _asset_url(kind: str, etags: dict[str, str]) -> str | None:
    etag = etags.get(kind)
    return f"/api/branding/assets/{kind}?v={etag}" if etag else None


def branding_out(db: Session) -> BrandingOut:
    data = _stored(db)
    rows = db.execute(select(BrandingAsset.kind, BrandingAsset.etag)).all()
    etags = {str(row[0]): str(row[1]) for row in rows}
    accent = data.get("accent")
    name = data.get("app_name")
    return BrandingOut(
        app_name=name if isinstance(name, str) and name else DEFAULT_NAME,
        accent=accent if isinstance(accent, str) and ACCENT_PATTERN.match(accent) else None,
        show_name=data.get("show_name") is not False,
        logo_light_url=_asset_url("logo-hell", etags),
        logo_dark_url=_asset_url("logo-dunkel", etags),
        favicon_url=_asset_url("favicon", etags),
        max_image_bytes=MAX_IMAGE_BYTES,
    )


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.get("/branding")
def read_branding(db: DbDep) -> BrandingOut:
    """Name, Farbe und Bilder der Oberfläche. Ohne Anmeldung, weil die Anmeldeseite sie zeigt."""
    return branding_out(db)


@router.get("/branding/assets/{kind}")
def read_asset(db: DbDep, kind: AssetKind) -> Response:
    """Logo oder Favicon. Ohne Anmeldung abrufbar (Anmeldeseite, Browser-Tab)."""
    asset = db.get(BrandingAsset, kind)
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kein Bild")
    return Response(
        content=asset.data,
        media_type=asset.content_type,
        headers={
            "Cache-Control": "public, max-age=3600",
            "ETag": f'"{asset.etag}"',
            "Content-Disposition": "inline",
        },
    )


@router.put("/admin/branding")
def update_branding(request: Request, body: BrandingIn, user: AdminUser, db: DbDep) -> BrandingOut:
    """Speichert Name, Akzentfarbe und ob der Name neben dem Logo steht."""
    value = {"app_name": body.app_name, "accent": body.accent, "show_name": body.show_name}
    set_setting(db, BRANDING_KEY, value, user.user_id)
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.branding_geaendert",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=BRANDING_KEY,
        ip=client_ip(request),
        details=value,
    )
    db.commit()
    return branding_out(db)


@router.put("/admin/branding/assets/{kind}")
def upload_asset(
    request: Request, kind: AssetKind, body: AssetIn, user: AdminUser, db: DbDep
) -> BrandingOut:
    """Nimmt ein Logo oder Favicon an (PNG, bei Logos auch WebP)."""
    try:
        data = base64.b64decode(body.content_base64, validate=True)
        info = inspect_image(kind, data)
    except binascii.Error as error:
        raise HTTPException(status_code=422, detail="Die Datei ist nicht lesbar.") from error
    except ImageError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    etag = hashlib.sha256(data).hexdigest()[:32]
    asset = db.get(BrandingAsset, kind)
    if asset is None:
        asset = BrandingAsset(kind=kind)
        db.add(asset)
    asset.content_type = info.content_type
    asset.data = data
    asset.etag = etag
    asset.width = info.width
    asset.height = info.height
    asset.updated_at = now_utc()
    asset.updated_by = user.user_id
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.branding_bild_gesetzt",
        user_id=user.user_id,
        object_type="branding_bild",
        object_id=kind,
        ip=client_ip(request),
        details={
            "format": info.content_type,
            "breite": info.width,
            "hoehe": info.height,
            "bytes": len(data),
        },
    )
    db.commit()
    return branding_out(db)


@router.delete("/admin/branding/assets/{kind}")
def delete_asset(request: Request, kind: AssetKind, user: AdminUser, db: DbDep) -> BrandingOut:
    """Entfernt ein Logo oder Favicon; danach gilt wieder das Zeichen der Werkbank."""
    asset = db.get(BrandingAsset, kind)
    if asset is not None:
        db.delete(asset)
        write_audit(
            db,
            module=MODULE,
            action="einstellungen.branding_bild_entfernt",
            user_id=user.user_id,
            object_type="branding_bild",
            object_id=kind,
            ip=client_ip(request),
        )
        db.commit()
    return branding_out(db)
