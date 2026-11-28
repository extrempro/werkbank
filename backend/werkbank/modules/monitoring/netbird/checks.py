"""Prüfungen aus Sicht des Servers der Werkbank: HTTPS-Abruf der Dienste am Reverse Proxy
(Antwort, Antwortzeit, Ablauf des Zertifikats), TCP-Prüfung von Signal und Relay und der
optionale Ping in die Netze.

Geprüft werden nur Adressen aus NetBird (Domains der Dienste, Testziele der Netze) und aus der
Verwaltung (Signal, Relay). HTTPS ohne Weiterleitungen, mit Zeitlimit und ohne den Inhalt zu
lesen.
"""

import ipaddress
import shutil
import socket
import ssl
import subprocess
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime

import httpx

TIMEOUT = 10.0
WORKERS = 8
DOMAIN_MAX = 253


@dataclass(frozen=True)
class HttpsResult:
    status_code: int | None
    ms: int | None
    cert_expires: datetime | None
    error: str

    @property
    def answered(self) -> bool:
        """Antwort ohne Serverfehler; Weiterleitungen und 401/403 (Anmeldung) zählen als Antwort."""
        return self.status_code is not None and self.status_code < 500


@dataclass(frozen=True)
class TcpResult:
    ok: bool
    ms: int | None
    error: str


def valid_domain(value: str) -> bool:
    if not value or len(value) > DOMAIN_MAX or "/" in value or ":" in value or "@" in value:
        return False
    labels = value.rstrip(".").split(".")
    return len(labels) >= 2 and all(
        label and len(label) <= 63 and label.replace("-", "").isalnum() for label in labels
    )


def cert_expiry(domain: str, timeout: float = TIMEOUT) -> datetime | None:
    context = ssl.create_default_context()
    with (
        socket.create_connection((domain, 443), timeout=timeout) as sock,
        context.wrap_socket(sock, server_hostname=domain) as tls,
    ):
        cert = tls.getpeercert()
    value = cert.get("notAfter") if cert else None
    if not isinstance(value, str):
        return None
    return datetime.fromtimestamp(ssl.cert_time_to_seconds(value), UTC)


def https_check(domain: str) -> HttpsResult:
    if not valid_domain(domain):
        return HttpsResult(None, None, None, "Ungültige Domain.")
    expires: datetime | None = None
    error = ""
    try:
        expires = cert_expiry(domain)
    except ssl.SSLCertVerificationError:
        error = "Zertifikat nicht gültig."
    except OSError, ValueError:
        pass
    started = time.monotonic()
    try:
        with httpx.Client(timeout=TIMEOUT, follow_redirects=False) as client:
            response = client.get(
                f"https://{domain}/", headers={"User-Agent": "Werkbank-Monitoring"}
            )
        return HttpsResult(
            response.status_code, int((time.monotonic() - started) * 1000), expires, error
        )
    except httpx.TimeoutException:
        return HttpsResult(None, None, expires, error or "Keine Antwort in 10 Sekunden.")
    except httpx.HTTPError:
        return HttpsResult(None, None, expires, error or "Nicht erreichbar.")


def tcp_check(target: str) -> TcpResult:
    host, _, port = target.rpartition(":")
    if not host or not port.isdigit():
        return TcpResult(False, None, "Ungültige Angabe.")
    started = time.monotonic()
    try:
        with socket.create_connection((host, int(port)), timeout=TIMEOUT):
            pass
    except OSError:
        return TcpResult(False, None, "Nicht erreichbar.")
    return TcpResult(True, int((time.monotonic() - started) * 1000), "")


def ping(address: str) -> bool | None:
    """Ein ICMP-Ping; None, wenn es auf dem Server kein ping gibt."""
    try:
        ipaddress.ip_address(address)
    except ValueError:
        return False
    binary = shutil.which("ping")
    if binary is None:
        return None
    result = subprocess.run(  # noqa: S603 (feste Argumente, Adresse geprüft)
        [binary, "-c", "1", "-W", "2", address],
        capture_output=True,
        timeout=5,
        check=False,
    )
    return result.returncode == 0


@dataclass
class Checker:
    """Austauschbar für Tests."""

    https: Callable[[str], HttpsResult] = https_check
    tcp: Callable[[str], TcpResult] = tcp_check
    ping: Callable[[str], bool | None] = ping


def run_https(checker: Checker, domains: list[str]) -> dict[str, HttpsResult]:
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        return dict(zip(domains, pool.map(checker.https, domains), strict=True))
