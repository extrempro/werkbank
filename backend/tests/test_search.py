"""Suche über alle Module: Treffer und Rechte."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update
from sqlalchemy.orm import Session

from tests.test_evergreen_api import BASE as EVERGREEN
from tests.test_evergreen_api import ORIGIN, client_for, new_item, to_betriebsrat
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
    client = client_for(["Evergreen.IT"], "suche-it")
    assert client.get("/api/search", params={"q": "a"}).status_code == 422
    assert client.get("/api/search", params={"q": "x" * 101}).status_code == 422
    assert client.get("/api/search").status_code == 422
    # Platzhalter der Datenbank werden als Text gesucht, nicht als Muster
    assert hits(client, "%%") == []
    assert hits(client, "__") == []


@pytest.mark.db
def test_evergreen_hits_follow_visibility(migrated_db: None) -> None:
    it = client_for(["Evergreen.IT"], "suche-it")
    item_id = new_item(it, "Suchwort Zeppelin in Teams", service="Teams")
    number = it.get(f"{EVERGREEN}/items/{item_id}").json()["item"]["number"]

    found = hits(it, "zeppelin")
    assert [hit["link"] for hit in found] == [f"/evergreen/{item_id}"]
    assert found[0]["module"] == "Evergreen"
    assert found[0]["kind"] == "Vorgang"
    assert number in found[0]["subtitle"]
    assert [hit["link"] for hit in hits(it, number)] == [f"/evergreen/{item_id}"]

    # Der Betriebsrat findet den Vorgang erst, wenn er ihm vorgelegt wurde.
    br = client_for(["Evergreen.Betriebsrat"], "suche-br", "Bea BR")
    assert hits(br, "zeppelin") == []
    to_betriebsrat(it, item_id)
    assert [hit["link"] for hit in hits(br, "zeppelin")] == [f"/evergreen/{item_id}"]

    # Ohne Evergreen-Rolle gibt es keine Treffer aus Evergreen.
    reader = client_for(["Config.Reader"], "suche-leser")
    assert hits(reader, "zeppelin") == []


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

    br = client_for(["Evergreen.Betriebsrat"], "suche-br", "Bea BR")
    assert hits(br, "MFA") == []
    assert hits(br, "ada@example.com") == []
