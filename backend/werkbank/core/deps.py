"""FastAPI-Abhängigkeiten für Einstellungen, Anmeldung und Rollen."""

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.sessions import SESSION_COOKIE, CurrentUser, load_session
from werkbank.db import get_session


def get_app_settings(request: Request) -> Settings:
    """Einstellungen der laufenden Anwendung."""
    settings: Settings = request.app.state.settings
    return settings


SettingsDep = Annotated[Settings, Depends(get_app_settings)]
DbDep = Annotated[Session, Depends(get_session)]


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
