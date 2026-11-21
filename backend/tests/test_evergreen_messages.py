from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.models import AuditLog
from werkbank.core.text import html_to_text
from werkbank.main import create_app
from werkbank.modules.evergreen.jobs import FETCH_MESSAGES
from werkbank.modules.evergreen.message_center import fetch_messages, parse_time
from werkbank.modules.evergreen.models import EvEntry, EvNote
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
        "/auth/test-login",
        json={"oid": oid, "name": "Ina Beispiel", "roles": roles},
        headers=HEADERS,
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
    """Keine Einträge zu Beginn jedes Tests."""
    db_session.execute(delete(EvEntry))
    db_session.commit()
    return db_session


def by_ref(db: Session, ref: str) -> EvEntry:
    return db.execute(select(EvEntry).where(EvEntry.source_ref == ref)).scalar_one()


@pytest.mark.db
def test_every_message_becomes_a_new_entry(db: Session) -> None:
    graph = FakeGraph(
        [
            raw("MC100001"),
            raw("MC100002", isMajorChange=True, title="Großer Umbau", services=["Exchange Online"]),
            raw("MC100003", actionRequiredByDateTime="2027-02-01T00:00:00Z"),
            {"title": "ohne Kennung"},
        ]
    )
    result = fetch_messages(db, graph.client())
    assert (result.received, result.new, result.updated) == (4, 3, 0)
    assert graph.filters[0].startswith("lastModifiedDateTime ge ")

    first = by_ref(db, "MC100001")
    assert (first.software, first.source, first.status) == ("m365", "nachrichtencenter", "neu")
    assert first.body == "Neue Funktion\n\nAb Januar"
    assert first.number.startswith("EV-")
    major = by_ref(db, "MC100002")
    assert (major.title, major.services, major.major_change) == (
        "Großer Umbau",
        ["Exchange Online"],
        True,
    )
    deadline = by_ref(db, "MC100003").action_required_by
    assert deadline is not None and deadline.date().isoformat() == "2027-02-01"
    audit = db.scalars(
        select(AuditLog)
        .where(AuditLog.action == "nachrichtencenter.abgerufen")
        .order_by(AuditLog.id)
    ).all()
    assert audit[-1].details == {"gelesen": 4, "neu": 3, "aktualisiert": 0}


@pytest.mark.db
def test_update_from_microsoft_keeps_status_and_notes_it(db: Session) -> None:
    fetch_messages(db, FakeGraph([raw("MC200001"), raw("MC200002")]).client())
    entry = by_ref(db, "MC200001")
    entry.status = "abgeschlossen"
    db.commit()
    count = len(db.scalars(select(EvEntry.id)).all())

    changed = raw("MC200001", title="Jetzt wichtig", lastModifiedDateTime="2024-11-12T08:00:00Z")
    graph = FakeGraph([changed, raw("MC200002")])
    result = fetch_messages(db, graph.client())
    assert (result.new, result.updated) == (0, 1)
    # der zweite Abruf fragt nur ab der letzten Änderung (mit Überlappung)
    assert graph.filters[0] == "lastModifiedDateTime ge 2024-11-10T07:00:00Z"
    assert len(db.scalars(select(EvEntry.id)).all()) == count
    db.refresh(entry)
    assert (entry.title, entry.status) == ("Jetzt wichtig", "abgeschlossen")
    notes = db.scalars(select(EvNote).where(EvNote.entry_id == entry.id)).all()
    assert [(note.kind, note.user_id) for note in notes] == [("aktualisiert", None)]


@pytest.mark.db
def test_tasks_and_notifications_only_for_editors(db: Session) -> None:
    from datetime import datetime as moment

    from werkbank.modules.evergreen.notifications import evergreen_notifications

    fetch_messages(db, FakeGraph([raw("MC300001"), raw("MC300002")]).client())
    editor = client_for(["Evergreen.Editor"], "ev-bearbeiter")
    reader = client_for(["Evergreen.Reader"], "ev-leser")
    tasks = editor.get("/api/tasks").json()["tasks"]
    mine = [task for task in tasks if task["module"] == "Evergreen"]
    assert [(task["title"], task["count"], task["link"]) for task in mine] == [
        ("Microsoft 365: neue Einträge sichten", 2, "/evergreen/m365")
    ]
    assert not [t for t in reader.get("/api/tasks").json()["tasks"] if t["module"] == "Evergreen"]

    events = list(evergreen_notifications(db, Settings(environment="test"), moment.now(UTC)))
    assert len(events) == 1
    assert events[0].title == "Evergreen Microsoft 365: 2 neue Einträge"
    assert events[0].link == "/evergreen/m365"


SCHEDULE_HTML = (
    "<p>[What and why:]</p><p>Something new.</p>"
    "<p>[When this will happen:]</p>"
    "<p>Targeted Release: early January 2027 to late January 2027.</p>"
    "<p>General Availability: late January 2027 to late February 2027.</p>"
)


@pytest.mark.db
def test_tags_sections_and_suggestions(db: Session) -> None:
    message = raw(
        "MC300001",
        tags=["User impact", "New feature"],
        body={"contentType": "html", "content": SCHEDULE_HTML},
    )
    fetch_messages(db, FakeGraph([message]).client())
    entry = by_ref(db, "MC300001")
    assert entry.tags == ["User impact", "New feature"]
    assert [s["head"] for s in entry.sections] == ["What and why", "When this will happen"]
    assert [p["name"] for p in entry.phases] == ["Targeted Release", "Allgemein verfügbar"]
    assert entry.affected == "Nutzer"
    assert entry.suggested == ["affected", "phases"]


@pytest.mark.db
def test_changed_schedule_keeps_previous_plan(db: Session) -> None:
    first = raw("MC300002", body={"contentType": "html", "content": SCHEDULE_HTML})
    fetch_messages(db, FakeGraph([first]).client())
    entry = by_ref(db, "MC300002")
    # von Hand geprüft: Betroffen bleibt bei einer Aktualisierung
    entry.affected = "Alle mit Lizenz"
    entry.suggested = []
    db.commit()
    old_phases = list(entry.phases)

    moved = SCHEDULE_HTML.replace("January 2027", "March 2027").replace("February", "April")
    changed = raw(
        "MC300002",
        tags=["Admin impact"],
        lastModifiedDateTime="2024-11-12T08:00:00Z",
        body={"contentType": "html", "content": moved},
    )
    fetch_messages(db, FakeGraph([changed]).client())
    db.refresh(entry)
    assert entry.schedule_previous is not None and "January 2027" in entry.schedule_previous
    assert entry.schedule_changed_at is not None
    assert entry.phases_previous == old_phases
    assert entry.phases[0] == {"name": "Targeted Release", "start": "2027-03", "end": "2027-03"}
    assert entry.suggested == ["phases"]
    assert entry.affected == "Alle mit Lizenz"
    kinds = [n.kind for n in db.scalars(select(EvNote).where(EvNote.entry_id == entry.id))]
    assert kinds == ["aktualisiert", "zeitplan"]


@pytest.mark.db
def test_backfill_for_old_entries(db: Session) -> None:
    fetch_messages(db, FakeGraph([raw("MC300003")]).client())
    entry = by_ref(db, "MC300003")
    entry.sections = []
    entry.body = "[When this will happen:]\nRollout: May 2027"
    db.commit()
    fetch_messages(db, FakeGraph([]).client())
    db.refresh(entry)
    assert entry.phases == [{"name": "Rollout", "start": "2027-05", "end": "2027-05"}]
