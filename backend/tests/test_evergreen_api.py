from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.models import AuditLog
from werkbank.main import create_app
from werkbank.modules.evergreen.models import EvEntry
from werkbank.modules.m365_config.models import CfgChange, CfgSetting
from werkbank.modules.m365_config.normalize import normalize_object
from werkbank.modules.m365_config.versioning import apply_snapshot

ORIGIN = "https://testserver"
BASE = "/api/evergreen"
HEADERS = {"Origin": ORIGIN}


def client_for(roles: list[str], oid: str, name: str = "Ina Beispiel") -> TestClient:
    settings = Settings(public_url=ORIGIN, environment="test", enable_test_login=True)
    client = TestClient(create_app(settings), base_url=ORIGIN, follow_redirects=False)
    response = client.post(
        "/auth/test-login", json={"oid": oid, "name": name, "roles": roles}, headers=HEADERS
    )
    assert response.status_code == 303, response.text
    return client


def editor(oid: str = "ev-bearbeiter", name: str = "Ina Beispiel") -> TestClient:
    return client_for(["Evergreen.Editor"], oid, name)


def new_entry(client: TestClient, title: str = "Neue Funktion in Teams", **extra: Any) -> int:
    response = client.post(f"{BASE}/entries", json={"title": title, **extra}, headers=HEADERS)
    assert response.status_code == 201, response.text
    entry_id: int = response.json()["id"]
    return entry_id


def post(client: TestClient, path: str, body: dict[str, Any] | None = None) -> Any:
    return client.post(f"{BASE}{path}", json=body or {}, headers=HEADERS)


@pytest.fixture
def db(db_session: Session) -> Session:
    db_session.execute(delete(EvEntry))
    db_session.commit()
    return db_session


def test_api_requires_login() -> None:
    client = TestClient(create_app(Settings(public_url=ORIGIN, environment="test")))
    assert client.get(f"{BASE}/entries").status_code == 401


@pytest.mark.db
def test_roles(db: Session) -> None:
    stranger = client_for(["Werkbank.Admin", "Config.Reviewer"], "ev-fremd")
    assert stranger.get(f"{BASE}/entries").status_code == 403
    reader = client_for(["Evergreen.Reader"], "ev-leser")
    listed = reader.get(f"{BASE}/entries")
    assert listed.status_code == 200 and listed.json()["can_edit"] is False
    assert post(reader, "/entries", {"title": "Test"}).status_code == 403

    entry_id = new_entry(editor())
    assert reader.get(f"{BASE}/entries/{entry_id}").json()["can_edit"] is False
    for path in ("notes", "close", "reopen"):
        assert post(reader, f"/entries/{entry_id}/{path}", {"text": "x"}).status_code == 403
    assert post(reader, "/entries/from-change", {"change_id": 1}).status_code == 403


@pytest.mark.db
def test_status_flow_with_notes(db: Session) -> None:
    ina = editor()
    ole = editor("ev-zweiter", "Ole Beispiel")
    # Nummern wiederholen sich in den Tests (Einträge werden gelöscht): nur neue Protokolle
    since = db.scalar(select(func.max(AuditLog.id))) or 0
    entry_id = new_entry(ina, "  Copilot in Outlook  ", body="Text", service="Exchange")
    created = ina.get(f"{BASE}/entries/{entry_id}").json()
    assert (created["title"], created["status"], created["source"]) == (
        "Copilot in Outlook",
        "neu",
        "manuell",
    )
    assert created["services"] == ["Exchange"] and created["number"].startswith("EV-")
    assert created["notes"] == [] and created["last_editor"] is None

    # erste Notiz: bearbeitet; weitere Notizen von anderen Bearbeitern
    first = post(ina, f"/entries/{entry_id}/notes", {"text": "  Mit Fachabteilung klären  "})
    assert first.json()["status"] == "bearbeitet"
    second = post(ole, f"/entries/{entry_id}/notes", {"text": "Geklärt, betrifft uns nicht"})
    body = second.json()
    assert [(n["kind"], n["text"], n["author"]) for n in body["notes"]] == [
        ("notiz", "Mit Fachabteilung klären", "Ina Beispiel"),
        ("notiz", "Geklärt, betrifft uns nicht", "Ole Beispiel"),
    ]
    assert body["last_editor"] == "Ole Beispiel"
    assert post(ina, f"/entries/{entry_id}/notes", {"text": "   "}).status_code == 422
    assert post(ina, f"/entries/{entry_id}/notes", {"text": "x" * 4001}).status_code == 422
    assert post(ina, f"/entries/{entry_id}/reopen").status_code == 409

    closed = post(ole, f"/entries/{entry_id}/close", {"text": "Erledigt"}).json()
    assert closed["status"] == "abgeschlossen" and closed["closed_at"] is not None
    assert closed["notes"][-1]["kind"] == "abgeschlossen"
    assert post(ina, f"/entries/{entry_id}/close").status_code == 409
    assert post(ina, f"/entries/{entry_id}/notes", {"text": "noch was"}).status_code == 409

    reopened = post(ina, f"/entries/{entry_id}/reopen").json()
    assert reopened["status"] == "bearbeitet" and reopened["closed_at"] is None
    assert reopened["notes"][-1]["kind"] == "geoeffnet"
    assert reopened["notes"][-1]["text"] is None

    actions = db.scalars(
        select(AuditLog.action).where(
            AuditLog.module == "evergreen",
            AuditLog.object_id == created["number"],
            AuditLog.id > since,
        )
    ).all()
    assert actions == [
        "eintrag.angelegt",
        "eintrag.notiz",
        "eintrag.notiz",
        "eintrag.abgeschlossen",
        "eintrag.wieder_geoeffnet",
    ]
    assert ina.get(f"{BASE}/entries/999999999").status_code == 404


@pytest.mark.db
def test_list_filters_search_and_counts(db: Session) -> None:
    ina = editor()
    teams = new_entry(ina, "Teams bekommt Zeppelin")
    mail = new_entry(ina, "Outlook neu")
    done = new_entry(ina, "Alt")
    post(ina, f"/entries/{mail}/notes", {"text": "läuft"})
    post(ina, f"/entries/{done}/close")

    def ids(**params: Any) -> list[int]:
        return [e["id"] for e in ina.get(f"{BASE}/entries", params=params).json()["entries"]]

    listed = ina.get(f"{BASE}/entries").json()
    assert (listed["total"], listed["open"], listed["new"]) == (2, 2, 1)
    assert ids() == [mail, teams]
    assert ids(state="neu") == [teams]
    assert ids(state="bearbeitet") == [mail]
    assert ids(state="abgeschlossen") == [done]
    assert ids(state="alle") == [done, mail, teams]
    assert ids(state="alle", q="zeppelin") == [teams]
    number = ina.get(f"{BASE}/entries/{teams}").json()["number"]
    assert ids(state="alle", q=number.lower()) == [teams]
    assert ids(state="alle", q="%") == []
    assert ina.get(f"{BASE}/entries", params={"software": "andere"}).status_code == 422
    assert ina.get(f"{BASE}/entries", params={"state": "x"}).status_code == 422
    assert ina.get(f"{BASE}/entries", params={"q": "x" * 101}).status_code == 422


@pytest.mark.db
def test_create_validation(db: Session) -> None:
    ina = editor()
    assert post(ina, "/entries", {"title": ""}).status_code == 422
    assert post(ina, "/entries", {"title": "   "}).status_code == 422
    assert post(ina, "/entries", {"title": "x" * 501}).status_code == 422
    assert post(ina, "/entries", {"title": "Test", "software": "andere"}).status_code == 422
    assert post(ina, "/entries/from-change", {"change_id": 999999999}).status_code == 404


SOURCE = "ev-test"


def snapshot(db: Session, object_id: str, value: str) -> None:
    """Legt eine überwachte Einstellung an bzw. ändert ihren Wert."""
    items = normalize_object(
        workload="teams",
        area="meetingPolicy",
        object_id=object_id,
        object_name="Besprechungsrichtlinie",
        properties={"AllowRecording": value},
        source=f"{SOURCE}:{object_id}",
    )
    apply_snapshot(db, items, {f"{SOURCE}:{object_id}": True})
    db.commit()


@pytest.mark.db
def test_entry_from_detected_change(db: Session) -> None:
    snapshot(db, "ev-aenderung", "enabled")
    snapshot(db, "ev-aenderung", "disabled")
    setting = db.execute(
        select(CfgSetting).where(CfgSetting.object_id == "ev-aenderung")
    ).scalar_one()
    change = db.execute(select(CfgChange).where(CfgChange.setting_id == setting.id)).scalar_one()

    ina = editor()
    created = post(ina, "/entries/from-change", {"change_id": change.id})
    assert created.status_code == 201, created.text
    data = created.json()
    assert (data["source"], data["software"], data["status"]) == ("aenderung", "m365", "neu")
    assert data["title"] == "Besprechungsrichtlinie: AllowRecording (geändert)"
    assert data["services"] == ["teams"]
    assert "Vorher: enabled" in data["body"] and "Nachher: disabled" in data["body"]
    again = post(ina, "/entries/from-change", {"change_id": change.id})
    assert again.status_code == 409 and data["number"] in again.json()["detail"]
