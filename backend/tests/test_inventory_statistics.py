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
    assert data["total"] == 4
    assert {(item["name"], item["count"]) for item in data["makers"]} == {
        ("Hersteller A", 2),
        ("Hersteller B", 1),
        ("Ohne Hersteller", 1),
    }
    charts = {chart["key"]: chart for chart in data["charts"]}
    kinds = {item["label"]: item["count"] for item in charts["art"]["items"]}
    assert kinds == {"Notebook": 2, "Monitor": 1, "Headset": 1}
    ages = {item["label"]: item["count"] for item in charts["alter"]["items"]}
    assert ages["unter 1 Jahr"] == 1 and ages["unbekannt"] == 2
    assert sum(ages.values()) == 4 and charts["alter"]["ordered"] is True
    status = {item["label"]: item["count"] for item in charts["status"]["items"]}
    assert status == {"Im Lager": 4}
    os = {item["label"]: item["count"] for item in charts["os"]["items"]}
    assert os == {"Windows 11 Pro": 1, "Ohne Angabe": 3}
    assert len(data["loans"]["months"]) == 12
    assert data["retired"][0]["year"] == 2025 and data["retired"][0]["count"] == 1

    only_a = reader.get(f"{BASE}/statistics", params={"maker": maker_a.id}).json()
    assert only_a["total"] == 2 and only_a["maker_id"] == maker_a.id
    assert reader.get(f"{BASE}/statistics", params={"maker": 0}).json()["total"] == 1
    assert reader.get(f"{BASE}/statistics", params={"maker": -1}).status_code == 422


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
