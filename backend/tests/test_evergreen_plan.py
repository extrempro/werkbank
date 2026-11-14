from datetime import date, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.models import AuditLog
from werkbank.main import create_app
from werkbank.modules.evergreen.implementation import check_open_items
from werkbank.modules.evergreen.jobs import CHECK_IMPLEMENTATION
from werkbank.modules.m365_config.models import CfgChange, CfgSetting, CfgSettingMeta
from werkbank.modules.m365_config.normalize import normalize_object
from werkbank.modules.m365_config.versioning import apply_snapshot
from werkbank.worker.tasks import REGISTRY

ORIGIN = "https://testserver"
BASE = "/api/evergreen"
HEADERS = {"Origin": ORIGIN}
SOURCE = "test:evergreen-plan"


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


def gf() -> TestClient:
    return client_for(["Evergreen.GF"], "ev-gf", "Gerd GF")


def new_item(client: TestClient, title: str, **extra: Any) -> int:
    response = client.post(f"{BASE}/items", json={"title": title, **extra}, headers=HEADERS)
    assert response.status_code == 201, response.text
    item_id: int = response.json()["id"]
    return item_id


def act(client: TestClient, item_id: int, action: str, step: str, **extra: Any) -> Any:
    body = {"action": action, "expected_step": step, **extra}
    response = client.post(f"{BASE}/items/{item_id}/actions", json=body, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


def to_management(client: TestClient, item_id: int) -> None:
    """Bringt einen Vorgang bis vor die Abnahme durch die Geschäftsführung."""
    act(client, item_id, "pflichtig", "it_bewertung")
    act(client, item_id, "rueckmeldungen_liegen_vor", "fachabteilungen")
    act(client, item_id, "an_br_uebergeben", "vorlage_br")
    act(
        client,
        item_id,
        "zustimmen",
        "betriebsrat",
        session_date=date.today().isoformat(),
        comment="Zugestimmt laut Protokoll",
    )


def add_plan(client: TestClient, item_id: int, **body: Any) -> Any:
    response = client.post(f"{BASE}/items/{item_id}/plan", json=body, headers=HEADERS)
    assert response.status_code == 201, response.text
    return response.json()


def snapshot(db: Session, object_id: str, value: str) -> int:
    """Legt eine überwachte Einstellung an bzw. ändert ihren Wert. Liefert ihre Kennung."""
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
    setting = db.execute(select(CfgSetting).where(CfgSetting.path == items[0].path)).scalar_one()
    return setting.id


def test_check_job_is_always_registered() -> None:
    assert CHECK_IMPLEMENTATION in REGISTRY


@pytest.mark.db
def test_monitored_target_closes_item_after_snapshot(
    migrated_db: None, db_session: Session
) -> None:
    db = db_session
    setting_id = snapshot(db, "plan-a", "enabled")
    client = it()
    item_id = new_item(client, "Aufzeichnung abschalten")
    detail = add_plan(
        client,
        item_id,
        label="Aufzeichnung von Besprechungen",
        target_value="disabled",
        instruction="Teams Admin Center > Besprechungsrichtlinien",
        setting_id=setting_id,
    )
    entry = detail["plan"][0]
    assert (entry["status"], entry["monitored"], entry["current_value"]) == (
        "offen",
        True,
        "enabled",
    )
    assert entry["setting_path"].endswith("/plan-a/AllowRecording")

    to_management(client, item_id)
    after = act(gf(), item_id, "abnehmen", "geschaeftsfuehrung")
    assert after["item"]["step"] == "umsetzung"
    # die Geschäftsführung sieht den Plan, aber keine technischen Angaben
    plan_for_gf = after["plan"][0]
    assert plan_for_gf["label"] == "Aufzeichnung von Besprechungen"
    assert (plan_for_gf["setting_path"], plan_for_gf["current_value"]) == (None, None)
    assert after["can_plan"] is False

    assert check_open_items(db) == 0
    snapshot(db, "plan-a", "disabled")
    assert check_open_items(db) == 1

    done = client.get(f"{BASE}/items/{item_id}").json()
    assert (done["item"]["step"], done["item"]["finished"]) == ("abgeschlossen", True)
    assert done["plan"][0]["status"] == "erfuellt"
    last = done["events"][-1]
    assert (last["user"], last["action_title"]) == (None, "Alle Soll-Werte sind umgesetzt")

    # der Soll-Wert gilt danach dauerhaft an der Einstellung
    meta = db.get(CfgSettingMeta, setting_id)
    assert meta is not None
    db.refresh(meta)
    assert (meta.target_set, meta.target_value) == (True, "disabled")
    assert meta.target_source == f"Evergreen {done['item']['number']}"
    # nach dem Abschluss lässt sich der Plan nicht mehr ändern
    late = client.post(
        f"{BASE}/items/{item_id}/plan",
        json={"label": "Nachtrag", "target_value": 1},
        headers=HEADERS,
    )
    assert late.status_code == 409


@pytest.mark.db
def test_unmonitored_target_needs_confirmation_by_it(
    migrated_db: None, db_session: Session
) -> None:
    client = it()
    item_id = new_item(client, "Loop-Komponenten")
    detail = add_plan(client, item_id, label="Loop in Outlook", target_value=False)
    entry = detail["plan"][0]
    assert (entry["status"], entry["monitored"]) == ("unbestaetigt", False)
    to_management(client, item_id)
    assert act(gf(), item_id, "abnehmen", "geschaeftsfuehrung")["item"]["step"] == "umsetzung"

    url = f"{BASE}/items/{item_id}/plan/{entry['id']}/confirm"
    for roles, oid in ((["Evergreen.Team"], "ev-team"), (["Evergreen.GF"], "ev-gf")):
        other = client_for(roles, oid, "Andere Person")
        assert other.post(url, json={"done": True}, headers=HEADERS).status_code == 403
    confirmed = client.post(url, json={"done": True}, headers=HEADERS)
    assert confirmed.status_code == 200, confirmed.text
    data = confirmed.json()
    assert data["plan"][0]["status"] == "bestaetigt"
    assert data["plan"][0]["confirmed_by"] == "Ina IT"
    assert (data["item"]["step"], data["item"]["finished"]) == ("abgeschlossen", True)

    audit = db_session.scalars(
        select(AuditLog)
        .where(AuditLog.module == "evergreen", AuditLog.object_id == data["item"]["number"])
        .order_by(AuditLog.id)
    ).all()
    actions = [entry.action for entry in audit]
    assert "umsetzung.geplant" in actions
    assert actions[-2:] == ["workflow.soll_ist_erfuellt", "umsetzung.bestaetigt"] or actions[
        -2:
    ] == ["umsetzung.bestaetigt", "workflow.soll_ist_erfuellt"]


@pytest.mark.db
def test_confirmation_can_be_withdrawn_and_entries_removed(
    migrated_db: None, db_session: Session
) -> None:
    setting_id = snapshot(db_session, "plan-b", "enabled")
    client = it()
    item_id = new_item(client, "Mehrere Einträge")
    add_plan(client, item_id, label="Ohne Überwachung", target_value="aus")
    detail = add_plan(
        client, item_id, label="Mit Überwachung", target_value="enabled", setting_id=setting_id
    )
    manual, monitored = detail["plan"]
    assert monitored["status"] == "erfuellt"

    base = f"{BASE}/items/{item_id}/plan"
    assert (
        client.post(f"{base}/{monitored['id']}/confirm", json={"done": True}, headers=HEADERS)
    ).status_code == 409
    on = client.post(f"{base}/{manual['id']}/confirm", json={"done": True}, headers=HEADERS)
    assert on.json()["plan"][0]["status"] == "bestaetigt"
    off = client.post(f"{base}/{manual['id']}/confirm", json={"done": False}, headers=HEADERS)
    assert off.json()["plan"][0]["status"] == "unbestaetigt"
    assert off.json()["item"]["finished"] is False

    removed = client.delete(f"{base}/{manual['id']}", headers=HEADERS)
    assert [entry["label"] for entry in removed.json()["plan"]] == ["Mit Überwachung"]
    assert client.delete(f"{base}/{manual['id']}", headers=HEADERS).status_code == 404
    assert client.delete(f"{base}/999999999", headers=HEADERS).status_code == 404

    for body in (
        {"label": "ab", "target_value": 1},
        {"label": "Zu groß", "target_value": "x" * 20_001},
        {"label": "Unbekannt", "target_value": 1, "setting_id": 999_999_999},
    ):
        assert client.post(base, json=body, headers=HEADERS).status_code == 422, body


@pytest.mark.db
def test_not_controllable_item_closes_without_plan(migrated_db: None) -> None:
    client = it()
    controllable = new_item(client, "Steuerbar ohne Plan")
    to_management(client, controllable)
    stays = act(gf(), controllable, "abnehmen", "geschaeftsfuehrung")
    assert (stays["item"]["step"], stays["item"]["finished"]) == ("umsetzung", False)
    # nachträglich als nicht steuerbar gekennzeichnet: nichts umzusetzen, also abgeschlossen
    patched = client.patch(
        f"{BASE}/items/{controllable}", json={"not_controllable": True}, headers=HEADERS
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["item"]["finished"] is True

    fixed = new_item(client, "Nicht steuerbar")
    client.patch(f"{BASE}/items/{fixed}", json={"not_controllable": True}, headers=HEADERS)
    to_management(client, fixed)
    closed = act(gf(), fixed, "abnehmen", "geschaeftsfuehrung")
    assert (closed["item"]["step"], closed["item"]["finished"]) == ("abgeschlossen", True)
    assert closed["events"][-1]["comment"] == "Nicht steuerbar: keine Umsetzung nötig"


@pytest.mark.db
def test_provisional_block_hint_and_immediate_target(
    migrated_db: None, db_session: Session
) -> None:
    db = db_session
    setting_id = snapshot(db, "plan-c", "enabled")
    client = it()
    soon = (date.today() + timedelta(days=10)).isoformat()
    later = (date.today() + timedelta(days=60)).isoformat()

    relaxed = new_item(client, "Rollout in weiter Ferne", rollout_date=later)
    assert client.get(f"{BASE}/items/{relaxed}").json()["provisional_hint"] is False
    undated = new_item(client, "Ohne Termin")
    assert client.get(f"{BASE}/items/{undated}").json()["provisional_hint"] is False

    item_id = new_item(client, "Rollout steht bevor", rollout_date=soon)
    assert client.get(f"{BASE}/items/{item_id}").json()["provisional_hint"] is True
    detail = add_plan(
        client,
        item_id,
        label="Vorläufig abschalten",
        target_value="disabled",
        provisional=True,
        setting_id=setting_id,
    )
    assert detail["provisional_hint"] is False
    assert detail["plan"][0]["provisional"] is True

    meta = db.get(CfgSettingMeta, setting_id)
    assert meta is not None
    assert (meta.target_set, meta.target_value) == (True, "disabled")
    assert meta.target_source is not None and "vorläufig bis Beschluss" in meta.target_source
    assert detail["item"]["finished"] is False


@pytest.mark.db
def test_setting_search_is_for_it_only(migrated_db: None, db_session: Session) -> None:
    snapshot(db_session, "plan-suche", "enabled")
    client = it()
    found = client.get(f"{BASE}/settings", params={"search": "plan-suche"}).json()
    assert len(found) == 1
    assert found[0]["title"] == "Besprechungsrichtlinie: AllowRecording"
    assert found[0]["value"] == "enabled"
    assert client.get(f"{BASE}/settings", params={"search": "x"}).status_code == 422
    team = client_for(["Evergreen.Team"], "ev-team", "Tom Team")
    assert team.get(f"{BASE}/settings", params={"search": "plan"}).status_code == 403
    assert (
        team.post(
            f"{BASE}/items/1/plan", json={"label": "Versuch", "target_value": 1}, headers=HEADERS
        ).status_code
        == 403
    )


@pytest.mark.db
def test_item_from_detected_change(migrated_db: None, db_session: Session) -> None:
    db = db_session
    snapshot(db, "plan-aenderung", "enabled")
    snapshot(db, "plan-aenderung", "disabled")
    setting = db.execute(
        select(CfgSetting).where(CfgSetting.object_id == "plan-aenderung")
    ).scalar_one()
    change = db.execute(select(CfgChange).where(CfgChange.setting_id == setting.id)).scalar_one()

    client = it()
    url = f"{BASE}/items/from-change"
    created = client.post(url, json={"change_id": change.id}, headers=HEADERS)
    assert created.status_code == 201, created.text
    data = created.json()
    assert data["source"] == "einstellung"
    assert data["title"] == "Besprechungsrichtlinie: AllowRecording (geändert)"
    assert data["service"] == "teams"
    detail = client.get(f"{BASE}/items/{data['id']}").json()
    assert "Vorher: enabled" in detail["summary"]
    assert "Nachher: disabled" in detail["summary"]

    again = client.post(url, json={"change_id": change.id}, headers=HEADERS)
    assert again.status_code == 409
    assert data["number"] in again.json()["detail"]
    assert client.post(url, json={"change_id": 999_999_999}, headers=HEADERS).status_code == 404
    team = client_for(["Evergreen.Team"], "ev-team", "Tom Team")
    assert team.post(url, json={"change_id": change.id}, headers=HEADERS).status_code == 403
