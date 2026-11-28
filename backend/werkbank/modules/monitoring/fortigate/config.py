"""Einstellungen für FortiGate (Verwaltung, FortiGate): Abrufabstand, Aufbewahrung, CA-Zertifikat
und FortiAnalyzer. Die Geräte stehen in eigener Tabelle (models.FgDevice)."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import FORTIGATE_KEY, decrypt_secret, get_setting
from werkbank.modules.monitoring.fortigate.client import DeviceConfig
from werkbank.modules.monitoring.fortigate.models import FgDevice

INTERVALS = (15, 30, 60, 120, 240)
INTERVAL_DEFAULT = 60
RETENTION_MIN = 1
RETENTION_MAX = 36
RETENTION_DEFAULT = 3
ADOM_DEFAULT = "root"


@dataclass(frozen=True)
class Analyzer:
    enabled: bool
    url: str
    adom: str
    key_set: bool


@dataclass(frozen=True)
class FortiGateSettings:
    interval_minutes: int
    retention_months: int
    ca_pem: str | None
    analyzer: Analyzer


def stored(db: Session) -> dict[str, Any]:
    value = get_setting(db, FORTIGATE_KEY)
    return value if isinstance(value, dict) else {}


def load_settings(db: Session) -> FortiGateSettings:
    data = stored(db)
    interval = data.get("interval_minutes")
    months = data.get("retention_months")
    raw_faz = data.get("analyzer")
    faz: dict[str, Any] = raw_faz if isinstance(raw_faz, dict) else {}
    ca_pem = data.get("ca_pem")
    return FortiGateSettings(
        interval_minutes=interval if interval in INTERVALS else INTERVAL_DEFAULT,
        retention_months=months
        if isinstance(months, int) and RETENTION_MIN <= months <= RETENTION_MAX
        else RETENTION_DEFAULT,
        ca_pem=ca_pem if isinstance(ca_pem, str) and ca_pem else None,
        analyzer=Analyzer(
            enabled=faz.get("enabled") is True,
            url=str(faz.get("url") or ""),
            adom=str(faz.get("adom") or ADOM_DEFAULT),
            key_set=bool(faz.get("key_encrypted")),
        ),
    )


def device_config(device: FgDevice, settings: Settings, ca_pem: str | None) -> DeviceConfig | None:
    """Zugang zu einem Gerät; None, wenn sich das Token nicht entschlüsseln lässt."""
    token = decrypt_secret(settings, device.token_encrypted) if device.token_encrypted else None
    if not token:
        return None
    return DeviceConfig(name=device.name, url=device.url, token=token, ca_pem=ca_pem)


def months_ago(now: datetime, months: int) -> datetime:
    """Gleicher Tag vor `months` Monaten (am Monatsende der letzte Tag des Zielmonats)."""
    month = now.month - months
    year = now.year
    while month < 1:
        month += 12
        year -= 1
    for day in (now.day, 30, 29, 28):
        try:
            return now.replace(year=year, month=month, day=day)
        except ValueError:
            continue
    return now.replace(year=year, month=month, day=28)
