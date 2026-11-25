import pytest
from fastapi.testclient import TestClient

from werkbank.main import create_app
from werkbank.security import SECURITY_HEADERS

client = TestClient(create_app())


def test_health_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_security_headers_present() -> None:
    response = client.get("/health")
    for name, value in SECURITY_HEADERS.items():
        assert response.headers[name] == value


def test_api_answers_are_never_stored() -> None:
    assert client.get("/health").headers["Cache-Control"] == "no-store"
    # Auch Fehlerantworten der API (hier: nicht angemeldet)
    assert client.get("/api/tasks").headers["Cache-Control"] == "no-store"
    assert client.get("/api/notifications").headers["Cache-Control"] == "no-store"


def test_api_docs_disabled() -> None:
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


@pytest.mark.db
def test_ready_with_database(migrated_db: None) -> None:
    response = client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_test_routes_only_in_test_environment() -> None:
    """Die Hilfspfade für automatische Tests gibt es in Produktion gar nicht."""
    from starlette.routing import NoMatchFound

    from werkbank.config import Settings

    production = create_app(
        Settings(public_url="https://werkbank.example.test", environment="production")
    )
    for name in ("test_mail", "test_outbox", "test_membership"):
        with pytest.raises(NoMatchFound):
            production.url_path_for(name)
    test = create_app(
        Settings(
            public_url="https://werkbank.example.test", environment="test", enable_test_login=True
        )
    )
    assert test.url_path_for("test_mail") == "/api/tickets/test/mail"
