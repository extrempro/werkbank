"""IT-Tools: Abfragen ins Internet über den Server (DNS, RDAP, Datenlecks, crt.sh)."""

import base64
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_auth import ORIGIN, client_for, login_as, make_app, make_settings
from werkbank.core.models import AppSetting, AuditLog
from werkbank.modules.tools.api import get_fetcher
from werkbank.modules.tools.net import (
    Fetched,
    NetError,
    build_query,
    check_url,
    clear_bootstrap_cache,
    crtsh_names,
    dns_query,
    pick_server,
    pwned_range,
    rdap_lookup,
    valid_name,
    valid_rdap,
)

HEADERS = {"Origin": ORIGIN}
BASE = "/api/tools/net"

DNS_BOOTSTRAP = {"services": [[["com", "net"], ["http://alt.example", "https://rdap.example/"]]]}
IPV4_BOOTSTRAP = {
    "services": [
        [["192.0.0.0/8"], ["https://weit.example/rdap/"]],
        [["192.0.2.0/24"], ["https://eng.example/rdap/"]],
    ]
}
ASN_BOOTSTRAP = {"services": [[["64496-64511"], ["https://as.example/"]]]}


class FakeNet:
    """Ersetzt das Internet: Antworten je Adresse, merkt sich die Aufrufe."""

    def __init__(self, answers: dict[str, Fetched]) -> None:
        self.answers = answers
        self.calls: list[tuple[str, str, bytes | None, dict[str, str]]] = []

    def __call__(
        self,
        method: str,
        url: str,
        body: bytes | None,
        headers: dict[str, str],
        timeout: float,
        max_bytes: int,
    ) -> Fetched:
        self.calls.append((method, url, body, headers))
        for prefix, answer in self.answers.items():
            if url.startswith(prefix):
                return answer
        raise NetError("nicht erreichbar")


def ok(data: Any) -> Fetched:
    return Fetched(200, {}, json.dumps(data).encode())


@pytest.fixture(autouse=True)
def fresh_bootstrap() -> None:
    clear_bootstrap_cache()


# --- ohne Datenbank -------------------------------------------------------------------


def test_names_and_dns_query() -> None:
    assert valid_name(" Example.COM. ") == "example.com"
    assert valid_name("_dmarc.example.com") == "_dmarc.example.com"
    for bad in ("", "a..b", "-a.example.com", "a b", "x" * 64 + ".example.com", "ex/am.ple"):
        with pytest.raises(NetError):
            valid_name(bad)
    query = build_query("example.com", "MX")
    assert query[:12] == bytes([0, 0, 1, 0x20, 0, 1, 0, 0, 0, 0, 0, 0])
    assert query[12:] == b"\x07example\x03com\x00\x00\x0f\x00\x01"
    with pytest.raises(NetError):
        build_query("example.com", "ANY")


def test_dns_query_uses_fixed_resolver() -> None:
    wire = bytes(12) + b"rest"
    net = FakeNet({"https://dns.quad9.net/dns-query": Fetched(200, {}, wire)})
    body, ms = dns_query(net, "quad9", "example.com", "A")
    assert body == wire
    assert ms >= 0
    method, url, sent, headers = net.calls[0]
    assert (method, url, sent) == (
        "POST",
        "https://dns.quad9.net/dns-query",
        build_query("example.com", "A"),
    )
    assert headers["Content-Type"] == "application/dns-message"
    with pytest.raises(NetError, match="Unbekannter Resolver"):
        dns_query(net, "https://intern.example", "example.com", "A")
    failing = FakeNet({"https://dns.google": Fetched(503, {}, b"")})
    with pytest.raises(NetError, match="HTTP 503"):
        dns_query(failing, "google", "example.com", "A")


def test_check_url_allows_only_public_https() -> None:
    public = lambda host: ["93.184.215.14"]  # noqa: E731
    check_url("https://rdap.example/domain/example.com", public)
    for url in (
        "http://rdap.example/",
        "https://rdap.example:8443/",
        "https://nutzer:geheim@rdap.example/",
        "ftp://rdap.example/",
        "https://127.0.0.1/",
        "https://[::1]/",
        "https://10.0.0.1/",
    ):
        with pytest.raises(NetError):
            check_url(url, public)
    with pytest.raises(NetError, match="interne Adresse"):
        check_url("https://intern.example/", lambda host: ["93.184.215.14", "192.168.1.10"])

    def broken(host: str) -> list[str]:
        raise OSError("keine Auflösung")

    with pytest.raises(NetError, match="nicht auflösbar"):
        check_url("https://unbekannt.example/", broken)


def test_rdap_server_choice() -> None:
    assert pick_server("domain", "www.example.com", DNS_BOOTSTRAP["services"]) == (
        "https://rdap.example/"
    )
    assert pick_server("domain", "example.org", DNS_BOOTSTRAP["services"]) is None
    # Das engste passende Netz gewinnt.
    assert pick_server("ip", "192.0.2.7", IPV4_BOOTSTRAP["services"]) == "https://eng.example/rdap/"
    assert pick_server("ip", "192.1.0.0/16", IPV4_BOOTSTRAP["services"]) == (
        "https://weit.example/rdap/"
    )
    assert pick_server("autnum", "64500", ASN_BOOTSTRAP["services"]) == "https://as.example/"
    assert pick_server("autnum", "1", ASN_BOOTSTRAP["services"]) is None
    assert valid_rdap("autnum", "as64500") == "64500"
    assert valid_rdap("ip", "192.0.2.7") == "192.0.2.7"
    assert valid_rdap("ip", "2001:db8::/32") == "2001:db8::/32"
    for kind, value in (
        ("domain", "localhost"),
        ("ip", "kein-netz"),
        ("autnum", "AS1x"),
        ("x", "a"),
    ):
        with pytest.raises(NetError):
            valid_rdap(kind, value)


def test_rdap_lookup_follows_redirects_and_caches_directory() -> None:
    net = FakeNet(
        {
            "https://data.iana.org/rdap/dns.json": ok(DNS_BOOTSTRAP),
            "https://rdap.example/domain/example.com": Fetched(
                302, {"location": "https://registrar.example/domain/example.com"}, b""
            ),
            "https://registrar.example/": ok(
                {"objectClassName": "domain", "ldhName": "EXAMPLE.COM"}
            ),
        }
    )
    url, data = rdap_lookup(net, "domain", "Example.com")
    assert url == "https://registrar.example/domain/example.com"
    assert data["ldhName"] == "EXAMPLE.COM"
    rdap_lookup(net, "domain", "example.com")
    assert [call[1] for call in net.calls].count("https://data.iana.org/rdap/dns.json") == 1

    missing = FakeNet(
        {
            "https://data.iana.org/rdap/dns.json": ok(DNS_BOOTSTRAP),
            "https://rdap.example/": Fetched(404, {}, b""),
        }
    )
    clear_bootstrap_cache()
    with pytest.raises(NetError, match="nicht registriert"):
        rdap_lookup(missing, "domain", "frei.example.com")
    with pytest.raises(NetError, match="keinen RDAP-Server"):
        rdap_lookup(missing, "domain", "example.org")

    loop = FakeNet(
        {
            "https://data.iana.org/rdap/dns.json": ok(DNS_BOOTSTRAP),
            "https://rdap.example/": Fetched(301, {"location": "/domain/example.com"}, b""),
        }
    )
    clear_bootstrap_cache()
    with pytest.raises(NetError, match="Weiterleitungen"):
        rdap_lookup(loop, "domain", "example.com")


def test_pwned_sends_only_prefix() -> None:
    net = FakeNet({"https://api.pwnedpasswords.com/range/": Fetched(200, {}, b"00ABC:3\r\n")})
    assert pwned_range(net, "a94a8") == "00ABC:3\r\n"
    assert net.calls[0][1] == "https://api.pwnedpasswords.com/range/A94A8"
    assert net.calls[0][3] == {"Add-Padding": "true"}
    for bad in ("A94A", "A94A8F", "XYZ12"):
        with pytest.raises(NetError):
            pwned_range(net, bad)


def test_crtsh_keeps_needed_fields() -> None:
    entries = [
        {
            "name_value": "www.example.com\nexample.com",
            "not_before": "2026-01-01T00:00:00",
            "id": 1,
        },
        {"common_name": "mail.example.com", "issuer_name": "Beispiel CA"},
        "unsinn",
    ]
    net = FakeNet({"https://crt.sh/": ok(entries)})
    assert crtsh_names(net, "example.com") == [
        {"name_value": "www.example.com\nexample.com", "not_before": "2026-01-01T00:00:00"},
        {"common_name": "mail.example.com"},
    ]
    assert net.calls[0][1] == "https://crt.sh/?q=%25.example.com&output=json&deduplicate=Y"
    busy = FakeNet({"https://crt.sh/": Fetched(503, {}, b"")})
    with pytest.raises(NetError, match="überlastet"):
        crtsh_names(busy, "example.com")


# --- mit Datenbank --------------------------------------------------------------------


@pytest.fixture
def clean(migrated_db: None, db_session: Session) -> Session:
    db_session.execute(delete(AppSetting))
    db_session.commit()
    return db_session


def tools_client(net: FakeNet, roles: list[str], oid: str) -> TestClient:
    app = make_app(make_settings())
    app.dependency_overrides[get_fetcher] = lambda: net
    client = client_for(app)
    login_as(client, roles, oid=oid)
    return client


@pytest.mark.db
def test_api_needs_role_and_answers(clean: Session) -> None:
    wire = bytes([0, 0, 0x81, 0xA0, 0, 1, 0, 0, 0, 0, 0, 0])
    net = FakeNet(
        {
            "https://cloudflare-dns.com/": Fetched(200, {}, wire),
            "https://api.pwnedpasswords.com/": Fetched(200, {}, b"00ABC:3"),
            "https://crt.sh/": ok([{"name_value": "www.example.com"}]),
            "https://data.iana.org/rdap/asn.json": ok(ASN_BOOTSTRAP),
            "https://as.example/autnum/64500": ok({"objectClassName": "autnum"}),
        }
    )
    other = tools_client(net, ["Budget.Reader"], "ohne-tools")
    assert other.get(f"{BASE}/status").status_code == 403
    assert other.get(f"{BASE}/pwned/A94A8").status_code == 403

    client = tools_client(net, ["Tools.User"], "tools-nutzer")
    status = client.get(f"{BASE}/status").json()
    assert status["enabled"] is True
    assert [entry["id"] for entry in status["resolvers"]] == ["cloudflare", "google", "quad9"]

    answers = client.post(
        f"{BASE}/dns",
        json={
            "resolver": "cloudflare",
            "queries": [{"name": "example.com", "type": "a"}, {"name": "a b", "type": "A"}],
        },
        headers=HEADERS,
    )
    assert answers.status_code == 200, answers.text
    first, second = answers.json()
    assert (first["type"], base64.b64decode(first["wire"])) == ("A", wire)
    assert second["wire"] is None and "DNS-Name" in second["error"]
    assert (
        client.post(
            f"{BASE}/dns",
            json={"resolver": "intern", "queries": [{"name": "example.com", "type": "A"}]},
            headers=HEADERS,
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"{BASE}/dns",
            json={"resolver": "google", "queries": [{"name": "a.example", "type": "A"}] * 21},
            headers=HEADERS,
        ).status_code
        == 422
    )

    assert client.get(f"{BASE}/pwned/a94a8").json() == {"body": "00ABC:3"}
    assert client.get(f"{BASE}/pwned/a94a").status_code == 422
    assert client.get(f"{BASE}/crtsh", params={"domain": "example.com"}).json() == [
        {"name_value": "www.example.com"}
    ]
    found = client.get(f"{BASE}/rdap", params={"kind": "autnum", "value": "AS64500"})
    assert found.json() == {
        "url": "https://as.example/autnum/64500",
        "data": {"objectClassName": "autnum"},
    }
    failed = client.get(f"{BASE}/rdap", params={"kind": "domain", "value": "example.com"})
    assert failed.status_code == 502
    assert client.get(f"{BASE}/rdap", params={"kind": "whois", "value": "x"}).status_code == 422


@pytest.mark.db
def test_admin_switches_internet_off(clean: Session) -> None:
    net = FakeNet({"https://api.pwnedpasswords.com/": Fetched(200, {}, b"")})
    admin = tools_client(net, ["Werkbank.Admin"], "tools-admin")
    assert admin.get("/api/admin/settings").json()["tools_internet"] is True
    assert (
        tools_client(net, ["Tools.User"], "tools-leser")
        .put("/api/admin/settings/tools-internet", json={"enabled": False}, headers=HEADERS)
        .status_code
        == 403
    )
    changed = admin.put(
        "/api/admin/settings/tools-internet", json={"enabled": False}, headers=HEADERS
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["tools_internet"] is False

    client = tools_client(net, ["Tools.User"], "tools-aus")
    assert client.get(f"{BASE}/status").json()["enabled"] is False
    blocked = client.get(f"{BASE}/pwned/A94A8")
    assert blocked.status_code == 403
    assert "ausgeschaltet" in blocked.json()["detail"]
    assert net.calls == []
    clean.expire_all()
    actions = clean.scalars(select(AuditLog.action).where(AuditLog.module == "kern")).all()
    assert "einstellungen.tools_internet_geaendert" in actions
