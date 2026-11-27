"""IT-Bestand: Ausgabe mit Vorbereitung und Einmal-Link, Rückgabe von Hand und beim Austritt."""

import base64
import re
import secrets
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_admin_settings import HEADERS
from tests.test_inventory_loans import OID, PEOPLE, device, lookup
from tests.test_m365_api import ORIGIN, client_for
from werkbank.core.models import AppSetting
from werkbank.modules.inventory import issues
from werkbank.modules.inventory.issues import RULES_KEY, ensure_exit_return
from werkbank.modules.inventory.models import (
    InventoryAccessory,
    InventoryCase,
    InventoryChecklistTemplate,
    InventoryHardware,
    InventoryIssue,
    InventoryIssueMessage,
    InventoryKind,
    InventoryLoan,
    InventoryPosition,
    InventoryReturn,
)
from werkbank.modules.inventory.people import get_person_lookup

BASE = "/api/inventory"
PNG = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"\x00" * 40).decode()
TOKEN = "a" * 43


@pytest.fixture
def db(db_session: Session) -> Iterator[Session]:
    def clean() -> None:
        db_session.execute(delete(InventoryIssue))
        db_session.execute(delete(InventoryReturn))
        db_session.execute(delete(InventoryLoan))
        db_session.execute(delete(InventoryCase))
        db_session.execute(delete(InventoryAccessory))
        db_session.execute(delete(InventoryChecklistTemplate))
        db_session.execute(delete(InventoryHardware))
        db_session.execute(delete(InventoryPosition).where(InventoryPosition.number.like("TA-%")))
        db_session.execute(delete(AppSetting).where(AppSetting.key == RULES_KEY))
        db_session.commit()

    clean()
    yield db_session
    db_session.rollback()
    clean()


def editor() -> TestClient:
    client = client_for(["Bestand.Editor"], "ausgabe-bearbeiter")
    cast(FastAPI, client.app).dependency_overrides[get_person_lookup] = lambda: lookup
    return client


def position(db: Session, number: str = "TA-1", oid: str | None = OID) -> InventoryPosition:
    row = InventoryPosition(
        number=number,
        name="Technik",
        person_oid=oid,
        person_name=PEOPLE[OID].name if oid else "",
    )
    db.add(row)
    db.commit()
    return row


def kind_id(db: Session, name: str) -> int:
    return db.scalars(select(InventoryKind.id).where(InventoryKind.name == name)).one()


def body(position_id: int, items: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return {
        "person_oid": OID,
        "position_id": position_id,
        "reason": "neu",
        "items": items,
        "confirm_method": "unterschrift",
        **extra,
    }


@pytest.mark.db
def test_settings_accessories_templates_rules(db: Session) -> None:
    client = editor()
    reader = client_for(["Bestand.Reader"], "ausgabe-leser")
    notebook = kind_id(db, "Notebook")
    assert (
        reader.post(
            f"{BASE}/accessories", json={"kind_id": notebook, "name": "Netzteil"}, headers=HEADERS
        ).status_code
        == 403
    )
    out = client.post(
        f"{BASE}/accessories", json={"kind_id": notebook, "name": "Netzteil"}, headers=HEADERS
    ).json()
    assert [(a["kind"], a["name"]) for a in out["accessories"]] == [("Notebook", "Netzteil")]
    again = client.post(
        f"{BASE}/accessories", json={"kind_id": notebook, "name": "netzteil"}, headers=HEADERS
    )
    assert again.status_code == 409
    bad = client.post(
        f"{BASE}/accessories", json={"kind_id": notebook, "name": "a\nb"}, headers=HEADERS
    )
    assert bad.status_code == 422

    both = {"reason": "neu", "kind_id": notebook, "label": "x"}
    assert client.post(f"{BASE}/checklist-templates", json=both, headers=HEADERS).status_code == 422
    client.post(
        f"{BASE}/checklist-templates", json={"reason": "neu", "label": "Konto"}, headers=HEADERS
    )
    out = client.post(
        f"{BASE}/checklist-templates",
        json={"kind_id": notebook, "label": "In Intune registriert"},
        headers=HEADERS,
    ).json()
    assert [(t["reason"], t["kind"], t["label"]) for t in out["templates"]] == [
        ("neu", "", "Konto"),
        (None, "Notebook", "In Intune registriert"),
    ]

    out = client.put(
        f"{BASE}/issue-settings/rules",
        json={"text": "  Bitte pfleglich behandeln.\n"},
        headers=HEADERS,
    ).json()
    assert out["rules_text"] == "Bitte pfleglich behandeln."
    assert reader.get(f"{BASE}/issue-settings").json()["rules_text"] == out["rules_text"]

    accessory = out["accessories"][0]["id"]
    out = client.delete(f"{BASE}/accessories/{accessory}", headers=HEADERS).json()
    assert out["accessories"] == []


@pytest.mark.db
def test_issue_with_preparation_and_signature(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    client = editor()
    reader = client_for(["Bestand.Reader"], "ausgabe-leser")
    place = position(db)
    other = position(db, "TA-2", oid=None)
    notebook = device(db, "Notebook", "Notebook 1", "NB-1")
    monitor = device(db, "Monitor", "Monitor 1", "MO-1")
    client.post(
        f"{BASE}/checklist-templates", json={"reason": "neu", "label": "Konto"}, headers=HEADERS
    )
    client.post(
        f"{BASE}/checklist-templates",
        json={"kind_id": notebook.kind_id, "label": "Intune"},
        headers=HEADERS,
    )
    client.put(f"{BASE}/issue-settings/rules", json={"text": "Regeln"}, headers=HEADERS)

    free = {d["id"] for d in client.get(f"{BASE}/issues/free-devices").json()}
    assert {notebook.id, monitor.id} <= free
    assert reader.get(f"{BASE}/issues/free-devices").status_code == 403
    positions = client.get(f"{BASE}/issues/positions", params={"oid": OID}).json()
    assert [p["number"] for p in positions] == ["TA-1"]

    items = [{"hardware_id": notebook.id, "accessories": ["Netzteil", "Netzteil", " Tasche "]}]
    wrong = client.post(f"{BASE}/issues", json=body(other.id, items), headers=HEADERS)
    assert wrong.status_code == 422
    twice = body(place.id, items + items)
    assert client.post(f"{BASE}/issues", json=twice, headers=HEADERS).status_code == 422
    created = client.post(
        f"{BASE}/issues",
        json=body(place.id, [*items, {"hardware_id": monitor.id}], notify_teams=True),
        headers=HEADERS,
    )
    assert created.status_code == 200, created.text
    issue = created.json()
    assert re.fullmatch(r"A-\d{3,}", issue["number"])
    assert issue["state"] == "vorbereitung" and issue["rules_text"] == "Regeln"
    assert issue["entries"][0]["accessories"] == ["Netzteil", "Tasche"]
    assert [t["label"] for t in issue["task_list"]] == ["Konto", "Notebook 1: Intune"]

    # Reserviert: nicht verleihen, nicht zuordnen, nicht ausmustern, nicht zweimal ausgeben
    loan = {
        "person": {"oid": OID},
        "due_on": (datetime.now(UTC) + timedelta(days=3)).date().isoformat(),
        "hardware_ids": [notebook.id],
    }
    assert client.post(f"{BASE}/loans", json=loan, headers=HEADERS).status_code == 409
    assert notebook.id not in {d["id"] for d in client.get(f"{BASE}/loans/available").json()}
    assert (
        client.post(f"{BASE}/issues", json=body(place.id, items), headers=HEADERS).status_code
        == 409
    )
    update = {
        "kind_id": notebook.kind_id,
        "name": notebook.name,
        "serial": notebook.serial,
        "position_id": place.id,
    }
    assert (
        client.put(f"{BASE}/hardware/{notebook.id}", json=update, headers=HEADERS).status_code
        == 409
    )

    # Vorbereitung: erst alles abhaken, dann bereit
    issue_id = issue["id"]
    assert client.post(f"{BASE}/issues/{issue_id}/ready", headers=HEADERS).status_code == 409
    added = client.post(
        f"{BASE}/issues/{issue_id}/tasks", json={"label": "Tasche beilegen"}, headers=HEADERS
    ).json()
    for task in added["task_list"]:
        done = client.put(
            f"{BASE}/issues/{issue_id}/tasks/{task['id']}", json={"done": True}, headers=HEADERS
        )
        assert done.status_code == 200
    pickup = client.put(
        f"{BASE}/issues/{issue_id}/pickup",
        json={"place": "IT, Raum 1", "at": "2026-12-01T09:00:00+01:00"},
        headers=HEADERS,
    ).json()
    assert pickup["pickup_place"] == "IT, Raum 1"
    assert (
        client.post(
            f"{BASE}/issues/{issue_id}/handover", json={"signed_name": "Pia"}, headers=HEADERS
        )
    ).status_code == 409
    ready = client.post(f"{BASE}/issues/{issue_id}/ready", headers=HEADERS).json()
    assert ready["state"] == "bereit" and ready["link_expires_at"] is None
    # Ohne SMTP und Teams: Nachrichten „aus“, aber vorgemerkt für Mail und Teams
    channels = sorted(
        (row.channel, row.status)
        for row in db.scalars(
            select(InventoryIssueMessage).where(InventoryIssueMessage.issue_id == issue_id)
        ).all()
    )
    assert channels == [("mail", "aus"), ("teams", "aus")]
    assert (
        client.put(
            f"{BASE}/issues/{issue_id}/tasks/{added['task_list'][0]['id']}",
            json={"done": False},
            headers=HEADERS,
        ).status_code
        == 409
    )

    # Übergabe: Unterschrift muss ein PNG sein
    fake = base64.b64encode(b"<svg/>").decode()
    assert (
        client.post(
            f"{BASE}/issues/{issue_id}/handover", json={"signature_png": fake}, headers=HEADERS
        ).status_code
        == 422
    )
    assert (
        client.post(f"{BASE}/issues/{issue_id}/handover", json={}, headers=HEADERS).status_code
        == 422
    )
    handed = client.post(
        f"{BASE}/issues/{issue_id}/handover", json={"signature_png": PNG}, headers=HEADERS
    ).json()
    assert handed["state"] == "uebergeben" and handed["confirmed_via"] == "unterschrift"
    assert handed["has_signature"] is True and handed["rules_text"] == "Regeln"
    db.expire_all()
    assert db.get(InventoryHardware, notebook.id).position_id == place.id  # type: ignore[union-attr]
    signature = reader.get(f"{BASE}/issues/{issue_id}/signature")
    assert signature.headers["content-type"] == "image/png"
    assert signature.headers["cache-control"] == "no-store"
    listed = reader.get(f"{BASE}/issues", params={"state": "uebergeben", "q": "nb-1"}).json()
    assert [row["id"] for row in listed["issues"]] == [issue_id]
    assert client.post(f"{BASE}/issues/{issue_id}/cancel", headers=HEADERS).status_code == 409


@pytest.mark.db
def test_issue_confirm_by_link(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    client = editor()
    place = position(db)
    headset = device(db, "Headset", "Headset 1", "HS-1")
    monkeypatch.setattr(secrets, "token_urlsafe", lambda _n: TOKEN)
    sent: list[Any] = []
    real = issues.send_issue_messages

    def capture(db_: Session, settings: Any, **kwargs: Any) -> int:
        sent.append(dict(issues._PENDING_LINKS))
        return real(db_, settings, **kwargs)

    monkeypatch.setattr(issues, "send_issue_messages", capture)
    issue = client.post(
        f"{BASE}/issues",
        json=body(place.id, [{"hardware_id": headset.id}], confirm_method="link"),
        headers=HEADERS,
    ).json()
    ready = client.post(f"{BASE}/issues/{issue['id']}/ready", headers=HEADERS).json()
    assert ready["link_expires_at"] is not None
    assert sent and sent[0] == {issue["id"]: TOKEN}
    stored = db.get(InventoryIssue, issue["id"])
    assert stored is not None and stored.token_hash != TOKEN and len(stored.token_hash or "") == 64

    public = TestClient(cast(FastAPI, client.app), base_url=ORIGIN)
    assert public.get("/api/public/ausgabe/" + "b" * 43).status_code == 404
    view = public.get(f"/api/public/ausgabe/{TOKEN}")
    assert view.status_code == 200 and view.headers["cache-control"] == "no-store"
    assert view.json()["entries"][0]["name"] == "Headset 1"
    assert view.json()["number"] == issue["number"]
    no = public.post(
        f"/api/public/ausgabe/{TOKEN}", json={"accepted": False}, headers={"Origin": ORIGIN}
    )
    assert no.status_code == 422
    yes = public.post(
        f"/api/public/ausgabe/{TOKEN}", json={"accepted": True}, headers={"Origin": ORIGIN}
    )
    assert yes.status_code == 200 and yes.json()["confirmed"] is True
    # Nur einmal gültig
    assert public.get(f"/api/public/ausgabe/{TOKEN}").status_code == 404
    final = client.get(f"{BASE}/issues/{issue['id']}").json()
    assert final["state"] == "uebergeben" and final["confirmed_via"] == "link"

    # Abgelaufen
    second = device(db, "Headset", "Headset 2", "HS-2")
    other = client.post(
        f"{BASE}/issues",
        json=body(place.id, [{"hardware_id": second.id}], confirm_method="link"),
        headers=HEADERS,
    ).json()
    client.post(f"{BASE}/issues/{other['id']}/ready", headers=HEADERS)
    row = db.get(InventoryIssue, other["id"])
    assert row is not None
    db.refresh(row)
    row.token_expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()
    assert public.get(f"/api/public/ausgabe/{TOKEN}").status_code == 404
    # Abbrechen gibt die Geräte frei
    cancelled = client.post(f"{BASE}/issues/{other['id']}/cancel", headers=HEADERS).json()
    assert cancelled["state"] == "abgebrochen"
    assert second.id in {d["id"] for d in client.get(f"{BASE}/issues/free-devices").json()}


@pytest.mark.db
def test_return_manual_and_on_exit(db: Session) -> None:
    client = editor()
    reader = client_for(["Bestand.Reader"], "ausgabe-leser")
    place = position(db)
    empty = position(db, "TA-2", oid=None)
    notebook = device(db, "Notebook", "Notebook 9", "NB-9")
    notebook.position_id = place.id
    headset = device(db, "Headset", "Headset 9", "HS-9")
    db.commit()
    due = (datetime.now(UTC) + timedelta(days=5)).date().isoformat()
    loan = client.post(
        f"{BASE}/loans",
        json={"person": {"oid": OID}, "due_on": due, "hardware_ids": [headset.id]},
        headers=HEADERS,
    ).json()

    assert (
        client.post(f"{BASE}/returns", json={"position_id": empty.id}, headers=HEADERS).status_code
        == 409
    )
    assert (
        reader.post(f"{BASE}/returns", json={"position_id": place.id}, headers=HEADERS).status_code
        == 403
    )
    started = client.post(f"{BASE}/returns", json={"position_id": place.id}, headers=HEADERS)
    assert started.status_code == 200, started.text
    ret = started.json()
    assert re.fullmatch(r"R-\d{3,}", ret["number"]) and ret["reason"] == "manuell"
    sources = {entry["name"]: entry["source"] for entry in ret["entries"]}
    assert sources == {
        "Notebook 9": "Stelle TA-1 Technik",
        "Headset 9": f"Verleih {loan['number']}",
    }
    assert (
        client.post(f"{BASE}/returns", json={"position_id": place.id}, headers=HEADERS).status_code
        == 409
    )
    assert client.post(f"{BASE}/returns/{ret['id']}/complete", headers=HEADERS).status_code == 409
    by_name = {entry["name"]: entry["id"] for entry in ret["entries"]}
    client.put(
        f"{BASE}/returns/{ret['id']}/items/{by_name['Notebook 9']}",
        json={"state": "zurueck", "condition": "maengel", "accessories_ok": True, "wiped": True},
        headers=HEADERS,
    )
    client.put(
        f"{BASE}/returns/{ret['id']}/items/{by_name['Headset 9']}",
        json={"state": "zurueck"},
        headers=HEADERS,
    )
    done = client.post(f"{BASE}/returns/{ret['id']}/complete", headers=HEADERS).json()
    assert done["state"] == "abgeschlossen" and done["items_back"] == 2
    db.expire_all()
    assert db.get(InventoryHardware, notebook.id).position_id is None  # type: ignore[union-attr]
    stored_loan = db.get(InventoryLoan, loan["id"])
    assert stored_loan is not None and stored_loan.returned_on is not None
    view = reader.get(f"{BASE}/hardware/{notebook.id}").json()
    assert any(
        "mit Mängeln, Zubehör vollständig, Daten gelöscht" in event["text"]
        for event in view["events"]
    )
    listed = reader.get(f"{BASE}/returns", params={"state": "alle"}).json()
    assert ret["id"] in {row["id"] for row in listed["returns"]}

    # Austritt: automatisch, einmal; ohne Geräte keine
    notebook.position_id = place.id
    db.commit()
    assert ensure_exit_return(db, OID, "Pia Beispiel") is True
    assert ensure_exit_return(db, OID, "Pia Beispiel") is False
    db.commit()
    auto = db.scalars(select(InventoryReturn).where(InventoryReturn.reason == "austritt")).one()
    assert auto.state == "offen"
    assert ensure_exit_return(db, "77777777-2222-3333-4444-555555555555", "Niemand") is False
