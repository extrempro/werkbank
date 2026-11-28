"""IT-Monitoring, NetBird: Abruf, Hinweise, Seiten, Rechte, Verwaltung (Phase 1).

Alle Antworten von NetBird sind erfundene Beispieldaten (sample.py).
"""

from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from tests.test_admin_settings import HEADERS, admin, settings_with_key
from tests.test_auth import client_for, login_as, make_app
from werkbank.config import Settings
from werkbank.core.app_settings import NETBIRD_KEY, encrypt_secret, set_setting
from werkbank.core.models import AppSetting, AuditLog, Job
from werkbank.core.sessions import now_utc
from werkbank.modules.monitoring.netbird import collector, hints, sample, views
from werkbank.modules.monitoring.netbird.admin import get_netbird_transport
from werkbank.modules.monitoring.netbird.client import (
    NetBirdClient,
    NetBirdConfig,
    NetBirdError,
    NotAvailableError,
)
from werkbank.modules.monitoring.netbird.models import NbCheck, NbDaily, NbPeerDay, NbRun, NbState
from werkbank.modules.monitoring.netbird.normalize import fetch
from werkbank.modules.monitoring.netbird.notifications import netbird_notifications

BASE = "/api/monitoring/netbird"
ADMIN = "/api/admin/settings/netbird"
CONFIG = NetBirdConfig(url="https://netbird.example.com", token="t")  # noqa: S106
CHECKER = sample.sample_checker()


def fetched() -> dict[str, Any]:
    return fetch(NetBirdClient(CONFIG, sample.sample_transport)).data


# --- ohne Datenbank ------------------------------------------------------------------------


def test_releases_behind_and_os_family() -> None:
    assert hints.releases_behind("0.60.2", "0.60.2") == 0
    assert hints.releases_behind("0.59.9", "0.60.0") == 1
    assert hints.releases_behind("v0.58.1", "0.60.2") == 2
    assert hints.releases_behind("development", "0.60.2") is None
    assert hints.releases_behind("0.60.2", "") is None
    assert views.os_family("Windows 11 Pro") == "Windows"
    assert views.os_family("Darwin 15.1") == "macOS"
    assert views.os_family("Ubuntu 24.04") == "Linux"
    assert views.os_family("") == "unbekannt"


def test_fetch_keeps_only_needed_fields() -> None:
    data = fetched()
    peer = next(p for p in data["peers"] if p["id"] == "p-07")
    assert peer["groups"] == ["g-it", "g-all"] and peer["user_id"] == "u-ina"
    assert "connection_ip" not in peer and "serial_number" not in peer
    assert peer["approval_required"] is None  # selbst gehostet: unbekannt
    users = {u["id"]: u["name"] for u in data["users"]}
    assert users["u-eva"] == "eva@example.com"  # ohne Namen: Adresse als Anzeige
    assert data["account"] == {
        "login_expiration_enabled": True,
        "login_expiration_seconds": 2592000,
    }
    assert data["version"]["available"] == "0.60.2" and data["notes"] == []


def test_fetch_optional_parts_and_required_parts() -> None:
    def partial(config: NetBirdConfig, path: str, params: Any) -> Any:
        if path in ("users", "instance/version"):
            raise NotAvailableError("fehlt")
        if path == "accounts":
            raise NetBirdError("Zugriff verweigert (HTTP 403).")
        return sample.sample_transport(config, path, params)

    data = fetch(NetBirdClient(CONFIG, partial)).data
    assert data["users"] is None and data["version"] is None and data["account"] is None
    assert data["notes"] == ["Kontoeinstellungen: Zugriff verweigert (HTTP 403)."]

    def broken(config: NetBirdConfig, path: str, params: Any) -> Any:
        return {"kein": "liste"}

    with pytest.raises(NetBirdError):
        fetch(NetBirdClient(CONFIG, broken))


def test_hints_on_sample() -> None:
    data = fetched()
    now = datetime.now(UTC)
    found = {(h.code, h.subject): h for h in hints.all_hints(data, now)}
    assert ("anmeldung", "peer:p-07") in found  # läuft in 5 Tagen ab
    assert ("version", "peer:p-19") in found and ("version", "peer:p-23") in found
    assert ("nicht_gesehen", "peer:p-23") in found
    assert ("nicht_gesehen", "peer:p-19") not in found  # erst 2 Tage
    assert ("anmeldung", "peer:p-19") not in found  # schon abgelaufen
    assert not any(code == "freigabe" for code, _ in found)
    levels = [h.level for h in hints.all_hints(data, now)]
    assert levels == sorted(levels, key=hints.LEVELS.index)
    # Freigabe nur, wenn NetBird sie liefert
    data["peers"][0]["approval_required"] = True
    assert any(h.code == "freigabe" for h in hints.all_hints(data, now))
    assert hints.status(data["peers"][0]) == "freigabe"
    assert views.routing_peers(data) == {"p-router-01", "p-router-02"}


# --- mit Datenbank -------------------------------------------------------------------------


@pytest.fixture
def db(migrated_db: None, db_session: Session) -> Session:
    for table in (NbState, NbRun, NbDaily, NbPeerDay, NbCheck, AppSetting):
        db_session.execute(delete(table))
    db_session.execute(delete(Job).where(Job.type == collector.NETBIRD_JOB))
    db_session.commit()
    return db_session


def configure(db: Session, settings: Settings) -> None:
    set_setting(
        db,
        NETBIRD_KEY,
        {"url": "https://netbird.example.com", "token_encrypted": encrypt_secret(settings, "t")},
        None,
    )
    db.commit()


@pytest.mark.db
def test_collect_state_history_and_failures(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    assert (
        collector.collect(db, settings, transport=sample.sample_transport, checker=CHECKER) is None
    )
    configure(db, settings)
    run = collector.collect(db, settings, transport=sample.sample_transport, checker=CHECKER)
    assert run is not None and run.ok
    state = db.get(NbState, 1)
    assert state is not None and len(state.data["peers"]) == 6
    today = collector.local_day(now_utc())
    daily = db.get(NbDaily, today)
    assert daily is not None and daily.max_connected == 3 and daily.total == 6
    assert set(db.scalars(select(NbPeerDay.peer_id))) == {"p-router-01", "p-07", "p-44"}
    # Alte Tageswerte fallen nach 90 Tagen weg
    db.add(NbDaily(day=today - timedelta(days=95), max_connected=1, total=1))
    db.add(NbPeerDay(peer_id="alt", day=date(2020, 1, 1)))
    db.commit()
    collector.collect(db, settings, transport=sample.sample_transport, checker=CHECKER)
    assert db.get(NbDaily, today - timedelta(days=95)) is None
    assert "alt" not in set(db.scalars(select(NbPeerDay.peer_id)))

    def failing(config: NetBirdConfig, path: str, params: Any) -> Any:
        raise NetBirdError("NetBird ist nicht erreichbar.")

    for _ in range(3):
        failed = collector.collect(db, settings, transport=failing, checker=CHECKER)
        assert failed is not None and not failed.ok
    assert db.get(NbState, 1) is not None  # letzter Stand bleibt
    events = list(netbird_notifications(db, settings, now_utc()))
    assert [e.title for e in events] == ["NetBird lässt sich nicht abrufen"]


@pytest.mark.db
def test_api_rights_overview_peers(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    configure(db, settings)
    collector.collect(db, settings, transport=sample.sample_transport, checker=CHECKER)
    client = client_for(make_app(settings))
    login_as(client, ["Werkbank.Admin", "Monitoring.Reader"], oid="nb-admin-ohne-recht")
    assert client.get(f"{BASE}/overview").status_code == 403
    assert client.get(f"{BASE}/peers").status_code == 403

    login_as(client, ["NetBird.Reader"], oid="nb-leser")
    overview = client.get(f"{BASE}/overview").json()
    assert overview["configured"] is True and overview["can_refresh"] is False
    assert overview["peers"] == 6 and overview["connected"] == 3
    assert overview["routers"] == 2 and overview["routers_offline"] == 1
    assert overview["hint_counts"]["warnung"] >= 3 and overview["hint_counts"]["info"] == 1
    assert overview["versions"]["neuestes"] == 4 and overview["versions"]["zwei"] == 2
    assert len(overview["chart"]) == 14 and overview["chart"][-1]["max_connected"] == 3
    assert len(client.get(f"{BASE}/overview", params={"days": 30}).json()["chart"]) == 30

    data = client.get(f"{BASE}/peers").json()
    assert data["total"] == 6 and data["can_export"] is False
    assert data["rows"][0]["hints"]  # mit Hinweis zuerst
    names = {r["name"]: r for r in data["rows"]}
    assert names["nb-peer-07"]["person"] == "Ina Beispiel"
    assert names["nb-peer-19"]["status"] == "abgelaufen"
    assert data["approval_known"] is False
    only = client.get(f"{BASE}/peers", params={"state": "offline"}).json()["rows"]
    assert {r["name"] for r in only} == {"nb-router-02"}
    assert (
        client.get(f"{BASE}/peers", params={"q": "ina"}).json()["rows"][0]["name"] == "nb-peer-07"
    )
    assert len(client.get(f"{BASE}/peers", params={"group": "g-vertrieb"}).json()["rows"]) == 2
    assert {
        r["os_family"] for r in client.get(f"{BASE}/peers", params={"os": "Linux"}).json()["rows"]
    } == {"Linux"}
    hinted = client.get(f"{BASE}/peers", params={"hinted": "true"}).json()["rows"]
    assert all(r["hints"] for r in hinted)
    assert client.get(f"{BASE}/peers", params={"state": "unsinn"}).status_code == 422

    detail = client.get(f"{BASE}/peers/p-07").json()
    assert detail["group_names"] == ["All", "grp-beispiel-it"]
    assert detail["login_expires"] and len(detail["history"]) == 7
    assert detail["history"][-1]["connected"] is True and detail["asset"] is None
    assert client.get(f"{BASE}/peers/gibt-es-nicht").status_code == 404

    # CSV und „Jetzt abrufen“ nur für System-Admins mit Recht
    assert client.get(f"{BASE}/peers.csv").status_code == 403
    assert client.post(f"{BASE}/refresh", headers=HEADERS).status_code == 403
    login_as(client, ["NetBird.Reader", "Werkbank.Admin"], oid="nb-admin-mit-recht")
    export = client.get(f"{BASE}/peers.csv")
    assert export.status_code == 200 and "Ina Beispiel" in export.text
    assert client.post(f"{BASE}/refresh", headers=HEADERS).json() == {"scheduled": True}
    assert db.scalar(select(func.count()).select_from(Job).where(Job.type == collector.NETBIRD_JOB))
    assert db.scalars(select(AuditLog).where(AuditLog.action == "netbird.export")).first()


@pytest.mark.db
def test_peer_detail_asset_hint(db: Session, tmp_path: Path) -> None:
    from werkbank.modules.inventory.models import InventoryHardware, InventoryKind

    settings = settings_with_key(tmp_path)
    configure(db, settings)
    collector.collect(db, settings, transport=sample.sample_transport, checker=CHECKER)
    kind = db.scalars(select(InventoryKind).limit(1)).first()
    if kind is None:
        kind = InventoryKind(name="Notebook")
        db.add(kind)
        db.flush()
    db.execute(delete(InventoryHardware).where(InventoryHardware.hostname == "NB-PEER-07"))
    hardware = InventoryHardware(kind_id=kind.id, name="Notebook Beispiel", hostname="NB-PEER-07")
    db.add(hardware)
    db.commit()
    client = client_for(make_app(settings))
    login_as(client, ["NetBird.Reader"], oid="nb-ohne-bestand")
    assert client.get(f"{BASE}/peers/p-07").json()["asset"] is None
    login_as(client, ["NetBird.Reader", "Bestand.Reader"], oid="nb-mit-bestand")
    asset = client.get(f"{BASE}/peers/p-07").json()["asset"]
    assert asset["name"] == "Notebook Beispiel"
    db.delete(hardware)
    db.commit()


@pytest.mark.db
def test_admin_settings_and_test(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    client = admin(settings)
    client.app.dependency_overrides[get_netbird_transport] = lambda: sample.sample_transport  # type: ignore[attr-defined]
    data = client.get(ADMIN).json()
    assert data["url"] == "" and data["token_set"] is False and data["ping"] is False
    assert client.post(f"{ADMIN}/test", headers=HEADERS).status_code == 409
    bad = client.put(ADMIN, json={"url": "http://netbird.example.com"}, headers=HEADERS)
    assert bad.status_code == 422
    assert (
        client.put(
            ADMIN, json={"url": "https://netbird.example.com/api"}, headers=HEADERS
        ).status_code
        == 422
    )
    saved = client.put(
        ADMIN,
        json={"url": "https://netbird.example.com/", "token": "geheim-123", "ping": True},
        headers=HEADERS,
    ).json()
    assert saved["url"] == "https://netbird.example.com" and saved["token_set"] and saved["ping"]
    assert "geheim-123" not in str(saved)
    stored = db.scalars(select(AppSetting).where(AppSetting.key == NETBIRD_KEY)).one()
    assert "geheim-123" not in str(stored.value)
    # Ohne neues Token bleibt das alte
    again = client.put(ADMIN, json={"url": "https://netbird.example.com"}, headers=HEADERS).json()
    assert again["token_set"] is True and again["ping"] is False
    result = client.post(f"{ADMIN}/test", headers=HEADERS).json()
    assert result == {"peers": 6, "groups": 5, "policies": None}

    def failing(config: NetBirdConfig, path: str, params: Any) -> Any:
        raise NetBirdError("Das API-Token wird abgelehnt (HTTP 401).")

    client.app.dependency_overrides[get_netbird_transport] = lambda: failing  # type: ignore[attr-defined]
    answer = client.post(f"{ADMIN}/test", headers=HEADERS)
    assert answer.status_code == 502 and "abgelehnt" in answer.json()["detail"]
    removed = client.put(
        ADMIN, json={"url": "https://netbird.example.com", "token": ""}, headers=HEADERS
    ).json()
    assert removed["token_set"] is False
    assert db.scalars(
        select(AuditLog).where(AuditLog.action == "einstellungen.netbird_geaendert")
    ).first()


@pytest.mark.db
def test_sample_endpoint_only_in_tests(db: Session, tmp_path: Path) -> None:
    from fastapi import HTTPException

    from werkbank.modules.monitoring.netbird.api import load_sample

    settings = settings_with_key(tmp_path, environment="production", enable_test_login=False)
    with pytest.raises(HTTPException) as error:
        load_sample(user=None, db=db, settings=settings)  # type: ignore[arg-type]
    assert error.value.status_code == 404


# --- Netze & Dienste (Phase 2) -------------------------------------------------------------


def test_services_never_keep_secrets() -> None:
    data = fetched()
    services = {item["id"]: item for item in data["services"]}
    assert services["s-files"]["access"] == "Passwort"
    assert (
        services["s-wiki"]["access"] == "SSO" and services["s-wiki"]["crowdsec_mode"] == "enforce"
    )
    assert services["s-intern"]["access"] == "nur NetBird"
    assert services["s-files"]["crowdsec_mode"] == "off"
    assert "geheim-beispiel" not in str(data)
    assert data["clusters"][0]["crowdsec"] is True
    nets = {n["id"]: n for n in data["networks"]}
    assert nets["n-a"]["routers"][0]["peer"] == "p-router-01"
    assert nets["n-s"]["routers"][0]["peer_groups"] == ["g-router"]


def test_network_status_and_hints() -> None:
    data = fetched()
    data["checks"] = {"services": {}, "ping": {}}
    nets = {n["id"]: hints.network_status(n, data) for n in data["networks"]}
    assert nets["n-a"]["state"] == "ohne_ausfallweg" and nets["n-a"]["connected"] == 1
    assert nets["n-b"]["state"] == "nicht_erreichbar"
    assert nets["n-s"]["total"] == 2 and nets["n-s"]["state"] == "ohne_ausfallweg"
    codes = {(h.code, h.subject) for h in hints.network_hints(data)}
    assert ("netz_offline", "netz:n-b") in codes and ("netz_ausfallweg", "netz:n-a") in codes
    # Ping schlägt fehl, obwohl Routing-Peers verbunden sind
    data["peers"][1]["connected"] = True
    data["checks"]["ping"] = {"n-s": {"target": "10.0.30.1", "ok": False}}
    status = hints.network_status(data["networks"][2], data)
    assert status["state"] == "nicht_erreichbar" and status["ping"] is False
    assert any(h.code == "netz_ping" for h in hints.network_hints(data))
    assert collector.ping_target(data["networks"][0]) == "10.0.0.20"
    assert collector.ping_target(data["networks"][2]) == ""


def test_check_helpers() -> None:
    from werkbank.modules.monitoring.netbird.checks import tcp_check, valid_domain

    assert valid_domain("wiki.example.com")
    assert not valid_domain("localhost") and not valid_domain("a.example.com/pfad")
    assert not valid_domain("user@example.com") and not valid_domain("example.com:8443")
    assert tcp_check("ohne-port").ok is False


@pytest.mark.db
def test_checks_hints_and_networks_api(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    configure(db, settings)
    set_setting(
        db,
        NETBIRD_KEY,
        {
            "url": "https://netbird.example.com",
            "token_encrypted": encrypt_secret(settings, "t"),
            "signal": "signal.example.com:443",
            "ping": True,
        },
        None,
    )
    db.commit()
    for _ in range(2):
        collector.collect(db, settings, transport=sample.sample_transport, checker=CHECKER)
    state = db.get(NbState, 1)
    assert state is not None
    checks = state.data["checks"]
    assert set(checks["services"]) == {"s-wiki", "s-git", "s-files"}  # privat: nicht geprüft
    assert checks["signal"]["ok"] is True and "relay" not in checks
    assert checks["ping"]["n-a"] == {"target": "10.0.0.20", "ok": True}
    assert db.scalar(select(func.count()).select_from(NbCheck)) == 6
    found = {(h.code, h.subject) for h in hints.all_hints(state.data, now_utc())}
    assert ("dienst_fehler", "dienst:s-wiki") in found
    assert ("zertifikat", "dienst:s-git") in found
    assert ("zertifikat", "dienst:s-files") not in found

    client = client_for(make_app(settings))
    login_as(client, ["NetBird.Reader"], oid="nb-netze")
    data = client.get(f"{BASE}/networks").json()
    assert data["components"]["signal"]["ok"] is True and data["components"]["relay"] is None
    assert data["components"]["proxy"] == {
        "services": 4,
        "errors": 1,
        "online": True,
        "crowdsec": True,
    }
    states = {n["name"]: n["state"] for n in data["networks"]}
    assert states == {
        "net-beispiel-a": "ohne_ausfallweg",
        "net-beispiel-b": "nicht_erreichbar",
        "net-beispiel-server": "ohne_ausfallweg",
    }
    assert data["networks"][0]["name"] == "net-beispiel-b"  # schlimmstes zuerst
    services = {r["domain"]: r for r in data["services"]}
    assert services["wiki.example.com"]["status_code"] == 502
    assert services["wiki.example.com"]["availability"] == 0.0
    assert services["files.example.com"]["availability"] == 100.0
    assert services["intern.example.com"]["answered"] is None
    assert data["services"][0]["domain"] == "wiki.example.com"
    overview = client.get(f"{BASE}/overview").json()
    assert overview["networks_total"] == 3 and overview["networks_ok"] == 2
    assert overview["services_ok"] == 2 and overview["services_checked"] == 3
    assert overview["hint_counts"]["kritisch"] == 2
    login_as(client, ["Werkbank.Admin"], oid="nb-netze-admin")
    assert client.get(f"{BASE}/networks").status_code == 403

    # Alte Prüfungen fallen nach 31 Tagen weg
    db.add(NbCheck(service_id="alt", checked_at=now_utc() - timedelta(days=40), ok=True))
    db.commit()
    collector.collect(db, settings, transport=sample.sample_transport, checker=CHECKER)
    assert "alt" not in set(db.scalars(select(NbCheck.service_id)))


@pytest.mark.db
def test_admin_signal_relay(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    client = admin(settings)
    body = {"url": "https://netbird.example.com", "signal": "signal.example.com:443"}
    saved = client.put(ADMIN, json={**body, "relay": "relay.example.com:443"}, headers=HEADERS)
    assert saved.json()["signal"] == "signal.example.com:443"
    assert saved.json()["relay"] == "relay.example.com:443"
    for bad in ("signal.example.com", "http://x.example.com:443", "x y:1"):
        assert client.put(ADMIN, json={**body, "signal": bad}, headers=HEADERS).status_code == 422
