"""IT-Budget: Geschäftsjahr, Einstellungen, Konten, Plan, Übersicht und Rollen."""

import io
import zipfile
from collections.abc import Iterator
from datetime import date, timedelta
from pathlib import Path
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
from werkbank.modules.budget.documents import clean_name, document_path, looks_like_pdf
from werkbank.modules.budget.models import (
    BudgetAccount,
    BudgetContract,
    BudgetInvoice,
    BudgetInvoiceLine,
    BudgetItem,
    BudgetPartner,
    BudgetStatistic,
)
from werkbank.modules.budget.settings import (
    SETTINGS_KEY,
    fiscal_year_name,
    fiscal_year_of,
    fiscal_year_range,
    load_settings,
)
from werkbank.modules.budget.tags import adopt_spelling, clean_tags, matches
from werkbank.modules.budget.xlsx import Money, Sheet, workbook

BASE = "/api/budget"
HEADERS = {"Origin": ORIGIN}


@pytest.fixture
def db(db_session: Session) -> Iterator[Session]:
    def clean() -> None:
        # Reihenfolge nach Abhängigkeiten: erst, was auf anderes verweist.
        for model in (
            BudgetStatistic,
            BudgetInvoice,
            BudgetContract,
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


LINE_KEYS = (
    "item_id",
    "contract_id",
    "net_cents",
    "tax_rate_bp",
    "gross_cents",
    "description",
    "is_project",
    "is_yearly",
    "closes_item",
)


def with_lines(path: str, body: dict[str, Any]) -> dict[str, Any]:
    """Rechnung in Kurzform (ein Posten, ein Betrag) als Rechnung mit einer Position."""
    if not path.startswith("/invoices") or "lines" in body or "invoicer_id" not in body:
        return body
    head = {key: value for key, value in body.items() if key not in LINE_KEYS}
    return {**head, "lines": [{key: body[key] for key in LINE_KEYS if key in body}]}


def post(client: Any, path: str, body: dict[str, Any]) -> Any:
    return client.post(f"{BASE}{path}", json=with_lines(path, body), headers=HEADERS)


def put(client: Any, path: str, body: dict[str, Any]) -> Any:
    return client.put(f"{BASE}{path}", json=with_lines(path, body), headers=HEADERS)


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
def test_expected_costs_and_overview(db: Session) -> None:
    manager = client_for(["Budget.Manager"], "budget-verwalter2")
    put(manager, "/settings", {"start_month": 8, "year_label": "Geschäftsjahr"})
    ids = {}
    for number, name, kind, item, amount, start, end in (
        ("6815", "Software", "laufend", "Office-Lizenzen", 1_190_000, 2025, None),
        ("6815", "Software", "laufend", "Sonstige Software", 10_000, 2026, 2026),
        ("6820", "Telefonie", "laufend", "Mobilfunk", 50_000, 2027, 2028),
        ("0420", "Hardware", "investition", "Server", 5_000_050, 2026, 2026),
    ):
        account = post(manager, "/accounts", {"number": number, "name": name, "kind": kind})
        if account.status_code == 201:
            ids[number] = account.json()["id"]
        body = {
            "account_id": ids[number],
            "name": item,
            "amount_cents": amount,
            "start_year": start,
            "end_year": end,
        }
        created = post(manager, "/items", body)
        assert created.status_code == 201, created.text
        ids[item] = created.json()["id"]
    office = manager.get(f"{BASE}/items").json()
    names = {entry["name"]: entry for entry in office}
    assert (
        names["Office-Lizenzen"]["start_year_name"],
        names["Office-Lizenzen"]["end_year_name"],
    ) == ("2025/26", None)
    assert names["Server"]["end_year_name"] == "2026/27"

    reader = client_for(["Budget.Reader"], "budget-leser3")
    data = reader.get(f"{BASE}/overview", params={"year": 2026}).json()
    assert (data["year"], data["year_name"]) == (2026, "2026/27")
    assert (data["first_day"], data["last_day"]) == ("2026-08-01", "2027-07-31")
    # Das Konto zeigt die Summe seiner laufenden Posten; Mobilfunk beginnt erst 2027.
    rows = {row["account"]["number"]: row for row in data["rows"]}
    assert (rows["6815"]["expected_cents"], rows["6815"]["previous_cents"]) == (
        1_200_000,
        1_190_000,
    )
    assert "6820" not in rows or rows["6820"]["expected_cents"] is None
    items = {row["item"]["name"]: row for row in data["items"]}
    assert "Mobilfunk" not in items
    assert (items["Office-Lizenzen"]["status"], items["Office-Lizenzen"]["contracts"]) == (
        "offen",
        0,
    )
    # Ohne Rechnung ist die Prognose die Erwartung.
    assert items["Server"]["forecast_cents"] == 5_000_050
    assert data["expected"] == {
        "running_cents": 1_200_000,
        "investment_cents": 5_000_050,
        "total_cents": 6_200_050,
    }
    assert data["previous"]["total_cents"] == 1_190_000
    assert data["statuses"] == {"open": 3, "invoiced": 0, "closed": 0}
    assert (data["committed"]["total_cents"], data["committed_contracts"]) == (0, 0)
    assert {2025, 2026} <= {entry["year"] for entry in data["years"]}
    later = reader.get(f"{BASE}/overview", params={"year": 2027}).json()
    assert {row["item"]["name"] for row in later["items"]} == {"Office-Lizenzen", "Mobilfunk"}

    # Laufzeit prüfen: Ende vor Beginn geht nicht, auch nicht beim Ändern.
    base = {"account_id": ids["6815"], "name": "Neu", "amount_cents": 1}
    assert (
        post(manager, "/items", {**base, "start_year": 2026, "end_year": 2025}).status_code == 422
    )
    assert post(manager, "/items", {**base, "amount_cents": -1}).status_code == 422
    assert post(manager, "/items", {**base, "start_year": 1999}).status_code == 422
    changed = put(
        manager,
        f"/items/{ids['Server']}",
        {"account_id": ids["0420"], "name": "Server", "amount_cents": 10, "end_year": 2025},
    )
    assert changed.status_code == 422
    # Ohne Beginn bleibt der Beginn beim Ändern erhalten.
    kept = put(
        manager,
        f"/items/{ids['Server']}",
        {"account_id": ids["0420"], "name": "Server", "amount_cents": 10, "end_year": 2027},
    ).json()
    assert (kept["start_year"], kept["end_year"], kept["amount_cents"]) == (2026, 2027, 10)

    # Stillgelegte Posten ohne Rechnung verschwinden aus der Übersicht.
    put(
        manager,
        f"/items/{ids['Sonstige Software']}",
        {
            "account_id": ids["6815"],
            "name": "Sonstige Software",
            "amount_cents": 10_000,
            "end_year": 2026,
            "active": False,
        },
    )
    shown = reader.get(f"{BASE}/overview", params={"year": 2026}).json()
    assert [row["item"]["name"] for row in shown["items"]] == ["Server", "Office-Lizenzen"]
    # Ein stillgelegtes Konto ohne Posten im Jahr fällt ebenfalls weg.
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
    changed_log = db.scalars(
        select(AuditLog)
        .where(
            AuditLog.action == "budget.posten_geaendert",
            AuditLog.object_id == str(ids["Server"]),
        )
        .order_by(AuditLog.id)
    ).all()
    assert changed_log[0].details is not None
    assert changed_log[0].details["vorher"]["amount_cents"] == 5_000_050
    assert changed_log[0].details["nachher"]["end_year"] == 2027


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
        manager,
        f"/items/{item['id']}",
        {"account_id": account["id"], "name": "Zeiterfassung", "amount_cents": 1_000_000},
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
    line = first["lines"][0]
    # Mit Vertrag schließt eine Position den Posten ohne Angabe nicht ab.
    assert line["closes_item"] is False
    assert (first["invoicer_name"], line["item_name"], line["contract_title"]) == (
        "Beispiel Software GmbH",
        "Zeiterfassung",
        "Wartung",
    )
    assert (line["net_cents"], line["tax_rate_bp"], line["is_yearly"]) == (100_000, 1900, True)
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
    # Die Rechnung schließt den Posten nicht ab, der Vertrag läuft weiter.
    direct = post(
        manager,
        "/invoices",
        {
            **body,
            "number": "RE-2",
            "contract_id": None,
            "net_cents": 10_000,
            "closes_item": False,
        },
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

    # Ohne die Rechnung fällt der Vertrag, danach Posten und Partner.
    assert delete(manager, f"/invoices/{invoice['id']}") == 200
    assert delete(manager, paths[1]) == 409
    assert delete(manager, paths[2]) == 409
    assert [delete(manager, path) for path in paths] == [200, 200, 200]
    assert [delete(manager, path) for path in paths] == [404, 404, 404]
    assert manager.get(f"{BASE}/overview", params={"year": year}).json()["items"] == []
    db.expire_all()
    actions = set(db.scalars(select(AuditLog.action).where(AuditLog.module == "budget")).all())
    assert {
        "budget.vertrag_geloescht",
        "budget.posten_geloescht",
        "budget.partner_geloescht",
    } <= actions


# --- Status, Mehrjahresübersicht und Export ---


@pytest.mark.db
def test_status_follows_invoice_lines(db: Session) -> None:
    manager = client_for(["Budget.Manager"], "status-verwalter")
    editor = client_for(["Budget.Editor"], "status-it")
    reader = client_for(["Budget.Reader"], "status-leser")
    account = post(
        manager, "/accounts", {"number": "0420", "name": "Hardware", "kind": "investition"}
    ).json()
    partner = post(manager, "/partners", {"name": "Beispiel Systemhaus GmbH"}).json()
    year = manager.get(f"{BASE}/settings").json()["current_year"]
    notebooks = post(
        editor,
        "/items",
        {
            "account_id": account["id"],
            "name": "Notebooks",
            "amount_cents": 1_800_000,
            "start_year": year,
            "end_year": year,
        },
    ).json()

    def overview_row() -> Any:
        data = reader.get(f"{BASE}/overview", params={"year": year}).json()
        return next(row for row in data["items"] if row["item"]["id"] == notebooks["id"])

    def statuses() -> dict[int, str | None]:
        listed = reader.get(f"{BASE}/items", params={"year": year}).json()
        return {entry["id"]: entry["status"] for entry in listed}

    assert overview_row()["status"] == "offen"
    assert reader.get(f"{BASE}/items").json()[0]["status"] is None

    # Teilrechnung ohne Abschluss: Rechnung liegt vor, Prognose bleibt die Erwartung.
    first = {
        "invoicer_id": partner["id"],
        "number": "RE-1",
        "invoice_date": f"{year}-12-01",
        "lines": [
            {
                "item_id": notebooks["id"],
                "net_cents": 600_000,
                "tax_rate_bp": 0,
                "closes_item": False,
            }
        ],
    }
    created = post(editor, "/invoices", first)
    assert created.status_code == 201, created.text
    assert created.json()["lines"][0]["closes_item"] is False
    row = overview_row()
    # Noch nicht gebucht: zählt nicht zum Ist, der Status zeigt die Rechnung aber schon.
    assert (row["status"], row["actual_cents"], row["forecast_cents"]) == (
        "rechnung",
        0,
        1_800_000,
    )
    post(manager, f"/invoices/{created.json()['id']}/book", {})
    row = overview_row()
    assert (row["actual_cents"], row["forecast_cents"]) == (600_000, 1_800_000)

    # Die Schlussrechnung schließt ab; erst gebucht gilt der Posten als abgeschlossen.
    final = {
        **first,
        "number": "RE-2",
        "lines": [{"item_id": notebooks["id"], "net_cents": 1_100_000, "tax_rate_bp": 0}],
    }
    closing = post(editor, "/invoices", final).json()
    assert closing["lines"][0]["closes_item"] is True
    assert statuses()[notebooks["id"]] == "rechnung"
    post(manager, f"/invoices/{closing['id']}/book", {})
    row = overview_row()
    # Abgeschlossen: Prognose ist das Ist, die Ersparnis wird frei.
    assert (row["status"], row["actual_cents"], row["forecast_cents"]) == (
        "abgeschlossen",
        1_700_000,
        1_700_000,
    )
    assert statuses()[notebooks["id"]] == "abgeschlossen"
    data = reader.get(f"{BASE}/overview", params={"year": year}).json()
    assert data["statuses"] == {"open": 0, "invoiced": 0, "closed": 1}
    # Im nächsten Jahr läuft der einmalige Posten nicht mehr.
    assert reader.get(f"{BASE}/items", params={"year": year + 1}).json()[0]["status"] is None


@pytest.mark.db
def test_multi_year_overview_and_export(db: Session) -> None:
    manager = client_for(["Budget.Manager"], "mehrjahr-verwalter")
    reader = client_for(["Budget.Reader"], "mehrjahr-leser")
    account = post(
        manager, "/accounts", {"number": "6815", "name": "Software", "kind": "laufend"}
    ).json()
    partner = post(manager, "/partners", {"name": "Beispiel Software GmbH"}).json()
    year = manager.get(f"{BASE}/settings").json()["current_year"]
    licence = post(
        manager,
        "/items",
        {
            "account_id": account["id"],
            "name": "Zeiterfassung Lizenz",
            "amount_cents": 500_000,
            "start_year": year,
            "end_year": year + 2,
            "tags": ["Lizenzen"],
        },
    ).json()
    post(
        manager,
        "/items",
        {
            "account_id": account["id"],
            "name": "Altes Projekt",
            "amount_cents": 1,
            "start_year": year - 8,
            "end_year": year - 8,
        },
    )
    post(
        manager,
        "/invoices",
        {
            "invoicer_id": partner["id"],
            "number": "RE-9",
            "invoice_date": f"{year + 1}-01-15",
            "lines": [
                {
                    "item_id": licence["id"],
                    "net_cents": 420_168,
                    "description": "Lizenz",
                    "closes_item": True,
                }
            ],
        },
    )

    data = reader.get(f"{BASE}/planning").json()
    assert data["current_year"] == year
    assert [entry["year"] for entry in data["years"]] == list(range(year, year + 5))
    # Posten außerhalb des Zeitraums fehlen; die Lizenz läuft drei Jahre.
    assert [row["item"]["name"] for row in data["rows"]] == ["Zeiterfassung Lizenz"]
    cells = data["rows"][0]["years"]
    assert cells[str(year)]["expected_cents"] == 500_000
    assert cells[str(year + 3)] == {"expected_cents": None, "actual_cents": 0, "status": None}
    assert [entry["expected_cents"] for entry in data["years"]] == [500_000] * 3 + [0, 0]
    back = reader.get(f"{BASE}/planning", params={"start": year - 4}).json()
    assert [entry["year"] for entry in back["years"]] == list(range(year - 4, year + 1))
    assert reader.get(f"{BASE}/planning", params={"start": 1999}).status_code == 422

    # Excel-Export desselben Zeitraums: Übersicht und Rechnungspositionen
    response = reader.get(f"{BASE}/export")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "attachment" in response.headers["content-disposition"]
    assert response.headers["cache-control"] == "no-store"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        overview_xml = archive.read("xl/worksheets/sheet1.xml").decode()
        lines_xml = archive.read("xl/worksheets/sheet2.xml").decode()
        workbook_xml = archive.read("xl/workbook.xml").decode()
    assert "Mehrjahresübersicht" in workbook_xml and "Rechnungspositionen" in workbook_xml
    assert "Zeiterfassung Lizenz" in overview_xml and "<v>5000.00</v>" in overview_xml
    assert "RE-9" in lines_xml and "Beispiel Software GmbH" in lines_xml
    assert client_for(["Tenant.Reader"], "mehrjahr-fremd").get(f"{BASE}/export").status_code == 403


def test_workbook_writes_text_safely() -> None:
    content = workbook(
        [
            Sheet("Blatt: eins/zwei", [["Name", "Betrag"], ["=SUMME(A1)", Money(123_45)]]),
            Sheet("Blatt: eins/zwei", [["<b>&\x01"]]),
        ]
    )
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        first = archive.read("xl/worksheets/sheet1.xml").decode()
        second = archive.read("xl/worksheets/sheet2.xml").decode()
        names = archive.read("xl/workbook.xml").decode()
    # Text bleibt Text, auch wenn er wie eine Formel aussieht.
    assert 't="inlineStr"' in first and "<f>" not in first
    assert "=SUMME(A1)" in first and "<v>123.45</v>" in first
    assert "&lt;b&gt;&amp;" in second and "\x01" not in second
    # Blattnamen ohne verbotene Zeichen und eindeutig
    assert 'name="Blatt- eins-zwei"' in names and 'name="Blatt- eins-zwei (2)"' in names


# --- PDF-Beleg ---

PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


def test_document_names_and_keys_are_safe(tmp_path: Path) -> None:
    assert clean_name("Rechnung%20M%C3%A4rz.pdf") == "Rechnung März.pdf"
    assert clean_name("../../etc/passwd") == "passwd.pdf"
    assert clean_name("C:\\Ablage\\re.PDF") == "re.PDF"
    assert clean_name('a"b<c>.pdf') == "abc.pdf"
    assert clean_name("  ") == "Beleg.pdf"
    assert clean_name("x" * 300).endswith(".pdf")
    assert len(clean_name("x" * 300)) == 200
    assert looks_like_pdf(PDF) is True
    assert looks_like_pdf(b"<html>") is False
    assert document_path(tmp_path, "a" * 32) == tmp_path / ("a" * 32 + ".pdf")
    for bad in ("../x", "A" * 32, "a" * 31, "a" * 32 + "/b"):
        assert document_path(tmp_path, bad) is None


@pytest.mark.db
def test_invoice_documents(db: Session, tmp_path: Path) -> None:
    config = {"budget_documents_dir": tmp_path, "budget_document_max_mb": 1}
    manager = client_for(["Budget.Manager"], "beleg-verwalter", **config)
    editor = client_for(["Budget.Editor"], "beleg-it", **config)
    reader = client_for(["Budget.Reader"], "beleg-leser", **config)
    account = post(
        manager, "/accounts", {"number": "6815", "name": "Software", "kind": "laufend"}
    ).json()
    item = post(manager, "/items", {"account_id": account["id"], "name": "Lizenzen"}).json()
    partner = post(manager, "/partners", {"name": "Beispiel Software GmbH"}).json()
    year = manager.get(f"{BASE}/settings").json()["current_year"]
    body = {
        "invoicer_id": partner["id"],
        "number": "RE-1",
        "invoice_date": f"{year}-02-01",
        "item_id": item["id"],
        "net_cents": 1_000,
    }
    open_invoice = post(editor, "/invoices", body).json()
    booked = post(manager, "/invoices", {**body, "number": "RE-2"}).json()
    url = f"{BASE}/invoices/{open_invoice['id']}/document"

    def upload(client: Any, target: str, data: bytes, **extra: str) -> Any:
        headers = {**HEADERS, "Content-Type": "application/pdf", "X-Dateiname": "Rechnung%201.pdf"}
        return client.put(target, content=data, headers={**headers, **extra})

    assert reader.get(url).status_code == 404
    assert upload(reader, url, PDF).status_code == 403
    assert upload(editor, url, PDF, **{"Content-Type": "text/html"}).status_code == 415
    assert upload(editor, url, b"<html>kein pdf</html>").status_code == 422
    assert upload(editor, url, PDF + b"x" * (1024 * 1024)).status_code == 413
    assert list(tmp_path.iterdir()) == []

    saved = upload(editor, url, PDF)
    assert saved.status_code == 200, saved.text
    assert (saved.json()["doc_name"], saved.json()["doc_size"]) == ("Rechnung 1.pdf", len(PDF))
    files = list(tmp_path.iterdir())
    assert len(files) == 1
    # Der Name in der Ablage ist zufällig und verrät nichts über die Rechnung.
    assert files[0].suffix == ".pdf"
    assert "Rechnung" not in files[0].name

    # Lesende laden herunter; der Browser soll die Datei speichern, nicht anzeigen.
    download = reader.get(url)
    assert download.status_code == 200
    assert download.content == PDF
    assert download.headers["content-type"] == "application/pdf"
    assert download.headers["content-disposition"].startswith("attachment")
    assert download.headers["x-content-type-options"] == "nosniff"
    assert client_for(["Tenant.Reader"], "beleg-fremd", **config).get(url).status_code == 403

    # Ersetzen räumt die alte Datei weg.
    upload(editor, url, PDF + b"%zweite Fassung")
    assert len(list(tmp_path.iterdir())) == 1
    assert reader.get(url).content.endswith(b"zweite Fassung")

    # An gebuchten Rechnungen ändert nur der Budgetverwalter den Beleg.
    booked_url = f"{BASE}/invoices/{booked['id']}/document"
    assert upload(editor, booked_url, PDF).status_code == 403
    assert upload(manager, booked_url, PDF).status_code == 200
    assert editor.delete(booked_url, headers=HEADERS).status_code == 403
    assert manager.delete(booked_url, headers=HEADERS).json()["doc_name"] is None
    assert manager.delete(booked_url, headers=HEADERS).status_code == 404
    assert len(list(tmp_path.iterdir())) == 1

    # Mit der Rechnung verschwindet auch ihr Beleg.
    assert (
        editor.delete(f"{BASE}/invoices/{open_invoice['id']}", headers=HEADERS).status_code == 200
    )
    assert list(tmp_path.iterdir()) == []
    db.expire_all()
    actions = set(db.scalars(select(AuditLog.action).where(AuditLog.module == "budget")).all())
    assert {"budget.beleg_hochgeladen", "budget.beleg_entfernt"} <= actions


def test_tags_are_cleaned_and_matched() -> None:
    assert clean_tags(["  Cloud ", "cloud", "Microsoft   365"]) == ["Cloud", "Microsoft 365"]
    assert adopt_spelling(["cloud", "Neu"], ["Cloud", "CLOUD", "Lizenzen"]) == ["Cloud", "Neu"]
    for bad in (["  "], ["a,b"], ["x" * 31], ["a\nb"], [str(number) for number in range(11)]):
        with pytest.raises(ValueError):
            clean_tags(bad)
    assert matches(["Cloud", "Lizenzen"], ["cloud"], "any")
    assert matches(["Cloud"], ["cloud", "Projekt"], "any")
    assert not matches(["Cloud"], ["cloud", "Projekt"], "all")
    assert matches(["Cloud", "Projekt", "X"], ["cloud", "Projekt"], "all")
    assert not matches(["Cloud"], [], "any")
    assert not matches([], ["Cloud"], "any")


@pytest.mark.db
def test_tags_statistics_and_search(db: Session) -> None:
    manager = client_for(["Budget.Manager"], "tags-verwalter")
    editor = client_for(["Budget.Editor"], "tags-it")
    reader = client_for(["Budget.Reader"], "tags-leser")
    stranger = client_for(["Tenant.Reader"], "tags-fremd")
    account = post(
        manager, "/accounts", {"number": "6815", "name": "Software", "kind": "laufend"}
    ).json()
    partner = post(manager, "/partners", {"name": "Beispiel Software GmbH"}).json()
    year = manager.get(f"{BASE}/settings").json()["current_year"]

    def item(name: str, tags: list[str]) -> Any:
        created = post(editor, "/items", {"account_id": account["id"], "name": name, "tags": tags})
        assert created.status_code == 201, created.text
        return created.json()

    office = item("Office-Lizenzen", [" Cloud ", "Lizenzen", "cloud"])
    assert office["tags"] == ["Cloud", "Lizenzen"]
    # Ein schon vergebener Tag behält seine Schreibweise.
    backup = item("Datensicherung", ["CLOUD", "Projekt"])
    assert backup["tags"] == ["Cloud", "Projekt"]
    plain = item("Telefonie", [])
    assert plain["tags"] == []
    for bad in (["a,b"], ["x" * 31], [""], [str(number) for number in range(11)]):
        body = {"account_id": account["id"], "name": "Ungültig", "tags": bad}
        assert post(editor, "/items", body).status_code == 422

    changed = put(
        editor,
        f"/items/{plain['id']}",
        {"account_id": account["id"], "name": "Telefonie", "tags": ["lizenzen"]},
    )
    assert changed.json()["tags"] == ["Lizenzen"]
    assert reader.get(f"{BASE}/tags").json() == [
        {"tag": "Cloud", "items": 2},
        {"tag": "Lizenzen", "items": 2},
        {"tag": "Projekt", "items": 1},
    ]
    assert stranger.get(f"{BASE}/tags").status_code == 403
    assert [entry["tags"] for entry in reader.get(f"{BASE}/items").json()] == [
        ["Cloud", "Projekt"],
        ["Cloud", "Lizenzen"],
        ["Lizenzen"],
    ]

    # Plan in zwei Jahren, eine gebuchte und eine offene Rechnung
    for entry, amount, end in (
        (office, 1_000_000, None),
        (backup, 500_000, year),
        (plain, 70_000, year),
    ):
        put(
            manager,
            f"/items/{entry['id']}",
            {
                "account_id": account["id"],
                "name": entry["name"],
                "tags": entry["tags"] or ["Lizenzen"],
                "amount_cents": amount,
                "start_year": year,
                "end_year": end,
            },
        )
    invoice = {
        "invoicer_id": partner["id"],
        "number": "RE-1",
        "invoice_date": f"{year}-02-10",
        "item_id": office["id"],
        "net_cents": 100_000,
        "tax_rate_bp": 1900,
        "description": "Lizenzen",
    }
    assert post(manager, "/invoices", invoice).status_code == 201
    # Die Rechnung der IT wartet auf die Prüfung und zählt noch nicht zum Ist.
    waiting = {**invoice, "number": "RE-2", "item_id": backup["id"]}
    assert post(editor, "/invoices", waiting).status_code == 201

    def query(body: dict[str, Any]) -> Any:
        response = post(reader, "/statistics/query", body)
        assert response.status_code == 200, response.text
        return response.json()

    result = query({"tags": ["cloud"]})
    assert (result["tags"], result["mode"], result["current_year"]) == (["Cloud"], "any", year)
    assert [entry["year"] for entry in result["years"]] == list(range(year - 4, year + 1))
    assert (result["years"][-1]["expected_cents"], result["years"][-1]["actual_cents"]) == (
        1_500_000,
        119_000,
    )
    assert result["years"][0]["expected_cents"] == 0
    assert [
        (row["item"]["name"], row["expected_cents"], row["actual_cents"]) for row in result["items"]
    ] == [
        ("Datensicherung", 500_000, 0),
        ("Office-Lizenzen", 1_000_000, 119_000),
    ]
    # Einer der Tags reicht, oder alle müssen passen.
    either = query({"tags": ["Projekt", "Lizenzen"], "mode": "any"})
    assert len(either["items"]) == 3
    assert either["years"][-1]["expected_cents"] == 1_570_000
    both = query({"tags": ["Cloud", "Lizenzen"], "mode": "all"})
    assert [row["item"]["name"] for row in both["items"]] == ["Office-Lizenzen"]
    # Ausblick: ab dem laufenden Jahr
    ahead = query({"tags": ["Cloud"], "start": year})
    assert [entry["year"] for entry in ahead["years"]] == list(range(year, year + 5))
    assert ahead["years"][1]["expected_cents"] == 1_000_000
    assert query({"tags": ["Unbekannt"]})["items"] == []
    assert post(reader, "/statistics/query", {"tags": []}).status_code == 422
    assert post(reader, "/statistics/query", {"tags": ["a"], "mode": "x"}).status_code == 422
    assert post(stranger, "/statistics/query", {"tags": ["Cloud"]}).status_code == 403

    # Gespeicherte Statistiken: IT und Budgetverwalter legen an, alle Budget-Rollen sehen sie.
    saved = {"name": " Cloud gesamt ", "tags": ["cloud"], "mode": "any"}
    assert post(reader, "/statistics", saved).status_code == 403
    created = post(editor, "/statistics", saved)
    assert created.status_code == 201
    assert created.json()["name"] == "Cloud gesamt"
    assert created.json()["tags"] == ["Cloud"]
    assert post(manager, "/statistics", {**saved, "name": "cloud GESAMT"}).status_code == 409
    assert post(manager, "/statistics", {**saved, "name": " "}).status_code == 422
    assert post(manager, "/statistics", {**saved, "tags": []}).status_code == 422
    post(manager, "/statistics", {"name": "Beides", "tags": ["Cloud", "Lizenzen"], "mode": "all"})
    assert [
        (entry["name"], entry["mode"]) for entry in reader.get(f"{BASE}/statistics").json()
    ] == [
        ("Beides", "all"),
        ("Cloud gesamt", "any"),
    ]
    assert stranger.get(f"{BASE}/statistics").status_code == 403
    path = f"{BASE}/statistics/{created.json()['id']}"
    assert reader.delete(path, headers=HEADERS).status_code == 403
    assert editor.delete(path, headers=HEADERS).json() == {"deleted": True}
    assert editor.delete(path, headers=HEADERS).status_code == 404
    assert len(reader.get(f"{BASE}/statistics").json()) == 1

    # Suche: Budgetposten über Name und Tag, nur mit einer Rolle des Budgets
    def hits(client: Any, text: str) -> list[dict[str, Any]]:
        response = client.get("/api/search", params={"q": text})
        assert response.status_code == 200, response.text
        found: list[dict[str, Any]] = response.json()["hits"]
        return [hit for hit in found if hit["module"] == "IT-Budget"]

    found = hits(reader, "projekt")
    assert [(hit["kind"], hit["title"], hit["link"]) for hit in found] == [
        ("Budgetposten", "Datensicherung", "/budget/posten?suche=Datensicherung")
    ]
    assert "Tags: Cloud, Projekt" in found[0]["subtitle"]
    assert [hit["title"] for hit in hits(reader, "office")] == ["Office-Lizenzen"]
    assert hits(reader, "%%") == []
    assert hits(stranger, "projekt") == []

    db.expire_all()
    actions = set(db.scalars(select(AuditLog.action).where(AuditLog.module == "budget")).all())
    assert {"budget.statistik_gespeichert", "budget.statistik_geloescht"} <= actions


@pytest.mark.db
def test_invoices_have_lines_for_several_items(db: Session) -> None:
    manager = client_for(["Budget.Manager"], "position-verwalter")
    reader = client_for(["Budget.Reader"], "position-leser")
    account = post(
        manager, "/accounts", {"number": "6815", "name": "Software", "kind": "laufend"}
    ).json()
    licence = post(manager, "/items", {"account_id": account["id"], "name": "Lizenz"}).json()
    training = post(manager, "/items", {"account_id": account["id"], "name": "Schulung"}).json()
    partner = post(manager, "/partners", {"name": "Beispiel Software GmbH"}).json()
    year = manager.get(f"{BASE}/settings").json()["current_year"]
    body = {
        "invoicer_id": partner["id"],
        "number": "RE-7",
        "internal_number": "re.0007",
        "invoice_date": f"{year}-03-01",
        "lines": [
            {"item_id": licence["id"], "net_cents": 100_000, "description": "Lizenz"},
            {
                "item_id": training["id"],
                "net_cents": 20_000,
                "tax_rate_bp": 700,
                "is_project": True,
            },
        ],
        "total_gross_cents": 140_400,
    }
    created = post(manager, "/invoices", body)
    assert created.status_code == 201, created.text
    invoice = created.json()
    assert (invoice["net_cents"], invoice["gross_cents"]) == (120_000, 140_400)
    assert [
        (line["item_name"], line["gross_cents"], line["tax_rate_bp"], line["is_project"])
        for line in invoice["lines"]
    ] == [("Lizenz", 119_000, 1900, False), ("Schulung", 21_400, 700, True)]

    # Das Ist landet je Position beim richtigen Budgetposten.
    overview = reader.get(f"{BASE}/overview", params={"year": year}).json()
    assert {row["item"]["name"]: row["actual_cents"] for row in overview["items"]} == {
        "Lizenz": 119_000,
        "Schulung": 21_400,
    }

    # Der Rechnungsbetrag muss ganz verteilt sein; Fehler nennen die Position.
    assert post(manager, "/invoices", {**body, "total_gross_cents": 150_000}).status_code == 422
    assert post(manager, "/invoices", {**body, "lines": []}).status_code == 422
    broken = {**body, "lines": [body["lines"][0], {"item_id": 999_999, "net_cents": 1}]}
    rejected = post(manager, "/invoices", {**broken, "total_gross_cents": None})
    assert rejected.status_code == 422
    assert rejected.json()["detail"].startswith("Position 2:")

    # Ändern ersetzt die Positionen; ein Posten mit Position lässt sich nicht löschen.
    changed = put(
        manager,
        f"/invoices/{invoice['id']}",
        {**body, "lines": [body["lines"][0]], "total_gross_cents": 119_000},
    ).json()
    assert [line["item_name"] for line in changed["lines"]] == ["Lizenz"]
    db.expire_all()
    assert len(db.scalars(select(BudgetInvoiceLine)).all()) == 1
    assert manager.delete(f"{BASE}/items/{licence['id']}", headers=HEADERS).status_code == 409
    assert manager.delete(f"{BASE}/items/{training['id']}", headers=HEADERS).json() == {
        "deleted": True
    }
    assert manager.delete(f"{BASE}/invoices/{invoice['id']}", headers=HEADERS).status_code == 200
    db.expire_all()
    assert db.scalars(select(BudgetInvoiceLine)).all() == []
