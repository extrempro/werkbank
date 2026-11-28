"""IT-Monitoring, FortiGate: Abruf, Auswertung, Aufbewahrung, API und Verwaltung.

Alle Konfigurationen sind erfunden (werkbank/modules/monitoring/fortigate/sample.py).
"""

import copy
import ipaddress
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from tests.test_admin_settings import HEADERS, admin, settings_with_key
from tests.test_auth import client_for, login_as, make_app
from werkbank.config import Settings
from werkbank.core.app_settings import FORTIGATE_KEY, encrypt_secret
from werkbank.core.models import AppSetting, AuditLog, Job, JobStatus
from werkbank.core.sessions import now_utc
from werkbank.modules.monitoring.fortigate import analysis, collector, sample
from werkbank.modules.monitoring.fortigate.admin import get_fortigate_transport
from werkbank.modules.monitoring.fortigate.client import (
    DeviceConfig,
    FortiGateClient,
    FortiGateError,
    valid_url,
)
from werkbank.modules.monitoring.fortigate.config import months_ago
from werkbank.modules.monitoring.fortigate.models import FgDevice, FgRun, FgSnapshot
from werkbank.modules.monitoring.fortigate.normalize import cidr, digest, fetch, interface_ip
from werkbank.modules.monitoring.fortigate.notifications import fortigate_notifications

BASE = "/api/monitoring/fortigate"
ADMIN = "/api/admin/settings/fortigate"


def fetched(name: str) -> Any:
    config = DeviceConfig(name=name, url=f"https://{name}.example.com", token="t")  # noqa: S106
    return fetch(FortiGateClient(config, sample.sample_transport))


# --- ohne Datenbank ------------------------------------------------------------------------


def test_url_and_shapes() -> None:
    assert valid_url("https://fw-edge.example.com")
    assert valid_url("https://fw-edge.example.com:8443/")
    assert not valid_url("http://fw-edge.example.com")
    assert not valid_url("https://fw-edge.example.com/api/v2")
    assert not valid_url("https://user:pw@fw-edge.example.com")
    assert cidr("10.0.0.0 255.255.255.0") == "10.0.0.0/24"
    assert cidr("kaputt") == "kaputt"
    assert interface_ip("10.20.0.1 255.255.0.0") == "10.20.0.1/16"
    assert interface_ip("0.0.0.0 0.0.0.0") == ""


def test_fetch_normalizes_and_keeps_order() -> None:
    edge = fetched("fw-edge")
    assert [p["id"] for p in edge.config["policies"]] == [15, 12, 7, 18]
    first = edge.config["policies"][0]
    assert first["srcaddr"] == ["Netz-Standort-B"] and first["nat"] is True
    assert edge.config["policies"][3]["profiles"] == {
        "web": "Standard",
        "ips": "Standard",
        "ssl": "certificate-inspection",
    }
    by_name = {a["name"]: a for a in edge.config["addresses"]}
    assert by_name["Netz-Buero"] == {
        "name": "Netz-Buero",
        "type": "ipmask",
        "fabric": True,
        "interface": "",
        "comment": "",
        "value": "10.20.30.0/24",
    }
    assert edge.config["fabric"]["unification"] == "default"
    assert edge.runtime["version"] == "v7.6.1"
    assert edge.runtime["hits"]["12"]["hits"] == 1284302
    assert len(edge.runtime["ha_peers"]) == 2
    # Fehlende freiwillige Endpunkte stehen als Hinweis da, der Abruf bleibt gültig
    branch = fetched("fw-standort-b")
    assert branch.runtime["ha_peers"] == []
    assert digest(edge.config) == digest(copy.deepcopy(edge.config))


def test_missing_required_list_fails() -> None:
    def broken(config: DeviceConfig, path: str, params: Any) -> Any:
        if path == "cmdb/firewall/policy":
            raise FortiGateError("Zugriff verweigert (HTTP 403).")
        return sample.sample_transport(config, path, params)

    config = DeviceConfig(name="fw-core", url="https://fw-core.example.com", token="t")  # noqa: S106
    with pytest.raises(FortiGateError):
        fetch(FortiGateClient(config, broken))


def test_ip_and_port_matching() -> None:
    edge = analysis.Resolver(fetched("fw-edge").config)
    ip = ipaddress.IPv4Address("10.20.30.15")
    assert edge.contains_ip("Netz-Buero", ip)
    assert edge.contains_ip("Grp-Server", ip)
    assert not edge.contains_ip("all", ip)  # „all“ würde sonst überall passen
    assert not edge.contains_ip("Netz-Standort-B", ip)
    assert edge.contains_ip("VIP-Fernwartung", ipaddress.IPv4Address("192.0.2.10"))
    assert edge.contains_port("WEB-Dienste", 443, None)
    assert edge.contains_port("WEB-Dienste", 443, "tcp")
    assert not edge.contains_port("WEB-Dienste", 443, "udp")
    assert not edge.contains_port("ALL", 443, None)
    assert edge.is_open_service("ALL") and not edge.is_open_service("HTTPS")
    assert edge.is_open_address("all")
    # Ausnahmen in Gruppen
    config = {
        "addresses": [
            {"name": "netz", "type": "ipmask", "value": "10.0.0.0/24"},
            {"name": "host", "type": "ipmask", "value": "10.0.0.5/32"},
        ],
        "address_groups": [{"name": "g", "members": ["netz"], "exclude": ["host"]}],
    }
    resolver = analysis.Resolver(config)
    assert resolver.contains_ip("g", ipaddress.IPv4Address("10.0.0.6"))
    assert not resolver.contains_ip("g", ipaddress.IPv4Address("10.0.0.5"))
    # Bereich und Ziel:Quelle-Ports
    assert analysis.port_ranges({"tcp": "8000-8080 443:1024-65535"}) == [
        ("tcp", 8000, 8080),
        ("tcp", 443, 443),
    ]
    assert analysis.ip_networks({"type": "iprange", "value": "10.0.0.1-10.0.0.2"}) == [
        ipaddress.IPv4Network("10.0.0.1/32"),
        ipaddress.IPv4Network("10.0.0.2/32"),
    ]
    assert analysis.ip_networks({"type": "fqdn", "value": "example.com"}) is None


def test_parse_query() -> None:
    assert analysis.parse_query("10.20.30.15").ip == ipaddress.IPv4Address("10.20.30.15")
    port = analysis.parse_query("443")
    assert port.port == 443 and port.policy_id == 443 and port.proto is None
    tcp = analysis.parse_query("TCP/3389")
    assert tcp.port == 3389 and tcp.proto == "tcp" and tcp.policy_id is None
    assert analysis.parse_query("#12").policy_id == 12
    assert analysis.parse_query("Server").ip is None
    assert analysis.parse_query("   ").empty


def test_policy_rows_marks_open_fields() -> None:
    edge = fetched("fw-edge")
    rows = {r["id"]: r for r in analysis.policy_rows("fw-edge", edge.config, edge.runtime)}
    remote = rows[7]
    assert remote["open"] == {
        "srcintf": False,
        "dstintf": False,
        "srcaddr": True,
        "dstaddr": False,
        "service": True,
    }
    assert remote["nat"] == "VIP" and remote["position"] == 3
    assert rows[12]["nat"] == "SNAT" and rows[12]["open"]["dstaddr"] is True
    assert rows[12]["hits"] == 1284302
    resolver = analysis.Resolver(edge.config)
    assert analysis.policy_matches(rows[12], analysis.parse_query("10.20.30.15"), resolver) == (
        "10.20.30.15 in Quelle"
    )
    assert analysis.policy_matches(rows[7], analysis.parse_query("3389"), resolver) is None
    assert analysis.policy_matches(rows[12], analysis.parse_query("443"), resolver) == (
        "Port 443 im Dienst"
    )
    assert analysis.policy_matches(rows[7], analysis.parse_query("#7"), resolver) == "Policy-ID 7"
    assert analysis.policy_matches(rows[7], analysis.parse_query("altsystem"), resolver) == "Text"


def test_usages_follow_groups() -> None:
    edge = fetched("fw-edge").config
    uses = analysis.usages(edge)
    assert uses["srv-datei"].groups == ["Grp-Server", "Grp-Alt-Buero"]
    assert uses["srv-datei"].policies == []
    assert uses["HTTPS"].groups == ["WEB-Dienste"]
    via = analysis.policies_using("HTTPS", edge, uses)
    assert {(pid, via_group) for pid, _, _, via_group in via} == {(12, True), (18, True)}
    assert "Netz-Gast-alt" not in uses


def test_months_ago() -> None:
    assert months_ago(datetime(2026, 3, 31, tzinfo=UTC), 1) == datetime(2026, 2, 28, tzinfo=UTC)
    assert months_ago(datetime(2026, 1, 15, tzinfo=UTC), 3) == datetime(2025, 10, 15, tzinfo=UTC)
    assert months_ago(datetime(2026, 5, 10, tzinfo=UTC), 36) == datetime(2023, 5, 10, tzinfo=UTC)


# --- mit Datenbank -------------------------------------------------------------------------


@pytest.fixture
def db(migrated_db: None, db_session: Session) -> Session:
    for table in (FgRun, FgSnapshot, FgDevice, AppSetting):
        db_session.execute(delete(table))
    db_session.execute(delete(Job).where(Job.type == collector.FORTIGATE_JOB))
    db_session.commit()
    return db_session


def add_devices(
    db: Session, settings: Settings, names: tuple[str, ...] = tuple(sample.DEVICES)
) -> None:
    for position, name in enumerate(names):
        db.add(
            FgDevice(
                name=name,
                url=f"https://{name}.example.com",
                token_encrypted=encrypt_secret(settings, "geheimes-token"),
                position=position,
                runtime={},
            )
        )
    db.commit()


@pytest.mark.db
def test_collect_stores_only_changes(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    add_devices(db, settings)
    runs = collector.collect(db, settings, transport=sample.sample_transport)
    assert [run.ok for run in runs] == [True, True, True]
    assert all(run.changed for run in runs)
    assert db.scalar(select(func.count()).select_from(FgSnapshot)) == 3
    # Noch nicht fällig: kein neuer Abruf
    assert collector.collect(db, settings, transport=sample.sample_transport) == []
    # Erzwungen, ohne Änderung: kein neuer Stand, aber gesehen
    again = collector.collect(db, settings, force=True, transport=sample.sample_transport)
    assert [run.changed for run in again] == [False, False, False]
    assert db.scalar(select(func.count()).select_from(FgSnapshot)) == 3
    # Eine Änderung am Gerät ergibt einen neuen Stand
    original = sample.DEVICES["fw-core"]["firewall/policy"]
    sample.DEVICES["fw-core"]["firewall/policy"] = [*original, {"policyid": 60, "name": "Neu"}]
    try:
        changed = collector.collect(db, settings, force=True, transport=sample.sample_transport)
    finally:
        sample.DEVICES["fw-core"]["firewall/policy"] = original
    assert [run.changed for run in changed] == [False, True, False]
    assert db.scalar(select(func.count()).select_from(FgSnapshot)) == 4


@pytest.mark.db
def test_unreachable_device_does_not_stop_others(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    add_devices(db, settings, ("fw-edge", "fw-unbekannt"))
    runs = collector.collect(db, settings, transport=sample.sample_transport)
    assert [run.ok for run in runs] == [True, False]
    assert runs[1].error and "fw-unbekannt" in runs[1].error
    # Nach drei Fehlern in Folge meldet die Glocke den Admins
    for _ in range(2):
        collector.collect(db, settings, force=True, transport=sample.sample_transport)
    events = list(fortigate_notifications(db, settings, now_utc()))
    assert [event.title for event in events] == [
        "FortiGate „fw-unbekannt“ lässt sich nicht abrufen"
    ]
    assert events[0].link == "/verwaltung/fortigate"


@pytest.mark.db
def test_token_that_cannot_be_decrypted(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    db.add(
        FgDevice(
            name="fw-edge",
            url="https://fw-edge.example.com",
            token_encrypted="kaputt",  # noqa: S106
            runtime={},
        )
    )
    db.commit()
    run = collector.collect(db, settings, transport=sample.sample_transport)[0]
    assert run.ok is False and "entschlüsseln" in (run.error or "")


@pytest.mark.db
def test_retention_keeps_latest_state(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    add_devices(db, settings, ("fw-edge",))
    collector.collect(db, settings, transport=sample.sample_transport)
    device = db.scalar(select(FgDevice))
    assert device is not None
    old = now_utc() - timedelta(days=200)
    db.add(FgSnapshot(device_id=device.id, taken_at=old, seen_at=old, digest="alt", data={}))
    db.add(FgRun(device_id=device.id, started_at=old, ok=True))
    db.commit()
    assert collector.retention_preview(db, 12) == {"runs": 0, "snapshots": 0}
    assert collector.retention_preview(db, 3) == {"runs": 1, "snapshots": 1}
    # Verkürzung: der nächste Lauf löscht
    from werkbank.core.app_settings import set_setting

    set_setting(db, FORTIGATE_KEY, {"retention_months": 3, "interval_minutes": 60}, None)
    db.commit()
    collector.collect(db, settings, transport=sample.sample_transport)
    assert db.scalar(select(func.count()).select_from(FgSnapshot)) == 1
    assert (
        db.scalar(
            select(func.count())
            .select_from(FgRun)
            .where(FgRun.started_at < old + timedelta(days=1))
        )
        == 0
    )
    # Ist der einzige Stand alt, bleibt er trotzdem (jüngster Stand je Gerät)
    db.execute(delete(FgSnapshot))
    db.add(FgSnapshot(device_id=device.id, taken_at=old, seen_at=old, digest="alt", data={}))
    db.commit()
    assert collector.purge(db, 1) == {"runs": 0, "snapshots": 0}


@pytest.mark.db
def test_api_rights_and_views(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    add_devices(db, settings)
    collector.collect(db, settings, transport=sample.sample_transport)
    client = client_for(make_app(settings))
    login_as(client, ["Monitoring.Reader"], oid="fg-monitoring")
    assert client.get(f"{BASE}/overview").status_code == 403
    login_as(client, ["Werkbank.Admin"], oid="fg-admin-ohne-recht")
    assert client.get(f"{BASE}/policies").status_code == 403
    login_as(client, ["FortiGate.Reader"], oid="fg-leser")
    overview = client.get(f"{BASE}/overview").json()
    assert overview["configured"] is True and overview["can_refresh"] is False
    assert overview["policies"] == 9 and overview["disabled"] == 1 and overview["reachable"] == 3
    assert overview["changes_24h"] == 0
    devices = {d["name"]: d for d in overview["devices"]}
    assert devices["fw-edge"]["fabric"] == "Root" and devices["fw-core"]["fabric"] == "Mitglied"
    assert devices["fw-edge"]["ha"] == "Aktiv-Passiv · 2 Mitglieder"
    assert devices["fw-standort-b"]["ha"] == "kein HA"
    assert "geheimes-token" not in json.dumps(overview)

    everything = client.get(f"{BASE}/policies").json()
    assert everything["total"] == 9 and len(everything["rows"]) == 9
    assert [r["id"] for r in everything["rows"][:4]] == [15, 12, 7, 18]
    found = client.get(f"{BASE}/policies", params={"q": "10.20.30.15"}).json()
    assert found["query"] == "ip"
    assert {(r["device"], r["id"]) for r in found["rows"]} == {
        ("fw-edge", 12),
        ("fw-core", 31),
        ("fw-core", 44),
    }
    edge = client.get(f"{BASE}/policies", params={"device": "fw-edge", "action": "accept"}).json()
    assert {r["id"] for r in edge["rows"]} == {15, 12, 7, 18}
    disabled = client.get(f"{BASE}/policies", params={"state": "deaktiviert"}).json()
    assert [r["id"] for r in disabled["rows"]] == [52]
    pair = client.get(f"{BASE}/policies", params={"pair": "lan → server"}).json()
    assert {r["id"] for r in pair["rows"]} == {31, 44, 52}
    assert "lan → server" in pair["pairs"]

    groups = client.get(f"{BASE}/objects", params={"kind": "address_groups"}).json()
    server = next(r for r in groups["rows"] if r["name"] == "Grp-Server")
    assert server["same_value"] is False
    assert {d["device"] for d in server["devices"]} == {"fw-edge", "fw-core", "fw-standort-b"}
    druck = next(m for m in server["member_table"] if m["member"] == "srv-druck")
    assert druck["devices"] == {"fw-edge": True, "fw-core": True, "fw-standort-b": False}
    assert {(u["device"], u["id"]) for u in server["used_in"]} == {("fw-core", 31), ("fw-core", 44)}
    addresses = client.get(f"{BASE}/objects", params={"q": "10.20.30.15"}).json()
    names = {r["name"]: r["match"] for r in addresses["rows"]}
    assert names["srv-datei"] == "ist 10.20.30.15"
    assert names["Netz-Buero"] == "enthält 10.20.30.15"
    assert "all" not in names
    assert addresses["counts"]["addresses"] > 0
    services = client.get(f"{BASE}/objects", params={"kind": "services", "q": "443"}).json()
    assert [r["name"] for r in services["rows"]] == ["HTTPS"]
    assert client.get(f"{BASE}/objects", params={"kind": "unbekannt"}).status_code == 422

    export = client.get(f"{BASE}/policies.csv", params={"device": "fw-core"})
    assert export.status_code == 200 and export.text.startswith("﻿Gerät;Position")
    assert "Buero zu Servern" in export.text
    assert db.scalar(
        select(func.count()).select_from(AuditLog).where(AuditLog.action == "fortigate.export")
    )
    assert client.post(f"{BASE}/refresh", headers=HEADERS).status_code == 403


@pytest.mark.db
def test_refresh_plans_forced_run(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    client = client_for(make_app(settings))
    login_as(client, ["FortiGate.Reader", "FortiGate.Editor"], oid="fg-bearbeiter")
    assert client.get(f"{BASE}/overview").json()["can_refresh"] is True
    assert client.post(f"{BASE}/refresh", headers=HEADERS).status_code == 200
    assert client.post(f"{BASE}/refresh", headers=HEADERS).status_code == 200
    jobs = db.scalars(
        select(Job).where(Job.type == collector.FORTIGATE_JOB, Job.status == JobStatus.PLANNED)
    ).all()
    assert len(jobs) == 1 and jobs[0].payload == {"force": True}


@pytest.mark.db
def test_admin_devices_settings_and_test(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    client = admin(settings)
    client.app.dependency_overrides[get_fortigate_transport] = lambda: sample.sample_transport  # type: ignore[attr-defined]
    data = client.get(ADMIN).json()
    assert data["interval_minutes"] == 60 and data["retention_months"] == 3
    assert data["analyzer_adom"] == "root" and data["devices"] == []

    body = {"name": "fw-edge", "url": "https://fw-edge.example.com", "token": "geheim-123"}
    assert (
        client.post(f"{ADMIN}/devices", json={**body, "token": ""}, headers=HEADERS).status_code
        == 422
    )
    assert (
        client.post(
            f"{ADMIN}/devices", json={**body, "url": "http://x.example.com"}, headers=HEADERS
        ).status_code
        == 422
    )
    assert (
        client.post(f"{ADMIN}/devices", json={**body, "name": "<b>"}, headers=HEADERS).status_code
        == 422
    )
    created = client.post(f"{ADMIN}/devices", json=body, headers=HEADERS)
    assert created.status_code == 201
    assert "geheim-123" not in created.text
    device = created.json()["devices"][0]
    assert device["token_set"] is True
    assert (
        client.post(
            f"{ADMIN}/devices", json={**body, "name": "FW-EDGE"}, headers=HEADERS
        ).status_code
        == 409
    )
    tested = client.post(f"{ADMIN}/devices/{device['id']}/test", headers=HEADERS)
    assert tested.status_code == 200
    assert tested.json() == {
        "hostname": "fw-edge",
        "model": "FortiGate 200G",
        "version": "v7.6.1",
        "policies": 4,
    }
    # Bearbeiten ohne Token lässt es, wie es ist
    renamed = client.put(
        f"{ADMIN}/devices/{device['id']}",
        json={"name": "fw-edge", "url": "https://fw-edge.example.com:8443", "enabled": False},
        headers=HEADERS,
    ).json()
    assert renamed["devices"][0]["enabled"] is False and renamed["devices"][0]["token_set"] is True

    base = {"interval_minutes": 30, "retention_months": 6}
    assert (
        client.put(ADMIN, json={**base, "interval_minutes": 7}, headers=HEADERS).status_code == 422
    )
    assert (
        client.put(ADMIN, json={**base, "retention_months": 37}, headers=HEADERS).status_code == 422
    )
    no_key = {**base, "analyzer_enabled": True, "analyzer_url": "https://faz.example.com"}
    assert client.put(ADMIN, json=no_key, headers=HEADERS).status_code == 422
    saved = client.put(
        ADMIN,
        json={**no_key, "analyzer_key": "faz-geheim", "analyzer_adom": "root"},
        headers=HEADERS,
    )
    assert saved.status_code == 200
    assert saved.json()["analyzer_key_set"] is True and saved.json()["retention_months"] == 6
    assert "faz-geheim" not in json.dumps(
        db.scalar(select(AppSetting.value).where(AppSetting.key == FORTIGATE_KEY))
    )
    assert (
        client.put(ADMIN, json={**base, "ca_pem": "kein zertifikat"}, headers=HEADERS).status_code
        == 422
    )
    audit = db.scalars(
        select(AuditLog).where(AuditLog.action == "einstellungen.fortigate_geaendert")
    ).all()
    details = audit[-1].details or {}
    assert details["aufbewahrung_monate"] == 6
    assert details["aufbewahrung_monate_vorher"] == 3
    preview = client.get(f"{ADMIN}/retention-preview", params={"months": 1}).json()
    assert preview == {"runs": 0, "snapshots": 0}
    assert client.get(f"{ADMIN}/retention-preview", params={"months": 0}).status_code == 422

    removed = client.delete(f"{ADMIN}/devices/{device['id']}", headers=HEADERS)
    assert removed.status_code == 200 and removed.json()["devices"] == []
    # Nur für Admins
    login_as(client, ["FortiGate.Reader", "FortiGate.Editor"], oid="fg-kein-admin")
    assert client.get(ADMIN).status_code == 403


@pytest.mark.db
def test_sample_endpoint_only_in_tests(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    client = admin(settings)
    assert client.post(f"{BASE}/test/sample", headers=HEADERS).status_code == 204
    assert db.scalar(select(func.count()).select_from(FgDevice)) == 3
    # Ohne Test-Anmeldung (Produktion) gibt es den Endpunkt nicht
    from fastapi import HTTPException

    from werkbank.modules.monitoring.fortigate.api import load_sample

    production = settings_with_key(tmp_path, enable_test_login=False)
    with pytest.raises(HTTPException) as error:
        load_sample(None, db, production)  # type: ignore[arg-type]
    assert error.value.status_code == 404


# --- Phase 2: Fabric-Sync und unbenutzte Objekte ------------------------------------------


def test_unused_respects_switches_and_references() -> None:
    from werkbank.modules.monitoring.fortigate.unused import references, unused

    core = fetched("fw-core").config
    names = {(item.kind, item.name): item.reason for item in unused(core)}
    # nur in der deaktivierten Policy #52
    assert names[("addresses", "test-host-1")].startswith("nur in deaktivierten Einträgen: #52")
    assert ("addresses", "Drucker-Netz") in names
    assert ("addresses", "srv-app") not in names  # über Grp-Server in genutzter Policy
    strict_off = {(i.kind, i.name) for i in unused(core, disabled_is_unused=False)}
    assert ("addresses", "test-host-1") not in strict_off

    edge = fetched("fw-edge").config
    refs = references(edge)
    sources = {ref.source for ref in refs.get("addr", "Netz-Standort-B")}
    assert {"Policy", "Statische Route", "VPN-Selektor"} <= sources
    assert {ref.source for ref in refs.get("addr", "srv-app")} == {"Gruppe", "SD-WAN-Regel"}
    edge_unused = {(i.kind, i.name): i.reason for i in unused(edge)}
    # Grp-Alt-Buero ist unbenutzt, also zählt test-host-1 darin nicht
    assert ("address_groups", "Grp-Alt-Buero") in edge_unused
    assert edge_unused[("addresses", "test-host-1")].startswith("nur in unbenutzten Gruppen")
    loose = {(i.kind, i.name) for i in unused(edge, unused_groups_count=False)}
    assert ("addresses", "test-host-1") not in loose
    # Lokal genutzte Adresse (Local-in) ist nicht unbenutzt
    assert ("addresses", "Netz-Buero") not in edge_unused


def test_fabric_states() -> None:
    from werkbank.modules.monitoring.fortigate.fabric import Entry, device_role, object_state

    edge, core, branch = (fetched(n).config for n in ("fw-edge", "fw-core", "fw-standort-b"))
    roles = {
        "fw-edge": device_role(edge),
        "fw-core": device_role(core),
        "fw-standort-b": device_role(branch),
    }
    assert roles == {"fw-edge": "Quelle", "fw-core": "Sync an", "fw-standort-b": "nur lokal"}
    same = [
        Entry("fw-edge", "10.0.0.0/24", True, True),
        Entry("fw-core", "10.0.0.0/24", True, False),
    ]
    assert object_state(same, roles).label == "synchronisiert (2/2 Geräte)"
    differs = [Entry("fw-edge", "a", True, True), Entry("fw-core", "b", True, True)]
    assert object_state(differs, roles).state == "abweichend"
    missing = [Entry("fw-edge", "a", True, True)]
    assert object_state(missing, roles).state == "abweichend"
    local = [Entry("fw-core", "a", False, True), Entry("fw-standort-b", "b", False, True)]
    state = object_state(local, roles)
    assert state.state == "lokal_mehrfach" and state.candidate is True
    assert object_state([Entry("fw-core", "a", False, False)], roles).state == "lokal"


@pytest.mark.db
def test_unused_since_is_tracked_and_cleared(db: Session, tmp_path: Path) -> None:
    from werkbank.modules.monitoring.fortigate.models import FgUnused

    settings = settings_with_key(tmp_path)
    add_devices(db, settings, ("fw-core",))
    collector.collect(db, settings, transport=sample.sample_transport)
    rows = {r.name: r for r in db.scalars(select(FgUnused))}
    assert {"test-host-1", "Drucker-Netz"} <= set(rows)
    first = rows["Drucker-Netz"].since
    # Weiterer Abruf: das Datum bleibt
    collector.collect(db, settings, force=True, transport=sample.sample_transport)
    assert db.scalar(select(FgUnused.since).where(FgUnused.name == "Drucker-Netz")) == first
    # Wird das Objekt genutzt, fällt es heraus
    original = sample.DEVICES["fw-core"]["firewall/policy"]
    sample.DEVICES["fw-core"]["firewall/policy"] = [
        *original,
        {
            "policyid": 70,
            "name": "Drucker",
            "srcaddr": [{"name": "Drucker-Netz"}],
            "action": "accept",
        },
    ]
    try:
        collector.collect(db, settings, force=True, transport=sample.sample_transport)
    finally:
        sample.DEVICES["fw-core"]["firewall/policy"] = original
    assert db.scalar(select(FgUnused).where(FgUnused.name == "Drucker-Netz")) is None
    # „unbenutzt seit“ fällt nicht unter die Aufbewahrung
    db.execute(
        FgUnused.__table__.update().values(since=now_utc() - timedelta(days=800))  # type: ignore[attr-defined]
    )
    db.commit()
    collector.purge(db, 1)
    db.commit()
    assert (db.scalar(select(func.count()).select_from(FgUnused)) or 0) > 0


@pytest.mark.db
def test_api_unused_and_sync(db: Session, tmp_path: Path) -> None:
    from werkbank.modules.monitoring.fortigate.models import FgUnused

    settings = settings_with_key(tmp_path)
    add_devices(db, settings)
    collector.collect(db, settings, transport=sample.sample_transport)
    client = client_for(make_app(settings))
    login_as(client, ["FortiGate.Reader"], oid="fg-aufraeumer")
    data = client.get(f"{BASE}/unused").json()
    keys = {(r["kind"], r["name"]): r for r in data["rows"]}
    gast = keys[("addresses", "Netz-Gast-alt")]
    assert gast["fabric"] is True and set(gast["devices"]) == {
        "fw-edge",
        "fw-core",
        "fw-standort-b",
    }
    assert ("addresses", "all") not in keys  # Standardobjekt
    assert ("services", "HTTP") not in keys or keys[("services", "HTTP")]
    with_defaults = client.get(f"{BASE}/unused", params={"defaults": "true"}).json()
    assert len(with_defaults["rows"]) >= len(data["rows"])
    # Fabric-Objekt, das auf einem Gerät genutzt wird, ist nicht unbenutzt
    assert ("addresses", "srv-druck") not in keys
    only_core = client.get(
        f"{BASE}/unused", params={"device": "fw-core", "kind": "addresses"}
    ).json()
    assert all("fw-core" in r["devices"] and r["kind"] == "addresses" for r in only_core["rows"])
    # Zeitraum: frisch beobachtet ist noch nicht 30 Tage unbenutzt
    assert client.get(f"{BASE}/unused", params={"days": 30}).json()["rows"] == []
    db.execute(
        FgUnused.__table__.update().values(since=now_utc() - timedelta(days=40))  # type: ignore[attr-defined]
    )
    db.commit()
    assert client.get(f"{BASE}/unused", params={"days": 30}).json()["rows"]
    assert client.get(f"{BASE}/unused", params={"days": 7}).status_code == 422

    listing = client.post(
        f"{BASE}/unused/cleanup.csv",
        json={"items": [{"kind": "addresses", "name": "Netz-Gast-alt"}]},
        headers=HEADERS,
    )
    assert listing.status_code == 200
    assert listing.text.count("\n") == 2 and "Netz-Gast-alt" in listing.text
    assert client.get(f"{BASE}/unused.csv").text.startswith("﻿Art;Name")

    objects = client.get(f"{BASE}/objects", params={"kind": "address_groups"}).json()
    server = next(r for r in objects["rows"] if r["name"] == "Grp-Server")
    assert server["sync"]["state"] == "abweichend"
    bar = {b["device"]: b for b in objects["sync_bar"]}
    assert bar["fw-edge"]["role"] == "Quelle" and bar["fw-standort-b"]["role"] == "nur lokal"
    assert objects["unused"] > 0
    local = client.get(
        f"{BASE}/objects", params={"kind": "addresses", "sync": "lokal_mehrfach"}
    ).json()
    assert {r["name"] for r in local["rows"]} == {"test-host-1", "Drucker-Netz"}
    overview = client.get(f"{BASE}/overview").json()
    assert len(overview["sync"]) == 3
