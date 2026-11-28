"""Hinweise zu NetBird: kritisch, Warnung, Info. Sie werden aus dem jüngsten Stand berechnet;
ein Hinweis, der nicht mehr zutrifft, verschwindet von selbst.

Phase 1: Anmeldung läuft bald ab, Client zwei oder mehr Releases zurück, Freigabe offen (nur
wenn NetBird die Freigabe liefert), Peer lange nicht gesehen.
Phase 2: Netz ohne verbundenen Routing-Peer, Netz ohne Ausfallweg, Dienst antwortet nicht oder
mit Serverfehler, Zertifikat läuft bald ab.
Phase 3: Richtlinie mit Quelle und Ziel „All“ und allen Ports, Setup-Key läuft in 30 bzw. 7 Tagen
ab, leere Gruppe in einer Richtlinie, Richtlinie seit über 90 Tagen deaktiviert.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from werkbank.modules.monitoring.netbird.policies import (
    KEY_SOON,
    KEY_WARN,
    findings,
    key_active,
    key_expires,
)

CRITICAL = "kritisch"
WARNING = "warnung"
INFO = "info"
LEVELS = (CRITICAL, WARNING, INFO)

LOGIN_WARN = timedelta(days=7)
CERT_WARN = timedelta(days=30)
NOT_SEEN = timedelta(days=90)
OLD_RELEASES = 2

VERSION = re.compile(r"^v?(\d+)\.(\d+)(?:\.(\d+))?")


@dataclass(frozen=True)
class Hint:
    level: str
    code: str
    title: str
    text: str
    link: str
    # Gegenstand, z. B. „peer:<id>“; zusammen mit code der feste Schlüssel
    subject: str

    @property
    def key(self) -> str:
        return f"{self.code}|{self.subject}"


def parse_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value or value.startswith("0001-"):
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else None


def releases_behind(version: str, latest: str) -> int | None:
    """Wie viele Releases (zweite Stelle der Version) ein Client zurückliegt; None: unbekannt."""
    have, want = VERSION.match(version or ""), VERSION.match(latest or "")
    if not have or not want:
        return None
    if have.group(1) != want.group(1):
        return OLD_RELEASES if int(have.group(1)) < int(want.group(1)) else 0
    return max(int(want.group(2)) - int(have.group(2)), 0)


def login_expires(peer: Mapping[str, Any], account: Mapping[str, Any] | None) -> datetime | None:
    """Ablauf der Anmeldung eines Peers mit Benutzer: letzte Anmeldung + Ablaufzeit im Konto."""
    if not account or not account.get("login_expiration_enabled"):
        return None
    seconds = account.get("login_expiration_seconds")
    last = parse_time(peer.get("last_login"))
    if (
        not peer.get("login_expiration_enabled")
        or not peer.get("user_id")
        or not seconds
        or not last
    ):
        return None
    return last + timedelta(seconds=int(seconds))


def status(peer: Mapping[str, Any]) -> str:
    if peer.get("approval_required") is True:
        return "freigabe"
    if peer.get("login_expired"):
        return "abgelaufen"
    return "verbunden" if peer.get("connected") else "offline"


def _date(moment: datetime) -> str:
    return f"{moment:%d.%m.%Y}"


def peer_hints(data: Mapping[str, Any], now: datetime) -> list[Hint]:
    latest = str((data.get("version") or {}).get("available") or "")
    account = data.get("account")
    out: list[Hint] = []
    for peer in data.get("peers") or []:
        pid = peer["id"]
        name = peer["name"] or pid
        link = f"/monitoring/netbird/peers?auswahl={pid}"
        subject = f"peer:{pid}"
        if peer.get("approval_required") is True:
            out.append(
                Hint(
                    WARNING,
                    "freigabe",
                    f"Peer {name} wartet auf Freigabe",
                    "Der Peer ist angemeldet, darf aber erst nach der Freigabe ins Netz.",
                    link,
                    subject,
                )
            )
        expires = login_expires(peer, account)
        if (
            expires is not None
            and not peer.get("login_expired")
            and now <= expires <= now + LOGIN_WARN
        ):
            out.append(
                Hint(
                    WARNING,
                    "anmeldung",
                    f"Anmeldung von {name} läuft am {_date(expires)} ab",
                    "Danach muss sich die Person am Gerät neu anmelden.",
                    link,
                    subject,
                )
            )
        behind = releases_behind(peer.get("version") or "", latest)
        if behind is not None and behind >= OLD_RELEASES:
            out.append(
                Hint(
                    WARNING,
                    "version",
                    f"Client von {name} ist {behind} Releases zurück",
                    f"Version {peer.get('version')}, neuestes Release {latest}.",
                    link,
                    subject,
                )
            )
        seen = parse_time(peer.get("last_seen"))
        if not peer.get("connected") and seen is not None and now - seen > NOT_SEEN:
            out.append(
                Hint(
                    INFO,
                    "nicht_gesehen",
                    f"Peer {name} seit über 90 Tagen nicht gesehen",
                    f"Zuletzt gesehen am {_date(seen)}. Wird das Gerät noch gebraucht?",
                    link,
                    subject,
                )
            )
    return out


def network_status(network: Mapping[str, Any], data: Mapping[str, Any]) -> dict[str, Any]:
    """Routing-Peers eines Netzes mit Status und daraus „erreichbar“ (ohne Ping) bzw. mit Ping."""
    peers = {p["id"]: p for p in data.get("peers") or []}
    members = {g["id"]: list(g.get("peers") or []) for g in data.get("groups") or []}
    ids: list[str] = []
    for item in network.get("routers") or []:
        if not item.get("enabled", True):
            continue
        candidates = [item["peer"]] if item.get("peer") else []
        for gid in item.get("peer_groups") or []:
            candidates.extend(members.get(gid, []))
        for pid in candidates:
            if pid not in ids:
                ids.append(pid)
    routers = [
        {
            "id": pid,
            "name": (peers.get(pid) or {}).get("name") or pid,
            "connected": bool((peers.get(pid) or {}).get("connected")),
        }
        for pid in ids
    ]
    connected = sum(1 for r in routers if r["connected"])
    checks = data.get("checks") or {}
    probe = (checks.get("ping") or {}).get(network.get("id"))
    if not routers:
        state = "ohne_router"
    elif connected == 0 or (probe is not None and probe.get("ok") is False):
        state = "nicht_erreichbar"
    elif connected == 1:
        state = "ohne_ausfallweg"
    else:
        state = "erreichbar"
    return {
        "routers": routers,
        "connected": connected,
        "total": len(routers),
        "state": state,
        "target": probe.get("target") if probe else "",
        "ping": probe.get("ok") if probe else None,
    }


def network_hints(data: Mapping[str, Any]) -> list[Hint]:
    out: list[Hint] = []
    link = "/monitoring/netbird/netze"
    for network in (data.get("networks") or []) + (data.get("legacy_routes") or []):
        info = network_status(network, data)
        name = network.get("name") or network.get("id")
        subject = f"netz:{network.get('id')}"
        offline = [r["name"] for r in info["routers"] if not r["connected"]]
        if info["total"] and info["connected"] == 0:
            out.append(
                Hint(
                    CRITICAL,
                    "netz_offline",
                    f"Netz „{name}“ ohne verbundenen Routing-Peer",
                    f"Offline: {', '.join(offline)}. Das Netz ist über NetBird nicht erreichbar.",
                    link,
                    subject,
                )
            )
        elif info["state"] == "nicht_erreichbar":
            out.append(
                Hint(
                    CRITICAL,
                    "netz_ping",
                    f"Netz „{name}“ antwortet nicht auf den Ping",
                    f"Testziel {info['target']} ist nicht erreichbar, obwohl ein Routing-Peer "
                    "verbunden ist.",
                    link,
                    subject,
                )
            )
        elif info["connected"] == 1:
            out.append(
                Hint(
                    WARNING,
                    "netz_ausfallweg",
                    f"Netz „{name}“ nur mit einem verbundenen Routing-Peer",
                    "Fällt dieser Routing-Peer aus, ist das Netz nicht mehr erreichbar.",
                    link,
                    subject,
                )
            )
    return out


def service_hints(data: Mapping[str, Any], now: datetime) -> list[Hint]:
    out: list[Hint] = []
    link = "/monitoring/netbird/netze"
    results = (data.get("checks") or {}).get("services") or {}
    for item in data.get("services") or []:
        result = results.get(item["id"])
        if result is None:
            continue
        subject = f"dienst:{item['id']}"
        domain = item.get("domain") or item.get("name")
        if not result.get("answered"):
            code = result.get("status_code")
            out.append(
                Hint(
                    CRITICAL,
                    "dienst_fehler",
                    f"Dienst {domain} antwortet mit {code}"
                    if code
                    else f"Dienst {domain} antwortet nicht",
                    result.get("error") or "Der HTTPS-Abruf der Werkbank ist fehlgeschlagen.",
                    link,
                    subject,
                )
            )
        expires = parse_time(result.get("cert_expires"))
        if expires is not None and expires <= now + CERT_WARN:
            out.append(
                Hint(
                    WARNING,
                    "zertifikat",
                    f"Zertifikat von {domain} läuft am {_date(expires)} ab",
                    "Normalerweise erneuert der Reverse Proxy es selbst. Läuft es trotzdem ab, "
                    "prüfe den Dienst in NetBird.",
                    link,
                    subject,
                )
            )
    return out


POLICIES_LINK = "/monitoring/netbird/richtlinien"
# Befunde der Richtlinien-Prüfung, die auch als Hinweis erscheinen (spec.md)
POLICY_HINT_CODES = ("richtlinie_all", "gruppe_leer", "richtlinie_deaktiviert")


def policy_hints(data: Mapping[str, Any], now: datetime) -> list[Hint]:
    out = [
        Hint(f.level, f.code, f.title, f.text, POLICIES_LINK, f.subject)
        for f in findings(data, now)
        if f.code in POLICY_HINT_CODES
    ]
    for key in data.get("setup_keys") or []:
        expires = key_expires(key)
        if not key_active(key) or expires is None or not now <= expires <= now + KEY_WARN:
            continue
        soon = expires <= now + KEY_SOON
        name = key.get("name") or key["id"]
        out.append(
            Hint(
                WARNING,
                "setupkey_7" if soon else "setupkey_30",
                f"Setup-Key {name} läuft am {_date(expires)} ab",
                "Danach lassen sich damit keine Geräte mehr anmelden.",
                POLICIES_LINK,
                f"setupkey:{key['id']}",
            )
        )
    return out


def all_hints(data: Mapping[str, Any], now: datetime) -> list[Hint]:
    hints = (
        peer_hints(data, now)
        + network_hints(data)
        + service_hints(data, now)
        + policy_hints(data, now)
    )
    order = {level: index for index, level in enumerate(LEVELS)}
    hints.sort(key=lambda h: (order[h.level], h.title.lower()))
    return hints
