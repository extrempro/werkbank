"""Mails an den Melder (spec.md 8e, „Mails an den Melder“).

Absender ist immer das Postfach des Bereichs. Betreff `[#T-1042] Betreff`. HTML mit
Tabellenlayout und Inline-CSS, immer zusätzlich eine Textfassung; Logo eingebettet (CID), keine
externen Ressourcen, keine Zählpixel. Oben steht „Bitte oberhalb dieser Zeile antworten.“.
Eingesetzte Werte werden für HTML kodiert; Kopfzeilen sind gegen Zeilenumbrüche geschützt.
"""

import html
import re
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import format_datetime, formataddr, make_msgid

from sqlalchemy import select
from sqlalchemy.orm import Session

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
    TicketMailDesign,
    TicketMailOut,
    TicketParticipant,
)

DEFAULT_ACCENT = "#1f4fd1"
_ACCENT = re.compile(r"^#[0-9a-fA-F]{6}$")
_LINEBREAK = re.compile(r"[\r\n]+")
REFERENCES_MAX = 20


def one_line(value: str) -> str:
    """Für Kopfzeilen: keine Zeilenumbrüche (Schutz vor eingeschleusten Kopfzeilen)."""
    return _LINEBREAK.sub(" ", value).strip()


@dataclass(frozen=True)
class Design:
    accent: str
    footer: str
    privacy_url: str
    logo_png: bytes | None


def load_design(db: Session) -> Design:
    row = db.get(TicketMailDesign, 1)
    if row is None:
        return Design(accent=DEFAULT_ACCENT, footer="", privacy_url="", logo_png=None)
    return Design(
        accent=row.accent if _ACCENT.match(row.accent or "") else DEFAULT_ACCENT,
        footer=row.footer,
        privacy_url=row.privacy_url,
        logo_png=row.logo_png,
    )


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


def _paragraphs(text: str) -> str:
    """Text als HTML-Absätze (alles kodiert)."""
    blocks = [b.strip() for b in text.replace("\r\n", "\n").split("\n\n") if b.strip()]
    return "".join(
        '<p style="margin:0 0 12px">'
        + "<br>".join(html.escape(line) for line in block.split("\n"))
        + "</p>"
        for block in blocks
    )


def render_html(area: TicketArea, design: Design, body: str, logo_cid: str | None) -> str:
    accent = html.escape(design.accent)
    title = html.escape(area.header_title or area.sender_name or area.name)
    head = (
        f'<img src="cid:{html.escape(logo_cid)}" alt="{title}" height="32" '
        'style="display:block;height:32px;width:auto;border:0">'
        if logo_cid
        else ""
    )
    title_cell = f'<span style="font-size:18px;font-weight:700;color:#ffffff">{title}</span>'
    signature = _paragraphs(area.signature) if area.signature.strip() else ""
    footer_parts = []
    if design.footer.strip():
        footer_parts.append(_paragraphs(design.footer))
    if design.privacy_url.startswith("https://"):
        link = html.escape(design.privacy_url, quote=True)
        footer_parts.append(
            f'<p style="margin:0"><a href="{link}" style="color:#4f5765">Datenschutz</a></p>'
        )
    footer = "".join(footer_parts)
    return (
        '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">'
        '<meta name="color-scheme" content="light dark">'
        '<meta name="supported-color-schemes" content="light dark"></head>'
        '<body style="margin:0;padding:0;background:#f5f6f8;'
        'font-family:Segoe UI,Arial,sans-serif;color:#171a1f">'
        '<p style="margin:0;padding:8px 12px;font-size:12px;color:#4f5765">'
        f"{html.escape(REPLY_ABOVE)}</p>"
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
        '<tr><td align="center" style="padding:12px">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="max-width:600px;background:#ffffff;border-radius:10px;border:1px solid #d9dde3">'
        f'<tr><td style="background:{accent};padding:14px 24px;border-radius:10px 10px 0 0">'
        f'<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        f'<td style="padding-right:12px">{head}</td><td>{title_cell}</td></tr></table></td></tr>'
        f'<tr><td style="padding:24px;font-size:15px;line-height:1.5;color:#171a1f">'
        f"{_paragraphs(body)}{signature}</td></tr>"
        + (
            f'<tr><td style="padding:0 24px 20px;font-size:12px;color:#4f5765">{footer}</td></tr>'
            if footer
            else ""
        )
        + "</table></td></tr></table></body></html>"
    )


def render_text(area: TicketArea, design: Design, body: str) -> str:
    parts = [REPLY_ABOVE, "", body.strip()]
    if area.signature.strip():
        parts += ["", area.signature.strip()]
    if design.footer.strip():
        parts += ["", "--", design.footer.strip()]
    if design.privacy_url.startswith("https://"):
        parts += [f"Datenschutz: {design.privacy_url}"]
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
) -> tuple[EmailMessage, str, list[str]]:
    """MIME-Nachricht an den Melder, mit `cc_all` auch an die Beteiligten in Kopie; liefert
    (Nachricht, Message-ID, Empfänger). Automatische Mails gehen nur an den Melder."""
    design = load_design(db)
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
    message.set_content(render_text(area, design, body))
    cid = make_msgid(domain=domain) if design.logo_png else None
    message.add_alternative(
        render_html(area, design, body, cid[1:-1] if cid else None), subtype="html"
    )
    if cid and design.logo_png:
        html_part = message.get_body(("html",))
        if isinstance(html_part, EmailMessage):
            html_part.add_related(design.logo_png, maintype="image", subtype="png", cid=cid)
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
        db, area, ticket, body, auto=auto, cc_all=cc_all and not auto
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
    parts = [text.strip()] if text.strip() else []
    parts.append("---------- Weitergeleitete Nachricht ----------\n" + quoted.strip())
    message.set_content("\n\n".join(parts) + "\n")
    for filename, content_type, data in files:
        maintype, _, subtype = content_type.partition("/")
        message.add_attachment(
            data,
            maintype=maintype or "application",
            subtype=subtype or "octet-stream",
            filename=filename,
        )
    return message, message_id.strip("<>").lower()
