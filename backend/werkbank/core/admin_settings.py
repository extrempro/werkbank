"""Verwaltung, Bereich Allgemein: Einstellungen der Werkbank (nur Admin, mit Step-up)."""

import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator

from werkbank.core.ai import (
    AI_KEY,
    AI_RATE_MAX,
    AI_RATE_MIN,
    AiCompleterDep,
    AiError,
    ai_rate,
    load_ai_config,
    stored_ai,
)
from werkbank.core.app_settings import (
    AUDIT_RETENTION_KEY,
    AUDIT_RETENTION_MAX,
    AUDIT_RETENTION_MIN,
    SMTP_KEY,
    TEAMS_KEY,
    TOOLS_INTERNET_KEY,
    WARN_DAYS_KEY,
    WARN_DAYS_MAX,
    WARN_DAYS_MIN,
    SecretKeyMissingError,
    audit_retention_days,
    encrypt_secret,
    get_setting,
    secret_key_available,
    set_setting,
    tools_internet_enabled,
    valid_warn_days,
    warn_days,
)
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep, require_recent_login
from werkbank.core.mail import MailError, MailSenderDep, load_smtp_config
from werkbank.core.notify_channels import (
    TeamsError,
    TeamsSenderDep,
    load_brand,
    load_teams_url,
    sample_digest,
    teams_payload,
    valid_workflow_url,
)
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser

router = APIRouter(prefix="/api/admin/settings")


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


AdminUser = Annotated[CurrentUser, Depends(require_recent_login(Role.WERKBANK_ADMIN))]

MODULE = "kern"
HOST_PATTERN = re.compile(r"^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$")
AI_URL_PATTERN = re.compile(
    r"^https?://[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$"
)
AI_MODEL_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$")
ADDRESS_PATTERN = re.compile(r"^[^@\s<>,;\"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$")


class SmtpOut(BaseModel):
    host: str
    port: int
    security: str
    username: str
    sender_address: str
    sender_name: str
    password_set: bool
    # Ohne Schlüsseldatei auf dem Server lässt sich kein Passwort speichern.
    password_storage_available: bool


class AiOut(BaseModel):
    enabled: bool
    base_url: str
    model: str
    texts_per_hour: int
    texts_per_hour_min: int
    texts_per_hour_max: int
    api_key_set: bool
    # Ohne Schlüsseldatei auf dem Server lässt sich kein Schlüssel speichern.
    key_storage_available: bool


class TeamsOut(BaseModel):
    enabled: bool
    # Eine Adresse ist gespeichert (sie wird nie ausgegeben)
    url_set: bool
    url_storage_available: bool


class TeamsIn(BaseModel):
    enabled: bool
    # None: Adresse unverändert lassen. Leerer Text: Adresse löschen.
    url: str | None = Field(default=None, max_length=2000)


class SettingsOut(BaseModel):
    smtp: SmtpOut
    teams: TeamsOut
    ai: AiOut
    audit_retention_days: int
    audit_retention_min: int
    audit_retention_max: int
    # Vorlauf für ablaufende Zertifikate und Secrets: Hinweis, Warnung, dringend
    credential_warn_days: list[int]
    credential_warn_min: int
    credential_warn_max: int
    # Dürfen die IT-Tools über den Server ins Internet fragen?
    tools_internet: bool


class SmtpIn(BaseModel):
    host: str = Field(min_length=1, max_length=253)
    port: int = Field(ge=1, le=65535)
    security: Literal["starttls", "tls", "none"]
    username: str = Field(default="", max_length=320)
    sender_address: str = Field(min_length=3, max_length=320)
    sender_name: str = Field(default="", max_length=100)
    # None: Passwort unverändert lassen. Leerer Text: Passwort löschen.
    password: str | None = Field(default=None, max_length=500)

    @field_validator("host")
    @classmethod
    def host_is_plain(cls, value: str) -> str:
        value = value.strip()
        if not HOST_PATTERN.match(value):
            raise ValueError("Servername ohne Protokoll und Pfad angeben, z. B. smtp.example.com")
        return value

    @field_validator("sender_address")
    @classmethod
    def address_is_valid(cls, value: str) -> str:
        value = value.strip()
        if not ADDRESS_PATTERN.match(value):
            raise ValueError("Bitte eine gültige E-Mail-Adresse angeben")
        return value

    @field_validator("username", "sender_name")
    @classmethod
    def single_line(cls, value: str) -> str:
        value = value.strip()
        if any(ord(char) < 32 for char in value):
            raise ValueError("Keine Zeilenumbrüche oder Steuerzeichen")
        return value


class AiIn(BaseModel):
    enabled: bool
    base_url: str = Field(default="", max_length=300)
    model: str = Field(default="", max_length=100)
    texts_per_hour: int = Field(ge=AI_RATE_MIN, le=AI_RATE_MAX)
    # None: Schlüssel unverändert lassen. Leerer Text: Schlüssel löschen.
    api_key: str | None = Field(default=None, max_length=500)

    @field_validator("base_url")
    @classmethod
    def url_is_plain(cls, value: str) -> str:
        value = value.strip().rstrip("/")
        if value and not AI_URL_PATTERN.match(value):
            raise ValueError(
                "Adresse mit http:// oder https:// angeben, z. B. https://ki.example.com/v1"
            )
        return value

    @field_validator("model")
    @classmethod
    def model_is_plain(cls, value: str) -> str:
        value = value.strip()
        if value and not AI_MODEL_PATTERN.match(value):
            raise ValueError("Der Modellname enthält unerlaubte Zeichen")
        return value

    @field_validator("api_key")
    @classmethod
    def key_single_line(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if any(ord(char) < 32 for char in value):
            raise ValueError("Keine Zeilenumbrüche oder Steuerzeichen")
        return value


class AuditRetentionIn(BaseModel):
    days: int = Field(ge=AUDIT_RETENTION_MIN, le=AUDIT_RETENTION_MAX)


class CredentialWarnIn(BaseModel):
    # Vorlauf in Tagen: Hinweis, Warnung, dringend (absteigend)
    days: list[int] = Field(min_length=3, max_length=3)


class ToolsInternetIn(BaseModel):
    enabled: bool


class TestResultOut(BaseModel):
    recipient: str


def _smtp_out(stored: Any, key_available: bool) -> SmtpOut:
    data = stored if isinstance(stored, dict) else {}
    return SmtpOut(
        host=str(data.get("host") or ""),
        port=int(data.get("port") or 587),
        security=str(data.get("security") or "starttls"),
        username=str(data.get("username") or ""),
        sender_address=str(data.get("sender_address") or ""),
        sender_name=str(data.get("sender_name") or ""),
        password_set=bool(data.get("password_encrypted")),
        password_storage_available=key_available,
    )


def _ai_out(stored: dict[str, Any], key_available: bool) -> AiOut:
    return AiOut(
        enabled=stored.get("enabled") is True,
        base_url=str(stored.get("base_url") or ""),
        model=str(stored.get("model") or ""),
        texts_per_hour=ai_rate(stored),
        texts_per_hour_min=AI_RATE_MIN,
        texts_per_hour_max=AI_RATE_MAX,
        api_key_set=bool(stored.get("api_key_encrypted")),
        key_storage_available=key_available,
    )


def _teams_out(stored: Any, key_available: bool) -> TeamsOut:
    data = stored if isinstance(stored, dict) else {}
    return TeamsOut(
        enabled=data.get("enabled") is True,
        url_set=bool(data.get("url_encrypted")),
        url_storage_available=key_available,
    )


def _settings_out(db: DbDep, settings: SettingsDep) -> SettingsOut:
    return SettingsOut(
        smtp=_smtp_out(get_setting(db, SMTP_KEY), secret_key_available(settings)),
        teams=_teams_out(get_setting(db, TEAMS_KEY), secret_key_available(settings)),
        ai=_ai_out(stored_ai(db), secret_key_available(settings)),
        audit_retention_days=audit_retention_days(db),
        audit_retention_min=AUDIT_RETENTION_MIN,
        audit_retention_max=AUDIT_RETENTION_MAX,
        credential_warn_days=list(warn_days(db)),
        credential_warn_min=WARN_DAYS_MIN,
        credential_warn_max=WARN_DAYS_MAX,
        tools_internet=tools_internet_enabled(db),
    )


@router.get("")
def read_settings(user: AdminUser, db: DbDep, settings: SettingsDep) -> SettingsOut:
    """Allgemeine Einstellungen. Das SMTP-Passwort wird nie ausgegeben."""
    return _settings_out(db, settings)


@router.put("/smtp")
def update_smtp(
    request: Request, body: SmtpIn, user: AdminUser, db: DbDep, settings: SettingsDep
) -> SettingsOut:
    """Speichert den SMTP-Server. Das Passwort liegt nur verschlüsselt in der Datenbank."""
    stored = get_setting(db, SMTP_KEY)
    previous = stored if isinstance(stored, dict) else {}
    token = previous.get("password_encrypted") or None
    password_changed = body.password is not None
    if body.password == "":
        token = None
    elif body.password:
        try:
            token = encrypt_secret(settings, body.password)
        except SecretKeyMissingError as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Auf dem Server fehlt die Schlüsseldatei (settings_key). "
                "Ohne sie kann kein Passwort gespeichert werden.",
            ) from error
    if token and body.security == "none":
        raise HTTPException(
            status_code=422,
            detail="Mit Passwort ist eine verschlüsselte Verbindung nötig (STARTTLS oder TLS).",
        )
    if token and not body.username:
        raise HTTPException(status_code=422, detail="Zum Passwort gehört ein Benutzername.")
    value = {
        "host": body.host,
        "port": body.port,
        "security": body.security,
        "username": body.username,
        "sender_address": body.sender_address,
        "sender_name": body.sender_name,
        "password_encrypted": token,
    }
    set_setting(db, SMTP_KEY, value, user.user_id)
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.smtp_geaendert",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=SMTP_KEY,
        ip=client_ip(request),
        details={
            "host": body.host,
            "port": body.port,
            "security": body.security,
            "username": body.username,
            "sender_address": body.sender_address,
            "passwort_geaendert": password_changed,
        },
    )
    db.commit()
    return _settings_out(db, settings)


@router.post("/smtp/test")
def test_smtp(
    request: Request,
    user: AdminUser,
    db: DbDep,
    settings: SettingsDep,
    sender: MailSenderDep,
) -> TestResultOut:
    """Sendet eine Testmail an die eigene Adresse der angemeldeten Person."""
    if not user.email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Für dein Konto ist keine E-Mail-Adresse hinterlegt.",
        )
    failure: str | None = None
    try:
        config = load_smtp_config(db, settings)
        if config is None:
            failure = "Es ist noch kein SMTP-Server eingetragen."
        else:
            sender(
                config,
                user.email,
                "Testmail der Werkbank",
                "Diese Mail bestätigt, dass der Versand über den eingetragenen "
                "SMTP-Server funktioniert.",
            )
    except MailError as error:
        failure = str(error)
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.smtp_test",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=SMTP_KEY,
        result="ok" if failure is None else "fehler",
        ip=client_ip(request),
        note=failure,
    )
    db.commit()
    if failure is not None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=failure)
    return TestResultOut(recipient=user.email)


@router.put("/teams")
def update_teams(
    request: Request, body: TeamsIn, user: AdminUser, db: DbDep, settings: SettingsDep
) -> SettingsOut:
    """Speichert den Teams-Workflow. Die Adresse enthält ein Geheimnis und liegt verschlüsselt."""
    stored = get_setting(db, TEAMS_KEY)
    previous = stored if isinstance(stored, dict) else {}
    token = previous.get("url_encrypted") or None
    url_changed = body.url is not None
    if body.url == "":
        token = None
    elif body.url:
        url = body.url.strip()
        if not valid_workflow_url(url):
            raise HTTPException(
                status_code=422,
                detail="Bitte die https-Adresse des Workflows aus Power Automate eintragen "
                "(…logic.azure.com oder …api.powerplatform.com).",
            )
        try:
            token = encrypt_secret(settings, url)
        except SecretKeyMissingError as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Auf dem Server fehlt die Schlüsseldatei (settings_key). "
                "Ohne sie kann keine Adresse gespeichert werden.",
            ) from error
    if body.enabled and not token:
        raise HTTPException(status_code=422, detail="Zum Einschalten fehlt die Adresse.")
    set_setting(db, TEAMS_KEY, {"enabled": body.enabled, "url_encrypted": token}, user.user_id)
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.teams_geaendert",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=TEAMS_KEY,
        ip=client_ip(request),
        details={"eingeschaltet": body.enabled, "adresse_geaendert": url_changed},
    )
    db.commit()
    return _settings_out(db, settings)


@router.post("/teams/test")
def test_teams(
    request: Request,
    user: AdminUser,
    db: DbDep,
    settings: SettingsDep,
    sender: TeamsSenderDep,
) -> TestResultOut:
    """Schickt eine Testnachricht über den Workflow an die eigene Mailadresse (Teams-Chat)."""
    if not user.email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Für dein Konto ist keine E-Mail-Adresse hinterlegt.",
        )
    failure: str | None = None
    url = load_teams_url(db, settings)
    if url is None:
        failure = "Teams ist nicht eingerichtet oder ausgeschaltet."
    else:
        try:
            sender(
                url,
                teams_payload(
                    user.email,
                    load_brand(db),
                    sample_digest(user.display_name),
                    settings.public_origin,
                ),
            )
        except TeamsError as error:
            failure = str(error)
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.teams_test",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=TEAMS_KEY,
        result="ok" if failure is None else "fehler",
        ip=client_ip(request),
        note=failure,
    )
    db.commit()
    if failure is not None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=failure)
    return TestResultOut(recipient=user.email)


@router.put("/audit-retention")
def update_audit_retention(
    request: Request, body: AuditRetentionIn, user: AdminUser, db: DbDep, settings: SettingsDep
) -> SettingsOut:
    """Legt fest, nach wie vielen Tagen Einträge im Audit-Log gelöscht werden."""
    before = audit_retention_days(db)
    set_setting(db, AUDIT_RETENTION_KEY, body.days, user.user_id)
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.aufbewahrung_geaendert",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=AUDIT_RETENTION_KEY,
        ip=client_ip(request),
        details={"vorher": before, "nachher": body.days},
    )
    db.commit()
    return _settings_out(db, settings)


@router.put("/credential-warn-days")
def update_credential_warn_days(
    request: Request, body: CredentialWarnIn, user: AdminUser, db: DbDep, settings: SettingsDep
) -> SettingsOut:
    """Legt fest, wie viele Tage vor dem Ablauf die Werkbank hinweist, warnt und drängt."""
    days = valid_warn_days(body.days)
    if days is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Drei absteigende Zahlen innerhalb der Grenzen angeben",
        )
    before = list(warn_days(db))
    set_setting(db, WARN_DAYS_KEY, list(days), user.user_id)
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.vorlauf_geaendert",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=WARN_DAYS_KEY,
        ip=client_ip(request),
        details={"vorher": before, "nachher": list(days)},
    )
    db.commit()
    return _settings_out(db, settings)


@router.put("/tools-internet")
def update_tools_internet(
    request: Request, body: ToolsInternetIn, user: AdminUser, db: DbDep, settings: SettingsDep
) -> SettingsOut:
    """Schaltet die Abfragen der IT-Tools ins Internet ein oder aus.

    Betrifft DNS, RDAP, die Prüfung auf Datenlecks und crt.sh.
    """
    before = tools_internet_enabled(db)
    set_setting(db, TOOLS_INTERNET_KEY, body.enabled, user.user_id)
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.tools_internet_geaendert",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=TOOLS_INTERNET_KEY,
        ip=client_ip(request),
        details={"vorher": before, "nachher": body.enabled},
    )
    db.commit()
    return _settings_out(db, settings)


AI_TEST_SYSTEM = "Du prüfst eine Verbindung. Antworte nur mit dem Wort OK."
AI_TEST_PROMPT = "Verbindungstest"


@router.put("/ai")
def update_ai(
    request: Request, body: AiIn, user: AdminUser, db: DbDep, settings: SettingsDep
) -> SettingsOut:
    """Speichert den KI-Anbieter. Der Schlüssel liegt nur verschlüsselt in der Datenbank."""
    previous = stored_ai(db)
    token = previous.get("api_key_encrypted") or None
    if body.api_key == "":
        token = None
    elif body.api_key:
        try:
            token = encrypt_secret(settings, body.api_key)
        except SecretKeyMissingError as error:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Auf dem Server fehlt die Schlüsseldatei (settings_key). "
                "Ohne sie kann kein Schlüssel gespeichert werden.",
            ) from error
    if body.enabled and not (body.base_url and body.model):
        raise HTTPException(
            status_code=422, detail="Zum Einschalten sind Adresse und Modell nötig."
        )
    if token and not body.base_url.startswith("https://"):
        raise HTTPException(
            status_code=422,
            detail="Mit Schlüssel muss die Adresse mit https:// beginnen.",
        )
    value = {
        "enabled": body.enabled,
        "base_url": body.base_url,
        "model": body.model,
        "texts_per_hour": body.texts_per_hour,
        "api_key_encrypted": token,
    }
    set_setting(db, AI_KEY, value, user.user_id)
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.ki_geaendert",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=AI_KEY,
        ip=client_ip(request),
        details={
            "enabled": body.enabled,
            "base_url": body.base_url,
            "model": body.model,
            "texts_per_hour": body.texts_per_hour,
            "schluessel_geaendert": body.api_key is not None,
        },
    )
    db.commit()
    return _settings_out(db, settings)


class AiTestOut(BaseModel):
    model: str


@router.post("/ai/test")
def test_ai(
    request: Request,
    user: AdminUser,
    db: DbDep,
    settings: SettingsDep,
    completer: AiCompleterDep,
) -> AiTestOut:
    """Prüft die Verbindung zum Anbieter mit einer kurzen Anfrage ohne Inhalte."""
    failure: str | None = None
    model = ""
    try:
        config = load_ai_config(db, settings, require_enabled=False)
        if config is None:
            failure = "Es sind noch keine Adresse und kein Modell eingetragen."
        else:
            model = config.model
            completer(config, AI_TEST_SYSTEM, AI_TEST_PROMPT)
    except AiError as error:
        failure = str(error)
    write_audit(
        db,
        module=MODULE,
        action="einstellungen.ki_test",
        user_id=user.user_id,
        object_type="einstellung",
        object_id=AI_KEY,
        result="ok" if failure is None else "fehler",
        ip=client_ip(request),
        note=failure,
    )
    db.commit()
    if failure is not None:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=failure)
    return AiTestOut(model=model)
