from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.models import AuditLog
from werkbank.main import create_app
from werkbank.modules.evergreen.models import EvItem

ORIGIN = "https://testserver"
BASE = "/api/evergreen"
HEADERS = {"Origin": ORIGIN}


def client_for(roles: list[str], oid: str, name: str = "Ina IT") -> TestClient:
    settings = Settings(public_url=ORIGIN, environment="test", enable_test_login=True)
    client = TestClient(create_app(settings), base_url=ORIGIN, follow_redirects=False)
    response = client.post(
        "/auth/test-login", json={"oid": oid, "name": name, "roles": roles}, headers=HEADERS
    )
    assert response.status_code == 303, response.text
    return client


def it() -> TestClient:
    return client_for(["Evergreen.IT"], "ev-it")


def new_item(client: TestClient, title: str = "Neue Funktion in Teams", **extra: Any) -> int:
    response = client.post(f"{BASE}/items", json={"title": title, **extra}, headers=HEADERS)
    assert response.status_code == 201, response.text
    item_id: int = response.json()["id"]
    return item_id


def act(client: TestClient, item_id: int, action: str, step: str, **extra: Any) -> Any:
    body = {"action": action, "expected_step": step, **extra}
    return client.post(f"{BASE}/items/{item_id}/actions", json=body, headers=HEADERS)


def to_betriebsrat(client: TestClient, item_id: int) -> None:
    for action, step in (
        ("pflichtig", "it_bewertung"),
        ("rueckmeldungen_liegen_vor", "fachabteilungen"),
        ("an_br_uebergeben", "vorlage_br"),
    ):
        assert act(client, item_id, action, step).status_code == 200


def test_api_requires_login() -> None:
    client = TestClient(create_app(Settings(public_url=ORIGIN, environment="test")))
    assert client.get(f"{BASE}/items").status_code == 401


@pytest.mark.db
def test_other_roles_have_no_access(migrated_db: None) -> None:
    client = client_for(["Werkbank.Admin", "Config.Reviewer"], "ev-fremd")
    assert client.get(f"{BASE}/items").status_code == 403
    assert client.post(f"{BASE}/items", json={"title": "Test"}, headers=HEADERS).status_code == 403


@pytest.mark.db
def test_create_numbers_and_validation(migrated_db: None, db_session: Session) -> None:
    client = it()
    rollout = (date.today() + timedelta(days=30)).isoformat()
    first = client.post(
        f"{BASE}/items",
        json={
            "title": "  Copilot in Outlook  ",
            "service": "Exchange",
            "rollout_date": rollout,
            "major_change": True,
        },
        headers=HEADERS,
    ).json()
    second = client.post(f"{BASE}/items", json={"title": "Zweiter"}, headers=HEADERS).json()
    year = date.today().year
    assert first["number"].startswith(f"EV-{year}-")
    assert int(second["number"][-3:]) == int(first["number"][-3:]) + 1
    assert first["title"] == "Copilot in Outlook"
    assert (first["step"], first["step_title"]) == ("it_bewertung", "IT-Bewertung")
    assert first["waiting_for_me"] is True
    assert first["rollout_date"] == rollout

    for body in ({"title": "ab"}, {"title": "x" * 301}, {"title": "ok", "rollout_date": "morgen"}):
        assert client.post(f"{BASE}/items", json=body, headers=HEADERS).status_code == 422
    assert client.post(f"{BASE}/items", json={"title": "Ohne Herkunft"}).status_code == 403

    audit = db_session.scalars(
        select(AuditLog).where(
            AuditLog.action == "vorgang.angelegt", AuditLog.object_id == first["number"]
        )
    ).all()
    assert len(audit) == 1


@pytest.mark.db
def test_betriebsrat_and_gf_see_items_only_when_reached(migrated_db: None) -> None:
    client = it()
    item_id = new_item(client, "Sichtbarkeit")
    br = client_for(["Evergreen.Betriebsrat"], "ev-br", "Bea BR")
    gf = client_for(["Evergreen.GF"], "ev-gf", "Gerd GF")

    def sees(person: TestClient) -> bool:
        ids = [entry["id"] for entry in person.get(f"{BASE}/items?view=alle").json()["entries"]]
        return item_id in ids

    assert not sees(br) and not sees(gf)
    assert br.get(f"{BASE}/items/{item_id}").status_code == 404
    assert act(br, item_id, "zustimmen", "betriebsrat").status_code == 404

    to_betriebsrat(client, item_id)
    assert sees(br) and not sees(gf)
    detail = br.get(f"{BASE}/items/{item_id}").json()
    assert [action["id"] for action in detail["actions"]] == ["zustimmen", "auflagen", "ablehnen"]
    assert detail["can_edit"] is False
    assert br.get(f"{BASE}/items").json()["can_create"] is False
    # der Betriebsrat darf Inhalte nicht ändern
    patch = br.patch(f"{BASE}/items/{item_id}", json={"summary": "x"}, headers=HEADERS)
    assert patch.status_code == 403

    assert act(br, item_id, "auflagen", "betriebsrat").status_code == 422
    done = act(br, item_id, "auflagen", "betriebsrat", comment="Nur Pilotgruppe")
    assert done.status_code == 200
    assert done.json()["item"]["step"] == "geschaeftsfuehrung"
    assert done.json()["actions"] == []
    assert sees(gf)
    listing = gf.get(f"{BASE}/items?view=meine").json()
    mine = listing["entries"]
    assert item_id in [entry["id"] for entry in mine]
    # Zähler für die Filter: nur Sichtbares, unabhängig von der gewählten Ansicht
    counts = listing["counts"]
    assert counts["meine"] == len(mine)
    assert counts["alle"] == counts["offen"] + counts["abgeschlossen"]
    assert counts == gf.get(f"{BASE}/items?view=abgeschlossen").json()["counts"]
    assert client.get(f"{BASE}/items").json()["counts"]["alle"] >= counts["alle"]
    tasks = gf.get("/api/tasks").json()["tasks"]
    assert [task["title"] for task in tasks] == ["Geschäftsführung: Vorgänge bearbeiten"]
    assert tasks[0]["count"] >= 1


@pytest.mark.db
def test_decision_on_behalf_needs_date_and_content(migrated_db: None) -> None:
    client = it()
    item_id = new_item(client, "Im Auftrag")
    to_betriebsrat(client, item_id)
    detail = client.get(f"{BASE}/items/{item_id}").json()
    assert all(action["on_behalf"] and action["comment_required"] for action in detail["actions"])

    today = date.today().isoformat()
    tomorrow = (date.today() + timedelta(days=2)).isoformat()
    assert act(client, item_id, "zustimmen", "betriebsrat").status_code == 422
    assert act(client, item_id, "zustimmen", "betriebsrat", session_date=today).status_code == 422
    future = act(
        client, item_id, "zustimmen", "betriebsrat", session_date=tomorrow, comment="Beschluss"
    )
    assert future.status_code == 422
    done = act(
        client,
        item_id,
        "zustimmen",
        "betriebsrat",
        session_date=today,
        comment="Einstimmig zugestimmt laut Protokoll",
    )
    assert done.status_code == 200
    event = done.json()["events"][-1]
    assert event["on_behalf_of"] == "Betriebsrat"
    assert event["session_date"] == today
    assert event["user"] == "Ina IT"
    assert event["action_title"] == "Zustimmen"
    assert (event["step_title"], event["target_title"]) == ("Betriebsrat", "Geschäftsführung")


@pytest.mark.db
def test_stale_step_wrong_role_and_unknown_action(migrated_db: None) -> None:
    client = it()
    item_id = new_item(client, "Regeln")
    team = client_for(["Evergreen.Team"], "ev-team", "Tom Team")
    assert act(team, item_id, "pflichtig", "it_bewertung").status_code == 403
    assert act(client, item_id, "gibt_es_nicht", "it_bewertung").status_code == 422
    assert act(client, item_id, "pflichtig", "betriebsrat").status_code == 409
    assert act(client, item_id, "nicht_pflichtig", "it_bewertung").status_code == 422
    closed = act(client, item_id, "nicht_pflichtig", "it_bewertung", comment="Reine Optik")
    assert closed.status_code == 200
    assert closed.json()["item"]["finished"] is True
    assert closed.json()["item"]["step_title"] == "Ohne Vorlage abgeschlossen"
    assert closed.json()["can_edit"] is False
    assert act(client, item_id, "pflichtig", "it_bewertung").status_code == 409
    patch = client.patch(f"{BASE}/items/{item_id}", json={"summary": "x"}, headers=HEADERS)
    assert patch.status_code == 409

    assert item_id in [
        entry["id"] for entry in client.get(f"{BASE}/items?view=abgeschlossen").json()["entries"]
    ]
    assert item_id not in [
        entry["id"] for entry in client.get(f"{BASE}/items?view=offen").json()["entries"]
    ]
    assert client.get(f"{BASE}/items?view=unsinn").status_code == 422
    assert client.get(f"{BASE}/items/999999999").status_code == 404


@pytest.mark.db
def test_update_content_and_audit(migrated_db: None, db_session: Session) -> None:
    client = it()
    item_id = new_item(client, "Inhalte")
    url = f"{BASE}/items/{item_id}"
    updated = client.patch(
        url,
        json={
            "summary": "  Neue Schaltfläche in Teams  ",
            "departments_feedback": "Vertrieb: gewünscht",
            "not_controllable": True,
        },
        headers=HEADERS,
    )
    assert updated.status_code == 200, updated.text
    data = updated.json()
    assert data["summary"] == "Neue Schaltfläche in Teams"
    assert data["departments_feedback"] == "Vertrieb: gewünscht"
    assert data["not_controllable"] is True
    assert data["steps"][0]["id"] == "it_bewertung"
    assert len(data["steps"]) == 6

    client.patch(url, json={"summary": ""}, headers=HEADERS)
    assert client.get(url).json()["summary"] is None
    assert client.patch(url, json={"title": "ab"}, headers=HEADERS).status_code == 422

    item = db_session.get(EvItem, item_id)
    assert item is not None
    audit = db_session.scalars(
        select(AuditLog)
        .where(AuditLog.action == "vorgang.geaendert", AuditLog.object_id == item.number)
        .order_by(AuditLog.id)
    ).all()
    assert [entry.details for entry in audit] == [
        {"felder": ["summary", "departments_feedback", "not_controllable"]},
        {"felder": ["summary"]},
    ]
