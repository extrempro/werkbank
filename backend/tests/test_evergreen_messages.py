from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.models import AuditLog
from werkbank.main import create_app
from werkbank.modules.evergreen.jobs import FETCH_MESSAGES
from werkbank.core.text import html_to_text
from werkbank.modules.evergreen.message_center import fetch_messages, parse_time
from werkbank.modules.evergreen.models import EvItem, EvMessage, MessageStatus
from werkbank.modules.m365_config.utcm import UtcmClient
from werkbank.worker.tasks import build_registry

ORIGIN = "https://testserver"
BASE = "/api/evergreen"
HEADERS = {"Origin": ORIGIN}


def raw(message_id: str, **overrides: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": message_id,
        "title": f"Meldung {message_id}",
        "services": ["Microsoft Teams"],
        "category": "stayInformed",
        "isMajorChange": False,
        "actionRequiredByDateTime": None,
        "startDateTime": "2024-11-10T08:00:00Z",
        "lastModifiedDateTime": "2024-11-10T08:00:00Z",
        "body": {"contentType": "html", "content": "<p>Neue <b>Funktion</b></p><p>Ab Januar</p>"},
    }
    data.update(overrides)
    return data


class FakeGraph:
    def __init__(self, messages: list[dict[str, Any]]) -> None:
        self.messages = messages
        self.filters: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/admin/serviceAnnouncement/messages"):
            self.filters.append(request.url.params.get("$filter", ""))
            return httpx.Response(200, json={"value": self.messages})
        return httpx.Response(404, json={})

    def client(self) -> UtcmClient:
        return UtcmClient(httpx.Client(transport=httpx.MockTransport(self.handler)), lambda: "t")


def client_for(roles: list[str], oid: str) -> TestClient:
    settings = Settings(public_url=ORIGIN, environment="test", enable_test_login=True)
    client = TestClient(create_app(settings), base_url=ORIGIN, follow_redirects=False)
    response = client.post(
        "/auth/test-login", json={"oid": oid, "name": "Ina IT", "roles": roles}, headers=HEADERS
    )
    assert response.status_code == 303, response.text
    return client


# --- ohne Datenbank -------------------------------------------------------------------


def test_html_becomes_plain_text() -> None:
    html = (
        "<p>Erste  Zeile</p><script>alert(1)</script><style>p{}</style>"
        "<ul><li>Punkt &amp; mehr</li></ul><br><br><br><p>Ende</p>"
    )
    assert html_to_text(html) == "Erste Zeile\n\nPunkt & mehr\n\nEnde"
    assert html_to_text("") is None
    assert html_to_text(None) is None
    assert len(html_to_text("x" * 50_000) or "") == 20_000


def test_parse_time_handles_placeholders() -> None:
    assert parse_time("2026-11-10T08:00:00Z") == datetime(2026, 11, 10, 8, tzinfo=UTC)
    assert parse_time("0001-01-01T00:00:00Z") is None
    assert parse_time("") is None
    assert parse_time(None) is None
    assert parse_time("kein datum") is None


def test_job_is_registered_with_collector() -> None:
    configured = Settings(
        environment="test",
        entra_tenant_id="00000000-0000-0000-0000-00000000aaaa",
        collector_client_id="00000000-0000-0000-0000-00000000cccc",
    )
    assert FETCH_MESSAGES in build_registry(configured)
    assert FETCH_MESSAGES not in build_registry(Settings(environment="test"))


# --- mit Datenbank --------------------------------------------------------------------


@pytest.fixture
def db(db_session: Session) -> Session:
    """Leerer Eingang für jeden Test."""
    db_session.execute(update(EvMessage).values(item_id=None))
    db_session.execute(delete(EvMessage))
    db_session.commit()
    return db_session


@pytest.mark.db
def test_fetch_fills_inbox_and_creates_items_by_rule(db: Session) -> None:
    graph = FakeGraph(
        [
            raw("MC100001"),
            raw("MC100002", isMajorChange=True, title="Großer Umbau", services=["Exchange Online"]),
            raw("MC100003", actionRequiredByDateTime="2027-02-01T00:00:00Z"),
            raw("MC100004", actionRequiredByDateTime="0001-01-01T00:00:00Z"),
            {"title": "ohne Kennung"},
        ]
    )
    result = fetch_messages(db, graph.client())
    assert (result.received, result.new, result.updated, result.items_created) == (5, 4, 0, 2)
    assert graph.filters[0].startswith("lastModifiedDateTime ge ")

    messages = {m.message_id: m for m in db.scalars(select(EvMessage)).all()}
    assert messages["MC100001"].status == MessageStatus.NEW
    assert messages["MC100001"].body == "Neue Funktion\n\nAb Januar"
    assert messages["MC100004"].status == MessageStatus.NEW
    major = messages["MC100002"]
    assert major.status == MessageStatus.ADOPTED and major.item_id is not None
    item = db.get(EvItem, major.item_id)
    assert item is not None
    assert (item.title, item.service, item.source, item.source_ref, item.major_change) == (
        "Großer Umbau",
        "Exchange Online",
        "nachrichtencenter",
        "MC100002",
        True,
    )
    deadline_item = db.get(EvItem, messages["MC100003"].item_id)
    assert deadline_item is not None and str(deadline_item.rollout_date) == "2027-02-01"
    audit = db.scalars(
        select(AuditLog)
        .where(AuditLog.action == "nachrichtencenter.abgerufen")
        .order_by(AuditLog.id)
    ).all()
    assert audit[-1].details == {
        "gelesen": 5,
        "neu": 4,
        "aktualisiert": 0,
        "vorgaenge_angelegt": 2,
    }


@pytest.mark.db
def test_second_fetch_updates_without_duplicates(db: Session) -> None:
    fetch_messages(db, FakeGraph([raw("MC200001"), raw("MC200002", isMajorChange=True)]).client())
    items_before = len(db.scalars(select(EvItem.id)).all())

    changed = [
        raw(
            "MC200001",
            title="Jetzt wichtig",
            isMajorChange=True,
            lastModifiedDateTime="2024-11-12T08:00:00Z",
        ),
        raw("MC200002", isMajorChange=True),
    ]
    graph = FakeGraph(changed)
    result = fetch_messages(db, graph.client())
    assert (result.new, result.updated, result.items_created) == (0, 1, 1)
    # der zweite Abruf fragt nur ab der letzten Änderung (mit Überlappung)
    assert graph.filters[0] == "lastModifiedDateTime ge 2024-11-10T07:00:00Z"
    assert len(db.scalars(select(EvItem.id)).all()) == items_before + 1
    message = db.execute(select(EvMessage).where(EvMessage.message_id == "MC200001")).scalar_one()
    assert (message.title, message.status) == ("Jetzt wichtig", MessageStatus.ADOPTED)


@pytest.mark.db
def test_inbox_api_adopt_ignore_and_roles(db: Session) -> None:
    fetch_messages(db, FakeGraph([raw("MC300001"), raw("MC300002")]).client())
    client = client_for(["Evergreen.IT"], "ev-it")
    for roles, oid in ((["Evergreen.Betriebsrat"], "ev-br"), (["Config.Reader"], "m365-leser")):
        assert client_for(roles, oid).get(f"{BASE}/messages").status_code == 403

    inbox = client.get(f"{BASE}/messages").json()
    assert inbox["new_count"] == 2
    ids = {entry["message_id"]: entry["id"] for entry in inbox["entries"]}
    tasks = [task["title"] for task in client.get("/api/tasks").json()["tasks"]]
    assert "Eingang: neue Meldungen von Microsoft sichten" in tasks

    adopted = client.post(f"{BASE}/messages/{ids['MC300001']}/adopt", headers=HEADERS)
    assert adopted.status_code == 201, adopted.text
    item_id = adopted.json()["id"]
    assert adopted.json()["source"] == "nachrichtencenter"
    again = client.post(f"{BASE}/messages/{ids['MC300001']}/adopt", headers=HEADERS)
    assert again.status_code == 409
    detail = client.get(f"{BASE}/items/{item_id}").json()
    assert detail["message"]["message_id"] == "MC300001"
    assert detail["message_updated"] is False
    assert detail["summary"] == "Neue Funktion\n\nAb Januar"

    url = f"{BASE}/messages/{ids['MC300002']}/status"
    ignored = client.post(url, json={"status": "ignoriert"}, headers=HEADERS)
    assert ignored.json()["status"] == "ignoriert"
    assert client.get(f"{BASE}/messages").json()["entries"] == []
    listed = client.get(f"{BASE}/messages", params={"view": "ignoriert"}).json()["entries"]
    assert [entry["message_id"] for entry in listed] == ["MC300002"]
    assert client.post(url, json={"status": "neu"}, headers=HEADERS).json()["status"] == "neu"
    assert client.post(url, json={"status": "uebernommen"}, headers=HEADERS).status_code == 422
    blocked = client.post(
        f"{BASE}/messages/{ids['MC300001']}/status", json={"status": "ignoriert"}, headers=HEADERS
    )
    assert blocked.status_code == 409
    assert client.post(f"{BASE}/messages/999999999/adopt", headers=HEADERS).status_code == 404

    # Microsoft ändert die Meldung nach der Übernahme: Hinweis am Vorgang
    later = raw("MC300001", lastModifiedDateTime="2099-01-01T00:00:00Z", title="Geändert")
    fetch_messages(db, FakeGraph([later]).client())
    detail = client.get(f"{BASE}/items/{item_id}").json()
    assert detail["message_updated"] is True
    assert detail["message"]["title"] == "Geändert"
    assert detail["item"]["title"] == "Meldung MC300001"
