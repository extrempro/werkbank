"""Profilbild aus Entra ID (spec.md 6.1).

Das Bild wird bei der Anmeldung im Namen der Person geholt (delegierte Berechtigung
`User.Read`), verkleinert von Microsoft geliefert und in der Datenbank gespeichert. Alle
angemeldeten Personen können es sehen. Ohne Bild in Entra zeigt die Oberfläche die Initialen.
"""

import hashlib
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.core.deps import CurrentUserDep, DbDep
from werkbank.core.models import UserAvatar
from werkbank.core.sessions import now_utc

PHOTO_URL = "https://graph.microsoft.com/v1.0/me/photos/120x120/$value"
PHOTO_SCOPE = "User.Read"
MAX_PHOTO_BYTES = 512 * 1024
PHOTO_TIMEOUT_SECONDS = 5.0

router = APIRouter(prefix="/api")


@dataclass(frozen=True)
class Photo:
    content_type: str
    data: bytes


class NoPhoto:
    """Die Person hat in Entra kein Bild."""


# Ergebnis des Abrufs: Bild, „kein Bild vorhanden“ oder None (Abruf nicht möglich).
PhotoResult = Photo | NoPhoto | None
PhotoFetcher = Callable[[str], PhotoResult]


def detect_image_type(data: bytes) -> str | None:
    """Erkennt JPEG und PNG am Anfang der Datei. Andere Formate werden nicht angenommen."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    return None


def fetch_photo(access_token: str, transport: httpx.BaseTransport | None = None) -> PhotoResult:
    """Holt das eigene Profilbild von Microsoft Graph. Fehler brechen die Anmeldung nie ab."""
    try:
        with httpx.Client(timeout=PHOTO_TIMEOUT_SECONDS, transport=transport) as client:
            response = client.get(PHOTO_URL, headers={"Authorization": f"Bearer {access_token}"})
    except httpx.HTTPError:
        return None
    if response.status_code == status.HTTP_404_NOT_FOUND:
        return NoPhoto()
    if response.status_code != status.HTTP_200_OK:
        return None
    data = response.content
    content_type = detect_image_type(data)
    if content_type is None or len(data) > MAX_PHOTO_BYTES:
        return None
    return Photo(content_type=content_type, data=data)


def get_photo_fetcher() -> PhotoFetcher:
    """In Tests ersetzbar."""
    return fetch_photo


PhotoFetcherDep = Annotated[PhotoFetcher, Depends(get_photo_fetcher)]


def store_photo(db: Session, user_id: uuid.UUID, result: PhotoResult) -> None:
    """Übernimmt das Ergebnis: neues Bild speichern, fehlendes Bild löschen, sonst nichts tun."""
    if result is None:
        return
    current = db.get(UserAvatar, user_id)
    if isinstance(result, NoPhoto):
        if current is not None:
            db.delete(current)
        return
    etag = hashlib.sha256(result.data).hexdigest()[:32]
    if current is None:
        db.add(
            UserAvatar(
                user_id=user_id,
                content_type=result.content_type,
                data=result.data,
                etag=etag,
                updated_at=now_utc(),
            )
        )
    elif current.etag != etag:
        current.content_type = result.content_type
        current.data = result.data
        current.etag = etag
        current.updated_at = now_utc()


def avatar_url(user_id: uuid.UUID, etag: str | None) -> str | None:
    """Adresse des Bildes für die Oberfläche. Der Zusatz ändert sich mit dem Bild."""
    return f"/api/users/{user_id}/avatar?v={etag}" if etag else None


def avatar_etags(db: Session, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    """Kennungen der Bilder für mehrere Personen, ohne die Bilddaten zu laden."""
    if not user_ids:
        return {}
    rows = db.execute(
        select(UserAvatar.user_id, UserAvatar.etag).where(UserAvatar.user_id.in_(user_ids))
    ).all()
    return {row[0]: row[1] for row in rows}


@router.get("/users/{user_id}/avatar")
def get_avatar(user: CurrentUserDep, db: DbDep, user_id: uuid.UUID) -> Response:
    """Profilbild einer Person. Für alle angemeldeten Personen sichtbar."""
    avatar = db.get(UserAvatar, user_id)
    if avatar is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kein Bild")
    return Response(
        content=avatar.data,
        media_type=avatar.content_type,
        headers={
            "Cache-Control": "private, max-age=86400",
            "ETag": f'"{avatar.etag}"',
            "Content-Disposition": "inline",
        },
    )
