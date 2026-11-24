from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.auth import get_entra_client
from werkbank.core.deps import STEP_UP_HEADER
from werkbank.core.models import User, UserSession
from werkbank.core.sessions import SESSION_COOKIE, hash_token, now_utc
from werkbank.main import create_app

ORIGIN = "https://testserver"
TENANT = "00000000-0000-0000-0000-00000000aaaa"


def make_client() -> TestClient:
    settings = Settings(
        public_url=ORIGIN, environment="test", enable_test_login=True, entra_tenant_id=TENANT
    )
    return TestClient(create_app(settings), base_url=ORIGIN, follow_redirects=False)


def login(client: TestClient, oid: str, roles: list[str]) -> None:
    response = client.post(
        "/auth/test-login",
        json={"oid": oid, "name": "Ada Admin", "roles": roles},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 303, response.text


def session_of(db: Session, client: TestClient) -> UserSession:
    token = client.cookies.get(SESSION_COOKIE)
    assert token
    return db.execute(
        select(UserSession).where(UserSession.token_hash == hash_token(token))
    ).scalar_one()


@pytest.mark.db
def test_admin_area_needs_recent_login(migrated_db: None, db_session: Session) -> None:
    client = make_client()
    login(client, "stepup-admin", ["Werkbank.Admin"])
    assert client.get("/api/admin/permissions").status_code == 200

    token = client.cookies.get(SESSION_COOKIE)
    assert token
    db_session.execute(
        update(UserSession)
        .where(UserSession.token_hash == hash_token(token))
        .values(authenticated_at=now_utc() - timedelta(minutes=16))
    )
    db_session.commit()

    stale = client.get("/api/admin/permissions")
    assert stale.status_code == 403
    assert stale.headers[STEP_UP_HEADER] == "required"
    # Das Audit-Log gehört nicht zur Verwaltung und bleibt erreichbar
    assert client.get("/api/audit").status_code == 200


@pytest.mark.db
def test_missing_role_is_not_reported_as_step_up(migrated_db: None) -> None:
    client = make_client()
    login(client, "stepup-leser", ["Config.Reader"])
    response = client.get("/api/admin/permissions")
    assert response.status_code == 403
    assert STEP_UP_HEADER not in response.headers


@pytest.mark.db
def test_new_login_replaces_old_session(migrated_db: None, db_session: Session) -> None:
    client = make_client()
    login(client, "stepup-wechsel", ["Werkbank.Admin"])
    first = client.cookies.get(SESSION_COOKIE)
    assert first
    login(client, "stepup-wechsel", ["Werkbank.Admin"])
    second = client.cookies.get(SESSION_COOKIE)
    assert second and second != first

    user = db_session.execute(
        select(User).where(User.entra_oid == "test:stepup-wechsel")
    ).scalar_one()
    hashes = db_session.scalars(
        select(UserSession.token_hash).where(UserSession.user_id == user.id)
    ).all()
    assert hashes == [hash_token(second)]


class FakeEntra:
    """Ersetzt MSAL im Test und merkt sich die Parameter der Anmeldung."""

    def __init__(self, claims: dict[str, Any]) -> None:
        self.claims = claims
        self.kwargs: dict[str, Any] = {}

    def initiate_auth_code_flow(
        self, scopes: list[str], redirect_uri: str | None = None, **kwargs: Any
    ) -> dict[str, Any]:
        self.kwargs = kwargs
        return {"auth_uri": "https://login.example.com/authorize", "state": "abc"}

    def acquire_token_by_auth_code_flow(
        self, auth_code_flow: dict[str, Any], auth_response: dict[str, Any], **kwargs: Any
    ) -> dict[str, Any]:
        return {"id_token_claims": self.claims}


def entra_client(fake: FakeEntra) -> TestClient:
    client = make_client()
    app: Any = client.app
    app.dependency_overrides[get_entra_client] = lambda: fake
    return client


def claims(**overrides: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "tid": TENANT,
        "oid": "33333333-3333-3333-3333-333333333333",
        "name": "Ada Admin",
        "roles": ["Werkbank.Admin"],
    }
    values.update(overrides)
    return values


@pytest.mark.db
def test_step_up_login_asks_entra_for_fresh_login(migrated_db: None) -> None:
    fake = FakeEntra(claims())
    client = entra_client(fake)
    client.get("/auth/login")
    assert fake.kwargs.get("prompt") is None
    client.get("/auth/login", params={"step_up": "true", "return_to": "/verwaltung"})
    assert fake.kwargs.get("prompt") == "login"
    back = client.get("/auth/callback", params={"code": "x"})
    assert back.headers["location"] == "/verwaltung"


@pytest.mark.db
def test_old_auth_time_does_not_count_as_fresh(migrated_db: None, db_session: Session) -> None:
    old = datetime.now(UTC) - timedelta(hours=2)
    client = entra_client(FakeEntra(claims(auth_time=int(old.timestamp()))))
    client.get("/auth/login")
    assert client.get("/auth/callback", params={"code": "x"}).status_code == 303

    stored = session_of(db_session, client).authenticated_at
    assert abs((stored - old).total_seconds()) < 2
    response = client.get("/api/admin/permissions")
    assert response.status_code == 403
    assert response.headers[STEP_UP_HEADER] == "required"


@pytest.mark.db
def test_auth_time_in_the_future_is_capped(migrated_db: None, db_session: Session) -> None:
    future = datetime.now(UTC) + timedelta(days=1)
    client = entra_client(
        FakeEntra(
            claims(oid="44444444-4444-4444-4444-444444444444", auth_time=int(future.timestamp()))
        )
    )
    client.get("/auth/login")
    client.get("/auth/callback", params={"code": "x"})
    assert session_of(db_session, client).authenticated_at <= now_utc()
