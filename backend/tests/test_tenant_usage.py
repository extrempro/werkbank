"""Tenant: Nutzung der Dienste (Berichte lesen, speichern, API)."""

from datetime import date, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_m365_api import ORIGIN, client_for
from werkbank.config import Settings
from werkbank.core.sessions import now_utc
from werkbank.modules.m365_config.utcm import UtcmClient, UtcmError, check_report_url
from werkbank.modules.tenant.models import TenantUsageDay, TenantUsagePeriod
from werkbank.modules.tenant.usage import (
    FETCH_USAGE,
    fetch_usage,
    parse_daily_counts,
    parse_period_counts,
)
from werkbank.worker.tasks import build_registry

DOWNLOAD = "https://reports.office.com/data/download/beispiel"
SERVICES_HEADER = (
    "﻿Report Refresh Date,Exchange Active,Exchange Inactive,OneDrive Active,"
    "OneDrive Inactive,SharePoint Active,SharePoint Inactive,Skype For Business Active,"
    "Skype For Business Inactive,Yammer Active,Yammer Inactive,Teams Active,Teams Inactive,"
    "Office 365 Active,Office 365 Inactive,Report Period"
)
DAILY_HEADER = (
    "Report Refresh Date,Office 365,Exchange,OneDrive,SharePoint,Skype For Business,Yammer,"
    "Teams,Report Date,Report Period"
)


def services_csv(days: int) -> str:
    return f"{SERVICES_HEADER}\n2026-11-15,{days},10,8,12,7,13,0,20,1,19,9,11,10,10,{days}\n"


def daily_csv(today: date) -> str:
    lines = [DAILY_HEADER]
    for offset in range(3):
        day = today - timedelta(days=2 + offset)
        lines.append(f"2026-11-15,{10 + offset},{9 + offset},8,7,,1,6,{day.isoformat()},180")
    lines.append("2026-11-15,,,,,,,,kein-datum,180")
    return "\n".join(lines) + "\n"


class ReportGraph:
    def __init__(self, today: date) -> None:
        self.today = today
        self.download_auth: list[str | None] = []
        self.pending: str = ""

    def handler(self, request: httpx.Request) -> httpx.Response:
        if request.url.host == "reports.office.com":
            self.download_auth.append(request.headers.get("authorization"))
            return httpx.Response(200, content=self.pending.encode("utf-8"))
        path = request.url.path
        if "getOffice365ServicesUserCounts" in path:
            days = int(path.split("'D")[1].split("'")[0])
            self.pending = services_csv(days)
        elif "getOffice365ActiveUserCounts" in path:
            self.pending = daily_csv(self.today)
        else:
            return httpx.Response(404)
        return httpx.Response(302, headers={"Location": DOWNLOAD})

    def client(self) -> UtcmClient:
        return UtcmClient(httpx.Client(transport=httpx.MockTransport(self.handler)), lambda: "t")


@pytest.fixture
def db(migrated_db: None, db_session: Session) -> Session:
    db_session.execute(delete(TenantUsageDay))
    db_session.execute(delete(TenantUsagePeriod))
    db_session.commit()
    return db_session


def test_parse_period_counts() -> None:
    report_date, counts = parse_period_counts(services_csv(30))
    assert report_date == date(2026, 11, 15)
    assert counts["exchange"] == (30, 10)
    assert counts["vivaengage"] == (1, 19)
    assert counts["teams"] == (9, 11)
    assert set(counts) == {"exchange", "onedrive", "sharepoint", "teams", "vivaengage"}
    assert parse_period_counts("") == (None, {})


def test_parse_daily_counts_skips_empty_values_and_bad_dates() -> None:
    today = date(2026, 11, 17)
    daily = parse_daily_counts(daily_csv(today))
    assert len(daily) == 3
    first = daily[today - timedelta(days=2)]
    assert first == {"exchange": 9, "onedrive": 8, "sharepoint": 7, "vivaengage": 1, "teams": 6}


def test_report_url_only_microsoft() -> None:
    assert check_report_url(DOWNLOAD) == DOWNLOAD
    for bad in (
        "http://reports.office.com/x",
        "https://reports.office.com.example.com/x",
        "https://example.com/x",
        "",
    ):
        with pytest.raises(UtcmError):
            check_report_url(bad)


def test_report_redirect_to_other_host_is_refused() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(302, headers={"Location": "https://example.com/abfluss"})

    client = UtcmClient(httpx.Client(transport=httpx.MockTransport(handler)), lambda: "t")
    with pytest.raises(UtcmError):
        client.report_csv("getOffice365ServicesUserCounts", "D7")
    with pytest.raises(UtcmError):
        client.report_csv("getOffice365ActiveUserDetail", "D7")


def test_job_only_when_enabled() -> None:
    base: dict[str, Any] = {
        "public_url": ORIGIN,
        "environment": "test",
        "entra_tenant_id": "00000000-0000-0000-0000-00000000aaaa",
        "collector_client_id": "00000000-0000-0000-0000-00000000cccc",
    }
    assert FETCH_USAGE not in build_registry(Settings(**base))
    assert FETCH_USAGE in build_registry(Settings(**base, tenant_usage_enabled=True))


@pytest.mark.db
def test_fetch_stores_sums_without_token_on_download(db: Session) -> None:
    now = now_utc()
    graph = ReportGraph(now.date())
    result = fetch_usage(db, graph.client(), now)
    assert result.periods == 4 * 5
    assert result.days == 3 * 5
    # Die vorab angemeldete Download-Adresse bekommt kein Token
    assert graph.download_auth == [None] * 5
    row = db.get(TenantUsagePeriod, (90, "exchange"))
    assert row is not None and (row.active, row.inactive) == (90, 10)
    days = db.scalars(select(TenantUsageDay).where(TenantUsageDay.service == "teams")).all()
    assert sorted(day.active for day in days) == [6, 6, 6]
    # Erneuter Abruf überschreibt, statt doppelt zu speichern
    fetch_usage(db, graph.client(), now)
    assert len(db.scalars(select(TenantUsageDay)).all()) == 15


@pytest.mark.db
def test_usage_api(db: Session) -> None:
    now = now_utc()
    fetch_usage(db, ReportGraph(now.date()).client(), now)
    client = client_for(["Tenant.Reader"], "oid-nutzung")
    response = client.get("/api/tenant/usage", params={"days": 7})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["days"] == 7
    assert body["report_date"] == "2026-11-15"
    exchange = body["services"][0]
    assert (exchange["name"], exchange["active"], exchange["inactive"]) == ("Exchange", 7, 10)
    assert [service["service"] for service in body["services"]] == [
        "exchange",
        "onedrive",
        "sharepoint",
        "teams",
        "vivaengage",
    ]
    assert len(body["history"]) == 3
    assert body["history"][0]["values"]["exchange"] == 11
    assert client.get("/api/tenant/usage", params={"days": 14}).status_code == 422


@pytest.mark.db
def test_usage_api_needs_tenant_reader(db: Session) -> None:
    client = client_for(["Config.Reader"], "oid-nutzung-403")
    assert client.get("/api/tenant/usage").status_code == 403
