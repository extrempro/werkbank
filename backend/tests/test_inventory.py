"""IT-Bestand: Rechte, Hardware, Inventurnummer, Ausmustern, Stammdaten und Suche."""

import struct
from collections.abc import Iterator
from datetime import date, timedelta
from typing import Any

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_m365_api import ORIGIN, client_for
from werkbank.core.branding import PNG_SIGNATURE, ImageError
from werkbank.core.models import AuditLog
from werkbank.modules.inventory.api import single_line
from werkbank.modules.inventory.models import (
    InventoryCity,
    InventoryDepartment,
    InventoryFloor,
    InventoryHardware,
    InventoryKind,
    InventoryKit,
    InventoryMaker,
    InventoryPosition,
    InventoryRoom,
    InventorySection,
    InventorySite,
    InventoryWorkplace,
)
from werkbank.modules.inventory.plans import inspect_plan, jpeg_size
from werkbank.modules.inventory.search import escape_like

BASE = "/api/inventory"
HEADERS = {"Origin": ORIGIN}


@pytest.fixture
def db(db_session: Session) -> Iterator[Session]:
    def clean() -> None:
        db_session.execute(delete(InventoryHardware))
        for staff in (InventoryWorkplace, InventoryPosition, InventoryKit, InventoryDepartment):
            db_session.execute(delete(staff))
        for model in (
            InventoryRoom,
            InventoryFloor,
            InventorySection,
            InventorySite,
            InventoryCity,
        ):
            db_session.execute(delete(model))
        db_session.execute(delete(InventoryMaker))
        # Die Arten und Gründe aus der Migration bleiben, eigene kommen weg.
        db_session.execute(delete(InventoryKind).where(InventoryKind.name.like("Test%")))
        db_session.commit()

    clean()
    yield db_session
    db_session.rollback()
    clean()


def kind_id(client: Any, name: str) -> int:
    kinds = client.get(f"{BASE}/master-data").json()["kinds"]
    return int(next(kind["id"] for kind in kinds if kind["name"] == name))


def reason_id(client: Any, name: str = "defekt") -> int:
    reasons = client.get(f"{BASE}/master-data").json()["reasons"]
    return int(next(reason["id"] for reason in reasons if reason["name"] == name))


def hardware_body(client: Any, **extra: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "kind_id": kind_id(client, "Monitor"),
        "name": "Monitor 27 Zoll",
        "serial": "SN-TEST-0001",
        "hostname": "",
        "note": "",
    }
    body.update(extra)
    return body


# --- ohne Datenbank -------------------------------------------------------------------


def test_single_line_rejects_line_breaks() -> None:
    assert single_line("  Monitor  ") == "Monitor"
    for bad in ("a\nb", "a\rb", "a\tb", "a\x00b", "a\x7fb"):
        with pytest.raises(ValueError):
            single_line(bad)


def test_escape_like_treats_wildcards_as_text() -> None:
    assert escape_like("50%_a\\b") == "50\\%\\_a\\\\b"


def png(width: int, height: int) -> bytes:
    """Kopf einer PNG-Datei; für die Prüfung reicht der IHDR-Block."""
    header = b"\x00\x00\x00\rIHDR" + struct.pack(">II", width, height) + b"\x08\x02\x00\x00\x00"
    return PNG_SIGNATURE + header + b"\x00" * 16


def jpeg(width: int, height: int) -> bytes:
    app0 = b"\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof = b"\xff\xc0\x00\x11\x08" + struct.pack(">HH", height, width) + b"\x03" + b"\x00" * 9
    return b"\xff\xd8" + app0 + sof + b"\xff\xd9"


def test_plan_images_are_checked_by_content() -> None:
    assert inspect_plan(png(800, 600)).content_type == "image/png"
    info = inspect_plan(jpeg(1200, 900))
    assert (info.content_type, info.width, info.height) == ("image/jpeg", 1200, 900)
    assert jpeg_size(b"\xff\xd8\xff\xd9") is None
    for bad in (b"<svg xmlns='http://www.w3.org/2000/svg'/>", b"GIF89a....", b"", png(10, 10)):
        with pytest.raises(ImageError):
            inspect_plan(bad)
    with pytest.raises(ImageError):
        inspect_plan(png(20000, 100))


# --- mit Datenbank --------------------------------------------------------------------


@pytest.mark.db
def test_inventory_needs_its_roles(db: Session) -> None:
    stranger = client_for(["Projekte.Editor"], "bestand-fremd")
    assert stranger.get(f"{BASE}/hardware").status_code == 403
    assert stranger.get(f"{BASE}/master-data").status_code == 403

    reader = client_for(["Bestand.Reader"], "bestand-leser")
    assert reader.get(f"{BASE}/hardware").json() == []
    kinds = {kind["name"]: kind for kind in reader.get(f"{BASE}/master-data").json()["kinds"]}
    assert kinds["Notebook"]["has_storage"] is True
    assert kinds["Monitor"]["has_storage"] is False
    assert (
        reader.post(f"{BASE}/hardware", json=hardware_body(reader), headers=HEADERS).status_code
        == 403
    )
    assert reader.post(f"{BASE}/makers", json={"name": "X"}, headers=HEADERS).status_code == 403

    editor = client_for(["Bestand.Editor"], "bestand-bearbeiter")
    created = editor.post(f"{BASE}/hardware", json=hardware_body(editor), headers=HEADERS)
    assert created.status_code == 201, created.text
    device = created.json()
    url = f"{BASE}/hardware/{device['id']}"
    assert reader.get(url).json()["name"] == "Monitor 27 Zoll"
    assert reader.put(url, json=hardware_body(reader), headers=HEADERS).status_code == 403
    assert (
        reader.put(f"{url}/inventory-no", json={"inventory_no": "X"}, headers=HEADERS).status_code
        == 403
    )
    assert reader.post(f"{url}/reactivate", headers=HEADERS).status_code == 403
    assert reader.get(f"{BASE}/hardware/999999").status_code == 404


@pytest.mark.db
def test_hardware_create_edit_and_history(db: Session) -> None:
    editor = client_for(["Bestand.Editor"], "bestand-pflege")
    master = editor.post(f"{BASE}/makers", json={"name": "Hersteller A"}, headers=HEADERS).json()
    maker = next(entry for entry in master["makers"] if entry["name"] == "Hersteller A")
    master = editor.post(
        f"{BASE}/makers/{maker['id']}/models", json={"name": "Monitor 27 QHD"}, headers=HEADERS
    ).json()
    model_id = next(entry for entry in master["makers"] if entry["name"] == "Hersteller A")[
        "models"
    ][0]["id"]

    created = editor.post(
        f"{BASE}/hardware",
        json=hardware_body(editor, model_id=model_id, inventory_no="INV-0001"),
        headers=HEADERS,
    ).json()
    assert (created["maker"], created["model"]) == ("Hersteller A", "Monitor 27 QHD")
    assert created["inventory_no"] == "INV-0001"
    assert created["source"] == "manuell"
    assert {event["text"] for event in created["events"]} == {
        "Inventurnummer gesetzt: INV-0001",
        "Von Hand erfasst",
    }

    # Gleiche Seriennummer oder Inventurnummer ein zweites Mal: abgelehnt.
    twin = editor.post(
        f"{BASE}/hardware", json=hardware_body(editor, serial="sn-test-0001"), headers=HEADERS
    )
    assert twin.status_code == 409
    twin = editor.post(
        f"{BASE}/hardware",
        json=hardware_body(editor, serial="SN-2", inventory_no="INV-0001"),
        headers=HEADERS,
    )
    assert twin.status_code == 409
    for bad in (
        hardware_body(editor, name="  "),
        hardware_body(editor, name="a\nb"),
        hardware_body(editor, kind_id=999999),
        hardware_body(editor, model_id=999999),
        hardware_body(editor, serial="x" * 81),
    ):
        assert editor.post(f"{BASE}/hardware", json=bad, headers=HEADERS).status_code in (
            404,
            422,
        ), bad

    url = f"{BASE}/hardware/{created['id']}"
    changed = editor.put(
        url,
        json=hardware_body(editor, name="Monitor Empfang", model_id=model_id, note="am Empfang"),
        headers=HEADERS,
    ).json()
    assert changed["name"] == "Monitor Empfang"
    assert changed["events"][0]["text"].startswith("Geändert: Bezeichnung: Monitor 27 Zoll")
    assert changed["events"][0]["who"] == "Rita Reviewer"
    # Ohne Änderung kein neuer Eintrag
    again = editor.put(
        url,
        json=hardware_body(editor, name="Monitor Empfang", model_id=model_id, note="am Empfang"),
        headers=HEADERS,
    ).json()
    assert len(again["events"]) == len(changed["events"])

    # Inventurnummer ändern und entfernen
    changed = editor.put(
        f"{url}/inventory-no", json={"inventory_no": "INV-0002"}, headers=HEADERS
    ).json()
    assert changed["inventory_no"] == "INV-0002"
    assert changed["events"][0]["text"] == "Inventurnummer geändert: INV-0001 → INV-0002"
    removed = editor.put(f"{url}/inventory-no", json={"inventory_no": "  "}, headers=HEADERS).json()
    assert removed["inventory_no"] is None
    assert removed["events"][0]["text"] == "Inventurnummer entfernt (vorher INV-0002)"

    # Stammdaten in Gebrauch lassen sich nicht löschen.
    assert editor.delete(f"{BASE}/models/{model_id}", headers=HEADERS).status_code == 409
    assert editor.delete(f"{BASE}/makers/{maker['id']}", headers=HEADERS).status_code == 409
    kind = kind_id(editor, "Monitor")
    assert editor.delete(f"{BASE}/kinds/{kind}", headers=HEADERS).status_code == 409

    db.expire_all()
    actions = set(db.scalars(select(AuditLog.action).where(AuditLog.module == "bestand")).all())
    assert {
        "bestand.geraet_angelegt",
        "bestand.geraet_geaendert",
        "bestand.inventurnummer",
        "bestand.hersteller_angelegt",
        "bestand.modell_angelegt",
    } <= actions


@pytest.mark.db
def test_retire_and_reactivate(db: Session) -> None:
    editor = client_for(["Bestand.Editor"], "bestand-ausmustern")
    notebook = editor.post(
        f"{BASE}/hardware",
        json=hardware_body(editor, kind_id=kind_id(editor, "Notebook"), name="Notebook 14 Zoll"),
        headers=HEADERS,
    ).json()
    url = f"{BASE}/hardware/{notebook['id']}"
    retire = {
        "reason_id": reason_id(editor),
        "whereabouts": "entsorgt",
        "retired_on": date.today().isoformat(),
        "wiped": False,
        "note": "Nachweis 4711",
    }
    # Notebooks haben einen Datenträger: Löschen muss bestätigt sein.
    refused = editor.post(f"{url}/retire", json=retire, headers=HEADERS)
    assert refused.status_code == 422
    assert "Datenträger" in refused.json()["detail"]
    future = {**retire, "wiped": True, "retired_on": (date.today() + timedelta(days=3)).isoformat()}
    assert editor.post(f"{url}/retire", json=future, headers=HEADERS).status_code == 422
    unknown = {**retire, "wiped": True, "whereabouts": "verschenkt"}
    assert editor.post(f"{url}/retire", json=unknown, headers=HEADERS).status_code == 422

    done = editor.post(f"{url}/retire", json={**retire, "wiped": True}, headers=HEADERS)
    assert done.status_code == 200, done.text
    device = done.json()
    assert device["status"] == "ausgemustert"
    assert device["retire"]["reason"] == "defekt"
    assert device["retire"]["whereabouts"] == "entsorgt"
    assert device["retire"]["wiped"] is True
    assert "Datenträger gelöscht oder vernichtet" in device["events"][0]["text"]
    assert "Nachweis 4711" in device["events"][0]["text"]
    again = editor.post(f"{url}/retire", json={**retire, "wiped": True}, headers=HEADERS)
    assert again.status_code == 409

    # Aus der normalen Liste verschwunden, unter „ausgemustert“ zu finden
    assert editor.get(f"{BASE}/hardware").json() == []
    retired = editor.get(f"{BASE}/hardware?state=ausgemustert").json()
    assert [entry["id"] for entry in retired] == [notebook["id"]]
    assert len(editor.get(f"{BASE}/hardware?state=alle").json()) == 1
    assert editor.get(f"{BASE}/hardware?state=kaputt").status_code == 422

    # Grund in Gebrauch lässt sich nicht löschen.
    assert editor.delete(f"{BASE}/reasons/{reason_id(editor)}", headers=HEADERS).status_code == 409

    back = editor.post(f"{url}/reactivate", headers=HEADERS).json()
    assert back["status"] == "aktiv"
    assert back["retire"] is None
    assert back["events"][0]["text"] == "Wieder in Betrieb genommen"
    assert editor.post(f"{url}/reactivate", headers=HEADERS).status_code == 409

    # Geräte ohne Datenträger brauchen keine Bestätigung.
    monitor = editor.post(
        f"{BASE}/hardware", json=hardware_body(editor, serial="SN-MON"), headers=HEADERS
    ).json()
    plain = editor.post(
        f"{BASE}/hardware/{monitor['id']}/retire",
        json={**retire, "whereabouts": "abgegeben"},
        headers=HEADERS,
    ).json()
    assert plain["retire"]["wiped"] is None


@pytest.mark.db
def test_master_data_crud(db: Session) -> None:
    editor = client_for(["Bestand.Editor"], "bestand-stammdaten")
    master = editor.post(
        f"{BASE}/kinds", json={"name": "Test-Scanner", "has_storage": False}, headers=HEADERS
    ).json()
    kind = next(entry for entry in master["kinds"] if entry["name"] == "Test-Scanner")
    assert kind["used"] == 0
    assert (
        editor.post(f"{BASE}/kinds", json={"name": "test-scanner"}, headers=HEADERS).status_code
        == 409
    )
    master = editor.put(
        f"{BASE}/kinds/{kind['id']}",
        json={"name": "Test-Scanner A4", "has_storage": True},
        headers=HEADERS,
    ).json()
    assert any(
        entry["name"] == "Test-Scanner A4" and entry["has_storage"] for entry in master["kinds"]
    )
    master = editor.delete(f"{BASE}/kinds/{kind['id']}", headers=HEADERS).json()
    assert all(entry["id"] != kind["id"] for entry in master["kinds"])

    master = editor.post(f"{BASE}/makers", json={"name": "Hersteller B"}, headers=HEADERS).json()
    maker = next(entry for entry in master["makers"] if entry["name"] == "Hersteller B")
    url = f"{BASE}/makers/{maker['id']}/models"
    editor.post(url, json={"name": "Dock 90 W"}, headers=HEADERS)
    assert editor.post(url, json={"name": "dock 90 w"}, headers=HEADERS).status_code == 409
    assert editor.post(url, json={"name": "a\nb"}, headers=HEADERS).status_code == 422
    master = editor.delete(f"{BASE}/makers/{maker['id']}", headers=HEADERS).json()
    assert all(entry["name"] != "Hersteller B" for entry in master["makers"])

    master = editor.post(f"{BASE}/reasons", json={"name": "Test-Grund"}, headers=HEADERS).json()
    reason = next(entry for entry in master["reasons"] if entry["name"] == "Test-Grund")
    master = editor.put(
        f"{BASE}/reasons/{reason['id']}", json={"name": "Test-Grund neu"}, headers=HEADERS
    ).json()
    assert any(entry["name"] == "Test-Grund neu" for entry in master["reasons"])
    editor.delete(f"{BASE}/reasons/{reason['id']}", headers=HEADERS)


@pytest.mark.db
def test_search_finds_hardware(db: Session) -> None:
    editor = client_for(["Bestand.Editor"], "bestand-suche")
    editor.post(
        f"{BASE}/hardware",
        json=hardware_body(editor, serial="CN0F3KDJ7781", inventory_no="INV-23-1107"),
        headers=HEADERS,
    )
    hits = editor.get("/api/search", params={"q": "inv-23-1107"}).json()["hits"]
    assert [hit["title"] for hit in hits if hit["module"] == "IT-Bestand"] == ["Monitor 27 Zoll"]
    assert all(
        hit["link"].startswith("/bestand/hardware/")
        for hit in hits
        if hit["module"] == "IT-Bestand"
    )
    # Platzhalter werden als Text gesucht
    hits = editor.get("/api/search", params={"q": "%%%"}).json()["hits"]
    assert all(hit["module"] != "IT-Bestand" for hit in hits)
    outsider = client_for(["Budget.Reader"], "bestand-suche-fremd")
    hits = outsider.get("/api/search", params={"q": "inv-23-1107"}).json()["hits"]
    assert all(hit["module"] != "IT-Bestand" for hit in hits)


def build_floor(editor: Any) -> int:
    """Stadt, Standort, Abschnitt und Etage anlegen; liefert die Kennung der Etage."""
    tree = editor.post(f"{BASE}/cities", json={"name": "Beispielstadt"}, headers=HEADERS).json()
    city = tree["cities"][0]["id"]
    tree = editor.post(
        f"{BASE}/sites", json={"name": "Verwaltung Nord", "city_id": city}, headers=HEADERS
    ).json()
    site = tree["cities"][0]["sites"][0]["id"]
    tree = editor.post(
        f"{BASE}/sections", json={"name": "Abschnitt A", "site_id": site}, headers=HEADERS
    ).json()
    section = tree["cities"][0]["sites"][0]["sections"][0]["id"]
    floor = editor.post(
        f"{BASE}/floors",
        json={"name": "1. Obergeschoss", "section_id": section, "position": 1},
        headers=HEADERS,
    )
    assert floor.status_code == 201, floor.text
    return int(floor.json()["id"])


@pytest.mark.db
def test_locations_rooms_and_plan(db: Session) -> None:
    editor = client_for(["Bestand.Editor"], "bestand-standorte")
    reader = client_for(["Bestand.Reader"], "bestand-standorte-leser")
    assert reader.post(f"{BASE}/cities", json={"name": "X"}, headers=HEADERS).status_code == 403
    floor_id = build_floor(editor)
    assert (
        editor.post(f"{BASE}/cities", json={"name": "beispielstadt"}, headers=HEADERS).status_code
        == 409
    )

    url = f"{BASE}/floors/{floor_id}"
    room = {"name": "1.12 Büro", "x": 10, "y": 12, "w": 20, "h": 15}
    floor = editor.post(f"{url}/rooms", json=room, headers=HEADERS).json()
    assert [entry["name"] for entry in floor["rooms"]] == ["1.12 Büro"]
    assert floor["city"] == "Beispielstadt"
    room_id = floor["rooms"][0]["id"]
    assert editor.post(f"{url}/rooms", json=room, headers=HEADERS).status_code == 409
    for bad in (
        {**room, "name": "Rand", "x": 90, "w": 20},
        {**room, "name": "Klein", "w": 0.5},
        {**room, "name": "Minus", "y": -1},
    ):
        assert editor.post(f"{url}/rooms", json=bad, headers=HEADERS).status_code == 422, bad
    moved = editor.put(
        f"{BASE}/rooms/{room_id}",
        json={**room, "x": 30.123, "name": "1.12 Büro Nord"},
        headers=HEADERS,
    ).json()
    assert moved["rooms"][0]["x"] == 30.12

    # Grundriss: nur echte Bilder, abrufbar nur mit Rolle
    refused = editor.put(
        f"{url}/plan", content=b"<svg/>", headers={**HEADERS, "Content-Type": "image/svg+xml"}
    )
    assert refused.status_code == 422
    uploaded = editor.put(
        f"{url}/plan", content=png(800, 600), headers={**HEADERS, "Content-Type": "image/png"}
    )
    assert uploaded.status_code == 200, uploaded.text
    plan = uploaded.json()["plan"]
    assert (plan["width"], plan["height"]) == (800, 600)
    image = reader.get(plan["url"])
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in image.headers["content-security-policy"]
    assert image.headers["cache-control"] == "no-store"
    outsider = client_for(["Budget.Reader"], "bestand-standorte-fremd")
    assert outsider.get(plan["url"]).status_code == 403
    tree = reader.get(f"{BASE}/locations").json()
    floor_brief = tree["cities"][0]["sites"][0]["sections"][0]["floors"][0]
    assert floor_brief["has_plan"] is True
    assert floor_brief["rooms"] == [{"id": room_id, "name": "1.12 Büro Nord"}]

    # Gerät in den Raum stellen: Standort am Gerät, im Verlauf und in der Liste
    device = editor.post(
        f"{BASE}/hardware", json=hardware_body(editor, room_id=room_id), headers=HEADERS
    ).json()
    assert device["location"]["room"] == "1.12 Büro Nord"
    assert device["location"]["floor_id"] == floor_id
    assert any(event["text"].startswith("Standort: Raum 1.12") for event in device["events"])
    listed = reader.get(f"{BASE}/hardware").json()[0]
    assert listed["place"] == "1.12 Büro Nord · Verwaltung Nord, 1. Obergeschoss"
    assert reader.get(url).json()["rooms"][0]["hardware"] == 1
    bad_room = hardware_body(editor, serial="SN-X", room_id=999999)
    assert editor.post(f"{BASE}/hardware", json=bad_room, headers=HEADERS).status_code == 422

    # Belegtes lässt sich nicht löschen.
    assert editor.delete(f"{BASE}/rooms/{room_id}", headers=HEADERS).status_code == 409
    assert editor.delete(url, headers=HEADERS).status_code == 409
    city_id = tree["cities"][0]["id"]
    assert editor.delete(f"{BASE}/cities/{city_id}", headers=HEADERS).status_code == 409

    # Raum gefunden über die Suche
    hits = reader.get("/api/search", params={"q": "1.12 büro"}).json()["hits"]
    links = [hit["link"] for hit in hits if hit["kind"] == "Raum"]
    assert links == [f"/bestand/standorte/etage/{floor_id}/raum/{room_id}"]

    # Gerät raus, dann Raum, Grundriss und Etage löschbar
    editor.put(
        f"{BASE}/hardware/{device['id']}",
        json=hardware_body(editor, room_id=None),
        headers=HEADERS,
    )
    assert editor.delete(f"{BASE}/rooms/{room_id}", headers=HEADERS).status_code == 200
    without = editor.delete(f"{url}/plan", headers=HEADERS).json()
    assert without["plan"] is None
    assert editor.delete(url, headers=HEADERS).status_code == 200
