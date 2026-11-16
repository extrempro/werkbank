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
    gross_cents,
    is_running,
    notice_deadline,
    term_end,
)
from werkbank.modules.budget.models import (
    BudgetAccount,
    BudgetContract,
    BudgetInvoice,
    BudgetItem,
    BudgetPartner,
    BudgetPlan,
    BudgetYear,
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
        # Reihenfolge nach Abhängigkeiten: erst, was auf anderes verweist.
        for model in (
            BudgetInvoice,
            BudgetContract,
            BudgetPlan,
            BudgetYear,
            BudgetItem,
            BudgetPartner,
            BudgetAccount,
        ):
            db_session.execute(delete(model))
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


def post(client: Any, path: str, body: dict[str, Any]) -> Any:
    return client.post(f"{BASE}{path}", json=body, headers=HEADERS)


def put(client: Any, path: str, body: dict[str, Any]) -> Any:
    return client.put(f"{BASE}{path}", json=body, headers=HEADERS)


@pytest.mark.db
def test_items_belong_to_accounts(db: Session) -> None:
    editor = client_for(["Budget.Editor"], "posten-it")
    software = post(
        editor, "/accounts", {"number": "6815", "name": "Software", "kind": "laufend"}
    ).json()
    hardware = post(
        editor, "/accounts", {"number": "0420", "name": "Hardware", "kind": "investition"}
    ).json()
    reader = client_for(["Budget.Reader"], "posten-leser")
    body = {"account_id": software["id"], "name": "Office-Lizenzen"}
    assert post(reader, "/items", body).status_code == 403
    assert client_for(["Tenant.Reader"], "posten-fremd").get(f"{BASE}/items").status_code == 403

    created = post(editor, "/items", body)
    assert created.status_code == 201
    item = created.json()
    assert (item["account_number"], item["kind"], item["active"]) == ("6815", "laufend", True)
    # Derselbe Name ist im selben Konto vergeben, in einem anderen Konto frei.
    assert post(editor, "/items", {**body, "name": "office-lizenzen"}).status_code == 409
    assert post(editor, "/items", {**body, "account_id": hardware["id"]}).status_code == 201
    assert post(editor, "/items", {**body, "account_id": 999_999}).status_code == 422
    assert post(editor, "/items", {**body, "name": " "}).status_code == 422
    post(editor, "/items", {"account_id": software["id"], "name": "Sonstige Software"})
    # Sortiert nach Kontonummer, dann Name
    assert [
        (entry["account_number"], entry["name"]) for entry in reader.get(f"{BASE}/items").json()
    ] == [("0420", "Office-Lizenzen"), ("6815", "Office-Lizenzen"), ("6815", "Sonstige Software")]

    changed = put(editor, f"/items/{item['id']}", {**body, "name": "M365", "active": False})
    assert (changed.json()["name"], changed.json()["active"]) == ("M365", False)
    taken = {**body, "name": "Sonstige Software"}
    assert put(editor, f"/items/{item['id']}", taken).status_code == 409
    assert put(editor, "/items/999999", body).status_code == 404
    db.expire_all()
    actions = set(db.scalars(select(AuditLog.action).where(AuditLog.module == "budget")).all())
    assert {"budget.posten_angelegt", "budget.posten_geaendert"} <= actions


@pytest.mark.db
def test_plan_and_overview(db: Session) -> None:
    manager = client_for(["Budget.Manager"], "budget-verwalter2")
    put(manager, "/settings", {"start_month": 8, "year_label": "Geschäftsjahr"})
    ids = {}
    for number, name, kind, item in (
        ("6815", "Software", "laufend", "Office-Lizenzen"),
        ("6815", "Software", "laufend", "Sonstige Software"),
        ("6820", "Telefonie", "laufend", "Mobilfunk"),
        ("0420", "Hardware", "investition", "Server"),
    ):
        account = post(manager, "/accounts", {"number": number, "name": name, "kind": kind})
        if account.status_code == 201:
            ids[number] = account.json()["id"]
        ids[item] = post(manager, "/items", {"account_id": ids[number], "name": item}).json()["id"]

    outsider = client_for(["Budget.Reader"], "budget-nurlesen")
    entries = [{"item_id": ids["Office-Lizenzen"], "amount_cents": 1_190_000}]
    assert put(outsider, "/plans/2026", {"entries": entries}).status_code == 403

    put(
        manager,
        "/plans/2025",
        {"entries": [{"item_id": ids["Office-Lizenzen"], "amount_cents": 1_000_000}]},
    )
    data = put(
        manager,
        "/plans/2026",
        {
            "entries": [
                {"item_id": ids["Office-Lizenzen"], "amount_cents": 1_190_000},
                {"item_id": ids["Sonstige Software"], "amount_cents": 10_000},
                {"item_id": ids["Server"], "amount_cents": 5_000_050},
            ]
        },
    ).json()
    assert (data["year"], data["year_name"]) == (2026, "2026/27")
    assert (data["first_day"], data["last_day"]) == ("2026-08-01", "2027-07-31")
    # Das Konto zeigt die Summe seiner Posten.
    rows = {row["account"]["number"]: row for row in data["rows"]}
    assert (rows["6815"]["plan_cents"], rows["6815"]["previous_cents"]) == (1_200_000, 1_000_000)
    assert (rows["6820"]["plan_cents"], rows["6820"]["previous_cents"]) == (None, None)
    items = {row["item"]["name"]: row for row in data["items"]}
    assert (items["Office-Lizenzen"]["plan_cents"], items["Office-Lizenzen"]["contracts"]) == (
        1_190_000,
        0,
    )
    assert items["Mobilfunk"]["plan_cents"] is None
    assert data["plan"] == {
        "running_cents": 1_200_000,
        "investment_cents": 5_000_050,
        "total_cents": 6_200_050,
    }
    assert data["previous"]["total_cents"] == 1_000_000
    assert data["committed"]["total_cents"] == 0
    assert data["committed_contracts"] == 0
    assert {2025, 2026} <= {entry["year"] for entry in data["years"]}

    # Nicht genannte Posten bleiben; None entfernt den Plan.
    data = put(
        manager, "/plans/2026", {"entries": [{"item_id": ids["Server"], "amount_cents": None}]}
    ).json()
    assert data["plan"]["total_cents"] == 1_200_000

    office = ids["Office-Lizenzen"]
    for bad in (
        [{"item_id": 999_999, "amount_cents": 1}],
        [{"item_id": office, "amount_cents": 1}, {"item_id": office}],
        [{"item_id": office, "amount_cents": -1}],
    ):
        assert put(manager, "/plans/2026", {"entries": bad}).status_code == 422
    assert put(manager, "/plans/1999", {"entries": []}).status_code == 422

    # Stillgelegte Posten ohne Plan verschwinden aus der Übersicht, mit Plan bleiben sie.
    for name, number in (("Mobilfunk", "6820"), ("Office-Lizenzen", "6815")):
        put(
            manager,
            f"/items/{ids[name]}",
            {"account_id": ids[number], "name": name, "active": False},
        )
    reader = client_for(["Budget.Reader"], "budget-leser3")
    shown = reader.get(f"{BASE}/overview", params={"year": 2026}).json()
    assert [row["item"]["name"] for row in shown["items"]] == [
        "Server",
        "Office-Lizenzen",
        "Sonstige Software",
    ]
    # Ein stillgelegtes Konto ohne Posten in der Übersicht fällt ebenfalls weg.
    put(
        manager,
        f"/accounts/{ids['6820']}",
        {"number": "6820", "name": "Telefonie", "kind": "laufend", "active": False},
    )
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
        "item_id": 1,
        "starts_on": date(2026, 1, 31),
        "ends_on": None,
        "renewal_months": None,
        "notice_months": None,
        "cancelled_to": None,
        "net_cents": 100,
        "tax_rate_bp": 0,
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


def test_gross_is_rounded_commercially() -> None:
    assert gross_cents(100_000, 1900) == 119_000
    assert gross_cents(100_000, 0) == 100_000
    assert gross_cents(999, 700) == 1069
    assert gross_cents(5, 1900) == 6
    assert gross_cents(2, 1900) == 2


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
    item = post(manager, "/items", {"account_id": account["id"], "name": "Zeiterfassung"}).json()
    partner = manager.post(
        f"{BASE}/partners", json={"name": "Beispiel Software GmbH"}, headers=HEADERS
    ).json()
    today = now_utc().date()
    year = manager.get(f"{BASE}/settings").json()["current_year"]
    body = {
        "title": "Wartung Zeiterfassung",
        "partner_id": partner["id"],
        "item_id": item["id"],
        "number": "V-1",
        "starts_on": f"{year}-01-01",
        "ends_on": (today + timedelta(days=100)).isoformat(),
        "renewal_months": 12,
        "notice_months": 2,
        "net_cents": 50_000,
        "tax_rate_bp": 0,
        "interval": "monatlich",
    }
    reader = client_for(["Budget.Reader"], "vertrag-leser")
    assert reader.post(f"{BASE}/contracts", json=body, headers=HEADERS).status_code == 403

    created = manager.post(f"{BASE}/contracts", json=body, headers=HEADERS)
    assert created.status_code == 201, created.text
    first = created.json()
    assert (first["partner_name"], first["account_number"], first["item_name"]) == (
        "Beispiel Software GmbH",
        "6815",
        "Zeiterfassung",
    )
    assert first["running"] is True
    assert (first["invoicer_id"], first["dpa_status"]) == (None, "nicht_erforderlich")
    assert first["yearly_cents"] == 600_000
    assert first["current_year_cents"] == 600_000
    # Kündigungstermin: zwei Monate vor dem Ende, also in rund 40 Tagen.
    assert first["deadline_soon"] is True
    assert 30 <= first["days_to_deadline"] <= 45

    for bad in (
        {**body, "partner_id": 999_999},
        {**body, "item_id": 999_999},
        {**body, "ends_on": f"{year - 1}-01-01"},
        {**body, "cancelled_to": f"{year - 1}-01-01"},
        {**body, "ends_on": None},
        {**body, "interval": "woechentlich"},
        {**body, "net_cents": -1},
        {**body, "tax_rate_bp": 10_001},
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
            "item_id": item["id"],
            "starts_on": f"{year}-02-01",
            "net_cents": 100_000,
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
    assert (overview["items"][0]["committed_cents"], overview["items"][0]["contracts"]) == (
        719_000,
        2,
    )
    # Der einmalige Vertrag rechnet 19 % auf das Netto.
    single = listing["entries"][1]
    assert (single["net_cents"], single["tax_rate_bp"], single["amount_cents"]) == (
        100_000,
        1900,
        119_000,
    )

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


# --- Rechnungen ---


@pytest.mark.db
def test_invoices_are_checked_and_booked(db: Session) -> None:
    manager = client_for(["Budget.Manager"], "rechnung-verwalter")
    editor = client_for(["Budget.Editor"], "rechnung-it")
    reader = client_for(["Budget.Reader"], "rechnung-leser")
    account = post(
        manager, "/accounts", {"number": "6815", "name": "Software", "kind": "laufend"}
    ).json()
    item = post(manager, "/items", {"account_id": account["id"], "name": "Zeiterfassung"}).json()
    partner = post(manager, "/partners", {"name": "Beispiel Software GmbH"}).json()
    year = manager.get(f"{BASE}/settings").json()["current_year"]
    contract = post(
        manager,
        "/contracts",
        {
            "title": "Wartung",
            "partner_id": partner["id"],
            "item_id": item["id"],
            "starts_on": f"{year}-01-01",
            "net_cents": 100_000,
            "tax_rate_bp": 0,
            "interval": "monatlich",
        },
    ).json()
    put(
        manager, f"/plans/{year}", {"entries": [{"item_id": item["id"], "amount_cents": 1_500_000}]}
    )
    body = {
        "invoicer_id": partner["id"],
        "number": "RE-1",
        "internal_number": "re.26.0001",
        "invoice_date": f"{year}-02-10",
        "item_id": item["id"],
        "contract_id": contract["id"],
        "net_cents": 100_000,
        "tax_rate_bp": 1900,
        "description": "Wartung Februar",
        "is_yearly": True,
    }
    assert post(reader, "/invoices", body).status_code == 403
    assert (
        client_for(["Tenant.Reader"], "rechnung-fremd").get(f"{BASE}/invoices").status_code == 403
    )

    # Die IT legt vor: Die Rechnung wartet auf die Prüfung und zählt noch nicht.
    created = post(editor, "/invoices", body)
    assert created.status_code == 201, created.text
    first = created.json()
    assert (first["status"], first["gross_cents"], first["booked_at"]) == (
        "zu_pruefen",
        119_000,
        None,
    )
    assert (first["invoicer_name"], first["item_name"], first["contract_title"]) == (
        "Beispiel Software GmbH",
        "Zeiterfassung",
        "Wartung",
    )
    assert first["created_by_name"]
    overview = reader.get(f"{BASE}/overview", params={"year": year}).json()
    assert (overview["open_invoices"], overview["actual"]["total_cents"]) == (1, 0)
    assert overview["committed"]["total_cents"] == 1_200_000

    for bad in (
        {**body, "invoicer_id": 999_999},
        {**body, "item_id": 999_999},
        {**body, "contract_id": 999_999},
        {**body, "number": " "},
        {**body, "gross_cents": 119_101},
        {**body, "invoice_date": "1999-01-01"},
        {**body, "tax_rate_bp": -1},
    ):
        assert post(editor, "/invoices", bad).status_code == 422, bad

    # Solange sie offen ist, darf die IT ändern; buchen darf nur der Budgetverwalter.
    url = f"/invoices/{first['id']}"
    changed = put(editor, url, {**body, "gross_cents": 119_005}).json()
    assert changed["gross_cents"] == 119_005
    assert editor.post(f"{BASE}{url}/book", headers=HEADERS).status_code == 403
    booked = manager.post(f"{BASE}{url}/book", headers=HEADERS)
    assert booked.status_code == 200
    assert (booked.json()["status"], bool(booked.json()["booked_by_name"])) == ("gebucht", True)
    assert manager.post(f"{BASE}{url}/book", headers=HEADERS).status_code == 409
    assert manager.post(f"{BASE}/invoices/999999/book", headers=HEADERS).status_code == 404

    # Gebucht: zählt zum Ist und nicht mehr als gebunden; die Prognose ist Ist plus Rest.
    overview = reader.get(f"{BASE}/overview", params={"year": year}).json()
    row = overview["items"][0]
    assert (row["actual_cents"], row["committed_cents"], row["forecast_cents"]) == (
        119_005,
        1_200_000 - 119_005,
        1_200_000,
    )
    assert overview["open_invoices"] == 0
    assert overview["forecast"]["total_cents"] == 1_200_000
    assert overview["rows"][0]["actual_cents"] == 119_005

    # Gebuchtes ändert und löscht nur der Budgetverwalter.
    assert put(editor, url, body).status_code == 403
    assert editor.delete(f"{BASE}{url}", headers=HEADERS).status_code == 403
    assert put(manager, url, {**body, "description": "Korrigiert"}).json()["status"] == "gebucht"

    # Der Budgetverwalter bucht beim Erfassen sofort; ohne Vertrag erhöht das die Prognose.
    direct = post(
        manager, "/invoices", {**body, "number": "RE-2", "contract_id": None, "net_cents": 10_000}
    ).json()
    assert (direct["status"], direct["gross_cents"]) == ("gebucht", 11_900)
    overview = reader.get(f"{BASE}/overview", params={"year": year}).json()
    assert overview["forecast"]["total_cents"] == 1_211_900

    # Liste: neueste zuerst, nach Geschäftsjahr getrennt.
    post(editor, "/invoices", {**body, "number": "RE-3", "invoice_date": f"{year}-03-01"})
    listing = reader.get(f"{BASE}/invoices", params={"year": year}).json()
    assert [entry["number"] for entry in listing["entries"]] == ["RE-3", "RE-2", "RE-1"]
    assert reader.get(f"{BASE}/invoices", params={"year": year - 1}).json()["entries"] == []

    # Aufgabe für den Budgetverwalter, nicht für die IT.
    def waiting(client: Any) -> list[int]:
        tasks: list[dict[str, Any]] = client.get("/api/tasks").json()["tasks"]
        return [task["count"] for task in tasks if task["link"] == "/budget/rechnungen"]

    assert waiting(manager) == [1]
    assert waiting(editor) == []

    open_id = listing["entries"][0]["id"]
    assert editor.delete(f"{BASE}/invoices/{open_id}", headers=HEADERS).status_code == 200
    assert manager.delete(f"{BASE}{url}", headers=HEADERS).status_code == 200
    assert manager.delete(f"{BASE}{url}", headers=HEADERS).status_code == 404
    db.expire_all()
    actions = set(db.scalars(select(AuditLog.action).where(AuditLog.module == "budget")).all())
    assert {
        "budget.rechnung_erfasst",
        "budget.rechnung_geaendert",
        "budget.rechnung_gebucht",
        "budget.rechnung_geloescht",
    } <= actions


@pytest.mark.db
def test_partner_detail_and_merge(db: Session) -> None:
    manager = client_for(["Budget.Manager"], "merge-verwalter")
    editor = client_for(["Budget.Editor"], "merge-it")
    reader = client_for(["Budget.Reader"], "merge-leser")
    account = post(
        manager, "/accounts", {"number": "6815", "name": "Software", "kind": "laufend"}
    ).json()
    item = post(manager, "/items", {"account_id": account["id"], "name": "Lizenzen"}).json()
    right = post(manager, "/partners", {"name": "Beispiel Software GmbH"}).json()
    typo = post(
        manager,
        "/partners",
        {"name": "Beispiel Sofware", "is_contract_partner": False, "customer_number": "K-7"},
    ).json()
    vendor = post(manager, "/partners", {"name": "Beispiel Hersteller AG"}).json()
    year = manager.get(f"{BASE}/settings").json()["current_year"]
    base = {
        "item_id": item["id"],
        "starts_on": f"{year}-01-01",
        "net_cents": 1_000,
        "tax_rate_bp": 0,
        "interval": "jaehrlich",
    }
    # Zwei Verträge: einer mit dem Tippfehler-Partner als abweichendem Rechnungssteller.
    post(manager, "/contracts", {**base, "title": "A", "partner_id": right["id"]})
    post(
        manager,
        "/contracts",
        {**base, "title": "B", "partner_id": right["id"], "invoicer_id": typo["id"]},
    )
    post(
        manager,
        "/contracts",
        {**base, "title": "C", "partner_id": vendor["id"], "invoicer_id": typo["id"]},
    )
    invoice = {
        "invoicer_id": typo["id"],
        "number": "RE-9",
        "invoice_date": f"{year}-02-01",
        "item_id": item["id"],
        "net_cents": 500,
        "tax_rate_bp": 0,
    }
    post(manager, "/invoices", invoice)

    detail = reader.get(f"{BASE}/partners/{typo['id']}").json()
    assert detail["partner"]["name"] == "Beispiel Sofware"
    assert [entry["title"] for entry in detail["contracts"]] == ["B", "C"]
    assert ([entry["number"] for entry in detail["invoices"]], detail["invoice_total"]) == (
        ["RE-9"],
        1,
    )
    assert reader.get(f"{BASE}/partners/999999").status_code == 404
    assert (
        client_for(["Tenant.Reader"], "merge-fremd")
        .get(f"{BASE}/partners/{typo['id']}")
        .status_code
        == 403
    )

    merge = f"/partners/{typo['id']}/merge"
    assert post(editor, merge, {"into_id": right["id"]}).status_code == 403
    assert post(manager, merge, {"into_id": typo["id"]}).status_code == 422
    assert post(manager, merge, {"into_id": 999_999}).status_code == 422
    assert post(manager, "/partners/999999/merge", {"into_id": right["id"]}).status_code == 404

    merged = post(manager, merge, {"into_id": right["id"]})
    assert merged.status_code == 200, merged.text
    data = merged.json()
    assert (data["moved_contracts"], data["moved_invoices"]) == (2, 1)
    # Das Ziel übernimmt die fehlende Kundennummer; der Quellpartner ist weg.
    assert (data["partner"]["name"], data["partner"]["customer_number"]) == (
        "Beispiel Software GmbH",
        "K-7",
    )
    assert reader.get(f"{BASE}/partners/{typo['id']}").status_code == 404
    contracts = {
        entry["title"]: entry for entry in reader.get(f"{BASE}/contracts").json()["entries"]
    }
    # B: Rechnungssteller ist jetzt der Vertragspartner selbst, also keine Abweichung mehr.
    assert contracts["B"]["invoicer_id"] is None
    assert contracts["C"]["invoicer_name"] == "Beispiel Software GmbH"
    detail = reader.get(f"{BASE}/partners/{right['id']}").json()
    assert [entry["title"] for entry in detail["contracts"]] == ["A", "B", "C"]
    assert detail["invoice_total"] == 1
    db.expire_all()
    entry = db.scalars(
        select(AuditLog).where(AuditLog.action == "budget.partner_zusammengelegt")
    ).first()
    assert entry is not None


@pytest.mark.db
def test_delete_only_without_dependencies(db: Session) -> None:
    manager = client_for(["Budget.Manager"], "loesch-verwalter")
    reader = client_for(["Budget.Reader"], "loesch-leser")
    account = post(
        manager, "/accounts", {"number": "6815", "name": "Software", "kind": "laufend"}
    ).json()
    item = post(manager, "/items", {"account_id": account["id"], "name": "Lizenzen"}).json()
    partner = post(manager, "/partners", {"name": "Beispiel Software GmbH"}).json()
    year = manager.get(f"{BASE}/settings").json()["current_year"]
    put(manager, f"/plans/{year}", {"entries": [{"item_id": item["id"], "amount_cents": 100}]})
    contract = post(
        manager,
        "/contracts",
        {
            "title": "Wartung",
            "partner_id": partner["id"],
            "item_id": item["id"],
            "starts_on": f"{year}-01-01",
            "net_cents": 1_000,
            "interval": "jaehrlich",
        },
    ).json()
    invoice = post(
        manager,
        "/invoices",
        {
            "invoicer_id": partner["id"],
            "number": "RE-1",
            "invoice_date": f"{year}-02-01",
            "item_id": item["id"],
            "contract_id": contract["id"],
            "net_cents": 1_000,
        },
    ).json()

    def delete(client: Any, path: str) -> int:
        code: int = client.delete(f"{BASE}{path}", headers=HEADERS).status_code
        return code

    paths = [
        f"/contracts/{contract['id']}",
        f"/items/{item['id']}",
        f"/partners/{partner['id']}",
    ]
    # Lesende löschen nichts; mit Abhängigkeiten geht es für niemanden.
    assert [delete(reader, path) for path in paths] == [403, 403, 403]
    assert [delete(manager, path) for path in paths] == [409, 409, 409]

    # Ohne die Rechnung fällt der Vertrag, danach Posten (samt Plan) und Partner.
    assert delete(manager, f"/invoices/{invoice['id']}") == 200
    assert delete(manager, paths[1]) == 409
    assert delete(manager, paths[2]) == 409
    assert [delete(manager, path) for path in paths] == [200, 200, 200]
    assert [delete(manager, path) for path in paths] == [404, 404, 404]
    assert manager.get(f"{BASE}/overview", params={"year": year}).json()["plan"]["total_cents"] == 0
    db.expire_all()
    actions = set(db.scalars(select(AuditLog.action).where(AuditLog.module == "budget")).all())
    assert {
        "budget.vertrag_geloescht",
        "budget.posten_geloescht",
        "budget.partner_geloescht",
    } <= actions


# --- Planung: Stand je Jahr, mehrere Jahre, Plan beim Anlegen ---


@pytest.mark.db
def test_planning_with_release_and_proposals(db: Session) -> None:
    manager = client_for(["Budget.Manager"], "plan-verwalter")
    editor = client_for(["Budget.Editor"], "plan-it")
    reader = client_for(["Budget.Reader"], "plan-leser")
    account = post(
        manager, "/accounts", {"number": "6815", "name": "Software", "kind": "laufend"}
    ).json()
    partner = post(manager, "/partners", {"name": "Beispiel Software GmbH"}).json()
    year = manager.get(f"{BASE}/settings").json()["current_year"]

    # Die IT meldet ein Vorhaben an: Posten mit Partner und Plan für das nächste Jahr.
    created = post(
        editor,
        "/items",
        {
            "account_id": account["id"],
            "name": "Projekt Dokumentenablage",
            "partner_id": partner["id"],
            "plan_year": year + 1,
            "plan_cents": 1_500_000,
        },
    )
    assert created.status_code == 201, created.text
    project = created.json()
    assert (project["partner_id"], project["partner_name"]) == (
        partner["id"],
        "Beispiel Software GmbH",
    )
    assert (
        post(
            editor, "/items", {"account_id": account["id"], "name": "X", "partner_id": 999_999}
        ).status_code
        == 422
    )
    software = post(editor, "/items", {"account_id": account["id"], "name": "Zeiterfassung"}).json()
    post(
        manager,
        "/contracts",
        {
            "title": "Wartung",
            "partner_id": partner["id"],
            "item_id": software["id"],
            "starts_on": f"{year}-01-01",
            "ends_on": f"{year + 2}-12-31",
            "net_cents": 100_000,
            "tax_rate_bp": 0,
            "interval": "jaehrlich",
        },
    )

    # Mehrjahres-Sicht: sechs Jahre, Plan des Projekts, Vorschläge bis zum Vertragsende.
    data = reader.get(f"{BASE}/planning").json()
    assert [entry["year"] for entry in data["years"]] == list(range(year, year + 6))
    assert {entry["status"] for entry in data["years"]} == {"entwurf"}
    rows = {row["item"]["name"]: row for row in data["rows"]}
    assert rows["Projekt Dokumentenablage"]["plans"] == {str(year + 1): 1_500_000}
    assert rows["Zeiterfassung"]["proposals"] == {
        str(year): 100_000,
        str(year + 1): 100_000,
        str(year + 2): 100_000,
    }
    # Auch die Jahreswahl reicht fünf Jahre voraus.
    listed = {entry["year"] for entry in reader.get(f"{BASE}/overview").json()["years"]}
    assert {year - 5, year + 5} <= listed

    # Im Entwurf plant auch die IT; freigeben darf nur der Budgetverwalter.
    plan = {"entries": [{"item_id": software["id"], "amount_cents": 100_000}]}
    assert put(editor, f"/plans/{year + 1}", plan).status_code == 200
    release = {"status": "freigegeben"}
    assert put(editor, f"/years/{year + 1}/status", release).status_code == 403
    assert put(manager, f"/years/{year + 1}/status", {"status": "offen"}).status_code == 422
    released = put(manager, f"/years/{year + 1}/status", release)
    assert released.status_code == 200
    assert released.json()["status"] == "freigegeben"
    overview = reader.get(f"{BASE}/overview", params={"year": year + 1}).json()
    assert (overview["year_status"], overview["plan"]["total_cents"]) == ("freigegeben", 1_600_000)

    # Freigegeben: niemand ändert den Plan, auch nicht über einen neuen Posten.
    assert put(editor, f"/plans/{year + 1}", plan).status_code == 409
    assert put(manager, f"/plans/{year + 1}", plan).status_code == 409
    late = {
        "account_id": account["id"],
        "name": "Nachzügler",
        "plan_year": year + 1,
        "plan_cents": 1,
    }
    assert post(editor, "/items", late).status_code == 409
    assert put(editor, f"/plans/{year + 2}", plan).status_code == 200

    # Nach dem Aufheben geht es wieder.
    assert put(manager, f"/years/{year + 1}/status", {"status": "entwurf"}).status_code == 200
    assert put(editor, f"/plans/{year + 1}", plan).status_code == 200

    # Ein Partner an einem Posten lässt sich nicht löschen; beim Zusammenlegen wandert er mit.
    other = post(manager, "/partners", {"name": "Beispiel Sofware"}).json()
    put(
        editor,
        f"/items/{project['id']}",
        {
            "account_id": account["id"],
            "name": "Projekt Dokumentenablage",
            "partner_id": other["id"],
        },
    )
    assert manager.delete(f"{BASE}/partners/{other['id']}", headers=HEADERS).status_code == 409
    post(manager, f"/partners/{other['id']}/merge", {"into_id": partner["id"]})
    items = {entry["name"]: entry for entry in reader.get(f"{BASE}/items").json()}
    assert items["Projekt Dokumentenablage"]["partner_id"] == partner["id"]
    db.expire_all()
    actions = set(db.scalars(select(AuditLog.action).where(AuditLog.module == "budget")).all())
    assert {"budget.jahr_freigegeben", "budget.jahr_freigabe_aufgehoben"} <= actions
