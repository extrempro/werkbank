"""Zweite Anmeldung mit dem Admin-Konto, nur für die Gerätezuordnung (delegiert, im Server).

Ablauf wie die normale Anmeldung (Authorization Code mit PKCE über MSAL, Werkbank-App), aber mit
`prompt=select_account` und den Intune-Scopes dieses Moduls. Gespeichert wird nur das
Zugriffstoken, verschlüsselt und an die Werkbank-Sitzung gebunden; ein Refresh-Token wird
verworfen. Es gilt bis zu seinem Ablauf (rund eine Stunde) oder bis „Trennen“.
Wirksam ist immer beides: Graph-Scope UND Intune-Rolle des Admin-Kontos.
"""

from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import (
    SecretKeyMissingError,
    decrypt_secret,
    encrypt_secret,
    secret_key_available,
)
from werkbank.core.audit import write_audit
from werkbank.core.auth import AUTH_FLOW_MINUTES, EntraDep, _set_cookie
from werkbank.core.deps import DbDep, SettingsDep, require_roles
from werkbank.core.models import AuthFlow
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, hash_token, new_token, now_utc
from werkbank.modules.devices.models import DeviceAdminSession

MODULE = "geraete"
ADMIN_FLOW_COOKIE = "__Host-werkbank-geraete"
CALLBACK_PATH = "/auth/geraete/callback"
PAGE_PATH = "/m365/geraete/zuordnung"
# Delegierte Scopes (Admin-Zustimmung einmalig, siehe docs/entra-setup.md)
ADMIN_SCOPES = [
    "https://graph.microsoft.com/DeviceManagementServiceConfig.ReadWrite.All",
    "https://graph.microsoft.com/DeviceManagementConfiguration.Read.All",
    "https://graph.microsoft.com/DeviceManagementManagedDevices.Read.All",
    "https://graph.microsoft.com/User.Read",
]
# Höchstens so lange gilt das Token in der Werkbank, auch wenn Entra länger erlaubt
MAX_TOKEN_MINUTES = 60
# Platzhalter-Token der Testanmeldung (nur test/development); führt zur nachgestellten Graph-API
FAKE_TOKEN = "werkbank-test-admin"  # noqa: S105 (kein Geheimnis, nur Testumgebung)

router = APIRouter()
Member = Annotated[CurrentUser, Depends(require_roles(Role.DEVICES_ASSOCIATION))]


class AdminOut(BaseModel):
    connected: bool
    upn: str | None = None
    name: str | None = None
    expires_at: str | None = None


def current_admin(db: Session, user: CurrentUser) -> DeviceAdminSession | None:
    row = db.get(DeviceAdminSession, user.session_id)
    if row is None:
        return None
    if row.expires_at <= now_utc():
        db.delete(row)
        db.commit()
        return None
    return row


def admin_token(db: Session, settings: Settings, user: CurrentUser) -> tuple[str, str] | None:
    """(Token, Admin-Konto) der laufenden Sitzung oder None."""
    row = current_admin(db, user)
    if row is None:
        return None
    token = decrypt_secret(settings, row.token_enc)
    return (token, row.admin_upn) if token else None


def admin_out(row: DeviceAdminSession | None) -> AdminOut:
    if row is None:
        return AdminOut(connected=False)
    return AdminOut(
        connected=True,
        upn=row.admin_upn,
        name=row.admin_name,
        expires_at=row.expires_at.isoformat(),
    )


def _store(
    db: Session,
    settings: Settings,
    user: CurrentUser,
    token: str,
    upn: str,
    name: str,
    minutes: int,
) -> None:
    if not secret_key_available(settings):
        raise SecretKeyMissingError
    db.execute(delete(DeviceAdminSession).where(DeviceAdminSession.session_id == user.session_id))
    db.add(
        DeviceAdminSession(
            session_id=user.session_id,
            token_enc=encrypt_secret(settings, token),
            admin_upn=upn[:320],
            admin_name=name[:256],
            expires_at=now_utc() + timedelta(minutes=max(1, min(minutes, MAX_TOKEN_MINUTES))),
        )
    )


@router.get("/api/devices/admin")
def admin_status(user: Member, db: DbDep) -> AdminOut:
    return admin_out(current_admin(db, user))


@router.get("/api/devices/admin/login")
def admin_login(
    user: Member, db: DbDep, settings: SettingsDep, entra: EntraDep
) -> RedirectResponse:
    """Weiter zu Microsoft: Kontoauswahl für das Admin-Konto, danach MFA."""
    flow = entra.initiate_auth_code_flow(
        scopes=ADMIN_SCOPES,
        redirect_uri=f"{settings.public_url}{CALLBACK_PATH}",
        prompt="select_account",
    )
    flow_id = new_token()
    db.execute(delete(AuthFlow).where(AuthFlow.expires_at < now_utc()))
    # Die Sitzung, für die das Token gedacht ist, reist im Flow mit (nicht im Browser).
    db.add(
        AuthFlow(
            id_hash=hash_token(flow_id),
            flow={**flow, "werkbank_session": str(user.session_id)},
            return_to=PAGE_PATH,
            expires_at=now_utc() + timedelta(minutes=AUTH_FLOW_MINUTES),
        )
    )
    db.commit()
    response = RedirectResponse(flow["auth_uri"], status_code=status.HTTP_303_SEE_OTHER)
    _set_cookie(response, ADMIN_FLOW_COOKIE, flow_id, AUTH_FLOW_MINUTES * 60)
    return response


@router.get(CALLBACK_PATH)
def admin_callback(
    request: Request, user: Member, db: DbDep, settings: SettingsDep, entra: EntraDep
) -> RedirectResponse:
    """Rückkehr von Microsoft: Code einlösen, nur das Zugriffstoken behalten."""
    flow_id = request.cookies.get(ADMIN_FLOW_COOKIE)
    auth_flow = db.get(AuthFlow, hash_token(flow_id)) if flow_id else None
    target = f"{PAGE_PATH}?admin=fehler"
    if auth_flow is None or auth_flow.expires_at < now_utc():
        return RedirectResponse(target, status_code=status.HTTP_303_SEE_OTHER)
    flow = dict(auth_flow.flow)
    db.delete(auth_flow)
    db.commit()
    if flow.pop("werkbank_session", None) != str(user.session_id):
        return RedirectResponse(target, status_code=status.HTTP_303_SEE_OTHER)

    result = entra.acquire_token_by_auth_code_flow(flow, dict(request.query_params))
    claims = result.get("id_token_claims")
    token = result.get("access_token")
    ok = (
        "error" not in result
        and isinstance(claims, dict)
        and claims.get("tid") == settings.entra_tenant_id
        and isinstance(token, str)
        and token
    )
    if not ok or not isinstance(claims, dict) or not isinstance(token, str):
        write_audit(
            db,
            module=MODULE,
            action="admin_konto.abgelehnt",
            user_id=user.user_id,
            result="abgelehnt",
            details={"grund": str(result.get("error") or "falscher_mandant_oder_kein_token")[:100]},
        )
        db.commit()
        return RedirectResponse(target, status_code=status.HTTP_303_SEE_OTHER)
    upn = str(claims.get("preferred_username") or claims.get("upn") or "")
    name = str(claims.get("name") or upn)
    expires_in = result.get("expires_in")
    minutes = int(expires_in) // 60 if isinstance(expires_in, int | float) else MAX_TOKEN_MINUTES
    try:
        _store(db, settings, user, token, upn, name, minutes - 1)
    except SecretKeyMissingError:
        return RedirectResponse(f"{PAGE_PATH}?admin=schluessel", status_code=303)
    write_audit(
        db,
        module=MODULE,
        action="admin_konto.verbunden",
        user_id=user.user_id,
        details={"admin_konto": upn[:320]},
    )
    db.commit()
    response = RedirectResponse(f"{PAGE_PATH}?admin=verbunden", status_code=303)
    response.delete_cookie(ADMIN_FLOW_COOKIE, path="/", secure=True, httponly=True)
    return response


@router.post("/api/devices/admin/logout")
def admin_logout(user: Member, db: DbDep) -> AdminOut:
    """„Trennen“: Token sofort löschen."""
    row = db.get(DeviceAdminSession, user.session_id)
    if row is not None:
        write_audit(
            db,
            module=MODULE,
            action="admin_konto.getrennt",
            user_id=user.user_id,
            details={"admin_konto": row.admin_upn},
        )
        db.delete(row)
        db.commit()
    return AdminOut(connected=False)


class TestAdminIn(BaseModel):
    upn: str = Field(min_length=3, max_length=320)


@router.post("/api/devices/admin/test-login")
def admin_test_login(body: TestAdminIn, user: Member, db: DbDep, settings: SettingsDep) -> AdminOut:
    """Nur für automatische Tests: Admin-Konto ohne Microsoft, Graph wird nachgestellt."""
    if not settings.enable_test_login or settings.environment not in ("test", "development"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    try:
        _store(db, settings, user, FAKE_TOKEN, body.upn, body.upn, MAX_TOKEN_MINUTES)
    except SecretKeyMissingError as error:
        raise HTTPException(
            status_code=503, detail="Schlüssel für verschlüsselte Daten fehlt"
        ) from error
    db.commit()
    return admin_out(
        db.execute(
            select(DeviceAdminSession).where(DeviceAdminSession.session_id == user.session_id)
        ).scalar_one()
    )
