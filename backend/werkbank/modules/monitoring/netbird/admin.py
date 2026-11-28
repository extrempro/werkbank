"""Verwaltung, NetBird: Management-URL, API-Token (verschlüsselt, nie ausgegeben), Ping-Schalter,
Verbindungstest; CrowdSec (Local API mit Bouncer-Schlüssel, Dienste bewusst ohne CrowdSec).
Nur für System-Admins mit frischer Anmeldung."""

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
from werkbank.modules.monitoring.netbird.config import (
    client_config,
    lapi_config,
    load_settings,
    stored,
)
from werkbank.modules.monitoring.netbird.crowdsec import (
    CrowdSecError,
    LapiTransport,
    http_lapi,
    read_lapi,
    valid_lapi_url,
)

router = APIRouter(prefix="/api/admin/settings/netbird")
TARGET_PATTERN = r"^$|^[A-Za-z0-9]([A-Za-z0-9.-]{0,252}):(\d{1,5})$"
MODULE = "verwaltung"


def get_netbird_transport() -> Transport:
    """Abhängigkeit, damit Tests NetBird ersetzen können."""
    return http_transport


TransportDep = Annotated[Transport, Depends(get_netbird_transport)]


def get_lapi_transport() -> LapiTransport:
    """Abhängigkeit, damit Tests die Local API von CrowdSec ersetzen können."""
    return http_lapi


LapiDep = Annotated[LapiTransport, Depends(get_lapi_transport)]


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
    server_groups: str
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
        server_groups=", ".join(options.server_groups),
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
    # Gruppennamen mit Servern, mit Komma getrennt
    server_groups: str = Field(default="", max_length=2000)


GROUP_NAME_MAX = 255
GROUPS_MAX = 50


def parse_groups(value: str) -> list[str]:
    """„a, b, A“ → ["a", "b"]: ohne Leere und doppelte (Groß-/Kleinschreibung egal)."""
    out: list[str] = []
    for part in value.split(","):
        name = part.strip()
        if name and name.casefold() not in {n.casefold() for n in out}:
            out.append(name)
    if len(out) > GROUPS_MAX or any(len(n) > GROUP_NAME_MAX for n in out):
        raise HTTPException(
            status_code=422,
            detail=f"Höchstens {GROUPS_MAX} Server-Gruppen mit je bis zu {GROUP_NAME_MAX} Zeichen.",
        )
    return out


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
    groups = parse_groups(body.server_groups)
    before = load_settings(db)
    data["url"] = url
    data["server_groups"] = groups
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
            "server_gruppen": len(groups),
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


# --- CrowdSec ---------------------------------------------------------------------------------


class CrowdSecOut(BaseModel):
    url: str
    key_set: bool
    exempt: str
    token_storage_available: bool


def _crowdsec_out(db: DbDep, settings: SettingsDep) -> CrowdSecOut:
    options = load_settings(db)
    return CrowdSecOut(
        url=options.crowdsec_url,
        key_set=options.crowdsec_key_set,
        exempt=", ".join(options.crowdsec_exempt),
        token_storage_available=secret_key_available(settings),
    )


@router.get("/crowdsec")
def get_crowdsec(user: AdminUser, db: DbDep, settings: SettingsDep) -> CrowdSecOut:
    return _crowdsec_out(db, settings)


class CrowdSecIn(BaseModel):
    url: str = Field(default="", max_length=300)
    # None: unverändert, leer: löschen
    key: str | None = Field(default=None, max_length=500)
    # Domains der Dienste, mit Komma getrennt
    exempt: str = Field(default="", max_length=4000)


DOMAIN_MAX = 253


def parse_domains(value: str) -> list[str]:
    out: list[str] = []
    for part in value.split(","):
        name = part.strip().lower().rstrip(".")
        if name and name not in out:
            out.append(name)
    if len(out) > GROUPS_MAX * 2 or any(
        len(n) > DOMAIN_MAX or not all(c.isalnum() or c in ".-*" for c in n) for n in out
    ):
        raise HTTPException(
            status_code=422,
            detail="Bitte nur Domains der Dienste eintragen, mehrere mit Komma "
            f"(höchstens {GROUPS_MAX * 2}).",
        )
    return out


@router.put("/crowdsec")
def put_crowdsec(
    request: Request, body: CrowdSecIn, user: AdminUser, db: DbDep, settings: SettingsDep
) -> CrowdSecOut:
    url = body.url.strip().rstrip("/")
    if url and not valid_lapi_url(url):
        raise HTTPException(
            status_code=422,
            detail="Bitte trag die Adresse der Local API ohne Pfad ein, z. B. "
            "http://crowdsec.example.com:8080.",
        )
    exempt = parse_domains(body.exempt)
    data = dict(stored(db))
    if body.key == "":
        data["crowdsec_key_encrypted"] = None
    elif body.key:
        try:
            data["crowdsec_key_encrypted"] = encrypt_secret(settings, body.key.strip())
        except SecretKeyMissingError as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Auf dem Server fehlt die Schlüsseldatei (settings_key). Ohne sie kann kein "
                "Schlüssel gespeichert werden.",
            ) from error
    before = load_settings(db)
    data["crowdsec_url"] = url
    data["crowdsec_exempt"] = exempt
    set_setting(db, NETBIRD_KEY, data, user.user_id)
    _audit(
        db,
        request,
        user,
        "crowdsec_geaendert",
        {
            "adresse_geaendert": url != before.crowdsec_url,
            "schluessel_geaendert": body.key is not None,
            "ohne_crowdsec": len(exempt),
        },
    )
    db.commit()
    return _crowdsec_out(db, settings)


class CrowdSecTestOut(BaseModel):
    total: int
    own: int


@router.post("/crowdsec/test")
def test_crowdsec(
    request: Request, user: AdminUser, db: DbDep, settings: SettingsDep, transport: LapiDep
) -> CrowdSecTestOut:
    """Local API mit den gespeicherten Angaben lesen (nur aktive Sperren zählen)."""
    config = lapi_config(db, settings)
    if config is None:
        raise HTTPException(
            status_code=409, detail="Bitte erst Adresse und Bouncer-Schlüssel speichern."
        )
    try:
        result = read_lapi(config, transport)
    except CrowdSecError as error:
        _audit(db, request, user, "crowdsec_geprueft", note=str(error)[:300], ok=False)
        db.commit()
        raise HTTPException(status_code=502, detail=str(error)) from error
    _audit(db, request, user, "crowdsec_geprueft", result)
    db.commit()
    return CrowdSecTestOut(**result)
