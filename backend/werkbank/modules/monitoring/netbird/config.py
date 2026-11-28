"""Einstellungen für NetBird (Verwaltung, NetBird): Adresse, Token, Ping in die Netze."""

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import NETBIRD_KEY, decrypt_secret, get_setting
from werkbank.modules.monitoring.netbird.client import NetBirdConfig
from werkbank.modules.monitoring.netbird.crowdsec import LapiConfig

# Verlauf der verbundenen Peers und Verbindungstage je Peer
HISTORY_DAYS = 90
# Verfügbarkeit der Dienste am Reverse Proxy
CHECK_DAYS = 30


@dataclass(frozen=True)
class NetBirdSettings:
    url: str
    token_set: bool
    ping: bool
    signal: str
    relay: str
    # Namen der Gruppen mit Servern (für die Prüfung „ohne Posture Check“)
    server_groups: tuple[str, ...] = ()
    # CrowdSec (Phase 4): Local API mit Bouncer-Schlüssel, Dienste bewusst ohne CrowdSec
    crowdsec_url: str = ""
    crowdsec_key_set: bool = False
    crowdsec_exempt: tuple[str, ...] = ()


def stored(db: Session) -> dict[str, Any]:
    value = get_setting(db, NETBIRD_KEY)
    return value if isinstance(value, dict) else {}


def load_settings(db: Session) -> NetBirdSettings:
    data = stored(db)
    return NetBirdSettings(
        url=str(data.get("url") or ""),
        token_set=bool(data.get("token_encrypted")),
        ping=data.get("ping") is True,
        signal=str(data.get("signal") or ""),
        relay=str(data.get("relay") or ""),
        server_groups=tuple(
            str(name) for name in data.get("server_groups") or [] if isinstance(name, str)
        ),
        crowdsec_url=str(data.get("crowdsec_url") or ""),
        crowdsec_key_set=bool(data.get("crowdsec_key_encrypted")),
        crowdsec_exempt=tuple(
            str(name) for name in data.get("crowdsec_exempt") or [] if isinstance(name, str)
        ),
    )


def client_config(db: Session, settings: Settings) -> NetBirdConfig | None:
    """Zugang zu NetBird; None, wenn nicht eingerichtet oder das Token nicht lesbar ist."""
    data = stored(db)
    url = str(data.get("url") or "")
    encrypted = data.get("token_encrypted")
    token = decrypt_secret(settings, encrypted) if isinstance(encrypted, str) else None
    if not url or not token:
        return None
    return NetBirdConfig(url=url, token=token)


def lapi_config(db: Session, settings: Settings) -> LapiConfig | None:
    """Zugang zur Local API von CrowdSec; None, wenn nicht eingerichtet."""
    data = stored(db)
    url = str(data.get("crowdsec_url") or "")
    encrypted = data.get("crowdsec_key_encrypted")
    key = decrypt_secret(settings, encrypted) if isinstance(encrypted, str) else None
    if not url or not key:
        return None
    return LapiConfig(url=url, key=key)
