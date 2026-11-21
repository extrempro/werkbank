"""Konto: angemeldete Geräte ansehen und auf anderen Geräten abmelden."""

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.test_m365_api import ORIGIN, client_for
from werkbank.config import Settings
from werkbank.core.models import AuditLog
from werkbank.core.user_agent import describe_device
from werkbank.main import create_app

HEADERS = {"Origin": ORIGIN}
BASE = "/api/account/sessions"


@pytest.mark.parametrize(
    ("agent", "expected"),
    [
        (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0",
            "Edge unter Windows",
        ),
        (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
            "Safari auf dem iPhone",
        ),
        (
            "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/142.0.0.0 Mobile Safari/537.36",
            "Chrome unter Android",
        ),
        (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:145.0) Gecko/20100101 Firefox/145.0",
            "Firefox unter macOS",
        ),
        (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/142.0.0.0 Safari/537.36",
            "Chrome unter Linux",
        ),
        (
            "Mozilla/5.0 (iPad; CPU OS 26_1 like Mac OS X) CriOS/142.0 Mobile Safari",
            "Chrome auf dem iPad",
        ),
        ("curl/8.11", "Unbekanntes Gerät"),
        ("", "Unbekanntes Gerät"),
        (None, "Unbekanntes Gerät"),
        ("Mozilla/5.0 (Windows NT 10.0) <script>", "Browser unter Windows"),
    ],
)
def test_describe_device(agent: str | None, expected: str) -> None:
    assert describe_device(agent) == expected


def login(oid: str, agent: str) -> TestClient:
    client = TestClient(
        create_app(Settings(public_url=ORIGIN, environment="test", enable_test_login=True)),
        base_url=ORIGIN,
        follow_redirects=False,
        headers={"User-Agent": agent},
    )
    response = client.post(
        "/auth/test-login",
        json={"oid": oid, "name": "Gina Geräte", "roles": ["Config.Reader"]},
        headers=HEADERS,
    )
    assert response.status_code == 303, response.text
    return client


EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0 Safari/537.36 Edg/142.0"
IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) Version/26.1 Mobile Safari/604.1"


@pytest.mark.db
def test_list_end_and_logout_others(db_session: Session) -> None:
    oid = f"geraete-{uuid.uuid4().hex[:8]}"
    laptop = login(oid, EDGE)
    phone = login(oid, IPHONE)
    tablet = login(oid, "Mozilla/5.0 (iPad; CPU OS 26_1 like Mac OS X) Safari/604.1")
    stranger = client_for(["Config.Reader"], f"fremd-{uuid.uuid4().hex[:8]}")

    sessions: list[dict[str, Any]] = laptop.get(BASE).json()
    assert sessions[0]["device"] == "Edge unter Windows"
    assert sessions[0]["current"] is True
    assert {entry["device"] for entry in sessions} == {
        "Edge unter Windows",
        "Safari auf dem iPhone",
        "Safari auf dem iPad",
    }
    assert [entry["current"] for entry in sessions].count(True) == 1
    phone_id = next(entry["id"] for entry in sessions if entry["device"] == "Safari auf dem iPhone")
    own_id = sessions[0]["id"]

    # Fremde Sitzungen sieht und beendet niemand; die eigene nur über „Abmelden“.
    assert all(entry["device"] != "Edge unter Windows" for entry in stranger.get(BASE).json())
    assert stranger.delete(f"{BASE}/{phone_id}", headers=HEADERS).status_code == 404
    assert laptop.delete(f"{BASE}/{own_id}", headers=HEADERS).status_code == 409
    assert laptop.delete(f"{BASE}/kein-uuid", headers=HEADERS).status_code == 422
    # Ohne passende Origin lehnt der CSRF-Schutz ab.
    assert laptop.delete(f"{BASE}/{phone_id}").status_code == 403

    assert laptop.delete(f"{BASE}/{phone_id}", headers=HEADERS).json() == {"ended": 1}
    assert phone.get("/api/me").status_code == 401
    assert len(laptop.get(BASE).json()) == 2

    assert laptop.post(f"{BASE}/logout-others", headers=HEADERS).json() == {"ended": 1}
    assert tablet.get("/api/me").status_code == 401
    assert laptop.get("/api/me").status_code == 200
    assert [entry["device"] for entry in laptop.get(BASE).json()] == ["Edge unter Windows"]
    assert stranger.get("/api/me").status_code == 200

    actions = db_session.scalars(
        select(AuditLog.action).where(
            AuditLog.action.in_(["sitzung.beendet", "sitzungen.andere_beendet"])
        )
    ).all()
    assert "sitzung.beendet" in actions and "sitzungen.andere_beendet" in actions
    # Ohne Anmeldung keine Liste
    assert TestClient(laptop.app, base_url=ORIGIN).get(BASE).status_code == 401
