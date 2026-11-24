"""Audit-Log ansehen und exportieren (spec.md 6.6, 10)."""

import csv
import io
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import Select, select

from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, require_recent_login, require_roles
from werkbank.core.models import AuditLog, User
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser

router = APIRouter(prefix="/api")

AuditReader = Annotated[CurrentUser, Depends(require_roles(Role.WERKBANK_ADMIN))]
# Verwaltung: nur Admin und nur kurz nach einer Anmeldung (Step-up)
AdminUser = Annotated[CurrentUser, Depends(require_recent_login(Role.WERKBANK_ADMIN))]

ModuleFilter = Annotated[str | None, Query(max_length=64)]
ActionFilter = Annotated[str | None, Query(max_length=128)]
DateFilter = Annotated[date | None, Query()]

EXPORT_LIMIT = 10_000


class AuditEntryOut(BaseModel):
    id: int
    occurred_at: datetime
    user: str | None
    module: str
    action: str
    object_type: str | None
    object_id: str | None
    result: str
    origin: str | None
    details: dict[str, Any] | None


class AuditListOut(BaseModel):
    entries: list[AuditEntryOut]
    has_more: bool


def _query(
    module: str | None, action: str | None, since: date | None, until: date | None
) -> Select[AuditLog, str]:
    """Gefilterte Abfrage, neueste zuerst. Datumsgrenzen in UTC, „bis“ einschließlich."""
    query = select(AuditLog, User.display_name).outerjoin(User, User.id == AuditLog.user_id)
    if module:
        query = query.where(AuditLog.module == module)
    if action:
        query = query.where(AuditLog.action.contains(action, autoescape=True))
    if since:
        query = query.where(AuditLog.occurred_at >= datetime.combine(since, time.min, UTC))
    if until:
        end = datetime.combine(until + timedelta(days=1), time.min, UTC)
        query = query.where(AuditLog.occurred_at < end)
    return query.order_by(AuditLog.id.desc())


def _to_out(entry: AuditLog, display_name: str | None) -> AuditEntryOut:
    return AuditEntryOut(
        id=entry.id,
        occurred_at=entry.occurred_at,
        user=display_name,
        module=entry.module,
        action=entry.action,
        object_type=entry.object_type,
        object_id=entry.object_id,
        result=entry.result,
        origin=entry.ip_truncated,
        details=entry.details,
    )


@router.get("/audit")
def list_audit(
    user: AuditReader,
    db: DbDep,
    module: ModuleFilter = None,
    action: ActionFilter = None,
    since: DateFilter = None,
    until: DateFilter = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
) -> AuditListOut:
    """Audit-Einträge seitenweise (nur Admin)."""
    rows = db.execute(_query(module, action, since, until).limit(limit + 1).offset(offset)).all()
    entries = [_to_out(entry, name) for entry, name in rows[:limit]]
    return AuditListOut(entries=entries, has_more=len(rows) > limit)


def safe_cell(value: object) -> str:
    """Schützt vor Formel-Injektion beim Öffnen der CSV in Tabellenprogrammen."""
    text = "" if value is None else str(value)
    if text[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text
    return text


@router.get("/audit/export.csv")
def export_audit(
    request: Request,
    user: AuditReader,
    db: DbDep,
    module: ModuleFilter = None,
    action: ActionFilter = None,
    since: DateFilter = None,
    until: DateFilter = None,
) -> Response:
    """Audit-Einträge als CSV (höchstens 10 000). Der Export selbst wird protokolliert."""
    rows = db.execute(_query(module, action, since, until).limit(EXPORT_LIMIT)).all()
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(
        [
            "Zeitpunkt (UTC)",
            "Person",
            "Modul",
            "Aktion",
            "Ergebnis",
            "Objekt",
            "Objekt-ID",
            "Herkunft (gekürzte IP)",
        ]
    )
    for entry, name in rows:
        writer.writerow(
            [
                safe_cell(entry.occurred_at.astimezone(UTC).isoformat()),
                safe_cell(name),
                safe_cell(entry.module),
                safe_cell(entry.action),
                safe_cell(entry.result),
                safe_cell(entry.object_type),
                safe_cell(entry.object_id),
                safe_cell(entry.ip_truncated),
            ]
        )
    write_audit(
        db,
        module="kern",
        action="audit.export",
        user_id=user.user_id,
        ip=request.client.host if request.client else None,
        details={
            "anzahl": len(rows),
            "filter": {
                "modul": module,
                "aktion": action,
                "von": since.isoformat() if since else None,
                "bis": until.isoformat() if until else None,
            },
        },
    )
    db.commit()
    filename = f"werkbank-audit-{datetime.now(UTC):%Y%m%d-%H%M}.csv"
    return Response(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
