"""Suche über alle Module: Treffer und Rechte."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session

from tests.test_evergreen_api import BASE as EVERGREEN
from tests.test_evergreen_api import ORIGIN, client_for, new_entry
from tests.test_m365_api import db as m365_db  # noqa: F401  (füllt Einstellungen und Änderungen)
from werkbank.config import Settings
from werkbank.main import create_app
from werkbank.modules.m365_config.models import CfgChange


def hits(client: TestClient, query: str) -> list[dict[str, str]]:
    response = client.get("/api/search", params={"q": query})
    assert response.status_code == 200, response.text
    result: list[dict[str, str]] = response.json()["hits"]
    return result


def test_search_requires_login() -> None:
    anonymous = TestClient(create_app(Settings(public_url=ORIGIN, environment="test")))
    assert anonymous.get("/api/search", params={"q": "teams"}).status_code == 401


@pytest.mark.db
def test_query_limits(migrated_db: None) -> None:
    client = client_for(["Evergreen.Editor"], "suche-it")
    assert client.get("/api/search", params={"q": "a"}).status_code == 422
    assert client.get("/api/search", params={"q": "x" * 101}).status_code == 422
    assert client.get("/api/search").status_code == 422
    # Platzhalter der Datenbank werden als Text gesucht, nicht als Muster
    assert hits(client, "%%") == []
    assert hits(client, "__") == []


@pytest.mark.db
def test_evergreen_hits_for_readers_and_editors(migrated_db: None) -> None:
    it = client_for(["Evergreen.Editor"], "suche-it")
    entry_id = new_entry(it, "Suchwort Zeppelin in Teams")
    number = it.get(f"{EVERGREEN}/entries/{entry_id}").json()["number"]

    found = hits(it, "zeppelin")
    assert [hit["link"] for hit in found] == [f"/m365/neuerungen/{entry_id}"]
    assert found[0]["module"] == "Evergreen"
    assert found[0]["kind"] == "Eintrag"
    assert number in found[0]["subtitle"] and "Microsoft 365" in found[0]["subtitle"]
    assert [hit["link"] for hit in hits(it, number)] == [f"/m365/neuerungen/{entry_id}"]

    reader = client_for(["Evergreen.Reader"], "suche-ev-leser", "Bea Beispiel")
    assert [hit["link"] for hit in hits(reader, "zeppelin")] == [f"/m365/neuerungen/{entry_id}"]

    # Ohne Evergreen-Rolle gibt es keine Treffer aus Evergreen.
    other = client_for(["Config.Reader"], "suche-leser")
    assert hits(other, "zeppelin") == []


@pytest.mark.db
def test_m365_hits_only_with_config_role(m365_db: Session) -> None:  # noqa: F811
    reader = client_for(["Config.Reader"], "suche-leser")
    found = hits(reader, "MFA")
    settings = [hit for hit in found if hit["kind"].startswith("Einstellung")]
    assert settings and all(hit["module"] == "M365-Konfiguration" for hit in settings)
    assert all(hit["link"].startswith("/m365/einstellungen/") for hit in settings)

    m365_db.execute(update(CfgChange).values(changed_by="ada@example.com"))
    m365_db.commit()
    changes = [hit for hit in hits(reader, "ada@example.com") if hit["kind"] == "Änderung"]
    assert changes and "ada@example.com" in changes[0]["subtitle"]

    br = client_for(["Evergreen.Reader"], "suche-br", "Bea BR")
    assert hits(br, "MFA") == []
    assert hits(br, "ada@example.com") == []
