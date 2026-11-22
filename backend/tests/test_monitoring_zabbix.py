"""IT-Monitoring: Quelle Zabbix (API-Client 7.x und 8.0, Collector, API, Verwaltung)."""

import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_admin_settings import HEADERS, admin, settings_with_key
from tests.test_auth import client_for, login_as, make_app
from werkbank.config import Settings
from werkbank.core.app_settings import (
    ZABBIX_KEY,
    ZABBIX_OPTIONS_KEY,
    encrypt_secret,
    set_setting,
)
from werkbank.core.models import AppSetting
from werkbank.core.sessions import now_utc
from werkbank.modules.inventory.models import (
    InventoryCity,
    InventoryEvent,
    InventoryHardware,
    InventoryKind,
    InventorySite,
)
from werkbank.modules.monitoring.notifications import zabbix_notifications
from werkbank.modules.monitoring.zabbix import collector, reports
from werkbank.modules.monitoring.zabbix.admin import get_zabbix_transport
from werkbank.modules.monitoring.zabbix.api import maintenance_state
from werkbank.modules.monitoring.zabbix.client import (
    RoleCheck,
    ZabbixClient,
    ZabbixConfig,
    ZabbixError,
    parse_version,
    role_findings,
    valid_zabbix_url,
)
from werkbank.modules.monitoring.zabbix.config import frontend_url
from werkbank.modules.monitoring.zabbix.inventory import norm_serial
from werkbank.modules.monitoring.zabbix.models import (
    ZbxDowntime,
    ZbxGroupSite,
    ZbxHost,
    ZbxHostLink,
    ZbxMaintenance,
    ZbxMaintLog,
    ZbxOutage,
    ZbxProblem,
    ZbxReportDay,
    ZbxRun,
    ZbxStatus,
    ZbxTriggerStat,
    ZbxUnmonitored,
)

FIXTURES = Path(__file__).parent / "fixtures" / "zabbix"
VERSIONS = ["zabbix-7.0", "zabbix-8.0"]
CONFIG = ZabbixConfig(url="https://zabbix.example.com", token="zbx-geheim")  # noqa: S106


class FakeZabbix:
    """Beantwortet JSON-RPC-Anfragen aus den nachgebildeten Antworten und merkt sich alles."""

    def __init__(self, name: str) -> None:
        self.data: dict[str, Any] = json.loads((FIXTURES / f"{name}.json").read_text("utf-8"))
        self.calls: list[tuple[str, Any, bool]] = []
        self.fail: str | None = None
        self.errors: dict[str, dict[str, Any]] = {}
        # Antworten, die von den Parametern abhängen (z. B. event.get)
        self.handlers: dict[str, Any] = {}

    def __call__(self, config: ZabbixConfig, body: dict[str, Any], with_token: bool) -> Any:
        assert "auth" not in body
        method = body["method"]
        self.calls.append((method, body["params"], with_token))
        if self.fail:
            raise ZabbixError(self.fail)
        if method in self.errors:
            return {"jsonrpc": "2.0", "error": self.errors[method], "id": body["id"]}
        if method in self.handlers:
            return {
                "jsonrpc": "2.0",
                "result": self.handlers[method](body["params"]),
                "id": body["id"],
            }
        return {"jsonrpc": "2.0", "result": self.data[method], "id": body["id"]}


# --- ohne Datenbank -------------------------------------------------------------------


def test_url_and_version() -> None:
    assert valid_zabbix_url("https://zabbix.example.com")
    assert valid_zabbix_url("https://example.com/zabbix")
    assert not valid_zabbix_url("http://zabbix.example.com")
    assert not valid_zabbix_url("https://zabbix.example.com/api_jsonrpc.php")
    assert not valid_zabbix_url("https://user:pw@zabbix.example.com")
    assert CONFIG.api_url == "https://zabbix.example.com/api_jsonrpc.php"
    assert parse_version("7.0.21").major == 7
    assert parse_version("8.0.0").supported
    assert not parse_version("6.4.1").supported
    with pytest.raises(ZabbixError):
        parse_version("unbekannt")


@pytest.mark.parametrize("name", VERSIONS)
def test_client_reads_both_versions(name: str) -> None:
    fake = FakeZabbix(name)
    client = ZabbixClient(CONFIG, fake)
    assert client.version().major in (7, 8)
    hosts = {host.hostid: host for host in client.hosts(details=True)}
    assert hosts["10101"].serial == "SN-1001" and hosts["10101"].reachable is True
    assert hosts["10101"].groups == [("21", "Standort A/Server")]
    assert hosts["10102"].reachable is False
    assert hosts["10102"].interfaces[0].address == "sw-b.example.com"
    assert hosts["10102"].serial == ""  # Inventar ausgeschaltet: leere Liste
    assert hosts["10103"].in_maintenance and hosts["10103"].maintenanceid == "301"
    assert hosts["10104"].monitored is False and hosts["10104"].reachable is None
    problems = client.problems()
    assert problems[0].severity == 4 and problems[0].tags == [("scope", "availability")]
    assert client.trigger_hosts(["9001"]) == {
        "9001": ["10102"],
        "9002": ["10101"],
        "9003": ["10101"],
    }
    maintenances = {item.maintenanceid: item for item in client.maintenances()}
    assert maintenances["301"].once == [(1700000000, 1700003600)]
    assert maintenances["302"].recurring == ["wöchentlich Di 20:00, 3 Std."]
    assert maintenances["302"].with_data is False
    # apiinfo.version und user.checkAuthentication ohne Token, alles andere mit Bearer
    tokenless = {method for method, _, with_token in fake.calls if not with_token}
    assert tokenless == {"apiinfo.version"}
    assert not any(method.startswith("hostinterface.") for method, _, _ in fake.calls)
    host_call = next(params for method, params, _ in fake.calls if method == "host.get")
    assert "selectInterfaces" in host_call


def test_transport_sets_bearer_header(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"jsonrpc": "2.0", "result": "7.0.21", "id": 1})

    transport = httpx.MockTransport(handler)
    original = httpx.Client

    def client(*args: Any, **kwargs: Any) -> httpx.Client:
        kwargs["transport"] = transport
        return original(*args, **kwargs)

    monkeypatch.setattr(httpx, "Client", client)
    zabbix = ZabbixClient(CONFIG)
    zabbix.call("host.get", {})
    zabbix.version()
    assert seen[0].headers["Authorization"] == "Bearer zbx-geheim"
    assert "auth" not in json.loads(seen[0].content)
    assert "Authorization" not in seen[1].headers
    assert str(seen[0].url) == "https://zabbix.example.com/api_jsonrpc.php"


def test_errors_are_readable() -> None:
    fake = FakeZabbix("zabbix-7.0")
    fake.errors["problem.get"] = {
        "code": -32602,
        "message": "Invalid params.",
        "data": 'No permissions to call "problem.get".',
    }
    fake.errors["host.get"] = {
        "code": -32602,
        "message": "Invalid params.",
        "data": "Not authorized.",
    }
    client = ZabbixClient(CONFIG, fake)
    with pytest.raises(ZabbixError, match=r"erlaubt „problem\.get“ nicht"):
        client.problems()
    with pytest.raises(ZabbixError, match="Token ab"):
        client.hosts(details=False)


def test_role_findings() -> None:
    needed = [
        "problem.get",
        "trigger.get",
        "host.get",
        "hostgroup.get",
        "maintenance.get",
        "event.get",
        "role.get",
        "token.get",
    ]
    assert role_findings(RoleCheck("r", True, "allow", sorted(needed))) == []
    assert "Platzhalter" in role_findings(RoleCheck("r", True, "allow", ["*"]))[0]
    assert "Ablehn-Liste" in role_findings(RoleCheck("r", True, "deny", []))[0]
    assert "leer" in role_findings(RoleCheck("r", True, "allow", []))[0]
    assert "keinen API-Zugriff" in role_findings(RoleCheck("r", False, "allow", needed))[0]
    findings = role_findings(RoleCheck("r", True, "allow", [*needed, "host.update", "item.get"]))
    assert any("schreibende Methoden: host.update" in item for item in findings)
    assert any("mehr als nötig: item.get" in item for item in findings)
    assert any(
        "Es fehlen: token.get" in item
        for item in role_findings(RoleCheck("r", True, "allow", needed[:-1]))
    )


def test_maintenance_state() -> None:
    now = now_utc()
    base = {
        "maintenanceid": "1",
        "name": "x",
        "with_data": True,
        "active_since": now - timedelta(days=1),
        "active_till": now + timedelta(days=1),
        "hostids": [],
        "groupids": [],
        "recurring": [],
    }
    ts = now.timestamp()
    assert maintenance_state(ZbxMaintenance(**base, once=[]), {"1"}, now) == "laeuft"
    soon = ZbxMaintenance(**base, once=[[int(ts) + 600, int(ts) + 4200]])
    assert maintenance_state(soon, set(), now) == "demnaechst"
    over = ZbxMaintenance(**base, once=[[int(ts) - 7200, int(ts) - 3600]])
    assert maintenance_state(over, set(), now) == "abgelaufen"
    weekly = ZbxMaintenance(**{**base, "recurring": ["wöchentlich"]}, once=[])
    assert maintenance_state(weekly, set(), now) == "geplant"
    later = ZbxMaintenance(**{**base, "active_since": now + timedelta(days=2)}, once=[])
    assert maintenance_state(later, set(), now) == "demnaechst"


# --- mit Datenbank --------------------------------------------------------------------


@pytest.fixture
def db(migrated_db: None, db_session: Session) -> Session:
    for table in (
        ZbxOutage,
        ZbxTriggerStat,
        ZbxDowntime,
        ZbxReportDay,
        ZbxMaintLog,
        ZbxHostLink,
        ZbxUnmonitored,
        ZbxGroupSite,
        ZbxProblem,
        ZbxMaintenance,
        ZbxHost,
        ZbxRun,
        ZbxStatus,
        AppSetting,
    ):
        db_session.execute(delete(table))
    db_session.commit()
    return db_session


def configure(db: Session, settings: Settings, enabled: bool = True) -> None:
    set_setting(
        db,
        ZABBIX_KEY,
        {
            "enabled": enabled,
            "url": "https://zabbix.example.com",
            "token_encrypted": encrypt_secret(settings, "zbx-geheim"),
            "ca_pem": None,
        },
        None,
    )
    db.commit()


def site(db: Session, name: str = "Gebäude A") -> int:
    city = db.scalar(select(InventoryCity).where(InventoryCity.name == "Beispielstadt"))
    if city is None:
        city = InventoryCity(name="Beispielstadt")
        db.add(city)
        db.flush()
    entry = db.scalar(select(InventorySite).where(InventorySite.name == name))
    if entry is None:
        entry = InventorySite(city_id=city.id, name=name)
        db.add(entry)
        db.flush()
    db.commit()
    return entry.id


@pytest.mark.db
@pytest.mark.parametrize("name", VERSIONS)
def test_collect_stores_state(db: Session, tmp_path: Path, name: str) -> None:
    settings = settings_with_key(tmp_path)
    assert collector.collect(db, settings, FakeZabbix(name)) == []  # nicht eingerichtet
    configure(db, settings)
    fake = FakeZabbix(name)
    runs = collector.collect(db, settings, fake)
    assert [run.task for run in runs] == ["stammdaten", "wartungen", "schnell", "berichte"]
    assert all(run.ok for run in runs)
    hosts = {row.hostid: row for row in db.scalars(select(ZbxHost))}
    assert set(hosts) == {"10101", "10102", "10103", "10104"}
    assert hosts["10101"].serial == "SN-1001"
    problems = {row.eventid: row for row in db.scalars(select(ZbxProblem))}
    assert problems["5001"].hostid == "10102"
    status = db.get(ZbxStatus, 1)
    assert status is not None and status.version == fake.data["apiinfo.version"]
    hints = status.account["hinweise"]
    assert (any("host.update" in hint for hint in hints)) == name.endswith("8.0")
    # Gleich danach ist nichts fällig
    assert collector.collect(db, settings, fake) == []
    # Zabbix fällt aus: Lauf fehlgeschlagen, alter Stand bleibt
    db.execute(delete(ZbxRun))
    db.commit()
    fake.fail = "Zabbix ist nicht erreichbar. Bitte die Adresse prüfen."
    failed = [run for run in collector.collect(db, settings, fake) if run.task != "berichte"]
    assert failed and not any(run.ok for run in failed)
    assert db.scalar(select(ZbxProblem).where(ZbxProblem.eventid == "5001")) is not None
    assert failed[-1].error == fake.fail


@pytest.mark.db
def test_notifications_after_three_failures(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    now = now_utc()
    for minutes in range(2):
        db.add(ZbxRun(task="schnell", started_at=now - timedelta(minutes=5 - minutes), ok=False))
    db.commit()
    assert list(zabbix_notifications(db, settings, now)) == []
    db.add(ZbxRun(task="schnell", started_at=now, ok=False))
    db.add(
        ZbxStatus(
            id=1,
            version="7.0.21",
            account={
                "rolle": "Werkbank lesen",
                "hinweise": ["Die Rolle erlaubt Methoden mit Platzhalter („*“)."],
                "token_ablauf": int((now + timedelta(days=10)).timestamp()),
            },
        )
    )
    db.commit()
    kinds = sorted(event.kind for event in zabbix_notifications(db, settings, now))
    assert kinds == [
        "monitoring.zabbix_dienstkonto",
        "monitoring.zabbix_dienstkonto",
        "monitoring.zabbix_fehler",
    ]
    # gleicher Schlüssel bei gleichem Stand
    first = [event.key for event in zabbix_notifications(db, settings, now)]
    assert first == [event.key for event in zabbix_notifications(db, settings, now)]


@pytest.mark.db
def test_api_overview_hosts_and_rights(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    configure(db, settings)
    collector.collect(db, settings, FakeZabbix("zabbix-8.0"))
    site_id = site(db)
    db.add(ZbxGroupSite(groupid="21", group_name="Standort A/Server", site_id=site_id, position=0))
    db.commit()
    collector.assign_sites(db)
    set_setting(
        db,
        ZABBIX_OPTIONS_KEY,
        {"certificate_tag": {"tag": "component", "value": "certificate"}},
        None,
    )
    db.commit()
    client = client_for(make_app(settings))
    login_as(client, ["Bestand.Reader"], oid="zbx-fremd")
    assert client.get("/api/monitoring/zabbix").status_code == 403
    login_as(client, ["Monitoring.Reader"], oid="zbx-leser")
    data = client.get("/api/monitoring/zabbix").json()
    assert data["state"]["configured"] is True and data["state"]["stale"] is False
    assert data["kpis"] == {
        "problems": 2,
        "by_severity": {"4": 1, "2": 1},
        "hosts": 3,
        "unreachable": 1,
        "maintenance": 1,
    }
    assert data["problems"][0]["host"] == "Switch B"
    assert data["problems"][0]["name"] == "Switch B ist nicht erreichbar <script>"
    assert data["problems"][0]["link"] == (
        "https://zabbix.example.com/tr_events.php?triggerid=9001&eventid=5001"
    )
    assert [entry["name"] for entry in data["unreachable"]] == ["Switch B"]
    assert data["todo"]["long_open"] == 2
    assert [entry["eventid"] for entry in data["todo"]["certificates"]] == ["5002"]
    assert data["sites"] == ["Gebäude A (Beispielstadt)"]
    assert "zbx-geheim" not in json.dumps(data)

    rows = {row["hostid"]: row for row in client.get("/api/monitoring/zabbix/hosts").json()}
    assert rows["10101"]["site"] == "Gebäude A (Beispielstadt)"
    assert rows["10101"]["problems"] == 1 and rows["10101"]["worst"] == 2
    detail = client.get("/api/monitoring/zabbix/hosts/10103").json()
    assert detail["maintenance"] == "Firmware Strom" and detail["site"] is not None
    assert detail["link"].endswith("hostids%5B%5D=10103")
    assert client.get("/api/monitoring/zabbix/hosts/abc").status_code == 404
    states = {
        item["name"]: item["state"]
        for item in client.get("/api/monitoring/zabbix/maintenances").json()
    }
    assert states["Firmware Strom"] == "laeuft"
    assert states["Kommt noch"] == "demnaechst"
    # Verbindungsseite nur für Admins
    assert client.get("/api/monitoring/zabbix/connection").status_code == 403


@pytest.mark.db
def test_admin_settings_and_mapping(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    fake = FakeZabbix("zabbix-7.0")
    client = admin(settings)
    client.app.dependency_overrides[get_zabbix_transport] = lambda: fake  # type: ignore[attr-defined]
    base = "/api/admin/settings/zabbix"
    assert client.get(base).json()["token_set"] is False
    bad = client.put(
        base, json={"enabled": True, "url": "http://zabbix.example.com"}, headers=HEADERS
    )
    assert bad.status_code == 422
    missing = client.put(
        base, json={"enabled": True, "url": "https://zabbix.example.com"}, headers=HEADERS
    )
    assert missing.status_code == 422
    saved = client.put(
        base,
        json={
            "enabled": True,
            "url": "https://zabbix.example.com/api_jsonrpc.php",
            "token": "zbx-geheim",
        },
        headers=HEADERS,
    ).json()
    assert saved["url"] == "https://zabbix.example.com" and saved["token_set"] is True
    assert "zbx-geheim" not in json.dumps(saved)
    assert saved["link_url"] == ""
    assert frontend_url(db) == "https://zabbix.example.com"
    bad_link = client.put(
        base,
        json={"enabled": True, "url": "https://zabbix.example.com", "link_url": "javascript:x"},
        headers=HEADERS,
    )
    assert bad_link.status_code == 422
    linked = client.put(
        base,
        json={
            "enabled": True,
            "url": "https://zabbix.example.com",
            "link_url": "https://monitor.example.com/zabbix/",
        },
        headers=HEADERS,
    ).json()
    assert linked["link_url"] == "https://monitor.example.com/zabbix" and linked["token_set"]
    db.expire_all()
    assert frontend_url(db) == "https://monitor.example.com/zabbix"
    test = client.post(f"{base}/test", headers=HEADERS).json()
    assert test["version"] == "7.0.21" and test["hosts"] == 4 and test["findings"] == []
    assert test["role"] == "Werkbank lesen" and test["token_never_expires"] is False

    collector.collect(db, settings, fake)
    site_id = site(db)
    page = client.get("/api/monitoring/zabbix/connection").json()
    assert page["version"] == "7.0.21"
    assert {group["groupid"] for group in page["groups"]} == {"21", "22", "23"}
    assert [task["task"] for task in page["tasks"]] == [
        "schnell",
        "wartungen",
        "stammdaten",
        "berichte",
    ]
    assert all(task["ok"] for task in page["tasks"])
    saved_options = client.put(
        "/api/monitoring/zabbix/connection",
        json={
            "mapping": [{"groupid": "23", "group_name": "Strom", "site_id": site_id}],
            "certificate_tag": "component",
            "certificate_value": "certificate",
            "target": 99.9,
        },
        headers=HEADERS,
    )
    assert saved_options.status_code == 200, saved_options.text
    assert saved_options.json()["target"] == 99.9
    too_high = client.put(
        "/api/monitoring/zabbix/connection",
        json={"mapping": [], "target": 101},
        headers=HEADERS,
    )
    assert too_high.status_code == 422
    assert db.get(ZbxHost, "10103").site_id == site_id  # type: ignore[union-attr]
    db.expire_all()
    assert db.get(ZbxHost, "10101").site_id is None  # type: ignore[union-attr]
    unknown = client.put(
        "/api/monitoring/zabbix/connection",
        json={"mapping": [{"groupid": "23", "group_name": "Strom", "site_id": 999999}]},
        headers=HEADERS,
    )
    assert unknown.status_code == 422


def test_norm_serial() -> None:
    assert norm_serial(" sn-1001 ") == "SN-1001"
    assert norm_serial("SN 10 01") == "SN1001"
    assert norm_serial("") == ""


def kind(db: Session, name: str) -> int:
    entry = db.scalar(select(InventoryKind).where(InventoryKind.name == name))
    if entry is None:
        entry = InventoryKind(name=name)
        db.add(entry)
        db.flush()
    return entry.id


@pytest.mark.db
def test_inventory_gaps_and_actions(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    configure(db, settings)
    collector.collect(db, settings, FakeZabbix("zabbix-7.0"))
    for serial in ("SN-1001", " sn-1001", "ZBX-SRV-2", "ZBX-SRV-3", "ZBX-NB-1"):
        for row in db.scalars(select(InventoryHardware).where(InventoryHardware.serial == serial)):
            db.delete(row)
    db.commit()
    server = kind(db, "Server (Zabbix-Test)")
    notebook = kind(db, "Notebook (Zabbix-Test)")
    matched_device = InventoryHardware(kind_id=server, name="Server A", serial=" sn-1001")
    missing = InventoryHardware(kind_id=server, name="Server ohne Host", serial="ZBX-SRV-2")
    spare = InventoryHardware(kind_id=server, name="Ersatzserver", serial="ZBX-SRV-3")
    laptop = InventoryHardware(kind_id=notebook, name="Notebook", serial="ZBX-NB-1")
    db.add_all([matched_device, missing, spare, laptop])
    db.commit()
    set_setting(db, ZABBIX_OPTIONS_KEY, {"certificate_tag": None, "kind_ids": [server]}, None)
    db.commit()

    client = client_for(make_app(settings))
    login_as(client, ["Monitoring.Reader"], oid="zbx-nur-lesen")
    rows = {row["hostid"]: row for row in client.get("/api/monitoring/zabbix/hosts").json()}
    assert rows["10101"]["device"]["id"] == matched_device.id
    assert rows["10101"]["match"] == "seriennummer"
    assert rows["10103"]["gap"] == "seriennummer_fehlt"
    assert rows["10102"]["gap"] == "seriennummer_fehlt"
    assert rows["10104"]["gap"] is None  # abgeschaltet
    data = client.get("/api/monitoring/zabbix/unmonitored").json()
    missing_ids = {row["id"] for row in data["missing"]}
    assert {missing.id, spare.id} <= missing_ids
    assert laptop.id not in missing_ids and matched_device.id not in missing_ids
    todo = client.get("/api/monitoring/zabbix").json()["todo"]
    assert todo["no_serial"] == 2 and todo["unmonitored"] >= 2
    # Ohne Bestand.Editor kein Markieren und Zuordnen
    assert (
        client.put(
            f"/api/monitoring/zabbix/devices/{spare.id}/unmonitored",
            json={"reason": "Ersatzgerät im Lager"},
            headers=HEADERS,
        ).status_code
        == 403
    )

    login_as(client, ["Monitoring.Reader", "Bestand.Editor"], oid="zbx-bestand")
    marked = client.put(
        f"/api/monitoring/zabbix/devices/{spare.id}/unmonitored",
        json={"reason": "Ersatzgerät im Lager"},
        headers=HEADERS,
    ).json()
    assert spare.id not in {row["id"] for row in marked["missing"]}
    assert [row["reason"] for row in marked["excluded"] if row["id"] == spare.id] == [
        "Ersatzgerät im Lager"
    ]
    events = [
        event.text
        for event in db.scalars(
            select(InventoryEvent).where(InventoryEvent.hardware_id == spare.id)
        )
    ]
    assert "Bewusst nicht in Zabbix überwacht: Ersatzgerät im Lager" in events

    # Host ohne Seriennummer von Hand zuordnen; mit Seriennummer geht das nicht
    linked = client.post(
        "/api/monitoring/zabbix/hosts/10103/link",
        json={"hardware_id": missing.id},
        headers=HEADERS,
    ).json()
    assert linked["device"]["id"] == missing.id and linked["match"] == "hand"
    assert linked["gap"] is None
    assert (
        client.post(
            "/api/monitoring/zabbix/hosts/10101/link",
            json={"hardware_id": missing.id},
            headers=HEADERS,
        ).status_code
        == 409
    )
    data = client.get("/api/monitoring/zabbix/unmonitored").json()
    assert missing.id not in {row["id"] for row in data["missing"]}
    unlinked = client.delete("/api/monitoring/zabbix/hosts/10103/link", headers=HEADERS).json()
    assert unlinked["device"] is None and unlinked["gap"] == "seriennummer_fehlt"
    back = client.delete(
        f"/api/monitoring/zabbix/devices/{spare.id}/unmonitored", headers=HEADERS
    ).json()
    assert spare.id in {row["id"] for row in back["missing"]}


# --- Berichte -------------------------------------------------------------------------


def test_intervals_and_days() -> None:
    assert reports.merge([(5, 8), (1, 3), (2, 4), (8, 9)]) == [(1, 4), (5, 9)]
    assert reports.subtract([(0, 10)], [(2, 3), (5, 12)]) == [(0, 2), (3, 5)]
    assert reports.subtract([(0, 10)], []) == [(0, 10)]
    assert reports.total([(0, 2), (3, 5)]) == 4
    start, end = reports.day_bounds(date(2026, 3, 29))  # Zeitumstellung: 23 Stunden
    assert end - start == 23 * 3600


def at(day: date, hour: float) -> int:
    start, _ = reports.day_bounds(day)
    return int(start + hour * 3600)


def event(
    eventid: str, hostid: str, clock: int, r_eventid: str = "0", name: str = ""
) -> dict[str, Any]:
    return {
        "eventid": eventid,
        "objectid": f"90{eventid}",
        "name": name or f"Ausfall {eventid}",
        "severity": "4",
        "clock": str(clock),
        "r_eventid": r_eventid,
        "hosts": [{"hostid": hostid}],
    }


@pytest.mark.db
def test_reports_downtime_and_rights(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    configure(db, settings)
    fake = FakeZabbix("zabbix-8.0")
    collector.collect(db, settings, fake)
    site_id = site(db)
    db.add(ZbxGroupSite(groupid="21", group_name="Standort A/Server", site_id=site_id, position=0))
    db.commit()
    collector.assign_sites(db)
    db.commit()

    day = reports.local_day(now_utc()) - timedelta(days=1)
    status = db.get(ZbxStatus, 1)
    assert status is not None and status.reports_since == day + timedelta(days=1)
    status.reports_since = day
    # Wartung von Server A 10 bis 11 Uhr (eigene Beobachtung)
    db.add(
        ZbxMaintLog(
            hostid="10101",
            started_at=datetime.fromtimestamp(at(day, 10), UTC),
            ended_at=datetime.fromtimestamp(at(day, 11), UTC),
        )
    )
    db.commit()
    outages = [
        event("701", "10102", at(day, 8)),  # Switch B: seit 8 Uhr offen
        event("702", "10101", at(day, 10.5), "801"),  # bis 12 Uhr, teils in Wartung
        event("703", "10101", at(day, 11.5), "802"),  # bis 12:30, überlappt
        event("704", "10101", at(day, -30), "803"),  # vor dem Tag beendet
    ]
    other = event("705", "10101", at(day, 9), "804", name="Hohe Last")
    clocks = {"801": at(day, 12), "802": at(day, 12.5), "803": at(day, -29), "804": at(day, 9.25)}

    def events(params: dict[str, Any]) -> list[dict[str, Any]]:
        if "eventids" in params:
            return [
                {"eventid": eventid, "clock": str(clocks[eventid])}
                for eventid in params["eventids"]
            ]
        if "tags" in params:
            assert params["tags"][0]["tag"] == "scope" and params["severities"] == [4, 5]
            return outages
        return [*outages[:3], other]

    fake.handlers["event.get"] = events
    now = datetime.fromtimestamp(at(day, 30), UTC)
    assert reports.run_reports(db, ZabbixClient(CONFIG, fake), now) == {"tage": 1}
    rows = {row.hostid: row for row in db.scalars(select(ZbxDowntime))}
    _, end = reports.day_bounds(day)
    assert rows["10101"].maintenance_s == 3600
    assert rows["10101"].downtime_s == 5400  # 11:00 bis 12:30
    assert rows["10102"].downtime_s == end - at(day, 8)
    assert rows["10104"].monitored_s == 0  # in Zabbix abgeschaltet
    assert rows["10101"].site == "Gebäude A (Beispielstadt)"
    assert db.get(ZbxOutage, "701") is not None and db.get(ZbxOutage, "704") is None
    # Nichts mehr offen
    assert reports.run_reports(db, ZabbixClient(CONFIG, fake), now) == {"tage": 0}

    client = client_for(make_app(settings))
    login_as(client, ["Monitoring.Reader"], oid="zbx-bericht-leser")
    data = client.get("/api/monitoring/zabbix/reports").json()
    assert data["detail"] is True and data["target"] == 99.5
    assert data["days"] == 1 and data["since"] == day.isoformat()
    names = {row["name"]: row for row in data["rows"]}
    assert names["Gebäude A (Beispielstadt)"]["downtime_s"] == 5400
    assert data["triggers"][0]["count"] >= 1
    assert data["outages"][0]["host"] == "Switch B"
    by_group = client.get("/api/monitoring/zabbix/reports?split=gruppe").json()
    assert {row["name"] for row in by_group["rows"]} >= {"Standort A/Server"}
    assert client.get("/api/monitoring/zabbix/reports?split=host").status_code == 422

    # Nur Berichte: Summen, keine Hostnamen und Auslöser, keine anderen Seiten
    reporter = client_for(make_app(settings))
    login_as(reporter, ["Monitoring.Berichte"], oid="zbx-bericht-gf")
    limited = reporter.get("/api/monitoring/zabbix/reports").json()
    assert limited["detail"] is False
    assert limited["triggers"] is None and limited["outages"] is None
    assert "Switch B" not in json.dumps(limited)
    assert reporter.get("/api/monitoring/zabbix/hosts").status_code == 403
    assert reporter.get("/api/monitoring/zabbix").status_code == 403
    csv_response = reporter.get("/api/monitoring/zabbix/reports/export.csv")
    assert csv_response.status_code == 200
    text = csv_response.content.decode("utf-8-sig")
    assert text.startswith("Standort;Hosts;Verfügbarkeit %") and "Gesamt" in text
    assert "Switch B" not in text
    assert (
        reporter.post(
            "/api/monitoring/zabbix/reports/printed",
            json={"year": data["year"], "split": "standort"},
            headers=HEADERS,
        ).status_code
        == 200
    )
    nobody = client_for(make_app(settings))
    login_as(nobody, ["Budget.Reader"], oid="zbx-bericht-niemand")
    assert nobody.get("/api/monitoring/zabbix/reports").status_code == 403


def test_csv_cells_are_safe() -> None:
    from werkbank.core.audit_api import safe_cell

    assert safe_cell("=SUMME(A1)") == "'=SUMME(A1)"


@pytest.mark.db
def test_maintenance_is_observed(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    configure(db, settings)
    collector.collect(db, settings, FakeZabbix("zabbix-8.0"))
    logs = list(db.scalars(select(ZbxMaintLog)))
    assert [log.hostid for log in logs] == ["10103"]
    host = db.get(ZbxHost, "10103")
    assert host is not None
    later = logs[0].ended_at + timedelta(minutes=1)
    reports.observe_maintenance(db, [host], later)
    db.commit()
    assert [log.ended_at for log in db.scalars(select(ZbxMaintLog))] == [later]
    much_later = later + timedelta(minutes=30)
    reports.observe_maintenance(db, [host], much_later)
    db.commit()
    assert len(list(db.scalars(select(ZbxMaintLog)))) == 2


def test_redirect_is_explained_not_followed() -> None:
    from werkbank.modules.monitoring.zabbix.client import redirect_message

    text = redirect_message(302, "https://login.example.com/authorize?state=geheim&x=1")
    assert "login.example.com/authorize" in text and "geheim" not in text
    assert "HTTP 302" in redirect_message(302, None)


def test_transport_does_not_follow_redirect(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(302, headers={"location": "https://sso.example.com/login?rd=x"})

    transport = httpx.MockTransport(handler)
    original = httpx.Client

    def client(*args: Any, **kwargs: Any) -> httpx.Client:
        kwargs["transport"] = transport
        return original(*args, **kwargs)

    monkeypatch.setattr(httpx, "Client", client)
    with pytest.raises(ZabbixError, match=r"sso\.example\.com/login"):
        ZabbixClient(CONFIG).call("host.get", {})
    assert len(seen) == 1


def test_proxy_403_does_not_blame_token(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    transport = httpx.MockTransport(lambda request: httpx.Response(403, text="Forbidden"))
    original = httpx.Client

    def client(*args: Any, **kwargs: Any) -> httpx.Client:
        kwargs["transport"] = transport
        return original(*args, **kwargs)

    monkeypatch.setattr(httpx, "Client", client)
    with pytest.raises(ZabbixError, match=r"bevor sie Zabbix erreicht") as caught:
        ZabbixClient(CONFIG).call("host.get", {})
    assert "Token ungültig" not in str(caught.value)
