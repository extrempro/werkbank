"""Abfragen der IT-Tools ins Internet, nur an feste oder aus festen Listen abgeleitete Ziele.

Regeln: nur https auf Port 443, Ziele nur mit öffentlichen Adressen, keine Weiterleitungen außer
bei RDAP (höchstens drei, wieder geprüft), Zeitlimit und Höchstgröße je Antwort. Angefragte Namen
werden weder gespeichert noch protokolliert.
"""

import ipaddress
import re
import socket
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urljoin, urlsplit

import httpx

DEFAULT_TIMEOUT = 10.0


class NetError(Exception):
    """Die Abfrage ging nicht; die Meldung ist für Menschen gedacht."""


@dataclass(frozen=True)
class Fetched:
    status: int
    headers: dict[str, str]
    body: bytes


# method, url, body, headers, timeout in Sekunden, Höchstgröße in Bytes
Fetcher = Callable[[str, str, bytes | None, dict[str, str], float, int], Fetched]


def _resolve(host: str) -> list[str]:
    infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return [str(info[4][0]) for info in infos]


def check_url(url: str, resolve: Callable[[str], list[str]] = _resolve) -> None:
    """Erlaubt nur https auf Port 443 zu Zielen, die ausschließlich öffentlich erreichbar sind."""
    parts = urlsplit(url)
    host = parts.hostname
    if parts.scheme != "https" or not host or parts.username or parts.password:
        raise NetError("Nur https-Adressen sind erlaubt.")
    if parts.port not in (None, 443):
        raise NetError("Nur der Standard-Port 443 ist erlaubt.")
    try:
        addresses = [host] if _is_ip(host) else resolve(host)
    except OSError as error:
        raise NetError(f"{host} ist nicht auflösbar.") from error
    if not addresses:
        raise NetError(f"{host} ist nicht auflösbar.")
    for address in addresses:
        if not ipaddress.ip_address(address.split("%")[0]).is_global:
            raise NetError(f"{host} zeigt auf eine interne Adresse; das ist nicht erlaubt.")


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def http_fetch(
    method: str,
    url: str,
    body: bytes | None,
    headers: dict[str, str],
    timeout: float,
    max_bytes: int,
) -> Fetched:
    """Ruft eine Adresse ab, ohne Weiterleitungen zu folgen."""
    check_url(url)
    try:
        with (
            httpx.Client(timeout=timeout, follow_redirects=False) as client,
            client.stream(method, url, content=body, headers=headers) as response,
        ):
            data = bytearray()
            for chunk in response.iter_bytes():
                data += chunk
                if len(data) > max_bytes:
                    raise NetError("Die Antwort ist zu groß.")
            return Fetched(response.status_code, dict(response.headers), bytes(data))
    except httpx.TimeoutException as error:
        raise NetError(f"{urlsplit(url).hostname} antwortet nicht rechtzeitig.") from error
    except httpx.HTTPError as error:
        raise NetError(f"{urlsplit(url).hostname} ist nicht erreichbar.") from error


# --- DNS über HTTPS (RFC 8484) ---

RESOLVERS: dict[str, tuple[str, str]] = {
    "cloudflare": ("Cloudflare (1.1.1.1)", "https://cloudflare-dns.com/dns-query"),
    "google": ("Google (8.8.8.8)", "https://dns.google/dns-query"),
    "quad9": ("Quad9 (9.9.9.9)", "https://dns.quad9.net/dns-query"),
}

TYPE_CODES: dict[str, int] = {
    "A": 1,
    "NS": 2,
    "CNAME": 5,
    "SOA": 6,
    "PTR": 12,
    "MX": 15,
    "TXT": 16,
    "AAAA": 28,
    "SRV": 33,
    "NAPTR": 35,
    "DNAME": 39,
    "DS": 43,
    "SSHFP": 44,
    "DNSKEY": 48,
    "TLSA": 52,
    "SVCB": 64,
    "HTTPS": 65,
    "SPF": 99,
    "CAA": 257,
}

NAME_PATTERN = re.compile(
    r"^(?=.{1,253}$)(?:[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?\.)*"
    r"[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$"
)
DNS_MAX_BYTES = 65_535


def valid_name(name: str) -> str:
    """Name ohne Punkt am Ende, klein geschrieben; NetError, wenn er kein DNS-Name ist."""
    clean = name.strip().rstrip(".").lower()
    if not NAME_PATTERN.match(clean):
        raise NetError("Kein gültiger DNS-Name.")
    return clean


def build_query(name: str, qtype: str) -> bytes:
    """DNS-Anfrage im Wire-Format: ID 0, Rekursion und AD-Bit erwünscht, eine Frage."""
    code = TYPE_CODES.get(qtype)
    if code is None:
        raise NetError(f"Unbekannter Typ {qtype}.")
    out = bytearray([0, 0, 0x01, 0x20, 0, 1, 0, 0, 0, 0, 0, 0])
    for label in valid_name(name).split("."):
        raw = label.encode("ascii")
        out.append(len(raw))
        out += raw
    out += bytes([0, code >> 8, code & 0xFF, 0, 1])
    return bytes(out)


def dns_query(fetch: Fetcher, resolver: str, name: str, qtype: str) -> tuple[bytes, int]:
    """Fragt einen der festen Resolver; liefert die Antwort im Wire-Format und die Dauer in ms."""
    entry = RESOLVERS.get(resolver)
    if entry is None:
        raise NetError("Unbekannter Resolver.")
    query = build_query(name, qtype)
    start = time.monotonic()
    result = fetch(
        "POST",
        entry[1],
        query,
        {"Content-Type": "application/dns-message", "Accept": "application/dns-message"},
        DEFAULT_TIMEOUT,
        DNS_MAX_BYTES,
    )
    ms = round((time.monotonic() - start) * 1000)
    if result.status != 200:
        raise NetError(f"{entry[0]} antwortet mit HTTP {result.status}.")
    if len(result.body) < 12:
        raise NetError(f"{entry[0]} liefert keine DNS-Antwort.")
    return result.body, ms


# --- RDAP ---

BOOTSTRAP_URLS: dict[str, str] = {
    "dns": "https://data.iana.org/rdap/dns.json",
    "ipv4": "https://data.iana.org/rdap/ipv4.json",
    "ipv6": "https://data.iana.org/rdap/ipv6.json",
    "asn": "https://data.iana.org/rdap/asn.json",
}
BOOTSTRAP_TTL_SECONDS = 24 * 3600
BOOTSTRAP_MAX_BYTES = 2_000_000
RDAP_MAX_BYTES = 1_000_000
RDAP_REDIRECTS = 3
_bootstrap_cache: dict[str, tuple[float, list[Any]]] = {}


def clear_bootstrap_cache() -> None:
    _bootstrap_cache.clear()


def _bootstrap(fetch: Fetcher, kind: str) -> list[Any]:
    cached = _bootstrap_cache.get(kind)
    if cached is not None and time.monotonic() - cached[0] < BOOTSTRAP_TTL_SECONDS:
        return cached[1]
    result = fetch("GET", BOOTSTRAP_URLS[kind], None, {}, DEFAULT_TIMEOUT, BOOTSTRAP_MAX_BYTES)
    if result.status != 200:
        raise NetError(f"Das RDAP-Verzeichnis der IANA antwortet mit HTTP {result.status}.")
    try:
        services = httpx.Response(200, content=result.body).json()["services"]
    except (ValueError, KeyError, TypeError) as error:
        raise NetError("Das RDAP-Verzeichnis der IANA ist nicht lesbar.") from error
    if not isinstance(services, list):
        raise NetError("Das RDAP-Verzeichnis der IANA ist nicht lesbar.")
    _bootstrap_cache[kind] = (time.monotonic(), services)
    return services


def _pick(urls: Any) -> str | None:
    if not isinstance(urls, list):
        return None
    secure = [url for url in urls if isinstance(url, str) and url.startswith("https://")]
    return secure[0] if secure else None


def pick_server(kind: str, value: str, services: list[Any]) -> str | None:
    """Zuständigen RDAP-Server aus der IANA-Liste wählen (nur https)."""
    entries = [entry for entry in services if isinstance(entry, list) and len(entry) == 2]
    if kind == "domain":
        labels = value.split(".")
        for index in range(len(labels)):
            suffix = ".".join(labels[index:])
            for keys, urls in entries:
                if isinstance(keys, list) and suffix in keys:
                    return _pick(urls)
        return None
    if kind == "autnum":
        number = int(value)
        for keys, urls in entries:
            for span in keys if isinstance(keys, list) else []:
                low, _, high = str(span).partition("-")
                if low.isdigit() and int(low) <= number <= int(high or low):
                    return _pick(urls)
        return None
    target = ipaddress.ip_network(value, strict=False)
    best: tuple[int, Any] | None = None
    for keys, urls in entries:
        for net in keys if isinstance(keys, list) else []:
            try:
                network = ipaddress.ip_network(str(net), strict=False)
            except ValueError:
                continue
            fits = network.version == target.version and target.subnet_of(network)  # type: ignore[arg-type]
            if fits and (best is None or network.prefixlen > best[0]):
                best = (network.prefixlen, urls)
    return _pick(best[1]) if best else None


def valid_rdap(kind: str, value: str) -> str:
    """Prüft die Anfrage; liefert den Wert so, wie er in die Adresse kommt."""
    clean = value.strip()
    if kind == "domain":
        name = valid_name(clean)
        if "." not in name:
            raise NetError("Bitte eine Domain mit Endung angeben, z. B. example.com.")
        return name
    if kind == "autnum":
        digits = clean.upper().removeprefix("AS").strip()
        if not digits.isdigit() or len(digits) > 10:
            raise NetError("Keine gültige AS-Nummer.")
        return str(int(digits))
    if kind == "ip":
        try:
            network = ipaddress.ip_network(clean, strict=False)
        except ValueError as error:
            raise NetError("Keine gültige IP-Adresse oder kein gültiges Netz.") from error
        return clean if "/" in clean else str(network.network_address)
    raise NetError("Unbekannte Art der Abfrage.")


def rdap_lookup(fetch: Fetcher, kind: str, value: str) -> tuple[str, Any]:
    """Fragt die zuständige Registry; liefert Adresse und JSON-Antwort."""
    clean = valid_rdap(kind, value)
    if kind == "domain":
        directory = "dns"
    elif kind == "autnum":
        directory = "asn"
    else:
        directory = "ipv6" if ":" in clean else "ipv4"
    server = pick_server(kind, clean, _bootstrap(fetch, directory))
    if server is None:
        if kind == "domain":
            tld = clean.rsplit(".", 1)[-1]
            raise NetError(f"Für „.{tld}“ gibt es keinen RDAP-Server bei der IANA.")
        raise NetError("Kein zuständiger RDAP-Server gefunden.")
    url = f"{server.rstrip('/')}/{kind}/{quote(clean, safe='/:')}"
    headers = {"Accept": "application/rdap+json, application/json"}
    for _ in range(RDAP_REDIRECTS + 1):
        result = fetch("GET", url, None, headers, DEFAULT_TIMEOUT, RDAP_MAX_BYTES)
        if result.status in (301, 302, 303, 307, 308):
            location = result.headers.get("location") or result.headers.get("Location")
            if not location:
                break
            url = urljoin(url, location)
            continue
        host = urlsplit(url).hostname
        if result.status == 404:
            raise NetError("Nicht gefunden: Die Domain ist vermutlich nicht registriert.")
        if result.status == 429:
            raise NetError("Zu viele Anfragen: Der RDAP-Server bremst. Bitte kurz warten.")
        if result.status != 200:
            raise NetError(f"{host} antwortet mit HTTP {result.status}.")
        try:
            return url, httpx.Response(200, content=result.body).json()
        except ValueError as error:
            raise NetError(f"{host} liefert kein lesbares RDAP.") from error
    raise NetError("Zu viele Weiterleitungen.")


# --- Have I Been Pwned (k-Anonymität) ---

PWNED_URL = "https://api.pwnedpasswords.com/range/"
PREFIX_PATTERN = re.compile(r"^[0-9A-F]{5}$")
PWNED_MAX_BYTES = 2_000_000


def pwned_range(fetch: Fetcher, prefix: str) -> str:
    """Liste der Hash-Enden zu den ersten fünf Zeichen eines SHA-1; mit Auffüllung."""
    clean = prefix.upper()
    if not PREFIX_PATTERN.match(clean):
        raise NetError("Erwartet werden genau fünf Hex-Zeichen.")
    headers = {"Add-Padding": "true"}
    result = fetch("GET", PWNED_URL + clean, None, headers, DEFAULT_TIMEOUT, PWNED_MAX_BYTES)
    if result.status != 200:
        raise NetError(f"Have I Been Pwned antwortet mit HTTP {result.status}.")
    return result.body.decode("ascii", errors="replace")


# --- crt.sh (Zertifikats-Transparenz) ---

CRTSH_URL = "https://crt.sh/"
CRTSH_TIMEOUT = 60.0
CRTSH_MAX_BYTES = 30_000_000
CRTSH_MAX_ENTRIES = 20_000


def crtsh_names(fetch: Fetcher, domain: str) -> list[dict[str, str]]:
    """Namen aus Zertifikaten zur Domain und ihren Subdomains, gekürzt auf die nötigen Felder."""
    clean = valid_name(domain)
    url = f"{CRTSH_URL}?q={quote('%.' + clean)}&output=json&deduplicate=Y"
    result = fetch("GET", url, None, {"Accept": "application/json"}, CRTSH_TIMEOUT, CRTSH_MAX_BYTES)
    if result.status in (502, 503, 504):
        raise NetError("crt.sh ist gerade überlastet. Bitte später erneut versuchen.")
    if result.status != 200:
        raise NetError(f"crt.sh antwortet mit HTTP {result.status}.")
    try:
        data = httpx.Response(200, content=result.body).json()
    except ValueError as error:
        raise NetError("crt.sh liefert keine lesbare Antwort.") from error
    if not isinstance(data, list):
        return []
    out: list[dict[str, str]] = []
    for entry in data[:CRTSH_MAX_ENTRIES]:
        if not isinstance(entry, dict):
            continue
        out.append(
            {
                key: entry[key]
                for key in ("name_value", "common_name", "not_before")
                if isinstance(entry.get(key), str)
            }
        )
    return out
