"""Nutzung der Dienste: aktive und inaktive Benutzer je Dienst, nur als Summen.

Quelle sind die Nutzungsberichte von Microsoft 365 (Reports.Read.All):
- getOffice365ServicesUserCounts je Zeitraum (7, 30, 90, 180 Tage): aktiv und inaktiv je Dienst,
- getOffice365ActiveUserCounts über 180 Tage: aktive Benutzer je Dienst und Tag.
Die Werkbank liest keine Berichte mit Personen (…UserDetail). Microsoft liefert die Berichte mit
etwa zwei Tagen Verzug; die Tage bleiben drei Jahre.
"""

import csv
import io
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.sessions import now_utc
from werkbank.modules.m365_config.utcm import UtcmClient, graph_token_provider
from werkbank.modules.tenant.models import TenantUsageDay, TenantUsagePeriod

FETCH_USAGE = "tenant.nutzung"
HTTP_TIMEOUT_SECONDS = 60.0
RETENTION_DAYS = 3 * 365
# Microsoft erneuert die Berichte einmal am Tag
USAGE_INTERVAL = timedelta(hours=12)
# Zeiträume in Tagen, wie Microsoft sie anbietet
PERIODS = (7, 30, 90, 180)

# Kennung in der Werkbank -> (Name, Spaltenname bei Microsoft); in dieser Reihenfolge
SERVICES: dict[str, tuple[str, str]] = {
    "exchange": ("Exchange", "Exchange"),
    "onedrive": ("OneDrive", "OneDrive"),
    "sharepoint": ("SharePoint", "SharePoint"),
    "teams": ("Teams", "Teams"),
    "vivaengage": ("Viva Engage", "Yammer"),
}


@dataclass(frozen=True)
class UsageResult:
    periods: int = 0
    days: int = 0
    removed: int = 0


def _rows(text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    return [
        {(key or "").strip(): (value or "").strip() for key, value in row.items()} for row in reader
    ]


def _count(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        number = int(float(value))
    except ValueError:
        return None
    return number if number >= 0 else None


def _day(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def parse_period_counts(text: str) -> tuple[date | None, dict[str, tuple[int, int]]]:
    """Aktiv und inaktiv je Dienst aus getOffice365ServicesUserCounts."""
    rows = _rows(text)
    if not rows:
        return None, {}
    row = rows[0]
    counts: dict[str, tuple[int, int]] = {}
    for service, (_, column) in SERVICES.items():
        active = _count(row.get(f"{column} Active"))
        inactive = _count(row.get(f"{column} Inactive"))
        if active is not None and inactive is not None:
            counts[service] = (active, inactive)
    return _day(row.get("Report Refresh Date")), counts


def parse_daily_counts(text: str) -> dict[date, dict[str, int]]:
    """Aktive Benutzer je Tag und Dienst aus getOffice365ActiveUserCounts."""
    result: dict[date, dict[str, int]] = {}
    for row in _rows(text):
        day = _day(row.get("Report Date"))
        if day is None:
            continue
        values = {
            service: number
            for service, (_, column) in SERVICES.items()
            if (number := _count(row.get(column))) is not None
        }
        if values:
            result[day] = values
    return result


def fetch_usage(db: Session, client: UtcmClient, now: datetime | None = None) -> UsageResult:
    """Liest die Summen je Zeitraum und den Verlauf je Tag."""
    moment = now or now_utc()
    periods = 0
    for days in PERIODS:
        report_date, counts = parse_period_counts(
            client.report_csv("getOffice365ServicesUserCounts", f"D{days}")
        )
        for service, (active, inactive) in counts.items():
            row = db.get(TenantUsagePeriod, (days, service))
            if row is None:
                row = TenantUsagePeriod(days=days, service=service)
                db.add(row)
            row.active = active
            row.inactive = inactive
            row.report_date = report_date
            row.fetched_at = moment
            periods += 1

    daily = parse_daily_counts(client.report_csv("getOffice365ActiveUserCounts", "D180"))
    stored = 0
    for day, values in daily.items():
        for service, active in values.items():
            row = db.get(TenantUsageDay, (day, service))
            if row is None:
                row = TenantUsageDay(day=day, service=service)
                db.add(row)
            row.active = active
            stored += 1

    limit = moment.date() - timedelta(days=RETENTION_DAYS)
    removed = len(db.scalars(select(TenantUsageDay.day).where(TenantUsageDay.day < limit)).all())
    if removed:
        db.execute(delete(TenantUsageDay).where(TenantUsageDay.day < limit))
    db.commit()
    return UsageResult(periods=periods, days=stored, removed=removed)


def fetch_usage_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    """Regelmäßiger Abruf. Ohne Reports.Read.All schlägt der Auftrag fehl."""
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False) as http:
        fetch_usage(db, UtcmClient(http, graph_token_provider(settings)))
