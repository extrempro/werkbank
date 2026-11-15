"""API des Moduls Tenant: Lizenzen und Benutzerzahlen mit Verlauf."""

from datetime import date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select

from werkbank.core.deps import DbDep, SettingsDep, require_roles
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.tenant.models import TenantLicense, TenantLicenseSample, TenantUserSample
from werkbank.modules.tenant.names import license_name

router = APIRouter(prefix="/api/tenant")

Reader = Annotated[CurrentUser, Depends(require_roles(Role.TENANT_READER))]
LicenseId = Annotated[int, Path(ge=1)]
# Zeitraum des Verlaufs in Tagen
Days = Annotated[int, Query(ge=30, le=1095)]


class LicenseOut(BaseModel):
    id: int
    sku_id: str
    part_number: str
    name: str
    applies_to: str | None
    capability_status: str | None
    total: int
    consumed: int
    # Kann negativ sein, wenn mehr zugewiesen als gekauft ist.
    free: int
    warning: int
    suspended: int
    locked_out: int
    next_lifecycle: datetime | None
    trial: bool
    active: bool


class LicenseListOut(BaseModel):
    # False: Der Abruf ist in dieser Installation nicht eingeschaltet.
    enabled: bool
    fetched_at: datetime | None
    total: int
    consumed: int
    entries: list[LicenseOut]


class LicenseSampleOut(BaseModel):
    day: date
    total: int
    consumed: int


class LicenseDetailOut(BaseModel):
    license: LicenseOut
    fetched_at: datetime
    samples: list[LicenseSampleOut]


class UserSampleOut(BaseModel):
    day: date
    total: int
    members: int
    guests: int
    # Aktive Konten (nicht deaktiviert)
    enabled: int
    disabled: int
    guests_disabled: int
    licensed: int | None


class UsersOut(BaseModel):
    enabled: bool
    fetched_at: datetime | None
    current: UserSampleOut | None
    samples: list[UserSampleOut]


def license_out(row: TenantLicense) -> LicenseOut:
    return LicenseOut(
        id=row.id,
        sku_id=row.sku_id,
        part_number=row.part_number,
        name=license_name(row.part_number),
        applies_to=row.applies_to,
        capability_status=row.capability_status,
        total=row.total,
        consumed=row.consumed,
        free=row.total - row.consumed,
        warning=row.warning,
        suspended=row.suspended,
        locked_out=row.locked_out,
        next_lifecycle=row.next_lifecycle,
        trial=row.trial,
        active=row.active,
    )


def user_sample_out(row: TenantUserSample) -> UserSampleOut:
    return UserSampleOut(
        day=row.day,
        total=row.total,
        members=row.total - row.guests,
        guests=row.guests,
        enabled=row.total - row.disabled,
        disabled=row.disabled,
        guests_disabled=row.guests_disabled,
        licensed=row.licensed,
    )


def _since(days: int) -> date:
    return now_utc().date() - timedelta(days=days)


@router.get("/licenses")
def list_licenses(user: Reader, db: DbDep, settings: SettingsDep) -> LicenseListOut:
    rows = db.scalars(select(TenantLicense).where(TenantLicense.active.is_(True))).all()
    entries = sorted(
        (license_out(row) for row in rows), key=lambda entry: (entry.name.lower(), entry.sku_id)
    )
    fetched_at = db.scalar(select(func.max(TenantLicense.fetched_at)))
    return LicenseListOut(
        enabled=settings.tenant_monitor_enabled and settings.collector_configured,
        fetched_at=fetched_at,
        total=sum(entry.total for entry in entries),
        consumed=sum(entry.consumed for entry in entries),
        entries=entries,
    )


@router.get("/licenses/{license_id}")
def get_license(
    user: Reader, db: DbDep, license_id: LicenseId, days: Days = 90
) -> LicenseDetailOut:
    row: TenantLicense | None = db.get(TenantLicense, license_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    samples = db.scalars(
        select(TenantLicenseSample)
        .where(TenantLicenseSample.license_id == row.id, TenantLicenseSample.day >= _since(days))
        .order_by(TenantLicenseSample.day)
    ).all()
    return LicenseDetailOut(
        license=license_out(row),
        fetched_at=row.fetched_at,
        samples=[
            LicenseSampleOut(day=sample.day, total=sample.total, consumed=sample.consumed)
            for sample in samples
        ],
    )


@router.get("/users")
def get_users(user: Reader, db: DbDep, settings: SettingsDep, days: Days = 90) -> UsersOut:
    samples = db.scalars(
        select(TenantUserSample)
        .where(TenantUserSample.day >= _since(days))
        .order_by(TenantUserSample.day)
    ).all()
    latest = db.scalars(
        select(TenantUserSample).order_by(TenantUserSample.day.desc()).limit(1)
    ).first()
    return UsersOut(
        enabled=settings.tenant_monitor_enabled and settings.collector_configured,
        fetched_at=latest.fetched_at if latest else None,
        current=user_sample_out(latest) if latest else None,
        samples=[user_sample_out(sample) for sample in samples],
    )
