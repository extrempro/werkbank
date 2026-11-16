"""Verwaltung: Anbindung an NetBox für den DNS-Abgleich (nur Admins, frische Anmeldung)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from werkbank.core.admin_settings import AdminUser, client_ip
from werkbank.core.app_settings import (
    NETBOX_KEY,
    SecretKeyMissingError,
    encrypt_secret,
    get_setting,
    secret_key_available,
    set_setting,
)
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep
from werkbank.modules.monitoring.dns_check import DEFAULT_RESOLVER, load_config
from werkbank.modules.monitoring.netbox import (
    Getter,
    NetboxError,
    http_get,
    load_views,
    load_zones,
    netbox_status,
    valid_netbox_url,
)
from werkbank.modules.tools.net import RESOLVERS

router = APIRouter(prefix="/api/admin/settings/netbox")
MODULE = "verwaltung"
PEM_MAX = 20_000


def get_netbox_getter() -> Getter:
    """In Tests ersetzbar."""
    return http_get


GetterDep = Annotated[Getter, Depends(get_netbox_getter)]


class ResolverOut(BaseModel):
    id: str
    name: str


class NetboxOut(BaseModel):
    enabled: bool
    url: str
    token_set: bool
    token_storage_available: bool
    # None: alle Views
    view_id: int | None
    resolver: str
    compare_ttl: bool
    ca_set: bool
    resolvers: list[ResolverOut]


class NetboxIn(BaseModel):
    enabled: bool
    url: str = Field(default="", max_length=300)
    # None: Token unverändert. Leerer Text: Token löschen.
    token: str | None = Field(default=None, max_length=500)
    view_id: int | None = Field(default=None, ge=1)
    resolver: str = Field(default=DEFAULT_RESOLVER, max_length=20)
    compare_ttl: bool = True
    # None: unverändert. Leerer Text: löschen.
    ca_pem: str | None = Field(default=None, max_length=PEM_MAX)


def _stored(db: Session) -> dict[str, Any]:
    value = get_setting(db, NETBOX_KEY)
    return value if isinstance(value, dict) else {}


def _out(db: Session, key_available: bool) -> NetboxOut:
    data = _stored(db)
    view_id = data.get("view_id")
    resolver = data.get("resolver")
    return NetboxOut(
        enabled=data.get("enabled") is True,
        url=str(data.get("url") or ""),
        token_set=bool(data.get("token_encrypted")),
        token_storage_available=key_available,
        view_id=view_id if isinstance(view_id, int) else None,
        resolver=resolver if resolver in RESOLVERS else DEFAULT_RESOLVER,
        compare_ttl=data.get("compare_ttl") is not False,
        ca_set=bool(data.get("ca_pem")),
        resolvers=[ResolverOut(id=key, name=value[0]) for key, value in RESOLVERS.items()],
    )


@router.get("")
def get_netbox(user: AdminUser, db: DbDep, settings: SettingsDep) -> NetboxOut:
    """Anbindung an NetBox. Der Token wird nie ausgegeben."""
    return _out(db, secret_key_available(settings))


@router.put("")
def put_netbox(
    request: Request, body: NetboxIn, user: AdminUser, db: DbDep, settings: SettingsDep
) -> NetboxOut:
    """Speichert die Anbindung. Der Token liegt verschlüsselt in der Datenbank."""
    previous = _stored(db)
    url = body.url.strip().rstrip("/")
    if url and not valid_netbox_url(url):
        raise HTTPException(
            status_code=422,
            detail="Bitte die https-Adresse von NetBox eintragen, z. B. https://netbox.example.com.",
        )
    if body.resolver not in RESOLVERS:
        raise HTTPException(status_code=422, detail="Unbekannter Resolver.")
    token = previous.get("token_encrypted") or None
    if body.token == "":
        token = None
    elif body.token:
        try:
            token = encrypt_secret(settings, body.token.strip())
        except SecretKeyMissingError as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Auf dem Server fehlt die Schlüsseldatei (settings_key). "
                "Ohne sie kann kein Token gespeichert werden.",
            ) from error
    ca_pem = previous.get("ca_pem") or None
    if body.ca_pem == "":
        ca_pem = None
    elif body.ca_pem:
        pem = body.ca_pem.strip()
        if "-----BEGIN CERTIFICATE-----" not in pem or "-----END CERTIFICATE-----" not in pem:
            raise HTTPException(
                status_code=422, detail="Bitte ein CA-Zertifikat im PEM-Format einfügen."
            )
        ca_pem = pem
    if body.enabled and (not url or not token):
        raise HTTPException(status_code=422, detail="Zum Einschalten fehlen Adresse oder Token.")
    set_setting(
        db,
        NETBOX_KEY,
        {
            "enabled": body.enabled,
            "url": url,
            "token_encrypted": token,
            "view_id": body.view_id,
            "resolver": body.resolver,
            "compare_ttl": body.compare_ttl,
            "ca_pem": ca_pem,
        },
        user.user_id,
    )
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.netbox_geaendert",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=NETBOX_KEY,
        ip=client_ip(request),
        details={
            "eingeschaltet": body.enabled,
            "token_geaendert": body.token is not None,
            "zertifikat_geaendert": body.ca_pem is not None,
        },
    )
    db.commit()
    return _out(db, secret_key_available(settings))


class ViewOut(BaseModel):
    id: int
    name: str


class NetboxTestOut(BaseModel):
    version: str
    dns_plugin: str | None
    views: list[ViewOut]
    zones: int


@router.post("/test")
def test_netbox(
    request: Request, user: AdminUser, db: DbDep, settings: SettingsDep, get: GetterDep
) -> NetboxTestOut:
    """Prüft die gespeicherte Anbindung: Version, Plugin, Views und Zahl der Zonen."""
    config = load_config(db, settings, require_enabled=False)
    failure: str | None = None
    result: NetboxTestOut | None = None
    if config is None:
        failure = "Bitte zuerst Adresse und Token speichern."
    else:
        try:
            version, plugin = netbox_status(get, config.netbox)
            if plugin is None:
                raise NetboxError("In NetBox ist das Plugin netbox-dns nicht installiert.")
            views = [
                ViewOut(id=int(view["id"]), name=str(view.get("name", "")))
                for view in load_views(get, config.netbox)
                if isinstance(view.get("id"), int)
            ]
            zones = load_zones(get, config.netbox, config.view_id)
            result = NetboxTestOut(
                version=version, dns_plugin=plugin, views=views, zones=len(zones)
            )
        except NetboxError as error:
            failure = str(error)
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.netbox_test",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=NETBOX_KEY,
        result="ok" if failure is None else "fehler",
        ip=client_ip(request),
        note=failure,
    )
    db.commit()
    if failure is not None or result is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=failure)
    return result
