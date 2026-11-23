"""IT-Bestand: technische Daten aus Lenovo PSREF (Parser, Abruf, täglicher Lauf, API)."""

import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_admin_settings import HEADERS, admin, settings_with_key
from tests.test_m365_api import client_for
from werkbank.core.app_settings import NINJA_KEY, set_setting
from werkbank.core.models import AppSetting, AuditLog
from werkbank.modules.inventory.models import (
    InventoryHardware,
    InventoryKind,
    InventoryMaker,
    InventoryModel,
)
from werkbank.modules.inventory.psref import (
    USER_AGENT,
    PsrefError,
    PsrefResult,
    Spec,
    av_summary,
    clean,
    http_getter,
    is_mtm,
    lookup_model,
    lookup_monitor,
    monitor_keys,
    parse_model_specs,
    parse_product_specs,
    valid_user_agent,
)
from werkbank.modules.inventory.psref_sync import due, get_psref_fetcher, run_psref

BASE = "/api/inventory"
MODEL_ANSWER = {
    "code": 1,
    "data": {
        "ProductKey": "ThinkCentre_M720_Tiny",
        "ProductName": "ThinkCentre M720 Tiny",
        "SpecData": [
            {"Title": "Prozessor", "Name": "Processor", "Content": "Intel&reg; Core&trade; i5"},
            {"Title": "Speicher", "Name": "Memory", "Content": "8GB<br>DDR4"},
            {"Title": "", "Name": "Leer", "Content": ""},
        ],
    },
}


def product_answer() -> dict[str, Any]:
    spec = {
        "data": {
            "SpecData": [
                {
                    "L1": "Allgemein",
                    "L2": [
                        {
                            "L2": "Ausstattung",
                            "Features": [
                                {
                                    "FName": "Camera",
                                    "FVs": [
                                        {
                                            "FVGs": [
                                                {
                                                    "FVGItem": [
                                                        {"AttNo": "2", "AttV": "Full HD"},
                                                        {"AttNo": "1", "AttV": "5MP"},
                                                    ]
                                                }
                                            ]
                                        }
                                    ],
                                },
                                {
                                    "FName": "Microphone",
                                    "FVs": [{"FVGs": [{"FVGItem": [{"AttV": "Dual-array"}]}]}],
                                },
                                {
                                    "FName": "Speakers",
                                    "FVs": [{"FVGs": [{"FVGItem": [{"AttV": "2x 3W"}]}]}],
                                },
                            ],
                        }
                    ],
                }
            ]
        }
    }
    return {
        "code": "1",
        "data": {
            "GeneralSpecData": [
                {"ProductName": "ThinkVision T24D-4t", "GeneralSpecJson": json.dumps(spec)}
            ]
        },
    }


# --- ohne Datenbank -------------------------------------------------------------------


def test_clean_and_keys() -> None:
    assert clean("Intel&reg; <b>Core</b>\n i5") == "Intel® Core; i5"
    assert clean(None) == ""
    assert is_mtm("10T7004BGE") and is_mtm("10t7004bge") and not is_mtm("T24D-4t")
    assert monitor_keys("T24D-4t") == ["ThinkVision_T24D_4t_Monitor", "ThinkVision_T24D_4t"]
    assert monitor_keys("") == []


def test_parse_model_specs() -> None:
    key, name, specs = parse_model_specs(MODEL_ANSWER)
    assert (key, name) == ("ThinkCentre_M720_Tiny", "ThinkCentre M720 Tiny")
    assert [(spec.name, spec.value) for spec in specs] == [
        ("Processor", "Intel® Core™ i5"),
        ("Memory", "8GB DDR4"),
    ]
    assert parse_model_specs({"data": None}) == ("", "", ())
    # Unpassender Schlüssel wird nicht in eine URL übernommen
    bad = {"data": {"ProductKey": "../x?y", "SpecData": []}}
    assert parse_model_specs(bad)[0] == ""


def test_parse_product_specs() -> None:
    name, specs = parse_product_specs(product_answer())
    assert name == "ThinkVision T24D-4t"
    assert specs[0] == Spec(group="Ausstattung", name="Camera", value="5MP: Full HD")
    assert av_summary(specs) == {
        "camera": "5MP: Full HD",
        "microphone": "Dual-array",
        "speakers": "2x 3W",
    }
    assert parse_product_specs({"code": "0"}) == ("", ())
    assert parse_product_specs({"code": "1", "data": {"GeneralSpecData": [{}]}}) == ("", ())


def test_lookups_with_fake_getter() -> None:
    asked: list[tuple[str, dict[str, str]]] = []

    def get(path: str, params: dict[str, str]) -> Any:
        asked.append((path, params))
        if path.startswith("/api/model"):
            return MODEL_ANSWER
        return product_answer() if params["ProductKey"] == "ThinkVision_T24D_4t" else None

    found = lookup_model(get, "10t7004bge")
    assert found.url == "https://psref.lenovo.com/detail/ThinkCentre_M720_Tiny?M=10T7004BGE"
    assert asked[0] == ("/api/model/Info/SpecData", {"model_code": "10T7004BGE"})

    monitor = lookup_monitor(get, "T24D-4t")
    assert monitor.key == "ThinkVision_T24D_4t"
    assert monitor.url == "https://psref.lenovo.com/product/ThinkVision/ThinkVision_T24D_4t"
    assert len(asked) == 3

    missing = lookup_monitor(lambda path, params: None, "X1")
    assert missing.specs == () and missing.url.endswith("/Search?kw=X1")


def test_http_getter_sends_agent_and_explains_the_block() -> None:
    seen: list[str] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request.headers["User-Agent"])
        if request.headers["User-Agent"] == USER_AGENT:
            page = "<html><head><title>PSREF page not found</title></head></html>"
            return httpx.Response(403, text=page)
        if request.url.params.get("model_code") == "KAPUTT":
            return httpx.Response(500, text="Fehler")
        return httpx.Response(200, json=MODEL_ANSWER)

    with httpx.Client(transport=httpx.MockTransport(answer)) as http:
        with pytest.raises(PsrefError, match=r"lehnt den Abruf ab \(403\).*Absenderkennung"):
            http_getter(http)("/api/model/Info/SpecData", {"model_code": "10T7004BGE"})
        browser = http_getter(http, "Mozilla/5.0 Beispiel")
        assert browser("/api/model/Info/SpecData", {"model_code": "10T7004BGE"}) == MODEL_ANSWER
        with pytest.raises(PsrefError, match="antwortet mit 500"):
            browser("/api/model/Info/SpecData", {"model_code": "KAPUTT"})
    assert seen[:2] == [USER_AGENT, "Mozilla/5.0 Beispiel"]
    assert valid_user_agent("Mozilla/5.0 (Windows NT 10.0)")
    assert not valid_user_agent("Kennung mit Ümlaut") and not valid_user_agent("a\nb")


# --- mit Datenbank --------------------------------------------------------------------


@pytest.fixture
def db(db_session: Session) -> Iterator[Session]:
    def clean_up() -> None:
        db_session.execute(delete(InventoryHardware))
        db_session.execute(delete(InventoryMaker))
        db_session.execute(delete(AppSetting).where(AppSetting.key == NINJA_KEY))
        db_session.commit()

    clean_up()
    yield db_session
    db_session.rollback()
    clean_up()


def enable(db: Session, on: bool = True) -> None:
    set_setting(db, NINJA_KEY, {"enabled": False, "psref_enabled": on}, None)
    db.commit()


def hardware(db: Session, kind: str, maker: str, model: str, serial: str) -> InventoryHardware:
    maker_row = db.scalars(select(InventoryMaker).where(InventoryMaker.name == maker)).first()
    if maker_row is None:
        maker_row = InventoryMaker(name=maker)
        db.add(maker_row)
        db.flush()
    model_row = InventoryModel(maker_id=maker_row.id, name=model)
    db.add(model_row)
    db.flush()
    kind_id = db.scalars(select(InventoryKind.id).where(InventoryKind.name == kind)).one()
    row = InventoryHardware(kind_id=kind_id, name=model, serial=serial, model_id=model_row.id)
    db.add(row)
    db.commit()
    return row


class FakeFetcher:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []
        self.agents: list[str] = []
        self.fail = False

    def __call__(self, lookup: str, value: str, user_agent: str) -> PsrefResult:
        self.calls.append((lookup, value))
        self.agents.append(user_agent)
        if self.fail:
            raise PsrefError("PSREF nicht erreichbar: ConnectError")
        if lookup == "modell":
            return PsrefResult(
                key="ThinkCentre_M720_Tiny",
                name="ThinkCentre M720 Tiny",
                url="https://psref.lenovo.com/detail/ThinkCentre_M720_Tiny?M=10T7004BGE",
                specs=(Spec("Prozessor", "Processor", "Intel Core i5"),),
            )
        return PsrefResult(key="", name="", url="https://psref.lenovo.com/Search?kw=X", specs=())


@pytest.mark.db
def test_run_psref_only_when_enabled_and_due(db: Session) -> None:
    tiny = hardware(db, "PC", "Lenovo", "10T7004BGE", "PS-1")
    monitor = hardware(db, "Monitor", "Lenovo", "T24D-4t", "PS-2")
    hardware(db, "Notebook", "Hersteller A", "Notebook 14", "PS-3")
    hardware(db, "PC", "Lenovo", "ThinkCentre ohne MTM", "PS-4")
    fake = FakeFetcher()

    assert run_psref(db, fake, pause=0) == 0
    enable(db)
    assert run_psref(db, fake, pause=0) == 2
    assert sorted(fake.calls) == [("modell", "10T7004BGE"), ("monitor", "T24D-4t")]

    tiny_model = db.get(InventoryModel, tiny.model_id)
    monitor_model = db.get(InventoryModel, monitor.model_id)
    assert tiny_model and monitor_model
    assert tiny_model.psref_status == "ok" and tiny_model.psref_specs
    assert monitor_model.psref_status == "nicht_gefunden"

    # Gleich danach nichts fällig; nach 8 Tagen nur der nicht gefundene Monitor
    fake.calls.clear()
    assert run_psref(db, fake, pause=0) == 0
    later = datetime.now(UTC) + timedelta(days=8)
    assert not due(tiny_model, later) and due(monitor_model, later)

    # Fehler: Status „fehler“, alte Daten bleiben
    fake.fail = True
    tiny_model.psref_checked_at = datetime.now(UTC) - timedelta(days=31)
    db.commit()
    assert run_psref(db, fake, pause=0) == 1
    db.refresh(tiny_model)
    assert tiny_model.psref_status == "fehler" and tiny_model.psref_specs
    assert tiny_model.psref_error == "PSREF nicht erreichbar: ConnectError"
    # Ohne Eintrag in der Verwaltung die Kennung der Werkbank
    assert set(fake.agents) == {USER_AGENT}

    # Klappt es wieder, ist der Grund weg; die Kennung aus der Verwaltung wird genutzt
    set_setting(
        db,
        NINJA_KEY,
        {"enabled": False, "psref_enabled": True, "psref_user_agent": "Mozilla/5.0 Beispiel"},
        None,
    )
    fake.fail = False
    tiny_model.psref_checked_at = datetime.now(UTC) - timedelta(days=31)
    db.commit()
    assert run_psref(db, fake, pause=0) == 1
    db.refresh(tiny_model)
    assert tiny_model.psref_status == "ok" and tiny_model.psref_error == ""
    assert fake.agents[-1] == "Mozilla/5.0 Beispiel"


@pytest.mark.db
def test_psref_in_hardware_view_and_refresh_endpoint(db: Session) -> None:
    tiny = hardware(db, "PC", "Lenovo", "10T7004BGE", "PS-11")
    other = hardware(db, "Notebook", "Hersteller A", "Notebook 14", "PS-12")
    fake = FakeFetcher()
    editor = client_for(["Bestand.Editor"], "psref-bearbeiter")
    reader = client_for(["Bestand.Reader"], "psref-leser")
    for client in (editor, reader):
        cast(FastAPI, client.app).dependency_overrides[get_psref_fetcher] = lambda: fake

    assert reader.get(f"{BASE}/hardware/{tiny.id}").json()["psref"] is None
    url = f"{BASE}/hardware/{tiny.id}/psref"
    assert reader.post(url, headers=HEADERS).status_code == 403
    # ausgeschaltet
    assert editor.post(url, headers=HEADERS).status_code == 409
    enable(db)
    done = editor.post(url, headers=HEADERS)
    assert done.status_code == 200, done.text
    psref = done.json()["psref"]
    assert psref["status"] == "ok" and psref["name"] == "ThinkCentre M720 Tiny"
    assert psref["specs"][0] == {
        "group": "Prozessor",
        "name": "Processor",
        "value": "Intel Core i5",
    }
    assert (
        reader.get(f"{BASE}/hardware/{tiny.id}")
        .json()["psref"]["url"]
        .startswith("https://psref.lenovo.com/detail/")
    )
    # Kein Lenovo-Gerät
    assert editor.post(f"{BASE}/hardware/{other.id}/psref", headers=HEADERS).status_code == 409

    # Fehler: Grund in der Ansicht und im Protokoll
    fake.fail = True
    failed = editor.post(url, headers=HEADERS).json()["psref"]
    assert failed["status"] == "fehler"
    assert failed["error"] == "PSREF nicht erreichbar: ConnectError"
    entry = db.scalars(
        select(AuditLog)
        .where(AuditLog.action == "bestand.psref_abgerufen")
        .order_by(AuditLog.id.desc())
    ).first()
    assert entry is not None
    assert entry.details == {"ergebnis": "fehler", "grund": "PSREF nicht erreichbar: ConnectError"}


@pytest.mark.db
def test_admin_psref_toggle(db: Session, tmp_path: Path) -> None:
    client = admin(settings_with_key(tmp_path))
    stored = client.get("/api/admin/settings/ninjaone").json()
    assert stored["psref_enabled"] is False
    saved = client.put(
        "/api/admin/settings/ninjaone",
        json={"enabled": False, "region": "eu", "psref_enabled": True},
        headers=HEADERS,
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["psref_enabled"] is True
    assert saved.json()["psref_user_agent"] == ""
    agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Beispiel"
    saved = client.put(
        "/api/admin/settings/ninjaone",
        json={"enabled": False, "region": "eu", "psref_enabled": True, "psref_user_agent": agent},
        headers=HEADERS,
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["psref_user_agent"] == agent
    bad = client.put(
        "/api/admin/settings/ninjaone",
        json={"enabled": False, "region": "eu", "psref_user_agent": "Kennung mit Ümlaut"},
        headers=HEADERS,
    )
    assert bad.status_code == 422
