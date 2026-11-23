"""E-Mail-Eingang je Postfach (spec.md 8e).

Ablauf je Mail: einlesen, doppelt? → ablegen; Sperrliste, eigenes Postfach, Abwesenheit,
Unzustellbar, Newsletter, Schleifenschutz → „Ignoriert“; Antwort zu einem Ticket (Betreff
`[#T-…]`, sonst In-Reply-To/References) → Eintrag im Ticket; sonst neues Ticket, bei unbekannten
externen Absendern je nach Einstellung „Zu prüfen“ oder abgelehnt. Alles im Protokoll
„Letzte Eingänge“. Was im Posteingang liegt, gilt als unverarbeitet.
"""

import hashlib
import logging
from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.sessions import now_utc
from werkbank.modules.tickets.files import store_file
from werkbank.modules.tickets.mailbox import (
    FOLDER_IGNORED,
    FOLDER_PROCESSED,
    Mailbox,
    MailboxError,
    available,
    new_http,
    open_mailbox,
)
from werkbank.modules.tickets.mailparse import (
    CONTENT_TYPES,
    ParsedMail,
    clean_subject,
    detect_type,
    parse,
    split_reply,
    ticket_number,
)
from werkbank.modules.tickets.models import (
    ENTRY_INBOUND,
    STATUS_CLOSED,
    STATUS_IN_PROGRESS,
    STATUS_MERGED,
    STATUS_REMINDER,
    STATUS_SOLVED,
    STATUS_WAITING,
    Ticket,
    TicketArea,
    TicketAttachment,
    TicketBlock,
    TicketEntry,
    TicketMailLog,
    TicketParticipant,
    TicketReview,
)
from werkbank.modules.tickets.outbound import ack_text, send_to_reporter
from werkbank.modules.tickets.service import (
    SYSTEM,
    assign_new,
    follow_merged,
    protocol,
    set_status,
    system_entry,
)
from werkbank.modules.tickets.sla import recalc

logger = logging.getLogger(__name__)

LOOP_LIMIT = 10  # Mails je Absender und Stunde
POLL = "tickets.postfaecher"
POLL_INTERVAL = timedelta(minutes=5)

Disposition = Literal["processed", "ignored", "review", "keep"]


@dataclass
class Outcome:
    disposition: Disposition
    result: str
    detail: str = ""
    ticket: Ticket | None = None


def _domain(address: str) -> str:
    return address.rsplit("@", 1)[-1].lower() if "@" in address else ""


def is_external(settings: Settings, address: str) -> bool:
    """Extern = Domain nicht in TICKETS_INTERNAL_DOMAINS (ohne Liste gilt niemand als extern)."""
    domains = settings.tickets_internal_domain_list()
    if not domains:
        return False
    domain = _domain(address)
    return not any(domain == d or domain.endswith(f".{d}") for d in domains)


def _blocked(db: Session, area: TicketArea, sender: str) -> bool:
    values = {sender, f"@{_domain(sender)}"}
    found = db.scalar(
        select(TicketBlock.id).where(TicketBlock.area_id == area.id, TicketBlock.value.in_(values))
    )
    return found is not None


def _known_reporter(db: Session, area: TicketArea, sender: str) -> bool:
    found = db.scalar(
        select(Ticket.id).where(Ticket.area_id == area.id, Ticket.reporter_mail == sender).limit(1)
    )
    return found is not None


def _find_ticket(db: Session, mail: ParsedMail) -> Ticket | None:
    number = ticket_number(mail.subject)
    if number is not None:
        ticket = db.scalar(select(Ticket).where(Ticket.number == number))
        # Anonymisierte Tickets nehmen nichts mehr an: dann ein neues Ticket
        if ticket is not None:
            return ticket if ticket.anonymized_at is None else None
    if mail.references:
        ticket_id = db.scalar(
            select(TicketEntry.ticket_id)
            .where(TicketEntry.message_id.in_(mail.references))
            .order_by(TicketEntry.created_at.desc())
            .limit(1)
        )
        if ticket_id is not None:
            return db.get(Ticket, ticket_id)
    return None


def _add_attachments(
    db: Session,
    settings: Settings,
    area: TicketArea,
    ticket: Ticket,
    entry: TicketEntry,
    raw: bytes,
    mail: ParsedMail,
) -> list[str]:
    """Anhänge prüfen und ablegen; Original (.eml) immer. Liefert Hinweise auf entfernte."""
    removed: list[str] = []
    limit = max(area.max_attachment_mb, 1) * 1024 * 1024
    allowed = set(area.allowed_types or [])
    directory = settings.tickets_files_dir
    db.add(
        TicketAttachment(
            ticket_id=ticket.id,
            entry_id=entry.id,
            filename=f"T-{ticket.number}-original.eml",
            content_type="message/rfc822",
            size=len(raw),
            key=store_file(directory, raw),
            original=True,
        )
    )
    for item in mail.attachments:
        kind = detect_type(item.filename, item.data)
        reason = ""
        if len(item.data) > limit:
            reason = f"zu groß (über {area.max_attachment_mb} MB)"
        elif kind is None:
            reason = "Dateityp nicht erkannt oder passt nicht zur Endung"
        elif kind not in allowed:
            reason = "Dateityp nicht erlaubt"
        db.add(
            TicketAttachment(
                ticket_id=ticket.id,
                entry_id=entry.id,
                filename=item.filename,
                content_type=CONTENT_TYPES.get(kind or "", "application/octet-stream"),
                size=len(item.data),
                key=None if reason else store_file(directory, item.data),
                removed_reason=reason,
            )
        )
        if reason:
            removed.append(f"{item.filename}: {reason}")
    return removed


def _participants(db: Session, ticket: Ticket, mail: ParsedMail, mailboxes: set[str]) -> None:
    existing = set(
        db.scalars(select(TicketParticipant.mail).where(TicketParticipant.ticket_id == ticket.id))
    )
    for name, address in [*mail.to, *mail.cc]:
        if address in mailboxes or address in existing or address == ticket.reporter_mail:
            continue
        existing.add(address)
        db.add(TicketParticipant(ticket_id=ticket.id, name=name, mail=address))


def _entry(db: Session, ticket: Ticket, mail: ParsedMail, *, original: bool) -> TicketEntry:
    new, quote = split_reply(mail.text) if not original else (mail.text.strip()[:20_000], "")
    entry = TicketEntry(
        ticket_id=ticket.id,
        kind=ENTRY_INBOUND,
        body=new or "(ohne Text)",
        quote=quote,
        author_oid=None,
        author_name=mail.sender_name or mail.sender,
        author_mail=(mail.sender or "")[:320],
        original=original,
        message_id=mail.message_id or None,
    )
    db.add(entry)
    db.flush()
    return entry


def _all_mailboxes(db: Session) -> set[str]:
    return {m.lower() for m in db.scalars(select(TicketArea.mailbox)) if m}


def _log(
    db: Session,
    area: TicketArea,
    mail: ParsedMail | None,
    result: str,
    detail: str,
    ticket: Ticket | None,
) -> None:
    db.add(
        TicketMailLog(
            area_id=area.id,
            message_id=(mail.message_id if mail else "")[:998],
            sender=(mail.sender if mail else "")[:320],
            subject=(mail.subject if mail else "")[:250],
            result=result,
            detail=detail[:300],
            ticket_number=ticket.number if ticket else None,
        )
    )


def process_raw(
    db: Session,
    settings: Settings,
    mailbox: Mailbox | None,
    area: TicketArea,
    raw: bytes,
    *,
    graph_id: str = "",
    accept_unknown: bool = False,
) -> Outcome:
    """Eine Mail verarbeiten. Der Aufrufer entscheidet über das Commit und verschiebt die Mail."""
    mail = parse(raw)
    if not mail.message_id:
        mail.message_id = "sha256-" + hashlib.sha256(raw).hexdigest() + "@werkbank.invalid"
    outcome = _process(db, settings, mailbox, area, raw, mail, graph_id, accept_unknown)
    _log(db, area, mail, outcome.result, outcome.detail, outcome.ticket)
    return outcome


def _process(
    db: Session,
    settings: Settings,
    mailbox: Mailbox | None,
    area: TicketArea,
    raw: bytes,
    mail: ParsedMail,
    graph_id: str,
    accept_unknown: bool,
) -> Outcome:
    # Doppelte Verarbeitung ausschließen (z. B. zurückgezogene Mail): nur ablegen
    seen = db.scalar(
        select(TicketEntry.ticket_id).where(TicketEntry.message_id == mail.message_id).limit(1)
    )
    if seen is not None:
        return Outcome("processed", "doppelt", "Schon verarbeitet", db.get(Ticket, seen))
    mailboxes = _all_mailboxes(db)
    if not mail.sender or "@" not in mail.sender:
        return Outcome("ignored", "ignoriert", "Kein Absender")
    if mail.sender in mailboxes:
        return Outcome("ignored", "ignoriert", "Absender ist ein Ticket-Postfach")
    if _blocked(db, area, mail.sender):
        return Outcome("ignored", "ignoriert", "Absender gesperrt")
    if mail.bounce:
        return Outcome("ignored", "ignoriert", "Unzustellbarkeitsbericht")
    if mail.auto_reply:
        return Outcome("ignored", "ignoriert", "Abwesenheitsnotiz oder automatische Antwort")
    if mail.bulk:
        return Outcome("ignored", "ignoriert", "Newsletter oder Verteiler")
    hour_ago = now_utc() - timedelta(hours=1)
    recent = db.scalar(
        select(func.count())
        .select_from(TicketMailLog)
        .where(
            TicketMailLog.area_id == area.id,
            TicketMailLog.sender == mail.sender,
            TicketMailLog.created_at >= hour_ago,
        )
    )
    if (recent or 0) >= LOOP_LIMIT:
        return Outcome(
            "ignored", "ignoriert", f"Schleifenschutz: mehr als {LOOP_LIMIT} Mails in einer Stunde"
        )

    ticket = _find_ticket(db, mail)
    if ticket is not None and ticket.status == STATUS_MERGED:
        # Antworten auf Mails eines zusammengeführten Tickets landen im Ziel
        ticket = follow_merged(db, ticket)
    if ticket is not None and ticket.anonymized_at is not None:
        ticket = None
    if ticket is not None:
        # Geschlossen: je nach Einstellung wieder öffnen oder neues Ticket mit Bezug.
        if ticket.status not in (STATUS_CLOSED, STATUS_MERGED) or (
            ticket.status == STATUS_CLOSED and _reopen(area, ticket)
        ):
            return _reply(db, settings, area, ticket, raw, mail, mailboxes)
        return _new_ticket(db, settings, mailbox, area, raw, mail, mailboxes, ticket)

    if is_external(settings, mail.sender) and not _known_reporter(db, area, mail.sender):
        if area.external_policy == "reject":
            return Outcome("ignored", "abgelehnt", "Externer Absender (abgelehnt)")
        if area.external_policy == "review" and not accept_unknown:
            exists = db.scalar(
                select(TicketReview.id).where(
                    TicketReview.area_id == area.id, TicketReview.message_id == mail.message_id
                )
            )
            if exists is None:
                db.add(
                    TicketReview(
                        area_id=area.id,
                        graph_id=graph_id,
                        message_id=mail.message_id,
                        sender=mail.sender,
                        sender_name=mail.sender_name,
                        subject=clean_subject(mail.subject),
                        raw=raw,
                    )
                )
            return Outcome("review", "zu_pruefen", "Unbekannter externer Absender")
    return _new_ticket(db, settings, mailbox, area, raw, mail, mailboxes, None)


def _reopen(area: TicketArea, ticket: Ticket) -> bool:
    if area.reopen_policy == "always":
        return True
    if area.reopen_policy == "new" or ticket.closed_at is None:
        return False
    return ticket.closed_at >= now_utc() - timedelta(days=max(area.reopen_days, 0))


def _reply(
    db: Session,
    settings: Settings,
    area: TicketArea,
    ticket: Ticket,
    raw: bytes,
    mail: ParsedMail,
    mailboxes: set[str],
) -> Outcome:
    entry = _entry(db, ticket, mail, original=False)
    removed = _add_attachments(db, settings, area, ticket, entry, raw, mail)
    # Antwort von außen (z. B. auf eine Weiterleitung): keine neuen Beteiligten, Status bleibt
    sender = (mail.sender or "").lower()
    known = sender == ticket.reporter_mail.lower() or sender in {
        m.lower()
        for m in db.scalars(
            select(TicketParticipant.mail).where(TicketParticipant.ticket_id == ticket.id)
        )
    }
    if known:
        _participants(db, ticket, mail, mailboxes)
    old = ticket.status
    if known and old in (STATUS_WAITING, STATUS_SOLVED, STATUS_CLOSED, STATUS_REMINDER):
        set_status(ticket, STATUS_IN_PROGRESS, db)
        label = "wieder geöffnet" if old == STATUS_CLOSED else "Antwort des Melders"
        system_entry(db, ticket, f"Status: {_label(old)} → In Arbeit ({label})", SYSTEM)
        protocol(
            db,
            SYSTEM,
            "ticket_status",
            ticket=ticket,
            details={"von": old, "nach": STATUS_IN_PROGRESS, "mail": True},
        )
    ticket.updated_at = now_utc()
    if removed:
        system_entry(db, ticket, "Anhang entfernt: " + "; ".join(removed), SYSTEM)
    return Outcome("processed", "antwort", "Antwort zugeordnet", ticket)


def _label(status: str) -> str:
    from werkbank.modules.tickets.service import STATUS_LABELS

    return STATUS_LABELS.get(status, status)


def _new_ticket(
    db: Session,
    settings: Settings,
    mailbox: Mailbox | None,
    area: TicketArea,
    raw: bytes,
    mail: ParsedMail,
    mailboxes: set[str],
    reference: Ticket | None,
) -> Outcome:
    ticket = Ticket(
        area_id=area.id,
        subject=clean_subject(mail.subject),
        reporter_name=mail.sender_name[:200],
        reporter_mail=mail.sender,
        priority="medium",
        channel="mail",
        created_by="E-Mail",
    )
    db.add(ticket)
    db.flush()
    db.refresh(ticket)
    recalc(db, ticket, area)
    entry = _entry(db, ticket, mail, original=True)
    removed = _add_attachments(db, settings, area, ticket, entry, raw, mail)
    _participants(db, ticket, mail, mailboxes)
    if reference is not None:
        system_entry(db, ticket, f"Bezug: T-{reference.number} (bereits geschlossen)", SYSTEM)
    if removed:
        system_entry(db, ticket, "Anhang entfernt: " + "; ".join(removed), SYSTEM)
    assign_new(db, ticket, area)
    protocol(db, SYSTEM, "ticket_angelegt", ticket=ticket, details={"eingang": "mail"})
    if area.ack_enabled:
        message_id, error = send_to_reporter(
            db, mailbox, area, ticket, ack_text(area, ticket), kind="eingang", auto=True
        )
        if message_id:
            db.add(
                TicketEntry(
                    ticket_id=ticket.id,
                    kind="system",
                    body="Eingangsbestätigung an den Melder gesendet",
                    author_name=SYSTEM.name,
                    message_id=message_id,
                )
            )
        elif error:
            system_entry(db, ticket, f"Eingangsbestätigung nicht gesendet: {error}", SYSTEM)
    detail = f"Bezug auf T-{reference.number}" if reference else "Neues Ticket"
    return Outcome("processed", "neu", detail, ticket)


def expire_reviews(db: Session, mailbox: Mailbox | None, area: TicketArea) -> int:
    """Mails unter „Zu prüfen“, über die nach `review_days` niemand entschieden hat, verwerfen:
    erst in „Ignoriert“ verschieben, dann den Eintrag löschen (klappt das Verschieben nicht,
    bleibt der Eintrag, damit die Mail nicht erneut eingelesen wird)."""
    limit = now_utc() - timedelta(days=max(area.review_days, 1))
    expired = db.scalars(
        select(TicketReview).where(
            TicketReview.area_id == area.id, TicketReview.received_at < limit
        )
    ).all()
    count = 0
    for review in expired:
        if mailbox is not None and review.graph_id:
            try:
                mailbox.move(area.mailbox, review.graph_id, FOLDER_IGNORED)
            except MailboxError:
                continue
        _log(
            db,
            area,
            None,
            "ignoriert",
            f"Zu prüfen: nach {area.review_days} Tagen ohne Entscheidung verworfen",
            None,
        )
        protocol(db, SYSTEM, "pruefen_verfallen", area_id=area.id)
        db.delete(review)
        count += 1
    db.commit()
    return count


def poll_area(db: Session, settings: Settings, mailbox: Mailbox, area: TicketArea) -> int:
    """Posteingang eines Bereichs abarbeiten, danach alte Mails in den Ordnern löschen."""
    count = expire_reviews(db, mailbox, area)
    reviewing = set(
        db.scalars(select(TicketReview.graph_id).where(TicketReview.area_id == area.id))
    )
    for item in mailbox.inbox(area.mailbox):
        if item.graph_id in reviewing:
            continue
        try:
            raw = mailbox.mime(area.mailbox, item.graph_id)
            outcome = process_raw(db, settings, mailbox, area, raw, graph_id=item.graph_id)
            db.commit()
        except MailboxError as exc:
            db.rollback()
            _log(db, area, None, "fehler", str(exc), None)
            db.commit()
            continue
        if outcome.disposition == "processed":
            mailbox.move(area.mailbox, item.graph_id, FOLDER_PROCESSED)
        elif outcome.disposition == "ignored":
            mailbox.move(area.mailbox, item.graph_id, FOLDER_IGNORED)
        count += 1
    now = now_utc()
    mailbox.purge(area.mailbox, FOLDER_PROCESSED, now - timedelta(days=max(area.processed_days, 1)))
    mailbox.purge(area.mailbox, FOLDER_IGNORED, now - timedelta(days=max(area.ignored_days, 1)))
    return count


def poll_all(db: Session, settings: Settings) -> None:
    if not available(settings):
        return
    areas = db.scalars(
        select(TicketArea).where(TicketArea.active.is_(True), TicketArea.mailbox != "")
    ).all()
    with new_http() as http:
        try:
            mailbox = open_mailbox(settings, http)
        except MailboxError as exc:
            for area in areas:
                area.mailbox_error = str(exc)[:500]
            db.commit()
            return
        for area in areas:
            try:
                poll_area(db, settings, mailbox, area)
                area.mailbox_error = ""
            except MailboxError as exc:
                db.rollback()
                area = db.merge(area)
                area.mailbox_error = str(exc)[:500]
                logger.warning("Postfach des Bereichs %s: %s", area.id, exc)
            area.mailbox_checked_at = now_utc()
            db.commit()


def poll_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    poll_all(db, settings)
