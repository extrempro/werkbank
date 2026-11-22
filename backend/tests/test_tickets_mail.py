# ruff: noqa: F811, E501  (Fixtures aus test_tickets; lange Zeilen sind Mail-Rohtexte)
"""Tickets Phase 2: Einlesen, Antwort-Erkennung, Filter, Zitate, Platzhalter, Eingang über den
Test-Endpunkt, Antworten und automatische Mails, Zu prüfen, Sperrliste, Anhänge."""

import base64
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from tests.test_tickets import BASE, SETTINGS, areas, client_for, db, join, new_ticket, oid_of  # noqa: F401
from werkbank.core.sessions import now_utc
from werkbank.modules.tickets.mail_texts import fill
from werkbank.modules.tickets.mailparse import (
    clean_subject,
    detect_type,
    parse,
    split_reply,
    ticket_number,
)
from werkbank.modules.tickets.models import Ticket, TicketArea, TicketMailOut
from werkbank.modules.tickets.outbound import render_html

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def mail(
    subject: str = "Drucker druckt nicht",
    body: str = "Seit heute früh kommen nur leere Seiten.",
    sender: str = "m.muster@example.com",
    *,
    message_id: str = "a1@example.com",
    headers: str = "",
    cc: str = "",
) -> str:
    extra = f"Cc: {cc}\r\n" if cc else ""
    return (
        f"From: M. Muster <{sender}>\r\nTo: it@example.com\r\n{extra}Subject: {subject}\r\n"
        f"Message-ID: <{message_id}>\r\n{headers}Content-Type: text/plain; charset=utf-8\r\n\r\n{body}\r\n"
    )


def mail_with_attachments() -> str:
    pdf = base64.b64encode(b"%PDF-1.4 test").decode()
    exe = base64.b64encode(b"MZ\x90\x00").decode()
    return (
        "From: M. Muster <m.muster@example.com>\r\nTo: it@example.com\r\nSubject: Mit Anhang\r\n"
        "Message-ID: <anh@example.com>\r\nMIME-Version: 1.0\r\n"
        'Content-Type: multipart/mixed; boundary="X"\r\n\r\n'
        "--X\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSiehe Anhang.\r\n"
        '--X\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename="rechnung.pdf"\r\n'
        f"Content-Transfer-Encoding: base64\r\n\r\n{pdf}\r\n"
        '--X\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="tool.exe"\r\n'
        f"Content-Transfer-Encoding: base64\r\n\r\n{exe}\r\n--X--\r\n"
    )


# --- ohne Datenbank -------------------------------------------------------------------------


def test_ticket_number_and_subject() -> None:
    assert ticket_number("AW: [#T-1042] Drucker") == 1042
    assert ticket_number("Drucker") is None
    assert clean_subject("AW: WG: [#T-1042]  Drucker  ") == "Drucker"
    assert clean_subject("") == "(ohne Betreff)"


@pytest.mark.parametrize(
    ("text", "new"),
    [
        ("Danke!\n\nBitte oberhalb dieser Zeile antworten.\nAlter Text", "Danke!"),
        (
            "Geht wieder.\n\nAm 22.11.2026 um 08:00 schrieb IT <it@example.com>:\n> alt",
            "Geht wieder.",
        ),
        ("Ok\n\nVon: IT\nGesendet: Montag\nAn: ich\n\nalt", "Ok"),
        ("Neu\n-----Ursprüngliche Nachricht-----\nalt", "Neu"),
        ("Ja\n> zitat\n> zitat", "Ja"),
        ("Nur neuer Text", "Nur neuer Text"),
    ],
)
def test_split_reply(text: str, new: str) -> None:
    assert split_reply(text)[0] == new


def test_split_reply_keeps_text_if_new_part_empty() -> None:
    assert split_reply("> nur Zitat")[0] == "> nur Zitat"


def test_filters_from_headers() -> None:
    auto = parse(mail(headers="Auto-Submitted: auto-replied\r\n").encode())
    assert auto.auto_reply
    oof = parse(mail(subject="Automatische Antwort: Drucker").encode())
    assert oof.auto_reply
    bulk = parse(mail(headers="List-Unsubscribe: <https://example.com/u>\r\n").encode())
    assert bulk.bulk
    bounce = parse(mail(sender="mailer-daemon@example.com").encode())
    assert bounce.bounce
    plain = parse(mail().encode())
    assert not (plain.auto_reply or plain.bulk or plain.bounce)


def test_detect_type() -> None:
    assert detect_type("a.pdf", b"%PDF-1.4") == "pdf"
    assert detect_type("a.pdf", b"MZ\x90") is None
    assert detect_type("a.png", PNG) == "png"
    assert detect_type("a.exe", b"MZ") is None
    assert detect_type("a.txt", "Grüße".encode()) == "txt"
    assert detect_type("a.docx", b"PK\x03\x04rest") == "docx"


def test_placeholders_are_escaped_in_html() -> None:
    text = fill("Hallo {Name}, {Betreff} {Unbekannt}", {"Name": "<b>Ina</b>", "Betreff": "a&b"})
    assert text == "Hallo <b>Ina</b>, a&b {Unbekannt}"
    area = TicketArea(name="IT", mailbox="it@example.com", signature="Dein <IT>-Team")
    from werkbank.modules.tickets.outbound import Design

    html = render_html(area, Design("#112233", "", "javascript:alert(1)", None), text, None)
    assert "<b>Ina</b>" not in html and "&lt;b&gt;Ina&lt;/b&gt;" in html
    assert "&lt;IT&gt;" in html
    assert "javascript:" not in html
    assert "Bitte oberhalb dieser Zeile antworten." in html


# --- mit Datenbank --------------------------------------------------------------------------


def inbound(client: TestClient, area: int, raw: str) -> dict[str, Any]:
    response = client.post(f"{BASE}/test/mail", json={"area_id": area, "raw": raw})
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()
    return data


@pytest.mark.db
def test_new_mail_and_replies(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    first = inbound(max_, areas["it"], mail(cc="kopie@example.com, it@example.com"))
    assert first["result"] == "neu"
    number = first["ticket_number"]
    ticket = max_.get(f"{BASE}/{number}").json()
    assert ticket["channel"] == "mail"
    assert ticket["reporter_mail"] == "m.muster@example.com"
    assert [p["mail"] for p in ticket["participants"]] == ["kopie@example.com"]
    assert any(a["original"] for a in ticket["entries"][0]["attachments"])
    # Antwort über den Betreff, nur neuer Teil, Zitat getrennt
    reply = mail(
        subject=f"AW: [#T-{number}] Drucker druckt nicht",
        body="Jetzt geht es.\n\nAm Montag schrieb IT <it@example.com>:\n> alt",
        message_id="a2@example.com",
    )
    assert inbound(max_, areas["it"], reply)["ticket_number"] == number
    # Antwort über In-Reply-To ohne Nummer im Betreff
    threaded = mail(
        subject="AW: Drucker",
        message_id="a3@example.com",
        headers="In-Reply-To: <a1@example.com>\r\n",
    )
    assert inbound(max_, areas["it"], threaded)["ticket_number"] == number
    # Doppelt: nichts Neues
    assert inbound(max_, areas["it"], threaded)["result"] == "doppelt"
    entries = max_.get(f"{BASE}/{number}").json()["entries"]
    inbound_entries = [e for e in entries if e["kind"] == "inbound"]
    assert len(inbound_entries) == 3
    assert inbound_entries[1]["body"] == "Jetzt geht es."
    assert inbound_entries[1]["quote"].startswith("Am Montag schrieb")


@pytest.mark.db
def test_filters_and_loop_protection(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    assert (
        inbound(max_, areas["it"], mail(headers="Auto-Submitted: auto-replied\r\n"))["result"]
        == "ignoriert"
    )
    assert (
        inbound(
            max_, areas["it"], mail(message_id="b@example.com", headers="Precedence: bulk\r\n")
        )["result"]
        == "ignoriert"
    )
    for index in range(10):
        inbound(
            max_, areas["it"], mail(sender="viel@example.com", message_id=f"l{index}@example.com")
        )
    blocked = inbound(
        max_, areas["it"], mail(sender="viel@example.com", message_id="l99@example.com")
    )
    assert "Schleifenschutz" in blocked["detail"]
    log = client_for("Ina Beispiel").get(f"{SETTINGS}/areas/{areas['it']}/intake").json()
    assert log[0]["detail"].startswith("Schleifenschutz")


@pytest.mark.db
def test_closed_ticket_policies(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    number = inbound(max_, areas["it"], mail())["ticket_number"]
    db.execute(
        update(Ticket)
        .where(Ticket.number == number)
        .values(status="closed", closed_at=now_utc() - timedelta(days=3))
    )
    db.commit()
    reopened = inbound(
        max_, areas["it"], mail(subject=f"[#T-{number}] x", message_id="c1@example.com")
    )
    assert reopened["ticket_number"] == number
    assert max_.get(f"{BASE}/{number}").json()["status"] == "in_progress"
    # Zu lange geschlossen: neues Ticket mit Bezug
    db.execute(
        update(Ticket)
        .where(Ticket.number == number)
        .values(status="closed", closed_at=now_utc() - timedelta(days=30))
    )
    db.commit()
    other = inbound(
        max_, areas["it"], mail(subject=f"[#T-{number}] x", message_id="c2@example.com")
    )
    assert other["ticket_number"] != number
    assert other["detail"] == f"Bezug auf T-{number}"
    # „immer neues Ticket“
    db.execute(update(TicketArea).where(TicketArea.id == areas["it"]).values(reopen_policy="new"))
    db.execute(update(Ticket).where(Ticket.number == number).values(closed_at=now_utc()))
    db.commit()
    third = inbound(
        max_, areas["it"], mail(subject=f"[#T-{number}] x", message_id="c3@example.com")
    )
    assert third["ticket_number"] not in (number, other["ticket_number"])


@pytest.mark.db
def test_external_review_accept_and_block(
    db: Session, areas: dict[str, int], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("TICKETS_INTERNAL_DOMAINS", "intern.example.com")
    ina = client_for("Ina Beispiel")
    settings = ina.get(f"{SETTINGS}/areas/{areas['it']}/mail").json()
    settings["external_policy"] = "review"
    payload = {
        k: settings[k]
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
    assert ina.put(f"{SETTINGS}/areas/{areas['it']}/mail", json=payload).status_code == 200
    # Interne Absender gehen durch, externe landen unter „Zu prüfen“
    ina_int = client_for("Ina Beispiel")
    assert (
        inbound(
            ina_int, areas["it"], mail(sender="a@intern.example.com", message_id="i1@example.com")
        )["result"]
        == "neu"
    )
    assert (
        inbound(ina_int, areas["it"], mail(sender="x@fremd.example", message_id="e1@example.com"))[
            "result"
        ]
        == "zu_pruefen"
    )
    assert (
        inbound(ina_int, areas["it"], mail(sender="y@fremd.example", message_id="e2@example.com"))[
            "result"
        ]
        == "zu_pruefen"
    )
    review = ina_int.get(f"{SETTINGS}/areas/{areas['it']}/review").json()
    assert [r["sender"] for r in review] == ["x@fremd.example", "y@fremd.example"]
    accepted = ina_int.post(
        f"{SETTINGS}/areas/{areas['it']}/review/{review[0]['id']}/anlegen"
    ).json()
    assert accepted["ticket_number"] is not None
    blocked = ina_int.post(
        f"{SETTINGS}/areas/{areas['it']}/review/{review[1]['id']}/sperren"
    ).json()
    assert blocked["items"] == []
    assert [b["value"] for b in ina_int.get(f"{SETTINGS}/areas/{areas['it']}/blocks").json()] == [
        "y@fremd.example"
    ]
    assert (
        inbound(ina_int, areas["it"], mail(sender="y@fremd.example", message_id="e3@example.com"))[
            "detail"
        ]
        == "Absender gesperrt"
    )
    # Bekannter externer Melder geht künftig direkt durch
    assert (
        inbound(ina_int, areas["it"], mail(sender="x@fremd.example", message_id="e4@example.com"))[
            "result"
        ]
        == "neu"
    )
    # Bearbeiten ohne Bereichsverwaltung: kein Zugriff auf „Zu prüfen“
    assert client_for("Max Muster").get(f"{SETTINGS}/areas/{areas['it']}/review").status_code == 404


@pytest.mark.db
def test_attachments_and_download(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    number = inbound(max_, areas["it"], mail_with_attachments())["ticket_number"]
    ticket = max_.get(f"{BASE}/{number}").json()
    files = {a["filename"]: a for a in ticket["entries"][0]["attachments"]}
    assert files["rechnung.pdf"]["removed_reason"] == ""
    assert files["tool.exe"]["removed_reason"] != ""
    assert any("Anhang entfernt: tool.exe" in e["body"] for e in ticket["entries"])
    pdf = max_.get(f"{BASE}/{number}/attachments/{files['rechnung.pdf']['id']}")
    assert pdf.status_code == 200
    assert pdf.headers["content-disposition"].startswith("attachment")
    assert pdf.headers["x-content-type-options"] == "nosniff"
    assert pdf.content.startswith(b"%PDF")
    assert max_.get(f"{BASE}/{number}/attachments/{files['tool.exe']['id']}").status_code == 404
    hans = client_for("Hans Haus")
    assert hans.get(f"{BASE}/{number}/attachments/{files['rechnung.pdf']['id']}").status_code == 404


@pytest.mark.db
def test_reply_status_mails_and_note_without_mail(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    number = inbound(max_, areas["it"], mail())["ticket_number"]
    max_.post(f"{BASE}/{number}/notes", json={"body": "Nur intern"})
    assert max_.get(f"{BASE}/test/outbox", params={"ticket": number}).json() == []
    sent = max_.post(
        f"{BASE}/{number}/replies", json={"body": "Bitte starte neu.", "status_after": "waiting"}
    )
    assert sent.status_code == 201, sent.text
    data = sent.json()
    assert data["status"] == "waiting"
    assert data["entries"][-2]["kind"] == "reply" or data["entries"][-1]["kind"] in (
        "reply",
        "system",
    )
    outbox = max_.get(f"{BASE}/test/outbox", params={"ticket": number}).json()
    assert [o["kind"] for o in outbox] == ["antwort"]
    # Gelöst über den Kopf: automatische Mail (Vorgabe an)
    max_.patch(
        f"{BASE}/{number}",
        json={"expected_status": "waiting", "expected_assignee_oid": None, "status": "solved"},
    )
    outbox = max_.get(f"{BASE}/test/outbox", params={"ticket": number}).json()
    assert [o["kind"] for o in outbox] == ["antwort", "solved"]
    # Antwort des Melders öffnet wieder
    inbound(
        max_, areas["it"], mail(subject=f"AW: [#T-{number}] Drucker", message_id="r9@example.com")
    )
    assert max_.get(f"{BASE}/{number}").json()["status"] == "in_progress"
    # Nur lesen darf nicht antworten
    assert (
        client_for("Lea Lesen").post(f"{BASE}/{number}/replies", json={"body": "x"}).status_code
        == 403
    )
    # Ohne Mailadresse keine Antwort
    manual = new_ticket(max_, areas["it"], reporter_mail=None)
    assert manual["can_reply"] is False
    assert max_.post(f"{BASE}/{manual['number']}/replies", json={"body": "x"}).status_code == 409
    rows = db.scalars(select(TicketMailOut.kind)).all()
    assert "antwort" in rows


@pytest.mark.db
def test_design_only_for_manager(areas: dict[str, int]) -> None:
    manager = client_for("Vera Verwaltung", ["Tickets.Verwaltung"])
    ina = client_for("Ina Beispiel")
    body = {
        "accent": "#112233",
        "footer": "Firma A",
        "privacy_url": "https://example.com/datenschutz",
    }
    assert ina.put(f"{SETTINGS}/design", json=body).status_code == 403
    assert manager.put(f"{SETTINGS}/design", json=body).json()["accent"] == "#112233"
    assert (
        manager.put(f"{SETTINGS}/design", json={**body, "privacy_url": "javascript:x"}).status_code
        == 422
    )
    assert ina.get(f"{SETTINGS}/design").json()["footer"] == "Firma A"
