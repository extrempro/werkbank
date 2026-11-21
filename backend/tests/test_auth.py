from datetime import timedelta
from typing import Annotated, Any

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.auth import get_entra_client
from werkbank.core.deps import require_roles
from werkbank.core.models import AuditLog, UserSession
from werkbank.core.roles import Role, filter_known_roles
from werkbank.core.sessions import SESSION_COOKIE, CurrentUser, hash_token, now_utc
from werkbank.main import create_app

ORIGIN = "https://testserver"
TENANT = "00000000-0000-0000-0000-00000000aaaa"


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "public_url": ORIGIN,
        "environment": "test",
        "enable_test_login": True,
        "entra_tenant_id": TENANT,
        "entra_client_id": "00000000-0000-0000-0000-00000000bbbb",
    }
    values.update(overrides)
    return Settings(**values)


AdminUser = Annotated[CurrentUser, Depends(require_roles(Role.WERKBANK_ADMIN))]


def make_app(settings: Settings | None = None) -> FastAPI:
    app = create_app(settings or make_settings())

    @app.get("/api/nur-admin")
    def nur_admin(user: AdminUser) -> dict[str, str]:
        return {"name": user.display_name}

    return app


def client_for(app: FastAPI) -> TestClient:
    return TestClient(app, base_url=ORIGIN, follow_redirects=False)


def login_as(client: TestClient, roles: list[str], oid: str = "person-1") -> None:
    response = client.post(
        "/auth/test-login",
        json={"oid": oid, "name": "Erika Beispiel", "email": "erika@example.com", "roles": roles},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 303, response.text


# --- ohne Datenbank -------------------------------------------------------------------


def test_filter_known_roles() -> None:
    result = filter_known_roles(["Config.Reader", "Unbekannt", "Config.Reader", 5])
    assert result == ["Config.Reader"]
    assert filter_known_roles("Werkbank.Admin") == []
    assert filter_known_roles(None) == []


def test_test_login_not_allowed_in_production() -> None:
    with pytest.raises(RuntimeError):
        create_app(make_settings(environment="production", enable_test_login=True))


def test_test_login_hidden_when_disabled() -> None:
    client = client_for(make_app(make_settings(enable_test_login=False)))
    response = client.post(
        "/auth/test-login",
        json={"oid": "x", "name": "x", "roles": ["Werkbank.Admin"]},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 404


def test_post_without_origin_is_rejected() -> None:
    client = client_for(make_app())
    response = client.post("/auth/test-login", json={"oid": "x", "name": "x", "roles": []})
    assert response.status_code == 403


def test_post_with_foreign_origin_is_rejected() -> None:
    client = client_for(make_app())
    response = client.post(
        "/auth/test-login",
        json={"oid": "x", "name": "x", "roles": []},
        headers={"Origin": "https://angreifer.example.com"},
    )
    assert response.status_code == 403


def test_me_requires_login() -> None:
    client = client_for(make_app())
    assert client.get("/api/me").status_code == 401


# --- mit Datenbank --------------------------------------------------------------------


@pytest.mark.db
def test_test_login_creates_session_and_me_works(migrated_db: None) -> None:
    client = client_for(make_app())
    login_as(client, ["Config.Reader", "Unbekannt"])
    cookie = client.cookies.get(SESSION_COOKIE)
    assert cookie
    me = client.get("/api/me")
    assert me.status_code == 200
    assert me.json()["display_name"] == "Erika Beispiel"
    assert me.json()["roles"] == ["Config.Reader"]


@pytest.mark.db
def test_login_without_known_role_is_denied(migrated_db: None, db_session: Session) -> None:
    client = client_for(make_app())
    response = client.post(
        "/auth/test-login",
        json={"oid": "ohne-rolle", "name": "Ohne Rolle", "roles": ["Irgendwas"]},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 403
    actions = db_session.scalars(select(AuditLog.action)).all()
    assert "anmeldung.abgelehnt" in actions


@pytest.mark.db
def test_role_check(migrated_db: None) -> None:
    client = client_for(make_app())
    login_as(client, ["Config.Reader"], oid="leser")
    assert client.get("/api/nur-admin").status_code == 403
    admin = client_for(make_app())
    login_as(admin, ["Werkbank.Admin"], oid="admin")
    assert admin.get("/api/nur-admin").status_code == 200


@pytest.mark.db
def test_logout_ends_session(migrated_db: None, db_session: Session) -> None:
    client = client_for(make_app())
    login_as(client, ["Config.Reader"], oid="abmelden")
    token = client.cookies.get(SESSION_COOKIE) or ""
    response = client.post("/auth/logout", headers={"Origin": ORIGIN})
    assert response.status_code == 303
    stored = db_session.scalars(
        select(UserSession).where(UserSession.token_hash == hash_token(token))
    ).all()
    assert stored == []


@pytest.mark.db
def test_idle_timeout(migrated_db: None, db_session: Session) -> None:
    client = client_for(make_app())
    login_as(client, ["Config.Reader"], oid="leerlauf")
    db_session.execute(update(UserSession).values(last_seen_at=now_utc() - timedelta(hours=1)))
    db_session.commit()
    assert client.get("/api/me").status_code == 401


@pytest.mark.db
def test_session_token_not_stored_in_plain_text(migrated_db: None, db_session: Session) -> None:
    client = client_for(make_app())
    login_as(client, ["Config.Reader"], oid="hash")
    token = client.cookies.get(SESSION_COOKIE)
    hashes = db_session.scalars(select(UserSession.token_hash)).all()
    assert token not in hashes


class FakeEntra:
    """Ersetzt MSAL im Test."""

    def __init__(self, claims: dict[str, Any] | None = None, error: str | None = None) -> None:
        self.claims = claims
        self.error = error

    def initiate_auth_code_flow(
        self, scopes: list[str], redirect_uri: str | None = None, **kwargs: Any
    ) -> dict[str, Any]:
        return {"auth_uri": "https://login.example.com/authorize", "state": "abc"}

    def acquire_token_by_auth_code_flow(
        self, auth_code_flow: dict[str, Any], auth_response: dict[str, Any], **kwargs: Any
    ) -> dict[str, Any]:
        if self.error:
            return {"error": self.error}
        return {"id_token_claims": self.claims}


def entra_app(fake: FakeEntra) -> TestClient:
    app = make_app()
    app.dependency_overrides[get_entra_client] = lambda: fake
    return client_for(app)


def good_claims(**overrides: Any) -> dict[str, Any]:
    claims: dict[str, Any] = {
        "tid": TENANT,
        "oid": "11111111-1111-1111-1111-111111111111",
        "name": "Max Beispiel",
        "preferred_username": "max@example.com",
        "roles": ["Evergreen.Reader"],
    }
    claims.update(overrides)
    return claims


@pytest.mark.db
def test_entra_login_flow(migrated_db: None) -> None:
    client = entra_app(FakeEntra(good_claims()))
    start = client.get("/auth/login", params={"return_to": "/evergreen"})
    assert start.status_code == 303
    assert start.headers["location"] == "https://login.example.com/authorize"
    back = client.get("/auth/callback", params={"code": "x", "state": "abc"})
    assert back.status_code == 303
    assert back.headers["location"] == "/evergreen"
    assert client.get("/api/me").json()["roles"] == ["Evergreen.Reader"]


@pytest.mark.db
def test_entra_wrong_tenant_is_denied(migrated_db: None) -> None:
    client = entra_app(FakeEntra(good_claims(tid="fremder-mandant")))
    client.get("/auth/login")
    assert client.get("/auth/callback", params={"code": "x"}).status_code == 403


@pytest.mark.db
def test_entra_without_role_is_denied(migrated_db: None) -> None:
    client = entra_app(FakeEntra(good_claims(roles=[])))
    client.get("/auth/login")
    assert client.get("/auth/callback", params={"code": "x"}).status_code == 403


@pytest.mark.db
def test_entra_error_is_denied(migrated_db: None) -> None:
    client = entra_app(FakeEntra(error="invalid_grant"))
    client.get("/auth/login")
    assert client.get("/auth/callback", params={"code": "x"}).status_code == 403


@pytest.mark.db
def test_callback_without_flow_is_denied(migrated_db: None) -> None:
    client = entra_app(FakeEntra(good_claims()))
    assert client.get("/auth/callback", params={"code": "x"}).status_code == 403


@pytest.mark.db
def test_open_redirect_is_prevented(migrated_db: None) -> None:
    client = entra_app(FakeEntra(good_claims(oid="22222222-2222-2222-2222-222222222222")))
    client.get("/auth/login", params={"return_to": "//angreifer.example.com"})
    back = client.get("/auth/callback", params={"code": "x"})
    assert back.headers["location"] == "/"
