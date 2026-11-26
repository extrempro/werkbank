"""Erfolge: freiwillig, ab dem Einschalten, je Anlass einmal, Vitrine nur im eigenen Bereich."""

from datetime import timedelta
from itertools import pairwise

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from tests.test_tickets import BASE, SETTINGS, areas, client_for, db, new_ticket, oid_of
from tests.test_tickets_mail import inbound, mail
from werkbank.core.sessions import now_utc
from werkbank.modules.tickets import achievements as ach
from werkbank.modules.tickets.models import Ticket, TicketAchievementEvent

ERFOLGE = "/api/tickets/erfolge"
# Fixtures aus test_tickets (über pytest per Name genutzt)
FIXTURES = (areas, db)


def enable(client, audience: str = "me") -> None:  # type: ignore[no-untyped-def]
    response = client.put(ERFOLGE, json={"enabled": True, "audience": audience})
    assert response.status_code == 200, response.text


def level(client, category: str) -> tuple[int, int]:  # type: ignore[no-untyped-def]
    data = client.get(ERFOLGE).json()
    found = next(c for c in data["categories"] if c["id"] == category)
    return found["count"], found["level"]


def test_levels_and_combinations() -> None:
    assert ach.THRESHOLDS["chronist"][1] == 1 and ach.THRESHOLDS["chronist"][30] == 6000
    assert ach.THRESHOLDS["ordnung"][30] == 600
    # jede Stufe braucht mehr als die vorige
    for steps in ach.THRESHOLDS.values():
        assert all(b > a for a, b in pairwise(steps))
    assert ach.level_of("chronist", 0) == 0
    assert ach.level_of("chronist", 14) == 4
    assert ach.level_of("chronist", 99_999) == 30
    levels = {"chronist": 18, "quelle": 12, "staffel": 16, "ordnung": 9, "atem": 6, "bruecke": 4}
    assert ach.allrounder(levels) == 12
    assert ach.wreaths(levels) == [6, 5, 3, 2, 0, 0]


@pytest.mark.db
def test_off_by_default_and_counts_only_after_enabling(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    data = max_.get(ERFOLGE).json()
    assert data["enabled"] is False and data["total"] == 0
    ticket = new_ticket(max_, areas["it"])
    solve = {
        "expected_status": "new",
        "expected_assignee_oid": None,
        "status": "solved",
        "solution": {"text": "Toner getauscht.", "public": False},
    }
    assert max_.patch(f"{BASE}/{ticket['number']}", json=solve).status_code == 200
    # Vor dem Einschalten zählt nichts, auch nicht rückwirkend
    enable(max_)
    assert level(max_, "chronist") == (0, 0)
    second = new_ticket(max_, areas["it"])
    assert max_.patch(f"{BASE}/{second['number']}", json=solve).status_code == 200
    assert level(max_, "chronist") == (1, 1)
    # Ohne Beschreibung zählt die Lösung nicht
    third = new_ticket(max_, areas["it"])
    plain = {**solve, "solution": {"text": "", "public": False}}
    assert max_.patch(f"{BASE}/{third['number']}", json=plain).status_code == 200
    assert level(max_, "chronist") == (1, 1)
    # Neue Stufe wird gemeldet, bis sie gesehen ist
    assert [n["id"] for n in max_.get(ERFOLGE).json()["new"]] == ["chronist"]
    assert max_.post(f"{ERFOLGE}/gesehen").json()["new"] == []
    # Ausschalten löscht alles
    assert max_.put(ERFOLGE, json={"enabled": False}).json()["total"] == 0
    assert db.scalars(select(TicketAchievementEvent)).all() == []


@pytest.mark.db
def test_long_open_and_reply_solution(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    enable(max_)
    number = inbound(max_, areas["it"], mail())["ticket_number"]
    db.execute(
        update(Ticket)
        .where(Ticket.number == number)
        .values(created_at=now_utc() - timedelta(days=40))
    )
    db.commit()
    sent = max_.post(
        f"{BASE}/{number}/replies",
        json={
            "body": "Erledigt.",
            "status_after": "solved",
            "solution": {"text": "Neu installiert."},
        },
    )
    assert sent.status_code == 201, sent.text
    assert level(max_, "chronist") == (1, 1)
    assert level(max_, "atem") == (1, 1)


@pytest.mark.db
def test_handover_merge_forward_and_templates(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    olga = client_for("Olga Ober")
    ina = client_for("Ina Beispiel")
    for client in (max_, olga, ina):
        enable(client)
    # Übergabe des eigenen Tickets mit Notiz
    ticket = new_ticket(olga, areas["it"], assign_to_me=True)
    handed = olga.patch(
        f"{BASE}/{ticket['number']}",
        json={
            "expected_status": ticket["status"],
            "expected_assignee_oid": oid_of("Olga Ober"),
            "change_assignee": True,
            "assignee_oid": oid_of("Max Muster"),
            "handover_note": "Bitte Toner prüfen",
        },
    )
    assert handed.status_code == 200, handed.text
    assert level(olga, "staffel") == (1, 1)
    # Zusammenführen
    source = new_ticket(max_, areas["it"])["number"]
    target = new_ticket(max_, areas["it"])["number"]
    assert max_.post(f"{BASE}/{source}/merge", json={"target": target}).status_code == 200
    assert level(max_, "ordnung") == (1, 1)
    # Weiterleitung mit Antwort von außen zählt für den, der weitergeleitet hat
    number = inbound(max_, areas["it"], mail())["ticket_number"]
    max_.post(f"{BASE}/{number}/forward", json={"to": ["service@example.com"], "text": "Bitte"})
    for k in range(2):
        inbound(
            max_,
            areas["it"],
            mail(
                subject=f"AW: WG: [#T-{number}] Drucker",
                sender="service@example.com",
                message_id=f"svc{k}@example.com",
            ),
        )
    assert level(max_, "bruecke") == (1, 1)
    # Textbaustein von Ina, von Max genutzt: zählt für Ina, eigene Nutzung nicht
    template = {
        "name": "Neustart",
        "shortcut": "neustart",
        "kind": "note",
        "status_after": "",
        "body": "Bitte neu starten.",
    }
    created = ina.post(f"{SETTINGS}/areas/{areas['it']}/templates", json=template).json()
    tid = created[0]["id"]
    max_.post(f"{BASE}/{target}/notes", json={"body": "Bitte neu starten.", "templates": [tid]})
    ina.post(f"{BASE}/{target}/notes", json={"body": "Bitte neu starten.", "templates": [tid]})
    assert level(ina, "quelle") == (1, 1)


@pytest.mark.db
def test_showcase_and_visibility(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    olga = client_for("Olga Ober")
    hans = client_for("Hans Haus")
    enable(max_)
    assert max_.put(f"{ERFOLGE}/vitrine", json={"ids": ["chronist"]}).status_code == 422
    ticket = new_ticket(max_, areas["it"])
    max_.patch(
        f"{BASE}/{ticket['number']}",
        json={
            "expected_status": "new",
            "expected_assignee_oid": None,
            "status": "solved",
            "solution": {"text": "Erledigt."},
        },
    )
    assert max_.put(f"{ERFOLGE}/vitrine", json={"ids": ["chronist"]}).json()["showcase"] == [
        "chronist"
    ]
    too_many = {"ids": ["chronist", "quelle", "staffel", "ordnung"]}
    assert max_.put(f"{ERFOLGE}/vitrine", json=too_many).status_code == 422
    peek = f"{ERFOLGE}/personen/{oid_of('Max Muster')}"
    # „Nur ich“: niemand sonst sieht etwas
    assert olga.get(peek).status_code == 404
    enable(max_, "areas")
    shown = olga.get(peek)
    assert shown.status_code == 200, shown.text
    assert shown.json() == {
        "total": 1,
        "showcase": [{"id": "chronist", "name": "Chronist", "level": 1}],
    }
    # Kein gemeinsamer Bereich: nichts zu sehen
    assert hans.get(peek).status_code == 404
