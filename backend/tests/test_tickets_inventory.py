# ruff: noqa: F811  (Fixtures aus test_tickets)
"""Tickets: Verknüpfung mit dem IT-Bestand (Melder → Stelle), Tickets zur Stelle, Melder aus
Entra."""

from datetime import date, timedelta

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_tickets import BASE, areas, client_for, db, new_ticket  # noqa: F401
from werkbank.modules.inventory.models import (
    InventoryHardware,
    InventoryKind,
    InventoryLoan,
    InventoryLoanItem,
    InventoryPosition,
    InventoryWorkplace,
    InventoryWorkplacePosition,
)
from werkbank.modules.inventory.people import PeopleError, Person, get_people_finder

READER = ["Tickets.Nutzer", "Bestand.Reader"]


def _inventory(db: Session) -> tuple[int, int]:
    """Stelle mit Arbeitsplatz, einem Gerät an der Stelle, einem am Arbeitsplatz, einem Verleih."""
    db.execute(delete(InventoryPosition).where(InventoryPosition.number.like("TK-%")))
    db.execute(delete(InventoryWorkplace).where(InventoryWorkplace.number.like("TKA-%")))
    db.execute(delete(InventoryLoan).where(InventoryLoan.number.like("TKV-%")))
    db.execute(delete(InventoryHardware).where(InventoryHardware.name.like("TK-Gerät%")))
    kind = db.scalar(select(InventoryKind).where(InventoryKind.name == "Ticket-Testart"))
    if kind is None:
        kind = InventoryKind(name="Ticket-Testart")
        db.add(kind)
        db.flush()
    position = InventoryPosition(
        number="TK-001",
        name="Sachbearbeitung",
        person_name="M. Muster",
        person_upn="M.Muster@Example.com",
    )
    place = InventoryWorkplace(number="TKA-001")
    db.add_all([position, place])
    db.flush()
    db.add(InventoryWorkplacePosition(workplace_id=place.id, position_id=position.id))
    pc = InventoryHardware(
        kind_id=kind.id, name="TK-Gerät Notebook", serial="TK-1", position_id=position.id
    )
    screen = InventoryHardware(
        kind_id=kind.id, name="TK-Gerät Monitor", serial="TK-2", workplace_id=place.id
    )
    lent = InventoryHardware(kind_id=kind.id, name="TK-Gerät Headset", serial="TK-3")
    db.add_all([pc, screen, lent])
    db.flush()
    loan = InventoryLoan(
        number="TKV-001",
        person_oid="00000000-0000-0000-0000-000000000001",
        person_name="M. Muster",
        person_mail="m.muster@example.com",
        issued_on=date.today() - timedelta(days=10),
        due_on=date.today() - timedelta(days=1),
    )
    db.add(loan)
    db.flush()
    db.add(InventoryLoanItem(loan_id=loan.id, hardware_id=lent.id))
    db.commit()
    return position.id, pc.id


@pytest.mark.db
def test_reporter_inventory_only_with_inventory_rights(db: Session, areas: dict[str, int]) -> None:
    position_id, _pc_id = _inventory(db)
    plain = client_for("Max Muster")
    ticket = new_ticket(plain, areas["it"])
    assert ticket["reporter_inventory"] is None and ticket["inventory"] is False
    # Rechte gelten je Person und sofort: vor der Anmeldung mit Bestandsrechten prüfen
    assert plain.get(f"{BASE}/by-position/{position_id}").status_code == 403
    reader = client_for("Max Muster", READER)
    detail = reader.get(f"{BASE}/{ticket['number']}").json()
    linked = detail["reporter_inventory"]
    assert [p["number"] for p in linked["positions"]] == ["TK-001"]
    pos = linked["positions"][0]
    assert [w["number"] for w in pos["workplaces"]] == ["TKA-001"]
    assert sorted(d["name"] for d in pos["devices"]) == ["TK-Gerät Monitor", "TK-Gerät Notebook"]
    assert linked["loans"][0]["number"] == "TKV-001"
    assert linked["loans"][0]["overdue"] is True and linked["loans"][0]["items"] == 1
    # Unbekannte Mail: leer
    other = new_ticket(reader, areas["it"], reporter_mail="niemand@example.com")
    assert other["reporter_inventory"] == {"positions": [], "loans": []}

    # Umgekehrt: Tickets zur Stelle
    seen = reader.get(f"{BASE}/by-position/{position_id}").json()
    assert [t["number"] for t in seen["items"]] == [ticket["number"]]
    # Wer den Bereich nicht sieht, bekommt nur die Anzahl
    hans = client_for("Hans Haus", READER)
    assert hans.get(f"{BASE}/by-position/{position_id}").json() == {"items": [], "hidden": 1}
    assert reader.get(f"{BASE}/by-position/999999").status_code == 404


@pytest.mark.db
def test_reporter_search_from_entra(db: Session, areas: dict[str, int]) -> None:
    def fake(query: str) -> list[Person]:
        return [
            Person(
                oid="1",
                name="Ina Beispiel",
                upn="ina@example.com",
                department="IT",
                job_title="",
                enabled=True,
                mail="ina.beispiel@example.com",
            ),
            Person(
                oid="2",
                name="Inaktiv Beispiel",
                upn="alt@example.com",
                department="",
                job_title="",
                enabled=False,
            ),
            Person(
                oid="3",
                name="Ohne Mail",
                upn="ohne@example.com",
                department="",
                job_title="",
                enabled=True,
            ),
        ]

    max_ = client_for("Max Muster")
    max_.app.dependency_overrides[get_people_finder] = lambda: fake  # type: ignore[attr-defined]
    found = max_.get(f"{BASE}/people", params={"q": "Bei"}).json()
    assert found == [
        {"name": "Ina Beispiel", "mail": "ina.beispiel@example.com", "detail": "IT"},
        {"name": "Ohne Mail", "mail": "ohne@example.com", "detail": ""},
    ]
    assert max_.get(f"{BASE}/people", params={"q": "B"}).json() == []
    # Nur lesen oder ohne Bereich: nicht
    lea = client_for("Lea Lesen")
    assert lea.get(f"{BASE}/people", params={"q": "Bei"}).status_code == 403

    def broken(query: str) -> list[Person]:
        raise PeopleError("Entra ist nicht eingerichtet.")

    max_.app.dependency_overrides[get_people_finder] = lambda: broken  # type: ignore[attr-defined]
    assert max_.get(f"{BASE}/people", params={"q": "Bei"}).status_code == 503
