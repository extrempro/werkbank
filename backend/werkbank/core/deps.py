"""FastAPI-Abhängigkeiten für Einstellungen, Anmeldung und Rollen."""

from collections.abc import Callable
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.sessions import SESSION_COOKIE, CurrentUser, load_session, now_utc
from werkbank.db import get_session


def get_app_settings(request: Request) -> Settings:
    """Einstellungen der laufenden Anwendung."""
    settings: Settings = request.app.state.settings
    return settings


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
DbDep = Annotated[Session, Depends(get_session)]

# Antwort-Header, an dem die Oberfläche erkennt, dass eine erneute Anmeldung nötig ist
STEP_UP_HEADER = "X-Werkbank-Step-Up"


def get_current_user(request: Request, settings: SettingsDep, db: DbDep) -> CurrentUser:
    """Angemeldete Person oder 401."""
    user = load_session(db, settings, request.cookies.get(SESSION_COOKIE))
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Nicht angemeldet")
    return user


CurrentUserDep = Annotated[CurrentUser, Depends(get_current_user)]


def require_roles(*roles: str) -> Callable[[CurrentUser], CurrentUser]:
    """Abhängigkeit: Person muss mindestens eine der Rollen haben, sonst 403."""

    def dependency(user: CurrentUserDep) -> CurrentUser:
        if not user.has_any_role(*roles):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Keine Berechtigung")
        return user

    return dependency


def check_recent_login(user: CurrentUser, settings: Settings) -> None:
    """403 mit Hinweis auf erneute Anmeldung, wenn die Anmeldung älter als STEP_UP_MINUTES ist.

    Für Endpunkte, die nur in manchen Fällen eine frische Anmeldung brauchen (z. B. nur, wenn
    sich Rechte ändern).
    """
    limit = user.authenticated_at + timedelta(minutes=settings.step_up_minutes)
    if now_utc() >= limit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Erneute Anmeldung erforderlich",
            headers={STEP_UP_HEADER: "required"},
        )


def require_recent_login(*roles: str) -> Callable[[CurrentUser, Settings], CurrentUser]:
    """Wie require_roles, zusätzlich darf die Anmeldung höchstens STEP_UP_MINUTES alt sein."""
    role_check = require_roles(*roles)

    def dependency(
        user: Annotated[CurrentUser, Depends(role_check)], settings: SettingsDep
    ) -> CurrentUser:
        check_recent_login(user, settings)
        return user

    return dependency
