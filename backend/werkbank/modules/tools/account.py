"""IT-Tools je Konto: Favoriten, zuletzt genutzte Tools und Verlauf der Einstellungen.

Der Verlauf speichert nur, was ein Tool ohnehin in die Adresszeile schreibt: Optionen und
harmlose Eingaben, nie Kennwörter, Schlüssel oder eingegebene Texte (Regel der IT-Tools).
Jede Person sieht nur ihre eigenen Einträge.
"""

import re
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.core.deps import DbDep, require_roles
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.tools.models import ToolHistory, ToolPrefs

router = APIRouter(prefix="/api/tools")

ToolsUser = Annotated[CurrentUser, Depends(require_roles(Role.TOOLS_USER))]

TOOL_ID = re.compile(r"^[a-z0-9-]{1,60}$")
PARAM_KEY = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
FAVORITES_MAX = 100
RECENT_MAX = 6
PARAMS_MAX = 30
VALUE_MAX = 500
SUMMARY_MAX = 160
HISTORY_MAX = 200
HISTORY_DAYS = 90
LIST_MAX = 200


def _tool_ids(values: list[str]) -> list[str]:
    out: list[str] = []
    for value in values:
        if not TOOL_ID.match(value):
            raise ValueError("Unbekannte Kennung eines Tools.")
        if value not in out:
            out.append(value)
    return out


def summarize(params: dict[str, str]) -> str:
    """Kurze Beschreibung aus den Werten: je Wert gekürzt, mehrzeilige nur die erste Zeile."""
    parts = []
    for value in params.values():
        lines = [line for line in value.strip().splitlines() if line.strip()]
        if not lines:
            continue
        first = lines[0].strip()
        cut = f"{first[:47]}…" if len(first) > 48 else first
        parts.append(f"{cut} (+{len(lines) - 1} Zeilen)" if len(lines) > 1 else cut)
    text = " · ".join(parts)
    return f"{text[: SUMMARY_MAX - 1]}…" if len(text) > SUMMARY_MAX else text


def _prefs(db: Session, user: CurrentUser) -> ToolPrefs:
    prefs = db.get(ToolPrefs, user.user_id)
    if prefs is None:
        prefs = ToolPrefs(user_id=user.user_id, favorites=[], recent=[], history_enabled=True)
        db.add(prefs)
        db.flush()
    return prefs


class PrefsOut(BaseModel):
    favorites: list[str]
    recent: list[str]
    history_enabled: bool


def _prefs_out(prefs: ToolPrefs) -> PrefsOut:
    return PrefsOut(
        favorites=list(prefs.favorites or []),
        recent=list(prefs.recent or []),
        history_enabled=prefs.history_enabled,
    )


class PrefsIn(BaseModel):
    # None: unverändert
    favorites: list[str] | None = Field(default=None, max_length=FAVORITES_MAX)
    history_enabled: bool | None = None

    @field_validator("favorites")
    @classmethod
    def check_favorites(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else _tool_ids(value)


@router.get("/prefs")
def get_prefs(user: ToolsUser, db: DbDep) -> PrefsOut:
    """Favoriten, zuletzt genutzte Tools und ob der Verlauf gespeichert wird."""
    prefs = db.get(ToolPrefs, user.user_id)
    if prefs is None:
        return PrefsOut(favorites=[], recent=[], history_enabled=True)
    return _prefs_out(prefs)


@router.put("/prefs")
def put_prefs(body: PrefsIn, user: ToolsUser, db: DbDep) -> PrefsOut:
    """Speichert Favoriten und ob der Verlauf gespeichert wird."""
    prefs = _prefs(db, user)
    if body.favorites is not None:
        prefs.favorites = body.favorites
    if body.history_enabled is not None:
        prefs.history_enabled = body.history_enabled
    db.commit()
    return _prefs_out(prefs)


class RecentIn(BaseModel):
    tool: str = Field(max_length=60)

    @field_validator("tool")
    @classmethod
    def check_tool(cls, value: str) -> str:
        return _tool_ids([value])[0]


@router.post("/recent")
def add_recent(body: RecentIn, user: ToolsUser, db: DbDep) -> PrefsOut:
    """Merkt ein geöffnetes Tool vor; die letzten sechs bleiben."""
    prefs = _prefs(db, user)
    prefs.recent = [body.tool, *[t for t in (prefs.recent or []) if t != body.tool]][:RECENT_MAX]
    db.commit()
    return _prefs_out(prefs)


class HistoryIn(BaseModel):
    tool: str = Field(max_length=60)
    params: dict[str, str] = Field(max_length=PARAMS_MAX)

    @field_validator("tool")
    @classmethod
    def check_tool(cls, value: str) -> str:
        return _tool_ids([value])[0]

    @field_validator("params")
    @classmethod
    def check_params(cls, value: dict[str, str]) -> dict[str, str]:
        for key, text in value.items():
            if not PARAM_KEY.match(key) or len(text) > VALUE_MAX:
                raise ValueError("Ungültige Einstellung.")
        return {key: text for key, text in value.items() if text.strip()}


class HistoryOut(BaseModel):
    id: int
    tool: str
    params: dict[str, str]
    summary: str
    created_at: datetime


def _history_out(row: ToolHistory) -> HistoryOut:
    params = row.params if isinstance(row.params, dict) else {}
    return HistoryOut(
        id=row.id,
        tool=row.tool,
        params={str(k): str(v) for k, v in params.items()},
        summary=row.summary,
        created_at=row.created_at,
    )


class HistorySaved(BaseModel):
    # None, wenn der Verlauf ausgeschaltet ist oder es nichts zu speichern gab
    entry: HistoryOut | None


@router.post("/history")
def add_history(body: HistoryIn, user: ToolsUser, db: DbDep) -> HistorySaved:
    """Speichert die Einstellungen eines Tools; dieselben wie zuletzt werden nur aufgefrischt."""
    prefs = db.get(ToolPrefs, user.user_id)
    if (prefs is not None and not prefs.history_enabled) or not body.params:
        return HistorySaved(entry=None)
    now = now_utc()
    last = db.scalars(
        select(ToolHistory)
        .where(ToolHistory.user_id == user.user_id, ToolHistory.tool == body.tool)
        .order_by(ToolHistory.created_at.desc(), ToolHistory.id.desc())
        .limit(1)
    ).first()
    if last is not None and last.params == body.params:
        last.created_at = now
        row = last
    else:
        row = ToolHistory(
            user_id=user.user_id,
            tool=body.tool,
            params=body.params,
            summary=summarize(body.params),
            created_at=now,
        )
        db.add(row)
    db.flush()
    _trim(db, user, now)
    db.commit()
    return HistorySaved(entry=_history_out(row))


def _trim(db: Session, user: CurrentUser, now: datetime) -> None:
    """Höchstens 200 Einträge und 90 Tage je Person."""
    db.execute(
        delete(ToolHistory).where(
            ToolHistory.user_id == user.user_id,
            ToolHistory.created_at < now - timedelta(days=HISTORY_DAYS),
        )
    )
    keep = (
        select(ToolHistory.id)
        .where(ToolHistory.user_id == user.user_id)
        .order_by(ToolHistory.created_at.desc(), ToolHistory.id.desc())
        .limit(HISTORY_MAX)
    )
    db.execute(
        delete(ToolHistory).where(ToolHistory.user_id == user.user_id, ToolHistory.id.not_in(keep))
    )


@router.get("/history")
def list_history(
    user: ToolsUser,
    db: DbDep,
    tool: str | None = Query(default=None, max_length=60),
    limit: int = Query(default=50, ge=1, le=LIST_MAX),
) -> list[HistoryOut]:
    """Eigener Verlauf, neueste zuerst; wahlweise nur eines Tools."""
    query = select(ToolHistory).where(ToolHistory.user_id == user.user_id)
    if tool is not None:
        if not TOOL_ID.match(tool):
            raise HTTPException(status_code=422, detail="Unbekannte Kennung eines Tools.")
        query = query.where(ToolHistory.tool == tool)
    rows = db.scalars(
        query.order_by(ToolHistory.created_at.desc(), ToolHistory.id.desc()).limit(limit)
    )
    return [_history_out(row) for row in rows]


class DeletedOut(BaseModel):
    deleted: int


@router.delete("/history/{entry_id}")
def delete_entry(user: ToolsUser, db: DbDep, entry_id: int = Path(ge=1)) -> DeletedOut:
    """Löscht einen eigenen Eintrag."""
    row = db.get(ToolHistory, entry_id)
    if row is None or row.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    db.delete(row)
    db.commit()
    return DeletedOut(deleted=1)


@router.delete("/history")
def delete_history(
    user: ToolsUser, db: DbDep, tool: str | None = Query(default=None, max_length=60)
) -> DeletedOut:
    """Löscht den eigenen Verlauf, wahlweise nur eines Tools."""
    query = delete(ToolHistory).where(ToolHistory.user_id == user.user_id)
    if tool is not None:
        if not TOOL_ID.match(tool):
            raise HTTPException(status_code=422, detail="Unbekannte Kennung eines Tools.")
        query = query.where(ToolHistory.tool == tool)
    result = db.execute(query)
    db.commit()
    return DeletedOut(deleted=int(getattr(result, "rowcount", 0) or 0))
