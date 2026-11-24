"""Profilbild aus Entra: Abruf, Speicherung, Auslieferung."""

from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.test_auth import (
    FakeEntra,
    client_for,
    good_claims,
    login_as,
    make_app,
    make_settings,
)
from werkbank import __version__
from werkbank.core.auth import get_entra_client
from werkbank.core.avatar import (
    MAX_PHOTO_BYTES,
    PHOTO_URL,
    NoPhoto,
    Photo,
    PhotoResult,
    detect_image_type,
    fetch_photo,
    get_photo_fetcher,
)
from werkbank.core.models import UserAvatar

JPEG = b"\xff\xd8\xff\xe0" + b"bild" * 10
PNG = b"\x89PNG\r\n\x1a\n" + b"bild" * 10


class TokenEntra(FakeEntra):
    """Wie FakeEntra, liefert zusätzlich ein Zugriffstoken und merkt sich die Scopes."""

    def __init__(self, claims: dict[str, Any]) -> None:
        super().__init__(claims)
        self.scopes: list[str] = []

    def initiate_auth_code_flow(
        self, scopes: list[str], redirect_uri: str | None = None, **kwargs: Any
    ) -> dict[str, Any]:
        self.scopes = scopes
        return super().initiate_auth_code_flow(scopes, redirect_uri, **kwargs)

    def acquire_token_by_auth_code_flow(
        self, auth_code_flow: dict[str, Any], auth_response: dict[str, Any], **kwargs: Any
    ) -> dict[str, Any]:
        return {"id_token_claims": self.claims, "access_token": "zugriff"}


def entra_login(result: PhotoResult, *, enabled: bool = True, oid: str | None = None) -> TestClient:
    """Meldet eine Person über das nachgestellte Entra an; der Bildabruf liefert `result`."""
    claims = good_claims(**({"oid": oid} if oid else {}))
    fake = TokenEntra(claims)
    tokens: list[str] = []

    def fetcher(token: str) -> PhotoResult:
        tokens.append(token)
        return result

    app = make_app(make_settings(entra_profile_photo=enabled))
    app.dependency_overrides[get_entra_client] = lambda: fake
    app.dependency_overrides[get_photo_fetcher] = lambda: fetcher
    client = client_for(app)
    assert client.get("/auth/login").status_code == 303
    assert client.get("/auth/callback", params={"code": "x", "state": "abc"}).status_code == 303
    client.fake = fake
    client.tokens = tokens
    return client


def test_detect_image_type() -> None:
    assert detect_image_type(JPEG) == "image/jpeg"
    assert detect_image_type(PNG) == "image/png"
    assert detect_image_type(b"<svg onload=alert(1)>") is None
    assert detect_image_type(b"") is None


def graph(status: int, content: bytes = b"") -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == PHOTO_URL
        assert request.headers["Authorization"] == "Bearer zugriff"
        return httpx.Response(status, content=content)

    return httpx.MockTransport(handler)


def test_fetch_photo_results() -> None:
    photo = fetch_photo("zugriff", graph(200, JPEG))
    assert isinstance(photo, Photo)
    assert photo.content_type == "image/jpeg"
    assert isinstance(fetch_photo("zugriff", graph(404)), NoPhoto)
    # Fehler, fremde Formate und zu große Dateien ändern nichts am gespeicherten Bild
    assert fetch_photo("zugriff", graph(403)) is None
    assert fetch_photo("zugriff", graph(200, b"<html>")) is None
    assert fetch_photo("zugriff", graph(200, JPEG + b"x" * MAX_PHOTO_BYTES)) is None

    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("kein Netz")

    assert fetch_photo("zugriff", httpx.MockTransport(broken)) is None


@pytest.mark.db
def test_login_without_setting_asks_no_extra_scope(migrated_db: None) -> None:
    client = entra_login(Photo("image/jpeg", JPEG), enabled=False)
    assert client.fake.scopes == ["email"]
    assert client.tokens == []
    assert client.get("/api/me").json()["avatar_url"] is None


@pytest.mark.db
def test_login_stores_photo_and_everyone_can_see_it(migrated_db: None, db_session: Session) -> None:
    oid = "22222222-2222-2222-2222-222222222222"
    client = entra_login(Photo("image/jpeg", JPEG), oid=oid)
    assert client.fake.scopes == ["email", "User.Read"]
    assert client.tokens == ["zugriff"]

    me = client.get("/api/me").json()
    assert me["version"] == __version__
    assert me["session_expires_at"] > me["authenticated_at"]
    url = me["avatar_url"]
    assert url.startswith(f"/api/users/{me['user_id']}/avatar?v=")
    response = client.get(url)
    assert response.status_code == 200
    assert response.content == JPEG
    assert response.headers["content-type"] == "image/jpeg"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "private" in response.headers["cache-control"]

    # Eine andere angemeldete Person sieht das Bild, ohne Anmeldung gibt es nichts.
    other = client_for(make_app())
    login_as(other, ["Evergreen.Reader"], oid="avatar-andere")
    assert other.get(url).status_code == 200
    assert client_for(make_app()).get(url).status_code == 401
    assert other.get("/api/users/00000000-0000-0000-0000-000000000000/avatar").status_code == 404
    assert other.get("/api/users/keine-id/avatar").status_code == 422

    # Neues Bild ersetzt das alte, ein Fehler beim Abruf lässt es stehen, „kein Bild“ löscht es.
    assert entra_login(Photo("image/png", PNG), oid=oid).get(url).content == PNG
    assert entra_login(None, oid=oid).get(url).content == PNG
    gone = entra_login(NoPhoto(), oid=oid)
    assert gone.get("/api/me").json()["avatar_url"] is None
    assert gone.get(url).status_code == 404
    assert db_session.scalars(select(UserAvatar)).all() == []


@pytest.mark.db
def test_permissions_list_carries_avatar(migrated_db: None) -> None:
    oid = "33333333-3333-3333-3333-333333333333"
    entra_login(Photo("image/jpeg", JPEG), oid=oid)
    admin = client_for(make_app(make_settings(step_up_minutes=15)))
    login_as(admin, ["Werkbank.Admin"], oid="avatar-admin")
    people = admin.get("/api/admin/permissions").json()["people"]
    with_photo = [person for person in people if person["avatar_url"]]
    assert with_photo and with_photo[0]["display_name"] == "Max Beispiel"
