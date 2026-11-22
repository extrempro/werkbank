"""Mails einlesen (spec.md 8e, „E-Mail-Eingang“). Mail-Inhalte gelten als feindlich.

- Text: bevorzugt der Textteil; sonst wird HTML serverseitig in Text umgewandelt (keine
  HTML-Darstellung in der Werkbank).
- Antworten: nur der neue Teil wird übernommen; Zitate früherer Mails stehen getrennt.
- Anhänge: Dateityp über den Inhalt (Positivliste), Größe; nicht erlaubte werden entfernt.
"""

import re
from dataclasses import dataclass, field
from email import policy
from email.message import EmailMessage, Message
from email.parser import BytesParser
from email.utils import getaddresses, parseaddr

from werkbank.core.text import html_to_text
from werkbank.modules.tickets.mail_texts import REPLY_ABOVE

BODY_MAX = 20_000
QUOTE_MAX = 20_000
SUBJECT_MAX = 250
_TICKET = re.compile(r"\[#T-(\d{1,12})\]", re.IGNORECASE)
_MSGID = re.compile(r"<([^<>\s]{1,990})>")
_PREFIX = re.compile(r"^\s*((re|aw|wg|fw|fwd|antw|sv)\s*:\s*)+", re.IGNORECASE)
_AUTO_SUBJECT = re.compile(
    r"^\s*(automatische antwort|abwesenheitsnotiz|abwesend|out of office|autoreply|auto-reply|"
    r"automatic reply|unzustellbar|undeliverable|delivery status notification|"
    r"mail delivery (failed|subsystem))",
    re.IGNORECASE,
)
_BOUNCE_SENDER = re.compile(
    r"^(mailer-daemon|postmaster|microsoftexchange[0-9a-f]*)@", re.IGNORECASE
)

# Kennzeichen, an denen ein zitierter Teil beginnt (Deutsch und Englisch, Outlook, Gmail, Apple)
_QUOTE_STARTS = (
    re.compile(r"^-{2,}\s*(ursprüngliche nachricht|original message)\s*-{2,}\s*$", re.IGNORECASE),
    re.compile(r"^(am|on)\s.{3,200}(schrieb|wrote)\s?.{0,120}:\s*$", re.IGNORECASE),
    re.compile(r"^_{10,}\s*$"),
)
_HEADER_FROM = re.compile(r"^\*?(von|from)\s*:\*?\s*\S", re.IGNORECASE)
_HEADER_SENT = re.compile(r"^\*?(gesendet|sent|datum|date)\s*:\*?\s*\S", re.IGNORECASE)


@dataclass
class Attachment:
    filename: str
    content_type: str
    data: bytes


@dataclass
class ParsedMail:
    message_id: str
    references: list[str]
    subject: str
    sender: str
    sender_name: str
    to: list[tuple[str, str]]
    cc: list[tuple[str, str]]
    text: str
    attachments: list[Attachment] = field(default_factory=list)
    auto_reply: bool = False
    bounce: bool = False
    bulk: bool = False


def _header(msg: Message, name: str) -> str:
    value = msg.get(name)
    return str(value).strip() if value is not None else ""


def _addresses(msg: Message, name: str) -> list[tuple[str, str]]:
    values = [str(v) for v in msg.get_all(name, [])]
    result: list[tuple[str, str]] = []
    for display, address in getaddresses(values):
        address = address.strip().lower()
        if "@" in address and len(address) <= 320:
            result.append((display.strip()[:200], address))
    return result


def message_ids(value: str) -> list[str]:
    """Message-IDs aus In-Reply-To oder References (ohne spitze Klammern)."""
    return [m.lower() for m in _MSGID.findall(value)]


def ticket_number(subject: str) -> int | None:
    """Nummer aus `[#T-1042]` im Betreff."""
    match = _TICKET.search(subject)
    return int(match.group(1)) if match else None


def clean_subject(subject: str) -> str:
    """Betreff ohne Ticket-Kennung und ohne „AW:“, „WG:“ usw."""
    subject = _TICKET.sub("", subject)
    subject = _PREFIX.sub("", subject)
    return " ".join(subject.split())[:SUBJECT_MAX] or "(ohne Betreff)"


def _body_text(msg: EmailMessage) -> str:
    part = msg.get_body(preferencelist=("plain", "html"))
    if part is None:
        return ""
    try:
        content = part.get_content()
    except LookupError, ValueError:
        payload = part.get_payload(decode=True)
        content = payload.decode("utf-8", "replace") if isinstance(payload, bytes) else ""
    if not isinstance(content, str):
        return ""
    if part.get_content_subtype() == "html":
        return html_to_text(content) or ""
    return content.replace("\r\n", "\n").strip()


def _attachments(msg: EmailMessage) -> list[Attachment]:
    found: list[Attachment] = []
    for part in msg.iter_attachments():
        filename = part.get_filename() or ""
        disposition = (part.get_content_disposition() or "").lower()
        # Eingebettete Bilder ohne Dateiname (z. B. Logos in Signaturen) gehören nicht dazu
        if disposition == "inline" and not filename:
            continue
        if part.get_content_type() == "message/rfc822":
            inner = part.get_payload(0) if part.is_multipart() else None
            data = inner.as_bytes() if isinstance(inner, Message) else b""
            filename = filename or "nachricht.eml"
        else:
            payload = part.get_payload(decode=True)
            data = payload if isinstance(payload, bytes) else b""
        found.append(
            Attachment(
                filename=safe_filename(filename or "anhang"),
                content_type=part.get_content_type()[:100],
                data=data,
            )
        )
    return found


def safe_filename(name: str) -> str:
    """Dateiname ohne Pfade und Steuerzeichen, höchstens 200 Zeichen."""
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = "".join(ch for ch in name if ch.isprintable() and ch not in '<>:"|?*')
    name = name.strip(" .") or "anhang"
    return name[:200]


def parse(raw: bytes) -> ParsedMail:
    parsed = BytesParser(policy=policy.default).parsebytes(raw)
    msg = parsed if isinstance(parsed, EmailMessage) else EmailMessage()
    sender_name, sender = parseaddr(_header(msg, "From"))
    subject = _header(msg, "Subject")
    auto_submitted = _header(msg, "Auto-Submitted").lower()
    precedence = _header(msg, "Precedence").lower()
    auto_reply = (
        (auto_submitted not in ("", "no"))
        or bool(_header(msg, "X-Autoreply") or _header(msg, "X-Autorespond"))
        or precedence == "auto_reply"
        or bool(_AUTO_SUBJECT.match(subject))
    )
    bounce = msg.get_content_type() == "multipart/report" or bool(_BOUNCE_SENDER.match(sender))
    bulk = bool(_header(msg, "List-Unsubscribe") or _header(msg, "List-Id")) or precedence in (
        "bulk",
        "list",
        "junk",
    )
    references = message_ids(_header(msg, "In-Reply-To")) + message_ids(_header(msg, "References"))
    own = message_ids(_header(msg, "Message-ID"))
    return ParsedMail(
        message_id=own[0] if own else "",
        references=list(dict.fromkeys(references)),
        subject=subject[:500],
        sender=sender.strip().lower()[:320],
        sender_name=sender_name.strip()[:200],
        to=_addresses(msg, "To"),
        cc=_addresses(msg, "Cc"),
        text=_body_text(msg),
        attachments=_attachments(msg),
        auto_reply=auto_reply,
        bounce=bounce,
        bulk=bulk,
    )


def split_reply(text: str) -> tuple[str, str]:
    """(neuer Teil, Zitat). Schneidet an „Bitte oberhalb dieser Zeile antworten.“ oder am
    ersten Kennzeichen eines Zitats. Ist der neue Teil leer, bleibt der ganze Text."""
    lines = text.replace("\r\n", "\n").split("\n")
    cut: int | None = None
    for index, line in enumerate(lines):
        stripped = line.strip()
        if REPLY_ABOVE.lower() in stripped.lower():
            cut = index
            break
        if any(p.match(stripped) for p in _QUOTE_STARTS):
            cut = index
            break
        # Outlook: „Von: …“ und kurz darauf „Gesendet: …“
        if _HEADER_FROM.match(stripped) and any(
            _HEADER_SENT.match(next_line.strip()) for next_line in lines[index + 1 : index + 4]
        ):
            cut = index
            break
        # Zitat mit „>“ bis zum Ende
        if stripped.startswith(">") and all(
            not rest.strip() or rest.strip().startswith(">") for rest in lines[index:]
        ):
            cut = index
            break
    if cut is None:
        return text.strip()[:BODY_MAX], ""
    new = "\n".join(lines[:cut]).strip()
    quote = "\n".join(lines[cut:]).strip()
    if not new:
        return text.strip()[:BODY_MAX], ""
    return new[:BODY_MAX], quote[:QUOTE_MAX]


# --- Dateitypen über den Inhalt -------------------------------------------------------------

_EXTENSIONS = {
    "pdf": (".pdf",),
    "png": (".png",),
    "jpg": (".jpg", ".jpeg"),
    "gif": (".gif",),
    "webp": (".webp",),
    "docx": (".docx",),
    "xlsx": (".xlsx",),
    "pptx": (".pptx",),
    "txt": (".txt", ".log"),
    "csv": (".csv",),
    "eml": (".eml",),
    "msg": (".msg",),
    "zip": (".zip",),
}
CONTENT_TYPES = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt": "text/plain",
    "csv": "text/csv",
    "eml": "message/rfc822",
    "msg": "application/vnd.ms-outlook",
    "zip": "application/zip",
}


def _is_text(data: bytes) -> bool:
    if b"\x00" in data[:8192]:
        return False
    try:
        data[:8192].decode("utf-8")
    except UnicodeDecodeError:
        try:
            data[:8192].decode("cp1252")
        except UnicodeDecodeError:
            return False
    return True


def detect_type(filename: str, data: bytes) -> str | None:
    """Typ aus Inhalt und Endung; None, wenn beides nicht zusammenpasst oder unbekannt ist."""
    lower = filename.lower()
    candidates = [key for key, endings in _EXTENSIONS.items() if lower.endswith(endings)]
    if not candidates:
        return None
    kind = candidates[0]
    head = data[:16]
    checks = {
        "pdf": head.startswith(b"%PDF-"),
        "png": head.startswith(b"\x89PNG\r\n\x1a\n"),
        "jpg": head.startswith(b"\xff\xd8\xff"),
        "gif": head.startswith((b"GIF87a", b"GIF89a")),
        "webp": head.startswith(b"RIFF") and data[8:12] == b"WEBP",
        "docx": head.startswith(b"PK\x03\x04"),
        "xlsx": head.startswith(b"PK\x03\x04"),
        "pptx": head.startswith(b"PK\x03\x04"),
        "zip": head.startswith((b"PK\x03\x04", b"PK\x05\x06")),
        "msg": head.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"),
        "txt": _is_text(data),
        "csv": _is_text(data),
        "eml": _is_text(data) and b":" in data[:1000],
    }
    return kind if checks.get(kind) else None
