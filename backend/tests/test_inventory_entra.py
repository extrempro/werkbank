"""IT-Bestand: stündlicher Abgleich der Personen mit Entra und Vorgang „Person nicht mehr aktiv“."""

from collections.abc import Iterator
from datetime import timedelta
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_admin_settings import HEADERS
from tests.test_m365_api import client_for
from werkbank.modules.inventory.entra_sync import run_entra_sync
from werkbank.modules.inventory.loans import local_today
from werkbank.modules.inventory.models import (
    InventoryCase,
    InventoryEvent,
    InventoryHardware,
    InventoryKind,
    InventoryLoan,
    InventoryPersonState,
    InventoryPosition,
)
from werkbank.modules.inventory.people import PeopleError, Person, get_person_lookup

BASE = "/api/inventory"
OID = "aaaaaaaa-2222-3333-4444-555555555555"
NEXT = "bbbbbbbb-2222-3333-4444-555555555555"


def person(oid: str, name: str, upn: str, *, enabled: bool = True) -> Person:
    return Person(
        oid=oid,
        name=name,
        upn=upn,
        department="",
        job_title="",
        enabled=enabled,
        mail=upn,
    )


class FakeEntra:
    def __init__(self) -> None:
        self.people: dict[str, Person] = {
            OID: person(OID, "Pia Beispiel", "pia@example.com"),
            NEXT: person(NEXT, "Nils Nachfolge", "nils@example.com"),
        }
        self.down = False

    def __call__(self, oid: str) -> Person | None:
        if self.down:
            raise PeopleError("Microsoft Graph antwortet mit 503")
        return self.people.get(oid)


@pytest.fixture
def db(db_session: Session) -> Iterator[Session]:
    def clean() -> None:
        db_session.execute(delete(InventoryLoan))
        db_session.execute(delete(InventoryCase))
        db_session.execute(delete(InventoryHardware))
        db_session.execute(delete(InventoryPosition))
        db_session.execute(delete(InventoryPersonState))
        db_session.commit()

    clean()
    yield db_session
    db_session.rollback()
    clean()


def editor(entra: FakeEntra) -> TestClient:
    client = client_for(["Bestand.Editor"], "entra-bearbeiter")
    cast(FastAPI, client.app).dependency_overrides[get_person_lookup] = lambda: entra
    return client


def person_cases(db: Session) -> list[InventoryCase]:
    db.expire_all()
    return list(
        db.scalars(
            select(InventoryCase)
            .where(InventoryCase.kind == "person_inaktiv")
            .order_by(InventoryCase.id)
        ).all()
    )


@pytest.mark.db
def test_entra_sync(db: Session) -> None:
    entra = FakeEntra()
    client = editor(entra)
    holder = {"oid": OID, "name": "Pia Alt", "upn": "pia.alt@example.com"}
    first = client.post(
        f"{BASE}/positions", json={"name": "Sachbearbeitung", "person": holder}, headers=HEADERS
    ).json()
    second = client.post(
        f"{BASE}/positions", json={"name": "Vertretung", "person": holder}, headers=HEADERS
    ).json()
    kind_id = db.scalars(select(InventoryKind.id).where(InventoryKind.name == "Notebook")).one()
    device = InventoryHardware(kind_id=kind_id, name="Leih-Notebook", serial="EN-1")
    db.add(device)
    db.commit()
    loan = client.post(
        f"{BASE}/loans",
        json={
            "person": {"oid": OID},
            "due_on": (local_today() + timedelta(days=7)).isoformat(),
            "hardware_ids": [device.id],
        },
        headers=HEADERS,
    ).json()

    # Entra nicht erreichbar: nichts passiert
    entra.down = True
    assert run_entra_sync(db, entra) == (0, 0)
    entra.down = False

    # Aktiv: Name und Anmeldename werden nachgezogen (zwei Stellen; der Verleih stimmt schon)
    assert run_entra_sync(db, entra) == (2, 0)
    db.expire_all()
    stored = db.get(InventoryPosition, first["id"])
    assert stored is not None
    assert (stored.person_name, stored.person_upn) == ("Pia Beispiel", "pia@example.com")
    assert db.scalars(
        select(InventoryEvent).where(
            InventoryEvent.position_id == first["id"],
            InventoryEvent.text.like("Angaben aus Entra:%"),
        )
    ).first()
    assert run_entra_sync(db, entra) == (0, 0)

    # Deaktiviert: je Stelle und Verleih ein Vorgang, nur einmal
    entra.people[OID] = person(OID, "Pia Beispiel", "pia@example.com", enabled=False)
    assert run_entra_sync(db, entra) == (0, 3)
    assert run_entra_sync(db, entra) == (0, 0)
    cases = person_cases(db)
    assert {case.facts.get("position_id") for case in cases} == {first["id"], second["id"], None}
    assert all(case.facts["reason"] == "deaktiviert" for case in cases)
    loan_case = next(case for case in cases if case.facts.get("loan_id") == loan["id"])
    position_case = next(case for case in cases if case.facts.get("position_id") == first["id"])

    # Verleih: nur „geklärt“; Stelle: kein „geklärt“
    decide = f"{BASE}/cases/{loan_case.id}/decide"
    assert client.post(decide, json={"decision": "frei"}, headers=HEADERS).status_code == 422
    assert client.post(decide, json={"decision": "geklaert"}, headers=HEADERS).status_code == 200
    decide = f"{BASE}/cases/{position_case.id}/decide"
    assert client.post(decide, json={"decision": "geklaert"}, headers=HEADERS).status_code == 422
    assert (
        client.post(decide, json={"decision": "wieder_aktiv"}, headers=HEADERS).status_code == 422
    )
    assert client.post(decide, json={"decision": "lassen"}, headers=HEADERS).status_code == 200

    # Wieder aktiv: offene Vorgänge schließen sich selbst
    entra.people[OID] = person(OID, "Pia Beispiel", "pia@example.com")
    assert run_entra_sync(db, entra) == (0, 0)
    decisions = {case.facts.get("position_id"): case.decision for case in person_cases(db)}
    assert decisions == {first["id"]: "lassen", second["id"]: "wieder_aktiv", None: "geklaert"}

    # Gelöscht: neuer Zeitraum, neue Vorgänge
    del entra.people[OID]
    assert run_entra_sync(db, entra) == (0, 3)
    fresh = [case for case in person_cases(db) if case.status == "neu"]
    assert len(fresh) == 3 and all(case.facts["reason"] == "geloescht" for case in fresh)
    by_position = {case.facts.get("position_id"): case for case in fresh}

    # Stelle frei machen
    decided = client.post(
        f"{BASE}/cases/{by_position[first['id']].id}/decide",
        json={"decision": "frei"},
        headers=HEADERS,
    )
    assert decided.status_code == 200, decided.text
    assert client.get(f"{BASE}/positions/{first['id']}").json()["person"] is None

    # Neue Person eintragen: der Server liest sie aus Entra
    url = f"{BASE}/cases/{by_position[second['id']].id}/decide"
    assert client.post(url, json={"decision": "nachfolge"}, headers=HEADERS).status_code == 422
    unknown = {"decision": "nachfolge", "person_oid": "cccccccc-2222-3333-4444-555555555555"}
    assert client.post(url, json=unknown, headers=HEADERS).status_code == 422
    done = client.post(url, json={"decision": "nachfolge", "person_oid": NEXT}, headers=HEADERS)
    assert done.status_code == 200, done.text
    position = client.get(f"{BASE}/positions/{second['id']}").json()
    assert position["person"]["name"] == "Nils Nachfolge"

    # Rückgabe schließt den Vorgang zum Verleih
    client.post(
        f"{BASE}/loans/{loan['id']}/return", json={"hardware_ids": [device.id]}, headers=HEADERS
    )
    assert by_position[None].id in {
        case.id for case in person_cases(db) if case.decision == "zurueck"
    }
