"""Suche für Auswahlfelder und Pflicht-Raum beim Anlegen eines Arbeitsplatzes."""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.inventory_rooms import room_for_tests
from tests.test_admin_settings import HEADERS
from tests.test_m365_api import client_for
from werkbank.config import Settings
from werkbank.main import create_app
from werkbank.modules.inventory.lookup import LOOKUP_MAX, fold, matches
from werkbank.modules.inventory.models import (
    InventoryHardware,
    InventoryKind,
    InventoryPosition,
    InventoryWorkplace,
)

BASE = "/api/inventory"
ORIGIN = "https://testserver"


def test_fold_and_matches() -> None:
    assert fold("Arbeitsplätze Straße") == "arbeitsplaetze strasse"
    assert matches(["st-0", "pia"], "ST-012 Einkauf", "Pia Beispiel")
    assert not matches(["st-0", "max"], "ST-012 Einkauf", "Pia Beispiel")
    assert matches([], "egal")


def test_lookup_requires_login() -> None:
    anonymous = TestClient(create_app(Settings(public_url=ORIGIN, environment="test")))
    assert anonymous.get(f"{BASE}/lookup", params={"kind": "position"}).status_code == 401


@pytest.fixture
def db(db_session: Session) -> Iterator[Session]:
    def clean() -> None:
        db_session.execute(delete(InventoryWorkplace))
        db_session.execute(delete(InventoryHardware).where(InventoryHardware.name.like("Such%")))
        db_session.execute(delete(InventoryPosition).where(InventoryPosition.name.like("Such%")))
        db_session.commit()

    clean()
    yield db_session
    clean()


def hits(client: TestClient, kind: str, q: str = "", **extra: object) -> Any:
    response = client.get(f"{BASE}/lookup", params={"kind": kind, "q": q, **extra})
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.db
def test_lookup_finds_positions_workplaces_rooms_and_devices(db: Session) -> None:
    editor = client_for(["Bestand.Editor"], "lookup-bearbeiter")
    reader = client_for(["Bestand.Reader"], "lookup-leser")
    other = client_for(["Budget.Reader"], "lookup-fremd")
    assert other.get(f"{BASE}/lookup", params={"kind": "room"}).status_code == 403
    assert reader.get(f"{BASE}/lookup", params={"kind": "unbekannt"}).status_code == 422
    assert reader.get(f"{BASE}/lookup", params={"kind": "room", "q": "x" * 101}).status_code == 422
    too_many = reader.get(f"{BASE}/lookup", params={"kind": "room", "limit": LOOKUP_MAX + 1})
    assert too_many.status_code == 422

    for index in range(25):
        db.add(InventoryPosition(number=f"SU-{index:03}", name=f"Suchstelle {index}"))
    db.add(
        InventoryPosition(
            number="SU-900",
            name="Suchstelle Einkauf",
            person_oid="00000000-0000-0000-0000-000000000099",
            person_name="Pia Beispiel",
        )
    )
    db.commit()
    page = hits(reader, "position", "suchstelle")
    assert page["total"] == 26
    assert len(page["items"]) == LOOKUP_MAX
    found = hits(reader, "position", "pia")
    assert [(item["label"], item["detail"]) for item in found["items"]] == [
        ("SU-900 Suchstelle Einkauf", "Pia Beispiel")
    ]

    room = room_for_tests(db, "S.17")
    rooms = hits(reader, "room", "s.17")
    assert [item["id"] for item in rooms["items"]] == [room]
    assert "EG" in rooms["items"][0]["detail"]

    position = db.scalar(select(InventoryPosition).where(InventoryPosition.number == "SU-900"))
    assert position is not None
    workplace = editor.post(
        f"{BASE}/workplaces",
        json={"room_id": room, "position_ids": [position.id]},
        headers=HEADERS,
    ).json()
    by_person = hits(reader, "workplace", "pia beispiel")
    assert [item["id"] for item in by_person["items"]] == [workplace["id"]]
    assert hits(reader, "workplace", "s.17")["total"] == 1

    notebook = db.scalar(select(InventoryKind.id).where(InventoryKind.name == "Notebook"))
    monitor = db.scalar(select(InventoryKind.id).where(InventoryKind.name == "Monitor"))
    assert notebook is not None and monitor is not None
    db.add(InventoryHardware(kind_id=notebook, name="Such-Notebook", serial="SN-LOOK-1"))
    db.add(InventoryHardware(kind_id=monitor, name="Such-Monitor", serial="SN-LOOK-2"))
    db.add(
        InventoryHardware(
            kind_id=notebook, name="Such-Alt", serial="SN-LOOK-3", status="ausgemustert"
        )
    )
    db.commit()
    devices = hits(reader, "hardware", "sn-look")
    assert {item["label"] for item in devices["items"]} == {"Such-Notebook", "Such-Monitor"}
    computers = hits(reader, "hardware", "sn-look", computers="true")
    assert [item["label"] for item in computers["items"]] == ["Such-Notebook"]


@pytest.mark.db
def test_new_workplace_needs_room_and_takes_spot(db: Session) -> None:
    editor = client_for(["Bestand.Editor"], "lookup-bearbeiter")
    missing = editor.post(f"{BASE}/workplaces", json={"position_ids": []}, headers=HEADERS)
    assert missing.status_code == 422
    room = room_for_tests(db, "S.18")
    half = editor.post(f"{BASE}/workplaces", json={"room_id": room, "spot_x": 10}, headers=HEADERS)
    assert half.status_code == 422
    created = editor.post(
        f"{BASE}/workplaces",
        json={"room_id": room, "spot_x": 25.555, "spot_y": 40},
        headers=HEADERS,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert (body["spot_x"], body["spot_y"]) == (25.56, 40)
    # Beim Bearbeiten darf der Raum (noch) fehlen: bestehende Plätze ohne Raum bleiben gültig.
    edited = editor.put(
        f"{BASE}/workplaces/{body['id']}",
        json={"room_id": None, "position_ids": []},
        headers=HEADERS,
    )
    assert edited.status_code == 200, edited.text
