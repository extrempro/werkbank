"""API der Seite „Nutzung“: aktive und inaktive Benutzer je Dienst, nur Summen."""

from datetime import date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select

from werkbank.core.deps import DbDep, SettingsDep, require_roles
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser
from werkbank.modules.tenant.models import TenantUsageDay, TenantUsagePeriod
from werkbank.modules.tenant.usage import PERIODS, SERVICES

router = APIRouter(prefix="/api/tenant/usage")

Reader = Annotated[CurrentUser, Depends(require_roles(Role.TENANT_READER))]
Period = Annotated[int, Query(ge=1, le=366)]


class ServiceUsageOut(BaseModel):
    service: str
    name: str
    active: int | None
    inactive: int | None


class UsageDayOut(BaseModel):
    day: date
    # Dienst -> aktive Benutzer; fehlt ein Dienst, gab es für den Tag keinen Wert
    values: dict[str, int]


class UsageOut(BaseModel):
    # False: Der Abruf ist in dieser Installation nicht eingeschaltet.
    enabled: bool
    days: int
    fetched_at: datetime | None
    # Stand der Berichte bei Microsoft (meist zwei Tage vor dem Abruf)
    report_date: date | None
    services: list[ServiceUsageOut]
    history: list[UsageDayOut]


@router.get("")
def get_usage(user: Reader, db: DbDep, settings: SettingsDep, days: Period = 30) -> UsageOut:
    """Summen je Dienst für den Zeitraum und aktive Benutzer je Tag in diesem Zeitraum."""
    if days not in PERIODS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Zeitraum: 7, 30, 90 oder 180 Tage",
        )
    rows = {
        row.service: row
        for row in db.scalars(select(TenantUsagePeriod).where(TenantUsagePeriod.days == days))
    }
    services = [
        ServiceUsageOut(
            service=service,
            name=name,
            active=rows[service].active if service in rows else None,
            inactive=rows[service].inactive if service in rows else None,
        )
        for service, (name, _) in SERVICES.items()
    ]
    history: list[UsageDayOut] = []
    last = db.scalar(select(func.max(TenantUsageDay.day)))
    if last is not None:
        by_day: dict[date, dict[str, int]] = {}
        for sample in db.scalars(
            select(TenantUsageDay)
            .where(TenantUsageDay.day > last - timedelta(days=days))
            .order_by(TenantUsageDay.day)
        ):
            if sample.service in SERVICES:
                by_day.setdefault(sample.day, {})[sample.service] = sample.active
        history = [UsageDayOut(day=day, values=values) for day, values in by_day.items()]
    return UsageOut(
        enabled=settings.tenant_usage_enabled and settings.collector_configured,
        days=days,
        fetched_at=max((row.fetched_at for row in rows.values()), default=None),
        report_date=max(
            (row.report_date for row in rows.values() if row.report_date), default=None
        ),
        services=services,
        history=history,
    )
