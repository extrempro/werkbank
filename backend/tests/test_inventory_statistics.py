"""IT-Bestand: Statistik und Anschaffungsdatum."""

from collections import Counter
from collections.abc import Iterator
from datetime import date, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_admin_settings import HEADERS
from tests.test_m365_api import client_for
from werkbank.modules.inventory.models import (
    InventoryCase,
    InventoryHardware,
    InventoryKind,
    InventoryLoan,
    InventoryMaker,
    InventoryModel,
    InventoryRetireReason,
)
from werkbank.modules.inventory.statistics import age_label, built_date, fold

BASE = "/api/inventory"


def test_helpers() -> None:
    today = date(2026, 11, 20)
    assert built_date("2024-KW12") == date(2024, 3, 18)
    assert built_date("2024-KW60") is None and built_date(None) is None
    assert age_label(date(2026, 1, 1), today) == "unter 1 Jahr"
    assert age_label(date(2025, 11, 20), today) == "1 bis 2 Jahre"
    assert age_label(date(2025, 11, 21), today) == "unter 1 Jahr"
    assert age_label(date(2015, 5, 1), today) == "6 Jahre und älter"
    assert age_label(None, today) == "unbekannt"
    assert age_label(date(2027, 1, 1), today) == "unbekannt"
    folded = fold(Counter({"a": 5, "b": 3, "c": 1, "d": 1}), 2)
    assert [(item.label, item.count) for item in folded] == [("a", 5), ("b", 3), ("Andere", 2)]


@pytest.fixture
def db(db_session: Session) -> Iterator[Session]:
    def clean() -> None:
        db_session.execute(delete(InventoryLoan))
        db_session.execute(delete(InventoryCase))
        db_session.execute(delete(InventoryHardware))
        db_session.execute(delete(InventoryMaker))
        db_session.commit()

    clean()
    yield db_session
    db_session.rollback()
    clean()


def kind(db: Session, name: str) -> int:
    return db.scalars(select(InventoryKind.id).where(InventoryKind.name == name)).one()


@pytest.mark.db
def test_statistics(db: Session) -> None:
    maker_a = InventoryMaker(name="Hersteller A")
    maker_b = InventoryMaker(name="Hersteller B")
    db.add_all([maker_a, maker_b])
    db.flush()
    model_a = InventoryModel(maker_id=maker_a.id, name="Notebook 14")
    model_b = InventoryModel(maker_id=maker_b.id, name="Monitor 24")
    db.add_all([model_a, model_b])
    db.flush()
    reason = db.scalars(select(InventoryRetireReason)).first()
    assert reason is not None
    today = date.today()
    db.add_all(
        [
            InventoryHardware(
                kind_id=kind(db, "Notebook"),
                model_id=model_a.id,
                name="NB 1",
                serial="ST-1",
                purchased_on=today - timedelta(days=100),
                ninja_id=901,
                ninja_facts={"os": "Windows 11 Pro"},
            ),
            InventoryHardware(
                kind_id=kind(db, "Notebook"),
                model_id=model_a.id,
                name="NB 2",
                serial="ST-2",
                ninja_id=902,
                ninja_facts={"os": "Windows 10 Pro"},
            ),
            InventoryHardware(
                kind_id=kind(db, "Monitor"),
                model_id=model_b.id,
                name="Monitor 1",
                serial="ST-3",
                ninja_facts={"built": f"{today.year - 3}-KW01"},
            ),
            InventoryHardware(kind_id=kind(db, "Headset"), name="Headset", serial="ST-4"),
            InventoryHardware(
                kind_id=kind(db, "Notebook"),
                model_id=model_a.id,
                name="Alt",
                serial="ST-5",
                status="ausgemustert",
                retired_on=date(2025, 3, 1),
                retire_reason_id=reason.id,
            ),
        ]
    )
    db.commit()
    reader = client_for(["Bestand.Reader"], "statistik-leser")
    assert (
        client_for(["Tenant.Reader"], "statistik-niemand").get(f"{BASE}/statistics").status_code
        == 403
    )

    data = reader.get(f"{BASE}/statistics").json()
    assert data["kpis"]["total"] == 4 and data["kpis"]["free"] == 4
    assert data["kpis"]["renewal_due"] is None  # keine Nutzungsdauer eingetragen
    assert {(item["name"], item["count"]) for item in data["makers"]} == {
        ("Hersteller A", 2),
        ("Hersteller B", 1),
        ("Ohne Hersteller", 1),
    }
    sections = {section["key"]: section for section in data["sections"]}
    assert list(sections) == ["ueberblick", "alter", "orte", "verleih", "ausmusterung", "daten"]
    charts = {chart["key"]: chart for section in data["sections"] for chart in section["charts"]}
    kinds = {item["label"]: item["count"] for item in charts["art"]["items"]}
    assert kinds == {"Notebook": 2, "Monitor": 1, "Headset": 1}
    assert charts["art"]["filter"] == "kind"
    assert all(item["value"] for item in charts["art"]["items"])
    ages = {item["label"]: item["count"] for item in charts["alter"]["items"]}
    assert ages["unter 1 Jahr"] == 1 and ages["unbekannt"] == 2
    status = {item["label"]: item["count"] for item in charts["status"]["items"]}
    assert status == {"Im Lager, frei": 4}
    os = {item["label"]: item for item in charts["os"]["items"]}
    assert os["Windows 11 Pro"]["count"] == 1 and os["Windows 11 Pro"]["warn"] is False
    assert os["Windows 10 Pro"]["warn"] is True
    assert len(charts["monate"]["items"]) == 12
    assert charts["jahr"]["items"] == [{"label": "2025", "count": 1, "value": None, "warn": False}]
    missing = {item["label"]: item["count"] for item in charts["luecken"]["items"]}
    assert missing["Ohne Inventurnummer"] == 4 and missing["Ohne Anschaffungsdatum"] == 2
    assert "erneuerung" in charts and charts["erneuerung"]["items"] == []

    only_a = reader.get(f"{BASE}/statistics", params={"maker": maker_a.id}).json()
    assert only_a["kpis"]["total"] == 2 and only_a["maker_id"] == maker_a.id
    assert reader.get(f"{BASE}/statistics", params={"maker": 0}).json()["kpis"]["total"] == 1
    assert reader.get(f"{BASE}/statistics", params={"maker": -1}).status_code == 422
    notebooks = reader.get(f"{BASE}/statistics", params={"kind": kind(db, "Notebook")}).json()
    assert notebooks["kpis"]["total"] == 2
    # Die Auswahl der Arten zählt unter den übrigen Filtern weiter alle Arten
    assert {item["name"] for item in notebooks["kinds"]} >= {"Notebook", "Monitor"}
    assert reader.get(f"{BASE}/statistics", params={"site": 0}).json()["kpis"]["total"] == 4

    # Nutzungsdauer: nur Bearbeiter; danach Erneuerungsbedarf
    editor = client_for(["Bestand.Editor"], "statistik-bearbeiter-2")
    notebook = kind(db, "Notebook")
    url = f"{BASE}/kinds/{notebook}/lifetime"
    assert reader.put(url, json={"years": 5}, headers=HEADERS).status_code == 403
    assert editor.put(url, json={"years": 0}, headers=HEADERS).status_code == 422
    saved = editor.put(url, json={"years": 5}, headers=HEADERS).json()
    assert next(k for k in saved["kinds"] if k["id"] == notebook)["lifetime_years"] == 5
    old = db.scalars(select(InventoryHardware).where(InventoryHardware.serial == "ST-2")).one()
    old.purchased_on = date.today() - timedelta(days=6 * 365)
    db.commit()
    renewed = reader.get(f"{BASE}/statistics").json()
    assert renewed["kpis"]["renewal_due"] == 1
    charts = {c["key"]: c for section in renewed["sections"] for c in section["charts"]}
    assert charts["erneuerung"]["items"][0] == {
        "label": "überfällig",
        "count": 1,
        "value": None,
        "warn": True,
    }
    assert len(charts["erneuerung"]["items"]) == 5
    assert charts["erneuerung_art"]["items"][0]["label"] == "Notebook (5 Jahre)"
    editor.put(url, json={"years": None}, headers=HEADERS)


@pytest.mark.db
def test_purchase_date(db: Session) -> None:
    editor = client_for(["Bestand.Editor"], "statistik-bearbeiter")
    body = {"kind_id": kind(db, "Notebook"), "name": "NB 9", "serial": "PD-1"}
    future = {**body, "purchased_on": (date.today() + timedelta(days=1)).isoformat()}
    assert editor.post(f"{BASE}/hardware", json=future, headers=HEADERS).status_code == 422
    assert (
        editor.post(
            f"{BASE}/hardware", json={**body, "purchased_on": "1980-01-01"}, headers=HEADERS
        ).status_code
        == 422
    )
    created = editor.post(
        f"{BASE}/hardware", json={**body, "purchased_on": "2024-05-02"}, headers=HEADERS
    )
    assert created.status_code == 201, created.text
    device = created.json()
    assert device["purchased_on"] == "2024-05-02"
    changed = editor.put(
        f"{BASE}/hardware/{device['id']}",
        json={**body, "purchased_on": "2024-06-01"},
        headers=HEADERS,
    ).json()
    assert changed["purchased_on"] == "2024-06-01"
    assert any(
        "Anschaffung: 02.05.2024 → 01.06.2024" in event["text"] for event in changed["events"]
    )


@pytest.mark.db
def test_loan_statistics(db: Session) -> None:
    from werkbank.modules.inventory.models import InventoryLoanItem

    today = date.today()
    devices = [
        InventoryHardware(kind_id=kind(db, "Notebook"), name=f"Leih {n}", serial=f"LS-{n}")
        for n in range(3)
    ]
    db.add_all(devices)
    db.flush()

    def loan(number: str, issued: date, due: date, returned: date | None) -> InventoryLoan:
        row = InventoryLoan(
            number=number,
            person_oid="11111111-2222-3333-4444-555555555555",
            person_name="Pia Beispiel",
            issued_on=issued,
            due_on=due,
            returned_on=returned,
        )
        db.add(row)
        db.flush()
        return row

    on_time = loan(
        "LS-1", today - timedelta(days=20), today - timedelta(days=10), today - timedelta(days=12)
    )
    late = loan(
        "LS-2", today - timedelta(days=30), today - timedelta(days=20), today - timedelta(days=5)
    )
    open_overdue = loan("LS-3", today - timedelta(days=9), today - timedelta(days=1), None)
    planned = loan("LS-4", today + timedelta(days=3), today + timedelta(days=9), None)
    db.add_all(
        [
            InventoryLoanItem(loan_id=on_time.id, hardware_id=devices[0].id, returned_on=today),
            InventoryLoanItem(loan_id=late.id, hardware_id=devices[1].id, returned_on=today),
            InventoryLoanItem(loan_id=open_overdue.id, hardware_id=devices[1].id),
            InventoryLoanItem(loan_id=planned.id, hardware_id=devices[2].id),
        ]
    )
    db.commit()
    data = client_for(["Bestand.Reader"], "statistik-verleih").get(f"{BASE}/statistics").json()
    assert data["kpis"]["loans_open"] == 1 and data["kpis"]["loans_overdue"] == 1
    charts = {c["key"]: c for section in data["sections"] for c in section["charts"]}
    returns = {item["label"]: item["count"] for item in charts["rueckgabe"]["items"]}
    assert returns == {
        "Pünktlich": 1,
        "Mehr als 7 Tage später": 1,
        "Noch offen, überfällig": 1,
    }
    status = {item["label"]: item["count"] for item in charts["status"]["items"]}
    assert status["Verliehen"] == 1 and status["Reserviert für einen Verleih"] == 1
    assert "Durchschnittliche Dauer" in charts["rueckgabe"]["note"]
