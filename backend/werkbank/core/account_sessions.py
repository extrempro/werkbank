"""Konto, Angemeldete Geräte: eigene Sitzungen ansehen und auf anderen Geräten abmelden."""

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Request, status
from pydantic import BaseModel
from sqlalchemy import delete, select

from werkbank.core.audit import write_audit
from werkbank.core.deps import CurrentUserDep, DbDep, SettingsDep
from werkbank.core.models import UserSession
from werkbank.core.sessions import is_active, now_utc
from werkbank.core.user_agent import UNKNOWN

router = APIRouter(prefix="/api/account/sessions", tags=["konto"])

SessionId = Annotated[uuid.UUID, Path()]


class SessionOut(BaseModel):
    id: str
    # „Edge unter Windows“; ältere Sitzungen ohne Angabe: „Unbekanntes Gerät“
    device: str
    authenticated_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    # Die Sitzung, mit der diese Anfrage kommt
    current: bool


class EndedOut(BaseModel):
    ended: int


def _client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.get("")
def list_sessions(user: CurrentUserDep, db: DbDep, settings: SettingsDep) -> list[SessionOut]:
    """Alle noch gültigen Sitzungen der angemeldeten Person, dieses Gerät zuerst."""
    now = now_utc()
    rows = db.scalars(select(UserSession).where(UserSession.user_id == user.user_id)).all()
    active = [row for row in rows if is_active(row, settings, now)]
    active.sort(key=lambda row: (row.id != user.session_id, -row.last_seen_at.timestamp()))
    return [
        SessionOut(
            id=str(row.id),
            device=row.device or UNKNOWN,
            authenticated_at=row.authenticated_at.astimezone(UTC),
            last_seen_at=row.last_seen_at.astimezone(UTC),
            expires_at=row.expires_at.astimezone(UTC),
            current=row.id == user.session_id,
        )
        for row in active
    ]


@router.delete("/{session_id}")
def end_session(
    request: Request, session_id: SessionId, user: CurrentUserDep, db: DbDep
) -> EndedOut:
    """Eine andere eigene Sitzung beenden. Dieses Gerät meldet „Abmelden“ ab."""
    row = db.get(UserSession, session_id)
    if row is None or row.user_id != user.user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Diese Sitzung gibt es nicht (mehr).")
    if row.id == user.session_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Dieses Gerät meldest du über „Abmelden“ ab.")
    write_audit(
        db,
        module="kern",
        action="sitzung.beendet",
        user_id=user.user_id,
        object_type="sitzung",
        object_id=str(row.id),
        ip=_client_ip(request),
        details={"geraet": row.device or UNKNOWN},
    )
    db.delete(row)
    db.commit()
    return EndedOut(ended=1)


@router.post("/logout-others")
def end_other_sessions(request: Request, user: CurrentUserDep, db: DbDep) -> EndedOut:
    """Alle anderen eigenen Sitzungen beenden; diese bleibt bestehen."""
    result = db.execute(
        delete(UserSession).where(
            UserSession.user_id == user.user_id, UserSession.id != user.session_id
        )
    )
    ended = result.rowcount or 0  # type: ignore[attr-defined]
    write_audit(
        db,
        module="kern",
        action="sitzungen.andere_beendet",
        user_id=user.user_id,
        ip=_client_ip(request),
        details={"anzahl": ended},
    )
    db.commit()
    return EndedOut(ended=ended)
