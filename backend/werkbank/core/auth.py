"""Anmeldung über Entra ID (OIDC, Authorization Code Flow mit PKCE) und Test-Login.

Backend-for-Frontend: Tokens von Entra bleiben im Backend, der Browser erhält nur ein
Session-Cookie. Siehe docs/spec.md, Kapitel 6.1, und docs/entra-setup.md.
"""

import hashlib
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any, Protocol

from cryptography import x509
from cryptography.hazmat.primitives import serialization
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select

from werkbank.config import Settings
from werkbank.core.audit import write_audit
from werkbank.core.deps import CurrentUserDep, DbDep, SettingsDep
from werkbank.core.models import AuthFlow, User
from werkbank.core.roles import filter_known_roles
from werkbank.core.sessions import (
    SESSION_COOKIE,
    create_session,
    delete_session,
    hash_token,
    new_token,
    now_utc,
)

AUTH_FLOW_COOKIE = "__Host-werkbank-auth"
AUTH_FLOW_MINUTES = 10

router = APIRouter()


class EntraClient(Protocol):
    """Die Teile von msal.ConfidentialClientApplication, die die Werkbank nutzt."""

    def initiate_auth_code_flow(
        self, scopes: list[str], redirect_uri: str | None = None, **kwargs: Any
    ) -> dict[str, Any]: ...

    def acquire_token_by_auth_code_flow(
        self, auth_code_flow: dict[str, Any], auth_response: dict[str, Any], **kwargs: Any
    ) -> dict[str, Any]: ...


def _client_credential(settings: Settings) -> str | dict[str, str]:
    """Zertifikat (bevorzugt) oder geheimer Clientschlüssel aus Docker-Secrets."""
    if settings.entra_client_key_file.exists() and settings.entra_client_cert_file.exists():
        cert = x509.load_pem_x509_certificate(settings.entra_client_cert_file.read_bytes())
        der = cert.public_bytes(serialization.Encoding.DER)
        # Entra erwartet den SHA-1-Fingerabdruck des Zertifikats (Header x5t). Er dient nur als
        # Kennung des Zertifikats, nicht der Sicherheit; signiert wird mit dem privaten Schlüssel.
        thumbprint = hashlib.sha1(der, usedforsecurity=False).hexdigest()  # nosemgrep
        return {
            "private_key": settings.entra_client_key_file.read_text(encoding="utf-8"),
            "thumbprint": thumbprint,
        }
    if settings.entra_client_secret_file.exists():
        return settings.entra_client_secret_file.read_text(encoding="utf-8").strip()
    raise RuntimeError("Kein Zertifikat und kein geheimer Clientschlüssel für Entra gefunden.")


def get_entra_client(settings: SettingsDep) -> EntraClient:
    """Erzeugt den MSAL-Client erst bei Bedarf (in Tests ersetzbar)."""
    import msal

    client: EntraClient = msal.ConfidentialClientApplication(
        client_id=settings.entra_client_id,
        client_credential=_client_credential(settings),
        authority=f"https://login.microsoftonline.com/{settings.entra_tenant_id}",
    )
    return client


EntraDep = Annotated[EntraClient, Depends(get_entra_client)]


def _set_cookie(response: Response, name: str, value: str, max_age: int) -> None:
    response.set_cookie(
        name, value, max_age=max_age, path="/", secure=True, httponly=True, samesite="lax"
    )


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def _safe_return_to(value: str | None) -> str:
    """Nur relative Pfade innerhalb der Werkbank (kein offener Redirect)."""
    if value and value.startswith("/") and not value.startswith("//") and "\\" not in value:
        return value[:512]
    return "/"


def _start_session(
    request: Request,
    db: DbDep,
    settings: Settings,
    *,
    oid: str,
    name: str,
    email: str | None,
    roles: list[str],
    method: str,
    return_to: str,
) -> RedirectResponse:
    """Legt bzw. aktualisiert die Person an, startet die Sitzung und protokolliert."""
    now = now_utc()
    user = db.execute(select(User).where(User.entra_oid == oid)).scalar_one_or_none()
    if user is None:
        user = User(entra_oid=oid, display_name=name, email=email)
        db.add(user)
    else:
        user.display_name = name
        user.email = email
    user.last_login_at = now
    user.last_roles = roles
    db.flush()
    token = create_session(db, settings, user, roles, authenticated_at=now)
    write_audit(
        db,
        module="kern",
        action="anmeldung.erfolgreich",
        user_id=user.id,
        ip=_client_ip(request),
        details={"methode": method, "rollen": roles},
    )
    db.commit()
    response = RedirectResponse(return_to, status_code=status.HTTP_303_SEE_OTHER)
    _set_cookie(response, SESSION_COOKIE, token, settings.session_max_hours * 3600)
    response.delete_cookie(AUTH_FLOW_COOKIE, path="/", secure=True, httponly=True)
    return response


def _deny(request: Request, db: DbDep, reason: str) -> HTTPException:
    write_audit(
        db,
        module="kern",
        action="anmeldung.abgelehnt",
        result="abgelehnt",
        ip=_client_ip(request),
        details={"grund": reason},
    )
    db.commit()
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Anmeldung nicht möglich")


@router.get("/auth/login")
def login(
    request: Request,
    db: DbDep,
    settings: SettingsDep,
    entra: EntraDep,
    return_to: str | None = None,
) -> RedirectResponse:
    """Leitet zur Anmeldung bei Entra weiter."""
    flow = entra.initiate_auth_code_flow(
        scopes=["email"], redirect_uri=f"{settings.public_url}/auth/callback"
    )
    flow_id = new_token()
    db.execute(delete(AuthFlow).where(AuthFlow.expires_at < now_utc()))
    db.add(
        AuthFlow(
            id_hash=hash_token(flow_id),
            flow=flow,
            return_to=_safe_return_to(return_to),
            expires_at=now_utc() + timedelta(minutes=AUTH_FLOW_MINUTES),
        )
    )
    db.commit()
    response = RedirectResponse(flow["auth_uri"], status_code=status.HTTP_303_SEE_OTHER)
    _set_cookie(response, AUTH_FLOW_COOKIE, flow_id, AUTH_FLOW_MINUTES * 60)
    return response


@router.get("/auth/callback")
def callback(
    request: Request, db: DbDep, settings: SettingsDep, entra: EntraDep
) -> RedirectResponse:
    """Rückkehr von Entra: Code einlösen, Token prüfen, Sitzung starten."""
    flow_id = request.cookies.get(AUTH_FLOW_COOKIE)
    auth_flow = db.get(AuthFlow, hash_token(flow_id)) if flow_id else None
    if auth_flow is None or auth_flow.expires_at < now_utc():
        raise _deny(request, db, "anmeldevorgang_unbekannt_oder_abgelaufen")
    flow, return_to = auth_flow.flow, auth_flow.return_to
    db.delete(auth_flow)
    db.commit()

    result = entra.acquire_token_by_auth_code_flow(flow, dict(request.query_params))
    claims = result.get("id_token_claims")
    if "error" in result or not isinstance(claims, dict):
        raise _deny(request, db, str(result.get("error", "kein_id_token")))
    if claims.get("tid") != settings.entra_tenant_id:
        raise _deny(request, db, "falscher_mandant")
    oid = claims.get("oid")
    if not isinstance(oid, str) or not oid:
        raise _deny(request, db, "keine_objekt_id")
    roles = filter_known_roles(claims.get("roles"))
    if not roles:
        raise _deny(request, db, "keine_rolle")

    name = str(claims.get("name") or claims.get("preferred_username") or "Unbekannt")[:256]
    email_claim = claims.get("email") or claims.get("preferred_username")
    email = str(email_claim)[:320] if email_claim else None
    return _start_session(
        request,
        db,
        settings,
        oid=oid,
        name=name,
        email=email,
        roles=roles,
        method="entra",
        return_to=return_to,
    )


@router.api_route("/auth/logout", methods=["GET", "POST"])
def logout(request: Request, db: DbDep) -> RedirectResponse:
    """Beendet die Sitzung (auch als Front-Channel-Abmeldung von Entra aufrufbar)."""
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        write_audit(db, module="kern", action="abmeldung", ip=_client_ip(request))
        delete_session(db, token)
    response = RedirectResponse("/", status_code=status.HTTP_303_SEE_OTHER)
    response.delete_cookie(SESSION_COOKIE, path="/", secure=True, httponly=True)
    return response


class TestLoginRequest(BaseModel):
    """Test-Login: nur in den Umgebungen test und development."""

    oid: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=256)
    email: str | None = Field(default=None, max_length=320)
    roles: list[str] = Field(default_factory=list)


@router.post("/auth/test-login")
def test_login(
    request: Request, body: TestLoginRequest, db: DbDep, settings: SettingsDep
) -> RedirectResponse:
    """Anmeldung ohne Entra für automatische Tests. In Produktion nicht vorhanden (404)."""
    if not settings.enable_test_login or settings.environment not in ("test", "development"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    roles = filter_known_roles(body.roles)
    if not roles:
        raise _deny(request, db, "keine_rolle")
    return _start_session(
        request,
        db,
        settings,
        oid=f"test:{body.oid}",
        name=body.name,
        email=body.email,
        roles=roles,
        method="test",
        return_to="/",
    )


class MeResponse(BaseModel):
    display_name: str
    email: str | None
    roles: list[str]
    authenticated_at: datetime


@router.get("/api/me")
def me(user: CurrentUserDep) -> MeResponse:
    """Angaben zur angemeldeten Person (für die Oberfläche)."""
    return MeResponse(
        display_name=user.display_name,
        email=user.email,
        roles=list(user.roles),
        authenticated_at=user.authenticated_at.astimezone(UTC),
    )
