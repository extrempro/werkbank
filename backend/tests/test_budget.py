"""IT-Budget: Geschäftsjahr, Einstellungen, Konten, Plan, Übersicht und Rollen."""

from collections.abc import Iterator
from datetime import date

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_m365_api import ORIGIN, client_for
from werkbank.core.models import AppSetting, AuditLog
from werkbank.modules.budget.models import BudgetAccount, BudgetPlan
from werkbank.modules.budget.settings import (
    SETTINGS_KEY,
    fiscal_year_name,
    fiscal_year_of,
    fiscal_year_range,
    load_settings,
)

BASE = "/api/budget"
HEADERS = {"Origin": ORIGIN}


@pytest.fixture
def db(db_session: Session) -> Iterator[Session]:
    def clean() -> None:
        db_session.execute(delete(BudgetPlan))
        db_session.execute(delete(BudgetAccount))
        db_session.execute(delete(AppSetting).where(AppSetting.key == SETTINGS_KEY))
        db_session.commit()

    clean()
    yield db_session
    db_session.rollback()
    clean()


def test_fiscal_year_follows_the_start_month() -> None:
    assert fiscal_year_of(date(2026, 11, 15), 1) == 2026
    assert fiscal_year_of(date(2026, 7, 31), 8) == 2025
    assert fiscal_year_of(date(2026, 8, 1), 8) == 2026
    assert fiscal_year_range(2026, 8) == (date(2026, 8, 1), date(2027, 7, 31))
    assert fiscal_year_range(2027, 3) == (date(2027, 3, 1), date(2028, 2, 29))
    assert fiscal_year_range(2026, 1) == (date(2026, 1, 1), date(2026, 12, 31))
    assert fiscal_year_name(2026, 1) == "2026"
    assert fiscal_year_name(2026, 8) == "2026/27"
    assert fiscal_year_name(2099, 8) == "2099/00"


@pytest.mark.db
def test_settings_fall_back_and_only_managers_change_them(db: Session) -> None:
    assert load_settings(db).start_month == 1
    reader = client_for(["Budget.Reader"], "budget-leser")
    data = reader.get(f"{BASE}/settings").json()
    assert (data["start_month"], data["year_label"], data["cost_center"]) == (
        1,
        "Geschäftsjahr",
        "",
    )
    body = {"start_month": 8, "year_label": " Wirtschaftsjahr ", "cost_center": "4711"}
    assert reader.put(f"{BASE}/settings", json=body, headers=HEADERS).status_code == 403
    editor = client_for(["Budget.Editor"], "budget-it")
    assert editor.put(f"{BASE}/settings", json=body, headers=HEADERS).status_code == 403

    manager = client_for(["Budget.Manager"], "budget-verwalter")
    saved = manager.put(f"{BASE}/settings", json=body, headers=HEADERS).json()
    assert (saved["start_month"], saved["year_label"], saved["cost_center"]) == (
        8,
        "Wirtschaftsjahr",
        "4711",
    )
    assert "/" in saved["current_year_name"]
    for bad in (
        {**body, "start_month": 13},
        {**body, "year_label": "   "},
        {**body, "cost_center": "a\nb"},
    ):
        assert manager.put(f"{BASE}/settings", json=bad, headers=HEADERS).status_code == 422
    db.expire_all()
    entry = db.scalars(
        select(AuditLog).where(AuditLog.action == "budget.einstellungen_geaendert")
    ).first()
    assert entry is not None

    # Unbrauchbare gespeicherte Werte fallen auf den Standard zurück.
    row = db.get(AppSetting, SETTINGS_KEY)
    assert row is not None
    row.value = {"start_month": "acht", "year_label": 5}
    db.commit()
    assert load_settings(db).start_month == 1
    assert load_settings(db).year_label == "Geschäftsjahr"


@pytest.mark.db
def test_accounts_are_managed_by_editors(db: Session) -> None:
    stranger = client_for(["Tenant.Reader"], "budget-fremd")
    for path in ("/settings", "/accounts", "/overview"):
        assert stranger.get(f"{BASE}{path}").status_code == 403

    reader = client_for(["Budget.Reader"], "budget-leser2")
    account = {"number": "6815", "name": "Softwarewartung", "kind": "laufend"}
    assert reader.post(f"{BASE}/accounts", json=account, headers=HEADERS).status_code == 403

    editor = client_for(["Budget.Editor"], "budget-it2")
    created = editor.post(f"{BASE}/accounts", json=account, headers=HEADERS)
    assert created.status_code == 201
    first = created.json()
    assert (first["number"], first["kind"], first["active"], first["note"]) == (
        "6815",
        "laufend",
        True,
        "",
    )
    assert editor.post(f"{BASE}/accounts", json=account, headers=HEADERS).status_code == 409
    for bad in (
        {**account, "number": "0420", "kind": "sonstiges"},
        {**account, "number": " "},
        {**account, "number": "0420", "name": ""},
    ):
        assert editor.post(f"{BASE}/accounts", json=bad, headers=HEADERS).status_code == 422

    second = editor.post(
        f"{BASE}/accounts",
        json={"number": "0420", "name": "Hardware", "kind": "investition", "note": "Server"},
        headers=HEADERS,
    ).json()
    # Sortiert nach Kontonummer
    assert [entry["number"] for entry in reader.get(f"{BASE}/accounts").json()] == ["0420", "6815"]

    url = f"{BASE}/accounts/{second['id']}"
    assert editor.put(url, json={**account}, headers=HEADERS).status_code == 409
    changed = editor.put(
        url,
        json={"number": "0421", "name": "Hardware", "kind": "investition", "active": False},
        headers=HEADERS,
    ).json()
    assert (changed["number"], changed["active"], changed["note"]) == ("0421", False, "")
    assert editor.put(f"{BASE}/accounts/999999", json=account, headers=HEADERS).status_code == 404
    db.expire_all()
    actions = set(db.scalars(select(AuditLog.action).where(AuditLog.module == "budget")).all())
    assert {"budget.konto_angelegt", "budget.konto_geaendert"} <= actions


@pytest.mark.db
def test_plan_and_overview(db: Session) -> None:
    manager = client_for(["Budget.Manager"], "budget-verwalter2")
    manager.put(
        f"{BASE}/settings",
        json={"start_month": 8, "year_label": "Geschäftsjahr", "cost_center": ""},
        headers=HEADERS,
    )
    ids = {}
    for number, name, kind in (
        ("6815", "Softwarewartung", "laufend"),
        ("6820", "Telefonie", "laufend"),
        ("0420", "Hardware", "investition"),
    ):
        response = manager.post(
            f"{BASE}/accounts", json={"number": number, "name": name, "kind": kind}, headers=HEADERS
        )
        ids[number] = response.json()["id"]

    editor = client_for(["Budget.Editor"], "budget-it3")
    entries = [{"account_id": ids["6815"], "amount_cents": 1_190_000}]
    assert (
        editor.put(f"{BASE}/plans/2026", json={"entries": entries}, headers=HEADERS).status_code
        == 403
    )

    manager.put(
        f"{BASE}/plans/2025",
        json={"entries": [{"account_id": ids["6815"], "amount_cents": 1_000_000}]},
        headers=HEADERS,
    )
    data = manager.put(
        f"{BASE}/plans/2026",
        json={
            "entries": [
                {"account_id": ids["6815"], "amount_cents": 1_190_000},
                {"account_id": ids["0420"], "amount_cents": 5_000_050},
            ]
        },
        headers=HEADERS,
    ).json()
    assert (data["year"], data["year_name"]) == (2026, "2026/27")
    assert (data["first_day"], data["last_day"]) == ("2026-08-01", "2027-07-31")
    rows = {row["account"]["number"]: row for row in data["rows"]}
    assert (rows["6815"]["plan_cents"], rows["6815"]["previous_cents"]) == (1_190_000, 1_000_000)
    assert (rows["6820"]["plan_cents"], rows["6820"]["previous_cents"]) == (None, None)
    assert data["plan"] == {
        "running_cents": 1_190_000,
        "investment_cents": 5_000_050,
        "total_cents": 6_190_050,
    }
    assert data["previous"]["total_cents"] == 1_000_000
    assert {2025, 2026} <= {entry["year"] for entry in data["years"]}

    # Nicht genannte Konten bleiben; None entfernt den Plan.
    data = manager.put(
        f"{BASE}/plans/2026",
        json={"entries": [{"account_id": ids["0420"], "amount_cents": None}]},
        headers=HEADERS,
    ).json()
    assert data["plan"]["total_cents"] == 1_190_000

    for bad in (
        [{"account_id": 999_999, "amount_cents": 1}],
        [{"account_id": ids["6815"], "amount_cents": 1}, {"account_id": ids["6815"]}],
    ):
        response = manager.put(f"{BASE}/plans/2026", json={"entries": bad}, headers=HEADERS)
        assert response.status_code == 422
    negative = [{"account_id": ids["6815"], "amount_cents": -1}]
    assert (
        manager.put(f"{BASE}/plans/2026", json={"entries": negative}, headers=HEADERS).status_code
        == 422
    )
    assert (
        manager.put(f"{BASE}/plans/1999", json={"entries": []}, headers=HEADERS).status_code == 422
    )

    # Stillgelegte Konten ohne Plan verschwinden aus der Übersicht, mit Plan bleiben sie.
    for number in ("6820", "6815"):
        manager.put(
            f"{BASE}/accounts/{ids[number]}",
            json={"number": number, "name": "Alt", "kind": "laufend", "active": False},
            headers=HEADERS,
        )
    reader = client_for(["Budget.Reader"], "budget-leser3")
    shown = reader.get(f"{BASE}/overview", params={"year": 2026}).json()
    assert [row["account"]["number"] for row in shown["rows"]] == ["0420", "6815"]
    # Ohne Jahr gilt das laufende Geschäftsjahr.
    current = reader.get(f"{BASE}/overview").json()
    assert current["year"] == current["settings"]["current_year"]
    assert reader.get(f"{BASE}/overview", params={"year": 1999}).status_code == 422

    db.expire_all()
    changes = db.scalars(select(AuditLog).where(AuditLog.action == "budget.plan_geaendert")).all()
    assert len(changes) == 3
