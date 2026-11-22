"""Einstellungen der Quelle Zabbix: Verbindung (Verwaltung) und Optionen (Verbindungsseite)."""

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import (
    ZABBIX_KEY,
    ZABBIX_OPTIONS_KEY,
    decrypt_secret,
    get_setting,
)
from werkbank.modules.monitoring.zabbix.client import ZabbixConfig

TAG_MAX = 100
TARGET_DEFAULT = 99.5
TARGET_MIN = 90.0
TARGET_MAX = 100.0


def stored_connection(db: Session) -> dict[str, Any]:
    value = get_setting(db, ZABBIX_KEY)
    return value if isinstance(value, dict) else {}


def load_config(
    db: Session, settings: Settings, *, require_enabled: bool = True
) -> ZabbixConfig | None:
    """Verbindung aus der Verwaltung; None, wenn ausgeschaltet oder unvollständig."""
    stored = stored_connection(db)
    if require_enabled and stored.get("enabled") is not True:
        return None
    url = stored.get("url")
    token_encrypted = stored.get("token_encrypted")
    token = (
        decrypt_secret(settings, token_encrypted)
        if isinstance(token_encrypted, str) and token_encrypted
        else None
    )
    if not isinstance(url, str) or not url or not token:
        return None
    ca_pem = stored.get("ca_pem")
    return ZabbixConfig(
        url=url, token=token, ca_pem=ca_pem if isinstance(ca_pem, str) and ca_pem else None
    )


def frontend_url(db: Session) -> str | None:
    """Adresse der Oberfläche für den Sprung nach Zabbix (ohne Token).

    Eigene Adresse für Links, wenn die Werkbank Zabbix über einen anderen Weg erreicht als
    die Menschen (z. B. einen eigenen Proxy-Eintrag nur für den Werkbank-Server)."""
    stored = stored_connection(db)
    url = stored.get("link_url") or stored.get("url")
    if stored.get("enabled") is not True or not isinstance(url, str) or not url:
        return None
    return url.rstrip("/")


@dataclass(frozen=True)
class Options:
    # Tag für ablaufende Zertifikate, z. B. ("component", "certificate"); None: aus
    certificate_tag: tuple[str, str] | None
    # Hardware-Arten des IT-Bestands, die in Zabbix überwacht sein sollen
    kind_ids: tuple[int, ...] = ()
    # Zielwert der Verfügbarkeit in Prozent
    target: float = TARGET_DEFAULT


def load_options(db: Session) -> Options:
    value = get_setting(db, ZABBIX_OPTIONS_KEY)
    data = value if isinstance(value, dict) else {}
    tag = data.get("certificate_tag")
    certificate: tuple[str, str] | None = None
    if isinstance(tag, dict) and isinstance(tag.get("tag"), str) and tag["tag"]:
        certificate = (tag["tag"][:TAG_MAX], str(tag.get("value") or "")[:TAG_MAX])
    kinds = data.get("kind_ids")
    kind_ids = tuple(
        value for value in (kinds if isinstance(kinds, list) else []) if isinstance(value, int)
    )[:200]
    target = data.get("target")
    if isinstance(target, bool) or not isinstance(target, int | float):
        target = TARGET_DEFAULT
    target = float(target) if TARGET_MIN <= target <= TARGET_MAX else TARGET_DEFAULT
    return Options(certificate_tag=certificate, kind_ids=kind_ids, target=target)
