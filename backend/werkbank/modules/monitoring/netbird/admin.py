"""Verwaltung, NetBird: Management-URL, API-Token (verschlüsselt, nie ausgegeben), Ping-Schalter,
Verbindungstest. Nur für System-Admins mit frischer Anmeldung."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from werkbank.core.admin_settings import AdminUser, client_ip
from werkbank.core.app_settings import (
    NETBIRD_KEY,
    SecretKeyMissingError,
    encrypt_secret,
    secret_key_available,
    set_setting,
)
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep
from werkbank.modules.monitoring.netbird.client import (
    NetBirdClient,
    NetBirdError,
    Transport,
    http_transport,
    valid_url,
)
from werkbank.modules.monitoring.netbird.collector import last_run
from werkbank.modules.monitoring.netbird.config import client_config, load_settings, stored

router = APIRouter(prefix="/api/admin/settings/netbird")
TARGET_PATTERN = r"^$|^[A-Za-z0-9]([A-Za-z0-9.-]{0,252}):(\d{1,5})$"
MODULE = "verwaltung"


def get_netbird_transport() -> Transport:
    """Abhängigkeit, damit Tests NetBird ersetzen können."""
    return http_transport


TransportDep = Annotated[Transport, Depends(get_netbird_transport)]


def _audit(
    db: DbDep,
    request: Request,
    user: AdminUser,
    action: str,
    details: dict[str, Any] | None = None,
    note: str | None = None,
    ok: bool = True,
) -> None:
    write_audit(
        db,
        module=MODULE,
        action=f"einstellungen.netbird_{action}",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=NETBIRD_KEY,
        ip=client_ip(request),
        details=details,
        note=note,
        result="ok" if ok else "fehler",
    )


class SettingsOut(BaseModel):
    url: str
    token_set: bool
    ping: bool
    signal: str
    relay: str
    token_storage_available: bool
    last_run_at: Any = None
    last_ok: bool | None = None
    last_error: str | None = None


def _out(db: DbDep, settings: SettingsDep) -> SettingsOut:
    options = load_settings(db)
    run = last_run(db)
    return SettingsOut(
        url=options.url,
        token_set=options.token_set,
        ping=options.ping,
        signal=options.signal,
        relay=options.relay,
        token_storage_available=secret_key_available(settings),
        last_run_at=run.started_at if run else None,
        last_ok=run.ok if run else None,
        last_error=run.error if run and not run.ok else None,
    )


@router.get("")
def get_settings(user: AdminUser, db: DbDep, settings: SettingsDep) -> SettingsOut:
    return _out(db, settings)


class SettingsIn(BaseModel):
    url: str = Field(max_length=300)
    # None: unverändert, leer: löschen
    token: str | None = Field(default=None, max_length=500)
    ping: bool = False
    # Host:Port für die TCP-Prüfung; leer: keine Prüfung
    signal: str = Field(default="", max_length=260, pattern=TARGET_PATTERN)
    relay: str = Field(default="", max_length=260, pattern=TARGET_PATTERN)


@router.put("")
def put_settings(
    request: Request, body: SettingsIn, user: AdminUser, db: DbDep, settings: SettingsDep
) -> SettingsOut:
    url = body.url.strip().rstrip("/")
    if url and not valid_url(url):
        raise HTTPException(
            status_code=422,
            detail="Bitte trag die https-Adresse ohne Pfad ein, z. B. https://netbird.example.com.",
        )
    data = dict(stored(db))
    if body.token == "":
        data["token_encrypted"] = None
    elif body.token:
        try:
            data["token_encrypted"] = encrypt_secret(settings, body.token.strip())
        except SecretKeyMissingError as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Auf dem Server fehlt die Schlüsseldatei (settings_key). Ohne sie kann kein "
                "Token gespeichert werden.",
            ) from error
    before = load_settings(db)
    data["url"] = url
    data["ping"] = body.ping
    data["signal"] = body.signal.strip()
    data["relay"] = body.relay.strip()
    set_setting(db, NETBIRD_KEY, data, user.user_id)
    _audit(
        db,
        request,
        user,
        "geaendert",
        {
            "adresse_geaendert": url != before.url,
            "token_geaendert": body.token is not None,
            "ping": body.ping,
            "signal": body.signal.strip(),
            "relay": body.relay.strip(),
        },
    )
    db.commit()
    return _out(db, settings)


class TestOut(BaseModel):
    peers: int
    groups: int
    policies: int | None


@router.post("/test")
def test_connection(
    request: Request, user: AdminUser, db: DbDep, settings: SettingsDep, transport: TransportDep
) -> TestOut:
    """Verbindung mit den gespeicherten Angaben prüfen (nur lesend)."""
    config = client_config(db, settings)
    if config is None:
        raise HTTPException(status_code=409, detail="Bitte erst Adresse und API-Token speichern.")
    client = NetBirdClient(config, transport)
    try:
        peers = len(client.list("peers"))
        groups = len(client.list("groups"))
        try:
            policies: int | None = len(client.list("policies"))
        except NetBirdError:
            policies = None
    except NetBirdError as error:
        _audit(db, request, user, "geprueft", note=str(error)[:300], ok=False)
        db.commit()
        raise HTTPException(status_code=502, detail=str(error)) from error
    _audit(db, request, user, "geprueft", {"peers": peers, "gruppen": groups})
    db.commit()
    return TestOut(peers=peers, groups=groups, policies=policies)
