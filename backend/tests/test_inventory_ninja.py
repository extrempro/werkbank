"""IT-Bestand: Abgleich mit NinjaOne, Vorgänge und Anbindung in der Verwaltung."""

from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.inventory_rooms import room_for_tests
from tests.test_admin_settings import HEADERS, admin, settings_with_key
from tests.test_m365_api import client_for
from werkbank.config import Settings
from werkbank.core.app_settings import NINJA_KEY, encrypt_secret, set_setting
from werkbank.core.models import AppSetting, Job
from werkbank.modules.inventory.models import (
    InventoryCase,
    InventoryHardware,
    InventoryKind,
    InventoryMaker,
    InventoryMonitorIgnore,
    InventoryNinjaIgnore,
    InventoryPosition,
    InventorySyncRun,
    InventoryWorkplace,
)
from werkbank.modules.inventory.monitors import parse_monitor_field, valid_field_name
from werkbank.modules.inventory.ninja import (
    NinjaClient,
    NinjaConfig,
    NinjaDevice,
    NinjaError,
    NinjaOption,
    load_devices,
    load_monitor_fields,
    load_options,
    parse_device,
)
from werkbank.modules.inventory.ninja_admin import get_ninja_fetcher, get_ninja_options
from werkbank.modules.inventory.notifications import inventory_notifications
from werkbank.modules.inventory.sync import (
    NinjaScope,
    apply_devices,
    load_ninja_config,
    load_ninja_scope,
    run_sync,
)

BASE = "/api/inventory"
NOW = datetime(2026, 11, 20, 10, 0, tzinfo=UTC)
CONFIG = NinjaConfig(region="eu", client_id="app-id", client_secret="geheim")  # noqa: S106


def device(ninja_id: int, hostname: str, serial: str, **extra: Any) -> NinjaDevice:
    values: dict[str, Any] = {
        "ninja_id": ninja_id,
        "hostname": hostname,
        "serial": serial,
        "kind": "Notebook",
        "maker": "Hersteller A",
        "model": "Notebook 14 G10",
        "os": "Windows 11 Pro",
        "ip_addresses": ("192.0.2.41",),
        "last_contact": NOW,
        "ram_gb": 16,
        "policy": "Notebooks",
        "node_class": "WINDOWS_WORKSTATION",
    }
    values.update(extra)
    return NinjaDevice(**values)


# --- ohne Datenbank -------------------------------------------------------------------


def test_parse_device_keeps_workstations_only() -> None:
    item = {
        "id": 41,
        "nodeClass": "WINDOWS_WORKSTATION",
        "systemName": "NB-0142",
        "lastContact": 1795600000.5,
        "ipAddresses": ["192.0.2.41", "fe80::1", 7],
        "policyId": 3,
        "os": {"name": "Windows 11 Pro"},
        "memory": {"capacity": 17179869184},
        "system": {
            "manufacturer": "Hersteller A",
            "model": "Notebook 14 G10",
            "serialNumber": "To be filled by O.E.M.",
            "biosSerialNumber": "5CG3291XYZ",
            "chassisType": "LAPTOP",
        },
    }
    parsed = parse_device(item, {3: "Notebooks"})
    assert parsed is not None
    assert (parsed.hostname, parsed.serial, parsed.kind) == ("NB-0142", "5CG3291XYZ", "Notebook")
    assert parsed.ram_gb == 16 and parsed.policy == "Notebooks"
    assert parsed.ip_addresses == ("192.0.2.41", "fe80::1")
    assert parsed.last_contact is not None
    desktop = parse_device({**item, "system": {"chassisType": "DESKTOP"}}, {})
    assert desktop is not None and desktop.kind == "PC" and desktop.serial == ""
    assert parse_device({**item, "nodeClass": "WINDOWS_SERVER"}, {}) is None
    assert parse_device({**item, "id": "41"}, {}) is None
    assert parse_device({**item, "id": True}, {}) is None
    # Prozessor und Laufwerke; ohne Angaben leer
    assert parsed.cpu == "" and parsed.volumes == ()
    detailed = parse_device(
        {
            **item,
            "processors": [{"name": "Intel Core i5-9400T", "numCores": 6, "numLogicalCores": 6}],
            "volumes": [
                {"driveLetter": "C:", "capacity": 255_013_683_200, "fileSystem": "NTFS"},
                {"name": "USB", "deviceType": "Removable Disk", "capacity": 32 * 1024**3},
                {"driveLetter": "D:", "capacity": 0},
            ],
        },
        {},
    )
    assert detailed is not None
    assert detailed.cpu == "Intel Core i5-9400T (6 Kerne, 6 Threads)"
    assert detailed.volumes == ("C: 238 GB (NTFS)",)
    assert detailed.facts()["cpu"] == detailed.cpu
    assert detailed.facts()["volumes"] == ["C: 238 GB (NTFS)"]


def test_client_logs_in_and_pages() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(f"{request.method} {request.url.path}?{request.url.query.decode()}")
        if request.url.path == "/ws/oauth/token":
            assert b"grant_type=client_credentials" in request.content
            assert b"scope=monitoring" in request.content
            return httpx.Response(200, json={"access_token": "t"})
        assert request.headers["Authorization"] == "Bearer t"
        if request.url.path == "/api/v2/policies":
            return httpx.Response(200, json=[{"id": 1, "name": "Standard"}])
        if request.url.path == "/api/v2/organizations":
            return httpx.Response(200, json=[{"id": 5, "name": "Verwaltung"}])
        if request.url.path == "/api/v2/roles":
            return httpx.Response(
                200,
                json=[
                    {"id": 7, "name": "Notebook", "nodeClass": "WINDOWS_WORKSTATION"},
                    {"id": 8, "name": "Server", "nodeClass": "WINDOWS_SERVER"},
                ],
            )
        after = request.url.params.get("after")
        if after is None:
            page = [
                {
                    "id": index,
                    "nodeClass": "WINDOWS_WORKSTATION",
                    "systemName": f"PC-{index}",
                    "organizationId": 5,
                    "nodeRoleId": 7,
                }
                for index in range(1, 501)
            ]
            return httpx.Response(200, json=page)
        assert after == "500"
        return httpx.Response(200, json=[{"id": 501, "nodeClass": "MAC", "systemName": "MAC-1"}])

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        devices = load_devices(NinjaClient(CONFIG, http))
    assert len(devices) == 501
    assert (devices[0].organization, devices[0].role) == ("Verwaltung", "Notebook")
    assert devices[0].facts()["organization"] == "Verwaltung"
    assert calls[0].startswith("POST /ws/oauth/token")
    assert sum(1 for call in calls if call.startswith("POST")) == 1

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        organizations, roles = load_options(NinjaClient(CONFIG, http))
    assert [(item.id, item.name) for item in organizations] == [(5, "Verwaltung")]
    assert [(item.id, item.name) for item in roles] == [(7, "Notebook")]

    def refused(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": "invalid_client"})

    with (
        httpx.Client(transport=httpx.MockTransport(refused)) as http,
        pytest.raises(NinjaError, match="abgelehnt"),
    ):
        load_devices(NinjaClient(CONFIG, http))


# --- mit Datenbank --------------------------------------------------------------------


@pytest.fixture
def db(db_session: Session) -> Iterator[Session]:
    def clean() -> None:
        db_session.execute(delete(InventoryCase))
        db_session.execute(delete(InventoryHardware))
        for model in (
            InventoryWorkplace,
            InventoryPosition,
            InventoryNinjaIgnore,
            InventoryMonitorIgnore,
            InventorySyncRun,
            InventoryMaker,
        ):
            db_session.execute(delete(model))
        db_session.execute(delete(AppSetting).where(AppSetting.key == NINJA_KEY))
        db_session.execute(delete(Job).where(Job.type == "bestand.ninjaone"))
        db_session.commit()

    clean()
    yield db_session
    db_session.rollback()
    clean()


def configure(db: Session, settings: Settings, enabled: bool = True) -> None:
    set_setting(
        db,
        NINJA_KEY,
        {
            "enabled": enabled,
            "region": "eu",
            "client_id": "app-id",
            "secret_encrypted": encrypt_secret(settings, "geheim"),
        },
        None,
    )
    db.commit()


def kind_id(db: Session, name: str) -> int:
    return int(db.scalars(select(InventoryKind.id).where(InventoryKind.name == name)).one())


@pytest.mark.db
def test_apply_links_by_id_then_serial_and_opens_cases(db: Session) -> None:
    manual = InventoryHardware(
        kind_id=kind_id(db, "Notebook"), name="Altes Notebook", serial="5cg3291xyz", hostname=""
    )
    db.add(manual)
    db.commit()

    first = apply_devices(
        db,
        [device(41, "NB-0142", "5CG3291XYZ"), device(42, "NB-0163", "5CG4012QWE")],
        NOW,
    )
    db.commit()
    assert (first.devices, first.new_cases, first.missing_cases) == (2, 1, 0)
    db.refresh(manual)
    assert manual.ninja_id == 41 and manual.hostname == "NB-0142"
    assert manual.ninja_facts and manual.ninja_facts["ip"] == ["192.0.2.41"]
    case = db.scalars(select(InventoryCase).where(InventoryCase.ninja_id == 42)).one()
    assert case.kind == "neu" and case.status == "neu" and case.number.startswith("V-")

    # Zweiter Lauf: nichts Neues, kein zweiter Vorgang
    again = apply_devices(
        db,
        [device(41, "NB-0142", "5CG3291XYZ"), device(42, "NB-0163", "5CG4012QWE")],
        NOW,
    )
    db.commit()
    assert again.new_cases == 0
    assert len(db.scalars(select(InventoryCase)).all()) == 1

    # Gerät 41 fehlt: Vorgang „weg“; taucht es wieder auf, schließt er sich
    gone = apply_devices(db, [device(42, "NB-0163", "5CG4012QWE")], NOW)
    db.commit()
    assert gone.missing_cases == 1
    missing = db.scalars(select(InventoryCase).where(InventoryCase.kind == "weg")).one()
    assert missing.hardware_id == manual.id
    apply_devices(db, [device(41, "NB-0142-NEU", "5CG3291XYZ"), device(42, "NB-0163", "")], NOW)
    db.commit()
    db.refresh(missing)
    db.refresh(manual)
    assert missing.status == "fertig" and missing.decision == "wieder_da"
    assert manual.hostname == "NB-0142-NEU"

    # Gleicher Hostname, andere Seriennummer: nur ein Hinweis, keine Verknüpfung
    apply_devices(
        db,
        [
            device(41, "NB-0142-NEU", "5CG3291XYZ"),
            device(42, "NB-0163", ""),
            device(77, "NB-0142-NEU", "NEU-SN"),
        ],
        NOW,
    )
    db.commit()
    hinted = db.scalars(select(InventoryCase).where(InventoryCase.ninja_id == 77)).one()
    assert hinted.hint_hardware_id == manual.id
    db.refresh(manual)
    assert manual.ninja_id == 41


@pytest.mark.db
def test_run_sync_records_runs_and_guards_empty_lists(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    assert run_sync(db, settings, lambda config: []) is None  # ausgeschaltet
    configure(db, settings)
    assert load_ninja_config(db, settings) == CONFIG

    run = run_sync(db, settings, lambda config: [device(41, "NB-0142", "SN-1")])
    assert run is not None and run.status == "ok" and run.new_cases == 1

    def broken(config: NinjaConfig) -> list[NinjaDevice]:
        raise NinjaError("NinjaOne nicht erreichbar: ConnectError")

    failed = run_sync(db, settings, broken)
    assert failed is not None and failed.status == "fehlgeschlagen"
    assert "ConnectError" in failed.error

    # Ein verknüpftes Gerät und dann eine leere Liste: Abbruch statt „alle fehlen“
    case = db.scalars(select(InventoryCase)).one()
    editor = client_for(["Bestand.Editor"], "ninja-leer")
    stelle = editor.post(f"{BASE}/positions", json={"name": "Stelle A"}, headers=HEADERS).json()
    done = editor.post(
        f"{BASE}/cases/{case.id}/decide",
        json={"decision": "stelle", "position_id": stelle["id"]},
        headers=HEADERS,
    )
    assert done.status_code == 200, done.text
    empty = run_sync(db, settings, lambda config: [])
    assert empty is not None and empty.status == "fehlgeschlagen"
    assert db.scalars(select(InventoryCase).where(InventoryCase.kind == "weg")).all() == []

    events = list(inventory_notifications(db, settings, datetime.now(UTC)))
    assert any(event.kind == "bestand.abgleich_fehlgeschlagen" for event in events)


@pytest.mark.db
def test_cases_api_decisions(db: Session) -> None:
    apply_devices(
        db,
        [
            device(41, "NB-0142", "SN-41"),
            device(42, "PC-0119", "SN-42", kind="PC", maker="", model=""),
            device(43, "TEST-01", "SN-43"),
            device(44, "NB-0200", "SN-44"),
        ],
        NOW,
    )
    db.commit()
    by_ninja = {row.ninja_id: row.id for row in db.scalars(select(InventoryCase)).all()}

    reader = client_for(["Bestand.Reader"], "vorgang-leser")
    editor = client_for(["Bestand.Editor"], "vorgang-bearbeiter")
    listed = reader.get(f"{BASE}/cases").json()
    assert listed["open"] == 4 and len(listed["cases"]) == 4
    assert reader.post(f"{BASE}/cases/{by_ninja[41]}/take", headers=HEADERS).status_code == 403
    assert (
        reader.post(
            f"{BASE}/cases/{by_ninja[41]}/decide", json={"decision": "lager"}, headers=HEADERS
        ).status_code
        == 403
    )

    taken = editor.post(f"{BASE}/cases/{by_ninja[41]}/take", headers=HEADERS).json()
    assert taken["status"] == "arbeit" and taken["assignee"] == "Rita Reviewer"
    noted = editor.post(
        f"{BASE}/cases/{by_ninja[41]}/note", json={"text": "Steht im Lager"}, headers=HEADERS
    ).json()
    assert noted["events"][0]["text"] == "Notiz: Steht im Lager"
    assert (
        editor.post(
            f"{BASE}/cases/{by_ninja[41]}/note", json={"text": "a\nb"}, headers=HEADERS
        ).status_code
        == 422
    )

    # Arbeitsplatz: Gerät entsteht mit Hersteller und Modell aus NinjaOne
    workplace = editor.post(
        f"{BASE}/workplaces", json={"name": "Platz", "room_id": room_for_tests(db)}, headers=HEADERS
    ).json()
    decided = editor.post(
        f"{BASE}/cases/{by_ninja[41]}/decide",
        json={"decision": "arbeitsplatz", "workplace_id": workplace["id"]},
        headers=HEADERS,
    ).json()
    assert decided["status"] == "fertig" and decided["hardware"]["hostname"] == "NB-0142"
    hardware = reader.get(f"{BASE}/hardware/{decided['hardware']['id']}").json()
    assert hardware["source"] == "ninja" and hardware["kind"] == "Notebook"
    assert (hardware["maker"], hardware["model"]) == ("Hersteller A", "Notebook 14 G10")
    assert hardware["holder_ref"]["kind"] == "arbeitsplatz"
    assert hardware["ninja"]["facts"]["os"] == "Windows 11 Pro"
    # Hostname und Seriennummer lassen sich danach nicht von Hand ändern
    changed = editor.put(
        f"{BASE}/hardware/{hardware['id']}",
        json={
            "kind_id": hardware["kind_id"],
            "name": "X",
            "serial": "ANDERS",
            "hostname": "NB-0142",
        },
        headers=HEADERS,
    )
    assert changed.status_code == 422
    assert (
        editor.post(
            f"{BASE}/cases/{by_ninja[41]}/decide", json={"decision": "lager"}, headers=HEADERS
        ).status_code
        == 409
    )

    # Lager ohne Raum, PC ohne Modell
    stored = editor.post(
        f"{BASE}/cases/{by_ninja[42]}/decide", json={"decision": "lager"}, headers=HEADERS
    ).json()
    assert stored["decision"] == "lager"
    pc = reader.get(f"{BASE}/hardware/{stored['hardware']['id']}").json()
    assert pc["kind"] == "PC" and pc["name"] == "PC-0119"

    # Übergehen: kein neuer Vorgang beim nächsten Abgleich
    assert (
        editor.post(
            f"{BASE}/cases/{by_ninja[43]}/decide", json={"decision": "uebergehen"}, headers=HEADERS
        ).status_code
        == 200
    )
    assert db.get(InventoryNinjaIgnore, 43) is not None

    # Ist dasselbe Gerät: vorhandenes Gerät übernimmt die NinjaOne-ID
    old = InventoryHardware(kind_id=pc["kind_id"], name="Alt", serial="ALT-SN", hostname="NB-0200")
    db.add(old)
    db.commit()
    same = editor.post(
        f"{BASE}/cases/{by_ninja[44]}/decide",
        json={"decision": "gleich", "hardware_id": old.id},
        headers=HEADERS,
    ).json()
    assert same["decision"] == "gleich"
    db.refresh(old)
    assert old.ninja_id == 44 and old.serial == "SN-44" and old.source == "ninja"
    for bad in ({"decision": "unbekannt"}, {"decision": "wieder_da"}):
        new_case = apply_devices(db, [device(45, "NB-0300", "SN-45")], NOW)
        db.commit()
        assert new_case.new_cases <= 1
        case_id = db.scalars(select(InventoryCase.id).where(InventoryCase.ninja_id == 45)).one()
        assert (
            editor.post(f"{BASE}/cases/{case_id}/decide", json=bad, headers=HEADERS).status_code
            == 422
        )

    # Vorgang „weg“: ausgemustert erst, wenn das Gerät ausgemustert ist
    apply_devices(db, [device(44, "NB-0200", "SN-44"), device(45, "NB-0300", "SN-45")], NOW)
    db.commit()
    gone = db.scalars(
        select(InventoryCase).where(InventoryCase.kind == "weg", InventoryCase.status == "neu")
    ).first()
    assert gone is not None
    assert (
        editor.post(
            f"{BASE}/cases/{gone.id}/decide", json={"decision": "ausgemustert"}, headers=HEADERS
        ).status_code
        == 409
    )
    checked = editor.post(
        f"{BASE}/cases/{gone.id}/decide", json={"decision": "pruefen"}, headers=HEADERS
    ).json()
    assert checked["status"] == "arbeit"
    lost = editor.post(
        f"{BASE}/cases/{gone.id}/decide", json={"decision": "verloren"}, headers=HEADERS
    ).json()
    assert lost["status"] == "fertig"
    assert reader.get(f"{BASE}/cases", params={"state": "fertig"}).json()["cases"]


@pytest.mark.db
def test_admin_ninja_settings_and_status(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    client = admin(settings)
    url = "/api/admin/settings/ninjaone"
    assert client.get(url).json()["secret_set"] is False
    assert (
        client.put(url, json={"enabled": True, "region": "eu"}, headers=HEADERS).status_code == 422
    )
    assert (
        client.put(
            url, json={"enabled": False, "region": "mars", "client_id": "x"}, headers=HEADERS
        ).status_code
        == 422
    )
    saved = client.put(
        url,
        json={"enabled": True, "region": "eu", "client_id": "app-id", "client_secret": "geheim"},
        headers=HEADERS,
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["secret_set"] is True and "geheim" not in saved.text
    stored = db.scalars(select(AppSetting).where(AppSetting.key == NINJA_KEY)).one()
    db.refresh(stored)
    assert "geheim" not in str(stored.value)

    cast(FastAPI, client.app).dependency_overrides[get_ninja_fetcher] = lambda: (
        lambda config: [device(1, "NB-1", "S1"), device(2, "PC-1", "S2", kind="PC")]
    )
    tested = client.post(f"{url}/test", headers=HEADERS)
    assert tested.json() == {
        "devices": 2,
        "notebooks": 1,
        "pcs": 1,
        "in_scope": 2,
        "monitors": 0,
    }

    cast(FastAPI, client.app).dependency_overrides[get_ninja_options] = lambda: (
        lambda config: ([NinjaOption(5, "Verwaltung")], [NinjaOption(7, "Notebook")])
    )
    options = client.post(f"{url}/options", headers=HEADERS).json()
    assert options == {
        "organizations": [{"id": 5, "name": "Verwaltung"}],
        "roles": [{"id": 7, "name": "Notebook"}],
    }
    scoped = client.put(
        url,
        json={
            "enabled": True,
            "region": "eu",
            "client_id": "app-id",
            "organization_ids": [5, 5],
            "role_ids": [8, 7],
        },
        headers=HEADERS,
    ).json()
    assert (scoped["organization_ids"], scoped["role_ids"]) == ([5], [7, 8])
    assert scoped["secret_set"] is True
    db.expire_all()
    assert load_ninja_scope(db) == NinjaScope(frozenset({5}), frozenset({7, 8}))
    bad = client.put(
        url,
        json={"enabled": False, "region": "eu", "client_id": "x", "role_ids": [0]},
        headers=HEADERS,
    )
    assert bad.status_code == 422
    tested = client.post(f"{url}/test", headers=HEADERS).json()
    assert tested["in_scope"] == 0

    reader = client_for(["Bestand.Reader"], "ninja-status")
    assert client_for(["Bestand.Editor"], "ninja-nicht-admin").get(url).status_code == 403
    status = reader.get(f"{BASE}/ninjaone/status").json()
    assert status["enabled"] is True and status["interval_minutes"] == 30
    editor = client_for(["Bestand.Editor"], "ninja-jetzt")
    assert reader.post(f"{BASE}/ninjaone/run", headers=HEADERS).status_code == 403
    assert editor.post(f"{BASE}/ninjaone/run", headers=HEADERS).status_code == 200
    assert db.scalars(select(Job).where(Job.type == "bestand.ninjaone")).first() is not None


def test_scope_by_organization_and_role() -> None:
    inside = device(1, "NB-1", "S1", organization_id=5, role_id=7)
    other_org = device(2, "NB-2", "S2", organization_id=6, role_id=7)
    other_role = device(3, "NB-3", "S3", organization_id=5, role_id=9)
    assert NinjaScope().includes(other_org)
    scope = NinjaScope(organization_ids=frozenset({5}), role_ids=frozenset({7, 8}))
    assert scope.includes(inside)
    assert not scope.includes(other_org)
    assert not scope.includes(other_role)
    assert NinjaScope(role_ids=frozenset({9})).includes(other_role)


@pytest.mark.db
def test_scope_limits_new_cases_but_keeps_linked_devices(db: Session) -> None:
    linked = InventoryHardware(
        kind_id=kind_id(db, "PC"), name="PC alt", serial="S-LINK", hostname="PC-1", ninja_id=10
    )
    db.add(linked)
    db.commit()
    scope = NinjaScope(organization_ids=frozenset({5}))
    result = apply_devices(
        db,
        [
            device(10, "PC-1", "S-LINK", organization_id=6),
            device(11, "NB-IN", "S-IN", organization_id=5),
            device(12, "NB-OUT", "S-OUT", organization_id=6),
        ],
        NOW,
        scope,
    )
    db.commit()
    assert (result.new_cases, result.missing_cases) == (1, 0)
    assert db.scalars(select(InventoryCase.ninja_id)).all() == [11]
    db.refresh(linked)
    assert linked.ninja_seen_at is not None


# --- Monitore aus dem Custom Field ----------------------------------------------------

MONITOR_FIELD = """Hersteller|Modell|Seriennummer|ProductCode|Baujahr-KW|Anschluss|ZuletztGesehen
LEN|T24D-4t|V5A00000|62B5|2024-KW12|DisplayPort|2026-11-20
DEL|P2422H|CN0ABC|A0B1|2023-KW05|HDMI|kein-datum
XYZ|Ohne Seriennummer||||
LEN|T24D-4t|v5a00000|62B5|2024-KW12|DisplayPort|2026-11-20"""


def test_parse_monitor_field() -> None:
    lines = parse_monitor_field(MONITOR_FIELD)
    assert [(line.maker, line.model, line.serial) for line in lines] == [
        ("Lenovo", "T24D-4t", "V5A00000"),
        ("Dell", "P2422H", "CN0ABC"),
    ]
    assert lines[0].facts()["built"] == "2024-KW12"
    assert lines[0].last_seen == "2026-11-20" and lines[1].last_seen == ""
    assert parse_monitor_field(None) == []
    assert valid_field_name("monitore") and not valid_field_name("1abc")
    assert not valid_field_name("feld-name")


def test_monitor_fields_are_read_page_by_page() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/ws/oauth/token":
            return httpx.Response(200, json={"access_token": "t"})
        assert request.url.params["fields"] == "monitore"
        return httpx.Response(
            200,
            json={
                "results": [
                    {"deviceId": 41, "fields": {"monitore": MONITOR_FIELD}},
                    {"deviceId": 42, "fields": {}},
                    {"deviceId": "x", "fields": {"monitore": MONITOR_FIELD}},
                ],
                "cursor": {"name": "weiter"},
            },
        )

    with httpx.Client(transport=httpx.MockTransport(handler)) as http:
        found = load_monitor_fields(NinjaClient(CONFIG, http), "monitore")
    assert list(found) == [41] and len(found[41]) == 2


@pytest.mark.db
def test_monitors_are_attached_or_become_cases(db: Session) -> None:
    editor = client_for(["Bestand.Editor"], "monitor-bearbeiter")
    workplace = editor.post(
        f"{BASE}/workplaces",
        json={"name": "Fenster", "room_id": room_for_tests(db)},
        headers=HEADERS,
    ).json()
    position = editor.post(f"{BASE}/positions", json={"name": "Stelle M"}, headers=HEADERS).json()
    pc = InventoryHardware(
        kind_id=kind_id(db, "PC"),
        name="PC",
        serial="PC-SN",
        hostname="PC-0207",
        ninja_id=51,
        workplace_id=workplace["id"],
    )
    notebook = InventoryHardware(
        kind_id=kind_id(db, "Notebook"),
        name="NB",
        serial="NB-SN",
        hostname="NB-0142",
        ninja_id=52,
        position_id=position["id"],
    )
    db.add_all([pc, notebook])
    db.commit()
    editor.put(
        f"{BASE}/workplaces/{workplace['id']}",
        json={"name": "Fenster", "shared": False, "position_ids": [position["id"]]},
        headers=HEADERS,
    )
    lines = tuple(parse_monitor_field(MONITOR_FIELD))
    result = apply_devices(
        db,
        [
            device(51, "PC-0207", "PC-SN", kind="PC", monitors=lines[:1]),
            device(52, "NB-0142", "NB-SN", monitors=lines[1:]),
        ],
        NOW,
    )
    db.commit()
    # PC am Arbeitsplatz: Monitor direkt dort; Notebook: Vorgang mit Vorschlag
    assert (result.monitors_added, result.new_cases) == (1, 1)
    monitor = db.scalars(
        select(InventoryHardware).where(InventoryHardware.serial == "V5A00000")
    ).one()
    assert monitor.workplace_id == workplace["id"] and monitor.connected_to_id == pc.id
    assert monitor.ninja_facts and monitor.ninja_facts["connector"] == "DisplayPort"
    case = db.scalars(select(InventoryCase).where(InventoryCase.kind == "monitor")).one()
    assert case.facts["suggest_workplace_id"] == workplace["id"]

    # Zweiter Lauf: nichts Neues; der Lenovo hängt jetzt am Notebook → nur Verlauf
    moved = apply_devices(
        db,
        [
            device(51, "PC-0207", "PC-SN", kind="PC"),
            device(52, "NB-0142", "NB-SN", monitors=lines),
        ],
        NOW,
    )
    db.commit()
    assert (moved.monitors_added, moved.new_cases) == (0, 0)
    db.refresh(monitor)
    assert monitor.connected_to_id == notebook.id
    assert monitor.workplace_id == workplace["id"]

    reader = client_for(["Bestand.Reader"], "monitor-leser")
    pc_view = reader.get(f"{BASE}/hardware/{pc.id}").json()
    assert pc_view["monitors"] == []
    nb_view = reader.get(f"{BASE}/hardware/{notebook.id}").json()
    assert [item["serial"] for item in nb_view["monitors"]] == ["V5A00000"]
    monitor_view = reader.get(f"{BASE}/hardware/{monitor.id}").json()
    assert monitor_view["connected_to"]["hostname"] == "NB-0142"
    assert any("NB-0142" in event["text"] for event in monitor_view["events"])

    # Vorgang: am vorgeschlagenen Arbeitsplatz anlegen
    decided = editor.post(
        f"{BASE}/cases/{case.id}/decide",
        json={"decision": "arbeitsplatz", "workplace_id": workplace["id"]},
        headers=HEADERS,
    ).json()
    assert decided["status"] == "fertig"
    dell = reader.get(f"{BASE}/hardware/{decided['hardware']['id']}").json()
    assert (dell["kind"], dell["maker"], dell["model"]) == ("Monitor", "Dell", "P2422H")
    assert dell["connected_to"]["id"] == notebook.id

    # Nicht übernehmen: kommt nicht wieder
    other = tuple(parse_monitor_field("SAM|S24|SAM-SN|1|2022-KW01|HDMI|2026-11-20"))
    apply_devices(db, [device(52, "NB-0142", "NB-SN", monitors=other)], NOW)
    db.commit()
    skipped = db.scalars(
        select(InventoryCase).where(InventoryCase.kind == "monitor", InventoryCase.status == "neu")
    ).one()
    assert (
        editor.post(
            f"{BASE}/cases/{skipped.id}/decide", json={"decision": "uebergehen"}, headers=HEADERS
        ).status_code
        == 200
    )
    again = apply_devices(db, [device(52, "NB-0142", "NB-SN", monitors=other)], NOW)
    db.commit()
    assert again.new_cases == 0
