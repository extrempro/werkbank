"""IT-Monitoring: DNS-Abgleich mit NetBox (Wire-Format, Vergleich, Lauf, API, Verwaltung)."""

import struct
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_admin_settings import HEADERS, admin, settings_with_key
from tests.test_auth import client_for, login_as, make_app
from werkbank.config import Settings
from werkbank.core.app_settings import NETBOX_KEY, encrypt_secret, set_setting
from werkbank.core.models import AppSetting, Job, JobStatus
from werkbank.core.sessions import now_utc
from werkbank.modules.monitoring import compare
from werkbank.modules.monitoring.admin import get_netbox_getter
from werkbank.modules.monitoring.dns_check import (
    DNS_CHECK,
    DnsCheckConfig,
    load_config,
    record_run,
    run_check,
)
from werkbank.modules.monitoring.dnswire import WireError, parse_response
from werkbank.modules.monitoring.models import MonDnsRow, MonDnsRun
from werkbank.modules.monitoring.netbox import (
    NetboxConfig,
    NetboxError,
    auth_header,
    list_all,
    valid_netbox_url,
)
from werkbank.modules.monitoring.notifications import monitoring_notifications
from werkbank.modules.tools.net import Fetched

CODES = {"A": 1, "NS": 2, "CNAME": 5, "MX": 15, "TXT": 16, "AAAA": 28}
NOW = now_utc().replace(microsecond=0)


# --- Wire-Format ------------------------------------------------------------------------


def encode_name(name: str) -> bytes:
    out = b""
    for label in name.rstrip(".").split("."):
        out += bytes([len(label)]) + label.encode()
    return out + b"\0"


def rdata(type_name: str, value: str) -> bytes:
    if type_name == "A":
        return bytes(int(part) for part in value.split("."))
    if type_name in ("CNAME", "NS"):
        return encode_name(value)
    if type_name == "MX":
        preference, target = value.split()
        return struct.pack(">H", int(preference)) + encode_name(target)
    if type_name == "TXT":
        raw = value.encode()
        return bytes([len(raw)]) + raw
    raise ValueError(type_name)


def response(
    name: str, qtype: str, answers: list[tuple[str, str, int, str]], rcode: int = 0
) -> bytes:
    """Antwort mit Frage und Einträgen (Name, Typ, TTL, Wert); Name der Frage komprimiert."""
    out = struct.pack(">HHHHHH", 0, 0x8180 | rcode, 1, len(answers), 0, 0)
    out += encode_name(name) + struct.pack(">HH", CODES[qtype], 1)
    for owner, type_name, ttl, value in answers:
        head = b"\xc0\x0c" if owner == name else encode_name(owner)
        data = rdata(type_name, value)
        out += head + struct.pack(">HHIH", CODES[type_name], 1, ttl, len(data)) + data
    return out


def test_wire_reads_compressed_names_and_types() -> None:
    parsed = parse_response(
        response(
            "www.example.com",
            "A",
            [
                ("www.example.com", "CNAME", 300, "web.example.net"),
                ("web.example.net", "A", 60, "192.0.2.1"),
                ("www.example.com", "TXT", 10, "v=spf1 -all"),
            ],
        )
    )
    assert parsed.rcode == 0
    assert [(a.name, a.type, a.ttl, a.data) for a in parsed.answers] == [
        ("www.example.com.", "CNAME", 300, "web.example.net."),
        ("web.example.net.", "A", 60, "192.0.2.1"),
        ("www.example.com.", "TXT", 10, '"v=spf1 -all"'),
    ]
    with pytest.raises(WireError):
        parse_response(
            response("x.example.com", "A", [("x.example.com", "A", 1, "192.0.2.1")])[:-2]
        )
    # Zeiger auf sich selbst
    loop = struct.pack(">HHHHHH", 0, 0x8180, 1, 0, 0, 0) + b"\xc0\x0c" + struct.pack(">HH", 1, 1)
    with pytest.raises(WireError):
        parse_response(loop)


# --- Vergleich ----------------------------------------------------------------------------


def test_normalize_and_compare_values() -> None:
    assert compare.normalize_value("MX", "10 mail", "example.com") == ["10 mail.example.com"]
    assert compare.normalize_value("AAAA", "2001:0db8:0:0:0:0:0:1") == ["2001:db8::1"]
    assert compare.normalize_value("CNAME", "web.example.net", "example.com") == [
        "web.example.net",
        "web.example.net.example.com",
    ]
    assert compare.compare_values(
        "TXT", "example.com", ['"v=spf1 -all"'], ['"v=spf1" " -all"']
    ) == (
        [],
        [],
    )
    assert compare.compare_values(
        "MX", "example.com", ["10 mail"], ["10 mail.example.com.", "20 x.example.com."]
    ) == ([], ["20 x.example.com."])
    assert compare.caa_normalized('0 issue "letsencrypt.org"') == "0 issue letsencrypt.org"
    assert (
        compare.caa_normalized("\\# 22 00 05 69737375 65 6C657473656E63727970742E6F7267")
        == "0 issue letsencrypt.org"
    )
    # SOA: Seriennummer zählt nicht
    mine = "ns1.example.com. hostmaster.example.com. 2026111601 3600 900 604800 300"
    theirs = "ns1.example.com. hostmaster.example.com. 2026111602 3600 900 604800 300"
    assert compare.compare_values("SOA", "example.com", [mine], [theirs]) == ([], [])


def test_private_reverse_zones_and_delegations() -> None:
    assert compare.is_private_reverse_zone("16.172.in-addr.arpa")
    assert compare.is_private_reverse_zone("168.192.in-addr.arpa")
    assert not compare.is_private_reverse_zone("2.0.192.in-addr.arpa")
    assert compare.is_private_reverse_zone("d.f.ip6.arpa")
    records = [
        {
            "type": "NS",
            "status": "active",
            "name": "kunde",
            "zone": {"name": "example.com"},
            "value": "ns1.example.net.",
        },
    ]
    delegations = compare.find_delegations(records, {"example.com"})
    assert [d.fqdn for d in delegations] == ["kunde.example.com"]
    assert compare.excluded_by_delegation("www.kunde.example.com", "A", delegations)
    assert not compare.excluded_by_delegation("kunde.example.com", "NS", delegations)


def test_build_row_statuses() -> None:
    def row(expected: list[str], answer: compare.PublicAnswer, **kw: Any) -> compare.Row:
        return compare.build_row(
            fqdn="a.example.com",
            type_name="A",
            zone="example.com",
            expected=expected,
            inactive=kw.get("inactive", []),
            answer=answer,
            configured_ttl=kw.get("ttl"),
            compare_ttl=True,
        )

    assert row(["192.0.2.1"], compare.PublicAnswer(["192.0.2.1"], 60), ttl=300).status == "ok"
    assert row(["192.0.2.1"], compare.PublicAnswer(["192.0.2.1"], 600), ttl=300).status == (
        "abweichend"
    )
    assert row(["192.0.2.1"], compare.PublicAnswer(["192.0.2.2"])).status == "abweichend"
    assert row(["192.0.2.1"], compare.PublicAnswer()).status == "fehlt"
    assert row(["192.0.2.1"], compare.PublicAnswer(error="Zeit")).status == "fehler"
    assert row([], compare.PublicAnswer(), inactive=["192.0.2.9"]).status == "inaktiv"
    assert row([], compare.PublicAnswer(["192.0.2.9"]), inactive=["192.0.2.9"]).status == (
        "abweichend"
    )


# --- NetBox und Lauf ----------------------------------------------------------------------


def test_netbox_url_token_and_paging() -> None:
    assert valid_netbox_url("https://netbox.example.com")
    assert valid_netbox_url("https://10.0.0.5/netbox")
    assert not valid_netbox_url("http://netbox.example.com")
    assert not valid_netbox_url("https://user:pw@netbox.example.com")
    assert not valid_netbox_url("https://netbox.example.com/?x=1")
    assert auth_header("nbt_abc") == "Bearer nbt_abc"
    assert auth_header("0123") == "Token 0123"

    pages = [
        {"count": 3, "next": "x", "results": [{"id": 1}, {"id": 2}]},
        {"count": 3, "next": None, "results": [{"id": 3}]},
    ]
    calls: list[list[tuple[str, str]]] = []

    def get(config: NetboxConfig, path: str, params: list[tuple[str, str]]) -> Any:
        calls.append(params)
        return pages[len(calls) - 1]

    config = NetboxConfig("https://netbox.example.com", "t")
    assert [item["id"] for item in list_all(get, config, "x/")] == [1, 2, 3]
    assert ("offset", "2") in calls[1]
    with pytest.raises(NetboxError):
        list_all(lambda c, p, q: {"oops": 1}, config, "x/")


ZONES: list[dict[str, Any]] = [
    {"id": 1, "name": "example.com", "status": "active", "default_ttl": 3600},
    {"id": 2, "name": "168.192.in-addr.arpa", "status": "active"},
    {"id": 3, "name": "alt.example.org", "status": "deprecated"},
]
RECORDS: list[dict[str, Any]] = [
    {
        "id": 10,
        "zone": {"id": 1, "name": "example.com"},
        "name": "www",
        "type": "A",
        "value": "192.0.2.1",
        "status": "active",
        "display_url": "https://netbox.example.com/x/10",
    },
    {
        "id": 11,
        "zone": {"id": 1, "name": "example.com"},
        "name": "mail",
        "type": "A",
        "value": "192.0.2.5",
        "status": "active",
    },
    {
        "id": 12,
        "zone": {"id": 1, "name": "example.com"},
        "name": "@",
        "type": "MX",
        "value": "10 mail",
        "status": "active",
    },
    {
        "id": 13,
        "zone": {"id": 1, "name": "example.com"},
        "name": "alt",
        "type": "A",
        "value": "192.0.2.9",
        "status": "inactive",
    },
    {
        "id": 14,
        "zone": {"id": 1, "name": "example.com"},
        "name": "kunde",
        "type": "NS",
        "value": "ns1.example.net.",
        "status": "active",
    },
    {
        "id": 15,
        "zone": {"id": 1, "name": "example.com"},
        "name": "www.kunde",
        "type": "A",
        "value": "198.51.100.1",
        "status": "active",
    },
    {
        "id": 16,
        "zone": {"id": 1, "name": "example.com"},
        "name": "@",
        "type": "HINFO",
        "value": "x y",
        "status": "active",
    },
]
PUBLIC: dict[tuple[str, str], list[tuple[str, str, int, str]]] = {
    ("www.example.com", "A"): [("www.example.com", "A", 60, "192.0.2.1")],
    ("mail.example.com", "A"): [("mail.example.com", "A", 60, "192.0.2.6")],
    ("example.com", "MX"): [("example.com", "MX", 60, "10 mail.example.com")],
    ("kunde.example.com", "NS"): [("kunde.example.com", "NS", 60, "ns1.example.net")],
}


def fake_get(config: NetboxConfig, path: str, params: list[tuple[str, str]]) -> Any:
    if path.endswith("zones/"):
        return {"count": len(ZONES), "next": None, "results": ZONES}
    if path.endswith("records/"):
        ids = {int(value) for key, value in params if key == "zone_id"}
        found = [r for r in RECORDS if r["zone"]["id"] in ids]
        return {"count": len(found), "next": None, "results": found}
    if path == "status/":
        return {"netbox-version": "4.4.1", "plugins": {"netbox_dns": "1.4.0"}}
    if path.endswith("views/"):
        return {"count": 1, "next": None, "results": [{"id": 7, "name": "extern"}]}
    raise AssertionError(path)


def question(body: bytes) -> tuple[str, str]:
    pos, labels = 12, []
    while body[pos]:
        labels.append(body[pos + 1 : pos + 1 + body[pos]].decode())
        pos += body[pos] + 1
    code = int.from_bytes(body[pos + 1 : pos + 3], "big")
    return ".".join(labels), {v: k for k, v in CODES.items()}[code]


def fake_fetch(
    method: str, url: str, body: bytes | None, headers: dict[str, str], timeout: float, size: int
) -> Fetched:
    assert url == "https://cloudflare-dns.com/dns-query" and body
    name, qtype = question(body)
    answers = PUBLIC.get((name, qtype))
    return Fetched(200, {}, response(name, qtype, answers or [], rcode=0 if answers else 3))


CONFIG = DnsCheckConfig(
    netbox=NetboxConfig("https://netbox.example.com", "t"),
    view_id=None,
    resolver="cloudflare",
    compare_ttl=True,
)


def test_run_check_only_netbox_records() -> None:
    result = run_check(CONFIG, get=fake_get, fetch=fake_fetch)
    by_key = {row.key: row for row in result.rows}
    assert result.zones == 1
    assert result.delegations == ["kunde.example.com"]
    assert result.skipped_types == {"HINFO": 1}
    assert set(by_key) == {
        "www.example.com|A",
        "mail.example.com|A",
        "example.com|MX",
        "alt.example.com|A",
        "kunde.example.com|NS",
    }
    assert by_key["www.example.com|A"].status == "ok"
    assert by_key["www.example.com|A"].netbox_url == "https://netbox.example.com/x/10"
    assert by_key["mail.example.com|A"].status == "abweichend"
    assert by_key["mail.example.com|A"].missing == ["192.0.2.5"]
    assert by_key["example.com|MX"].status == "ok"
    assert by_key["alt.example.com|A"].status == "inaktiv"
    assert by_key["kunde.example.com|NS"].status == "ok"


# --- mit Datenbank ------------------------------------------------------------------------


@pytest.fixture
def db(migrated_db: None, db_session: Session) -> Session:
    for table in (MonDnsRow, MonDnsRun, AppSetting):
        db_session.execute(delete(table))
    db_session.execute(delete(Job).where(Job.type == DNS_CHECK))
    db_session.commit()
    return db_session


def configure(db: Session, settings: Settings, enabled: bool = True) -> None:
    set_setting(
        db,
        NETBOX_KEY,
        {
            "enabled": enabled,
            "url": "https://netbox.example.com",
            "token_encrypted": encrypt_secret(settings, "geheimer-token"),
            "view_id": None,
            "resolver": "google",
            "compare_ttl": False,
            "ca_pem": None,
        },
        None,
    )
    db.commit()


@pytest.mark.db
def test_record_run_new_problems_and_notifications(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    assert record_run(db, settings) is None  # nicht eingerichtet
    configure(db, settings)
    config = load_config(db, settings)
    assert config is not None
    assert config.netbox.token == "geheimer-token"  # noqa: S105
    assert config.resolver == "google" and config.compare_ttl is False

    first = record_run(
        db, settings, checker=lambda c: run_check(CONFIG, get=fake_get, fetch=fake_fetch)
    )
    assert first is not None and first.status == "ok"
    assert first.counts == {"ok": 3, "abweichend": 1, "inaktiv": 1}
    events = list(monitoring_notifications(db, settings, NOW))
    assert [(e.kind, e.title) for e in events] == [
        ("monitoring.dns_abweichung", "DNS-Abgleich: eine neue Abweichung zu NetBox")
    ]

    # Gleiches Ergebnis: nichts Neues
    record_run(db, settings, checker=lambda c: run_check(CONFIG, get=fake_get, fetch=fake_fetch))
    assert list(monitoring_notifications(db, settings, NOW)) == []

    # NetBox nicht lesbar: fehlgeschlagen, die Zeilen des letzten guten Laufs bleiben
    def broken(config: DnsCheckConfig) -> Any:
        raise NetboxError("NetBox lehnt den Token ab (ungültig, abgelaufen oder ohne Leserecht).")

    failed = record_run(db, settings, checker=broken)
    assert failed is not None and failed.status == "fehlgeschlagen"
    assert [e.kind for e in monitoring_notifications(db, settings, NOW)] == [
        "monitoring.dns_fehlgeschlagen"
    ]
    # Zeilen nur für die letzten beiden erfolgreichen Läufe
    runs_with_rows = set(db.scalars(select(MonDnsRow.run_id)))
    assert len(runs_with_rows) == 2


@pytest.mark.db
def test_api_for_readers_only(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    configure(db, settings)
    record_run(db, settings, checker=lambda c: run_check(CONFIG, get=fake_get, fetch=fake_fetch))
    client = client_for(make_app(settings))
    login_as(client, ["Budget.Reader"], oid="mon-fremd")
    assert client.get("/api/monitoring/dns").status_code == 403
    login_as(client, ["Monitoring.Reader"], oid="mon-leser")
    data = client.get("/api/monitoring/dns").json()
    assert data["enabled"] is True and data["interval_hours"] == 4
    assert data["result_run"]["counts"]["abweichend"] == 1
    assert data["result_run"]["delegations"] == ["kunde.example.com"]
    mail = next(row for row in data["rows"] if row["key"] == "mail.example.com|A")
    assert mail["new"] is True and mail["missing"] == ["192.0.2.5"]
    assert len(data["history"]) == 1
    assert "geheimer-token" not in str(data)
    summary = client.get("/api/monitoring/dns/summary").json()
    assert summary["enabled"] is True and summary["last_status"] == "ok"
    assert summary["deviations"] == 2 and summary["result_at"] is not None
    # Nur Admins ziehen den Lauf vor
    assert client.post("/api/monitoring/dns/run", headers=HEADERS).status_code == 403


@pytest.mark.db
def test_admin_netbox_settings_and_run_now(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    client = admin(settings)
    base = "/api/admin/settings/netbox"
    assert client.get(base).json()["token_set"] is False
    assert (
        client.put(
            base, json={"enabled": True, "url": "http://netbox.example.com"}, headers=HEADERS
        ).status_code
        == 422
    )
    assert (
        client.put(
            base, json={"enabled": True, "url": "https://netbox.example.com"}, headers=HEADERS
        ).status_code
        == 422
    )
    saved = client.put(
        base,
        json={
            "enabled": True,
            "url": "https://netbox.example.com/",
            "token": "nbt_geheim",
            "resolver": "quad9",
            "compare_ttl": False,
        },
        headers=HEADERS,
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["url"] == "https://netbox.example.com" and body["token_set"] is True
    assert body["resolver"] == "quad9" and "nbt_geheim" not in saved.text
    stored = db.scalars(select(AppSetting).where(AppSetting.key == NETBOX_KEY)).one()
    db.refresh(stored)
    assert "nbt_geheim" not in str(stored.value)
    assert (
        client.put(
            base,
            json={"enabled": True, "url": "https://netbox.example.com", "ca_pem": "kein pem"},
            headers=HEADERS,
        ).status_code
        == 422
    )

    client.app.dependency_overrides[get_netbox_getter] = lambda: fake_get  # type: ignore[attr-defined]
    tested = client.post(f"{base}/test", headers=HEADERS).json()
    assert tested == {
        "version": "4.4.1",
        "dns_plugin": "1.4.0",
        "views": [{"id": 7, "name": "extern"}],
        "zones": 3,
    }

    # Admins ohne Monitoring.Reader sehen das Monitoring nicht und dürfen nicht vorziehen
    assert client.get("/api/monitoring/dns").status_code == 403
    assert client.post("/api/monitoring/dns/run", headers=HEADERS).status_code == 403
    login_as(client, ["Werkbank.Admin", "Monitoring.Reader"], oid="einstellungen-admin")
    scheduled = client.post("/api/monitoring/dns/run", headers=HEADERS)
    assert scheduled.status_code == 200
    planned = list(
        db.scalars(select(Job).where(Job.type == DNS_CHECK, Job.status == JobStatus.PLANNED))
    )
    assert len(planned) == 1
    # Noch einmal: kein zweiter Auftrag
    client.post("/api/monitoring/dns/run", headers=HEADERS)
    db.expire_all()
    assert (
        len(
            list(
                db.scalars(
                    select(Job).where(Job.type == DNS_CHECK, Job.status == JobStatus.PLANNED)
                )
            )
        )
        == 1
    )
    assert planned[0].scheduled_at <= now_utc() + timedelta(seconds=1)
