"""Verwaltung, Verbindungen, Zabbix: Anbindung (nur Admins, frische Anmeldung)."""

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from werkbank.core.admin_settings import AdminUser, client_ip
from werkbank.core.app_settings import (
    ZABBIX_KEY,
    SecretKeyMissingError,
    encrypt_secret,
    secret_key_available,
    set_setting,
)
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep
from werkbank.modules.monitoring.zabbix.client import (
    Transport,
    ZabbixClient,
    ZabbixError,
    http_transport,
    role_findings,
    valid_zabbix_url,
)
from werkbank.modules.monitoring.zabbix.config import load_config, stored_connection

router = APIRouter(prefix="/api/admin/settings/zabbix")
MODULE = "verwaltung"
PEM_MAX = 20_000


def get_zabbix_transport() -> Transport:
    """In Tests ersetzbar."""
    return http_transport


TransportDep = Annotated[Transport, Depends(get_zabbix_transport)]


class ZabbixSettingsOut(BaseModel):
    enabled: bool
    url: str
    link_url: str
    token_set: bool
    token_storage_available: bool
    ca_set: bool


class ZabbixSettingsIn(BaseModel):
    enabled: bool
    url: str = Field(default="", max_length=300)
    # Adresse für „In Zabbix öffnen“, wenn Menschen Zabbix unter einer anderen Adresse
    # erreichen als die Werkbank. Leer: dieselbe wie url.
    link_url: str = Field(default="", max_length=300)
    # None: unverändert. Leerer Text: löschen.
    token: str | None = Field(default=None, max_length=500)
    ca_pem: str | None = Field(default=None, max_length=PEM_MAX)


def _out(db: DbDep, key_available: bool) -> ZabbixSettingsOut:
    data = stored_connection(db)
    return ZabbixSettingsOut(
        enabled=data.get("enabled") is True,
        url=str(data.get("url") or ""),
        link_url=str(data.get("link_url") or ""),
        token_set=bool(data.get("token_encrypted")),
        token_storage_available=key_available,
        ca_set=bool(data.get("ca_pem")),
    )


@router.get("")
def get_zabbix(user: AdminUser, db: DbDep, settings: SettingsDep) -> ZabbixSettingsOut:
    """Anbindung an Zabbix. Das Token wird nie ausgegeben."""
    return _out(db, secret_key_available(settings))


@router.put("")
def put_zabbix(
    request: Request, body: ZabbixSettingsIn, user: AdminUser, db: DbDep, settings: SettingsDep
) -> ZabbixSettingsOut:
    """Speichert die Anbindung. Das Token liegt verschlüsselt in der Datenbank."""
    previous = stored_connection(db)
    url = body.url.strip().rstrip("/")
    if url.endswith("/api_jsonrpc.php"):
        url = url.removesuffix("/api_jsonrpc.php")
    if url and not valid_zabbix_url(url):
        raise HTTPException(
            status_code=422,
            detail="Bitte die https-Adresse von Zabbix eintragen, z. B. https://zabbix.example.com.",
        )
    link_url = body.link_url.strip().rstrip("/")
    if link_url and not valid_zabbix_url(link_url):
        raise HTTPException(
            status_code=422,
            detail="Bitte für die Links die https-Adresse der Zabbix-Oberfläche eintragen.",
        )
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
        ZABBIX_KEY,
        {
            "enabled": body.enabled,
            "url": url,
            "link_url": link_url or None,
            "token_encrypted": token,
            "ca_pem": ca_pem,
        },
        user.user_id,
    )
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.zabbix_geaendert",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=ZABBIX_KEY,
        ip=client_ip(request),
        details={
            "eingeschaltet": body.enabled,
            "eigene_link_adresse": bool(link_url),
            "token_geaendert": body.token is not None,
            "zertifikat_geaendert": body.ca_pem is not None,
        },
    )
    db.commit()
    return _out(db, secret_key_available(settings))


class ZabbixTestOut(BaseModel):
    version: str
    supported: bool
    role: str | None
    methods: list[str]
    findings: list[str]
    token_expires_at: datetime | None
    token_never_expires: bool
    hosts: int


@router.post("/test")
def test_zabbix(
    request: Request,
    user: AdminUser,
    db: DbDep,
    settings: SettingsDep,
    transport: TransportDep,
) -> ZabbixTestOut:
    """Prüft die gespeicherte Anbindung: Version, Dienstkonto, Rechte, Ablauf des Tokens."""
    config = load_config(db, settings, require_enabled=False)
    failure: str | None = None
    result: ZabbixTestOut | None = None
    if config is None:
        failure = "Bitte zuerst Adresse und Token speichern."
    else:
        client = ZabbixClient(config, transport)
        try:
            version = client.version()
            hosts = len(client.hosts(details=False))
            role_name: str | None = None
            methods: list[str] = []
            findings: list[str] = []
            expires: int | None = None
            try:
                userid, roleid = client.own_user()
                check = client.role(roleid)
                role_name, methods, findings = check.role, check.methods, role_findings(check)
                expires = client.token_expiry(userid)
            except ZabbixError as error:
                findings.append(f"Rolle oder Token ließen sich nicht prüfen: {error}")
            result = ZabbixTestOut(
                version=version.text,
                supported=version.supported,
                role=role_name,
                methods=methods,
                findings=findings,
                token_expires_at=datetime.fromtimestamp(expires, UTC) if expires else None,
                token_never_expires=expires == 0,
                hosts=hosts,
            )
        except ZabbixError as error:
            failure = str(error)
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.zabbix_test",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=ZABBIX_KEY,
        result="ok" if failure is None else "fehler",
        ip=client_ip(request),
        note=failure,
    )
    db.commit()
    if failure is not None or result is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=failure)
    return result
