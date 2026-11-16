"""Tenant: Dienststatus von Microsoft 365 (Abruf, Aufbewahrung, API)."""

from datetime import datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_m365_api import ORIGIN, client_for
from werkbank.config import Settings
from werkbank.core.sessions import now_utc
from werkbank.modules.m365_config.utcm import UtcmClient
from werkbank.modules.tenant.health import FETCH_HEALTH, fetch_health, read_posts
from werkbank.modules.tenant.models import TenantServiceHealth, TenantServiceIssue
from werkbank.modules.tenant.notifications import tenant_notifications
from werkbank.worker.tasks import build_registry

BASE = "/api/tenant"
NOW = now_utc().replace(microsecond=0)


def stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def issue(issue_id: str, service: str, **overrides: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "id": issue_id,
        "service": service,
        "title": f"Störung {issue_id}",
        "classification": "incident",
        "status": "serviceDegradation",
        "featureGroup": "E-Mail und Kalender",
        "feature": "Zustellung",
        "impactDescription": "Nachrichten kommen verzögert an.",
        "isResolved": False,
        "startDateTime": stamp(NOW - timedelta(hours=3)),
        "endDateTime": None,
        "lastModifiedDateTime": stamp(NOW - timedelta(minutes=20)),
        "posts": [
            {
                "createdDateTime": stamp(NOW - timedelta(hours=2)),
                "postType": "regular",
                "description": {"contentType": "html", "content": "<p>Wir <b>prüfen</b> das.</p>"},
            }
        ],
    }
    values.update(overrides)
    return values


class HealthGraph:
    def __init__(self) -> None:
        self.overviews: list[dict[str, Any]] = [
            {"id": "Exchange", "service": "Exchange Online", "status": "serviceDegradation"},
            {"id": "microsoftteams", "service": "Microsoft Teams", "status": "serviceOperational"},
            {"id": "SharePoint", "service": "SharePoint Online", "status": "serviceOperational"},
            {"id": "OrgLiveID", "service": "Identity Service", "status": "serviceInterruption"},
            {"id": "Planner", "service": "Planner", "status": "serviceDegradation"},
        ]
        self.issues: list[dict[str, Any]] = [
            issue("EX1001", "Exchange Online"),
            issue(
                "EX0900",
                "Exchange Online",
                classification="advisory",
                isResolved=True,
                status="serviceRestored",
                startDateTime=stamp(NOW - timedelta(days=5)),
                endDateTime=stamp(NOW - timedelta(days=4)),
            ),
            issue("ID2001", "Identity Service", status="serviceInterruption"),
            issue("PL3001", "Planner"),
        ]
        self.filters: list[str | None] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/healthOverviews"):
            return httpx.Response(200, json={"value": self.overviews})
        if path.endswith("/issues"):
            self.filters.append(request.url.params.get("$filter"))
            return httpx.Response(200, json={"value": self.issues})
        return httpx.Response(404, json={})

    def client(self) -> UtcmClient:
        return UtcmClient(httpx.Client(transport=httpx.MockTransport(self.handler)), lambda: "t")


@pytest.fixture
def db(migrated_db: None, db_session: Session) -> Session:
    db_session.execute(delete(TenantServiceIssue))
    db_session.execute(delete(TenantServiceHealth))
    db_session.commit()
    return db_session


def test_posts_are_plain_text_and_sorted() -> None:
    posts = read_posts(
        [
            {
                "createdDateTime": "2026-11-16T10:00:00Z",
                "postType": "quick",
                "description": {"content": "<p>Zweite <script>alert(1)</script>Mitteilung</p>"},
            },
            {
                "createdDateTime": "2026-11-16T09:00:00Z",
                "description": {"content": "Erste"},
            },
            {"createdDateTime": "2026-11-16T11:00:00Z", "description": {"content": ""}},
            "unsinn",
        ]
    )
    assert posts[0]["text"] == "Erste"
    assert posts[1]["type"] == "quick"
    assert "<" not in posts[1]["text"]
    assert len(posts) == 2


def test_job_only_when_enabled() -> None:
    base: dict[str, Any] = {
        "public_url": ORIGIN,
        "environment": "test",
        "entra_tenant_id": "00000000-0000-0000-0000-00000000aaaa",
        "collector_client_id": "00000000-0000-0000-0000-00000000cccc",
    }
    assert FETCH_HEALTH not in build_registry(Settings(**base))
    registry = build_registry(Settings(**base, tenant_health_enabled=True))
    assert registry[FETCH_HEALTH].interval == timedelta(minutes=15)
    assert FETCH_HEALTH not in build_registry(
        Settings(public_url=ORIGIN, environment="test", tenant_health_enabled=True)
    )


@pytest.mark.db
def test_fetch_keeps_only_watched_services_and_purges_after_three_years(db: Session) -> None:
    graph = HealthGraph()
    result = fetch_health(db, graph.client(), now=NOW)
    assert (result.services, result.issues) == (4, 3)
    assert graph.filters == [None]
    stored = {row.service_id: row.status for row in db.scalars(select(TenantServiceHealth))}
    assert stored == {
        "Exchange": "serviceDegradation",
        "microsoftteams": "serviceOperational",
        "SharePoint": "serviceOperational",
        "OrgLiveID": "serviceInterruption",
    }
    entra = db.get(TenantServiceIssue, "ID2001")
    assert entra is not None and entra.service_id == "OrgLiveID"
    assert db.get(TenantServiceIssue, "PL3001") is None
    exchange = db.get(TenantServiceIssue, "EX1001")
    assert exchange is not None
    assert exchange.posts[0]["text"] == "Wir prüfen das."

    # Der nächste Abruf fragt nur Änderungen seit dem letzten ab (mit Überlappung).
    old = db.get(TenantServiceIssue, "EX0900")
    assert old is not None
    old.end_at = NOW - timedelta(days=3 * 365 + 1)
    db.commit()
    graph.issues = []
    later = fetch_health(db, graph.client(), now=NOW + timedelta(minutes=15))
    assert graph.filters[1] == f"lastModifiedDateTime ge {stamp(NOW - timedelta(hours=1))}"
    assert later.removed == 1
    assert db.get(TenantServiceIssue, "EX0900") is None


@pytest.mark.db
def test_api_for_readers_only(db: Session) -> None:
    fetch_health(db, HealthGraph().client(), now=NOW)
    stranger = client_for(["Config.Reader"], "health-fremd")
    assert stranger.get(f"{BASE}/health").status_code == 403

    reader = client_for(["Tenant.Reader"], "health-leser")
    data = reader.get(f"{BASE}/health").json()
    assert data["enabled"] is False
    # Unterbrechung vor Einschränkung vor Normalbetrieb
    assert [entry["service_id"] for entry in data["services"]] == [
        "OrgLiveID",
        "Exchange",
        "microsoftteams",
        "SharePoint",
    ]
    assert data["services"][0]["name"] == "Microsoft Entra"
    assert data["services"][1]["open_incidents"] == 1
    assert {entry["issue_id"] for entry in data["open"]} == {"EX1001", "ID2001"}
    # Vor vier Tagen beendet: unter „kürzlich beendet“
    assert [entry["issue_id"] for entry in data["recent"]] == ["EX0900"]
    exchange = [entry for entry in data["stats"] if entry["service_id"] == "Exchange"]
    assert len(exchange) == 3
    assert sum(entry["incidents"] for entry in exchange) == 1
    assert sum(entry["advisories"] for entry in exchange) == 1
    assert sum(entry["incident_hours"] for entry in exchange) == 3.0

    # Monate: 36, der laufende zuletzt; nur Störungen zählen
    months = sorted({entry["month"] for entry in data["months"]})
    assert len(months) == 36
    assert months[-1] == NOW.strftime("%Y-%m")
    started = (NOW - timedelta(hours=3)).strftime("%Y-%m")
    assert [
        entry["incidents"]
        for entry in data["months"]
        if entry["service_id"] == "Exchange" and entry["month"] == started
    ] == [1]
    # Zeitleiste: 90 Tage je Dienst, Störung schlägt Hinweis
    assert len(data["timeline_days"]) == 90
    assert data["timeline_days"][-1] == NOW.date().isoformat()
    line = next(entry for entry in data["timeline"] if entry["service_id"] == "Exchange")
    assert len(line["days"]) == 90
    assert line["days"][-1] == "stoerung"
    advisory_day = data["timeline_days"].index((NOW - timedelta(days=5)).date().isoformat())
    assert line["days"][advisory_day] == "hinweis"
    assert line["days"][0] == "ok"
    teams = next(entry for entry in data["timeline"] if entry["service_id"] == "microsoftteams")
    assert set(teams["days"]) == {"ok"}

    detail = reader.get(f"{BASE}/health/issues/EX1001").json()
    assert detail["impact"] == "Nachrichten kommen verzögert an."
    assert [post["text"] for post in detail["posts"]] == ["Wir prüfen das."]
    assert reader.get(f"{BASE}/health/issues/XX0000").status_code == 404
    assert reader.get(f"{BASE}/health/issues/a%20b").status_code == 422


@pytest.mark.db
def test_incidents_notify_on_start_and_end(db: Session) -> None:
    graph = HealthGraph()
    fetch_health(db, graph.client(), now=NOW)
    keys = {
        event.key: event
        for event in tenant_notifications(db, Settings(public_url=ORIGIN, environment="test"), NOW)
        if event.kind == "tenant.stoerung"
    }
    # Nur Störungen, keine Hinweise; beendet erst mit isResolved
    assert set(keys) == {"EX1001:begonnen", "ID2001:begonnen"}
    assert keys["EX1001:begonnen"].link == "/m365/dienststatus#EX1001"
    assert keys["ID2001:begonnen"].title.startswith("Störung bei Microsoft Entra:")
