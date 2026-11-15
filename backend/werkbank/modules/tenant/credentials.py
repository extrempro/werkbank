"""Zertifikate und Secrets der Anwendungen im Tenant: Abruf und Einstufung nach Restlaufzeit.

Gelesen werden App-Registrierungen (Secrets und Zertifikate) und Unternehmensanwendungen mit
Signaturzertifikat (SAML). Der geheime Wert eines Secrets wird nie gelesen oder gespeichert;
Microsoft Graph liefert ihn nach dem Anlegen nicht mehr aus.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.audit import write_audit
from werkbank.core.sessions import now_utc
from werkbank.modules.m365_config.utcm import UtcmClient, graph_token_provider
from werkbank.modules.tenant.models import TenantCredential

FETCH_CREDENTIALS = "tenant.zugangsdaten"
MODULE = "tenant"
HTTP_TIMEOUT_SECONDS = 120.0

# Wert der Spalte „kind“ für Secrets (kein geheimer Wert)
KIND_GEHEIMNIS = "secret"
KIND_CERTIFICATE = "zertifikat"
OWNER_APP = "app"
OWNER_SSO = "sso"

LEVEL_EXPIRED = "abgelaufen"
LEVEL_URGENT = "dringend"
LEVEL_WARN = "warnung"
LEVEL_NOTICE = "hinweis"
LEVEL_OK = "ok"
# Einstufungen, die als Aufgabe zählen
ATTENTION_LEVELS = frozenset({LEVEL_EXPIRED, LEVEL_URGENT, LEVEL_WARN, LEVEL_NOTICE})


@dataclass(frozen=True)
class CredentialResult:
    received: int = 0
    new: int = 0
    removed: int = 0


def days_left(expires_at: datetime | None, now: datetime) -> int | None:
    """Ganze Tage bis zum Ablauf, abgerundet; negativ, wenn abgelaufen. None ohne Ablaufdatum."""
    if expires_at is None:
        return None
    return (expires_at - now).days


def level_for(left: int | None, levels: tuple[int, int, int]) -> str:
    """Einstufung nach Restlaufzeit."""
    if left is None:
        return LEVEL_OK
    if left < 0:
        return LEVEL_EXPIRED
    notice, warn, urgent = levels
    if left <= urgent:
        return LEVEL_URGENT
    if left <= warn:
        return LEVEL_WARN
    return LEVEL_NOTICE if left <= notice else LEVEL_OK


def _text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.split())
    return cleaned[:limit] or None


def _moment(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


@dataclass(frozen=True)
class Found:
    owner_kind: str
    owner_id: str
    app_id: str | None
    owner_name: str
    kind: str
    key_id: str
    name: str | None
    starts_at: datetime | None
    expires_at: datetime | None


def _entries(owner: dict[str, Any], field: str) -> list[dict[str, Any]]:
    value = owner.get(field)
    return [entry for entry in value if isinstance(entry, dict)] if isinstance(value, list) else []


def read_owner(owner: dict[str, Any], owner_kind: str) -> list[Found]:
    """Zertifikate und Secrets einer Anwendung. Unbrauchbare Einträge werden übergangen."""
    owner_id = _text(owner.get("id"), 64)
    if owner_id is None:
        return []
    owner_name = _text(owner.get("displayName"), 256) or owner_id
    app_id = _text(owner.get("appId"), 64)
    found: list[Found] = []
    seen: set[tuple[str, str]] = set()
    sources = ((KIND_GEHEIMNIS, "passwordCredentials"), (KIND_CERTIFICATE, "keyCredentials"))
    for kind, field in sources:
        for entry in _entries(owner, field):
            key_id = _text(entry.get("keyId"), 64)
            if key_id is None:
                continue
            # Ein Signaturzertifikat steht bei Unternehmensanwendungen doppelt (Sign und Verify).
            mark = _text(entry.get("customKeyIdentifier"), 64) or key_id
            if (kind, mark) in seen:
                continue
            seen.add((kind, mark))
            found.append(
                Found(
                    owner_kind=owner_kind,
                    owner_id=owner_id,
                    app_id=app_id,
                    owner_name=owner_name,
                    kind=kind,
                    key_id=key_id,
                    name=_text(entry.get("displayName"), 256),
                    starts_at=_moment(entry.get("startDateTime")),
                    expires_at=_moment(entry.get("endDateTime")),
                )
            )
    return found


def fetch_credentials(db: Session, client: UtcmClient) -> CredentialResult:
    """Liest alle Zertifikate und Secrets und gleicht die gespeicherten Einträge ab."""
    found: list[Found] = []
    for app in client.applications():
        found.extend(read_owner(app, OWNER_APP))
    for principal in client.sso_service_principals():
        # Nur Zertifikate: Secrets von Unternehmensanwendungen gehören zur App-Registrierung.
        found.extend(
            entry for entry in read_owner(principal, OWNER_SSO) if entry.kind == KIND_CERTIFICATE
        )

    existing = {
        (row.owner_kind, row.owner_id, row.kind, row.key_id): row
        for row in db.scalars(select(TenantCredential)).all()
    }
    now = now_utc()
    seen: set[tuple[str, str, str, str]] = set()
    new = 0
    for entry in found:
        key = (entry.owner_kind, entry.owner_id, entry.kind, entry.key_id)
        if key in seen:
            continue
        seen.add(key)
        row = existing.get(key)
        if row is None:
            row = TenantCredential(
                owner_kind=entry.owner_kind,
                owner_id=entry.owner_id,
                kind=entry.kind,
                key_id=entry.key_id,
                owner_name=entry.owner_name,
            )
            db.add(row)
            new += 1
        row.app_id = entry.app_id
        row.owner_name = entry.owner_name
        row.name = entry.name
        row.starts_at = entry.starts_at
        row.expires_at = entry.expires_at
        row.active = True
        row.fetched_at = now
    removed = 0
    for key, row in existing.items():
        if key not in seen and row.active:
            row.active = False
            removed += 1
    write_audit(
        db,
        module=MODULE,
        action="zugangsdaten.abruf",
        object_type="tenant",
        details={"gelesen": len(seen), "neu": new, "entfallen": removed},
    )
    db.commit()
    return CredentialResult(received=len(seen), new=new, removed=removed)


def fetch_credentials_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    """Regelmäßiger Abruf. Ohne die Berechtigung bei Microsoft schlägt der Auftrag fehl."""
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False) as http:
        fetch_credentials(db, UtcmClient(http, graph_token_provider(settings)))
