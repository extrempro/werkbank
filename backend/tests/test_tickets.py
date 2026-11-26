"""Tickets (Phase 1): Bereiche, Rollen je Bereich mit Gruppen, Sichtbarkeit, Anlegen, Status und
Zuständigkeit, Notizen, Verschieben, automatisches Schließen. Gruppen kommen aus der Testquelle."""

import tempfile
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.deps import STEP_UP_HEADER
from werkbank.core.models import UserSession
from werkbank.core.sessions import SESSION_COOKIE, hash_token, now_utc
from werkbank.main import create_app
from werkbank.modules.tickets.jobs import housekeeping
from werkbank.modules.tickets.models import (
    Ticket,
    TicketArea,
    TicketAreaGrant,
    TicketAudit,
    TicketEntry,
    TicketGroupMember,
    TicketMembershipCache,
    TicketParticipant,
    TicketRetention,
    TicketRetentionRun,
)

ORIGIN = "https://testserver"
HEADERS = {"Origin": ORIGIN}
BASE = "/api/tickets"
SETTINGS = f"{BASE}/settings"
KEY_FILE = Path(tempfile.mkdtemp()) / "settings_key"
KEY_FILE.write_text("nur-fuer-tests-" + "x" * 40, encoding="utf-8")
FILES_DIR = Path(tempfile.mkdtemp())

IT_GROUP = "11111111-1111-1111-1111-111111111111"
HT_GROUP = "22222222-2222-2222-2222-222222222222"

pytestmark = pytest.mark.db


def client_for(name: str, roles: list[str] | None = None) -> TestClient:
    settings = Settings(
        public_url=ORIGIN,
        environment="test",
        enable_test_login=True,
        settings_key_file=KEY_FILE,
        tickets_files_dir=FILES_DIR,
    )
    client = TestClient(
        create_app(settings), base_url=ORIGIN, follow_redirects=False, headers=HEADERS
    )
    oid = name.lower().replace(" ", "-")
    response = client.post(
        "/auth/test-login", json={"oid": oid, "name": name, "roles": roles or ["Tickets.Nutzer"]}
    )
    assert response.status_code == 303, response.text
    return client


def oid_of(name: str) -> str:
    return "test:" + name.lower().replace(" ", "-")


def join(db: Session, group: str, name: str) -> None:
    db.add(
        TicketGroupMember(
            group_oid=group, oid=oid_of(name), name=name, mail="", synced_at=now_utc()
        )
    )
    db.execute(delete(TicketMembershipCache).where(TicketMembershipCache.oid == oid_of(name)))
    db.commit()


@pytest.fixture
def db(db_session: Session) -> Session:
    for table in (
        TicketParticipant,
        TicketEntry,
        Ticket,
        TicketAreaGrant,
        TicketArea,
        TicketGroupMember,
        TicketMembershipCache,
        TicketAudit,
        TicketRetention,
        TicketRetentionRun,
    ):
        db_session.execute(delete(table))
    db_session.commit()
    return db_session


@pytest.fixture
def areas(db: Session) -> dict[str, int]:
    """Bereiche IT (Gruppe bearbeitet, Ina Beispiel verwaltet) und Haustechnik."""
    manager = client_for("Vera Verwaltung", ["Tickets.Verwaltung"])
    it = manager.post(
        f"{SETTINGS}/areas",
        json={
            "name": "IT",
            "mailbox": "it@example.com",
            "admin": {
                "role": "admin",
                "kind": "person",
                "oid": oid_of("Ina Beispiel"),
                "name": "Ina Beispiel",
            },
        },
    )
    assert it.status_code == 201, it.text
    ht = manager.post(
        f"{SETTINGS}/areas",
        json={
            "name": "Haustechnik",
            "admin": {"role": "admin", "kind": "group", "oid": HT_GROUP, "name": "Haustechnik"},
        },
    )
    assert ht.status_code == 201, ht.text
    it_id, ht_id = it.json()["id"], ht.json()["id"]
    for grant in ({"role": "edit", "kind": "group", "oid": IT_GROUP, "name": "IT-Team"},):
        assert manager.post(f"{SETTINGS}/areas/{it_id}/grants", json=grant).status_code == 201
    for name in ("Max Muster", "Olga Ober"):
        join(db, IT_GROUP, name)
    join(db, HT_GROUP, "Hans Haus")
    return {"it": it_id, "ht": ht_id}


def new_ticket(client: TestClient, area: int, **extra: Any) -> dict[str, Any]:
    body = {
        "area_id": area,
        "subject": "Drucker druckt nicht",
        "reporter_name": "M. Muster",
        "reporter_mail": "m.muster@example.com",
        "body": "Seit heute früh.",
        **extra,
    }
    response = client.post(BASE, json=body)
    assert response.status_code == 201, response.text
    data: dict[str, Any] = response.json()
    return data


def test_manager_sees_settings_but_no_tickets(areas: dict[str, int]) -> None:
    manager = client_for("Vera Verwaltung", ["Tickets.Verwaltung"])
    me = manager.get(f"{BASE}/me").json()
    assert me == {
        "oid": oid_of("Vera Verwaltung"),
        "manager": True,
        "settings": True,
        "areas": [],
    }
    max_ = client_for("Max Muster")
    ticket = new_ticket(max_, areas["it"])
    assert manager.get(f"{BASE}/{ticket['number']}").status_code == 404
    assert manager.get(BASE).json()["total"] == 0
    assert len(manager.get(SETTINGS).json()["areas"]) == 2


def test_visibility_is_per_area_and_404(areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    hans = client_for("Hans Haus")
    me = max_.get(f"{BASE}/me").json()
    assert [(a["name"], a["role"]) for a in me["areas"]] == [("IT", "edit")]
    assert me["settings"] is False
    ticket = new_ticket(max_, areas["it"])
    # Fremder Bereich: nicht in der Liste, Direktaufruf 404 (nicht 403)
    assert hans.get(BASE, params={"view": "all"}).json()["total"] == 0
    assert hans.get(f"{BASE}/{ticket['number']}").status_code == 404
    assert hans.post(f"{BASE}/{ticket['number']}/notes", json={"body": "x"}).status_code == 404
    # Suche über Nr.
    found = max_.get(BASE, params={"q": f"T-{ticket['number']}"}).json()
    assert [t["number"] for t in found["items"]] == [ticket["number"]]
    # Niemand ohne Rolle sieht etwas
    nobody = client_for("Nora Niemand")
    assert nobody.get(f"{BASE}/me").json()["areas"] == []
    assert nobody.get(SETTINGS).status_code == 403


def test_losing_group_membership_removes_access(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    ticket = new_ticket(max_, areas["it"])
    db.execute(delete(TicketGroupMember).where(TicketGroupMember.oid == oid_of("Max Muster")))
    # Solange der Zwischenspeicher gilt, bleibt der Zugriff; danach ist er weg
    assert max_.get(f"{BASE}/{ticket['number']}").status_code == 200
    db.execute(
        delete(TicketMembershipCache).where(TicketMembershipCache.oid == oid_of("Max Muster"))
    )
    db.commit()
    assert max_.get(f"{BASE}/{ticket['number']}").status_code == 404


def test_no_read_only_role(areas: dict[str, int]) -> None:
    """Die Rolle „Nur lesen“ gibt es nicht mehr; wer keine Rolle hat, sieht nichts."""
    manager = client_for("Vera Verwaltung", ["Tickets.Verwaltung"])
    grant = {"role": "read", "kind": "person", "oid": oid_of("Lea Lesen"), "name": "Lea Lesen"}
    assert manager.post(f"{SETTINGS}/areas/{areas['it']}/grants", json=grant).status_code == 422
    max_ = client_for("Max Muster")
    number = new_ticket(max_, areas["it"])["number"]
    lea = client_for("Lea Lesen")
    assert lea.get(f"{BASE}/{number}").status_code == 404
    assert lea.post(f"{BASE}/{number}/notes", json={"body": "x"}).status_code == 404


def test_status_and_handover_rules(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    olga = client_for("Olga Ober")
    ina = client_for("Ina Beispiel")
    ticket = new_ticket(max_, areas["it"])
    number = ticket["number"]
    assert ticket["assignee_oid"] is None
    # Olga nimmt das freie Ticket und setzt den Status
    taken = olga.patch(
        f"{BASE}/{number}",
        json={
            "expected_status": "new",
            "expected_assignee_oid": None,
            "status": "in_progress",
            "change_assignee": True,
            "assignee_oid": oid_of("Olga Ober"),
        },
    )
    assert taken.status_code == 200, taken.text
    assert taken.json()["status"] == "in_progress"
    assert taken.json()["assignee_name"] == "Olga Ober"
    # Max darf Olgas Ticket nicht übergeben
    denied = max_.patch(
        f"{BASE}/{number}",
        json={
            "expected_status": "in_progress",
            "expected_assignee_oid": oid_of("Olga Ober"),
            "change_assignee": True,
            "assignee_oid": oid_of("Max Muster"),
        },
    )
    assert denied.status_code == 403
    # Veralteter Stand: 409
    stale = olga.patch(f"{BASE}/{number}", json={"expected_status": "new", "status": "solved"})
    assert stale.status_code == 409
    # Olga übergibt an Max mit Übergabenotiz
    handed = olga.patch(
        f"{BASE}/{number}",
        json={
            "expected_status": "in_progress",
            "expected_assignee_oid": oid_of("Olga Ober"),
            "change_assignee": True,
            "assignee_oid": oid_of("Max Muster"),
            "handover_note": "Bitte Toner prüfen",
        },
    )
    assert handed.status_code == 200
    kinds = [(e["kind"], e["body"]) for e in handed.json()["entries"]]
    assert ("system", "Zuständig: Olga Ober → Max Muster") in kinds
    assert ("note", "Bitte Toner prüfen") in kinds
    # Bereichsverwaltung darf jede Zuständigkeit ändern, nur an Personen des Bereichs
    bad = ina.patch(
        f"{BASE}/{number}",
        json={
            "expected_status": "in_progress",
            "expected_assignee_oid": oid_of("Max Muster"),
            "change_assignee": True,
            "assignee_oid": oid_of("Hans Haus"),
        },
    )
    assert bad.status_code == 422
    ok = ina.patch(
        f"{BASE}/{number}",
        json={
            "expected_status": "in_progress",
            "expected_assignee_oid": oid_of("Max Muster"),
            "change_assignee": True,
            "assignee_oid": None,
        },
    )
    assert ok.json()["assignee_oid"] is None
    # Unzulässige Status
    assert (
        ina.patch(
            f"{BASE}/{number}", json={"expected_status": "in_progress", "status": "merged"}
        ).status_code
        == 422
    )
    actions = set(db.scalars(select(TicketAudit.action)))
    assert {"ticket_status", "ticket_zustaendig", "ticket_angelegt", "rolle_vergeben"} <= actions


def test_round_robin_skips_read_only_and_admin(areas: dict[str, int]) -> None:
    ina = client_for("Ina Beispiel")
    response = ina.put(
        f"{SETTINGS}/areas/{areas['it']}/assignment", json={"assignment": "round_robin"}
    )
    assert response.status_code == 200
    max_ = client_for("Max Muster")
    first = new_ticket(max_, areas["it"])
    second = new_ticket(max_, areas["it"])
    third = new_ticket(max_, areas["it"])
    names = [first["assignee_name"], second["assignee_name"], third["assignee_name"]]
    assert set(names[:2]) == {"Max Muster", "Olga Ober"}
    assert "Lea Lesen" not in names and "Ina Beispiel" not in names


def test_move_and_lose_access(areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    hans = client_for("Hans Haus")
    ticket = new_ticket(max_, areas["it"])
    moved = max_.post(f"{BASE}/{ticket['number']}/move", json={"area_id": areas["ht"]})
    assert moved.json() == {"visible": False, "ticket": None}
    assert max_.get(f"{BASE}/{ticket['number']}").status_code == 404
    detail = hans.get(f"{BASE}/{ticket['number']}").json()
    assert detail["area"]["name"] == "Haustechnik"
    assert detail["entries"][-1]["body"] == "Verschoben: IT → Haustechnik"


def test_settings_rights(areas: dict[str, int]) -> None:
    ina = client_for("Ina Beispiel")
    # Bereichsverwaltung sieht nur ihren Bereich, vergibt Bearbeiten, aber keine Bereichsverwaltung
    data = ina.get(SETTINGS).json()
    assert [a["name"] for a in data["areas"]] == ["IT"]
    assert ina.get(f"{SETTINGS}/areas/{areas['ht']}/grants").status_code in (404, 405)
    grant = {"role": "admin", "kind": "person", "oid": oid_of("Max Muster"), "name": "Max Muster"}
    assert ina.post(f"{SETTINGS}/areas/{areas['it']}/grants", json=grant).status_code == 403
    grant["role"] = "edit"
    assert ina.post(f"{SETTINGS}/areas/{areas['it']}/grants", json=grant).status_code == 201
    assert ina.post(f"{SETTINGS}/areas/{areas['it']}/grants", json=grant).status_code == 409
    assert ina.post(f"{SETTINGS}/areas/{areas['ht']}/grants", json=grant).status_code == 404
    assert ina.post(f"{SETTINGS}/areas", json={"name": "X", "admin": grant}).status_code == 403
    # Letzte Bereichsverwaltung bleibt
    manager = client_for("Vera Verwaltung", ["Tickets.Verwaltung"])
    it = next(a for a in manager.get(SETTINGS).json()["areas"] if a["name"] == "IT")
    admin = next(g for g in it["grants"] if g["role"] == "admin")
    assert manager.delete(f"{SETTINGS}/areas/{areas['it']}/grants/{admin['id']}").status_code == 409
    # Ungültige Kennung
    bad = {"role": "edit", "kind": "person", "oid": "nicht-gueltig", "name": "X"}
    assert manager.post(f"{SETTINGS}/areas/{areas['it']}/grants", json=bad).status_code == 422
    # Name doppelt
    dup = {
        "name": "it",
        "admin": {"role": "admin", "kind": "person", "oid": oid_of("Ina Beispiel"), "name": "Ina"},
    }
    assert manager.post(f"{SETTINGS}/areas", json=dup).status_code == 409


def test_area_colors(areas: dict[str, int]) -> None:
    manager = client_for("Vera Verwaltung", ["Tickets.Verwaltung"])
    colors = {a["name"]: a["color"] for a in manager.get(SETTINGS).json()["areas"]}
    # Neue Bereiche bekommen die am wenigsten genutzte Farbe
    assert colors == {"IT": "blau", "Haustechnik": "petrol"}
    body = {"name": "IT", "mailbox": "it@example.com", "active": True, "color": "orange"}
    assert manager.put(f"{SETTINGS}/areas/{areas['it']}", json=body).json()["color"] == "orange"
    # Ohne Farbe bleibt sie, unbekannte Farben werden abgelehnt
    del body["color"]
    assert manager.put(f"{SETTINGS}/areas/{areas['it']}", json=body).json()["color"] == "orange"
    body["color"] = "#ff0000"
    assert manager.put(f"{SETTINGS}/areas/{areas['it']}", json=body).status_code == 422
    # Farbe ändert nur die Ticket-Verwaltung
    ina = client_for("Ina Beispiel")
    body["color"] = "gruen"
    assert ina.put(f"{SETTINGS}/areas/{areas['it']}", json=body).status_code == 403
    # Die eigene Sicht kennt Kennung und Farben der Bereiche
    me = client_for("Max Muster").get(f"{BASE}/me").json()
    assert me["oid"] == oid_of("Max Muster")
    assert [(a["name"], a["color"]) for a in me["areas"]] == [("IT", "orange")]
    # Am einzelnen Ticket steht die Farbe des Bereichs mit
    max_ = client_for("Max Muster")
    ticket = new_ticket(max_, areas["it"])
    assert ticket["area"]["color"] == "orange"
    assert max_.get(f"{BASE}/{ticket['number']}").json()["area"]["color"] == "orange"


def test_auto_close_after_five_days(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    ticket = new_ticket(max_, areas["it"], assign_to_me=True)
    number = ticket["number"]
    max_.patch(
        f"{BASE}/{number}",
        json={
            "expected_status": "new",
            "expected_assignee_oid": oid_of("Max Muster"),
            "status": "solved",
        },
    )
    row = db.scalar(select(Ticket).where(Ticket.number == number))
    assert row is not None
    row.solved_at = now_utc() - timedelta(days=6)
    db.commit()
    housekeeping(db)
    db.refresh(row)
    assert row.status == "closed"
    assert row.closed_at is not None


def test_create_validates_input(areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    base = {"area_id": areas["it"], "subject": "x", "reporter_name": "y", "body": "z"}
    assert max_.post(BASE, json={**base, "reporter_mail": "keine-adresse"}).status_code == 422
    assert max_.post(BASE, json={**base, "subject": "   "}).status_code == 422
    assert max_.post(BASE, json={**base, "area_id": areas["ht"]}).status_code == 404
    created = new_ticket(
        max_,
        areas["it"],
        participants=[{"name": "A", "mail": "A@example.com"}, {"mail": "a@example.com"}],
        channel="phone",
    )
    assert created["participants"] == [{"name": "A", "mail": "a@example.com"}]
    assert created["channel"] == "phone"
    assert created["entries"][0]["original"] is True


def test_test_membership_endpoint_only_in_test() -> None:
    settings = Settings(
        public_url=ORIGIN,
        environment="production",
        settings_key_file=KEY_FILE,
        tickets_files_dir=FILES_DIR,
    )
    client = TestClient(create_app(settings), base_url=ORIGIN, headers=HEADERS)
    response = client.post(f"{BASE}/test/membership", json={"group_oid": "g", "oid": "o"})
    assert response.status_code in (401, 403, 404)


def test_granting_rights_needs_recent_login(db: Session, areas: dict[str, int]) -> None:
    """Rollen vergeben und entziehen nur mit frischer Anmeldung (wie in der Verwaltung)."""
    manager = client_for("Vera Verwaltung", ["Tickets.Verwaltung"])
    token = manager.cookies.get(SESSION_COOKIE) or ""
    db.execute(
        update(UserSession)
        .where(UserSession.token_hash == hash_token(token))
        .values(authenticated_at=now_utc() - timedelta(minutes=16))
    )
    db.commit()
    me = {"role": "admin", "kind": "person", "oid": oid_of("Vera Verwaltung"), "name": "Vera"}
    stale = manager.post(f"{SETTINGS}/areas/{areas['it']}/grants", json=me)
    assert stale.status_code == 403 and stale.headers[STEP_UP_HEADER] == "required"
    new_area = manager.post(f"{SETTINGS}/areas", json={"name": "Neu", "admin": me})
    assert new_area.status_code == 403
    listed = manager.get(SETTINGS).json()["areas"]
    grants = next(a for a in listed if a["id"] == areas["it"])["grants"]
    removed = manager.delete(f"{SETTINGS}/areas/{areas['it']}/grants/{grants[-1]['id']}")
    assert removed.status_code == 403
    # Zuweisung ist kein Recht und geht weiter
    assignment = manager.put(
        f"{SETTINGS}/areas/{areas['it']}/assignment", json={"assignment": "round_robin"}
    )
    assert assignment.status_code == 200
    fresh = client_for("Vera Verwaltung", ["Tickets.Verwaltung"])
    assert fresh.post(f"{SETTINGS}/areas/{areas['it']}/grants", json=me).status_code == 201
