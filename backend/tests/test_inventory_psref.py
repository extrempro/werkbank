"""IT-Bestand: technische Daten aus der PSREF-Schnittstelle (Parser, Abruf, Lauf, API)."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast

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
    clean,
    fetch_with,
    is_mtm,
    page_url,
    parse_details,
)
from werkbank.modules.inventory.psref_sync import due, get_psref_fetcher, run_psref

BASE = "/api/inventory"
ANSWER = {
    "Name": "ThinkCentre M720 Tiny",
    "ProductId": "687",
    "ProductKey": "ThinkCentre_M720_Tiny",
    "ModelURL": "http://psref.lenovo.com/Detail/ThinkCentre/ThinkCentre_M720_Tiny?M=10T7004BGE",
    "Detail": [
        {"Name": "Model", "Value": "10T7004BGE"},
        {"Name": "Region", "Value": "WE"},
        {"Name": "TopSeller", "Value": "TopSeller"},
        {"Name": "Processor", "Value": "Intel&reg; Core i5-9400T"},
        {"Name": "Memory", "Value": "1x 8GB<br>DDR4"},
        {"Name": "Leer", "Value": ""},
        {"Name": "End of Support", "Value": "2025-01-26"},
    ],
}


# --- ohne Datenbank -------------------------------------------------------------------


def test_clean_and_mtm() -> None:
    assert clean("Intel&reg; <b>Core</b>\n i5") == "Intel® Core; i5"
    assert clean(None) == ""
    assert is_mtm("10T7004BGE") and is_mtm("10t7004bge") and not is_mtm("ThinkCentre M720")


def test_parse_details() -> None:
    result = parse_details(ANSWER, "10T7004BGE")
    assert result.name == "ThinkCentre M720 Tiny"
    # http wird https, nur psref.lenovo.com
    assert result.url == (
        "https://psref.lenovo.com/Detail/ThinkCentre/ThinkCentre_M720_Tiny?M=10T7004BGE"
    )
    assert [(spec.name, spec.value) for spec in result.specs] == [
        ("Model", "10T7004BGE"),
        ("Processor", "Intel® Core i5-9400T"),
        ("Memory", "1x 8GB DDR4"),
        ("End of Support", "2025-01-26"),
    ]
    assert parse_details(None, "10T7004BGE").specs == ()
    assert parse_details({"Detail": None}, "10T7004BGE").specs == ()


def test_page_url_only_to_psref() -> None:
    assert page_url("https://example.com/x", "10T7004BGE") == (
        "https://psref.lenovo.com/Search?kw=10T7004BGE"
    )
    assert page_url("javascript:alert(1)", "X") == "https://psref.lenovo.com/Search?kw=X"
    assert page_url("https://psref.lenovo.com:8443/a", "X").endswith("/Search?kw=X")


def test_fetch_with_mock_transport() -> None:
    seen: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        code = request.url.path.rsplit("/", 1)[-1]
        if code == "10T7004BGE":
            return httpx.Response(200, json=ANSWER)
        if code == "AAAA000000":
            return httpx.Response(404)
        if code == "BBBB000000":
            return httpx.Response(200, text="null")
        return httpx.Response(500, text="Fehler")

    with httpx.Client(transport=httpx.MockTransport(answer)) as http:
        found = fetch_with(http, "10t7004bge")
        assert found.specs and found.name == "ThinkCentre M720 Tiny"
        assert fetch_with(http, "AAAA000000").specs == ()
        assert fetch_with(http, "BBBB000000").specs == ()
        with pytest.raises(PsrefError, match="antwortet mit 500"):
            fetch_with(http, "CCCC000000")
        with pytest.raises(PsrefError, match="Kein Maschinentyp"):
            fetch_with(http, "../../x")
    first = seen[0]
    assert str(first.url) == (
        "https://psrefapi.lenovo.com/psref/mobile/model/ModelDetails/10T7004BGE"
    )
    assert first.headers["User-Agent"] == USER_AGENT
    # Das ungültige MTM wurde nie gesendet
    assert len(seen) == 4


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
        self.calls: list[str] = []
        self.fail = False

    def __call__(self, mtm: str) -> PsrefResult:
        self.calls.append(mtm)
        if self.fail:
            raise PsrefError("PSREF nicht erreichbar: ConnectError")
        if mtm == "10T7004BGE":
            return PsrefResult(
                name="ThinkCentre M720 Tiny",
                url="https://psref.lenovo.com/Detail/ThinkCentre/X?M=10T7004BGE",
                specs=(Spec("Processor", "Intel Core i5"),),
            )
        return PsrefResult(name="", url="https://psref.lenovo.com/Search?kw=X", specs=())


@pytest.mark.db
def test_run_psref_only_when_enabled_and_due(db: Session) -> None:
    tiny = hardware(db, "PC", "Lenovo", "10T7004BGE", "PS-1")
    unknown = hardware(db, "Notebook", "Lenovo", "21AAZZZZZZ", "PS-2")
    hardware(db, "Monitor", "Lenovo", "T24D-4t", "PS-3")
    hardware(db, "Notebook", "Hersteller A", "1234567890", "PS-4")
    fake = FakeFetcher()

    assert run_psref(db, fake, pause=0) == 0
    enable(db)
    assert run_psref(db, fake, pause=0) == 2
    # Nur Lenovo-Modelle mit MTM, keine Monitore, keine anderen Hersteller
    assert sorted(fake.calls) == ["10T7004BGE", "21AAZZZZZZ"]

    tiny_model = db.get(InventoryModel, tiny.model_id)
    unknown_model = db.get(InventoryModel, unknown.model_id)
    assert tiny_model and unknown_model
    assert tiny_model.psref_status == "ok" and tiny_model.psref_specs
    assert unknown_model.psref_status == "nicht_gefunden"

    # Gleich danach nichts fällig; nach 8 Tagen nur das nicht gefundene Modell
    fake.calls.clear()
    assert run_psref(db, fake, pause=0) == 0
    later = datetime.now(UTC) + timedelta(days=8)
    assert not due(tiny_model, later) and due(unknown_model, later)

    # Fehler: Status „fehler“, alte Daten bleiben
    fake.fail = True
    tiny_model.psref_checked_at = datetime.now(UTC) - timedelta(days=31)
    db.commit()
    assert run_psref(db, fake, pause=0) == 1
    db.refresh(tiny_model)
    assert tiny_model.psref_status == "fehler" and tiny_model.psref_specs
    assert tiny_model.psref_error == "PSREF nicht erreichbar: ConnectError"

    # Klappt es wieder, ist der Grund weg
    fake.fail = False
    tiny_model.psref_checked_at = datetime.now(UTC) - timedelta(days=31)
    db.commit()
    assert run_psref(db, fake, pause=0) == 1
    db.refresh(tiny_model)
    assert tiny_model.psref_status == "ok" and tiny_model.psref_error == ""


@pytest.mark.db
def test_psref_in_hardware_view_and_refresh_endpoint(db: Session) -> None:
    tiny = hardware(db, "PC", "Lenovo", "10T7004BGE", "PS-11")
    other = hardware(db, "Monitor", "Lenovo", "T24D-4t", "PS-12")
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
    assert psref["specs"] == [{"name": "Processor", "value": "Intel Core i5"}]
    assert (
        reader.get(f"{BASE}/hardware/{tiny.id}")
        .json()["psref"]["url"]
        .startswith("https://psref.lenovo.com/")
    )
    # Monitor ohne MTM
    assert editor.post(f"{BASE}/hardware/{other.id}/psref", headers=HEADERS).status_code == 409

    # Fehler: Grund in der Ansicht und im Protokoll, Merkmale nur bei „ok“
    fake.fail = True
    failed = editor.post(url, headers=HEADERS).json()["psref"]
    assert failed["status"] == "fehler" and failed["specs"] == []
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
