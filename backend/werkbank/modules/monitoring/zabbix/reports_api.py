"""Berichte der Quelle Zabbix: Verfügbarkeit je Geschäftsjahr, Export als CSV.

Lesen dürfen `Monitoring.Reader`, `Werkbank.Admin` und `Monitoring.Berichte`. Wer nur
`Monitoring.Berichte` hat, sieht Summen je Standort oder Gruppe, keine Hostnamen und keine
Auslöser.
"""

import csv
import io
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.core.admin_settings import client_ip
from werkbank.core.audit import write_audit
from werkbank.core.audit_api import safe_cell
from werkbank.core.deps import DbDep, require_roles
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.budget.settings import (
    YEAR_MAX,
    YEAR_MIN,
    fiscal_year_name,
    fiscal_year_of,
    fiscal_year_range,
    load_settings,
)
from werkbank.modules.monitoring.zabbix.config import load_options
from werkbank.modules.monitoring.zabbix.models import (
    ZbxDowntime,
    ZbxOutage,
    ZbxReportDay,
    ZbxStatus,
    ZbxTriggerStat,
)
from werkbank.modules.monitoring.zabbix.reports import REPORT_TZ, local_day

router = APIRouter(prefix="/api/monitoring/zabbix/reports")
MODULE = "monitoring"

ReportUser = Annotated[
    CurrentUser,
    Depends(require_roles(Role.MONITORING_READER, Role.MONITORING_REPORTS, Role.WERKBANK_ADMIN)),
]
Split = Literal["standort", "gruppe"]
NO_SITE = "ohne Standort"
NO_GROUP = "ohne Hostgruppe"
TOP = 10
MONTHS = ("Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez")


def _detail(user: CurrentUser) -> bool:
    """Hostnamen und Auslöser nur für Monitoring.Reader und Admins."""
    return user.has_any_role(Role.MONITORING_READER, Role.WERKBANK_ADMIN)


@dataclass
class _Sum:
    hosts: set[str] = field(default_factory=set)
    monitored: int = 0
    maintenance: int = 0
    downtime: int = 0
    months: dict[date, _Sum] = field(default_factory=dict)

    def add(self, row: ZbxDowntime, month: date | None) -> None:
        if row.monitored_s <= 0:
            return
        self.hosts.add(row.hostid)
        self.monitored += row.monitored_s
        self.maintenance += row.maintenance_s
        self.downtime += row.downtime_s
        if month is not None:
            self.months.setdefault(month, _Sum()).add(row, None)

    def availability(self) -> float | None:
        base = self.monitored - self.maintenance
        if base <= 0:
            return None
        return round(100 * (1 - self.downtime / base), 3)


class YearOut(BaseModel):
    year: int
    name: str


class MonthOut(BaseModel):
    month: str
    label: str
    availability: float | None
    downtime_s: int


class RowOut(BaseModel):
    name: str
    hosts: int
    availability: float | None
    downtime_s: int
    maintenance_s: int
    months: list[float | None]


class TriggerOut(BaseModel):
    name: str
    host: str
    count: int
    duration_s: int


class OutageOut(BaseModel):
    host: str
    site: str | None
    name: str
    started_at: datetime
    ended_at: datetime | None
    duration_s: int


class ReportOut(BaseModel):
    year_label: str
    years: list[YearOut]
    year: int
    name: str
    first_day: date
    last_day: date
    since: date | None
    days: int
    target: float
    split: Split
    availability: float | None
    downtime_s: int
    maintenance_s: int
    hosts: int
    months: list[MonthOut]
    rows: list[RowOut]
    detail: bool
    triggers: list[TriggerOut] | None
    outages: list[OutageOut] | None


def _months(first: date) -> list[date]:
    out: list[date] = []
    current = first.replace(day=1)
    for _ in range(12):
        out.append(current)
        current = (current + timedelta(days=32)).replace(day=1)
    return out


def _keys(row: ZbxDowntime, split: Split) -> Iterable[str]:
    if split == "standort":
        return [row.site or NO_SITE]
    groups = [str(group) for group in row.groups or [] if group]
    return groups or [NO_GROUP]


def build_report(db: Session, user: CurrentUser, year: int | None, split: Split) -> ReportOut:
    settings = load_settings(db)
    options = load_options(db)
    status = db.get(ZbxStatus, 1)
    since = status.reports_since if status is not None else None
    today = local_day(now_utc())
    current = fiscal_year_of(today, settings.start_month)
    first_year = fiscal_year_of(since, settings.start_month) if since else current
    years = list(range(current, min(first_year, current) - 1, -1))
    chosen = year if year is not None and year in years else current
    first, last = fiscal_year_range(chosen, settings.start_month)
    months = _months(first)

    overall = _Sum()
    groups: dict[str, _Sum] = {}
    for row in db.scalars(
        select(ZbxDowntime).where(ZbxDowntime.day >= first, ZbxDowntime.day <= last)
    ):
        month = row.day.replace(day=1)
        overall.add(row, month)
        for key in _keys(row, split):
            groups.setdefault(key, _Sum()).add(row, month)
    days = (
        db.scalar(
            select(func.count())
            .select_from(ZbxReportDay)
            .where(ZbxReportDay.day >= first, ZbxReportDay.day <= last)
        )
        or 0
    )

    detail = _detail(user)
    triggers: list[TriggerOut] | None = None
    outages: list[OutageOut] | None = None
    if detail:
        stats = db.execute(
            select(
                ZbxTriggerStat.triggerid,
                ZbxTriggerStat.hostid,
                func.max(ZbxTriggerStat.name),
                func.max(ZbxTriggerStat.host),
                func.sum(ZbxTriggerStat.count),
                func.sum(ZbxTriggerStat.duration_s),
            )
            .where(ZbxTriggerStat.month >= first, ZbxTriggerStat.month <= last)
            .group_by(ZbxTriggerStat.triggerid, ZbxTriggerStat.hostid)
            .order_by(func.sum(ZbxTriggerStat.count).desc(), func.max(ZbxTriggerStat.name))
            .limit(TOP)
        ).all()
        triggers = [
            TriggerOut(name=name, host=host, count=int(count), duration_s=int(duration))
            for _, _, name, host, count, duration in stats
        ]
        start = datetime.combine(first, time(0), REPORT_TZ)
        end = datetime.combine(last + timedelta(days=1), time(0), REPORT_TZ)
        now = now_utc()
        candidates = db.scalars(
            select(ZbxOutage).where(
                ZbxOutage.started_at < end,
                (ZbxOutage.ended_at.is_(None)) | (ZbxOutage.ended_at > start),
            )
        )
        rows = [
            OutageOut(
                host=item.host,
                site=item.site,
                name=item.name,
                started_at=item.started_at,
                ended_at=item.ended_at,
                duration_s=int(((item.ended_at or now) - item.started_at).total_seconds()),
            )
            for item in candidates
        ]
        outages = sorted(rows, key=lambda item: -item.duration_s)[:TOP]

    return ReportOut(
        year_label=settings.year_label,
        years=[
            YearOut(year=item, name=fiscal_year_name(item, settings.start_month)) for item in years
        ],
        year=chosen,
        name=fiscal_year_name(chosen, settings.start_month),
        first_day=first,
        last_day=last,
        since=since,
        days=int(days),
        target=options.target,
        split=split,
        availability=overall.availability(),
        downtime_s=overall.downtime,
        maintenance_s=overall.maintenance,
        hosts=len(overall.hosts),
        months=[
            MonthOut(
                month=f"{month:%Y-%m}",
                label=f"{MONTHS[month.month - 1]} {month.year}",
                availability=overall.months[month].availability()
                if month in overall.months
                else None,
                downtime_s=overall.months[month].downtime if month in overall.months else 0,
            )
            for month in months
        ],
        rows=[
            RowOut(
                name=name,
                hosts=len(item.hosts),
                availability=item.availability(),
                downtime_s=item.downtime,
                maintenance_s=item.maintenance,
                months=[
                    item.months[month].availability() if month in item.months else None
                    for month in months
                ],
            )
            for name, item in sorted(
                groups.items(),
                key=lambda entry: (entry[0] in (NO_SITE, NO_GROUP), entry[0].lower()),
            )
        ],
        detail=detail,
        triggers=triggers,
        outages=outages,
    )


YearQuery = Annotated[int | None, Query(ge=YEAR_MIN, le=YEAR_MAX)]
SplitQuery = Annotated[Split, Query()]


@router.get("")
def report(
    user: ReportUser, db: DbDep, year: YearQuery = None, split: SplitQuery = "standort"
) -> ReportOut:
    return build_report(db, user, year, split)


def _percent(value: float | None) -> str:
    return "" if value is None else f"{value:.3f}".replace(".", ",")


def _hours(seconds: int) -> str:
    return f"{seconds / 3600:.2f}".replace(".", ",")


@router.get("/export.csv")
def export_csv(
    request: Request,
    user: ReportUser,
    db: DbDep,
    year: YearQuery = None,
    split: SplitQuery = "standort",
) -> Response:
    """Verfügbarkeit je Standort oder Hostgruppe und Monat (Semikolon, UTF-8 mit BOM)."""
    data = build_report(db, user, year, split)
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(
        [
            "Standort" if split == "standort" else "Hostgruppe",
            "Hosts",
            "Verfügbarkeit %",
            "Ausfall h",
            "Wartung h",
            *(f"{month.label} %" for month in data.months),
        ]
    )
    writer.writerow(
        [
            "Gesamt",
            data.hosts,
            _percent(data.availability),
            _hours(data.downtime_s),
            _hours(data.maintenance_s),
            *(_percent(month.availability) for month in data.months),
        ]
    )
    for row in data.rows:
        writer.writerow(
            [
                safe_cell(row.name),
                row.hosts,
                _percent(row.availability),
                _hours(row.downtime_s),
                _hours(row.maintenance_s),
                *(_percent(value) for value in row.months),
            ]
        )
    _audit(db, request, user, data, "csv")
    db.commit()
    filename = f"zabbix-verfuegbarkeit-{data.year}-{split}.csv"
    return Response(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


class PrintIn(BaseModel):
    year: int = Field(ge=YEAR_MIN, le=YEAR_MAX)
    split: Split = "standort"


class PrintedOut(BaseModel):
    ok: bool


@router.post("/printed")
def printed(request: Request, body: PrintIn, user: ReportUser, db: DbDep) -> PrintedOut:
    """Hält fest, dass der Bericht gedruckt oder als PDF gespeichert wurde (Audit)."""
    data = build_report(db, user, body.year, body.split)
    _audit(db, request, user, data, "pdf")
    db.commit()
    return PrintedOut(ok=True)


def _audit(db: Session, request: Request, user: CurrentUser, data: ReportOut, kind: str) -> None:
    write_audit(
        db,
        module=MODULE,
        action="zabbix.bericht_export",
        user_id=user.user_id,
        object_type="bericht",
        object_id=str(data.year),
        ip=client_ip(request),
        details={"format": kind, "jahr": data.year, "aufteilung": data.split},
    )
