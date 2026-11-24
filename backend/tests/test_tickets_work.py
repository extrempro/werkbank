# ruff: noqa: F811  (Fixtures aus test_tickets)
"""Tickets Phase 3: Fristen mit Arbeitszeit, Kategorien, Erinnerung, Zusammenführen, Geräte,
Textbausteine, Benachrichtigungen, Mail „Frist nicht eingehalten“."""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from tests.test_tickets import BASE, SETTINGS, areas, client_for, db, new_ticket, oid_of  # noqa: F401
from tests.test_tickets_mail import inbound, mail
from werkbank.config import Settings
from werkbank.core.sessions import now_utc
from werkbank.modules.tickets.jobs import sla_missed_mails
from werkbank.modules.tickets.models import Ticket, TicketArea, TicketMailOut
from werkbank.modules.tickets.notifications import tickets_notifications
from werkbank.modules.tickets.service import fire_reminders
from werkbank.modules.tickets.sla import WorkTime, _zone, add_work_minutes, work_minutes_between

BERLIN = _zone("Europe/Berlin")
WT = WorkTime(days=frozenset({0, 1, 2, 3, 4}), start=8 * 60, end=17 * 60, tz=BERLIN)


def local(*args: int) -> datetime:
    year, month, day, hour, minute = args
    return datetime(year, month, day, hour, minute, tzinfo=BERLIN)


# --- Fristberechnung ------------------------------------------------------------------------


def test_add_work_minutes_within_day_and_over_weekend() -> None:
    # Freitag 2026-11-20 16:00 + 2 Stunden → Montag 09:00
    assert add_work_minutes(local(2026, 11, 20, 16, 0), 120, WT) == local(2026, 11, 23, 9, 0)
    # Vor Arbeitsbeginn: zählt ab 8 Uhr
    assert add_work_minutes(local(2026, 11, 23, 6, 0), 60, WT) == local(2026, 11, 23, 9, 0)
    # Samstag: ab Montag 8 Uhr
    assert add_work_minutes(local(2026, 11, 21, 12, 0), 30, WT) == local(2026, 11, 23, 8, 30)
    # Ganzer Tag (540 Minuten) ab Montag 8:00 → Montag 17:00
    assert add_work_minutes(local(2026, 11, 23, 8, 0), 540, WT) == local(2026, 11, 23, 17, 0)
    assert add_work_minutes(local(2026, 11, 23, 8, 0), 541, WT) == local(2026, 11, 24, 8, 1)
    assert (
        add_work_minutes(local(2026, 11, 23, 8, 0), 10, WorkTime(frozenset(), 480, 1020, BERLIN))
        is None
    )


def test_work_minutes_between() -> None:
    assert work_minutes_between(local(2026, 11, 20, 16, 0), local(2026, 11, 23, 9, 0), WT) == 120
    assert work_minutes_between(local(2026, 11, 21, 8, 0), local(2026, 11, 22, 18, 0), WT) == 0
    assert work_minutes_between(local(2026, 11, 23, 9, 0), local(2026, 11, 23, 8, 0), WT) == 0


# --- Fristen am Ticket ----------------------------------------------------------------------


def enable_sla(db: Session, area_id: int, **extra: Any) -> None:
    ina = client_for("Ina Beispiel")
    work = ina.get(f"{SETTINGS}/areas/{area_id}/work").json()
    work.update(
        {
            "sla_enabled": True,
            "work_days": [0, 1, 2, 3, 4, 5, 6],
            "work_start": 0,
            "work_end": 1440,
            **extra,
        }
    )
    response = ina.put(f"{SETTINGS}/areas/{area_id}/work", json=work)
    assert response.status_code == 200, response.text


@pytest.mark.db
def test_sla_only_where_enabled_and_pause_while_waiting(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    plain = new_ticket(max_, areas["it"])
    assert plain["sla"] is None and plain["sla_solution_due"] is None
    enable_sla(db, areas["it"])
    with_sla = new_ticket(max_, areas["it"], priority="high")
    assert with_sla["sla"] is not None
    due = datetime.fromisoformat(with_sla["sla"]["solution_due"])
    created = datetime.fromisoformat(with_sla["created_at"])
    # Minutengenau (Sekunden fallen beim Tageswechsel weg)
    assert abs((due - created).total_seconds() / 60 - 8 * 60) <= 1
    number = with_sla["number"]
    # Wartet: Frist ruht; danach um die Wartezeit später fällig
    max_.patch(
        f"{BASE}/{number}",
        json={"expected_status": "new", "expected_assignee_oid": None, "status": "waiting"},
    )
    row = db.scalar(select(Ticket).where(Ticket.number == number))
    assert row is not None and row.sla_paused_since is not None
    db.execute(
        update(Ticket)
        .where(Ticket.number == number)
        .values(sla_paused_since=now_utc() - timedelta(hours=2))
    )
    db.commit()
    max_.patch(
        f"{BASE}/{number}",
        json={"expected_status": "waiting", "expected_assignee_oid": None, "status": "in_progress"},
    )
    db.expire_all()
    row = db.scalar(select(Ticket).where(Ticket.number == number))
    assert row is not None
    assert 119 <= row.sla_paused_minutes <= 121
    assert row.sla_solution_due is not None
    assert abs((row.sla_solution_due - due).total_seconds() / 60 - row.sla_paused_minutes) < 2
    # Gelöst innerhalb der Frist: eingehalten
    solved = max_.patch(
        f"{BASE}/{number}",
        json={"expected_status": "in_progress", "expected_assignee_oid": None, "status": "solved"},
    ).json()
    assert solved["sla"]["solution_met"] is True


@pytest.mark.db
def test_sla_missed_mail_once(db: Session, areas: dict[str, int]) -> None:
    enable_sla(db, areas["it"])
    ina = client_for("Ina Beispiel")
    settings_ = ina.get(f"{SETTINGS}/areas/{areas['it']}/mail").json()
    payload = {
        k: settings_[k]
        for k in (
            "external_policy",
            "max_attachment_mb",
            "allowed_types",
            "processed_days",
            "ignored_days",
            "intake_log_days",
            "review_days",
            "reopen_policy",
            "reopen_days",
            "sender_name",
            "header_title",
            "signature",
            "ack_enabled",
            "ack_text",
            "mail_events",
        )
    }
    payload["mail_events"]["sla_missed"] = True
    assert ina.put(f"{SETTINGS}/areas/{areas['it']}/mail", json=payload).status_code == 200
    max_ = client_for("Max Muster")
    number = inbound(max_, areas["it"], mail(message_id="sla1@example.com"))["ticket_number"]
    db.execute(
        update(Ticket)
        .where(Ticket.number == number)
        .values(sla_solution_due=now_utc() - timedelta(minutes=1))
    )
    db.commit()
    settings = Settings(environment="test", enable_test_login=True)
    assert sla_missed_mails(db, settings) == 1
    assert sla_missed_mails(db, settings) == 0
    assert (
        db.scalar(select(TicketMailOut.kind).where(TicketMailOut.kind == "sla_missed"))
        == "sla_missed"
    )


# --- Kategorien und Erinnerung -------------------------------------------------------------


@pytest.mark.db
def test_categories(db: Session, areas: dict[str, int]) -> None:
    ina = client_for("Ina Beispiel")
    cats = ina.post(
        f"{SETTINGS}/areas/{areas['it']}/categories",
        json={"name": "Drucker", "default_priority": "high"},
    ).json()
    assert (
        ina.post(f"{SETTINGS}/areas/{areas['it']}/categories", json={"name": "Drucker"}).status_code
        == 409
    )
    other = (
        client_for("Hans Haus")
        .post(f"{SETTINGS}/areas/{areas['ht']}/categories", json={"name": "Heizung"})
        .json()
    )
    max_ = client_for("Max Muster")
    # Mitglieder sehen die aktiven Kategorien ihres Bereichs, fremde Bereiche nicht
    member = max_.get(f"{BASE}/areas/{areas['it']}/categories")
    assert [c["name"] for c in member.json()] == ["Drucker"]
    assert max_.get(f"{BASE}/areas/{areas['ht']}/categories").status_code == 404
    ticket = new_ticket(max_, areas["it"], category_id=cats[0]["id"])
    assert ticket["category"] == "Drucker"
    assert [c["name"] for c in ticket["categories"]] == ["Drucker"]
    assert (
        max_.post(
            BASE,
            json={
                "area_id": areas["it"],
                "subject": "x",
                "reporter_name": "y",
                "body": "z",
                "category_id": other[0]["id"],
            },
        ).status_code
        == 422
    )
    changed = max_.put(
        f"{BASE}/{ticket['number']}/details",
        json={"priority": "low", "participants": [], "category_id": None},
    ).json()
    assert changed["category"] == ""
    assert "Kategorie: Drucker → keine" in [e["body"] for e in changed["entries"]]
    # Nur Bereichsverwaltung pflegt Kategorien
    assert (
        max_.post(f"{SETTINGS}/areas/{areas['it']}/categories", json={"name": "X"}).status_code
        == 404
    )


@pytest.mark.db
def test_reminder_and_notification(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    ticket = new_ticket(max_, areas["it"], assign_to_me=True)
    number = ticket["number"]
    base = {
        "expected_status": "new",
        "expected_assignee_oid": oid_of("Max Muster"),
        "status": "reminder",
    }
    assert max_.patch(f"{BASE}/{number}", json=base).status_code == 422
    past = (now_utc() - timedelta(hours=1)).isoformat()
    assert max_.patch(f"{BASE}/{number}", json={**base, "reminder_at": past}).status_code == 422
    future = (now_utc() + timedelta(days=1)).replace(hour=7, minute=0).isoformat()
    set_ = max_.patch(
        f"{BASE}/{number}", json={**base, "reminder_at": future, "reminder_note": "Toner"}
    ).json()
    assert set_["status"] == "reminder"
    assert set_["reminder_note"] == "Toner"
    assert any("Erinnerung am" in e["body"] for e in set_["entries"])
    db.execute(
        update(Ticket)
        .where(Ticket.number == number)
        .values(reminder_at=now_utc() - timedelta(minutes=1))
    )
    db.commit()
    assert fire_reminders(db) == 1
    db.commit()
    after = max_.get(f"{BASE}/{number}").json()
    assert after["status"] == "in_progress"
    assert after["reminder_note"] == ""
    events = [
        e
        for e in tickets_notifications(db, Settings(), now_utc())
        if e.kind == "tickets.erinnerung"
    ]
    assert [e.title for e in events] == [f"Erinnerung zu T-{number}"]


@pytest.mark.db
def test_handover_notification_only_for_others(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    client_for("Olga Ober")  # damit es den Benutzer gibt
    mine = new_ticket(max_, areas["it"], assign_to_me=True)
    handed = new_ticket(max_, areas["it"], assign_to_me=True)
    silent = new_ticket(max_, areas["it"], assign_to_me=True)
    expected = {
        "expected_status": "new",
        "expected_assignee_oid": oid_of("Max Muster"),
        "change_assignee": True,
        "assignee_oid": oid_of("Olga Ober"),
    }
    max_.patch(f"{BASE}/{handed['number']}", json=expected)
    max_.patch(f"{BASE}/{silent['number']}", json={**expected, "notify_assignee": False})
    titles = [
        e.title
        for e in tickets_notifications(db, Settings(), now_utc())
        if e.kind == "tickets.zugewiesen"
    ]
    assert titles == [f"T-{handed['number']} ist dir zugewiesen"]
    assert f"T-{mine['number']}" not in " ".join(titles)


# --- Zusammenführen -------------------------------------------------------------------------


@pytest.mark.db
def test_merge(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    target = inbound(
        max_,
        areas["it"],
        mail(subject="Drucker im Raum A druckt nicht", message_id="mt@example.com"),
    )["ticket_number"]
    source = inbound(
        max_,
        areas["it"],
        mail(
            subject="Drucker Raum A leer", sender="kollege@example.com", message_id="ms@example.com"
        ),
    )["ticket_number"]
    suggestions = max_.get(f"{BASE}/{source}/merge-candidates").json()
    assert target in [s["number"] for s in suggestions]
    assert len(suggestions) <= 3
    hits = max_.get(f"{BASE}/{source}/merge-candidates", params={"q": f"T-{target}"}).json()
    assert [h["number"] for h in hits] == [target]
    # Ohne Rolle im Bereich: nicht gefunden
    assert (
        client_for("Lea Lesen").post(f"{BASE}/{source}/merge", json={"target": target}).status_code
        == 404
    )
    merged = max_.post(f"{BASE}/{source}/merge", json={"target": target, "notify_reporter": True})
    assert merged.status_code == 200, merged.text
    data = merged.json()
    assert any(e["from_number"] == source for e in data["entries"])
    assert "kollege@example.com" in [p["mail"] for p in data["participants"]]
    src = max_.get(f"{BASE}/{source}").json()
    assert src["status"] == "merged" and src["merged_into"] == target
    # Antwort auf eine Mail der Quelle landet im Ziel
    reply = inbound(
        max_,
        areas["it"],
        mail(
            subject=f"AW: [#T-{source}] x",
            sender="kollege@example.com",
            message_id="mr@example.com",
        ),
    )
    assert reply["ticket_number"] == target
    outbox = max_.get(f"{BASE}/test/outbox", params={"ticket": target}).json()
    assert "zusammengefuehrt" in [o["kind"] for o in outbox]
    # Nicht nochmal, nicht in anderen Bereich
    assert max_.post(f"{BASE}/{source}/merge", json={"target": target}).status_code == 409


# --- Geräte und Textbausteine ---------------------------------------------------------------


@pytest.mark.db
def test_templates(db: Session, areas: dict[str, int]) -> None:
    ina = client_for("Ina Beispiel")
    body = {
        "name": "Neustart",
        "shortcut": "/Neustart",
        "kind": "reply",
        "status_after": "waiting",
        "body": "Hallo {Vorname}, bitte starte neu ({Nr}).",
    }
    created = ina.post(f"{SETTINGS}/areas/{areas['it']}/templates", json=body).json()
    assert created[0]["shortcut"] == "neustart"
    assert ina.post(f"{SETTINGS}/areas/{areas['it']}/templates", json=body).status_code == 409
    bad = {**body, "shortcut": "mit leer"}
    assert ina.post(f"{SETTINGS}/areas/{areas['it']}/templates", json=bad).status_code == 422
    note = {**body, "name": "Intern", "shortcut": "intern", "kind": "note", "status_after": ""}
    ina.post(f"{SETTINGS}/areas/{areas['it']}/templates", json=note)
    max_ = client_for("Max Muster")
    ticket = new_ticket(max_, areas["it"])
    data = max_.get(f"{BASE}/{ticket['number']}/templates").json()
    assert {t["shortcut"] for t in data["templates"]} == {"neustart", "intern"}
    assert data["values"]["Vorname"] == "M."
    assert data["values"]["Nr"] == f"T-{ticket['number']}"
    assert client_for("Lea Lesen").get(f"{BASE}/{ticket['number']}/templates").status_code == 404
    assert max_.post(f"{SETTINGS}/areas/{areas['it']}/templates", json=note).status_code == 404
    deleted = ina.delete(f"{SETTINGS}/areas/{areas['it']}/templates/{created[0]['id']}").json()
    assert [t["shortcut"] for t in deleted] == ["intern"]


__all__ = ["UTC", "TicketArea"]


# --- Lösung bei „Gelöst“ ---------------------------------------------------------------------


@pytest.mark.db
def test_solution_types_and_solved_with_solution(db: Session, areas: dict[str, int]) -> None:
    from werkbank.modules.tickets.models import Ticket, TicketArea
    from werkbank.modules.tickets.outbound import build_message

    ina = client_for("Ina Beispiel")
    kinds = ina.post(
        f"{SETTINGS}/areas/{areas['it']}/solution-types", json={"name": "Behoben"}
    ).json()
    assert [k["name"] for k in kinds] == ["Behoben"]
    assert (
        ina.post(
            f"{SETTINGS}/areas/{areas['it']}/solution-types", json={"name": "Behoben"}
        ).status_code
        == 409
    )
    other = (
        client_for("Hans Haus")
        .post(f"{SETTINGS}/areas/{areas['ht']}/solution-types", json={"name": "Getauscht"})
        .json()
    )
    max_ = client_for("Max Muster")
    # Ohne Bereichsverwaltung keine Einstellungen
    assert max_.post(
        f"{SETTINGS}/areas/{areas['it']}/solution-types", json={"name": "X"}
    ).status_code in (403, 404)
    ticket = new_ticket(max_, areas["it"])
    number = ticket["number"]
    assert [k["name"] for k in ticket["solution_types"]] == ["Behoben"]
    assert ticket["solution"] is None
    base = {"expected_status": "new", "expected_assignee_oid": None, "status": "solved"}
    # Lösungsart eines fremden Bereichs: abgelehnt
    wrong = {**base, "solution": {"type_id": other[0]["id"], "text": ""}}
    assert max_.patch(f"{BASE}/{number}", json=wrong).status_code == 422
    solved = max_.patch(
        f"{BASE}/{number}",
        json={
            **base,
            "solution": {"type_id": kinds[0]["id"], "text": "Netzteil getauscht.", "public": True},
        },
    ).json()
    assert solved["status"] == "solved"
    assert solved["solution"] == {
        "type_id": kinds[0]["id"],
        "type_name": "Behoben",
        "text": "Netzteil getauscht.",
        "public": True,
    }
    assert any(
        e["kind"] == "system" and e["body"].startswith("Lösung: Behoben") for e in solved["entries"]
    )
    # Die Mail an den Melder zeigt die Lösung, nur wenn freigegeben
    row = db.scalar(select(Ticket).where(Ticket.number == number))
    assert row is not None
    area = db.get(TicketArea, row.area_id)
    assert area is not None
    message, _, _ = build_message(db, area, row, "Gelöst.", auto=True)
    html = message.get_body(("html",))
    assert html is not None and "Lösungsart" in html.get_content()
    assert "Netzteil getauscht." in html.get_content()
    row.solution_public = False
    message, _, _ = build_message(db, area, row, "Gelöst.", auto=True)
    html = message.get_body(("html",))
    assert html is not None and "Netzteil getauscht." not in html.get_content()
    db.rollback()
    # Statistik: gelöst nach Lösungsart
    stats = max_.get(f"{BASE}/stats").json()
    assert {"key": "Behoben", "label": "Behoben", "count": 1} in stats["solved_by_type"]
    # Deaktivierte Art steht nicht mehr zur Auswahl
    ina.put(
        f"{SETTINGS}/areas/{areas['it']}/solution-types/{kinds[0]['id']}",
        json={"name": "Behoben", "active": False},
    )
    assert max_.get(f"{BASE}/{number}").json()["solution_types"] == []
