"""Mails an den Melder (spec.md 8e, „Mails an den Melder“).

Absender ist immer das Postfach des Bereichs. Betreff `[#T-1042] Betreff`. Aussehen und Branding
wie alle Mails der Werkbank (core/mail_layout.py): Logo, Name des Bereichs, Text, Kasten mit
Ticket, Betreff und Status, Signatur, Fußzeile. Oben steht „Bitte antworte oberhalb dieser
Zeile.“. Eingesetzte Werte werden für HTML kodiert; Kopfzeilen sind gegen Zeilenumbrüche
geschützt. In Mails an Melder kommt die Werkbank nicht vor; Melder melden sich nie an.
"""

import re
from collections.abc import Sequence
from email.message import EmailMessage
from email.utils import format_datetime, formataddr, make_msgid

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.core.mail_layout import (
    MailBrand,
    add_html,
    footer_text,
    info_box,
    load_mail_brand,
    paragraphs,
)
from werkbank.core.mail_layout import render_html as render_html_layout
from werkbank.core.sessions import now_utc
from werkbank.modules.tickets.mail_texts import (
    DEFAULT_ACK,
    EVENT_TEXTS,
    REPLY_ABOVE,
    fill,
    first_name,
)
from werkbank.modules.tickets.mailbox import Mailbox, MailboxError
from werkbank.modules.tickets.models import (
    Ticket,
    TicketArea,
    TicketEntry,
    TicketMailOut,
    TicketParticipant,
    TicketSolutionType,
)

_LINEBREAK = re.compile(r"[\r\n]+")
REFERENCES_MAX = 20


def one_line(value: str) -> str:
    """Für Kopfzeilen: keine Zeilenumbrüche (Schutz vor eingeschleusten Kopfzeilen)."""
    return _LINEBREAK.sub(" ", value).strip()


# Status, wie ihn der Melder in der Mail liest
REPORTER_STATUS = {
    "new": "Neu",
    "in_progress": "In Bearbeitung",
    "waiting": "Wartet auf deine Rückmeldung",
    "reminder": "Wartet auf deine Rückmeldung",
    "solved": "Gelöst",
    "closed": "Abgeschlossen",
    "merged": "Abgeschlossen",
}
REPLY_FOOTER = "Fragen oder Ergänzungen? Antworte einfach auf diese Mail."
FORWARD_FOOTER = "Antworten auf diese Mail landen direkt bei uns."


def solution_rows(db: Session, ticket: Ticket, status: str | None) -> list[tuple[str, str]]:
    """Lösungsart und Lösung für die Mail: nur bei „Gelöst“ und wenn für den Melder freigegeben."""
    if (status or ticket.status) != "solved" or not ticket.solution_public:
        return []
    rows = []
    kind = db.get(TicketSolutionType, ticket.solution_type_id) if ticket.solution_type_id else None
    if kind is not None:
        rows.append(("Lösungsart", kind.name))
    if ticket.solution_text:
        rows.append(("Lösung", ticket.solution_text))
    return rows


def area_title(area: TicketArea) -> str:
    return area.header_title or area.sender_name or area.name


def subject_for(ticket: Ticket) -> str:
    return one_line(f"[#T-{ticket.number}] {ticket.subject}")


def values_for(ticket: Ticket, worker: str = "") -> dict[str, str]:
    name = ticket.reporter_name or ticket.reporter_mail
    return {
        "Nr": f"T-{ticket.number}",
        "Betreff": ticket.subject,
        "Name": name,
        "Vorname": first_name(name),
        "Bearbeiter": worker,
        "Datum": now_utc().strftime("%d.%m.%Y"),
    }


def render_html(
    area: TicketArea,
    brand: MailBrand,
    ticket: Ticket,
    body: str,
    logo_cid: str | None,
    status: str | None = None,
    extra: Sequence[tuple[str, str]] = (),
) -> str:
    rows = [
        ("Ticket", f"T-{ticket.number}"),
        ("Betreff", ticket.subject),
        ("Status", REPORTER_STATUS.get(status or ticket.status, "In Bearbeitung")),
        *extra,
    ]
    signature = paragraphs(area.signature) if area.signature.strip() else ""
    content = paragraphs(body) + info_box(brand, rows, badge=f"T-{ticket.number}") + signature
    return render_html_layout(
        brand,
        title=area_title(area),
        body_html=content,
        footer_lead=f"{area_title(area)} · {REPLY_FOOTER}",
        logo_cid=logo_cid,
        above=REPLY_ABOVE,
    )


def render_text(
    area: TicketArea,
    brand: MailBrand,
    ticket: Ticket,
    body: str,
    status: str | None = None,
    extra: Sequence[tuple[str, str]] = (),
) -> str:
    parts = [
        REPLY_ABOVE,
        "",
        body.strip(),
        "",
        f"Ticket: T-{ticket.number}",
        f"Betreff: {ticket.subject}",
        f"Status: {REPORTER_STATUS.get(status or ticket.status, 'In Bearbeitung')}",
        *[f"{label}: {value}" for label, value in extra],
    ]
    if area.signature.strip():
        parts += ["", area.signature.strip()]
    parts += footer_text(brand, f"{area_title(area)} · {REPLY_FOOTER}")
    return "\n".join(parts) + "\n"


def _thread_ids(db: Session, ticket: Ticket) -> list[str]:
    ids = db.scalars(
        select(TicketEntry.message_id)
        .where(TicketEntry.ticket_id == ticket.id, TicketEntry.message_id.is_not(None))
        .order_by(TicketEntry.created_at)
    ).all()
    return [i for i in ids if i][-REFERENCES_MAX:]


def build_message(
    db: Session,
    area: TicketArea,
    ticket: Ticket,
    body: str,
    *,
    auto: bool,
    cc_all: bool = False,
    status: str | None = None,
) -> tuple[EmailMessage, str, list[str]]:
    """MIME-Nachricht an den Melder, mit `cc_all` auch an die Beteiligten in Kopie; liefert
    (Nachricht, Message-ID, Empfänger). Automatische Mails gehen nur an den Melder.
    `status`: Status, den die Mail nennt (sonst der aktuelle des Tickets)."""
    brand = load_mail_brand(db)
    participants = db.scalars(
        select(TicketParticipant.mail).where(TicketParticipant.ticket_id == ticket.id)
    ).all()
    domain = area.mailbox.rsplit("@", 1)[-1] if "@" in area.mailbox else "werkbank.invalid"
    message_id = make_msgid(domain=domain)
    message = EmailMessage()
    message["From"] = formataddr((one_line(area.sender_name or area.name), area.mailbox))
    message["To"] = formataddr((one_line(ticket.reporter_name), ticket.reporter_mail))
    cc = [p for p in participants if p and p != ticket.reporter_mail] if cc_all else []
    if cc:
        message["Cc"] = ", ".join(cc)
    message["Subject"] = subject_for(ticket)
    message["Message-ID"] = message_id
    message["Date"] = format_datetime(now_utc())
    thread = _thread_ids(db, ticket)
    if thread:
        message["In-Reply-To"] = f"<{thread[-1]}>"
        message["References"] = " ".join(f"<{i}>" for i in thread)
    if auto:
        message["Auto-Submitted"] = "auto-generated"
        message["X-Auto-Response-Suppress"] = "All"
    extra = solution_rows(db, ticket, status)
    message.set_content(render_text(area, brand, ticket, body, status, extra))
    add_html(
        message,
        brand,
        lambda cid: render_html(area, brand, ticket, body, cid, status, extra),
        domain,
    )
    return message, message_id.strip("<>").lower(), [ticket.reporter_mail, *cc]


def send_to_reporter(
    db: Session,
    mailbox: Mailbox | None,
    area: TicketArea,
    ticket: Ticket,
    body: str,
    *,
    kind: str,
    auto: bool,
    cc_all: bool = False,
    sent_to: list[str] | None = None,
    status: str | None = None,
) -> tuple[str | None, str]:
    """Senden und im Ausgang vermerken. Liefert (Message-ID oder None, Fehlertext); die
    Empfänger landen in `sent_to`, wenn angegeben."""
    if not ticket.reporter_mail:
        return None, "Für den Melder ist keine Mailadresse eingetragen."
    if not area.mailbox:
        return None, "Für den Bereich ist kein Postfach eingetragen."
    if mailbox is None:
        return None, "Die Postfächer der Tickets sind nicht eingerichtet."
    message, message_id, recipients = build_message(
        db, area, ticket, body, auto=auto, cc_all=cc_all and not auto, status=status
    )
    if sent_to is not None:
        sent_to.extend(recipients)
    error = ""
    try:
        mailbox.send(area.mailbox, message.as_bytes())
    except MailboxError as exc:
        error = str(exc)[:500]
    db.add(
        TicketMailOut(
            ticket_id=ticket.id,
            area_id=area.id,
            kind=kind,
            recipients=", ".join(recipients)[:2000],
            message_id="" if error else message_id,
            error=error,
        )
    )
    return (None, error) if error else (message_id, "")


def ack_text(area: TicketArea, ticket: Ticket) -> str:
    return fill(area.ack_text.strip() or DEFAULT_ACK, values_for(ticket))


def event_text(event: str, ticket: Ticket, worker: str = "") -> str:
    return fill(EVENT_TEXTS[event], values_for(ticket, worker))


def build_forward(
    db: Session,
    area: TicketArea,
    ticket: Ticket,
    to: list[str],
    text: str,
    quoted: str,
    files: list[tuple[str, str, bytes]],
) -> tuple[EmailMessage, str]:
    """Weiterleitung (nur Text) aus dem Postfach des Bereichs; die Nummer bleibt im Betreff,
    damit eine Antwort im Ticket landet. Liefert (Nachricht, Message-ID)."""
    domain = area.mailbox.rsplit("@", 1)[-1] if "@" in area.mailbox else "werkbank.invalid"
    message_id = make_msgid(domain=domain)
    message = EmailMessage()
    message["From"] = formataddr((one_line(area.sender_name or area.name), area.mailbox))
    message["To"] = ", ".join(to)
    message["Subject"] = one_line(f"WG: {subject_for(ticket)}")
    message["Message-ID"] = message_id
    message["Date"] = format_datetime(now_utc())
    brand = load_mail_brand(db)
    lead = f"{area_title(area)} · {FORWARD_FOOTER}"
    parts = [text.strip()] if text.strip() else []
    if area.signature.strip():
        parts.append(area.signature.strip())
    parts.append("---------- Weitergeleitete Nachricht ----------\n" + quoted.strip())
    message.set_content("\n\n".join(parts) + "\n" + "\n".join(footer_text(brand, lead)) + "\n")
    quoted_html = (
        '<div style="margin:18px 0 0;padding:12px 14px;border-radius:8px;background:#f5f6f8;'
        'font-size:14px"><p style="margin:0 0 6px;font-size:12px;font-weight:700;'
        'letter-spacing:.06em;text-transform:uppercase;color:#4f5765">Weitergeleitete Nachricht'
        f"</p>{paragraphs(quoted)}</div>"
    )
    content = (
        paragraphs(text)
        + (paragraphs(area.signature) if area.signature.strip() else "")
        + quoted_html
    )
    add_html(
        message,
        brand,
        lambda cid: render_html_layout(
            brand, title=area_title(area), body_html=content, footer_lead=lead, logo_cid=cid
        ),
        domain,
    )
    for filename, content_type, data in files:
        maintype, _, subtype = content_type.partition("/")
        message.add_attachment(
            data,
            maintype=maintype or "application",
            subtype=subtype or "octet-stream",
            filename=filename,
        )
    return message, message_id.strip("<>").lower()
