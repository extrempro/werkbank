"""Verleih im IT-Bestand: Geräte an eine Person aus Entra, mit Rückgabedatum.

Ein Verleih hat eine Nummer aus dem Nummernkreis „verleih“ (Vorgabe ``L-``) und ein oder
mehrere Geräte; zurückgegeben werden kann auch einzeln. Die Person bekommt per Mail und Teams
Nachrichten bei Ausgabe, zwei Tage vor dem Rückgabedatum, bei Überfälligkeit (am Tag danach,
dann wöchentlich) und bei vollständiger Rückgabe. Die Nachrichten nennen nur Verleihnummer
und Datum. Für die IT entsteht je Rückgabe ein Vorgang „Rückgabe prüfen“ und bei
Überfälligkeit ein Vorgang „Verleih überfällig“.

Die Mailadresse liest der Server selbst aus Entra (über die Objekt-ID), damit Nachrichten nur
an Konten des eigenen Tenants gehen.
"""

import html
import logging
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr
from typing import Annotated, Any, Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.deps import DbDep
from werkbank.core.mail import MailError, SmtpConfig, load_smtp_config, send_message
from werkbank.core.mail_layout import add_html, footer_text, render_html
from werkbank.core.mail_layout import paragraphs as paragraphs_html
from werkbank.core.notify_channels import (
    LOGO_CID_DOMAIN,
    Brand,
    TeamsError,
    TeamsSender,
    load_brand,
    load_teams_url,
    send_teams,
)
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.inventory.api import (
    STATUS_RETIRED,
    Editor,
    ObjectId,
    Reader,
    _audit,
    active_issue,
    add_event,
    open_loan,
    single_line,
)
from werkbank.modules.inventory.models import (
    InventoryCase,
    InventoryHardware,
    InventoryIssueItem,
    InventoryKind,
    InventoryLoan,
    InventoryLoanItem,
    InventoryLoanMessage,
)
from werkbank.modules.inventory.people import (
    PeopleError,
    PersonLookup,
    get_person_lookup,
)
from werkbank.modules.inventory.search import escape_like
from werkbank.modules.inventory.staff import next_number
from werkbank.modules.inventory.sync import (
    CASE_PERSON,
    OPEN_STATES,
    STATE_DONE,
    _event,
    _new_case,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/inventory")

LOAN_JOB = "bestand.verleih"
LOAN_JOB_INTERVAL = timedelta(minutes=15)
LOCAL_TZ = ZoneInfo("Europe/Berlin")
REMIND_DAYS_BEFORE = 2
OVERDUE_REPEAT_DAYS = 7
DUE_MAX_DAYS = 366
ITEMS_MAX = 20
LIST_MAX = 1000
PAGE_SIZE = 50
PAGE_MAX = 200
MESSAGE_ATTEMPTS = 5
# Ältere, noch nicht verschickte Nachrichten verfallen
MESSAGE_MAX_AGE = timedelta(days=3)

CASE_RETURN = "rueckgabe"
CASE_OVERDUE = "ueberfaellig"

MSG_ISSUE = "ausgabe"
MSG_REMIND = "erinnerung"
MSG_OVERDUE = "ueberfaellig"
MSG_RETURN = "rueckgabe"
MSG_LABELS = {
    MSG_ISSUE: "Ausgabe",
    MSG_REMIND: "Erinnerung",
    MSG_OVERDUE: "Überfällig",
    MSG_RETURN: "Rückgabe",
}
CHANNEL_MAIL = "mail"
CHANNEL_TEAMS = "teams"
CHANNELS = (CHANNEL_MAIL, CHANNEL_TEAMS)
MSG_OPEN = "offen"
MSG_SENT = "gesendet"
MSG_FAILED = "fehler"
MSG_OFF = "aus"


def local_today(now: datetime | None = None) -> date:
    return (now or now_utc()).astimezone(LOCAL_TZ).date()


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _invalid(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


# --- Schemas ------------------------------------------------------------------------------


class LoanPersonIn(BaseModel):
    oid: str = Field(min_length=36, max_length=36)


class LoanIn(BaseModel):
    person: LoanPersonIn
    # Beginn; leer = heute. Ein späterer Beginn plant den Verleih vor: Die Geräte sind ab
    # sofort reserviert, die Nachricht an die Person geht am Startdatum raus.
    start_on: date | None = None
    due_on: date
    hardware_ids: list[int] = Field(min_length=1, max_length=ITEMS_MAX)
    note: str = Field(default="", max_length=300)

    @field_validator("note")
    @classmethod
    def plain_note(cls, value: str) -> str:
        return single_line(value)


class DueIn(BaseModel):
    due_on: date


class ReturnIn(BaseModel):
    hardware_ids: list[int] = Field(min_length=1, max_length=ITEMS_MAX)


class LoanSummary(BaseModel):
    id: int
    number: str
    person_name: str
    issued_on: date
    due_on: date
    returned_on: date | None
    # offen, ueberfaellig oder zurueck
    state: str
    items: int
    items_open: int


class LoanItemOut(BaseModel):
    hardware_id: int
    name: str
    kind: str
    serial: str
    inventory_no: str | None
    returned_on: date | None


class LoanMessageOut(BaseModel):
    kind: str
    kind_label: str
    channel: str
    status: str
    created_at: datetime
    sent_at: datetime | None


class LoanOut(LoanSummary):
    person_upn: str
    # ob eine Zieladresse für Nachrichten bekannt ist
    has_address: bool
    note: str
    created_at: datetime
    entries: list[LoanItemOut]
    messages: list[LoanMessageOut]
    cases: list[dict[str, Any]]


class LoanListOut(BaseModel):
    loans: list[LoanSummary]
    open: int
    overdue: int
    # Treffer insgesamt (Status und Suche), für „Mehr anzeigen“
    total: int


class AvailableOut(BaseModel):
    id: int
    name: str
    kind: str
    serial: str
    inventory_no: str | None


# --- Hilfsfunktionen ------------------------------------------------------------------------


def loan_state(loan: InventoryLoan, today: date) -> str:
    if loan.returned_on is not None:
        return "zurueck"
    if loan.issued_on > today:
        return "geplant"
    return "ueberfaellig" if loan.due_on < today else "offen"


def _items(db: Session, loan_id: int) -> list[InventoryLoanItem]:
    return list(
        db.scalars(
            select(InventoryLoanItem)
            .where(InventoryLoanItem.loan_id == loan_id)
            .order_by(InventoryLoanItem.id)
        ).all()
    )


def _summary(loan: InventoryLoan, items: list[InventoryLoanItem], today: date) -> LoanSummary:
    return LoanSummary(
        id=loan.id,
        number=loan.number,
        person_name=loan.person_name,
        issued_on=loan.issued_on,
        due_on=loan.due_on,
        returned_on=loan.returned_on,
        state=loan_state(loan, today),
        items=len(items),
        items_open=sum(1 for item in items if item.returned_on is None),
    )


def _cases_for(db: Session, loan_id: int) -> list[InventoryCase]:
    return list(
        db.scalars(
            select(InventoryCase)
            .where(
                InventoryCase.kind.in_((CASE_RETURN, CASE_OVERDUE, CASE_PERSON)),
                InventoryCase.facts["loan_id"].as_integer() == loan_id,
            )
            .order_by(InventoryCase.id)
        ).all()
    )


def loan_out(db: Session, loan: InventoryLoan) -> LoanOut:
    items = _items(db, loan.id)
    devices = {
        row.id: row
        for row in db.scalars(
            select(InventoryHardware).where(
                InventoryHardware.id.in_([item.hardware_id for item in items])
            )
        ).all()
    }
    kinds = dict(db.execute(select(InventoryKind.id, InventoryKind.name)).all())
    entries = []
    for item in items:
        device = devices.get(item.hardware_id)
        if device is None:
            continue
        entries.append(
            LoanItemOut(
                hardware_id=device.id,
                name=device.name,
                kind=kinds.get(device.kind_id, ""),
                serial=device.serial,
                inventory_no=device.inventory_no,
                returned_on=item.returned_on,
            )
        )
    messages = db.scalars(
        select(InventoryLoanMessage)
        .where(InventoryLoanMessage.loan_id == loan.id)
        .order_by(InventoryLoanMessage.created_at.desc(), InventoryLoanMessage.id.desc())
        .limit(50)
    ).all()
    return LoanOut(
        **_summary(loan, items, local_today()).model_dump(),
        person_upn=loan.person_upn,
        has_address=bool(loan.person_mail),
        note=loan.note,
        created_at=loan.created_at,
        entries=entries,
        messages=[
            LoanMessageOut(
                kind=row.kind,
                kind_label=MSG_LABELS.get(row.kind, row.kind),
                channel=row.channel,
                status=row.status,
                created_at=row.created_at,
                sent_at=row.sent_at,
            )
            for row in messages
        ],
        cases=[
            {"id": case.id, "number": case.number, "kind": case.kind, "status": case.status}
            for case in _cases_for(db, loan.id)
        ],
    )


def _loan(db: Session, loan_id: int) -> InventoryLoan:
    row = db.get(InventoryLoan, loan_id)
    if row is None:
        raise _not_found()
    return row


def queue_messages(db: Session, loan: InventoryLoan, kind: str) -> None:
    """Merkt die Nachricht für beide Kanäle vor; der Auftrag verschickt sie."""
    for channel in CHANNELS:
        db.add(InventoryLoanMessage(loan_id=loan.id, kind=kind, channel=channel))


def _check_start(start_on: date, today: date) -> None:
    if start_on < today:
        raise _invalid("Das Startdatum darf nicht in der Vergangenheit liegen.")
    if start_on > today + timedelta(days=DUE_MAX_DAYS):
        raise _invalid("Das Startdatum darf höchstens ein Jahr in der Zukunft liegen.")


def _check_due(due_on: date, today: date) -> None:
    if due_on < today:
        raise _invalid("Das Rückgabedatum darf nicht in der Vergangenheit liegen.")
    if due_on > today + timedelta(days=DUE_MAX_DAYS):
        raise _invalid("Das Rückgabedatum darf höchstens ein Jahr in der Zukunft liegen.")


def loanable(db: Session, device: InventoryHardware) -> str | None:
    """Grund, warum ein Gerät nicht verliehen werden kann, oder None."""
    if device.status == STATUS_RETIRED:
        return f"„{device.name}“ ist ausgemustert."
    if device.position_id is not None or device.workplace_id is not None:
        return f"„{device.name}“ ist einer Stelle oder einem Arbeitsplatz zugeordnet."
    if open_loan(db, device.id) is not None:
        return f"„{device.name}“ ist schon verliehen."
    if active_issue(db, device.id) is not None:
        return f"„{device.name}“ ist für eine Ausgabe reserviert."
    return None


def close_overdue_cases(db: Session, loan: InventoryLoan, user: CurrentUser | None) -> None:
    """Alles zurück: offene Vorgänge „überfällig“ und „Person nicht mehr aktiv“ schließen sich."""
    for case in _cases_for(db, loan.id):
        if case.kind not in (CASE_OVERDUE, CASE_PERSON) or case.status not in OPEN_STATES:
            continue
        case.decision = "zurueck"
        case.status = STATE_DONE
        case.closed_at = now_utc()
        _event(db, f"Erledigt: Verleih {loan.number} ist vollständig zurück", case_id=case.id)
        if user is not None and case.assignee_id is None:
            case.assignee_id = user.user_id


# --- Endpunkte ------------------------------------------------------------------------------


@router.get("/loans")
def list_loans(
    user: Reader,
    db: DbDep,
    state: Annotated[
        Literal["offen", "geplant", "ueberfaellig", "zurueck", "alle"], Query()
    ] = "offen",
    q: Annotated[str, Query(max_length=100)] = "",
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=PAGE_MAX)] = PAGE_SIZE,
) -> LoanListOut:
    """Verleihe seitenweise; ``q`` sucht in Nummer, Person und den Geräten."""
    today = local_today()
    query = select(InventoryLoan)
    if state == "offen":
        query = query.where(InventoryLoan.returned_on.is_(None))
    elif state == "geplant":
        query = query.where(InventoryLoan.returned_on.is_(None), InventoryLoan.issued_on > today)
    elif state == "ueberfaellig":
        query = query.where(InventoryLoan.returned_on.is_(None), InventoryLoan.due_on < today)
    elif state == "zurueck":
        query = query.where(InventoryLoan.returned_on.is_not(None))
    term = q.strip().casefold()
    if term:
        pattern = f"%{escape_like(term)}%"
        devices = (
            select(InventoryLoanItem.loan_id)
            .join(InventoryHardware, InventoryHardware.id == InventoryLoanItem.hardware_id)
            .where(
                or_(
                    func.lower(InventoryHardware.name).like(pattern, escape="\\"),
                    func.lower(InventoryHardware.serial).like(pattern, escape="\\"),
                    func.lower(func.coalesce(InventoryHardware.inventory_no, "")).like(
                        pattern, escape="\\"
                    ),
                )
            )
        )
        query = query.where(
            or_(
                func.lower(InventoryLoan.number).like(pattern, escape="\\"),
                func.lower(InventoryLoan.person_name).like(pattern, escape="\\"),
                func.lower(InventoryLoan.person_upn).like(pattern, escape="\\"),
                InventoryLoan.id.in_(devices),
            )
        )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(
        query.order_by(InventoryLoan.due_on.asc(), InventoryLoan.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    items: dict[int, list[InventoryLoanItem]] = {}
    if rows:
        for item in db.scalars(
            select(InventoryLoanItem).where(InventoryLoanItem.loan_id.in_([r.id for r in rows]))
        ).all():
            items.setdefault(item.loan_id, []).append(item)
    open_count = db.scalar(
        select(func.count()).select_from(InventoryLoan).where(InventoryLoan.returned_on.is_(None))
    )
    overdue = db.scalar(
        select(func.count())
        .select_from(InventoryLoan)
        .where(InventoryLoan.returned_on.is_(None), InventoryLoan.due_on < today)
    )
    return LoanListOut(
        loans=[_summary(row, items.get(row.id, []), today) for row in rows],
        open=open_count or 0,
        overdue=overdue or 0,
        total=total,
    )


@router.get("/loans/available")
def available_devices(user: Editor, db: DbDep) -> list[AvailableOut]:
    """Verleihbare Geräte: aktiv, ohne Stelle oder Arbeitsplatz, nicht schon verliehen."""
    on_loan = select(InventoryLoanItem.hardware_id).where(InventoryLoanItem.returned_on.is_(None))
    reserved = select(InventoryIssueItem.hardware_id).where(InventoryIssueItem.active)
    rows = db.execute(
        select(InventoryHardware, InventoryKind.name)
        .join(InventoryKind, InventoryKind.id == InventoryHardware.kind_id)
        .where(
            InventoryHardware.status != STATUS_RETIRED,
            InventoryHardware.position_id.is_(None),
            InventoryHardware.workplace_id.is_(None),
            InventoryHardware.id.not_in(on_loan),
            InventoryHardware.id.not_in(reserved),
        )
        .order_by(InventoryKind.name, InventoryHardware.name, InventoryHardware.id)
        .limit(LIST_MAX)
    ).all()
    return [
        AvailableOut(
            id=row.id,
            name=row.name,
            kind=kind,
            serial=row.serial,
            inventory_no=row.inventory_no,
        )
        for row, kind in rows
    ]


@router.get("/loans/{loan_id}")
def read_loan(loan_id: ObjectId, user: Reader, db: DbDep) -> LoanOut:
    return loan_out(db, _loan(db, loan_id))


@router.post("/loans")
def create_loan(
    request: Request,
    body: LoanIn,
    user: Editor,
    db: DbDep,
    lookup: Annotated[PersonLookup, Depends(get_person_lookup)],
) -> LoanOut:
    """Verleiht Geräte. Die Person und ihre Mailadresse liest der Server aus Entra."""
    today = local_today()
    start_on = body.start_on or today
    _check_start(start_on, today)
    _check_due(body.due_on, today)
    if body.due_on < start_on:
        raise _invalid("Das Rückgabedatum darf nicht vor dem Startdatum liegen.")
    ids = list(dict.fromkeys(body.hardware_ids))
    devices = []
    for hardware_id in ids:
        device = db.get(InventoryHardware, hardware_id)
        if device is None:
            raise _invalid("Unbekanntes Gerät")
        reason = loanable(db, device)
        if reason:
            raise _conflict(reason)
        devices.append(device)
    try:
        person = lookup(body.person.oid.lower())
    except PeopleError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Die Person lässt sich in Entra nicht nachschlagen: {exc}",
        ) from exc
    if person is None:
        raise _invalid("Diese Person gibt es in Entra nicht.")
    if not person.enabled:
        raise _conflict("Das Konto dieser Person ist in Entra deaktiviert.")
    loan = InventoryLoan(
        number=next_number(db, "verleih", InventoryLoan),
        person_oid=person.oid,
        person_name=person.name or person.upn,
        person_upn=person.upn,
        person_mail=person.mail,
        issued_on=start_on,
        due_on=body.due_on,
        note=body.note,
        created_by=user.user_id,
    )
    db.add(loan)
    db.flush()
    for device in devices:
        db.add(InventoryLoanItem(loan_id=loan.id, hardware_id=device.id))
        add_event(
            db,
            device.id,
            user,
            f"Verliehen an {loan.person_name} ({loan.number}), Rückgabe bis {loan.due_on:%d.%m.%Y}"
            if start_on <= today
            else f"Verleih an {loan.person_name} geplant ({loan.number}), "
            f"ab {start_on:%d.%m.%Y} bis {loan.due_on:%d.%m.%Y}; bis dahin reserviert",
        )
    if start_on <= today:
        queue_messages(db, loan, MSG_ISSUE)
    _audit(
        db,
        request,
        user,
        "verliehen",
        "verleih",
        loan.id,
        {
            "nummer": loan.number,
            "geraete": [device.id for device in devices],
            "rueckgabe_bis": loan.due_on.isoformat(),
            "start": start_on.isoformat(),
        },
    )
    db.commit()
    return loan_out(db, loan)


@router.put("/loans/{loan_id}/due")
def change_due(
    request: Request, loan_id: ObjectId, body: DueIn, user: Editor, db: DbDep
) -> LoanOut:
    """Verlängert oder verkürzt den Verleih. Die Erinnerung kommt dann zum neuen Datum."""
    loan = _loan(db, loan_id)
    if loan.returned_on is not None:
        raise _conflict("Der Verleih ist schon zurück.")
    set_due(db, loan, body.due_on, user)
    _audit(
        db,
        request,
        user,
        "verleih_datum",
        "verleih",
        loan.id,
        {"nummer": loan.number, "rueckgabe_bis": loan.due_on.isoformat()},
    )
    db.commit()
    return loan_out(db, loan)


def set_due(db: Session, loan: InventoryLoan, due_on: date, user: CurrentUser) -> None:
    _check_due(due_on, local_today())
    if due_on < loan.issued_on:
        raise _invalid("Das Rückgabedatum darf nicht vor dem Startdatum liegen.")
    if due_on == loan.due_on:
        return
    before = loan.due_on
    loan.due_on = due_on
    loan.reminded_on = None
    loan.overdue_notified_on = None
    for item in _items(db, loan.id):
        if item.returned_on is None:
            add_event(
                db,
                item.hardware_id,
                user,
                f"Verleih {loan.number}: Rückgabe bis {before:%d.%m.%Y} → {due_on:%d.%m.%Y}",
            )


@router.post("/loans/{loan_id}/return")
def return_items(
    request: Request, loan_id: ObjectId, body: ReturnIn, user: Editor, db: DbDep
) -> LoanOut:
    """Trägt die Rückgabe ein (auch einzeln). Je Rückgabe entsteht ein Vorgang zum Prüfen."""
    loan = _loan(db, loan_id)
    items = {item.hardware_id: item for item in _items(db, loan.id)}
    wanted = list(dict.fromkeys(body.hardware_ids))
    returned: list[InventoryHardware] = []
    today = local_today()
    # Vor dem Startdatum: Die Geräte waren nur reserviert; kein Vorgang, keine Nachricht.
    planned = loan.issued_on > today
    for hardware_id in wanted:
        item = items.get(hardware_id)
        if item is None:
            raise _invalid("Dieses Gerät gehört nicht zu diesem Verleih.")
        if item.returned_on is not None:
            raise _conflict("Dieses Gerät ist schon zurück.")
        item.returned_on = today
        item.returned_by = user.user_id
        device = db.get(InventoryHardware, hardware_id)
        if device is not None:
            returned.append(device)
            add_event(
                db,
                device.id,
                user,
                f"Reservierung aufgehoben ({loan.number})"
                if planned
                else f"Zurückgegeben ({loan.number})",
            )
    complete = all(item.returned_on is not None for item in items.values())
    names = ", ".join(device.name for device in returned)
    if planned:
        if complete:
            loan.returned_on = today
        _audit(
            db,
            request,
            user,
            "reservierung_aufgehoben",
            "verleih",
            loan.id,
            {
                "nummer": loan.number,
                "geraete": [device.id for device in returned],
                "vollstaendig": complete,
            },
        )
        db.commit()
        return loan_out(db, loan)
    case = _new_case(
        db,
        CASE_RETURN,
        f"Rückgabe {loan.number} prüfen: {names}",
        {
            "loan_id": loan.id,
            "loan_number": loan.number,
            "hardware_ids": [device.id for device in returned],
            "devices": [device.name for device in returned],
        },
        f"Rückgabe eingetragen ({len(returned)} von {len(items)} Geräten)",
        hardware_id=returned[0].id if returned else None,
    )
    if complete:
        loan.returned_on = today
        queue_messages(db, loan, MSG_RETURN)
        close_overdue_cases(db, loan, user)
    _audit(
        db,
        request,
        user,
        "zurueckgegeben",
        "verleih",
        loan.id,
        {
            "nummer": loan.number,
            "geraete": [device.id for device in returned],
            "vollstaendig": complete,
            "vorgang": case.number,
        },
    )
    db.commit()
    return loan_out(db, loan)


# --- Nachrichten an die Person ----------------------------------------------------------------


def message_lines(kind: str, loan: InventoryLoan, brand: Brand) -> tuple[str, list[str]]:
    """Betreff und Absätze: nur Verleihnummer und Datum, keine Gerätedaten."""
    due = f"{loan.due_on:%d.%m.%Y}"
    if kind == MSG_ISSUE:
        subject = f"Verleih {loan.number}: Rückgabe bis {due}"
        text = [
            f"du hast Geräte von der IT ausgeliehen. Deine Verleihnummer ist {loan.number}.",
            f"Bitte gib sie bis zum {due} zurück.",
        ]
    elif kind == MSG_REMIND:
        subject = f"Erinnerung: Verleih {loan.number} bis {due}"
        text = [
            f"zur Erinnerung: Bitte gib die Geräte aus Verleih {loan.number} bis zum {due} zurück."
        ]
    elif kind == MSG_OVERDUE:
        subject = f"Verleih {loan.number} ist überfällig"
        text = [
            f"die Geräte aus Verleih {loan.number} sollten bis zum {due} zurück sein.",
            "Bitte bring sie zurück oder melde dich bei der IT.",
        ]
    else:
        subject = f"Verleih {loan.number} ist zurück"
        text = [f"danke, alle Geräte aus Verleih {loan.number} sind zurück."]
    return f"{brand.name}: {subject}", text


def loan_mail(config: SmtpConfig, kind: str, loan: InventoryLoan, brand: Brand) -> EmailMessage:
    subject, paragraphs = message_lines(kind, loan, brand)
    greeting = f"Hallo {loan.person_name},"
    message = EmailMessage()
    message["From"] = formataddr((config.sender_name or brand.name, config.sender_address))
    message["To"] = loan.person_mail
    message["Subject"] = subject
    message.set_content(
        "\n\n".join([greeting, *paragraphs, f"Deine IT · {brand.name}"])
        + "\n".join(footer_text(brand, ""))
    )
    body = paragraphs_html("\n\n".join([greeting, *paragraphs])) + (
        f'<p style="margin:16px 0 0">Deine IT · {html.escape(brand.name)}</p>'
    )
    add_html(
        message,
        brand,
        lambda cid: render_html(
            brand, title=brand.name, body_html=body, footer_lead="", logo_cid=cid
        ),
        LOGO_CID_DOMAIN,
    )
    return message


def loan_teams_payload(kind: str, loan: InventoryLoan, brand: Brand) -> dict[str, Any]:
    subject, paragraphs = message_lines(kind, loan, brand)
    card: dict[str, Any] = {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": [
            {
                "type": "TextBlock",
                "text": brand.name,
                "weight": "Bolder",
                "size": "Medium",
                "color": "Accent",
            },
            {"type": "TextBlock", "text": f"Hallo {loan.person_name},", "wrap": True},
            *[{"type": "TextBlock", "text": text, "wrap": True} for text in paragraphs],
        ],
    }
    return {
        "type": "message",
        "recipient": loan.person_mail,
        "summary": subject,
        "attachments": [
            {"contentType": "application/vnd.microsoft.card.adaptive", "content": card}
        ],
    }


def send_pending(
    db: Session,
    settings: Settings,
    *,
    mail_sender: Any = send_message,
    teams_sender: TeamsSender = send_teams,
    now: datetime | None = None,
) -> int:
    """Verschickt offene Nachrichten; nach mehreren Fehlversuchen oder 3 Tagen aufgegeben."""
    now = now or now_utc()
    rows = db.scalars(
        select(InventoryLoanMessage)
        .where(InventoryLoanMessage.status == MSG_OPEN)
        .order_by(InventoryLoanMessage.id)
        .limit(200)
    ).all()
    if not rows:
        return 0
    try:
        smtp = load_smtp_config(db, settings)
    except MailError:
        logger.warning("Verleih: Die SMTP-Einstellungen lassen sich nicht lesen.")
        smtp = None
    teams_url = load_teams_url(db, settings)
    brand = load_brand(db)
    sent = 0
    for row in rows:
        loan = db.get(InventoryLoan, row.loan_id)
        if loan is None:
            continue
        if not loan.person_mail:
            row.status = MSG_OFF
            row.error = "Keine Mailadresse in Entra"
            continue
        if row.created_at < now - MESSAGE_MAX_AGE:
            row.status = MSG_FAILED
            row.error = row.error or "Zu alt, nicht mehr verschickt"
            continue
        if row.channel == CHANNEL_MAIL and smtp is None:
            row.status = MSG_OFF
            row.error = "Kein SMTP-Server eingetragen"
            continue
        if row.channel == CHANNEL_TEAMS and not teams_url:
            row.status = MSG_OFF
            row.error = "Teams ist nicht eingerichtet"
            continue
        try:
            if row.channel == CHANNEL_MAIL and smtp is not None:
                mail_sender(smtp, loan_mail(smtp, row.kind, loan, brand))
            elif teams_url:
                teams_sender(teams_url, loan_teams_payload(row.kind, loan, brand))
        except (MailError, TeamsError) as error:
            row.attempts += 1
            row.error = str(error)[:200]
            if row.attempts >= MESSAGE_ATTEMPTS:
                row.status = MSG_FAILED
            logger.warning("Verleih: Versand per %s fehlgeschlagen: %s", row.channel, error)
            continue
        row.status = MSG_SENT
        row.sent_at = now
        row.error = ""
        sent += 1
    db.commit()
    return sent


def check_loans(db: Session, now: datetime | None = None) -> tuple[int, int]:
    """Erinnerungen und Überfälligkeit: Nachrichten vormerken, Vorgänge anlegen."""
    today = local_today(now)
    reminders = overdue = 0
    issued = set(
        db.scalars(
            select(InventoryLoanMessage.loan_id).where(InventoryLoanMessage.kind == MSG_ISSUE)
        ).all()
    )
    for loan in db.scalars(
        select(InventoryLoan).where(InventoryLoan.returned_on.is_(None)).order_by(InventoryLoan.id)
    ).all():
        # Vorab geplant: Die Nachricht zur Ausgabe geht am Startdatum raus
        if loan.issued_on <= today and loan.id not in issued:
            queue_messages(db, loan, MSG_ISSUE)
        remind_on = loan.due_on - timedelta(days=REMIND_DAYS_BEFORE)
        if (
            loan.reminded_on is None
            and remind_on <= today <= loan.due_on
            and loan.issued_on < remind_on
        ):
            loan.reminded_on = today
            queue_messages(db, loan, MSG_REMIND)
            reminders += 1
        if loan.due_on < today:
            last = loan.overdue_notified_on
            if last is None or today >= last + timedelta(days=OVERDUE_REPEAT_DAYS):
                loan.overdue_notified_on = today
                queue_messages(db, loan, MSG_OVERDUE)
                overdue += 1
            # Ein Vorgang je Rückgabedatum: nach „geklärt“ kommt erst nach einer Verlängerung
            # wieder einer.
            if not any(
                case.kind == CASE_OVERDUE
                and (
                    case.status in OPEN_STATES
                    or case.facts.get("due_on") == loan.due_on.isoformat()
                )
                for case in _cases_for(db, loan.id)
            ):
                _new_case(
                    db,
                    CASE_OVERDUE,
                    f"Verleih {loan.number} ist überfällig ({loan.person_name})",
                    {
                        "loan_id": loan.id,
                        "loan_number": loan.number,
                        "person": loan.person_name,
                        "due_on": loan.due_on.isoformat(),
                    },
                    f"Rückgabe war bis {loan.due_on:%d.%m.%Y} fällig",
                )
        db.commit()
    return reminders, overdue


def loan_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    # Ausgaben nutzen denselben Auftrag für offene Nachrichten (Modul baut auf diesem auf)
    from werkbank.modules.inventory.issues import send_issue_messages

    check_loans(db)
    send_pending(db, settings)
    send_issue_messages(db, settings)
