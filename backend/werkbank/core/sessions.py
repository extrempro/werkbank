"""Serverseitige Sitzungen (spec.md, Kapitel 6.1)."""

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.models import User, UserSession

SESSION_COOKIE = "__Host-werkbank"


def hash_token(token: str) -> str:
    """SHA-256 eines Tokens. In der Datenbank liegt nie das Token selbst."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_token() -> str:
    """Erzeugt ein zufälliges, nicht erratbares Token."""
    return secrets.token_urlsafe(32)


def now_utc() -> datetime:
    return datetime.now(UTC)


@dataclass(frozen=True)
class CurrentUser:
    """Angemeldete Person mit ihren Rollen aus der laufenden Sitzung."""

    user_id: uuid.UUID
    session_id: uuid.UUID
    display_name: str
    email: str | None
    roles: tuple[str, ...]
    authenticated_at: datetime
    expires_at: datetime

    def has_any_role(self, *roles: str) -> bool:
        return any(role in self.roles for role in roles)


def create_session(
    db: Session, settings: Settings, user: User, roles: list[str], *, authenticated_at: datetime
) -> str:
    """Legt eine Sitzung an und liefert das Token für das Cookie."""
    token = new_token()
    now = now_utc()
    db.add(
        UserSession(
            token_hash=hash_token(token),
            user_id=user.id,
            roles=roles,
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(hours=settings.session_max_hours),
            authenticated_at=authenticated_at,
        )
    )
    return token


def load_session(db: Session, settings: Settings, token: str | None) -> CurrentUser | None:
    """Prüft das Token, Leerlauf- und Höchstdauer. Aktualisiert den Zeitpunkt der Nutzung."""
    if not token:
        return None
    row = db.execute(
        select(UserSession, User)
        .join(User, User.id == UserSession.user_id)
        .where(UserSession.token_hash == hash_token(token))
    ).first()
    if row is None:
        return None
    user_session, user = row
    now = now_utc()
    idle_limit = user_session.last_seen_at + timedelta(minutes=settings.session_idle_minutes)
    if now >= user_session.expires_at or now >= idle_limit:
        db.delete(user_session)
        db.commit()
        return None
    user_session.last_seen_at = now
    db.commit()
    return CurrentUser(
        user_id=user.id,
        session_id=user_session.id,
        display_name=user.display_name,
        email=user.email,
        roles=tuple(user_session.roles),
        authenticated_at=user_session.authenticated_at,
        expires_at=user_session.expires_at,
    )


def delete_session(db: Session, token: str | None) -> None:
    """Beendet eine Sitzung serverseitig."""
    if not token:
        return
    db.execute(delete(UserSession).where(UserSession.token_hash == hash_token(token)))
    db.commit()
