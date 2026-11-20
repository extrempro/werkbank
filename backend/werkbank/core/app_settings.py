"""Einstellungen der Werkbank, die in der Verwaltung gepflegt werden (Tabelle `app_settings`).

Geheime Werte (z. B. das SMTP-Passwort) liegen nur verschlüsselt in der Datenbank. Der Schlüssel
dazu ist eine Secret-Datei auf dem Server (`SETTINGS_KEY_FILE`); ohne sie lassen sich keine
geheimen Werte speichern oder lesen.
"""

import base64
import hashlib
import uuid
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.models import AppSetting
from werkbank.core.sessions import now_utc

AUDIT_RETENTION_KEY = "audit_retention_days"
AUDIT_RETENTION_DEFAULT = 90
AUDIT_RETENTION_MIN = 30
AUDIT_RETENTION_MAX = 3650
SMTP_KEY = "smtp"
# Dürfen die IT-Tools über den Server ins Internet fragen (DNS, RDAP, Datenlecks, crt.sh)?
TOOLS_INTERNET_KEY = "tools_internet"
TEAMS_KEY = "teams_workflow"
PUSH_KEY = "push"
NETBOX_KEY = "netbox"
NINJA_KEY = "inventory.ninjaone"

MIN_KEY_LENGTH = 32


class SecretKeyMissingError(Exception):
    """Die Secret-Datei mit dem Schlüssel fehlt oder ist zu kurz."""


def get_setting(db: Session, key: str, default: Any = None) -> Any:
    row = db.get(AppSetting, key)
    return row.value if row is not None else default


def set_setting(db: Session, key: str, value: Any, user_id: uuid.UUID | None) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value, updated_by=user_id, updated_at=now_utc()))
    else:
        row.value = value
        row.updated_by = user_id
        row.updated_at = now_utc()


def audit_retention_days(db: Session) -> int:
    """Aufbewahrungsfrist des Audit-Logs in Tagen, immer innerhalb der erlaubten Grenzen."""
    value = get_setting(db, AUDIT_RETENTION_KEY, AUDIT_RETENTION_DEFAULT)
    if not isinstance(value, int) or isinstance(value, bool):
        return AUDIT_RETENTION_DEFAULT
    return min(max(value, AUDIT_RETENTION_MIN), AUDIT_RETENTION_MAX)


def tools_internet_enabled(db: Session) -> bool:
    """Abfragen der IT-Tools ins Internet; ohne Einstellung erlaubt."""
    value = get_setting(db, TOOLS_INTERNET_KEY, True)
    return value if isinstance(value, bool) else True


def secret_key_available(settings: Settings) -> bool:
    try:
        _fernet(settings)
    except SecretKeyMissingError:
        return False
    return True


def _fernet(settings: Settings) -> Fernet:
    try:
        material = settings.settings_key_file.read_text(encoding="utf-8").strip()
    except OSError as error:
        raise SecretKeyMissingError from error
    if len(material) < MIN_KEY_LENGTH:
        raise SecretKeyMissingError
    # Beliebiger langer Zufallstext als Datei; daraus wird der eigentliche Schlüssel abgeleitet.
    digest = hashlib.sha256(material.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(settings: Settings, plain: str) -> str:
    return _fernet(settings).encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_secret(settings: Settings, token: str) -> str | None:
    """Klartext, oder None, wenn der Wert mit dem aktuellen Schlüssel nicht lesbar ist."""
    try:
        return _fernet(settings).decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, SecretKeyMissingError, ValueError):
        return None


# Vorlauf für ablaufende Zertifikate und Secrets in Tagen: Hinweis, Warnung, dringend.
WARN_DAYS_KEY = "tenant.credential_warn_days"
WARN_DAYS_DEFAULT = (60, 30, 7)
WARN_DAYS_MIN = 1
WARN_DAYS_MAX = 365


def valid_warn_days(value: Any) -> tuple[int, int, int] | None:
    """Drei ganze Zahlen, absteigend und innerhalb der Grenzen; sonst None."""
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        return None
    if any(isinstance(day, bool) or not isinstance(day, int) for day in value):
        return None
    notice, warn, urgent = value
    if not WARN_DAYS_MAX >= notice > warn > urgent >= WARN_DAYS_MIN:
        return None
    return (notice, warn, urgent)


def warn_days(db: Session) -> tuple[int, int, int]:
    """Der eingestellte Vorlauf, sonst der Standard."""
    return valid_warn_days(get_setting(db, WARN_DAYS_KEY)) or WARN_DAYS_DEFAULT
