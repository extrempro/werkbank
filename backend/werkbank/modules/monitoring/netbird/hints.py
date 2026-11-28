"""Hinweise zu NetBird: kritisch, Warnung, Info. Sie werden aus dem jüngsten Stand berechnet;
ein Hinweis, der nicht mehr zutrifft, verschwindet von selbst.

Phase 1: Anmeldung läuft bald ab, Client zwei oder mehr Releases zurück, Freigabe offen (nur
wenn NetBird die Freigabe liefert), Peer lange nicht gesehen.
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

CRITICAL = "kritisch"
WARNING = "warnung"
INFO = "info"
LEVELS = (CRITICAL, WARNING, INFO)

LOGIN_WARN = timedelta(days=7)
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


def all_hints(data: Mapping[str, Any], now: datetime) -> list[Hint]:
    hints = peer_hints(data, now)
    order = {level: index for index, level in enumerate(LEVELS)}
    hints.sort(key=lambda h: (order[h.level], h.title.lower()))
    return hints
