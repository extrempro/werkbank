"""Ausgabe und Rückgabe im IT-Bestand.

**Ausgabe:** Geräte gehen dauerhaft an eine Person an ihrer Stelle. Nach dem Anlegen kommt die
Vorbereitung mit einer Checkliste aus den Vorlagen (je Anlass und je Geräteart). Erst wenn alle
Punkte erledigt sind, lässt sich die Vorbereitung abschließen; dann bekommt die Person eine
Nachricht per Mail, auf Wunsch auch per Teams (nur Nummer, Abholort und Zeitpunkt). Bestätigt
wird die Übernahme mit Unterschrift oder getipptem Namen bei der IT oder über einen
Einmal-Link ohne Anmeldung (14 Tage gültig, nur der Hash wird gespeichert). Erst mit der
Bestätigung hängen die Geräte an der Stelle.

**Rückgabe:** Alle Geräte einer Person an ihren Stellen und aus offenen Verleihen, je Gerät
mit Zustand und Verbleib. Entsteht von Hand oder automatisch, wenn Entra das Konto
deaktiviert oder löscht.
"""

import base64
import binascii
import hashlib
import html
import logging
import secrets
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import get_setting, set_setting
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep
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
    MODULE,
    STATUS_RETIRED,
    Editor,
    ObjectId,
    Reader,
    _audit,
    add_event,
    client_ip,
    single_line,
)
from werkbank.modules.inventory.loans import (
    LOCAL_TZ,
    close_overdue_cases,
    loanable,
    local_today,
    queue_messages,
)
from werkbank.modules.inventory.loans import MSG_RETURN as LOAN_MSG_RETURN
from werkbank.modules.inventory.models import (
    InventoryAccessory,
    InventoryChecklistTemplate,
    InventoryEvent,
    InventoryHardware,
    InventoryIssue,
    InventoryIssueItem,
    InventoryIssueMessage,
    InventoryIssueTask,
    InventoryKind,
    InventoryLoan,
    InventoryLoanItem,
    InventoryPosition,
    InventoryReturn,
    InventoryReturnItem,
    InventoryRoom,
)
from werkbank.modules.inventory.people import PeopleError, PersonLookup, get_person_lookup
from werkbank.modules.inventory.places import room_place
from werkbank.modules.inventory.search import escape_like
from werkbank.modules.inventory.staff import next_number

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/inventory")
public_router = APIRouter(prefix="/api/public/ausgabe")

RULES_KEY = "inventory.issue_rules"
RULES_MAX = 5000
ITEMS_MAX = 20
TASKS_MAX = 60
PAGE_SIZE = 50
PAGE_MAX = 200
LINK_DAYS = 14
SIGNATURE_MAX = 200_000
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
MESSAGE_ATTEMPTS = 5
MESSAGE_MAX_AGE = timedelta(days=3)

REASONS = {"neu": "Neu an der Stelle", "ersatz": "Ersatz", "zusatz": "Zusätzlich"}
CONDITIONS = {
    "neuwertig": "neuwertig",
    "gebraucht": "gebraucht, ohne Mängel",
    "maengel": "gebraucht, mit Mängeln",
}
RETURN_CONDITIONS = {"in_ordnung": "in Ordnung", "maengel": "mit Mängeln", "defekt": "defekt"}
STATE_PREP = "vorbereitung"
STATE_READY = "bereit"
STATE_HANDED = "uebergeben"
STATE_CANCELLED = "abgebrochen"
ACTIVE_STATES = (STATE_PREP, STATE_READY)
CONFIRM_SIGN = "unterschrift"
CONFIRM_LINK = "link"

RETURN_OPEN = "offen"
RETURN_DONE = "abgeschlossen"
ITEM_OPEN = "offen"
ITEM_BACK = "zurueck"
ITEM_MISSING = "fehlt"
REASON_EXIT = "austritt"
REASON_MANUAL = "manuell"

MSG_READY = "bereit"
CHANNEL_MAIL = "mail"
CHANNEL_TEAMS = "teams"


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _invalid(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail)


def _line(value: str) -> str:
    return single_line(value)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# --- Schemas: Stammdaten ------------------------------------------------------------------------


class AccessoryIn(BaseModel):
    kind_id: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def plain(cls, value: str) -> str:
        return _line(value)


class AccessoryOut(BaseModel):
    id: int
    kind_id: int
    kind: str
    name: str


class TemplateIn(BaseModel):
    reason: Literal["neu", "ersatz", "zusatz"] | None = None
    kind_id: int | None = Field(default=None, ge=1)
    label: str = Field(min_length=1, max_length=160)

    @field_validator("label")
    @classmethod
    def plain(cls, value: str) -> str:
        return _line(value)


class TemplateOut(BaseModel):
    id: int
    reason: str | None
    kind_id: int | None
    kind: str
    label: str


class RulesIn(BaseModel):
    text: str = Field(max_length=RULES_MAX)


class IssueSettingsOut(BaseModel):
    rules_text: str
    accessories: list[AccessoryOut]
    templates: list[TemplateOut]


# --- Schemas: Ausgabe -----------------------------------------------------------------------------


class IssueItemIn(BaseModel):
    hardware_id: int = Field(ge=1)
    accessories: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("accessories")
    @classmethod
    def plain(cls, value: list[str]) -> list[str]:
        cleaned = [_line(item)[:80] for item in value]
        return list(dict.fromkeys(item for item in cleaned if item))


class IssueIn(BaseModel):
    person_oid: str = Field(min_length=36, max_length=36)
    position_id: int = Field(ge=1)
    reason: Literal["neu", "ersatz", "zusatz"]
    items: list[IssueItemIn] = Field(min_length=1, max_length=ITEMS_MAX)
    condition: Literal["neuwertig", "gebraucht", "maengel"] = "neuwertig"
    condition_note: str = Field(default="", max_length=300)
    attach_rules: bool = True
    notify_teams: bool = False
    confirm_method: Literal["unterschrift", "link"]

    @field_validator("condition_note")
    @classmethod
    def plain(cls, value: str) -> str:
        return _line(value)


class TaskIn(BaseModel):
    label: str = Field(min_length=1, max_length=160)

    @field_validator("label")
    @classmethod
    def plain(cls, value: str) -> str:
        return _line(value)


class TaskDoneIn(BaseModel):
    done: bool


class PickupIn(BaseModel):
    place: str = Field(default="", max_length=120)
    at: datetime | None = None

    @field_validator("place")
    @classmethod
    def plain(cls, value: str) -> str:
        return _line(value)


class HandoverIn(BaseModel):
    # Unterschrift als PNG (Base64, ohne „data:“-Präfix) oder getippter Name
    signature_png: str | None = Field(default=None, max_length=SIGNATURE_MAX * 2)
    signed_name: str = Field(default="", max_length=200)

    @field_validator("signed_name")
    @classmethod
    def plain(cls, value: str) -> str:
        return _line(value)


class ConfirmIn(BaseModel):
    accepted: bool


class IssueSummary(BaseModel):
    id: int
    number: str
    person_name: str
    position: str
    reason: str
    state: str
    items: int
    tasks: int
    tasks_done: int
    created_at: datetime
    handed_at: datetime | None


class IssueItemOut(BaseModel):
    hardware_id: int
    name: str
    kind: str
    serial: str
    inventory_no: str | None
    accessories: list[str]


class IssueTaskOut(BaseModel):
    id: int
    label: str
    hardware_id: int | None
    done: bool
    done_at: datetime | None


class IssueMessageOut(BaseModel):
    channel: str
    status: str
    created_at: datetime
    sent_at: datetime | None


class IssueOut(IssueSummary):
    person_upn: str
    has_address: bool
    position_id: int
    condition: str
    condition_note: str
    attach_rules: bool
    notify_teams: bool
    confirm_method: str
    pickup_place: str
    pickup_at: datetime | None
    link_expires_at: datetime | None
    has_signature: bool
    signed_name: str
    confirmed_via: str
    rules_text: str
    ready_at: datetime | None
    entries: list[IssueItemOut]
    task_list: list[IssueTaskOut]
    messages: list[IssueMessageOut]


class IssueListOut(BaseModel):
    issues: list[IssueSummary]
    preparing: int
    ready: int
    total: int


class FreeDeviceOut(BaseModel):
    id: int
    name: str
    kind_id: int
    kind: str
    serial: str
    inventory_no: str | None
    accessories: list[str]


class PersonPositionOut(BaseModel):
    id: int
    number: str
    name: str


class PublicIssueOut(BaseModel):
    number: str
    person_name: str
    entries: list[IssueItemOut]
    rules_text: str
    confirmed: bool


# --- Schemas: Rückgabe ----------------------------------------------------------------------------


class ReturnIn(BaseModel):
    position_id: int = Field(ge=1)


class ReturnItemIn(BaseModel):
    state: Literal["offen", "zurueck", "fehlt"]
    condition: Literal["in_ordnung", "maengel", "defekt"] = "in_ordnung"
    room_id: int | None = Field(default=None, ge=1)
    accessories_ok: bool = False
    wiped: bool = False


class ReturnSummary(BaseModel):
    id: int
    number: str
    person_name: str
    reason: str
    state: str
    items: int
    items_back: int
    items_missing: int
    created_at: datetime
    closed_at: datetime | None


class ReturnItemOut(BaseModel):
    id: int
    hardware_id: int
    name: str
    kind: str
    serial: str
    inventory_no: str | None
    source: str
    state: str
    condition: str
    room_id: int | None
    room: str
    accessories_ok: bool
    wiped: bool


class ReturnOut(ReturnSummary):
    entries: list[ReturnItemOut]


class ReturnListOut(BaseModel):
    returns: list[ReturnSummary]
    open: int
    total: int


# --- Stammdaten: Zubehör, Checklisten-Vorlagen, Nutzungsregeln -----------------------------------


def _kinds(db: Session) -> dict[int, str]:
    return dict(db.execute(select(InventoryKind.id, InventoryKind.name)).all())


def _settings_out(db: Session) -> IssueSettingsOut:
    kinds = _kinds(db)
    accessories = db.scalars(
        select(InventoryAccessory).order_by(InventoryAccessory.kind_id, InventoryAccessory.name)
    ).all()
    templates = db.scalars(
        select(InventoryChecklistTemplate).order_by(
            InventoryChecklistTemplate.reason.nulls_last(),
            InventoryChecklistTemplate.kind_id,
            InventoryChecklistTemplate.sort,
            InventoryChecklistTemplate.id,
        )
    ).all()
    return IssueSettingsOut(
        rules_text=str(get_setting(db, RULES_KEY, "") or ""),
        accessories=[
            AccessoryOut(
                id=row.id, kind_id=row.kind_id, kind=kinds.get(row.kind_id, ""), name=row.name
            )
            for row in accessories
        ],
        templates=[
            TemplateOut(
                id=row.id,
                reason=row.reason,
                kind_id=row.kind_id,
                kind=kinds.get(row.kind_id, "") if row.kind_id else "",
                label=row.label,
            )
            for row in templates
        ],
    )


@router.get("/issue-settings")
def read_issue_settings(user: Reader, db: DbDep) -> IssueSettingsOut:
    return _settings_out(db)


@router.put("/issue-settings/rules")
def update_rules(request: Request, body: RulesIn, user: Editor, db: DbDep) -> IssueSettingsOut:
    """Text der Nutzungsregeln; leer heißt: keine Regeln bei der Ausgabe."""
    text = body.text.replace("\r\n", "\n").strip()
    if any((ord(c) < 32 and c not in "\n\t") or ord(c) == 127 for c in text):
        raise _invalid("Keine Steuerzeichen")
    set_setting(db, RULES_KEY, text, user.user_id)
    _audit(db, request, user, "nutzungsregeln", "ausgabe", 0, {"zeichen": len(text)})
    db.commit()
    return _settings_out(db)


@router.post("/accessories")
def create_accessory(
    request: Request, body: AccessoryIn, user: Editor, db: DbDep
) -> IssueSettingsOut:
    if db.get(InventoryKind, body.kind_id) is None:
        raise _invalid("Unbekannte Geräteart")
    exists = db.scalar(
        select(func.count())
        .select_from(InventoryAccessory)
        .where(
            InventoryAccessory.kind_id == body.kind_id,
            func.lower(InventoryAccessory.name) == body.name.casefold(),
        )
    )
    if exists:
        raise _conflict("Dieses Zubehör gibt es bei der Geräteart schon.")
    row = InventoryAccessory(kind_id=body.kind_id, name=body.name)
    db.add(row)
    db.flush()
    _audit(db, request, user, "zubehoer_neu", "zubehoer", row.id, {"name": row.name})
    db.commit()
    return _settings_out(db)


@router.delete("/accessories/{accessory_id}")
def delete_accessory(
    request: Request, accessory_id: ObjectId, user: Editor, db: DbDep
) -> IssueSettingsOut:
    """Entfernt einen Vorschlag; Ausgaben behalten die Namen, die damals gewählt wurden."""
    row = db.get(InventoryAccessory, accessory_id)
    if row is None:
        raise _not_found()
    _audit(db, request, user, "zubehoer_entfernt", "zubehoer", row.id, {"name": row.name})
    db.delete(row)
    db.commit()
    return _settings_out(db)


@router.post("/checklist-templates")
def create_template(
    request: Request, body: TemplateIn, user: Editor, db: DbDep
) -> IssueSettingsOut:
    if (body.reason is None) == (body.kind_id is None):
        raise _invalid("Wähle einen Anlass oder eine Geräteart.")
    if body.kind_id is not None and db.get(InventoryKind, body.kind_id) is None:
        raise _invalid("Unbekannte Geräteart")
    sort = (
        db.scalar(
            select(func.max(InventoryChecklistTemplate.sort)).where(
                InventoryChecklistTemplate.reason == body.reason
                if body.reason
                else InventoryChecklistTemplate.kind_id == body.kind_id
            )
        )
        or 0
    ) + 1
    row = InventoryChecklistTemplate(
        reason=body.reason, kind_id=body.kind_id, label=body.label, sort=sort
    )
    db.add(row)
    db.flush()
    _audit(db, request, user, "vorlage_neu", "checkliste", row.id, {"punkt": row.label})
    db.commit()
    return _settings_out(db)


@router.delete("/checklist-templates/{template_id}")
def delete_template(
    request: Request, template_id: ObjectId, user: Editor, db: DbDep
) -> IssueSettingsOut:
    """Entfernt einen Punkt der Vorlage; laufende Ausgaben behalten ihre Checkliste."""
    row = db.get(InventoryChecklistTemplate, template_id)
    if row is None:
        raise _not_found()
    _audit(db, request, user, "vorlage_entfernt", "checkliste", row.id, {"punkt": row.label})
    db.delete(row)
    db.commit()
    return _settings_out(db)


# --- Ausgabe: Hilfsfunktionen --------------------------------------------------------------------


def _issue(db: Session, issue_id: int) -> InventoryIssue:
    row = db.get(InventoryIssue, issue_id)
    if row is None:
        raise _not_found()
    return row


def _issue_items(db: Session, issue_id: int) -> list[InventoryIssueItem]:
    return list(
        db.scalars(
            select(InventoryIssueItem)
            .where(InventoryIssueItem.issue_id == issue_id)
            .order_by(InventoryIssueItem.id)
        ).all()
    )


def _issue_tasks(db: Session, issue_id: int) -> list[InventoryIssueTask]:
    return list(
        db.scalars(
            select(InventoryIssueTask)
            .where(InventoryIssueTask.issue_id == issue_id)
            .order_by(InventoryIssueTask.sort, InventoryIssueTask.id)
        ).all()
    )


def _position_label(position: InventoryPosition | None) -> str:
    if position is None:
        return ""
    return f"{position.number} {position.name}".strip()


def _issue_summary(
    issue: InventoryIssue,
    items: list[InventoryIssueItem],
    tasks: list[InventoryIssueTask],
    position: InventoryPosition | None,
) -> IssueSummary:
    return IssueSummary(
        id=issue.id,
        number=issue.number,
        person_name=issue.person_name,
        position=_position_label(position),
        reason=issue.reason,
        state=issue.state,
        items=len(items),
        tasks=len(tasks),
        tasks_done=sum(1 for task in tasks if task.done_at is not None),
        created_at=issue.created_at,
        handed_at=issue.handed_at,
    )


def _device_rows(db: Session, ids: list[int]) -> dict[int, InventoryHardware]:
    if not ids:
        return {}
    return {
        row.id: row
        for row in db.scalars(select(InventoryHardware).where(InventoryHardware.id.in_(ids))).all()
    }


def _entries(db: Session, items: list[InventoryIssueItem]) -> list[IssueItemOut]:
    devices = _device_rows(db, [item.hardware_id for item in items])
    kinds = _kinds(db)
    result = []
    for item in items:
        device = devices.get(item.hardware_id)
        if device is None:
            continue
        result.append(
            IssueItemOut(
                hardware_id=device.id,
                name=device.name,
                kind=kinds.get(device.kind_id, ""),
                serial=device.serial,
                inventory_no=device.inventory_no,
                accessories=list(item.accessories or []),
            )
        )
    return result


def issue_out(db: Session, issue: InventoryIssue) -> IssueOut:
    items = _issue_items(db, issue.id)
    tasks = _issue_tasks(db, issue.id)
    position = db.get(InventoryPosition, issue.position_id)
    messages = db.scalars(
        select(InventoryIssueMessage)
        .where(InventoryIssueMessage.issue_id == issue.id)
        .order_by(InventoryIssueMessage.created_at.desc(), InventoryIssueMessage.id.desc())
        .limit(20)
    ).all()
    link_open = (
        issue.confirm_method == CONFIRM_LINK
        and issue.token_hash is not None
        and issue.state == STATE_READY
    )
    return IssueOut(
        **_issue_summary(issue, items, tasks, position).model_dump(),
        person_upn=issue.person_upn,
        has_address=bool(issue.person_mail),
        position_id=issue.position_id,
        condition=issue.condition,
        condition_note=issue.condition_note,
        attach_rules=issue.attach_rules,
        notify_teams=issue.notify_teams,
        confirm_method=issue.confirm_method,
        pickup_place=issue.pickup_place,
        pickup_at=issue.pickup_at,
        link_expires_at=issue.token_expires_at if link_open else None,
        has_signature=issue.signature_png is not None,
        signed_name=issue.signed_name,
        confirmed_via=issue.confirmed_via,
        rules_text=issue.rules_text if issue.state == STATE_HANDED else _rules_for(db, issue),
        ready_at=issue.ready_at,
        entries=_entries(db, items),
        task_list=[
            IssueTaskOut(
                id=task.id,
                label=task.label,
                hardware_id=task.hardware_id,
                done=task.done_at is not None,
                done_at=task.done_at,
            )
            for task in tasks
        ],
        messages=[
            IssueMessageOut(
                channel=row.channel,
                status=row.status,
                created_at=row.created_at,
                sent_at=row.sent_at,
            )
            for row in messages
        ],
    )


def _rules_for(db: Session, issue: InventoryIssue) -> str:
    return str(get_setting(db, RULES_KEY, "") or "") if issue.attach_rules else ""


def _require_state(issue: InventoryIssue, *states: str) -> None:
    if issue.state not in states:
        labels = {
            STATE_PREP: "in Vorbereitung",
            STATE_READY: "bereit zur Abholung",
            STATE_HANDED: "schon übergeben",
            STATE_CANCELLED: "abgebrochen",
        }
        raise _conflict(f"Die Ausgabe ist {labels.get(issue.state, issue.state)}.")


def _position_event(db: Session, position_id: int, user: CurrentUser | None, text: str) -> None:
    db.add(
        InventoryEvent(
            position_id=position_id,
            user_id=user.user_id if user else None,
            occurred_at=now_utc(),
            text=text[:500],
        )
    )


def _new_link(issue: InventoryIssue) -> str:
    token = secrets.token_urlsafe(32)
    issue.token_hash = token_hash(token)
    issue.token_expires_at = now_utc() + timedelta(days=LINK_DAYS)
    return token


def _queue_ready(db: Session, issue: InventoryIssue, token: str | None) -> None:
    """Nachricht „bereit“ vormerken; der Link steht nur im Speicher bis zum Versand."""
    channels = [CHANNEL_MAIL] + ([CHANNEL_TEAMS] if issue.notify_teams else [])
    for channel in channels:
        db.add(InventoryIssueMessage(issue_id=issue.id, kind=MSG_READY, channel=channel))
    db.flush()
    if token:
        _PENDING_LINKS[issue.id] = token


# Der Link wird nie gespeichert. Damit ihn die Nachricht trotzdem enthält, verschickt der
# Server die Nachricht gleich nach dem Commit selbst (siehe ``send_issue_messages``); bis dahin
# liegt der Link nur im Arbeitsspeicher dieses Prozesses.
_PENDING_LINKS: dict[int, str] = {}


def _complete_handover(
    db: Session,
    issue: InventoryIssue,
    user: CurrentUser | None,
    *,
    via: str,
    signature: bytes | None = None,
    signed_name: str = "",
) -> None:
    items = _issue_items(db, issue.id)
    position = db.get(InventoryPosition, issue.position_id)
    if position is None:
        raise _conflict("Die Stelle gibt es nicht mehr.")
    devices = _device_rows(db, [item.hardware_id for item in items])
    for item in items:
        device = devices.get(item.hardware_id)
        if device is None:
            continue
        if (
            device.status == STATUS_RETIRED
            or device.workplace_id is not None
            or (device.position_id not in (None, position.id))
        ):
            raise _conflict(f"„{device.name}“ ist inzwischen anderweitig vergeben.")
        device.position_id = position.id
        item.active = False
        extra = f", mit {', '.join(item.accessories)}" if item.accessories else ""
        add_event(
            db,
            device.id,
            user,
            f"Ausgegeben an {issue.person_name} ({issue.number}), Stelle {position.number}{extra}",
        )
    issue.state = STATE_HANDED
    issue.handed_at = now_utc()
    issue.handed_by = user.user_id if user else None
    issue.confirmed_via = via
    issue.signature_png = signature
    issue.signed_name = signed_name
    issue.rules_text = _rules_for(db, issue)
    issue.token_hash = None
    issue.token_expires_at = None
    _position_event(
        db,
        position.id,
        user,
        f"Ausgabe {issue.number} an {issue.person_name} übergeben ({len(items)} Geräte)",
    )


def _decode_png(data: str) -> bytes:
    try:
        raw = base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise _invalid("Die Unterschrift ließ sich nicht lesen.") from exc
    if not raw.startswith(PNG_MAGIC) or len(raw) > SIGNATURE_MAX:
        raise _invalid("Die Unterschrift muss ein PNG bis 200 KB sein.")
    return raw


# --- Ausgabe: Endpunkte ---------------------------------------------------------------------


@router.get("/issues")
def list_issues(
    user: Reader,
    db: DbDep,
    state: Annotated[
        Literal["laufend", "vorbereitung", "bereit", "uebergeben", "abgebrochen", "alle"], Query()
    ] = "laufend",
    q: Annotated[str, Query(max_length=100)] = "",
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=PAGE_MAX)] = PAGE_SIZE,
) -> IssueListOut:
    query = select(InventoryIssue)
    if state == "laufend":
        query = query.where(InventoryIssue.state.in_(ACTIVE_STATES))
    elif state != "alle":
        query = query.where(InventoryIssue.state == state)
    term = q.strip().casefold()
    if term:
        pattern = f"%{escape_like(term)}%"
        devices = (
            select(InventoryIssueItem.issue_id)
            .join(InventoryHardware, InventoryHardware.id == InventoryIssueItem.hardware_id)
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
                func.lower(InventoryIssue.number).like(pattern, escape="\\"),
                func.lower(InventoryIssue.person_name).like(pattern, escape="\\"),
                func.lower(InventoryIssue.person_upn).like(pattern, escape="\\"),
                InventoryIssue.id.in_(devices),
            )
        )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(
        query.order_by(InventoryIssue.created_at.desc(), InventoryIssue.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    ids = [row.id for row in rows]
    items: dict[int, list[InventoryIssueItem]] = {}
    tasks: dict[int, list[InventoryIssueTask]] = {}
    if ids:
        for item in db.scalars(
            select(InventoryIssueItem).where(InventoryIssueItem.issue_id.in_(ids))
        ).all():
            items.setdefault(item.issue_id, []).append(item)
        for task in db.scalars(
            select(InventoryIssueTask).where(InventoryIssueTask.issue_id.in_(ids))
        ).all():
            tasks.setdefault(task.issue_id, []).append(task)
    positions = {
        row.id: row
        for row in db.scalars(
            select(InventoryPosition).where(
                InventoryPosition.id.in_([row.position_id for row in rows])
            )
        ).all()
    }
    counts = dict(
        db.execute(
            select(InventoryIssue.state, func.count())
            .where(InventoryIssue.state.in_(ACTIVE_STATES))
            .group_by(InventoryIssue.state)
        ).all()
    )
    return IssueListOut(
        issues=[
            _issue_summary(
                row, items.get(row.id, []), tasks.get(row.id, []), positions.get(row.position_id)
            )
            for row in rows
        ],
        preparing=counts.get(STATE_PREP, 0),
        ready=counts.get(STATE_READY, 0),
        total=total,
    )


@router.get("/issues/free-devices")
def free_devices(user: Editor, db: DbDep) -> list[FreeDeviceOut]:
    """Geräte für eine Ausgabe: aktiv, frei, nicht verliehen, nicht schon reserviert."""
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
        .limit(1000)
    ).all()
    accessories: dict[int, list[str]] = {}
    for accessory in db.scalars(select(InventoryAccessory).order_by(InventoryAccessory.name)).all():
        accessories.setdefault(accessory.kind_id, []).append(accessory.name)
    return [
        FreeDeviceOut(
            id=row.id,
            name=row.name,
            kind_id=row.kind_id,
            kind=kind,
            serial=row.serial,
            inventory_no=row.inventory_no,
            accessories=accessories.get(row.kind_id, []),
        )
        for row, kind in rows
    ]


@router.get("/issues/positions")
def person_positions(
    user: Editor, db: DbDep, oid: Annotated[str, Query(min_length=36, max_length=36)]
) -> list[PersonPositionOut]:
    """Stellen, an denen die Person im IT-Bestand eingetragen ist."""
    rows = db.scalars(
        select(InventoryPosition)
        .where(InventoryPosition.person_oid == oid.lower())
        .order_by(InventoryPosition.number)
    ).all()
    return [PersonPositionOut(id=row.id, number=row.number, name=row.name) for row in rows]


@router.get("/issues/{issue_id}")
def read_issue(issue_id: ObjectId, user: Reader, db: DbDep) -> IssueOut:
    return issue_out(db, _issue(db, issue_id))


@router.get("/issues/{issue_id}/signature")
def read_signature(issue_id: ObjectId, user: Reader, db: DbDep) -> Response:
    issue = _issue(db, issue_id)
    if issue.signature_png is None:
        raise _not_found()
    return Response(
        content=issue.signature_png,
        media_type="image/png",
        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
    )


@router.post("/issues")
def create_issue(
    request: Request,
    body: IssueIn,
    user: Editor,
    db: DbDep,
    lookup: Annotated[PersonLookup, Depends(get_person_lookup)],
) -> IssueOut:
    """Legt die Ausgabe an; die Geräte sind ab jetzt reserviert. Danach: Vorbereitung."""
    oid = body.person_oid.lower()
    position = db.get(InventoryPosition, body.position_id)
    if position is None:
        raise _invalid("Unbekannte Stelle")
    if position.person_oid != oid:
        raise _invalid("Die Person ist an dieser Stelle nicht eingetragen.")
    ids = [item.hardware_id for item in body.items]
    if len(set(ids)) != len(ids):
        raise _invalid("Ein Gerät steht doppelt in der Liste.")
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
        person = lookup(oid)
    except PeopleError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Die Person lässt sich in Entra nicht nachschlagen: {exc}",
        ) from exc
    if person is None:
        raise _invalid("Diese Person gibt es in Entra nicht.")
    if not person.enabled:
        raise _conflict("Das Konto dieser Person ist in Entra deaktiviert.")
    issue = InventoryIssue(
        number=next_number(db, "ausgabe", InventoryIssue),
        person_oid=person.oid,
        person_name=person.name or person.upn,
        person_upn=person.upn,
        person_mail=person.mail,
        position_id=position.id,
        reason=body.reason,
        condition=body.condition,
        condition_note=body.condition_note,
        attach_rules=body.attach_rules,
        notify_teams=body.notify_teams,
        confirm_method=body.confirm_method,
        created_by=user.user_id,
    )
    db.add(issue)
    db.flush()
    for item, device in zip(body.items, devices, strict=True):
        db.add(
            InventoryIssueItem(
                issue_id=issue.id, hardware_id=device.id, accessories=item.accessories
            )
        )
        add_event(
            db, device.id, user, f"Reserviert für Ausgabe {issue.number} an {issue.person_name}"
        )
    # Checkliste aus den Vorlagen: erst der Anlass, dann je Gerät die Punkte seiner Art
    sort = 0
    for template in db.scalars(
        select(InventoryChecklistTemplate)
        .where(InventoryChecklistTemplate.reason == body.reason)
        .order_by(InventoryChecklistTemplate.sort, InventoryChecklistTemplate.id)
    ).all():
        sort += 1
        db.add(InventoryIssueTask(issue_id=issue.id, label=template.label, sort=sort))
    kind_templates: dict[int, list[InventoryChecklistTemplate]] = {}
    for template in db.scalars(
        select(InventoryChecklistTemplate)
        .where(InventoryChecklistTemplate.kind_id.in_({d.kind_id for d in devices}))
        .order_by(InventoryChecklistTemplate.sort, InventoryChecklistTemplate.id)
    ).all():
        if template.kind_id is not None:
            kind_templates.setdefault(template.kind_id, []).append(template)
    for device in devices:
        for template in kind_templates.get(device.kind_id, []):
            sort += 1
            db.add(
                InventoryIssueTask(
                    issue_id=issue.id,
                    hardware_id=device.id,
                    label=f"{device.name}: {template.label}"[:160],
                    sort=sort,
                )
            )
    _position_event(
        db, position.id, user, f"Ausgabe {issue.number} an {issue.person_name} angelegt"
    )
    _audit(
        db,
        request,
        user,
        "ausgabe_neu",
        "ausgabe",
        issue.id,
        {"nummer": issue.number, "geraete": ids, "stelle": position.number},
    )
    db.commit()
    return issue_out(db, issue)


@router.post("/issues/{issue_id}/tasks")
def add_task(
    request: Request, issue_id: ObjectId, body: TaskIn, user: Editor, db: DbDep
) -> IssueOut:
    issue = _issue(db, issue_id)
    _require_state(issue, STATE_PREP)
    tasks = _issue_tasks(db, issue.id)
    if len(tasks) >= TASKS_MAX:
        raise _conflict(f"Höchstens {TASKS_MAX} Punkte je Ausgabe.")
    db.add(
        InventoryIssueTask(
            issue_id=issue.id, label=body.label, sort=max((t.sort for t in tasks), default=0) + 1
        )
    )
    _audit(db, request, user, "ausgabe_punkt", "ausgabe", issue.id, {"punkt": body.label})
    db.commit()
    return issue_out(db, issue)


@router.put("/issues/{issue_id}/tasks/{task_id}")
def set_task(
    request: Request,
    issue_id: ObjectId,
    task_id: ObjectId,
    body: TaskDoneIn,
    user: Editor,
    db: DbDep,
) -> IssueOut:
    issue = _issue(db, issue_id)
    _require_state(issue, STATE_PREP)
    task = db.get(InventoryIssueTask, task_id)
    if task is None or task.issue_id != issue.id:
        raise _not_found()
    if body.done and task.done_at is None:
        task.done_at = now_utc()
        task.done_by = user.user_id
    elif not body.done:
        task.done_at = None
        task.done_by = None
    _audit(
        db,
        request,
        user,
        "ausgabe_erledigt" if body.done else "ausgabe_offen",
        "ausgabe",
        issue.id,
        {"punkt": task.label},
    )
    db.commit()
    return issue_out(db, issue)


@router.put("/issues/{issue_id}/pickup")
def set_pickup(
    request: Request, issue_id: ObjectId, body: PickupIn, user: Editor, db: DbDep
) -> IssueOut:
    issue = _issue(db, issue_id)
    _require_state(issue, STATE_PREP)
    if body.at is not None and body.at.tzinfo is None:
        raise _invalid("Der Zeitpunkt braucht eine Zeitzone.")
    issue.pickup_place = body.place
    issue.pickup_at = body.at
    _audit(db, request, user, "ausgabe_abholung", "ausgabe", issue.id, {"ort": body.place})
    db.commit()
    return issue_out(db, issue)


@router.post("/issues/{issue_id}/ready")
def mark_ready(
    request: Request,
    issue_id: ObjectId,
    user: Editor,
    db: DbDep,
    settings_dep: SettingsDep,
) -> IssueOut:
    """Schließt die Vorbereitung ab und benachrichtigt die Person (Mail, auf Wunsch Teams)."""
    issue = _issue(db, issue_id)
    _require_state(issue, STATE_PREP)
    open_tasks = [task for task in _issue_tasks(db, issue.id) if task.done_at is None]
    if open_tasks:
        raise _conflict(f"Noch {len(open_tasks)} Punkte offen.")
    issue.state = STATE_READY
    issue.ready_at = now_utc()
    token = _new_link(issue) if issue.confirm_method == CONFIRM_LINK else None
    _queue_ready(db, issue, token)
    _position_event(db, issue.position_id, user, f"Ausgabe {issue.number} ist bereit zur Abholung")
    _audit(db, request, user, "ausgabe_bereit", "ausgabe", issue.id, {"nummer": issue.number})
    db.commit()
    send_issue_messages(db, settings_dep, issue_id=issue.id)
    return issue_out(db, issue)


@router.post("/issues/{issue_id}/link")
def renew_link(
    request: Request,
    issue_id: ObjectId,
    user: Editor,
    db: DbDep,
    settings_dep: SettingsDep,
) -> IssueOut:
    """Neuer Einmal-Link (der alte gilt nicht mehr) und die Nachricht noch einmal."""
    issue = _issue(db, issue_id)
    _require_state(issue, STATE_READY)
    if issue.confirm_method != CONFIRM_LINK:
        raise _conflict("Diese Ausgabe wird mit Unterschrift bestätigt.")
    token = _new_link(issue)
    _queue_ready(db, issue, token)
    _audit(db, request, user, "ausgabe_link", "ausgabe", issue.id, {"nummer": issue.number})
    db.commit()
    send_issue_messages(db, settings_dep, issue_id=issue.id)
    return issue_out(db, issue)


@router.post("/issues/{issue_id}/handover")
def handover(
    request: Request, issue_id: ObjectId, body: HandoverIn, user: Editor, db: DbDep
) -> IssueOut:
    """Übergabe bei der IT: Unterschrift oder getippter Name der Person."""
    issue = _issue(db, issue_id)
    _require_state(issue, STATE_READY)
    signature = _decode_png(body.signature_png) if body.signature_png else None
    if signature is None and not body.signed_name:
        raise _invalid("Unterschrift oder Name der Person fehlt.")
    _complete_handover(
        db, issue, user, via=CONFIRM_SIGN, signature=signature, signed_name=body.signed_name
    )
    _audit(db, request, user, "ausgabe_uebergeben", "ausgabe", issue.id, {"nummer": issue.number})
    db.commit()
    return issue_out(db, issue)


@router.post("/issues/{issue_id}/cancel")
def cancel_issue(request: Request, issue_id: ObjectId, user: Editor, db: DbDep) -> IssueOut:
    """Bricht die Ausgabe ab; die Geräte sind wieder frei."""
    issue = _issue(db, issue_id)
    _require_state(issue, *ACTIVE_STATES)
    for item in _issue_items(db, issue.id):
        item.active = False
        add_event(
            db,
            item.hardware_id,
            user,
            f"Reservierung aufgehoben: Ausgabe {issue.number} abgebrochen",
        )
    issue.state = STATE_CANCELLED
    issue.token_hash = None
    issue.token_expires_at = None
    _position_event(db, issue.position_id, user, f"Ausgabe {issue.number} abgebrochen")
    _audit(db, request, user, "ausgabe_abgebrochen", "ausgabe", issue.id, {"nummer": issue.number})
    db.commit()
    return issue_out(db, issue)


# --- Einmal-Link ohne Anmeldung ------------------------------------------------------------------


def _by_token(db: Session, token: str) -> InventoryIssue:
    if not 20 <= len(token) <= 100:
        raise _not_found()
    issue = db.scalars(
        select(InventoryIssue).where(InventoryIssue.token_hash == token_hash(token))
    ).first()
    if (
        issue is None
        or issue.state != STATE_READY
        or issue.token_expires_at is None
        or issue.token_expires_at < now_utc()
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Der Link ist abgelaufen oder wurde schon benutzt.",
        )
    return issue


def _public_out(db: Session, issue: InventoryIssue, confirmed: bool) -> PublicIssueOut:
    return PublicIssueOut(
        number=issue.number,
        person_name=issue.person_name,
        entries=_entries(db, _issue_items(db, issue.id)),
        rules_text=_rules_for(db, issue) if not confirmed else issue.rules_text,
        confirmed=confirmed,
    )


@public_router.get("/{token}")
def public_issue(token: str, db: DbDep, response: Response) -> PublicIssueOut:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return _public_out(db, _by_token(db, token), False)


@public_router.post("/{token}")
def public_confirm(
    request: Request, token: str, body: ConfirmIn, db: DbDep, response: Response
) -> PublicIssueOut:
    """Die Person bestätigt den Empfang; der Link gilt danach nicht mehr."""
    response.headers["Cache-Control"] = "no-store"
    issue = _by_token(db, token)
    if not body.accepted:
        raise _invalid("Bitte bestätige den Empfang.")
    _complete_handover(db, issue, None, via=CONFIRM_LINK, signed_name=issue.person_name)
    write_audit(
        db,
        module=MODULE,
        action="bestand.ausgabe_bestaetigt_link",
        object_type="ausgabe",
        object_id=str(issue.id),
        details={"nummer": issue.number},
        ip=client_ip(request),
    )
    db.commit()
    return _public_out(db, issue, True)


# --- Nachricht an die Person ----------------------------------------------------------------------


def _when(issue: InventoryIssue) -> str:
    if issue.pickup_at is None:
        return ""
    return f"{issue.pickup_at.astimezone(LOCAL_TZ):%d.%m.%Y, %H:%M} Uhr"


def ready_lines(issue: InventoryIssue, brand: Brand, link: str | None) -> tuple[str, list[str]]:
    """Betreff und Absätze: nur Nummer, Abholort und Zeitpunkt, keine Gerätedaten."""
    subject = f"{brand.name}: Deine Geräte sind bereit ({issue.number})"
    text = [f"deine Geräte aus der Ausgabe {issue.number} sind eingerichtet und liegen bereit."]
    place = issue.pickup_place
    when = _when(issue)
    if place and when:
        text.append(f"Abholen kannst du sie ab {when}: {place}.")
    elif place:
        text.append(f"Abholen kannst du sie hier: {place}.")
    elif when:
        text.append(f"Abholen kannst du sie ab {when}.")
    if link:
        text.append(
            f"Bitte bestätige den Empfang, sobald du die Geräte hast. Der Link gilt "
            f"{LINK_DAYS} Tage und nur einmal: {link}"
        )
    else:
        text.append("Bei der Übergabe bestätigst du den Empfang mit deiner Unterschrift.")
    return subject, text


def issue_mail(
    config: SmtpConfig, issue: InventoryIssue, brand: Brand, link: str | None
) -> EmailMessage:
    subject, paragraphs = ready_lines(issue, brand, link)
    greeting = f"Hallo {issue.person_name},"
    message = EmailMessage()
    message["From"] = formataddr((config.sender_name or brand.name, config.sender_address))
    message["To"] = issue.person_mail
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


def issue_teams_payload(issue: InventoryIssue, brand: Brand, link: str | None) -> dict[str, Any]:
    subject, paragraphs = ready_lines(issue, brand, link)
    card: dict[str, Any] = {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": [
            {"type": "TextBlock", "text": brand.name, "weight": "Bolder", "size": "Medium"},
            {"type": "TextBlock", "text": f"Hallo {issue.person_name},", "wrap": True},
            *[{"type": "TextBlock", "text": text, "wrap": True} for text in paragraphs],
        ],
    }
    return {
        "type": "message",
        "recipient": issue.person_mail,
        "summary": subject,
        "attachments": [
            {"contentType": "application/vnd.microsoft.card.adaptive", "content": card}
        ],
    }


def send_issue_messages(
    db: Session,
    settings: Settings,
    *,
    issue_id: int | None = None,
    mail_sender: Any = send_message,
    teams_sender: TeamsSender = send_teams,
    now: datetime | None = None,
) -> int:
    """Verschickt offene Nachrichten. Mit Link nur, solange der Link im Speicher liegt."""
    now = now or now_utc()
    query = select(InventoryIssueMessage).where(InventoryIssueMessage.status == "offen")
    if issue_id is not None:
        query = query.where(InventoryIssueMessage.issue_id == issue_id)
    rows = db.scalars(query.order_by(InventoryIssueMessage.id).limit(200)).all()
    if not rows:
        return 0
    try:
        smtp = load_smtp_config(db, settings)
    except MailError:
        smtp = None
    teams_url = load_teams_url(db, settings)
    brand = load_brand(db)
    sent = 0
    for row in rows:
        issue = db.get(InventoryIssue, row.issue_id)
        if issue is None:
            continue
        link = None
        if issue.confirm_method == CONFIRM_LINK:
            token = _PENDING_LINKS.get(issue.id)
            if token is None:
                row.status = "fehler"
                row.error = "Link nicht mehr verfügbar; neuen Link senden"
                continue
            link = f"{settings.public_origin.rstrip('/')}/bestaetigen/{token}"
        if not issue.person_mail:
            row.status = "aus"
            row.error = "Keine Mailadresse in Entra"
            continue
        if row.created_at < now - MESSAGE_MAX_AGE:
            row.status = "fehler"
            row.error = row.error or "Zu alt, nicht mehr verschickt"
            continue
        if row.channel == CHANNEL_MAIL and smtp is None:
            row.status = "aus"
            row.error = "Kein SMTP-Server eingetragen"
            continue
        if row.channel == CHANNEL_TEAMS and not teams_url:
            row.status = "aus"
            row.error = "Teams ist nicht eingerichtet"
            continue
        try:
            if row.channel == CHANNEL_MAIL and smtp is not None:
                mail_sender(smtp, issue_mail(smtp, issue, brand, link))
            elif teams_url:
                teams_sender(teams_url, issue_teams_payload(issue, brand, link))
        except (MailError, TeamsError) as error:
            row.attempts += 1
            row.error = str(error)[:200]
            if row.attempts >= MESSAGE_ATTEMPTS:
                row.status = "fehler"
            logger.warning("Ausgabe: Versand per %s fehlgeschlagen: %s", row.channel, error)
            continue
        row.status = "gesendet"
        row.sent_at = now
        row.error = ""
        sent += 1
    if issue_id is not None and not any(
        row.status == "offen" for row in rows if row.issue_id == issue_id
    ):
        _PENDING_LINKS.pop(issue_id, None)
    db.commit()
    return sent


def issue_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    """Wiederholt offene Nachrichten ohne Link (Teil des Auftrags ``bestand.verleih``)."""
    send_issue_messages(db, settings)


# --- Rückgabe -------------------------------------------------------------------------------------


def _return(db: Session, return_id: int) -> InventoryReturn:
    row = db.get(InventoryReturn, return_id)
    if row is None:
        raise _not_found()
    return row


def _return_items(db: Session, return_id: int) -> list[InventoryReturnItem]:
    return list(
        db.scalars(
            select(InventoryReturnItem)
            .where(InventoryReturnItem.return_id == return_id)
            .order_by(InventoryReturnItem.id)
        ).all()
    )


def _return_summary(row: InventoryReturn, items: list[InventoryReturnItem]) -> ReturnSummary:
    return ReturnSummary(
        id=row.id,
        number=row.number,
        person_name=row.person_name,
        reason=row.reason,
        state=row.state,
        items=len(items),
        items_back=sum(1 for item in items if item.state == ITEM_BACK),
        items_missing=sum(1 for item in items if item.state == ITEM_MISSING),
        created_at=row.created_at,
        closed_at=row.closed_at,
    )


def return_out(db: Session, row: InventoryReturn) -> ReturnOut:
    items = _return_items(db, row.id)
    devices = _device_rows(db, [item.hardware_id for item in items])
    kinds = _kinds(db)
    positions = {
        p.id: p
        for p in db.scalars(
            select(InventoryPosition).where(
                InventoryPosition.id.in_([i.position_id for i in items if i.position_id])
            )
        ).all()
    }
    loans = {
        loan.id: loan
        for loan in db.scalars(
            select(InventoryLoan).where(
                InventoryLoan.id.in_([i.loan_id for i in items if i.loan_id])
            )
        ).all()
    }
    entries = []
    for item in items:
        device = devices.get(item.hardware_id)
        if device is None:
            continue
        if item.loan_id and item.loan_id in loans:
            source = f"Verleih {loans[item.loan_id].number}"
        elif item.position_id and item.position_id in positions:
            source = f"Stelle {_position_label(positions[item.position_id])}"
        else:
            source = ""
        entries.append(
            ReturnItemOut(
                id=item.id,
                hardware_id=device.id,
                name=device.name,
                kind=kinds.get(device.kind_id, ""),
                serial=device.serial,
                inventory_no=device.inventory_no,
                source=source,
                state=item.state,
                condition=item.condition,
                room_id=item.room_id,
                room=_room_label(db, item.room_id),
                accessories_ok=item.accessories_ok,
                wiped=item.wiped,
            )
        )
    return ReturnOut(**_return_summary(row, items).model_dump(), entries=entries)


def _room_label(db: Session, room_id: int | None) -> str:
    place = room_place(db, room_id)
    if place is None:
        return ""
    return ", ".join(part for part in (place.room, place.floor, place.site) if part)


def _person_devices(db: Session, oid: str) -> list[tuple[int, int | None, int | None]]:
    """(Gerät, Stelle, Verleih) aller Geräte der Person an Stellen und aus offenen Verleihen."""
    found: list[tuple[int, int | None, int | None]] = []
    positions = select(InventoryPosition.id).where(InventoryPosition.person_oid == oid)
    for device_id, position_id in db.execute(
        select(InventoryHardware.id, InventoryHardware.position_id)
        .where(
            InventoryHardware.position_id.in_(positions),
            InventoryHardware.status != STATUS_RETIRED,
        )
        .order_by(InventoryHardware.id)
    ).all():
        found.append((device_id, position_id, None))
    seen = {device_id for device_id, _, _ in found}
    for device_id, loan_id in db.execute(
        select(InventoryLoanItem.hardware_id, InventoryLoanItem.loan_id)
        .join(InventoryLoan, InventoryLoan.id == InventoryLoanItem.loan_id)
        .where(InventoryLoan.person_oid == oid, InventoryLoanItem.returned_on.is_(None))
        .order_by(InventoryLoanItem.id)
    ).all():
        if device_id not in seen:
            found.append((device_id, None, loan_id))
    return found


def open_return(db: Session, oid: str) -> InventoryReturn | None:
    return db.scalars(
        select(InventoryReturn)
        .where(InventoryReturn.person_oid == oid, InventoryReturn.state == RETURN_OPEN)
        .limit(1)
    ).first()


def create_return(
    db: Session, oid: str, name: str, reason: str, user: CurrentUser | None
) -> InventoryReturn | None:
    """Neue Rückgabe mit allen Geräten der Person; None, wenn sie keine hat."""
    devices = _person_devices(db, oid)
    if not devices:
        return None
    row = InventoryReturn(
        number=next_number(db, "rueckgabe", InventoryReturn),
        person_oid=oid,
        person_name=name[:200] or oid,
        reason=reason,
        created_by=user.user_id if user else None,
    )
    db.add(row)
    db.flush()
    for device_id, position_id, loan_id in devices:
        db.add(
            InventoryReturnItem(
                return_id=row.id, hardware_id=device_id, position_id=position_id, loan_id=loan_id
            )
        )
        add_event(db, device_id, user, f"Rückgabe {row.number} angelegt")
    return row


def ensure_exit_return(db: Session, oid: str, name: str) -> bool:
    """Aus dem Abgleich mit Entra: Rückgabe anlegen, wenn noch keine offen ist."""
    if open_return(db, oid) is not None:
        return False
    return create_return(db, oid, name, REASON_EXIT, None) is not None


@router.get("/returns")
def list_returns(
    user: Reader,
    db: DbDep,
    state: Annotated[Literal["offen", "abgeschlossen", "alle"], Query()] = "offen",
    q: Annotated[str, Query(max_length=100)] = "",
    offset: Annotated[int, Query(ge=0, le=100_000)] = 0,
    limit: Annotated[int, Query(ge=1, le=PAGE_MAX)] = PAGE_SIZE,
) -> ReturnListOut:
    query = select(InventoryReturn)
    if state != "alle":
        query = query.where(InventoryReturn.state == state)
    term = q.strip().casefold()
    if term:
        pattern = f"%{escape_like(term)}%"
        query = query.where(
            or_(
                func.lower(InventoryReturn.number).like(pattern, escape="\\"),
                func.lower(InventoryReturn.person_name).like(pattern, escape="\\"),
            )
        )
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    rows = db.scalars(
        query.order_by(InventoryReturn.created_at.desc(), InventoryReturn.id.desc())
        .offset(offset)
        .limit(limit)
    ).all()
    items: dict[int, list[InventoryReturnItem]] = {}
    if rows:
        for item in db.scalars(
            select(InventoryReturnItem).where(
                InventoryReturnItem.return_id.in_([row.id for row in rows])
            )
        ).all():
            items.setdefault(item.return_id, []).append(item)
    open_count = db.scalar(
        select(func.count())
        .select_from(InventoryReturn)
        .where(InventoryReturn.state == RETURN_OPEN)
    )
    return ReturnListOut(
        returns=[_return_summary(row, items.get(row.id, [])) for row in rows],
        open=open_count or 0,
        total=total,
    )


@router.post("/returns")
def start_return(request: Request, body: ReturnIn, user: Editor, db: DbDep) -> ReturnOut:
    """Rückgabe von Hand, ausgehend von einer Stelle: alle Geräte der Person dort."""
    position = db.get(InventoryPosition, body.position_id)
    if position is None:
        raise _invalid("Unbekannte Stelle")
    if not position.person_oid:
        raise _conflict("An dieser Stelle ist niemand eingetragen.")
    existing = open_return(db, position.person_oid)
    if existing is not None:
        raise _conflict(f"Für diese Person läuft schon die Rückgabe {existing.number}.")
    row = create_return(db, position.person_oid, position.person_name, REASON_MANUAL, user)
    if row is None:
        raise _conflict("Die Person hat keine Geräte im IT-Bestand.")
    _audit(db, request, user, "rueckgabe_neu", "rueckgabe", row.id, {"nummer": row.number})
    db.commit()
    return return_out(db, row)


@router.get("/returns/{return_id}")
def read_return(return_id: ObjectId, user: Reader, db: DbDep) -> ReturnOut:
    return return_out(db, _return(db, return_id))


@router.put("/returns/{return_id}/items/{item_id}")
def update_return_item(
    request: Request,
    return_id: ObjectId,
    item_id: ObjectId,
    body: ReturnItemIn,
    user: Editor,
    db: DbDep,
) -> ReturnOut:
    row = _return(db, return_id)
    if row.state != RETURN_OPEN:
        raise _conflict("Die Rückgabe ist schon abgeschlossen.")
    item = db.get(InventoryReturnItem, item_id)
    if item is None or item.return_id != row.id:
        raise _not_found()
    if body.room_id is not None and db.get(InventoryRoom, body.room_id) is None:
        raise _invalid("Unbekannter Raum")
    item.state = body.state
    item.condition = body.condition
    item.room_id = body.room_id
    item.accessories_ok = body.accessories_ok
    item.wiped = body.wiped
    _audit(
        db,
        request,
        user,
        "rueckgabe_geraet",
        "rueckgabe",
        row.id,
        {"geraet": item.hardware_id, "stand": body.state},
    )
    db.commit()
    return return_out(db, row)


@router.post("/returns/{return_id}/complete")
def complete_return(request: Request, return_id: ObjectId, user: Editor, db: DbDep) -> ReturnOut:
    """Schließt ab: Zurückgegebene Geräte werden frei bzw. der Verleih zurückgetragen."""
    row = _return(db, return_id)
    if row.state != RETURN_OPEN:
        raise _conflict("Die Rückgabe ist schon abgeschlossen.")
    items = _return_items(db, row.id)
    undecided = [item for item in items if item.state == ITEM_OPEN]
    if undecided:
        raise _conflict(f"Bei {len(undecided)} Geräten fehlt noch, ob sie zurück sind.")
    today = local_today()
    devices = _device_rows(db, [item.hardware_id for item in items])
    touched_loans: set[int] = set()
    for item in items:
        device = devices.get(item.hardware_id)
        if device is None:
            continue
        if item.state == ITEM_MISSING:
            add_event(db, device.id, user, f"Bei Rückgabe {row.number} nicht zurückgegeben")
            continue
        if item.position_id is not None and device.position_id == item.position_id:
            device.position_id = None
        if item.loan_id is not None:
            loan_item = db.scalars(
                select(InventoryLoanItem).where(
                    InventoryLoanItem.loan_id == item.loan_id,
                    InventoryLoanItem.hardware_id == device.id,
                    InventoryLoanItem.returned_on.is_(None),
                )
            ).first()
            if loan_item is not None:
                loan_item.returned_on = today
                loan_item.returned_by = user.user_id
                touched_loans.add(item.loan_id)
        if item.room_id is not None:
            device.room_id = item.room_id
        details = [RETURN_CONDITIONS.get(item.condition, item.condition)]
        if item.accessories_ok:
            details.append("Zubehör vollständig")
        if item.wiped:
            details.append("Daten gelöscht")
        add_event(db, device.id, user, f"Zurückgegeben ({row.number}): {', '.join(details)}")
    for loan_id in touched_loans:
        loan = db.get(InventoryLoan, loan_id)
        if loan is None or loan.returned_on is not None:
            continue
        rest = db.scalar(
            select(func.count())
            .select_from(InventoryLoanItem)
            .where(InventoryLoanItem.loan_id == loan.id, InventoryLoanItem.returned_on.is_(None))
        )
        if not rest:
            loan.returned_on = today
            queue_messages(db, loan, LOAN_MSG_RETURN)
            close_overdue_cases(db, loan, user)
    row.state = RETURN_DONE
    row.closed_at = now_utc()
    row.closed_by = user.user_id
    _audit(
        db,
        request,
        user,
        "rueckgabe_abgeschlossen",
        "rueckgabe",
        row.id,
        {
            "nummer": row.number,
            "zurueck": sum(1 for i in items if i.state == ITEM_BACK),
            "fehlt": sum(1 for i in items if i.state == ITEM_MISSING),
        },
    )
    db.commit()
    return return_out(db, row)
