"""Verwaltung, FortiGate: Geräte, CA-Zertifikat, FortiAnalyzer, Abruf und Aufbewahrung.

Nur für System-Admins mit frischer Anmeldung. Tokens und der API-Schlüssel des FortiAnalyzers
liegen verschlüsselt in der Datenbank und werden nie wieder ausgegeben.
"""

from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from werkbank.core.admin_settings import AdminUser, client_ip
from werkbank.core.app_settings import (
    FORTIGATE_KEY,
    SecretKeyMissingError,
    encrypt_secret,
    secret_key_available,
    set_setting,
)
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep
from werkbank.modules.monitoring.fortigate.client import (
    FortiGateClient,
    FortiGateError,
    Transport,
    http_transport,
    valid_url,
)
from werkbank.modules.monitoring.fortigate.collector import last_run, retention_preview
from werkbank.modules.monitoring.fortigate.config import (
    ADOM_DEFAULT,
    INTERVALS,
    RETENTION_MAX,
    RETENTION_MIN,
    device_config,
    load_options,
    load_settings,
    stored,
)
from werkbank.modules.monitoring.fortigate.findings import RULES, UNUSED_DAYS
from werkbank.modules.monitoring.fortigate.models import FgDevice

router = APIRouter(prefix="/api/admin/settings/fortigate")
MODULE = "verwaltung"
PEM_MAX = 20_000
NAME_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$"


def get_fortigate_transport() -> Transport:
    """In Tests ersetzbar."""
    return http_transport


TransportDep = Annotated[Transport, Depends(get_fortigate_transport)]


def _secret(settings: SettingsDep, value: str) -> str:
    try:
        return encrypt_secret(settings, value)
    except SecretKeyMissingError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Auf dem Server fehlt die Schlüsseldatei (settings_key). Ohne sie kann kein "
            "Token gespeichert werden.",
        ) from error


def _audit(
    db: DbDep,
    request: Request,
    user: AdminUser,
    action: str,
    object_id: str,
    details: dict[str, Any] | None = None,
    note: str | None = None,
    ok: bool = True,
) -> None:
    write_audit(
        db,
        module=MODULE,
        action=f"einstellungen.fortigate_{action}",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=object_id,
        ip=client_ip(request),
        details=details,
        note=note,
        result="ok" if ok else "fehler",
    )


# --- Einstellungen -------------------------------------------------------------------------


class DeviceOut(BaseModel):
    id: int
    name: str
    url: str
    enabled: bool
    token_set: bool
    last_run_at: datetime | None
    last_ok: bool | None
    last_error: str | None


class SettingsOut(BaseModel):
    interval_minutes: int
    intervals: list[int]
    retention_months: int
    ca_set: bool
    analyzer_enabled: bool
    analyzer_url: str
    analyzer_adom: str
    analyzer_key_set: bool
    token_storage_available: bool
    devices: list[DeviceOut]


def _out(db: DbDep, settings: SettingsDep) -> SettingsOut:
    options = load_settings(db)
    devices = []
    for device in db.scalars(select(FgDevice).order_by(FgDevice.position, FgDevice.id)):
        run = last_run(db, device.id)
        devices.append(
            DeviceOut(
                id=device.id,
                name=device.name,
                url=device.url,
                enabled=device.enabled,
                token_set=bool(device.token_encrypted),
                last_run_at=run.started_at if run else None,
                last_ok=run.ok if run else None,
                last_error=run.error if run and not run.ok else None,
            )
        )
    return SettingsOut(
        interval_minutes=options.interval_minutes,
        intervals=list(INTERVALS),
        retention_months=options.retention_months,
        ca_set=options.ca_pem is not None,
        analyzer_enabled=options.analyzer.enabled,
        analyzer_url=options.analyzer.url,
        analyzer_adom=options.analyzer.adom,
        analyzer_key_set=options.analyzer.key_set,
        token_storage_available=secret_key_available(settings),
        devices=devices,
    )


@router.get("")
def get_settings(user: AdminUser, db: DbDep, settings: SettingsDep) -> SettingsOut:
    return _out(db, settings)


class SettingsIn(BaseModel):
    interval_minutes: int
    retention_months: int = Field(ge=RETENTION_MIN, le=RETENTION_MAX)
    # None: unverändert, leer: löschen
    ca_pem: str | None = Field(default=None, max_length=PEM_MAX)
    analyzer_enabled: bool = False
    analyzer_url: str = Field(default="", max_length=300)
    analyzer_adom: str = Field(default=ADOM_DEFAULT, max_length=64, pattern=r"^[A-Za-z0-9._-]*$")
    analyzer_key: str | None = Field(default=None, max_length=500)


@router.put("")
def put_settings(
    request: Request, body: SettingsIn, user: AdminUser, db: DbDep, settings: SettingsDep
) -> SettingsOut:
    if body.interval_minutes not in INTERVALS:
        raise HTTPException(status_code=422, detail="Diesen Abrufabstand gibt es nicht.")
    previous = stored(db)
    before = load_settings(db)
    ca_pem = previous.get("ca_pem") or None
    if body.ca_pem == "":
        ca_pem = None
    elif body.ca_pem:
        pem = body.ca_pem.strip()
        if "-----BEGIN CERTIFICATE-----" not in pem or "-----END CERTIFICATE-----" not in pem:
            raise HTTPException(
                status_code=422, detail="Bitte füge ein CA-Zertifikat im PEM-Format ein."
            )
        ca_pem = pem
    raw_faz = previous.get("analyzer")
    faz_prev: dict[str, Any] = raw_faz if isinstance(raw_faz, dict) else {}
    faz_url = body.analyzer_url.strip().rstrip("/")
    if faz_url and not valid_url(faz_url):
        raise HTTPException(
            status_code=422,
            detail="Bitte trag die https-Adresse des FortiAnalyzers ein, z. B. https://faz.example.com.",
        )
    key = faz_prev.get("key_encrypted") or None
    if body.analyzer_key == "":
        key = None
    elif body.analyzer_key:
        key = _secret(settings, body.analyzer_key.strip())
    if body.analyzer_enabled and (not faz_url or not key):
        raise HTTPException(
            status_code=422,
            detail="Zum Einschalten des FortiAnalyzers fehlen Adresse oder API-Schlüssel.",
        )
    set_setting(
        db,
        FORTIGATE_KEY,
        {
            "interval_minutes": body.interval_minutes,
            "retention_months": body.retention_months,
            "ca_pem": ca_pem,
            "analyzer": {
                "enabled": body.analyzer_enabled,
                "url": faz_url,
                "adom": body.analyzer_adom.strip() or ADOM_DEFAULT,
                "key_encrypted": key,
            },
            # Prüfregeln haben eigene Speicherung (PUT …/rules) und bleiben erhalten
            "rules": previous.get("rules") or {},
        },
        user.user_id,
    )
    details: dict[str, Any] = {
        "abrufabstand_minuten": body.interval_minutes,
        "zertifikat_geaendert": body.ca_pem is not None,
        "fortianalyzer_eingeschaltet": body.analyzer_enabled,
        "fortianalyzer_schluessel_geaendert": body.analyzer_key is not None,
    }
    if body.retention_months != before.retention_months:
        details["aufbewahrung_monate_vorher"] = before.retention_months
        details["aufbewahrung_monate"] = body.retention_months
    _audit(db, request, user, "geaendert", FORTIGATE_KEY, details)
    db.commit()
    return _out(db, settings)


class PreviewOut(BaseModel):
    runs: int
    snapshots: int


@router.get("/retention-preview")
def get_retention_preview(
    user: AdminUser,
    db: DbDep,
    months: Annotated[int, Query(ge=RETENTION_MIN, le=RETENTION_MAX)],
) -> PreviewOut:
    """Wie viele Abrufe und Konfigurationsstände bei dieser Aufbewahrung wegfallen würden."""
    return PreviewOut(**retention_preview(db, months))


# --- Geräte --------------------------------------------------------------------------------


class DeviceIn(BaseModel):
    name: str = Field(min_length=1, max_length=80, pattern=NAME_PATTERN)
    url: str = Field(min_length=1, max_length=300)
    enabled: bool = True
    # Neu anlegen: Pflicht. Bearbeiten: None lässt das Token, wie es ist.
    token: str | None = Field(default=None, max_length=500)


def _check_device(db: DbDep, body: DeviceIn, own_id: int | None) -> str:
    url = body.url.strip().rstrip("/")
    if not valid_url(url):
        raise HTTPException(
            status_code=422,
            detail="Bitte trag die https-Adresse der Verwaltung ein, z. B. https://fw-edge.example.com.",
        )
    clash = db.scalar(select(FgDevice.id).where(func.lower(FgDevice.name) == body.name.lower()))
    if clash is not None and clash != own_id:
        raise HTTPException(status_code=409, detail="Ein Gerät mit diesem Namen gibt es schon.")
    return url


@router.post("/devices", status_code=status.HTTP_201_CREATED)
def create_device(
    request: Request, body: DeviceIn, user: AdminUser, db: DbDep, settings: SettingsDep
) -> SettingsOut:
    url = _check_device(db, body, None)
    if not body.token or not body.token.strip():
        raise HTTPException(status_code=422, detail="Das API-Token fehlt.")
    position = int(db.scalar(select(func.coalesce(func.max(FgDevice.position), -1))) or 0) + 1
    device = FgDevice(
        name=body.name,
        url=url,
        enabled=body.enabled,
        token_encrypted=_secret(settings, body.token.strip()),
        position=position,
        runtime={},
    )
    db.add(device)
    db.flush()
    _audit(db, request, user, "geraet_angelegt", str(device.id), {"name": body.name})
    db.commit()
    return _out(db, settings)


def _device(db: DbDep, device_id: int) -> FgDevice:
    device = db.get(FgDevice, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail="Gerät nicht gefunden.")
    return device


@router.put("/devices/{device_id}")
def update_device(
    request: Request,
    device_id: int,
    body: DeviceIn,
    user: AdminUser,
    db: DbDep,
    settings: SettingsDep,
) -> SettingsOut:
    device = _device(db, device_id)
    url = _check_device(db, body, device.id)
    device.name = body.name
    device.url = url
    device.enabled = body.enabled
    if body.token is not None and body.token.strip():
        device.token_encrypted = _secret(settings, body.token.strip())
    _audit(
        db,
        request,
        user,
        "geraet_geaendert",
        str(device.id),
        {"name": body.name, "eingeschaltet": body.enabled, "token_geaendert": bool(body.token)},
    )
    db.commit()
    return _out(db, settings)


@router.delete("/devices/{device_id}")
def delete_device(
    request: Request, device_id: int, user: AdminUser, db: DbDep, settings: SettingsDep
) -> SettingsOut:
    """Entfernt das Gerät mit allen gespeicherten Ständen und Abrufen."""
    device = _device(db, device_id)
    _audit(db, request, user, "geraet_entfernt", str(device.id), {"name": device.name})
    db.delete(device)
    db.commit()
    return _out(db, settings)


class TestOut(BaseModel):
    hostname: str
    model: str
    version: str
    policies: int


@router.post("/devices/{device_id}/test")
def test_device(
    request: Request,
    device_id: int,
    user: AdminUser,
    db: DbDep,
    settings: SettingsDep,
    transport: TransportDep,
) -> TestOut:
    """Prüft den Zugang: Status des Geräts und ob die Policies lesbar sind."""
    device = _device(db, device_id)
    config = device_config(device, settings, load_settings(db).ca_pem)
    failure: str | None = None
    result: TestOut | None = None
    if config is None:
        failure = "Das API-Token lässt sich nicht entschlüsseln. Bitte neu eintragen."
    else:
        client = FortiGateClient(config, transport)
        try:
            status_answer = client.monitor("system/status")
            info = status_answer.results if isinstance(status_answer.results, dict) else {}
            result = TestOut(
                hostname=str(info.get("hostname") or ""),
                model=str(info.get("model_name") or ""),
                version=status_answer.version,
                policies=len(client.cmdb("firewall/policy")),
            )
        except FortiGateError as error:
            failure = str(error)
    _audit(db, request, user, "test", str(device.id), note=failure, ok=failure is None)
    db.commit()
    if failure is not None or result is None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=failure)
    return result


# --- Prüfregeln der Befunde ----------------------------------------------------------------

ZONE_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,34}$"


class RuleOut(BaseModel):
    code: str
    severity: str
    title: str
    description: str
    active: bool


class RulesOut(BaseModel):
    rules: list[RuleOut]
    sensitive: list[str]
    unused_days: int
    unused_days_options: list[int]


class RulesIn(BaseModel):
    disabled: list[Annotated[str, Field(max_length=40)]] = Field(default=[], max_length=20)
    sensitive: list[Annotated[str, Field(pattern=ZONE_PATTERN)]] = Field(default=[], max_length=50)
    unused_days: int


def _rules_out(db: DbDep) -> RulesOut:
    options = load_options(db)
    return RulesOut(
        rules=[
            RuleOut(
                code=rule.code,
                severity=rule.severity,
                title=rule.title,
                description=rule.description,
                active=options.active(rule.code),
            )
            for rule in RULES
        ],
        sensitive=sorted(options.sensitive),
        unused_days=options.unused_days,
        unused_days_options=list(UNUSED_DAYS),
    )


@router.get("/rules")
def get_rules(user: AdminUser, db: DbDep) -> RulesOut:
    return _rules_out(db)


@router.put("/rules")
def put_rules(request: Request, body: RulesIn, user: AdminUser, db: DbDep) -> RulesOut:
    """Regeln ein- und ausschalten, schützenswerte Zonen und Zeitraum für „ungenutzt“."""
    codes = {rule.code for rule in RULES}
    unknown = [code for code in body.disabled if code not in codes]
    if unknown:
        raise HTTPException(status_code=422, detail="Diese Regel gibt es nicht.")
    if body.unused_days not in UNUSED_DAYS:
        raise HTTPException(status_code=422, detail="Diesen Zeitraum gibt es nicht.")
    before = load_options(db)
    data = dict(stored(db))
    sensitive = sorted({name.strip() for name in body.sensitive if name.strip()})
    disabled = sorted(set(body.disabled))
    data["rules"] = {"disabled": disabled, "sensitive": sensitive, "unused_days": body.unused_days}
    set_setting(db, FORTIGATE_KEY, data, user.user_id)
    _audit(
        db,
        request,
        user,
        "regeln_geaendert",
        FORTIGATE_KEY,
        {
            "abgeschaltet_vorher": sorted(before.disabled),
            "abgeschaltet": disabled,
            "zonen_vorher": sorted(before.sensitive),
            "zonen": sensitive,
            "tage_vorher": before.unused_days,
            "tage": body.unused_days,
        },
    )
    db.commit()
    return _rules_out(db)
