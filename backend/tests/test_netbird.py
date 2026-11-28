"""IT-Monitoring, NetBird: Abruf, Hinweise, Seiten, Rechte, Verwaltung (Phasen 1 bis 5).

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
from werkbank.core.models import AppSetting, AuditLog, Job, Notification, NotificationKind, User
from werkbank.core.sessions import now_utc
from werkbank.modules.monitoring.netbird import (
    collector,
    crowdsec,
    hints,
    policies,
    sample,
    views,
    watch,
)
from werkbank.modules.monitoring.netbird.admin import get_lapi_transport, get_netbird_transport
from werkbank.modules.monitoring.netbird.client import (
    NetBirdClient,
    NetBirdConfig,
    NetBirdError,
    NotAvailableError,
)
from werkbank.modules.monitoring.netbird.models import (
    NbBlock,
    NbChange,
    NbCheck,
    NbDaily,
    NbEvent,
    NbHint,
    NbPeerDay,
    NbPolicySeen,
    NbRun,
    NbState,
)
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
    for table in (
        NbState,
        NbRun,
        NbDaily,
        NbPeerDay,
        NbCheck,
        NbEvent,
        NbPolicySeen,
        NbHint,
        NbBlock,
        NbChange,
    ):
        db_session.execute(delete(table))
    db_session.execute(delete(AppSetting))
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
    failures = [e.title for e in events if e.kind == "monitoring.netbird_fehler"]
    assert failures == ["NetBird lässt sich nicht abrufen"]


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
    assert overview["hint_counts"]["warnung"] >= 3 and overview["hint_counts"]["info"] == 3
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
    assert result == {"peers": 6, "groups": 7, "policies": 6}

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
    assert overview["hint_counts"]["kritisch"] == 3
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


# --- Phase 3: Richtlinien, Setup-Keys, Ereignisse, Glocke ----------------------------------


def test_policies_setup_keys_and_events_fetch() -> None:
    result = fetch(NetBirdClient(CONFIG, sample.sample_transport))
    data = result.data
    assert {p["id"] for p in data["policies"]} >= {"pol-admin", "pol-test"}
    keys = {k["id"]: k for k in data["setup_keys"]}
    assert "key" not in keys["k-1"] and keys["k-1"]["groups"] == ["g-server"]
    assert result.events is not None
    event = next(e for e in result.events if e["id"] == "1004")
    # Verbindungsadresse und Seriennummer werden nie übernommen
    assert set(event["meta"]) == {"name", "fqdn", "ip"}
    scim = next(e for e in result.events if e["id"] == "1003")
    assert scim["initiator"] == "" and scim["meta"]["group"] == "grp-beispiel-vertrieb"


def test_policy_findings_and_labels() -> None:
    data = fetched()
    now = datetime.now(UTC)
    data["policy_meta"] = {"pol-test": {"disabled_since": (now - timedelta(days=124)).isoformat()}}
    found = {(f.code, f.subject): f for f in policies.findings(data, now)}
    assert found[("richtlinie_all", "policy:pol-admin")].level == "kritisch"
    assert ("alle_ports", "policy:pol-dev") in found
    assert ("gruppe_leer", "group:g-extern") in found
    assert found[("richtlinie_deaktiviert", "policy:pol-test")].title.endswith(
        "124 Tagen deaktiviert"
    )
    assert "grp-beispiel-einkauf" in found[("scim_ungenutzt", "scim")].title
    # Ohne Server-Gruppen keine Prüfung auf Posture Checks
    assert not any(code == "server_ohne_posture" for code, _ in found)
    with_servers = policies.findings(data, now, ["GRP-beispiel-server"])
    server = {f.subject for f in with_servers if f.code == "server_ohne_posture"}
    assert server == {"policy:pol-server", "policy:pol-extern"}  # pol-dev hat Posture Check
    levels = [f.level for f in with_servers]
    assert levels == sorted(levels, key=["kritisch", "warnung", "info"].index)
    assert policies.ports_label(
        {"protocol": "tcp", "ports": ["22"], "port_ranges": [[8000, 8100]]}
    ) == ("TCP 22, 8000\u20138100")
    assert policies.ports_label({"protocol": "udp"}) == "UDP alle Ports"
    assert policies.category("peer.group.add") == "group"
    assert policies.category("setupkey.group.add") == "setupkey"
    assert policies.category("user.peer.delete") == "peer"
    assert policies.event_change("peer.group.delete", {"group": "g"}) == "\u2212 g"
    hint_codes = {(h.code, h.subject) for h in hints.all_hints(data, now)}
    assert ("richtlinie_all", "policy:pol-admin") in hint_codes
    assert ("alle_ports", "policy:pol-dev") not in hint_codes  # nur auf der Seite
    assert ("setupkey_7", "setupkey:k-1") in hint_codes
    assert ("setupkey_30", "setupkey:k-2") in hint_codes
    assert not any(s == "setupkey:k-3" for _, s in hint_codes)  # kein Ablauf


def test_peer_targets() -> None:
    data = fetched()
    targets = {(t["target"], t["ports"]) for t in policies.peer_targets(data, "p-07")}
    assert ("Büronetz", "TCP 22, 443, 3389") in targets
    assert ("grp-beispiel-router", "TCP alle Ports") in targets
    assert ("All", "alle") in targets
    # pol-test ist aus: p-44 nicht als Ziel
    assert not any(t[0] == "nb-peer-44" for t in targets)
    # Bidirektional: Ziel-Seite erreicht auch die Quelle
    assert ("All", "alle") in {
        (t["target"], t["ports"]) for t in policies.peer_targets(data, "p-44")
    }
    assert policies.peer_targets(data, "gibt-es-nicht") == []


@pytest.mark.db
def test_collect_events_policies_and_bell(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    configure(db, settings)
    db.execute(delete(Notification).where(Notification.kind.like("monitoring.netbird%")))
    db.commit()
    collector.collect(db, settings, transport=sample.sample_transport, checker=CHECKER)
    # Ereignis älter als 90 Tage wird nicht gespeichert
    assert set(db.scalars(select(NbEvent.id))) == {"1002", "1003", "1004", "1005"}
    seen = db.get(NbPolicySeen, "pol-test")
    assert seen is not None and seen.disabled_since is not None
    assert (now_utc() - seen.disabled_since).days >= 123  # aus dem Protokoll
    state = db.get(NbState, 1)
    assert state is not None
    assert state.data["policy_meta"]["pol-admin"]["changed_at"]  # Ereignis vor einer Stunde
    hint_keys = set(db.scalars(select(NbHint.key)))
    assert "richtlinie_all|policy:pol-admin" in hint_keys

    # Glocke: erster Lauf gilt als gemeldet, ein neuer Hinweis wird gemeldet
    from werkbank.core.notifications import dispatch
    from werkbank.modules.monitoring.netbird.notifications import netbird_notifications

    reader = db.scalars(select(User).limit(1)).first()
    assert reader is not None
    reader.last_roles = ["NetBird.Reader"]
    db.execute(delete(NotificationKind).where(NotificationKind.kind.like("monitoring.netbird%")))
    db.commit()
    dispatch(db, netbird_notifications(db, settings, now_utc()))
    db.commit()
    assert not db.scalars(
        select(Notification).where(
            Notification.user_id == reader.id, Notification.kind.like("monitoring.netbird%")
        )
    ).first()

    changed = sample.responses()

    def with_new_policy(config: NetBirdConfig, path: str, params: Any) -> Any:
        if path == "policies":
            extra = dict(changed["policies"][0], id="pol-neu", name="pol-beispiel-neu")
            return [*changed["policies"], extra]
        return sample.sample_transport(config, path, params)

    collector.collect(db, settings, transport=with_new_policy, checker=CHECKER)
    dispatch(db, netbird_notifications(db, settings, now_utc()))
    db.commit()
    notes = list(
        db.scalars(
            select(Notification).where(
                Notification.user_id == reader.id, Notification.kind == "monitoring.netbird_hinweis"
            )
        )
    )
    assert [n.title for n in notes] == [
        "NetBird: Richtlinie pol-beispiel-neu: Quelle und Ziel \u201eAll\u201c, alle Ports"
    ]
    assert "hinweis=" in notes[0].link and notes[0].read_at is None
    # Trifft der Hinweis nicht mehr zu, schließt er sich: Meldung gilt als gelesen
    collector.collect(db, settings, transport=sample.sample_transport, checker=CHECKER)
    db.refresh(notes[0])
    assert notes[0].read_at is not None
    assert "richtlinie_all|policy:pol-neu" not in set(db.scalars(select(NbHint.key)))
    db.execute(delete(Notification).where(Notification.kind.like("monitoring.netbird%")))
    db.commit()


@pytest.mark.db
def test_policies_and_events_api(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    configure(db, settings)
    collector.collect(db, settings, transport=sample.sample_transport, checker=CHECKER)
    client = client_for(make_app(settings))
    login_as(client, ["Werkbank.Admin"], oid="nb-richtlinien-admin")
    assert client.get(f"{BASE}/policies").status_code == 403
    assert client.get(f"{BASE}/events").status_code == 403
    login_as(client, ["NetBird.Reader"], oid="nb-richtlinien")
    data = client.get(f"{BASE}/policies").json()
    assert data["findings"][0]["level"] == "kritisch"
    assert data["server_groups"] == []
    rows = {r["name"]: r for r in data["policies"]}
    assert rows["pol-beispiel-it"]["posture_checks"] == ["Client-Version", "Betriebssystem"]
    assert rows["pol-beispiel-it"]["destinations"] == ["Büronetz"]
    assert rows["pol-beispiel-test"]["disabled_days"] >= 123
    assert rows["pol-beispiel-admin"]["changed_at"]
    assert data["policies"][-1]["name"] == "pol-beispiel-test"  # deaktivierte zuletzt
    keys = data["setup_keys"]
    assert keys[0]["name"] == "key-beispiel-server" and keys[0]["days_left"] in (5, 6)
    assert keys[-1]["expires"] is None
    assert "A6160" not in str(data)

    events = client.get(f"{BASE}/events").json()
    assert events["total"] == 4 and events["items"][0]["label"] == "Richtlinie geändert"
    assert events["items"][0]["initiator"] == "Ina Beispiel"
    by_id = {e["id"]: e for e in events["items"]}
    assert by_id["1003"]["initiator"] == "System"
    assert by_id["1003"]["object"] == "nb-peer-19.netbird.example.com"
    assert by_id["1003"]["change"] == "+ grp-beispiel-vertrieb"
    only = client.get(f"{BASE}/events", params={"kind": "peer"}).json()
    assert {e["id"] for e in only["items"]} == {"1002", "1004"}
    page = client.get(f"{BASE}/events", params={"limit": 2, "offset": 2}).json()
    assert len(page["items"]) == 2 and page["total"] == 4
    assert client.get(f"{BASE}/events", params={"days": 5}).status_code == 422
    assert client.get(f"{BASE}/events", params={"days": 30}).json()["days"] == 30
    assert client.get(f"{BASE}/events", params={"kind": "unsinn"}).status_code == 422

    overview = client.get(f"{BASE}/overview").json()
    assert len(overview["events"]) == 4 and overview["events_available"] is True
    detail = client.get(f"{BASE}/peers/p-07").json()
    assert detail["policies_available"] is True
    assert any(t["target"] == "Büronetz" for t in detail["targets"])


@pytest.mark.db
def test_admin_server_groups(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    client = admin(settings)
    body = {"url": "https://netbird.example.com"}
    saved = client.put(
        ADMIN, json={**body, "server_groups": "grp-a, grp-b, GRP-A, "}, headers=HEADERS
    )
    assert saved.json()["server_groups"] == "grp-a, grp-b"
    too_many = ", ".join(f"g{i}" for i in range(51))
    assert (
        client.put(ADMIN, json={**body, "server_groups": too_many}, headers=HEADERS).status_code
        == 422
    )


# --- Phase 4: CrowdSec ---------------------------------------------------------------------


def test_lapi_url_and_summary() -> None:
    assert crowdsec.valid_lapi_url("http://crowdsec.example.com:8080")
    assert crowdsec.valid_lapi_url("https://crowdsec.example.com")
    for bad in (
        "ftp://crowdsec.example.com",
        "http://user:pw@crowdsec.example.com",
        "http://crowdsec.example.com/v1",
        "http://crowdsec.example.com:99999",
        "http://crowdsec.example.com?x=1",
    ):
        assert not crowdsec.valid_lapi_url(bad), bad
    assert crowdsec.summarize(None) == {"total": 0, "own": 0}
    assert crowdsec.summarize(sample.sample_lapi(None)) == {"total": 14, "own": 4}
    with pytest.raises(crowdsec.CrowdSecError):
        crowdsec.summarize({"unerwartet": True})


def test_proxy_blocks_counted_without_addresses() -> None:
    now = datetime.now(UTC)
    client = NetBirdClient(CONFIG, sample.sample_transport)
    blocks = crowdsec.read_proxy_blocks(client, "", [], now)
    by_service: dict[tuple[str, bool], int] = {}
    for (service, _hour, observe), count in blocks.counts.items():
        by_service[(service, observe)] = by_service.get((service, observe), 0) + count
    # Eintrag vor drei Tagen liegt außerhalb der ersten 24 Stunden
    assert by_service == {("s-wiki", False): 3, ("s-git", True): 2}
    assert blocks.complete and blocks.cursor and blocks.cursor_ids == ["a-ok"]
    again = crowdsec.read_proxy_blocks(client, blocks.cursor, blocks.cursor_ids, now)
    assert again.counts == {}  # nichts doppelt
    assert "203.0.113" not in str(blocks)

    pages: list[str] = []

    def endless(config: NetBirdConfig, path: str, params: Any) -> Any:
        pages.append(params["page"])
        stamp = (now - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        row = {"id": f"x-{params['page']}", "service_id": "s", "timestamp": stamp}
        return {"data": [row], "total_pages": 999}

    partial = crowdsec.read_proxy_blocks(NetBirdClient(CONFIG, endless), "", [], now)
    assert not partial.complete and len(pages) == crowdsec.MAX_PAGES


def test_crowdsec_hint_with_exceptions() -> None:
    data = fetched()
    found = {(h.code, h.subject) for h in hints.all_hints(data, datetime.now(UTC))}
    assert ("ohne_crowdsec", "dienst:s-files") in found
    assert ("ohne_crowdsec", "dienst:s-intern") not in found  # nur NetBird
    assert ("ohne_crowdsec", "dienst:s-wiki") not in found
    data["crowdsec_exempt"] = ["FILES.example.com"]
    assert not any(h.code == "ohne_crowdsec" for h in hints.all_hints(data, datetime.now(UTC)))
    data["crowdsec_exempt"] = []
    data["clusters"][0]["crowdsec"] = False  # Proxy kann kein CrowdSec
    assert not any(h.code == "ohne_crowdsec" for h in hints.all_hints(data, datetime.now(UTC)))


@pytest.mark.db
def test_collect_crowdsec_and_networks_api(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    configure(db, settings)
    collector.collect(
        db, settings, transport=sample.sample_transport, checker=CHECKER, lapi=sample.sample_lapi
    )
    state = db.get(NbState, 1)
    assert state is not None and state.data["crowdsec"] == {"configured": False}
    assert db.scalar(select(func.sum(NbBlock.count))) == 5
    # Zweiter Abruf zählt nichts doppelt
    collector.collect(
        db, settings, transport=sample.sample_transport, checker=CHECKER, lapi=sample.sample_lapi
    )
    assert db.scalar(select(func.sum(NbBlock.count))) == 5

    client = admin(settings)
    assert (
        client.put(
            f"{ADMIN}/crowdsec", json={"url": "crowdsec.example.com"}, headers=HEADERS
        ).status_code
        == 422
    )
    saved = client.put(
        f"{ADMIN}/crowdsec",
        json={
            "url": "http://crowdsec.example.com:8080/",
            "key": "bouncer-geheim",
            "exempt": "Files.example.com, files.example.com",
        },
        headers=HEADERS,
    ).json()
    assert saved == {
        "url": "http://crowdsec.example.com:8080",
        "key_set": True,
        "exempt": "files.example.com",
        "token_storage_available": True,
    }
    stored_value = db.scalars(select(AppSetting).where(AppSetting.key == NETBIRD_KEY)).one()
    assert "bouncer-geheim" not in str(stored_value.value)
    assert (
        client.put(
            f"{ADMIN}/crowdsec", json={"exempt": "kein domain/pfad"}, headers=HEADERS
        ).status_code
        == 422
    )
    client.app.dependency_overrides[get_lapi_transport] = lambda: sample.sample_lapi  # type: ignore[attr-defined]
    assert client.post(f"{ADMIN}/crowdsec/test", headers=HEADERS).json() == {
        "total": 14,
        "own": 4,
    }

    collector.collect(
        db, settings, transport=sample.sample_transport, checker=CHECKER, lapi=sample.sample_lapi
    )
    state = db.get(NbState, 1)
    assert state is not None
    assert state.data["crowdsec"] == {"configured": True, "ok": True, "total": 14, "own": 4}
    assert not any(h.code == "ohne_crowdsec" for h in hints.all_hints(state.data, now_utc()))

    reader = client_for(make_app(settings))
    login_as(reader, ["NetBird.Reader"], oid="nb-crowdsec")
    data = reader.get(f"{BASE}/networks").json()
    assert data["proxy_log_available"] is True
    assert data["components"]["crowdsec"] == {
        "configured": True,
        "ok": True,
        "total": 14,
        "own": 4,
        "error": "",
        "blocked_24h": 3,
        "observed_24h": 2,
    }
    services = {r["domain"]: r for r in data["services"]}
    assert services["wiki.example.com"]["blocked_24h"] == 3
    assert services["git.example.com"]["observed_24h"] == 2
    assert services["git.example.com"]["crowdsec_mode"] == "observe"
    assert services["files.example.com"]["crowdsec_exempt"] is True

    def lapi_down(config: Any) -> Any:
        raise crowdsec.CrowdSecError("Die Local API ist nicht erreichbar.")

    collector.collect(
        db, settings, transport=sample.sample_transport, checker=CHECKER, lapi=lapi_down
    )
    state = db.get(NbState, 1)
    assert state is not None and state.data["crowdsec"]["ok"] is False
    # Alte Stunden fallen nach 7 Tagen weg
    db.add(NbBlock(service_id="alt", hour=now_utc() - timedelta(days=9), observe=False, count=1))
    db.commit()
    collector.collect(db, settings, transport=sample.sample_transport, checker=CHECKER)
    assert "alt" not in set(db.scalars(select(NbBlock.service_id)))


# --- Phase 5: Gruppen & Policies -----------------------------------------------------------


def watch_settings(**extra: Any) -> watch.WatchSettings:
    return watch.load_watch({"watch": {**sample.WATCH, **extra}})


def test_watch_settings_and_preview() -> None:
    assert watch.load_watch({}).active is False
    settings = watch_settings()
    assert settings.notify["members_scim"] is False and settings.reminder == 3
    data = fetched()
    result = watch.preview(data, settings)
    assert "grp-beispiel-it" in result["groups"] and "All" not in result["groups"]
    assert result["policies_by_prefix"] == 6 and result["policies_by_group"] == 0
    only_groups = watch.preview(data, watch_settings(policy_prefixes=[]))
    # Policies über überwachte Gruppen: alle außer pol-beispiel-admin (nur „All“)
    assert only_groups["policies_by_group"] == 5
    assert watch.load_watch({"watch": {"retention": "unsinn", "reminder": 5}}).retention == (
        "unbegrenzt"
    )


def test_detect_changes_and_flags() -> None:
    old = fetched()
    new = fetch(NetBirdClient(CONFIG, sample.changed_transport)).data
    drafts = {(d.object_id, d.action): d for d in watch.detect(old, new, watch_settings())}
    assert set(drafts) == {
        ("g-labor", "angelegt"),
        ("g-vertrieb", "mitglieder"),
        ("pol-server", "geaendert"),
        ("pol-dev", "deaktiviert"),
    }
    server = drafts[("pol-server", "geaendert")]
    assert server.flag == "fremde_gruppe" and server.summary == "Quelle geändert"
    assert ["Quelle", "grp-beispiel-vertrieb", "All", True] in server.fields
    labor = drafts[("g-labor", "angelegt")]
    assert labor.flag == "von_hand"
    members = drafts[("g-vertrieb", "mitglieder")]
    assert members.summary == "1 Mitglied hinzu" and members.scim_group
    assert ["Neu", "\u2013", "nb-peer-07", True] in members.fields
    # Gleiche Einstellungen auf beiden Seiten: neues Präfix erzeugt keine Scheinänderungen
    assert watch.detect(old, old, watch_settings()) == []
    assert watch.detect(old, new, watch.WatchSettings()) == []
    events = [{"code": "policy.update", "target_id": "pol-server", "initiator": "Ina Beispiel"}]
    assert watch.who(server, events).name == "Ina Beispiel"
    assert watch.who(members, []).kind == "scim"
    assert watch.who(drafts[("pol-dev", "deaktiviert")], []).name == watch.UNKNOWN


def configure_watch(db: Session, settings: Settings, **extra: Any) -> None:
    set_setting(
        db,
        NETBIRD_KEY,
        {
            "url": "https://netbird.example.com",
            "token_encrypted": encrypt_secret(settings, "t"),
            "watch": {**sample.WATCH, **extra},
        },
        None,
    )
    db.commit()


@pytest.mark.db
def test_collect_records_changes_and_bell(db: Session, tmp_path: Path) -> None:
    from werkbank.core.notifications import dispatch
    from werkbank.modules.monitoring.netbird.notifications import netbird_notifications

    settings = settings_with_key(tmp_path)
    configure_watch(db, settings, critical_mail=True)
    db.execute(delete(Notification).where(Notification.kind.like("monitoring.netbird%")))
    db.execute(delete(NotificationKind).where(NotificationKind.kind.like("monitoring.netbird%")))
    db.commit()
    collector.collect(db, settings, transport=sample.sample_transport, checker=CHECKER)
    assert db.scalar(select(func.count()).select_from(NbChange)) == 0  # erster Stand
    dispatch(db, netbird_notifications(db, settings, now_utc()))  # Arten gelten als begonnen
    db.commit()
    collector.collect(db, settings, transport=sample.changed_transport, checker=CHECKER)
    rows = {(c.object_id, c.action): c for c in db.scalars(select(NbChange))}
    assert rows[("pol-server", "geaendert")].initiator == "Ina Beispiel"
    assert rows[("pol-server", "geaendert")].critical is True
    assert "Mail und Teams" in rows[("pol-server", "geaendert")].notified
    assert rows[("g-labor", "angelegt")].initiator == "Max Muster"
    assert rows[("g-vertrieb", "mitglieder")].status == "automatisch"  # SCIM: nicht gemeldet
    assert rows[("g-vertrieb", "mitglieder")].initiator == watch.SCIM
    assert rows[("pol-dev", "deaktiviert")].status == "offen"

    reader = db.scalars(select(User).limit(1)).first()
    assert reader is not None
    reader.last_roles = ["NetBird.Reader", "NetBird.Approver"]
    db.commit()
    dispatch(db, netbird_notifications(db, settings, now_utc()))
    db.commit()
    kinds = sorted(
        n.kind
        for n in db.scalars(select(Notification).where(Notification.user_id == reader.id))
        if n.kind.startswith("monitoring.netbird_")
        and n.kind in ("monitoring.netbird_aenderung", "monitoring.netbird_kritisch")
    )
    assert kinds.count("monitoring.netbird_aenderung") == 3
    assert kinds.count("monitoring.netbird_kritisch") == 1
    from werkbank.core.notify_channels import forced_kinds

    assert "monitoring.netbird_kritisch" in forced_kinds(db)
    # Erinnerung nach drei Tagen
    for change in rows.values():
        change.detected_at = now_utc() - timedelta(days=4)
    db.commit()
    reminders = [
        e
        for e in netbird_notifications(db, settings, now_utc())
        if e.kind == "monitoring.netbird_erinnerung"
    ]
    assert len(reminders) == 3
    db.execute(delete(Notification).where(Notification.kind.like("monitoring.netbird%")))
    db.commit()


@pytest.mark.db
def test_changes_api_rights_and_confirm(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    configure_watch(db, settings)
    collector.collect(db, settings, transport=sample.sample_transport, checker=CHECKER)
    collector.collect(db, settings, transport=sample.changed_transport, checker=CHECKER)
    client = client_for(make_app(settings))
    login_as(client, ["Werkbank.Admin"], oid="nb-aenderung-admin")
    assert client.get(f"{BASE}/changes").status_code == 403

    login_as(client, ["NetBird.Reader"], oid="nb-aenderung-leser")
    data = client.get(f"{BASE}/changes").json()
    assert data["total"] == 4 and data["open_count"] == 3 and data["can_confirm"] is False
    assert data["watch"]["group_prefixes"] == ["grp-beispiel-"]
    assert "grp-beispiel-labor" in data["watch"]["groups"]
    server = next(i for i in data["items"] if i["object_id"] == "pol-server")
    assert server["flag"] == "fremde_gruppe" and server["status"] == "offen"
    assert (
        client.post(f"{BASE}/changes/{server['id']}/confirm", json={}, headers=HEADERS).status_code
        == 403
    )
    assert client.post(f"{BASE}/changes/confirm-all", headers=HEADERS).status_code == 403
    only = client.get(f"{BASE}/changes", params={"state": "automatisch"}).json()["items"]
    assert [i["object_id"] for i in only] == ["g-vertrieb"]
    assert len(client.get(f"{BASE}/changes", params={"kind": "group"}).json()["items"]) == 2
    assert len(client.get(f"{BASE}/changes", params={"action": "geaendert"}).json()["items"]) == 2
    assert len(client.get(f"{BASE}/changes", params={"initiator": "person"}).json()["items"]) == 2
    assert client.get(f"{BASE}/changes", params={"q": "labor"}).json()["total"] == 1
    assert client.get(f"{BASE}/changes", params={"days": 5}).status_code == 422
    detail = client.get(f"{BASE}/changes/{server['id']}").json()
    assert detail["via"].startswith("Abgleich, Person") and detail["related"] == 1
    assert ["Quelle", "grp-beispiel-vertrieb", "All", True] in detail["fields"]
    assert client.get(f"{BASE}/changes/999999").status_code == 404
    overview = client.get(f"{BASE}/overview").json()
    codes = {h["code"] for h in overview["hints"]}
    assert {"aenderung_kritisch", "aenderungen_offen"} <= codes

    login_as(client, ["NetBird.Reader", "NetBird.Approver"], oid="nb-bestaetiger")
    confirmed = client.post(
        f"{BASE}/changes/{server['id']}/confirm",
        json={"comment": "Gewollt, Freigabe für alle."},
        headers=HEADERS,
    ).json()
    assert (
        confirmed["status"] == "bestaetigt"
        and confirmed["comment"] == "Gewollt, Freigabe für alle."
    )
    assert confirmed["confirmed_at"]
    again = client.post(f"{BASE}/changes/{server['id']}/confirm", json={}, headers=HEADERS)
    assert again.status_code == 409  # nicht mehr änderbar
    assert db.scalars(
        select(AuditLog).where(AuditLog.action == "netbird.aenderung_bestaetigt")
    ).first()
    result = client.post(f"{BASE}/changes/confirm-all", headers=HEADERS).json()
    assert result == {"confirmed": 2}
    assert client.get(f"{BASE}/changes").json()["open_count"] == 0
    codes = {h["code"] for h in client.get(f"{BASE}/overview").json()["hints"]}
    assert "aenderungen_offen" not in codes


@pytest.mark.db
def test_admin_watch_settings_preview_and_retention(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    configure(db, settings)
    collector.collect(db, settings, transport=sample.sample_transport, checker=CHECKER)
    client = admin(settings)
    data = client.get(f"{ADMIN}/watch").json()
    assert data["group_prefixes"] == "" and data["notify"]["members_scim"] is False
    body = {
        "group_prefixes": "grp-beispiel-, GRP-BEISPIEL-",
        "policy_prefixes": "pol-beispiel-",
        "retention": "90t",
        "reminder": 7,
        "notify": {"members_scim": True},
    }
    hits = client.post(f"{ADMIN}/watch/preview", json=body, headers=HEADERS).json()
    assert hits["policies_by_prefix"] == 6 and "grp-beispiel-vertrieb" in hits["groups"]
    saved = client.put(f"{ADMIN}/watch", json=body, headers=HEADERS).json()
    assert saved["group_prefixes"] == "grp-beispiel-" and saved["retention"] == "90t"
    assert saved["notify"]["members_scim"] is True and saved["reminder"] == 7
    assert (
        client.put(
            f"{ADMIN}/watch", json={**body, "retention": "ewig"}, headers=HEADERS
        ).status_code
        == 422
    )
    assert db.scalars(
        select(AuditLog).where(AuditLog.action == "einstellungen.netbird_ueberwachung_geaendert")
    ).first()
    # Aufbewahrung 90 Tage: ältere Änderungen fallen weg
    db.add(
        NbChange(
            detected_at=now_utc() - timedelta(days=100),
            kind="group",
            object_id="alt",
            object_name="grp-beispiel-alt",
            action="angelegt",
            summary="angelegt",
            fields=[],
            initiator=watch.UNKNOWN,
            initiator_kind="unbekannt",
            via="",
            status="automatisch",
        )
    )
    db.commit()
    collector.collect(db, settings, transport=sample.sample_transport, checker=CHECKER)
    assert "alt" not in set(db.scalars(select(NbChange.object_id)))
