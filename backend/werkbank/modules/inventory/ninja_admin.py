"""Verwaltung: Anbindung an NinjaOne für den IT-Bestand (nur Admins, frische Anmeldung)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from werkbank.core.admin_settings import AdminUser, client_ip
from werkbank.core.app_settings import (
    NINJA_KEY,
    SecretKeyMissingError,
    encrypt_secret,
    get_setting,
    secret_key_available,
    set_setting,
)
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep
from werkbank.modules.inventory.ninja import REGIONS, Fetcher, NinjaError, fetch_devices
from werkbank.modules.inventory.sync import load_ninja_config

router = APIRouter(prefix="/api/admin/settings/ninjaone")
MODULE = "verwaltung"


def get_ninja_fetcher() -> Fetcher:
    """In Tests ersetzbar."""
    return fetch_devices


FetcherDep = Annotated[Fetcher, Depends(get_ninja_fetcher)]


class RegionOut(BaseModel):
    id: str
    name: str
    host: str


class NinjaOut(BaseModel):
    enabled: bool
    region: str
    client_id: str
    secret_set: bool
    secret_storage_available: bool
    regions: list[RegionOut]


class NinjaIn(BaseModel):
    enabled: bool
    region: str = Field(default="eu", max_length=10)
    client_id: str = Field(default="", max_length=200)
    # None: Secret unverändert. Leerer Text: Secret löschen.
    client_secret: str | None = Field(default=None, max_length=500)

    @field_validator("client_id")
    @classmethod
    def plain_id(cls, value: str) -> str:
        value = value.strip()
        if any(ord(char) < 33 or ord(char) == 127 for char in value):
            raise ValueError("Ohne Leerzeichen und Steuerzeichen")
        return value

    @field_validator("client_secret")
    @classmethod
    def plain_secret(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if any(ord(char) < 33 or ord(char) == 127 for char in value):
            raise ValueError("Ohne Leerzeichen und Steuerzeichen")
        return value


class NinjaTestOut(BaseModel):
    devices: int
    notebooks: int
    pcs: int


def _stored(db: Session) -> dict[str, Any]:
    value = get_setting(db, NINJA_KEY)
    return value if isinstance(value, dict) else {}


def _out(db: Session, key_available: bool) -> NinjaOut:
    data = _stored(db)
    region = data.get("region")
    return NinjaOut(
        enabled=data.get("enabled") is True,
        region=region if region in REGIONS else "eu",
        client_id=str(data.get("client_id") or ""),
        secret_set=bool(data.get("secret_encrypted")),
        secret_storage_available=key_available,
        regions=[RegionOut(id=key, name=name, host=host) for key, (name, host) in REGIONS.items()],
    )


@router.get("")
def get_ninja(user: AdminUser, db: DbDep, settings: SettingsDep) -> NinjaOut:
    """Anbindung an NinjaOne. Das Secret wird nie ausgegeben."""
    return _out(db, secret_key_available(settings))


@router.put("")
def put_ninja(
    request: Request, body: NinjaIn, user: AdminUser, db: DbDep, settings: SettingsDep
) -> NinjaOut:
    """Speichert die Anbindung. Das Secret liegt verschlüsselt in der Datenbank."""
    if body.region not in REGIONS:
        raise HTTPException(status_code=422, detail="Unbekannte Region.")
    previous = _stored(db)
    token = previous.get("secret_encrypted") or None
    if body.client_secret == "":
        token = None
    elif body.client_secret:
        try:
            token = encrypt_secret(settings, body.client_secret)
        except SecretKeyMissingError as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Auf dem Server fehlt die Schlüsseldatei (settings_key). "
                "Ohne sie kann kein Secret gespeichert werden.",
            ) from error
    if body.enabled and (not body.client_id or not token):
        raise HTTPException(
            status_code=422, detail="Zum Einschalten fehlen Client-ID oder Client-Secret."
        )
    set_setting(
        db,
        NINJA_KEY,
        {
            "enabled": body.enabled,
            "region": body.region,
            "client_id": body.client_id,
            "secret_encrypted": token,
        },
        user.user_id,
    )
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.ninjaone_geaendert",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=NINJA_KEY,
        ip=client_ip(request),
        details={
            "eingeschaltet": body.enabled,
            "region": body.region,
            "secret_geaendert": body.client_secret is not None,
        },
    )
    db.commit()
    return _out(db, secret_key_available(settings))


@router.post("/test")
def test_ninja(
    request: Request, user: AdminUser, db: DbDep, settings: SettingsDep, fetch: FetcherDep
) -> NinjaTestOut:
    """Meldet sich mit der gespeicherten Anbindung an und zählt die Arbeitsplatzrechner."""
    config = load_ninja_config(db, settings, require_enabled=False)
    failure: str | None = None
    result: NinjaTestOut | None = None
    if config is None:
        failure = "Bitte zuerst Region, Client-ID und Client-Secret speichern."
    else:
        try:
            devices = fetch(config)
            notebooks = sum(1 for device in devices if device.kind == "Notebook")
            result = NinjaTestOut(
                devices=len(devices), notebooks=notebooks, pcs=len(devices) - notebooks
            )
        except NinjaError as error:
            failure = str(error)
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.ninjaone_test",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=NINJA_KEY,
        result="ok" if failure is None else "fehler",
        ip=client_ip(request),
        note=failure,
    )
    db.commit()
    if failure is not None or result is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=failure)
    return result
