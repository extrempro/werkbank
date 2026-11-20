"""IT-Bestand: Stellen, Arbeitsplätze, Ausstattungsvorlagen, Nummernkreise, Personensuche."""

import re
from collections.abc import Iterator
from typing import Any, cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_m365_api import ORIGIN, client_for
from werkbank.core.models import AuditLog
from werkbank.modules.inventory.models import (
    InventoryCity,
    InventoryDepartment,
    InventoryFloor,
    InventoryHardware,
    InventoryKind,
    InventoryKit,
    InventoryPosition,
    InventoryRoom,
    InventorySection,
    InventorySite,
    InventoryWorkplace,
)
from werkbank.modules.inventory.people import (
    PeopleError,
    Person,
    get_people_finder,
    parse_people,
    search_term,
)
from werkbank.modules.inventory.staff import format_number

BASE = "/api/inventory"
HEADERS = {"Origin": ORIGIN}
OID = "11111111-2222-3333-4444-555555555555"
OID_2 = "66666666-7777-8888-9999-000000000000"


@pytest.fixture
def db(db_session: Session) -> Iterator[Session]:
    def clean() -> None:
        db_session.execute(delete(InventoryHardware))
        for model in (
            InventoryWorkplace,
            InventoryPosition,
            InventoryKit,
            InventoryDepartment,
            InventoryRoom,
            InventoryFloor,
            InventorySection,
            InventorySite,
            InventoryCity,
        ):
            db_session.execute(delete(model))
        db_session.execute(delete(InventoryKind).where(InventoryKind.name.like("Test%")))
        db_session.commit()

    clean()
    yield db_session
    db_session.rollback()
    clean()


def overrides(client: TestClient) -> dict[Any, Any]:
    return cast(FastAPI, client.app).dependency_overrides


def kind_id(client: Any, name: str) -> int:
    kinds = client.get(f"{BASE}/master-data").json()["kinds"]
    return int(next(kind["id"] for kind in kinds if kind["name"] == name))


def device(client: Any, kind: str, name: str, **extra: Any) -> dict[str, Any]:
    response = client.post(
        f"{BASE}/hardware",
        json={"kind_id": kind_id(client, kind), "name": name, **extra},
        headers=HEADERS,
    )
    assert response.status_code == 201, response.text
    return dict(response.json())


# --- ohne Datenbank -------------------------------------------------------------------


def test_search_term_and_people_parsing() -> None:
    assert search_term('  Alex "Beispiel"\\ ') == "Alex Beispiel"
    assert len(search_term("x" * 200)) == 60
    people = parse_people(
        [
            {
                "id": OID.upper(),
                "displayName": " Alex Beispiel ",
                "userPrincipalName": "alex@example.com",
                "accountEnabled": False,
            },
            {"id": "keine-id", "displayName": "Falsch"},
            {"displayName": "ohne id"},
        ]
    )
    assert people == [
        Person(
            oid=OID,
            name="Alex Beispiel",
            upn="alex@example.com",
            department="",
            job_title="",
            enabled=False,
        )
    ]
    assert format_number("ST-", 7) == "ST-007"
    assert format_number("AP", 1234) == "AP1234"


# --- mit Datenbank --------------------------------------------------------------------


@pytest.mark.db
def test_people_search_needs_editor_and_reports_errors(db: Session) -> None:
    reader = client_for(["Bestand.Reader"], "stellen-leser")
    assert reader.get(f"{BASE}/people", params={"q": "alex"}).status_code == 403

    editor = client_for(["Bestand.Editor"], "stellen-suche")
    seen: list[str] = []

    def finder(query: str) -> list[Person]:
        seen.append(query)
        return [Person(OID, "Alex Beispiel", "alex@example.com", "Einkauf", "", True)]

    overrides(editor)[get_people_finder] = lambda: finder
    hits = editor.get(f"{BASE}/people", params={"q": "alex"}).json()
    assert hits[0]["oid"] == OID and hits[0]["department"] == "Einkauf"
    assert seen == ["alex"]
    assert editor.get(f"{BASE}/people", params={"q": "a"}).status_code == 422

    def broken(query: str) -> list[Person]:
        raise PeopleError("Die Verbindung zu Entra ist nicht eingerichtet.")

    overrides(editor)[get_people_finder] = lambda: broken
    failed = editor.get(f"{BASE}/people", params={"q": "alex"})
    assert failed.status_code == 503
    assert "nicht eingerichtet" in failed.json()["detail"]


@pytest.mark.db
def test_positions_numbers_and_people(db: Session) -> None:
    editor = client_for(["Bestand.Editor"], "stellen-pflege")
    reader = client_for(["Bestand.Reader"], "stellen-lesen")
    master = editor.post(f"{BASE}/departments", json={"name": "Einkauf"}, headers=HEADERS).json()
    department = master["departments"][0]
    assert department["used"] == 0

    ranges = editor.put(
        f"{BASE}/number-ranges/stelle", json={"prefix": "TST-"}, headers=HEADERS
    ).json()
    assert next(entry for entry in ranges if entry["key"] == "stelle")["prefix"] == "TST-"
    for bad in ("", "a b", "x" * 11, "-ST", "ST<"):
        assert (
            editor.put(
                f"{BASE}/number-ranges/stelle", json={"prefix": bad}, headers=HEADERS
            ).status_code
            == 422
        ), bad
    assert (
        reader.put(
            f"{BASE}/number-ranges/stelle", json={"prefix": "X"}, headers=HEADERS
        ).status_code
        == 403
    )

    body = {
        "name": "Sachbearbeitung Einkauf",
        "department_id": department["id"],
        "person": {"oid": OID, "name": "Alex Beispiel", "upn": "alex@example.com"},
    }
    created = editor.post(f"{BASE}/positions", json=body, headers=HEADERS)
    assert created.status_code == 201, created.text
    position = created.json()
    assert re.fullmatch(r"TST-\d{3,}", position["number"])
    assert position["person"]["name"] == "Alex Beispiel"
    assert position["department"] == "Einkauf"
    assert [event["text"] for event in position["events"]][::-1] == [
        "Stelle angelegt",
        "Besetzt durch Alex Beispiel",
    ]
    second = editor.post(f"{BASE}/positions", json={"name": "Zweite"}, headers=HEADERS).json()
    assert second["number"] != position["number"]
    assert second["person"] is None

    for invalid in (
        {"name": " "},
        {"name": "a\nb"},
        {"name": "X", "department_id": 999999},
        {"name": "X", "person": {"oid": "keine-oid", "name": "A"}},
        {"name": "X", "person": {"oid": OID, "name": " "}},
    ):
        response = editor.post(f"{BASE}/positions", json=invalid, headers=HEADERS)
        assert response.status_code == 422, invalid
    assert reader.post(f"{BASE}/positions", json={"name": "X"}, headers=HEADERS).status_code == 403

    url = f"{BASE}/positions/{position['id']}"
    changed = editor.put(
        url,
        json={**body, "person": {"oid": OID_2, "name": "Kim Muster", "upn": "kim@example.com"}},
        headers=HEADERS,
    ).json()
    assert changed["person"]["oid"] == OID_2
    assert "Besetzung: Alex Beispiel → Kim Muster" in changed["events"][0]["text"]
    vacant = editor.put(url, json={**body, "person": None}, headers=HEADERS).json()
    assert vacant["person"] is None
    assert reader.get(url).json()["number"] == position["number"]
    listed = reader.get(f"{BASE}/positions").json()
    assert {entry["id"] for entry in listed} == {position["id"], second["id"]}

    # Audit ohne Namen der Personen
    details = db.scalars(
        select(AuditLog.details).where(AuditLog.action == "bestand.stelle_geaendert")
    ).all()
    assert details and all("Kim" not in str(entry) for entry in details)

    # Abteilung in Gebrauch: nicht löschbar
    assert (
        editor.delete(f"{BASE}/departments/{department['id']}", headers=HEADERS).status_code == 409
    )

    # Stelle mit Hardware: nicht löschbar
    notebook = device(editor, "Notebook", "Notebook 14", position_id=position["id"])
    assert notebook["holder"] == f"{position['number']} Sachbearbeitung Einkauf"
    assert notebook["holder_ref"] == {
        "kind": "stelle",
        "id": position["id"],
        "label": notebook["holder"],
    }
    assert editor.delete(url, headers=HEADERS).status_code == 409
    assert reader.get(url).json()["hardware"] == 1
    assert editor.delete(f"{BASE}/positions/{second['id']}", headers=HEADERS).status_code == 200

    # Suche findet Stellen
    hits = reader.get("/api/search", params={"q": "sachbearbeitung"}).json()["hits"]
    assert any(hit["kind"] == "Stelle" for hit in hits)


@pytest.mark.db
def test_workplaces_kits_and_equipment(db: Session) -> None:
    editor = client_for(["Bestand.Editor"], "plaetze-pflege")
    city = editor.post(f"{BASE}/cities", json={"name": "Musterstadt"}, headers=HEADERS).json()
    city_id = city["cities"][0]["id"]
    site = editor.post(
        f"{BASE}/sites", json={"name": "Haus Nord", "city_id": city_id}, headers=HEADERS
    ).json()
    site_id = site["cities"][0]["sites"][0]["id"]
    section = editor.post(
        f"{BASE}/sections", json={"name": "Bauteil A", "site_id": site_id}, headers=HEADERS
    ).json()
    section_id = section["cities"][0]["sites"][0]["sections"][0]["id"]
    floor = editor.post(
        f"{BASE}/floors",
        json={"name": "EG", "section_id": section_id, "position": 0},
        headers=HEADERS,
    ).json()
    room = editor.post(
        f"{BASE}/floors/{floor['id']}/rooms",
        json={"name": "0.12", "x": 10, "y": 10, "w": 20, "h": 20},
        headers=HEADERS,
    ).json()["rooms"][0]

    monitor_kind = kind_id(editor, "Monitor")
    notebook_kind = kind_id(editor, "Notebook")
    pc_kind = kind_id(editor, "PC")
    master = editor.post(
        f"{BASE}/kits",
        json={
            "name": "Büro Standard",
            "rows": [
                {"label": "Rechner", "count": 1, "kind_ids": [notebook_kind, pc_kind]},
                {"label": "Monitor", "count": 2, "kind_ids": [monitor_kind]},
            ],
        },
        headers=HEADERS,
    ).json()
    kit = master["kits"][0]
    assert kit["rows"][1] == {"label": "Monitor", "count": 2, "kind_ids": [monitor_kind]}
    for bad in (
        {"name": "Leer", "rows": []},
        {"name": "X", "rows": [{"label": "A", "count": 0, "kind_ids": [monitor_kind]}]},
        {"name": "X", "rows": [{"label": "A", "count": 1, "kind_ids": []}]},
        {"name": "X", "rows": [{"label": "A", "count": 1, "kind_ids": [999999]}]},
    ):
        assert editor.post(f"{BASE}/kits", json=bad, headers=HEADERS).status_code == 422, bad

    alex = editor.post(f"{BASE}/positions", json={"name": "Stelle A"}, headers=HEADERS).json()
    kim = editor.post(f"{BASE}/positions", json={"name": "Stelle B"}, headers=HEADERS).json()

    # Einzelarbeitsplatz mit zwei Stellen: abgelehnt
    too_many = editor.post(
        f"{BASE}/workplaces",
        json={"room_id": room["id"], "position_ids": [alex["id"], kim["id"]]},
        headers=HEADERS,
    )
    assert too_many.status_code == 422

    created = editor.post(
        f"{BASE}/workplaces",
        json={
            "name": "Fenster",
            "room_id": room["id"],
            "kit_id": kit["id"],
            "position_ids": [alex["id"]],
        },
        headers=HEADERS,
    )
    assert created.status_code == 201, created.text
    workplace = created.json()
    assert workplace["place"] == "0.12 · Haus Nord, EG"
    assert workplace["location"]["room_id"] == room["id"]
    assert workplace["equipment"]["missing"] == 3
    assert workplace["complete"] is False

    # Hardware am Platz und an der Stelle zählt; jedes Gerät nur einmal
    device(editor, "Notebook", "Notebook A", position_id=alex["id"])
    device(editor, "Monitor", "Monitor 1", workplace_id=workplace["id"])
    url = f"{BASE}/workplaces/{workplace['id']}"
    check = editor.get(url).json()["equipment"]
    assert [(row["label"], row["have"], row["need"]) for row in check["rows"]] == [
        ("Rechner", 1, 1),
        ("Monitor", 1, 2),
    ]
    assert check["missing"] == 1
    device(editor, "Monitor", "Monitor 2", workplace_id=workplace["id"])
    done = editor.get(url).json()
    assert done["complete"] is True and done["equipment"]["missing"] == 0

    # Gerät an Stelle und Platz zugleich: abgelehnt
    both = editor.post(
        f"{BASE}/hardware",
        json={
            "kind_id": monitor_kind,
            "name": "Doppelt",
            "position_id": alex["id"],
            "workplace_id": workplace["id"],
        },
        headers=HEADERS,
    )
    assert both.status_code == 422

    # Geteilt mit zwei Stellen; der Verlauf beider Stellen vermerkt das
    shared = editor.put(
        url,
        json={
            "name": "Fenster",
            "room_id": room["id"],
            "shared": True,
            "kit_id": kit["id"],
            "position_ids": [alex["id"], kim["id"]],
        },
        headers=HEADERS,
    ).json()
    assert [entry["id"] for entry in shared["positions"]] == [alex["id"], kim["id"]]
    kim_view = editor.get(f"{BASE}/positions/{kim['id']}").json()
    assert kim_view["workplaces"] == 1
    assert kim_view["sites"] == "Haus Nord"
    assert kim_view["events"][0]["text"].startswith("Arbeitsplatz verknüpft:")

    assignees = editor.get(f"{BASE}/assignees").json()
    assert {entry["id"] for entry in assignees["workplaces"]} == {workplace["id"]}

    # Löschsperren: Vorlage und Raum in Gebrauch, Platz mit Hardware, Art in Vorlage
    assert editor.delete(f"{BASE}/kits/{kit['id']}", headers=HEADERS).status_code == 409
    assert editor.delete(f"{BASE}/rooms/{room['id']}", headers=HEADERS).status_code == 409
    assert editor.delete(url, headers=HEADERS).status_code == 409
    test_kind = editor.post(f"{BASE}/kinds", json={"name": "Test Kamera"}, headers=HEADERS).json()
    test_kind_id = next(
        entry["id"] for entry in test_kind["kinds"] if entry["name"] == "Test Kamera"
    )
    editor.put(
        f"{BASE}/kits/{kit['id']}",
        json={
            "name": "Büro Standard",
            "rows": [{"label": "Kamera", "count": 1, "kind_ids": [test_kind_id]}],
        },
        headers=HEADERS,
    )
    assert editor.delete(f"{BASE}/kinds/{test_kind_id}", headers=HEADERS).status_code == 409

    # Platz ohne Hardware lässt sich löschen
    empty = editor.post(f"{BASE}/workplaces", json={"position_ids": []}, headers=HEADERS).json()
    assert empty["complete"] is None
    gone = editor.delete(f"{BASE}/workplaces/{empty['id']}", headers=HEADERS)
    assert gone.status_code == 200
    assert {entry["id"] for entry in gone.json()} == {workplace["id"]}

    # Suche findet Arbeitsplätze
    hits = editor.get("/api/search", params={"q": workplace["number"]}).json()["hits"]
    assert any(
        hit["kind"] == "Arbeitsplatz" and hit["title"] == workplace["number"] for hit in hits
    )
