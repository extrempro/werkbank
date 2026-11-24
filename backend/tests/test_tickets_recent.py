"""Leiste „Favoriten“ und „Geöffnet“: Reihenfolge, Höchstzahl, Favoriten, Rechte, Einstellungen."""

from typing import Any

import pytest
from sqlalchemy import delete
from sqlalchemy.orm import Session

from tests.test_tickets import BASE, areas, client_for, db, join, new_ticket, oid_of  # noqa: F401
from werkbank.modules.tickets.models import (
    TicketGroupMember,
    TicketMembershipCache,
    TicketNavPrefs,
    TicketRecent,
)

pytestmark = pytest.mark.db

BAR = f"{BASE}/leiste"


@pytest.fixture(autouse=True)
def clean(db: Session) -> None:  # noqa: F811
    db.execute(delete(TicketRecent))
    db.execute(delete(TicketNavPrefs))
    db.commit()


def numbers(data: dict[str, Any], key: str = "recent") -> list[int]:
    return [item["number"] for item in data[key]]


def test_order_limit_and_favorites(areas: dict[str, int]) -> None:  # noqa: F811
    max_ = client_for("Max Muster")
    tickets = [new_ticket(max_, areas["it"], subject=f"Anliegen {i}")["number"] for i in range(7)]
    empty = max_.get(BAR).json()
    assert empty == {"limit": 15, "compact": True, "favorites": [], "recent": []}
    for number in tickets[:3]:
        assert max_.post(f"{BAR}/{number}").status_code == 200
    # Nochmal öffnen ändert die Reihenfolge nicht
    data = max_.post(f"{BAR}/{tickets[0]}").json()
    assert numbers(data) == tickets[:3]
    assert data["recent"][0]["subject"] == "Anliegen 0"
    assert data["recent"][0]["status"] == "new"
    # Stern: in die Favoriten, zählt nicht zur Höchstzahl
    data = max_.put(f"{BAR}/{tickets[1]}/favorit", json={"favorite": True}).json()
    assert numbers(data, "favorites") == [tickets[1]]
    assert numbers(data) == [tickets[0], tickets[2]]
    # Höchstzahl 5: das älteste ohne Stern fällt heraus
    data = max_.put(f"{BAR}/einstellungen", json={"limit": 5, "compact": False}).json()
    assert (data["limit"], data["compact"]) == (5, False)
    for number in tickets[3:]:
        data = max_.post(f"{BAR}/{number}").json()
    assert numbers(data) == [tickets[2], *tickets[3:]]
    assert numbers(data, "favorites") == [tickets[1]]
    # Weniger als vorher kürzt sofort
    assert max_.put(f"{BAR}/einstellungen", json={"limit": 7, "compact": True}).status_code == 422
    # X: aus der Liste, auch Favoriten
    data = max_.delete(f"{BAR}/{tickets[1]}").json()
    assert data["favorites"] == []
    # Liste leeren lässt Favoriten stehen
    max_.put(f"{BAR}/{tickets[3]}/favorit", json={"favorite": True})
    data = max_.delete(BAR).json()
    assert data["recent"] == [] and numbers(data, "favorites") == [tickets[3]]
    # Stern weg: zurück in „Geöffnet“
    data = max_.put(f"{BAR}/{tickets[3]}/favorit", json={"favorite": False}).json()
    assert numbers(data) == [tickets[3]] and data["favorites"] == []


def test_list_is_per_person_and_follows_rights(
    db: Session,  # noqa: F811
    areas: dict[str, int],  # noqa: F811
) -> None:
    max_ = client_for("Max Muster")
    olga = client_for("Olga Ober")
    hans = client_for("Hans Haus")
    ticket = new_ticket(max_, areas["it"])["number"]
    max_.post(f"{BAR}/{ticket}")
    assert olga.get(BAR).json()["recent"] == []
    # Fremde Tickets: 404, nichts landet in der Leiste
    assert hans.post(f"{BAR}/{ticket}").status_code == 404
    assert hans.put(f"{BAR}/{ticket}/favorit", json={"favorite": True}).status_code == 404
    assert hans.get(BAR).json()["favorites"] == []
    # Rechte weg: Ticket verschwindet aus der Leiste
    db.execute(delete(TicketGroupMember).where(TicketGroupMember.oid == oid_of("Max Muster")))
    db.execute(
        delete(TicketMembershipCache).where(TicketMembershipCache.oid == oid_of("Max Muster"))
    )
    db.commit()
    assert max_.get(BAR).json()["recent"] == []
    # Rechte zurück: wieder da
    join(db, "11111111-1111-1111-1111-111111111111", "Max Muster")
    assert numbers(max_.get(BAR).json()) == [ticket]


def test_needs_login() -> None:
    from fastapi.testclient import TestClient

    from tests.test_tickets import HEADERS, ORIGIN
    from werkbank.config import Settings
    from werkbank.main import create_app

    anonymous = TestClient(
        create_app(Settings(public_url=ORIGIN, environment="test")),
        base_url=ORIGIN,
        headers=HEADERS,
    )
    assert anonymous.get(BAR).status_code == 401
