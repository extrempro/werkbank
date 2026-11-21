"""IT-Budget, Statistik: Überblick eines Geschäftsjahrs, Jahresvergleich und Tags je Jahr."""

from datetime import UTC, date, datetime
from typing import Any

import pytest
from sqlalchemy.orm import Session

from tests.test_budget import BASE, HEADERS, db, post  # noqa: F401
from tests.test_m365_api import client_for
from werkbank.modules.budget import api as budget_api
from werkbank.modules.budget.models import BudgetContract
from werkbank.modules.budget.statistics import (
    cutoff_for,
    elapsed_months,
    fiscal_month,
    same_day_in,
)

TODAY = datetime(2026, 11, 21, 10, 0, tzinfo=UTC)


def test_dates_for_the_comparison() -> None:
    assert same_day_in(date(2028, 2, 29), 2027) == date(2027, 2, 28)
    assert same_day_in(date(2026, 11, 21), 2025) == date(2025, 11, 21)
    assert cutoff_for(date(2026, 11, 21), 2026, 2024) == date(2024, 11, 21)
    # Im Juli (letzter Monat ab August) liegt der Stichtag im folgenden Kalenderjahr.
    assert cutoff_for(date(2027, 7, 1), 2026, 2025) == date(2026, 7, 1)
    assert fiscal_month(date(2026, 8, 1), 8) == 0
    assert fiscal_month(date(2027, 7, 31), 8) == 11
    assert fiscal_month(date(2026, 3, 5), 1) == 2
    assert elapsed_months(2025, 2026, date(2026, 11, 21), 8) == 12
    assert elapsed_months(2027, 2026, date(2026, 11, 21), 8) == 0
    assert elapsed_months(2026, 2026, date(2026, 11, 21), 8) == 4


def invoice(client: Any, partner: int, item: int, day: str, net: int, number: str) -> None:
    response = post(
        client,
        "/invoices",
        {
            "invoicer_id": partner,
            "number": number,
            "invoice_date": day,
            "lines": [{"item_id": item, "net_cents": net, "description": "Test"}],
        },
    )
    assert response.status_code == 201, response.text


@pytest.mark.db
def test_summary_compare_and_tags(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    monkeypatch.setattr(budget_api, "now_utc", lambda: TODAY)
    manager = client_for(["Budget.Manager"], "statistik-verwalter")
    reader = client_for(["Budget.Reader"], "statistik-leser")
    assert (
        manager.put(
            f"{BASE}/settings",
            json={"start_month": 8, "year_label": "Spielzeit"},
            headers=HEADERS,
        ).status_code
        == 200
    )
    for tag in ("Lizenz", "Hardware"):
        assert post(manager, "/tags", {"name": tag}).status_code == 201
    software = post(
        manager, "/accounts", {"number": "6815", "name": "Software", "kind": "laufend"}
    ).json()
    hardware = post(
        manager, "/accounts", {"number": "0800", "name": "Hardware", "kind": "investition"}
    ).json()
    first = post(manager, "/partners", {"name": "Beispiel Software GmbH"}).json()
    second = post(manager, "/partners", {"name": "Beispiel Technik AG"}).json()
    licence = post(
        manager,
        "/items",
        {
            "account_id": software["id"],
            "name": "Lizenz",
            "amount_cents": 120_000,
            "start_year": 2024,
            "tags": ["Lizenz"],
        },
    ).json()
    device = post(
        manager,
        "/items",
        {
            "account_id": hardware["id"],
            "name": "Server",
            "amount_cents": 50_000,
            "start_year": 2026,
            "end_year": 2026,
            "tags": ["Hardware", "Lizenz"],
        },
    ).json()
    # Brutto mit 19 %: 10.000 → 11.900, 8.000 → 9.520, 20.000 → 23.800, 5.000 → 5.950
    invoice(manager, first["id"], licence["id"], "2026-09-10", 10_000, "RE-1")
    invoice(manager, second["id"], device["id"], "2026-10-02", 30_000, "RE-2")
    invoice(manager, first["id"], licence["id"], "2025-09-05", 8_000, "RE-3")
    invoice(manager, first["id"], licence["id"], "2026-01-20", 20_000, "RE-4")
    invoice(manager, first["id"], licence["id"], "2024-10-01", 5_000, "RE-5")
    db.add(
        BudgetContract(
            title="Wartung Server",
            partner_id=second["id"],
            starts_on=date(2025, 8, 1),
            ends_on=date(2027, 1, 31),
            renewal_months=12,
            notice_months=1,
            net_cents=100_000,
            tax_rate_bp=0,
            amount_cents=100_000,
            interval="jaehrlich",
        )
    )
    db.commit()

    data = reader.get(f"{BASE}/statistics/summary", params={"compare": 2025}).json()
    assert data["year"] == 2026 and data["year_name"] == "2026/27"
    assert data["year_label"] == "Spielzeit" and data["elapsed_months"] == 4
    assert data["expected_cents"] == 170_000
    assert data["actual_cents"] == 47_600
    assert data["compare_name"] == "2025/26"
    # Gleicher Zeitraum: bis zum 21.11.2025; ganzes Jahr zusätzlich
    assert data["compare_to_date_cents"] == 9_520
    assert data["compare_actual_cents"] == 33_320
    assert [month["name"] for month in data["months"]][:2] == ["August", "September"]
    assert [month["actual_cents"] for month in data["months"]][:3] == [0, 11_900, 35_700]
    assert data["months"][5]["compare_cents"] == 23_800
    assert [(row["name"], row["actual_cents"]) for row in data["partners"]] == [
        ("Beispiel Technik AG", 35_700),
        ("Beispiel Software GmbH", 11_900),
    ]
    by_account = {row["account"]["number"]: row for row in data["accounts"]}
    assert by_account["6815"]["expected_cents"] == 120_000
    assert by_account["0800"]["actual_cents"] == 35_700
    assert data["contracts"]["yearly_cents"] == 100_000
    assert data["contracts"]["soon"] == 1
    assert data["contracts"]["next"][0]["notice_deadline"] == "2026-12-31"
    assert any(entry["year"] == 2016 for entry in data["years"])
    # Vergleich nur mit früheren Jahren; ohne Vergleich bleiben die Felder leer
    assert reader.get(f"{BASE}/statistics/summary", params={"compare": 2026}).status_code == 422
    plain = reader.get(f"{BASE}/statistics/summary", params={"year": 2025}).json()
    assert plain["compare_actual_cents"] is None and plain["months"][0]["compare_cents"] is None
    assert plain["elapsed_months"] == 12 and plain["actual_cents"] == 33_320

    compare = reader.get(f"{BASE}/statistics/compare").json()
    assert [entry["year"] for entry in compare["years"]] == [2022, 2023, 2024, 2025, 2026]
    assert compare["cutoff"] == "2026-11-21"
    values = {
        row["account"]["number"]: {value["year"]: value for value in row["values"]}
        for row in compare["accounts"]
    }
    assert values["6815"][2022]["expected_cents"] == 0
    assert values["6815"][2025] == {
        "year": 2025,
        "expected_cents": 120_000,
        "actual_cents": 33_320,
        "actual_to_date_cents": 9_520,
    }
    assert values["6815"][2024]["actual_to_date_cents"] == 5_950
    earlier = reader.get(f"{BASE}/statistics/compare", params={"year": 2025}).json()
    assert earlier["cutoff"] is None
    assert all(
        value["actual_to_date_cents"] == value["actual_cents"]
        for row in earlier["accounts"]
        for value in row["values"]
    )

    tags = reader.post(
        f"{BASE}/statistics/query",
        json={"tags": ["lizenz", "Hardware"], "mode": "any", "start": 2022},
        headers=HEADERS,
    ).json()
    per_tag = {
        entry["tag"]: {year["year"]: year for year in entry["years"]} for entry in tags["per_tag"]
    }
    assert list(per_tag) == ["Lizenz", "Hardware"]
    assert per_tag["Lizenz"][2026]["actual_cents"] == 47_600
    assert per_tag["Lizenz"][2025]["actual_to_date_cents"] == 9_520
    assert per_tag["Hardware"][2026]["expected_cents"] == 50_000
    assert per_tag["Hardware"][2025]["actual_cents"] == 0
    assert tags["years"][-1]["actual_to_date_cents"] == 47_600

    stranger = client_for(["Tenant.Reader"], "statistik-fremd")
    assert stranger.get(f"{BASE}/statistics/summary").status_code == 403
    assert stranger.get(f"{BASE}/statistics/compare").status_code == 403
