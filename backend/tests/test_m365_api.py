from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.models import AuditLog, Job, JobStatus
from werkbank.core.sessions import now_utc
from werkbank.main import create_app
from werkbank.modules.m365_config.jobs import COLLECT
from werkbank.modules.m365_config.models import (
    CfgChange,
    CfgSetting,
    CfgSettingMeta,
    CfgSettingVersion,
    CfgSnapshot,
    ChangeStatus,
)
from werkbank.modules.m365_config.normalize import SettingValue, normalize_object
from werkbank.modules.m365_config.versioning import apply_snapshot
from werkbank.worker.jobs import enqueue

ORIGIN = "https://testserver"
SOURCE = "test:api"
BASE = "/api/m365-config"


def client_for(roles: list[str], oid: str, **settings: Any) -> TestClient:
    values: dict[str, Any] = {
        "public_url": ORIGIN,
        "environment": "test",
        "enable_test_login": True,
    }
    values.update(settings)
    client = TestClient(create_app(Settings(**values)), base_url=ORIGIN, follow_redirects=False)
    response = client.post(
        "/auth/test-login",
        json={"oid": oid, "name": "Rita Reviewer", "roles": roles},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 303, response.text
    return client


def policy(object_id: str, name: str, **properties: Any) -> list[SettingValue]:
    return normalize_object(
        workload="entra",
        area="conditionalAccessPolicy",
        object_id=object_id,
        object_name=name,
        properties=properties,
        source=SOURCE,
    )


@pytest.fixture
def db(db_session: Session) -> Session:
    """Bestand mit einem Ausgangsstand und einem zweiten Abruf mit drei Änderungen."""
    for table in (CfgChange, CfgSettingVersion, CfgSetting, CfgSnapshot):
        db_session.execute(delete(table))
    db_session.execute(delete(Job).where(Job.type == COLLECT))
    apply_snapshot(
        db_session,
        policy("p1", "MFA für alle", state="enabled") + policy("p2", "Alt", state="enabled"),
        {SOURCE: True},
    )
    apply_snapshot(
        db_session,
        policy("p1", "MFA für alle", state="disabled") + policy("p3", "Neu 100%", state="on"),
        {SOURCE: True},
        resource_count=2,
    )
    db_session.commit()
    return db_session


def test_api_requires_login() -> None:
    client = TestClient(create_app(Settings(public_url=ORIGIN, environment="test")))
    assert client.get(f"{BASE}/overview").status_code == 401


@pytest.mark.db
def test_other_roles_are_forbidden(db: Session) -> None:
    client = client_for(["Evergreen.Betriebsrat", "Werkbank.Auditor"], "m365-fremd")
    for path in ("overview", "settings", "changes", "snapshots", "settings/1"):
        assert client.get(f"{BASE}/{path}").status_code == 403


@pytest.mark.db
def test_overview(db: Session) -> None:
    client = client_for(["Config.Reader"], "m365-leser")
    data = client.get(f"{BASE}/overview").json()
    assert data["collector_configured"] is False
    assert data["collect_pending"] is False
    assert data["settings_total"] == 2
    assert data["open_changes"] == 3
    assert data["resources_this_month"] == 2
    assert data["monthly_limit"] == 20000
    assert data["workloads"] == ["entra"]
    assert data["last_snapshot"]["change_count"] == 3
    assert data["open_critical"] == 0
    assert data["described_total"] == 0
    assert data["changes_last_7_days"] == 3
    assert data["changes_last_30_days"] == 3
    days = data["changes_per_day"]
    assert len(days) == 14
    assert days[-1]["count"] == 3
    assert sum(day["count"] for day in days) == 3


@pytest.mark.db
def test_overview_counts_critical_and_described(db: Session) -> None:
    setting_id = db.scalars(
        select(CfgSetting.id).where(CfgSetting.object_id == "p1", CfgSetting.active)
    ).one()
    db.add(
        CfgSettingMeta(
            setting_id=setting_id,
            description="Mehrstufige Anmeldung für alle",
            criticality="hoch",
            target_set=False,
            target_value=None,
        )
    )
    db.commit()
    client = client_for(["Config.Reader"], "m365-leser")
    data = client.get(f"{BASE}/overview", params={"tz": "Europe/Berlin"}).json()
    assert data["open_critical"] == 1
    assert data["described_total"] == 1
    assert sum(day["count"] for day in data["changes_per_day"]) == 3
    assert client.get(f"{BASE}/overview", params={"tz": "Mars/Olympus"}).status_code == 422

    changes = client.get(f"{BASE}/changes").json()["entries"]
    changed = next(entry for entry in changes if entry["setting_id"] == setting_id)
    assert changed["criticality"] == "hoch"
    assert changed["description"] == "Mehrstufige Anmeldung für alle"
    assert changed["workload"] == "entra"


@pytest.mark.db
def test_settings_list_search_and_detail(db: Session) -> None:
    client = client_for(["Config.Reader"], "m365-leser")
    listing = client.get(f"{BASE}/settings").json()
    assert [entry["object_name"] for entry in listing["entries"]] == ["MFA für alle", "Neu 100%"]
    # Offene Änderungen je Einstellung ergeben zusammen die Zahl aus der Übersicht.
    everything = client.get(f"{BASE}/settings", params={"include_removed": "true"}).json()
    open_total = client.get(f"{BASE}/overview").json()["open_changes"]
    assert sum(entry["open_changes"] for entry in everything["entries"]) == open_total
    assert not any(entry["from_evergreen"] for entry in everything["entries"])
    assert listing["entries"][0]["value"] == "disabled"
    assert listing["has_more"] is False

    with_removed = client.get(f"{BASE}/settings", params={"include_removed": "true"}).json()
    assert len(with_removed["entries"]) == 3
    # Platzhalter der Suche werden wörtlich genommen
    assert len(client.get(f"{BASE}/settings", params={"search": "100%"}).json()["entries"]) == 1
    assert (
        client.get(f"{BASE}/settings", params={"search": "%"}).json()["entries"][0]["object_name"]
        == "Neu 100%"
    )
    assert client.get(f"{BASE}/settings", params={"workload": "exchange"}).json()["entries"] == []
    assert client.get(f"{BASE}/settings", params={"limit": 1}).json()["has_more"] is True
    assert client.get(f"{BASE}/settings", params={"limit": 1000}).status_code == 422

    setting_id = listing["entries"][0]["id"]
    detail = client.get(f"{BASE}/settings/{setting_id}").json()
    assert detail["setting"]["value"] == "disabled"
    assert [version["value"] for version in detail["versions"]] == ["disabled", "enabled"]
    assert detail["versions"][0]["valid_to"] is None
    assert [change["kind"] for change in detail["changes"]] == ["geaendert"]
    assert client.get(f"{BASE}/settings/999999999").status_code == 404
    assert client.get(f"{BASE}/settings/0").status_code == 422


@pytest.mark.db
def test_changes_list_and_filter(db: Session) -> None:
    client = client_for(["Config.Reader"], "m365-leser")
    data = client.get(f"{BASE}/changes").json()
    assert {entry["kind"] for entry in data["entries"]} == {"neu", "geaendert", "entfernt"}
    assert all(entry["status"] == "offen" for entry in data["entries"])
    assert data["counts"] == {"alle": 3, "offen": 3, "gewollt": 0, "ungewollt": 0}
    intended = client.get(f"{BASE}/changes", params={"status": "gewollt"}).json()
    assert intended["entries"] == []
    # Die Zähler gelten unabhängig vom Filter, für die Filter-Chips
    assert intended["counts"]["alle"] == 3
    assert client.get(f"{BASE}/changes", params={"status": "unsinn"}).status_code == 422


@pytest.mark.db
def test_reader_cannot_review(db: Session) -> None:
    client = client_for(["Config.Reader"], "m365-leser")
    change_id = db.scalars(select(CfgChange.id)).first()
    response = client.post(
        f"{BASE}/changes/review",
        json={"ids": [change_id], "status": "gewollt"},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 403


@pytest.mark.db
def test_review_rules_and_audit(db: Session) -> None:
    client = client_for(["Config.Reviewer"], "m365-pruefer")
    ids = list(db.scalars(select(CfgChange.id).order_by(CfgChange.id)).all())
    headers = {"Origin": ORIGIN}
    url = f"{BASE}/changes/review"

    # "ungewollt" ohne Kommentar wird abgelehnt, auch wenn er nur aus Leerzeichen besteht
    for comment in (None, "   "):
        body = {"ids": ids[:1], "status": "ungewollt", "comment": comment}
        assert client.post(url, json=body, headers=headers).status_code == 422
    # unbekannte Änderung: nichts wird bewertet
    body = {"ids": [ids[0], 999999999], "status": "gewollt"}
    assert client.post(url, json=body, headers=headers).status_code == 404
    assert (
        client.post(url, json={"ids": [], "status": "gewollt"}, headers=headers).status_code == 422
    )
    # ohne Origin greift der CSRF-Schutz
    assert client.post(url, json={"ids": ids[:1], "status": "gewollt"}).status_code == 403

    done = client.post(
        url,
        json={"ids": ids[:2], "status": "ungewollt", "comment": " Nicht abgestimmt "},
        headers=headers,
    )
    assert done.status_code == 200
    assert done.json() == {"updated": 2}

    db.expire_all()
    reviewed = db.scalars(select(CfgChange).where(CfgChange.id.in_(ids[:2]))).all()
    assert all(change.status == ChangeStatus.UNINTENDED for change in reviewed)
    assert all(change.comment == "Nicht abgestimmt" for change in reviewed)
    assert all(change.reviewed_by is not None for change in reviewed)
    listed = client.get(f"{BASE}/changes", params={"status": "ungewollt"}).json()["entries"]
    assert len(listed) == 2
    assert listed[0]["reviewed_by"] == "Rita Reviewer"
    assert client.get(f"{BASE}/overview").json()["open_changes"] == 1

    audit = db.scalars(
        select(AuditLog).where(
            AuditLog.action == "aenderung.bewertet", AuditLog.object_id == str(ids[0])
        )
    ).all()
    assert audit and audit[-1].details == {
        "vorher": "offen",
        "bewertung": "ungewollt",
        "kommentar": True,
    }

    # Zurücksetzen entfernt Bewertung und Kommentar und wird protokolliert
    reset = client.post(url, json={"ids": ids[:1], "status": "offen"}, headers=headers)
    assert reset.status_code == 200
    db.expire_all()
    change = db.get(CfgChange, ids[0])
    assert change is not None
    assert (change.status, change.comment, change.reviewed_by) == ("offen", None, None)


@pytest.mark.db
def test_collect_needs_admin_and_configuration(db: Session) -> None:
    headers = {"Origin": ORIGIN}
    reviewer = client_for(["Config.Reviewer"], "m365-pruefer")
    assert reviewer.post(f"{BASE}/collect", headers=headers).status_code == 403
    admin = client_for(["Werkbank.Admin"], "m365-admin")
    assert admin.post(f"{BASE}/collect", headers=headers).status_code == 409


@pytest.mark.db
def test_collect_queues_once_and_pulls_planned_run_forward(db: Session) -> None:
    headers = {"Origin": ORIGIN}
    configured = {
        "entra_tenant_id": "00000000-0000-0000-0000-00000000aaaa",
        "collector_client_id": "00000000-0000-0000-0000-00000000cccc",
    }
    admin = client_for(["Werkbank.Admin", "Config.Reader"], "m365-admin", **configured)
    planned = enqueue(db, COLLECT, scheduled_at=now_utc() + timedelta(hours=20))
    db.commit()

    first = admin.post(f"{BASE}/collect", headers=headers)
    assert first.status_code == 202
    assert first.json() == {"queued": True}
    db.expire_all()
    jobs = db.scalars(select(Job).where(Job.type == COLLECT)).all()
    assert len(jobs) == 1
    assert jobs[0].id == planned.id
    assert jobs[0].status == JobStatus.PLANNED
    assert jobs[0].scheduled_at <= now_utc()

    assert admin.post(f"{BASE}/collect", headers=headers).json() == {"queued": False}
    overview = admin.get(f"{BASE}/overview").json()
    assert overview["collector_configured"] is True
    assert overview["collect_pending"] is True


def first_setting_id(client: TestClient) -> int:
    entries = client.get(f"{BASE}/settings").json()["entries"]
    setting_id: int = entries[0]["id"]
    return setting_id


@pytest.mark.db
def test_reader_cannot_edit_metadata(db: Session) -> None:
    client = client_for(["Config.Reader"], "m365-leser")
    setting_id = first_setting_id(client)
    response = client.put(
        f"{BASE}/settings/{setting_id}/meta",
        json={"description": "x"},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 403


@pytest.mark.db
def test_metadata_update_history_and_audit(db: Session) -> None:
    client = client_for(["Config.Reviewer"], "m365-pruefer")
    setting_id = first_setting_id(client)
    url = f"{BASE}/settings/{setting_id}/meta"
    headers = {"Origin": ORIGIN}

    empty = client.get(f"{BASE}/settings/{setting_id}").json()
    assert empty["meta"]["description"] is None
    assert empty["meta"]["target_set"] is False
    assert empty["meta_history"] == []

    first = client.put(
        url,
        json={
            "description": "  Erzwingt MFA  ",
            "criticality": "hoch",
            "learn_url": "https://learn.microsoft.com/de-de/entra/",
        },
        headers=headers,
    )
    assert first.status_code == 200, first.text
    assert first.json()["description"] == "Erzwingt MFA"
    assert first.json()["criticality"] == "hoch"

    # nur mitgeschickte Felder ändern sich; gleicher Wert erzeugt keinen Verlaufseintrag
    second = client.put(
        url, json={"description": "Erzwingt MFA", "owner": "IT-Betrieb"}, headers=headers
    )
    assert second.json()["criticality"] == "hoch"
    assert second.json()["owner"] == "IT-Betrieb"
    # leerer Text löscht das Feld
    client.put(url, json={"owner": "  "}, headers=headers)

    detail = client.get(f"{BASE}/settings/{setting_id}").json()
    assert detail["meta"]["owner"] is None
    fields = [entry["field"] for entry in detail["meta_history"]]
    assert fields == [
        "verantwortlich",
        "verantwortlich",
        "learn_url",
        "kritikalitaet",
        "beschreibung",
    ]
    assert detail["meta_history"][0]["old_value"] == "IT-Betrieb"
    assert detail["meta_history"][0]["new_value"] is None
    assert detail["meta_history"][0]["user"] == "Rita Reviewer"

    audit = db.scalars(
        select(AuditLog).where(
            AuditLog.action == "metadaten.geaendert", AuditLog.object_id == str(setting_id)
        )
    ).all()
    assert [entry.details for entry in audit[-3:]] == [
        {"felder": ["beschreibung", "kritikalitaet", "learn_url"]},
        {"felder": ["verantwortlich"]},
        {"felder": ["verantwortlich"]},
    ]


@pytest.mark.db
def test_metadata_validation(db: Session) -> None:
    client = client_for(["Config.Reviewer"], "m365-pruefer")
    setting_id = first_setting_id(client)
    url = f"{BASE}/settings/{setting_id}/meta"
    headers = {"Origin": ORIGIN}
    for body in (
        {"learn_url": "javascript:alert(1)"},
        {"learn_url": "http://example.com"},
        {"criticality": "extrem"},
        {"description": "x" * 4001},
        {"target_set": True, "target_value": "x" * 20_001},
    ):
        assert client.put(url, json=body, headers=headers).status_code == 422, body
    assert (
        client.put(f"{BASE}/settings/999999999/meta", json={}, headers=headers).status_code == 404
    )
    assert client.put(url, json={"description": "x"}).status_code == 403


@pytest.mark.db
def test_target_value_and_deviation(db: Session) -> None:
    client = client_for(["Config.Reviewer"], "m365-pruefer")
    setting_id = first_setting_id(client)
    url = f"{BASE}/settings/{setting_id}/meta"
    headers = {"Origin": ORIGIN}
    assert client.get(f"{BASE}/overview").json()["deviations"] == 0

    # Soll-Wert gleich dem Ist-Wert ("disabled"): keine Abweichung
    client.put(url, json={"target_set": True, "target_value": "disabled"}, headers=headers)
    detail = client.get(f"{BASE}/settings/{setting_id}").json()
    assert detail["meta"]["target_value"] == "disabled"
    assert detail["meta"]["target_source"] == "manuell"
    assert detail["setting"]["deviates"] is False

    # anderer Soll-Wert: Abweichung in Detail, Liste, Filter und Übersicht
    client.put(url, json={"target_value": "enabled"}, headers=headers)
    assert client.get(f"{BASE}/settings/{setting_id}").json()["setting"]["deviates"] is True
    deviating = client.get(f"{BASE}/settings", params={"only_deviating": "true"}).json()
    assert [entry["id"] for entry in deviating["entries"]] == [setting_id]
    assert client.get(f"{BASE}/overview").json()["deviations"] == 1

    # Soll-Wert entfernen
    cleared = client.put(url, json={"target_set": False}, headers=headers).json()
    assert cleared["target_set"] is False
    assert cleared["target_value"] is None
    assert client.get(f"{BASE}/overview").json()["deviations"] == 0
    history = client.get(f"{BASE}/settings/{setting_id}").json()["meta_history"]
    assert [entry["field"] for entry in history] == ["soll_wert"] * 3
    assert history[0]["old_value"] == {"wert": "enabled"}
    assert history[0]["new_value"] is None


@pytest.mark.db
def test_high_criticality_needs_comment_for_intended(db: Session) -> None:
    client = client_for(["Config.Reviewer"], "m365-pruefer")
    headers = {"Origin": ORIGIN}
    change = db.scalars(select(CfgChange).order_by(CfgChange.id)).first()
    assert change is not None
    client.put(
        f"{BASE}/settings/{change.setting_id}/meta", json={"criticality": "hoch"}, headers=headers
    )
    url = f"{BASE}/changes/review"
    body: dict[str, Any] = {"ids": [change.id], "status": "gewollt"}
    assert client.post(url, json=body, headers=headers).status_code == 422
    body["comment"] = "Mit der IT-Leitung abgestimmt"
    assert client.post(url, json=body, headers=headers).status_code == 200


@pytest.mark.db
def test_tasks_depend_on_role_and_state(db: Session) -> None:
    assert (
        TestClient(create_app(Settings(public_url=ORIGIN, environment="test")))
        .get("/api/tasks")
        .status_code
        == 401
    )
    headers = {"Origin": ORIGIN}
    reviewer = client_for(["Config.Reviewer"], "m365-pruefer")
    data = reviewer.get("/api/tasks").json()
    assert data["total"] == 3
    assert [(task["title"], task["count"], task["link"]) for task in data["tasks"]] == [
        ("Änderungen bewerten", 3, "/m365/aenderungen")
    ]

    setting_id = first_setting_id(reviewer)
    reviewer.put(
        f"{BASE}/settings/{setting_id}/meta",
        json={"target_set": True, "target_value": "enabled"},
        headers=headers,
    )
    titles = [task["title"] for task in reviewer.get("/api/tasks").json()["tasks"]]
    assert titles == ["Änderungen bewerten", "Abweichungen vom Soll-Wert prüfen"]

    # Leser und andere Rollen bekommen keine Aufgaben aus dem Modul
    for roles, oid in ((["Config.Reader"], "m365-leser"), (["Evergreen.Team"], "m365-team")):
        assert client_for(roles, oid).get("/api/tasks").json() == {"tasks": [], "total": 0}


@pytest.mark.db
def test_failed_collect_is_a_task_for_admins(db: Session) -> None:
    configured = {
        "entra_tenant_id": "00000000-0000-0000-0000-00000000aaaa",
        "collector_client_id": "00000000-0000-0000-0000-00000000cccc",
    }
    admin = client_for(["Werkbank.Admin"], "m365-admin", **configured)
    assert admin.get("/api/tasks").json()["tasks"] == []

    apply_snapshot(db, [], {SOURCE: False})
    db.commit()
    tasks = admin.get("/api/tasks").json()["tasks"]
    assert [(task["title"], task["link"]) for task in tasks] == [
        ("Abruf aus dem Tenant ist fehlgeschlagen", "/audit")
    ]
    # ohne eingerichteten Abruf keine Meldung
    assert client_for(["Werkbank.Admin"], "m365-admin").get("/api/tasks").json()["tasks"] == []
