# ruff: noqa: F811  (Fixtures aus test_tickets)
"""Tickets Phase 4: Aufbewahrung (Vorgabe, Abweichung, Ausnahmen, Lauf), Kennzahlen, Export,
Protokoll."""

import io
import zipfile
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from tests.test_tickets import BASE, FILES_DIR, SETTINGS, areas, client_for, db, new_ticket, oid_of  # noqa: F401
from tests.test_tickets_mail import inbound, mail, mail_with_attachments
from werkbank.config import Settings
from werkbank.core.sessions import now_utc
from werkbank.modules.tickets.files import file_path
from werkbank.modules.tickets.inbound import expire_reviews
from werkbank.modules.tickets.jobs import housekeeping
from werkbank.modules.tickets.mail_api import MailSettings
from werkbank.modules.tickets.mailbox import MailboxError, TestMailbox
from werkbank.modules.tickets.models import (
    Ticket,
    TicketArea,
    TicketAttachment,
    TicketEntry,
    TicketMailLog,
    TicketRetentionRun,
    TicketReview,
)
from werkbank.modules.tickets.notifications import tickets_notifications
from werkbank.modules.tickets.retention import months_before, run_retention

VERA = ["Tickets.Verwaltung"]


def settings() -> Settings:
    return Settings(tickets_files_dir=FILES_DIR)


def close(db: Session, number: int, months_ago: int) -> None:
    db.execute(
        update(Ticket)
        .where(Ticket.number == number)
        .values(
            status="closed",
            closed_at=months_before(now_utc(), months_ago) - timedelta(days=1),
        )
    )
    db.commit()


def test_months_before() -> None:
    assert months_before(datetime(2026, 3, 31, tzinfo=UTC), 1) == datetime(2026, 2, 28, tzinfo=UTC)
    assert months_before(datetime(2026, 1, 15, tzinfo=UTC), 13) == datetime(
        2024, 12, 15, tzinfo=UTC
    )
    assert months_before(datetime(2024, 3, 30, tzinfo=UTC), 1) == datetime(2024, 2, 29, tzinfo=UTC)


@pytest.mark.db
def test_retention_off_by_default_and_rights(db: Session, areas: dict[str, int]) -> None:
    vera = client_for("Vera Verwaltung", VERA)
    ina = client_for("Ina Beispiel")
    max_ = client_for("Max Muster")
    assert vera.get(f"{SETTINGS}/retention").json() == {"months": 0, "action": "anonymize"}
    # Vorgabe nur Ticket-Verwaltung, Abweichung nur Bereichsverwaltung
    assert (
        ina.put(f"{SETTINGS}/retention", json={"months": 12, "action": "delete"}).status_code == 404
    )
    assert max_.get(f"{SETTINGS}/areas/{areas['it']}/retention").status_code == 404
    assert (
        client_for("Hans Haus").get(f"{SETTINGS}/areas/{areas['it']}/retention").status_code == 404
    )
    ticket = new_ticket(max_, areas["it"])
    close(db, ticket["number"], 60)
    run = run_retention(db, settings())
    assert (run.anonymized, run.deleted) == (0, 0)
    assert max_.get(f"{BASE}/{ticket['number']}").json()["subject"] == "Drucker druckt nicht"
    detail = max_.get(f"{BASE}/{ticket['number']}").json()
    assert detail["retention"]["active"] is False
    assert detail["anonymized_at"] is None


@pytest.mark.db
def test_anonymize_with_hold_and_expiry(db: Session, areas: dict[str, int]) -> None:
    vera = client_for("Vera Verwaltung", VERA)
    ina = client_for("Ina Beispiel")
    max_ = client_for("Max Muster")
    assert vera.put(f"{SETTINGS}/retention", json={"months": 12, "action": "anonymize"}).json() == {
        "months": 12,
        "action": "anonymize",
    }
    first = inbound(max_, areas["it"], mail_with_attachments())
    number = first["ticket_number"]
    keys: list[str] = [
        key
        for key in db.scalars(
            select(TicketAttachment.key)
            .join(Ticket, Ticket.id == TicketAttachment.ticket_id)
            .where(Ticket.number == number, TicketAttachment.key.is_not(None))
        )
        if key
    ]
    assert keys
    kept = new_ticket(max_, areas["it"], subject="Bleibt")["number"]
    young = new_ticket(max_, areas["it"], subject="Jung")["number"]
    close(db, number, 12)
    close(db, kept, 24)
    close(db, young, 6)
    # Ausnahme nur durch die Bereichsverwaltung, mit Begründung
    assert max_.put(f"{BASE}/{kept}/hold", json={"reason": "Rechtsstreit"}).status_code == 403
    assert ina.put(f"{BASE}/{kept}/hold", json={"reason": "  "}).status_code == 422
    held = ina.put(f"{BASE}/{kept}/hold", json={"reason": "Rechtsstreit"}).json()
    assert held["retention"]["hold_reason"] == "Rechtsstreit"
    assert held["retention"]["hold_by"] == "Ina Beispiel"
    assert held["retention"]["active"] is True
    pre = ina.get(f"{SETTINGS}/areas/{areas['it']}/retention").json()
    assert pre["effective_months"] == 12
    assert pre["due"] == 1
    assert pre["due_numbers"] == [number]
    assert pre["holds"] == 1

    run = run_retention(db, settings())
    assert run.anonymized == 1
    gone = max_.get(f"{BASE}/{number}").json()
    assert gone["subject"] == "(anonymisiert)"
    assert gone["reporter_name"] == "" and gone["reporter_mail"] == ""
    assert gone["entries"] == []
    assert gone["anonymized_at"] is not None
    assert gone["permissions"]["edit"] is False
    assert gone["category"] == "" and gone["priority"] == "medium"
    for key in keys:
        path = file_path(FILES_DIR, key)
        assert path is not None and not path.exists()
    assert db.scalar(select(func.count()).where(TicketMailLog.ticket_number == number)) == 0
    # Änderungen am anonymisierten Ticket: 409
    body = {"expected_status": "closed", "expected_assignee_oid": None, "status": "in_progress"}
    assert max_.patch(f"{BASE}/{number}", json=body).status_code == 409
    assert max_.post(f"{BASE}/{number}/notes", json={"body": "x"}).status_code == 409
    assert ina.put(f"{BASE}/{number}/hold", json={"reason": "zu spät"}).status_code == 409
    # Mail mit der alten Nummer wird ein neues Ticket
    again = inbound(
        max_, areas["it"], mail(f"Re: [#T-{number}] Drucker", message_id="neu@example.com")
    )
    assert again["result"] == "neu" and again["ticket_number"] != number
    # Ausnahme und junges Ticket unberührt
    assert max_.get(f"{BASE}/{kept}").json()["subject"] == "Bleibt"
    assert max_.get(f"{BASE}/{young}").json()["subject"] == "Jung"

    # Hinweis 30 Tage vor Ende an die Bereichsverwaltung
    db.execute(
        update(Ticket)
        .where(Ticket.number == kept)
        .values(hold_until=now_utc() + timedelta(days=10))
    )
    db.commit()
    events = [
        e for e in tickets_notifications(db, Settings(), now_utc()) if e.kind == "tickets.ausnahme"
    ]
    assert [e.title for e in events] == [f"T-{kept}: Ausnahme von der Aufbewahrung endet bald"]
    # Nicht bestätigt: verfällt, Ticket im selben Lauf
    db.execute(
        update(Ticket).where(Ticket.number == kept).values(hold_until=now_utc() - timedelta(days=1))
    )
    db.commit()
    run = run_retention(db, settings())
    assert (run.holds_expired, run.anonymized) == (1, 1)
    assert max_.get(f"{BASE}/{kept}").json()["subject"] == "(anonymisiert)"
    runs = ina.get(f"{SETTINGS}/areas/{areas['it']}/retention").json()["runs"]
    assert runs[0]["holds_expired"] == 1 and runs[0]["anonymized"] == 1
    actions = [e["action"] for e in ina.get(f"{SETTINGS}/audit").json()["items"]]
    assert "aufbewahrung_lauf" in actions and "aufbewahrung_ausnahme" in actions


@pytest.mark.db
def test_area_override_delete_and_hold_lifecycle(db: Session, areas: dict[str, int]) -> None:
    ina = client_for("Ina Beispiel")
    max_ = client_for("Max Muster")
    old_first = new_ticket(max_, areas["it"])["number"]
    close(db, old_first, 30)
    rule = {"custom": True, "months": 24, "action": "delete"}
    preview = ina.post(f"{SETTINGS}/areas/{areas['it']}/retention/preview", json=rule)
    assert preview.json() == {"due": 1}
    assert (
        max_.post(f"{SETTINGS}/areas/{areas['it']}/retention/preview", json=rule).status_code == 404
    )
    # Vorschau speichert nichts
    assert ina.get(f"{SETTINGS}/areas/{areas['it']}/retention").json()["custom"] is False
    out = ina.put(
        f"{SETTINGS}/areas/{areas['it']}/retention",
        json={"custom": True, "months": 24, "action": "delete"},
    ).json()
    assert (out["effective_months"], out["effective_action"]) == (24, "delete")
    old = new_ticket(max_, areas["it"])["number"]
    held = new_ticket(max_, areas["it"])["number"]
    close(db, old, 25)
    close(db, held, 25)
    ina.put(f"{BASE}/{held}/hold", json={"reason": "Prüfung"})
    renewed = ina.put(f"{BASE}/{held}/hold", json={"reason": "Prüfung läuft"}).json()
    assert renewed["retention"]["hold_reason"] == "Prüfung läuft"
    run = run_retention(db, settings())
    assert run.deleted == 2
    assert max_.get(f"{BASE}/{old}").status_code == 404
    assert (
        db.scalar(
            select(func.count()).select_from(TicketEntry).join(Ticket).where(Ticket.number == old)
        )
        == 0
    )
    # Ausnahme aufheben: beim nächsten Lauf dran
    assert ina.delete(f"{BASE}/{held}/hold").json()["retention"]["hold_until"] is None
    assert run_retention(db, settings()).deleted == 1
    # Haustechnik bleibt bei der Vorgabe (aus)
    hans = client_for("Hans Haus")
    assert hans.get(f"{SETTINGS}/areas/{areas['ht']}/retention").json()["effective_months"] == 0
    assert db.scalar(select(func.count()).select_from(TicketRetentionRun)) == 2


@pytest.mark.db
def test_stats_only_own_areas(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    hans = client_for("Hans Haus")
    new_ticket(max_, areas["it"], assign_to_me=True)
    new_ticket(max_, areas["it"], channel="phone")
    new_ticket(hans, areas["ht"])
    stats = max_.get(f"{BASE}/stats").json()
    assert stats["open"] == 2
    assert stats["mine"] == 1
    assert stats["unassigned_new"] == stats["unassigned"] == 1
    assert stats["overdue"] is None and stats["sla"] is None
    channels = {c["key"]: c["count"] for c in stats["created_by_channel"]}
    assert channels == {"mail": 0, "manual": 1, "phone": 1}
    assert stats["open_by_category"] == [{"key": "0", "label": "Ohne Kategorie", "count": 2}]
    assert len(stats["mine_list"]) == 1 and len(stats["unassigned_list"]) == 1
    assert max_.get(f"{BASE}/stats?area={areas['ht']}").status_code == 404
    assert hans.get(f"{BASE}/stats").json()["open"] == 1


@pytest.mark.db
def test_export_only_area_admin_without_texts(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    ina = client_for("Ina Beispiel")
    new_ticket(max_, areas["it"], subject='=HYPERLINK("http://example.com")', body="Geheimer Text")
    assert max_.get(f"{BASE}/export").status_code == 403
    assert ina.get(f"{BASE}/export?area={areas['ht']}").status_code == 404
    response = ina.get(f"{BASE}/export?view=all")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "attachment" in response.headers["content-disposition"]
    sheet = zipfile.ZipFile(io.BytesIO(response.content)).read("xl/worksheets/sheet1.xml").decode()
    assert "Mail des Melders" in sheet and "m.muster@example.com" in sheet
    assert "Geheimer Text" not in sheet
    # Text bleibt Text, keine Formel
    assert "<f>" not in sheet and "inlineStr" in sheet
    assert "Frist" not in sheet
    audit = ina.get(f"{SETTINGS}/audit").json()["items"]
    assert audit[0]["action"] == "export" and audit[0]["details"]["anzahl"] == 1
    # Haustechnik-Verwaltung sieht das Protokoll der IT nicht
    hans = client_for("Hans Haus")
    assert all(e["area"] != "IT" for e in hans.get(f"{SETTINGS}/audit").json()["items"])
    assert hans.get(f"{SETTINGS}/audit?area={areas['it']}").status_code == 404
    assert max_.get(f"{SETTINGS}/audit").status_code == 404


@pytest.mark.db
def test_intake_log_and_review_expire_per_area(db: Session, areas: dict[str, int]) -> None:
    ina = client_for("Ina Beispiel")
    mail_settings = ina.get(f"{SETTINGS}/areas/{areas['it']}/mail").json()
    assert (mail_settings["intake_log_days"], mail_settings["review_days"]) == (90, 30)
    payload = {k: v for k, v in mail_settings.items() if k in MailSettings.model_fields}
    payload.update(intake_log_days=10, review_days=5)
    assert ina.put(f"{SETTINGS}/areas/{areas['it']}/mail", json=payload).status_code == 200
    payload["intake_log_days"] = 3
    assert ina.put(f"{SETTINGS}/areas/{areas['it']}/mail", json=payload).status_code == 422
    now = now_utc()
    old, young = now - timedelta(days=11), now - timedelta(days=2)
    db.add_all(
        [
            TicketMailLog(
                area_id=areas["it"], result="ignoriert", sender="a@x.example", created_at=old
            ),
            TicketMailLog(
                area_id=areas["it"], result="ignoriert", sender="b@x.example", created_at=young
            ),
            TicketMailLog(
                area_id=areas["it"],
                result="neu",
                sender="c@x.example",
                created_at=old,
                ticket_number=4711,
            ),
            # Haustechnik behält die Vorgabe von 90 Tagen
            TicketMailLog(
                area_id=areas["ht"], result="ignoriert", sender="d@x.example", created_at=old
            ),
            TicketReview(
                area_id=areas["it"],
                graph_id="g1",
                message_id="r1@example.com",
                sender="x@fremd.example",
                raw=b"x",
                received_at=now - timedelta(days=6),
            ),
            TicketReview(
                area_id=areas["it"],
                graph_id="g2",
                message_id="r2@example.com",
                sender="y@fremd.example",
                raw=b"x",
                received_at=now - timedelta(days=1),
            ),
        ]
    )
    db.commit()
    # Benachrichtigung an die Bereichsverwaltung, ohne Absender
    events = [
        e for e in tickets_notifications(db, Settings(), now_utc()) if e.kind == "tickets.pruefen"
    ]
    assert len(events) == 2
    assert {e.title for e in events} == {"Neue Mail zu prüfen im Bereich IT"}
    assert all("fremd" not in e.title for e in events)
    housekeeping(db)
    senders = set(db.scalars(select(TicketMailLog.sender)))
    assert senders == {"b@x.example", "c@x.example", "d@x.example"}

    class Broken(TestMailbox):
        def move(self, mailbox: str, graph_id: str, folder: str) -> None:
            raise MailboxError("weg")

    area = db.get(TicketArea, areas["it"])
    assert area is not None
    # Klappt das Verschieben nicht, bleibt der Eintrag
    assert expire_reviews(db, Broken(), area) == 0
    assert expire_reviews(db, TestMailbox(), area) == 1
    assert list(db.scalars(select(TicketReview.message_id))) == ["r2@example.com"]
    actions = [e["action"] for e in ina.get(f"{SETTINGS}/audit").json()["items"]]
    assert "pruefen_verfallen" in actions
