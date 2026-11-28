"""Einstellungen für NetBird (Verwaltung, NetBird): Adresse, Token, Ping in die Netze."""

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import NETBIRD_KEY, decrypt_secret, get_setting
from werkbank.modules.monitoring.netbird.client import NetBirdConfig

# Verlauf der verbundenen Peers und Verbindungstage je Peer
HISTORY_DAYS = 90


@dataclass(frozen=True)
class NetBirdSettings:
    url: str
    token_set: bool
    ping: bool


def stored(db: Session) -> dict[str, Any]:
    value = get_setting(db, NETBIRD_KEY)
    return value if isinstance(value, dict) else {}


def load_settings(db: Session) -> NetBirdSettings:
    data = stored(db)
    return NetBirdSettings(
        url=str(data.get("url") or ""),
        token_set=bool(data.get("token_encrypted")),
        ping=data.get("ping") is True,
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
