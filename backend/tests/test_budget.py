"""IT-Budget: Geschäftsjahr, Einstellungen, Konten, Plan, Übersicht und Rollen."""

from collections.abc import Iterator
from datetime import date, timedelta
from typing import Any

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_m365_api import ORIGIN, client_for
from werkbank.core.models import AppSetting, AuditLog
from werkbank.core.sessions import now_utc
from werkbank.modules.budget.contracts import (
    add_months,
    expected_cents,
    is_running,
    notice_deadline,
    term_end,
)
from werkbank.modules.budget.models import (
    BudgetAccount,
    BudgetContract,
    BudgetPartner,
    BudgetPlan,
)
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
        db_session.execute(delete(BudgetContract))
        db_session.execute(delete(BudgetPartner))
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
    assert data["committed"]["total_cents"] == 0
    assert data["committed_contracts"] == 0
    assert rows["6815"]["committed_cents"] == 0
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


# --- Partner und Verträge ---


def contract(**values: Any) -> BudgetContract:
    data: dict[str, Any] = {
        "title": "Wartung",
        "partner_id": 1,
        "account_id": 1,
        "starts_on": date(2026, 1, 31),
        "ends_on": None,
        "renewal_months": None,
        "notice_months": None,
        "cancelled_to": None,
        "amount_cents": 100,
        "interval": "monatlich",
    }
    data.update(values)
    return BudgetContract(**data)


def test_add_months_keeps_the_day_or_takes_the_last_of_the_month() -> None:
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2024, 2, 29), 12) == date(2025, 2, 28)
    assert add_months(date(2026, 3, 31), -1) == date(2026, 2, 28)
    assert add_months(date(2026, 11, 15), 3) == date(2027, 2, 15)


def test_expected_costs_follow_interval_and_term() -> None:
    year = (date(2026, 8, 1), date(2027, 7, 31))
    assert expected_cents(contract(), *year) == 1200
    assert expected_cents(contract(starts_on=date(2026, 10, 15)), *year) == 1000
    assert expected_cents(contract(starts_on=date(2028, 1, 1)), *year) == 0
    assert expected_cents(contract(interval="jaehrlich", starts_on=date(2020, 9, 1)), *year) == 100
    quarterly = contract(interval="vierteljaehrlich", starts_on=date(2025, 11, 30))
    assert expected_cents(quarterly, *year) == 400
    # Einmalig zählt nur im Jahr des Beginns.
    assert expected_cents(contract(interval="einmalig", starts_on=date(2026, 9, 1)), *year) == 100
    assert expected_cents(contract(interval="einmalig", starts_on=date(2025, 9, 1)), *year) == 0
    # Befristet endet, mit Verlängerung läuft er weiter, gekündigt endet er zum Kündigungstag.
    ending = {"ends_on": date(2026, 12, 31)}
    assert expected_cents(contract(**ending), *year) == 500
    assert expected_cents(contract(**ending, renewal_months=12), *year) == 1200
    cancelled = contract(**ending, renewal_months=12, cancelled_to=date(2026, 9, 30))
    assert expected_cents(cancelled, *year) == 200


def test_notice_deadline_and_term_end() -> None:
    today = date(2026, 11, 15)
    fixed = contract(ends_on=date(2027, 3, 31), notice_months=3)
    assert notice_deadline(fixed, today) == date(2026, 12, 31)
    # Für die laufende Laufzeit zu spät: Es gilt der Termin der nächsten.
    renewing = contract(ends_on=date(2026, 12, 31), notice_months=3, renewal_months=12)
    assert notice_deadline(renewing, today) == date(2027, 9, 30)
    old = contract(ends_on=date(2024, 12, 31), notice_months=3, renewal_months=12)
    assert term_end(old, today) == date(2026, 12, 31)
    assert notice_deadline(old, today) == date(2027, 9, 30)
    # Kein Termin: unbefristet, ohne Frist oder schon gekündigt.
    assert notice_deadline(contract(notice_months=3), today) is None
    assert notice_deadline(contract(ends_on=date(2027, 3, 31)), today) is None
    done = contract(ends_on=date(2027, 3, 31), notice_months=3, cancelled_to=date(2027, 3, 31))
    assert notice_deadline(done, today) is None
    assert is_running(done, today) is True
    assert is_running(contract(ends_on=date(2026, 10, 31)), today) is False
    assert is_running(contract(ends_on=date(2026, 10, 31), renewal_months=12), today) is True


@pytest.mark.db
def test_partners_are_managed_by_editors(db: Session) -> None:
    reader = client_for(["Budget.Reader"], "partner-leser")
    body = {"name": "Beispiel Software GmbH", "customer_number": "K-100"}
    assert reader.post(f"{BASE}/partners", json=body, headers=HEADERS).status_code == 403
    assert client_for(["Tenant.Reader"], "partner-fremd").get(f"{BASE}/partners").status_code == 403

    editor = client_for(["Budget.Editor"], "partner-it")
    created = editor.post(f"{BASE}/partners", json=body, headers=HEADERS)
    assert created.status_code == 201
    partner = created.json()
    assert (partner["is_contract_partner"], partner["is_invoicer"], partner["active"]) == (
        True,
        True,
        True,
    )
    duplicate = {"name": "beispiel software gmbh"}
    assert editor.post(f"{BASE}/partners", json=duplicate, headers=HEADERS).status_code == 409
    neither = {"name": "Niemand", "is_contract_partner": False, "is_invoicer": False}
    assert editor.post(f"{BASE}/partners", json=neither, headers=HEADERS).status_code == 422
    assert editor.post(f"{BASE}/partners", json={"name": " "}, headers=HEADERS).status_code == 422

    editor.post(
        f"{BASE}/partners",
        json={"name": "Abrechnung AG", "is_contract_partner": False},
        headers=HEADERS,
    )
    assert [entry["name"] for entry in reader.get(f"{BASE}/partners").json()] == [
        "Abrechnung AG",
        "Beispiel Software GmbH",
    ]
    url = f"{BASE}/partners/{partner['id']}"
    changed = editor.put(url, json={**body, "active": False}, headers=HEADERS).json()
    assert changed["active"] is False
    assert editor.put(url, json={"name": "Abrechnung AG"}, headers=HEADERS).status_code == 409
    assert editor.put(f"{BASE}/partners/999999", json=body, headers=HEADERS).status_code == 404


@pytest.mark.db
def test_contracts_bind_budget_and_raise_tasks(db: Session) -> None:
    manager = client_for(["Budget.Manager"], "vertrag-verwalter")
    account = manager.post(
        f"{BASE}/accounts",
        json={"number": "6815", "name": "Softwarewartung", "kind": "laufend"},
        headers=HEADERS,
    ).json()
    partner = manager.post(
        f"{BASE}/partners", json={"name": "Beispiel Software GmbH"}, headers=HEADERS
    ).json()
    today = now_utc().date()
    year = manager.get(f"{BASE}/settings").json()["current_year"]
    body = {
        "title": "Wartung Zeiterfassung",
        "partner_id": partner["id"],
        "account_id": account["id"],
        "number": "V-1",
        "starts_on": f"{year}-01-01",
        "ends_on": (today + timedelta(days=100)).isoformat(),
        "renewal_months": 12,
        "notice_months": 2,
        "amount_cents": 50_000,
        "interval": "monatlich",
    }
    reader = client_for(["Budget.Reader"], "vertrag-leser")
    assert reader.post(f"{BASE}/contracts", json=body, headers=HEADERS).status_code == 403

    created = manager.post(f"{BASE}/contracts", json=body, headers=HEADERS)
    assert created.status_code == 201, created.text
    first = created.json()
    assert (first["partner_name"], first["account_number"]) == ("Beispiel Software GmbH", "6815")
    assert first["running"] is True
    assert (first["invoicer_id"], first["dpa_status"]) == (None, "nicht_erforderlich")
    assert first["yearly_cents"] == 600_000
    assert first["current_year_cents"] == 600_000
    # Kündigungstermin: zwei Monate vor dem Ende, also in rund 40 Tagen.
    assert first["deadline_soon"] is True
    assert 30 <= first["days_to_deadline"] <= 45

    for bad in (
        {**body, "partner_id": 999_999},
        {**body, "account_id": 999_999},
        {**body, "ends_on": f"{year - 1}-01-01"},
        {**body, "cancelled_to": f"{year - 1}-01-01"},
        {**body, "ends_on": None},
        {**body, "interval": "woechentlich"},
        {**body, "amount_cents": -1},
        {**body, "title": " "},
        {**body, "starts_on": "1999-01-01"},
    ):
        response = manager.post(f"{BASE}/contracts", json=bad, headers=HEADERS)
        assert response.status_code == 422, bad

    # Ein zweiter, einmaliger Vertrag ohne Termin steht hinter dem mit Termin.
    manager.post(
        f"{BASE}/contracts",
        json={
            "title": "Einrichtung",
            "partner_id": partner["id"],
            "account_id": account["id"],
            "starts_on": f"{year}-02-01",
            "amount_cents": 119_000,
            "interval": "einmalig",
        },
        headers=HEADERS,
    )
    listing = reader.get(f"{BASE}/contracts").json()
    assert listing["notice_warn_days"] == 60
    assert [entry["title"] for entry in listing["entries"]] == [
        "Wartung Zeiterfassung",
        "Einrichtung",
    ]

    overview = reader.get(f"{BASE}/overview", params={"year": year}).json()
    row = overview["rows"][0]
    assert row["committed_cents"] == 719_000
    assert overview["committed"] == {
        "running_cents": 719_000,
        "investment_cents": 0,
        "total_cents": 719_000,
    }

    def budget_tasks_of(client: Any) -> list[dict[str, Any]]:
        tasks: list[dict[str, Any]] = client.get("/api/tasks").json()["tasks"]
        return [task for task in tasks if task["module"] == "IT-Budget"]

    assert overview["committed_contracts"] == 2

    # Abweichender Rechnungssteller und fehlender AVV werden gespeichert.
    distributor = manager.post(
        f"{BASE}/partners",
        json={"name": "Beispiel Distribution AG", "is_contract_partner": False},
        headers=HEADERS,
    ).json()
    changed = manager.put(
        f"{BASE}/contracts/{first['id']}",
        json={**body, "invoicer_id": distributor["id"], "dpa_status": "fehlt"},
        headers=HEADERS,
    ).json()
    assert (changed["invoicer_name"], changed["dpa_status"]) == (
        "Beispiel Distribution AG",
        "fehlt",
    )
    same = {**body, "invoicer_id": partner["id"]}
    assert (
        manager.put(f"{BASE}/contracts/{first['id']}", json=same, headers=HEADERS).json()[
            "invoicer_id"
        ]
        is None
    )
    for bad in ({**body, "invoicer_id": 999_999}, {**body, "dpa_status": "vielleicht"}):
        assert manager.post(f"{BASE}/contracts", json=bad, headers=HEADERS).status_code == 422

    assert budget_tasks_of(reader) == []
    tasks = budget_tasks_of(manager)
    assert [(task["count"], task["link"]) for task in tasks] == [(1, "/budget/vertraege")]

    # Gekündigt: kein Termin mehr, keine Aufgabe, Kosten nur bis zum Kündigungstag.
    url = f"{BASE}/contracts/{first['id']}"
    cancelled = manager.put(
        url, json={**body, "cancelled_to": f"{year}-03-31"}, headers=HEADERS
    ).json()
    assert cancelled["notice_deadline"] is None
    assert cancelled["current_year_cents"] == 150_000
    assert budget_tasks_of(manager) == []
    assert manager.put(f"{BASE}/contracts/999999", json=body, headers=HEADERS).status_code == 404
    db.expire_all()
    actions = set(db.scalars(select(AuditLog.action).where(AuditLog.module == "budget")).all())
    assert {"budget.partner_angelegt", "budget.vertrag_angelegt", "budget.vertrag_geaendert"} <= (
        actions
    )
