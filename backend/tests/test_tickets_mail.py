# ruff: noqa: F811, E501  (Fixtures aus test_tickets; lange Zeilen sind Mail-Rohtexte)
"""Tickets Phase 2: Einlesen, Antwort-Erkennung, Filter, Zitate, Platzhalter, Eingang über den
Test-Endpunkt, Antworten und automatische Mails, Zu prüfen, Sperrliste, Anhänge."""

import base64
from datetime import timedelta
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from tests.test_tickets import BASE, SETTINGS, areas, client_for, db, join, new_ticket, oid_of  # noqa: F401
from werkbank.core.mail_layout import MailBrand, add_html
from werkbank.core.sessions import now_utc
from werkbank.modules.tickets.mail_texts import fill
from werkbank.modules.tickets.mailbox import mime_bytes
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


def mail_with_images() -> str:
    """Outlook-Art: HTML mit eingebetteten Bildern (multipart/related), dazu Textdatei."""
    png = base64.b64encode(PNG).decode()
    log = base64.b64encode(b"Zeile 1: Akku 0 %\nZeile 2: kein Netzteil").decode()
    html = (
        '<p>So sieht es aus: <img src="cid:image001.png@01DA"></p>'
        "<p>Typenschild: <img alt='x' src='cid:bild2@x'></p><p>Danke!</p>"
    )
    return (
        "From: M. Muster <m.muster@example.com>\r\nTo: it@example.com\r\nSubject: Mit Bildern\r\n"
        "Message-ID: <bild@example.com>\r\nMIME-Version: 1.0\r\n"
        'Content-Type: multipart/mixed; boundary="M"\r\n\r\n'
        '--M\r\nContent-Type: multipart/related; boundary="R"\r\n\r\n'
        f"--R\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{html}\r\n"
        "--R\r\nContent-Type: image/png\r\nContent-ID: <image001.png@01DA>\r\n"
        f"Content-Disposition: inline\r\nContent-Transfer-Encoding: base64\r\n\r\n{png}\r\n"
        "--R\r\nContent-Type: image/png\r\nContent-ID: <bild2@x>\r\n"
        f"Content-Transfer-Encoding: base64\r\n\r\n{png}\r\n--R--\r\n"
        '--M\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="protokoll.log"\r\n'
        f"Content-Transfer-Encoding: base64\r\n\r\n{log}\r\n--M--\r\n"
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
        ("Danke!\n\nBitte antworte oberhalb dieser Zeile.\nAlter Text", "Danke!"),
        # frühere Fassung der Zeile in Antworten auf ältere Mails
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


def test_inline_images_get_numbers() -> None:
    parsed = parse(mail_with_images().encode())
    assert "So sieht es aus: [Bild 1]" in parsed.text
    assert "Typenschild: [Bild 2]" in parsed.text
    inline = [(a.filename, a.inline_number) for a in parsed.attachments if a.inline_number]
    assert inline == [("bild-1.png", 1), ("bild-2.png", 2)]
    assert [a.filename for a in parsed.attachments if not a.inline_number] == ["protokoll.log"]
    # Outlook-Textteil mit Marken: unbekannte werden zu „[Bild]“
    plain = parse(mail(body="Hier [cid:image001.png@01DA] und [cid:fehlt@x]").encode())
    assert "Hier [Bild] und [Bild]" in plain.text


def test_mime_for_graph_uses_crlf() -> None:
    """Exchange zeigt quoted-printable mit LF-Zeilenenden roh an („dies=r Zeile“)."""
    message = EmailMessage()
    message["Subject"] = "Status: Wartet auf deine Rückmeldung"
    message.set_content("Bitte antworte oberhalb dieser Zeile. " * 5)
    html = "<p>" + "Beschäftigten Portal · Fragen oder Ergänzungen? " * 8 + "</p>"
    add_html(
        message,
        MailBrand(name="Portal", accent="#1f57c3", logo_png=PNG),
        lambda cid: html,
        "example.com",
    )
    raw = mime_bytes(message)
    assert b"\n" not in raw.replace(b"\r\n", b"")
    parsed = parse(raw)
    assert parsed.text.startswith("Bitte antworte oberhalb dieser Zeile.")
    again = BytesParser(policy=policy.default).parsebytes(raw)
    body = again.get_body(("html",))
    assert body is not None and body.get_content().rstrip() == html.rstrip()


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
    ticket = Ticket(number=1042, subject="<i>Drucker</i>", status="waiting")
    brand = MailBrand(
        name="Werkbank", accent="#112233", logo_png=None, footer="Firma <A>", privacy_url=""
    )
    html = render_html(area, brand, ticket, text, None)
    assert "<b>Ina</b>" not in html and "&lt;b&gt;Ina&lt;/b&gt;" in html
    assert "&lt;IT&gt;" in html and "&lt;i&gt;Drucker&lt;/i&gt;" in html
    assert "Firma &lt;A&gt;" in html and "Datenschutz" not in html
    assert "Bitte antworte oberhalb dieser Zeile." in html
    assert "T-1042" in html and "Wartet auf deine Rückmeldung" in html
    # Melder kennen die Werkbank nicht
    assert "Werkbank" not in html
    solved = render_html(area, brand, ticket, text, None, status="solved")
    assert "Gelöst" in solved and "#112233" in solved


def test_mail_brand_privacy_link_only_https() -> None:
    area = TicketArea(name="IT", mailbox="it@example.com", signature="")
    ticket = Ticket(number=7, subject="Test", status="new")
    brand = MailBrand("Werkbank", "#1f57c3", None, "", "https://example.com/datenschutz")
    html = render_html(area, brand, ticket, "Hallo", None)
    assert 'href="https://example.com/datenschutz"' in html


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
    # PDF in der Vorschau: im Browser, ohne Sandbox; Original-Mail ohne Vorschau
    assert files["rechnung.pdf"]["preview"] == "pdf"
    assert files["tool.exe"]["preview"] == ""
    view = max_.get(f"{BASE}/{number}/attachments/{files['rechnung.pdf']['id']}?view=true")
    assert view.status_code == 200
    assert view.headers["content-disposition"].startswith("inline")
    assert view.headers["content-type"] == "application/pdf"
    assert "sandbox" not in view.headers["content-security-policy"]
    original = next(a for a in ticket["entries"][0]["attachments"] if a["original"])
    assert original["preview"] == "text"


@pytest.mark.db
def test_inline_images_and_preview(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    db.execute(
        update(TicketArea)
        .where(TicketArea.id == areas["it"])
        .values(allowed_types=["pdf", "png", "jpg", "txt"])
    )
    db.commit()
    number = inbound(max_, areas["it"], mail_with_images())["ticket_number"]
    entry = max_.get(f"{BASE}/{number}").json()["entries"][0]
    assert "[Bild 1]" in entry["body"] and "[Bild 2]" in entry["body"]
    files = {a["filename"]: a for a in entry["attachments"] if not a["original"]}
    assert files["bild-1.png"]["inline_number"] == 1
    assert files["bild-2.png"]["inline_number"] == 2
    assert files["protokoll.log"]["inline_number"] is None
    assert files["bild-1.png"]["preview"] == "image"
    assert files["protokoll.log"]["preview"] == "text"
    image = max_.get(f"{BASE}/{number}/attachments/{files['bild-1.png']['id']}?view=true")
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.headers["content-disposition"].startswith("inline")
    assert image.headers["content-security-policy"] == "default-src 'none'; sandbox"
    assert image.headers["cache-control"] == "no-store"
    assert image.content == PNG
    text = max_.get(f"{BASE}/{number}/attachments/{files['protokoll.log']['id']}/text").json()
    assert text == {"text": "Zeile 1: Akku 0 %\nZeile 2: kein Netzteil", "truncated": False}
    # Text nicht als Bild, Bild nicht als Text
    log_id = files["protokoll.log"]["id"]
    assert max_.get(f"{BASE}/{number}/attachments/{log_id}?view=true").status_code == 404
    image_id = files["bild-1.png"]["id"]
    assert max_.get(f"{BASE}/{number}/attachments/{image_id}/text").status_code == 404
    # Fremde Bereiche sehen nichts
    hans = client_for("Hans Haus")
    assert hans.get(f"{BASE}/{number}/attachments/{image_id}?view=true").status_code == 404
    assert hans.get(f"{BASE}/{number}/attachments/{log_id}/text").status_code == 404


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
    # Ohne Rolle im Bereich: nicht gefunden
    assert (
        client_for("Lea Lesen").post(f"{BASE}/{number}/replies", json={"body": "x"}).status_code
        == 404
    )
    # Ohne Mailadresse keine Antwort
    manual = new_ticket(max_, areas["it"], reporter_mail=None)
    assert manual["can_reply"] is False
    assert max_.post(f"{BASE}/{manual['number']}/replies", json={"body": "x"}).status_code == 409
    rows = db.scalars(select(TicketMailOut.kind)).all()
    assert "antwort" in rows


@pytest.mark.db
def test_reply_all_forward_and_external_answer(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    number = inbound(max_, areas["it"], mail(cc="kopie@example.com"))["ticket_number"]
    # Antworten: nur der Melder; an alle: Beteiligte in Kopie
    one = max_.post(f"{BASE}/{number}/replies", json={"body": "Nur an dich"}).json()
    every = max_.post(
        f"{BASE}/{number}/replies", json={"body": "An alle", "reply_all": True}
    ).json()
    replies = [e for e in every["entries"] if e["kind"] == "reply"]
    assert [r["recipients"] for r in replies] == [
        "m.muster@example.com",
        "m.muster@example.com, kopie@example.com",
    ]
    assert one["entries"][0]["origin"] == "reporter"
    outbox = max_.get(f"{BASE}/test/outbox", params={"ticket": number}).json()
    assert [o["recipients"] for o in outbox] == [
        "m.muster@example.com",
        "m.muster@example.com, kopie@example.com",
    ]
    # Weiterleiten: an andere, Melder bekommt nichts, interner Eintrag
    original = every["entries"][0]["id"]
    forwarded = max_.post(
        f"{BASE}/{number}/forward",
        json={"to": ["Service@Example.com"], "text": "Bitte prüf sie.", "entry_id": original},
    )
    assert forwarded.status_code == 201, forwarded.text
    entry = next(e for e in forwarded.json()["entries"] if e["kind"] == "forward")
    assert entry["recipients"] == "service@example.com"
    assert entry["body"] == "Bitte prüf sie."
    outbox = max_.get(f"{BASE}/test/outbox", params={"ticket": number}).json()
    assert outbox[-1] == {
        "kind": "weiterleitung",
        "recipients": "service@example.com",
        "error": "",
    }
    assert max_.post(f"{BASE}/{number}/forward", json={"to": []}).status_code == 422
    assert (
        max_.post(
            f"{BASE}/{number}/forward",
            json={"to": ["a@example.com"], "entry_id": "00000000-0000-0000-0000-000000000000"},
        ).status_code
        == 404
    )
    assert (
        client_for("Hans Haus")
        .post(f"{BASE}/{number}/forward", json={"to": ["a@example.com"]})
        .status_code
        == 404
    )
    # Status auf „Wartet“, dann antwortet der Dienstleister: Antwort von außen, Status bleibt
    max_.patch(
        f"{BASE}/{number}",
        json={"expected_status": "in_progress", "expected_assignee_oid": None, "status": "waiting"},
    )
    inbound(
        max_,
        areas["it"],
        mail(
            subject=f"AW: WG: [#T-{number}] Drucker",
            sender="service@example.com",
            message_id="svc1@example.com",
            cc="dritte@example.com",
        ),
    )
    data = max_.get(f"{BASE}/{number}").json()
    assert data["status"] == "waiting"
    assert data["entries"][-1]["origin"] == "external"
    assert "dritte@example.com" not in [p["mail"] for p in data["participants"]]
    # Antwort einer beteiligten Person
    inbound(
        max_,
        areas["it"],
        mail(
            subject=f"AW: [#T-{number}] Drucker",
            sender="kopie@example.com",
            message_id="cc1@example.com",
        ),
    )
    data = max_.get(f"{BASE}/{number}").json()
    inbound_entries = [e for e in data["entries"] if e["kind"] == "inbound"]
    assert [e["origin"] for e in inbound_entries] == ["reporter", "external", "participant"]
    assert data["status"] == "in_progress"


@pytest.mark.db
def test_reply_solved_with_solution(db: Session, areas: dict[str, int]) -> None:
    max_ = client_for("Max Muster")
    number = inbound(max_, areas["it"], mail())["ticket_number"]
    sent = max_.post(
        f"{BASE}/{number}/replies",
        json={
            "body": "Erledigt.",
            "status_after": "solved",
            "solution": {"text": "Treiber neu installiert.", "public": False},
        },
    )
    assert sent.status_code == 201, sent.text
    data = sent.json()
    assert data["status"] == "solved"
    assert data["solution"]["text"] == "Treiber neu installiert."
    assert data["solution"]["public"] is False
    assert any("nur intern" in e["body"] for e in data["entries"] if e["kind"] == "system")
    outbox = max_.get(f"{BASE}/test/outbox", params={"ticket": number}).json()
    assert [o["kind"] for o in outbox] == ["antwort"]
