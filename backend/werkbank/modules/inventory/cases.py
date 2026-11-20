"""Vorgänge im IT-Bestand: Eingang für neue und fehlende Geräte aus NinjaOne.

Alle mit Bestand-Rolle sehen die Vorgänge; bearbeiten dürfen nur Bearbeiter. Ein Vorgang ist
neu, in Bearbeitung oder fertig. Abgeschlossen wird er mit einer Entscheidung, die der Server
ausführt (Gerät anlegen und zuordnen, mit einem vorhandenen Gerät verknüpfen, übergehen …).
"""

from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.core.app_settings import NINJA_KEY, get_setting
from werkbank.core.deps import DbDep
from werkbank.core.models import Job, JobStatus, User
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.inventory.api import (
    EVENTS_MAX,
    SOURCE_MANUAL,
    STATUS_RETIRED,
    Editor,
    EventOut,
    ObjectId,
    Reader,
    _audit,
    _holder,
    _room,
    add_event,
    holder_label,
    place_label,
    single_line,
)
from werkbank.modules.inventory.models import (
    InventoryCase,
    InventoryEvent,
    InventoryHardware,
    InventoryKind,
    InventoryMaker,
    InventoryModel,
    InventoryNinjaIgnore,
    InventorySyncRun,
)
from werkbank.modules.inventory.places import room_place
from werkbank.modules.inventory.sync import (
    CASE_MISSING,
    CASE_NEW,
    NINJA_SYNC,
    NINJA_SYNC_INTERVAL,
    OPEN_STATES,
    SOURCE_NINJA,
    STATE_DONE,
    STATE_NEW,
    STATE_WORK,
)
from werkbank.worker.jobs import enqueue

router = APIRouter(prefix="/api/inventory")

KIND_LABELS = {CASE_NEW: "Neu in NinjaOne", CASE_MISSING: "Nicht mehr in NinjaOne"}
DECISIONS: dict[str, dict[str, str]] = {
    CASE_NEW: {
        "stelle": "Einer Stelle zugeordnet",
        "arbeitsplatz": "Einem Arbeitsplatz zugeordnet",
        "lager": "Ins Lager",
        "gleich": "Mit vorhandenem Gerät verknüpft",
        "uebergehen": "Nicht in den Bestand aufgenommen",
    },
    CASE_MISSING: {
        "ausgemustert": "Gerät ist ausgemustert",
        "verloren": "Verloren oder gestohlen",
        "pruefen": "Prüfen, beim nächsten Abgleich erneut",
        "wieder_da": "Wieder in NinjaOne",
        "ersetzt": "Durch einen neuen Eintrag in NinjaOne ersetzt",
    },
}
# Entscheidungen, die nur die Werkbank selbst trifft
AUTOMATIC = frozenset({"wieder_da", "ersetzt"})
LIST_MAX = 1000


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _invalid(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


# --- Schemas ------------------------------------------------------------------------------


class CaseSummary(BaseModel):
    id: int
    number: str
    kind: str
    kind_label: str
    status: str
    title: str
    created_at: datetime
    assignee: str | None


class HardwareRef(BaseModel):
    id: int
    name: str
    hostname: str
    serial: str
    status: str


class CaseOut(CaseSummary):
    facts: dict[str, Any]
    decision: str
    decision_label: str
    closed_at: datetime | None
    hardware: HardwareRef | None
    hint: HardwareRef | None
    events: list[EventOut]


class CaseListOut(BaseModel):
    cases: list[CaseSummary]
    open: int


class NoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=300)

    @field_validator("text")
    @classmethod
    def plain(cls, value: str) -> str:
        value = single_line(value)
        if not value:
            raise ValueError("Darf nicht leer sein")
        return value


class StatusIn(BaseModel):
    status: Literal["neu", "arbeit"]


class DecisionIn(BaseModel):
    decision: str = Field(min_length=1, max_length=32)
    position_id: int | None = Field(default=None, ge=1)
    workplace_id: int | None = Field(default=None, ge=1)
    room_id: int | None = Field(default=None, ge=1)
    # bei „gleich“: das vorhandene Gerät
    hardware_id: int | None = Field(default=None, ge=1)


class SyncRunOut(BaseModel):
    started_at: datetime
    finished_at: datetime | None
    status: str
    devices: int
    updated: int
    new_cases: int
    missing_cases: int
    error: str


class SyncStatusOut(BaseModel):
    enabled: bool
    interval_minutes: int
    last_run: SyncRunOut | None
    next_run_at: datetime | None


# --- Hilfsfunktionen ------------------------------------------------------------------------


def _users(db: Session, ids: set[Any]) -> dict[Any, str]:
    if not ids:
        return {}
    return dict(db.execute(select(User.id, User.display_name).where(User.id.in_(ids))).all())


def _summary(row: InventoryCase, names: dict[Any, str]) -> CaseSummary:
    return CaseSummary(
        id=row.id,
        number=row.number,
        kind=row.kind,
        kind_label=KIND_LABELS.get(row.kind, row.kind),
        status=row.status,
        title=row.title,
        created_at=row.created_at,
        assignee=names.get(row.assignee_id) if row.assignee_id else None,
    )


def _ref(db: Session, hardware_id: int | None) -> HardwareRef | None:
    if hardware_id is None:
        return None
    row = db.get(InventoryHardware, hardware_id)
    if row is None:
        return None
    return HardwareRef(
        id=row.id, name=row.name, hostname=row.hostname, serial=row.serial, status=row.status
    )


def case_out(db: Session, row: InventoryCase) -> CaseOut:
    names = _users(db, {row.assignee_id} if row.assignee_id else set())
    events = db.execute(
        select(InventoryEvent.occurred_at, InventoryEvent.text, User.display_name)
        .outerjoin(User, User.id == InventoryEvent.user_id)
        .where(InventoryEvent.case_id == row.id)
        .order_by(InventoryEvent.occurred_at.desc(), InventoryEvent.id.desc())
        .limit(EVENTS_MAX)
    ).all()
    return CaseOut(
        **_summary(row, names).model_dump(),
        facts=row.facts or {},
        decision=row.decision,
        decision_label=DECISIONS.get(row.kind, {}).get(row.decision, ""),
        closed_at=row.closed_at,
        hardware=_ref(db, row.hardware_id),
        hint=_ref(db, row.hint_hardware_id),
        events=[
            EventOut(occurred_at=at, who=name or "Werkbank (Abgleich)", text=text)
            for at, text, name in events
        ],
    )


def _case(db: Session, case_id: int) -> InventoryCase:
    row = db.get(InventoryCase, case_id)
    if row is None:
        raise _not_found()
    return row


def _case_event(db: Session, user: CurrentUser, case_id: int, text: str) -> None:
    db.add(
        InventoryEvent(
            case_id=case_id, user_id=user.user_id, occurred_at=now_utc(), text=text[:400]
        )
    )


def _open(row: InventoryCase) -> None:
    if row.status not in OPEN_STATES:
        raise _conflict("Der Vorgang ist schon abgeschlossen.")


def _kind_by_name(db: Session, name: str) -> InventoryKind:
    kind = db.scalars(
        select(InventoryKind).where(func.lower(InventoryKind.name) == name.casefold())
    ).first()
    if kind is None:
        raise _conflict(f"Die Hardware-Art „{name}“ fehlt in den Stammdaten. Bitte zuerst anlegen.")
    return kind


def _model_for(db: Session, maker_name: str, model_name: str) -> InventoryModel | None:
    """Hersteller und Modell aus NinjaOne; fehlen sie in den Stammdaten, entstehen sie neu."""
    if not maker_name or not model_name:
        return None
    maker = db.scalars(
        select(InventoryMaker).where(func.lower(InventoryMaker.name) == maker_name.casefold())
    ).first()
    if maker is None:
        maker = InventoryMaker(name=maker_name[:80])
        db.add(maker)
        db.flush()
    model = db.scalars(
        select(InventoryModel).where(
            InventoryModel.maker_id == maker.id,
            func.lower(InventoryModel.name) == model_name.casefold(),
        )
    ).first()
    if model is None:
        model = InventoryModel(maker_id=maker.id, name=model_name[:120])
        db.add(model)
        db.flush()
    return model


def _text(facts: dict[str, Any], key: str, limit: int) -> str:
    value = facts.get(key)
    return value.strip()[:limit] if isinstance(value, str) else ""


def _create_from_case(
    db: Session, user: CurrentUser, row: InventoryCase, body: DecisionIn
) -> InventoryHardware:
    facts = row.facts or {}
    if row.ninja_id is None:
        raise _conflict("Dem Vorgang fehlt die NinjaOne-ID.")
    if db.scalar(select(InventoryHardware.id).where(InventoryHardware.ninja_id == row.ninja_id)):
        raise _conflict("Dieses Gerät aus NinjaOne ist schon im Bestand.")
    serial = _text(facts, "serial", 80)
    if serial and db.scalar(
        select(InventoryHardware.id).where(
            func.lower(InventoryHardware.serial) == serial.casefold()
        )
    ):
        raise _conflict(
            "Ein Gerät mit dieser Seriennummer ist schon im Bestand. Wähle „Ist dasselbe Gerät“."
        )
    position, workplace = (None, None)
    room = None
    if body.decision == "stelle":
        if body.position_id is None:
            raise _invalid("Bitte eine Stelle wählen.")
        position, workplace = _holder(db, body.position_id, None)
    elif body.decision == "arbeitsplatz":
        if body.workplace_id is None:
            raise _invalid("Bitte einen Arbeitsplatz wählen.")
        position, workplace = _holder(db, None, body.workplace_id)
    else:
        room = _room(db, body.room_id)
    kind = _kind_by_name(db, _text(facts, "kind", 40) or "PC")
    maker_name = _text(facts, "maker", 80)
    model_name = _text(facts, "model", 120)
    model = _model_for(db, maker_name, model_name)
    hostname = _text(facts, "hostname", 80)
    name = f"{maker_name} {model_name}".strip() or hostname or f"Gerät {row.ninja_id}"
    device = InventoryHardware(
        kind_id=kind.id,
        model_id=model.id if model else None,
        name=name[:160],
        serial=serial,
        hostname=hostname,
        note="",
        inventory_no=None,
        room_id=room.id if room else None,
        position_id=position.id if position else None,
        workplace_id=workplace.id if workplace else None,
        source=SOURCE_NINJA,
        status="aktiv",
        ninja_id=row.ninja_id,
        ninja_facts={key: value for key, value in facts.items() if key != "ninja_id"},
        ninja_seen_at=now_utc(),
    )
    db.add(device)
    db.flush()
    add_event(db, device.id, user, f"Aus NinjaOne übernommen (Vorgang {row.number})")
    if position is not None or workplace is not None:
        add_event(db, device.id, user, f"Zugeordnet: {holder_label(position, workplace)}")
    if room is not None:
        add_event(db, device.id, user, f"Standort: {place_label(room_place(db, room.id))}")
    return device


def _close(db: Session, user: CurrentUser, row: InventoryCase, decision: str, text: str) -> None:
    row.decision = decision
    row.status = STATE_DONE
    row.closed_at = now_utc()
    if row.assignee_id is None:
        row.assignee_id = user.user_id
    _case_event(db, user, row.id, text)


# --- Endpunkte ------------------------------------------------------------------------------


@router.get("/cases")
def list_cases(
    user: Reader,
    db: DbDep,
    state: Annotated[Literal["offen", "neu", "arbeit", "fertig", "alle"], Query()] = "offen",
) -> CaseListOut:
    query = select(InventoryCase)
    if state == "offen":
        query = query.where(InventoryCase.status.in_(OPEN_STATES))
    elif state != "alle":
        query = query.where(InventoryCase.status == state)
    rows = db.scalars(
        query.order_by(InventoryCase.created_at.desc(), InventoryCase.id.desc()).limit(LIST_MAX)
    ).all()
    names = _users(db, {row.assignee_id for row in rows if row.assignee_id})
    open_count = db.scalar(
        select(func.count()).select_from(InventoryCase).where(InventoryCase.status.in_(OPEN_STATES))
    )
    return CaseListOut(cases=[_summary(row, names) for row in rows], open=open_count or 0)


@router.get("/cases/{case_id}")
def read_case(case_id: ObjectId, user: Reader, db: DbDep) -> CaseOut:
    return case_out(db, _case(db, case_id))


@router.post("/cases/{case_id}/take")
def take_case(request: Request, case_id: ObjectId, user: Editor, db: DbDep) -> CaseOut:
    """„Ich übernehme“: Bearbeiter wird die angemeldete Person, Status „in Bearbeitung“."""
    row = _case(db, case_id)
    _open(row)
    row.assignee_id = user.user_id
    row.status = STATE_WORK
    _case_event(db, user, row.id, "Übernommen")
    _audit(db, request, user, "vorgang_uebernommen", "vorgang", row.id, {"nummer": row.number})
    db.commit()
    return case_out(db, row)


@router.post("/cases/{case_id}/status")
def set_case_status(
    request: Request, case_id: ObjectId, body: StatusIn, user: Editor, db: DbDep
) -> CaseOut:
    """Status zwischen „neu“ und „in Bearbeitung“; abgeschlossen wird mit einer Entscheidung."""
    row = _case(db, case_id)
    _open(row)
    if row.status != body.status:
        row.status = body.status
        _case_event(
            db, user, row.id, "Status: " + ("neu" if body.status == STATE_NEW else "in Bearbeitung")
        )
        _audit(
            db,
            request,
            user,
            "vorgang_status",
            "vorgang",
            row.id,
            {"nummer": row.number, "status": body.status},
        )
        db.commit()
    return case_out(db, row)


@router.post("/cases/{case_id}/note")
def add_case_note(
    request: Request, case_id: ObjectId, body: NoteIn, user: Editor, db: DbDep
) -> CaseOut:
    row = _case(db, case_id)
    _case_event(db, user, row.id, f"Notiz: {body.text}")
    _audit(db, request, user, "vorgang_notiz", "vorgang", row.id, {"nummer": row.number})
    db.commit()
    return case_out(db, row)


@router.post("/cases/{case_id}/decide")
def decide_case(
    request: Request, case_id: ObjectId, body: DecisionIn, user: Editor, db: DbDep
) -> CaseOut:
    """Führt die Entscheidung aus und schließt den Vorgang (außer bei „prüfen“)."""
    row = _case(db, case_id)
    _open(row)
    options = DECISIONS.get(row.kind, {})
    if body.decision not in options or body.decision in AUTOMATIC:
        raise _invalid("Diese Entscheidung passt nicht zum Vorgang.")
    details: dict[str, object] = {"nummer": row.number, "entscheidung": body.decision}

    if row.kind == CASE_NEW:
        if body.decision in ("stelle", "arbeitsplatz", "lager"):
            device = _create_from_case(db, user, row, body)
            row.hardware_id = device.id
            details["geraet"] = device.id
            _close(db, user, row, body.decision, f"Entschieden: {options[body.decision]}")
        elif body.decision == "gleich":
            target = db.get(InventoryHardware, body.hardware_id) if body.hardware_id else None
            if target is None:
                raise _invalid("Bitte das vorhandene Gerät wählen.")
            if target.ninja_id is not None and target.ninja_id != row.ninja_id:
                # Das alte Gerät war mit einem anderen NinjaOne-Eintrag verknüpft, etwa vor einem
                # Mainboardtausch. Dessen offener Vorgang „fehlt“ erledigt sich damit.
                for missing in db.scalars(
                    select(InventoryCase).where(
                        InventoryCase.kind == CASE_MISSING,
                        InventoryCase.hardware_id == target.id,
                        InventoryCase.status.in_(OPEN_STATES),
                    )
                ).all():
                    _close(
                        db,
                        user,
                        missing,
                        "ersetzt",
                        f"Erledigt mit Vorgang {row.number}: neuer Eintrag in NinjaOne",
                    )
            facts = row.facts or {}
            old_ninja = target.ninja_id
            target.ninja_id = row.ninja_id
            target.ninja_facts = {key: value for key, value in facts.items() if key != "ninja_id"}
            target.ninja_seen_at = now_utc()
            target.ninja_missing_since = None
            new_host = _text(facts, "hostname", 80)
            new_serial = _text(facts, "serial", 80)
            changes = []
            if new_host and new_host != target.hostname:
                changes.append(f"Hostname {target.hostname or 'leer'} → {new_host}")
                target.hostname = new_host
            if new_serial and new_serial.casefold() != target.serial.casefold():
                other = db.scalar(
                    select(InventoryHardware.id).where(
                        func.lower(InventoryHardware.serial) == new_serial.casefold(),
                        InventoryHardware.id != target.id,
                    )
                )
                if other:
                    raise _conflict("Diese Seriennummer gehört schon zu einem anderen Gerät.")
                changes.append(f"Seriennummer {target.serial or 'leer'} → {new_serial}")
                target.serial = new_serial
            if target.source == SOURCE_MANUAL:
                target.source = SOURCE_NINJA
            add_event(
                db,
                target.id,
                user,
                f"Mit NinjaOne verknüpft (Vorgang {row.number})"
                + (f": {'; '.join(changes)}" if changes else "")
                + ("; vorher anderer Eintrag in NinjaOne" if old_ninja else ""),
            )
            row.hardware_id = target.id
            details["geraet"] = target.id
            _close(db, user, row, "gleich", f"Entschieden: Ist dasselbe Gerät wie „{target.name}“")
        else:  # uebergehen
            if row.ninja_id is not None and db.get(InventoryNinjaIgnore, row.ninja_id) is None:
                facts = row.facts or {}
                db.add(
                    InventoryNinjaIgnore(
                        ninja_id=row.ninja_id,
                        hostname=_text(facts, "hostname", 80),
                        serial=_text(facts, "serial", 80),
                        ignored_by=user.user_id,
                    )
                )
            _close(
                db,
                user,
                row,
                "uebergehen",
                "Entschieden: nicht in den Bestand aufnehmen; der Abgleich meldet es nicht wieder",
            )
    else:
        device = db.get(InventoryHardware, row.hardware_id) if row.hardware_id else None
        if body.decision == "ausgemustert":
            if device is not None and device.status != STATUS_RETIRED:
                raise _conflict(
                    "Bitte mustere das Gerät zuerst aus (mit Grund, Verbleib und Datenträger)."
                )
            _close(db, user, row, "ausgemustert", "Entschieden: Gerät ist ausgemustert")
        elif body.decision == "verloren":
            if device is not None:
                add_event(db, device.id, user, f"Laut Vorgang {row.number} verloren oder gestohlen")
            _close(db, user, row, "verloren", "Entschieden: verloren oder gestohlen")
        else:  # pruefen
            row.decision = "pruefen"
            row.status = STATE_WORK
            if row.assignee_id is None:
                row.assignee_id = user.user_id
            _case_event(
                db,
                user,
                row.id,
                "Wird geprüft; taucht das Gerät wieder in NinjaOne auf, schließt sich der Vorgang",
            )
    _audit(db, request, user, "vorgang_entschieden", "vorgang", row.id, details)
    db.commit()
    db.refresh(row)
    return case_out(db, row)


@router.get("/ninjaone/status")
def sync_status(user: Reader, db: DbDep) -> SyncStatusOut:
    """Stand des Abgleichs mit NinjaOne für die Seite „Vorgänge“."""
    stored = get_setting(db, NINJA_KEY)
    enabled = isinstance(stored, dict) and stored.get("enabled") is True
    last = db.scalars(
        select(InventorySyncRun).order_by(InventorySyncRun.started_at.desc()).limit(1)
    ).first()
    next_run = db.scalar(
        select(func.min(Job.scheduled_at)).where(
            Job.type == NINJA_SYNC, Job.status == JobStatus.PLANNED
        )
    )
    return SyncStatusOut(
        enabled=enabled,
        interval_minutes=int(NINJA_SYNC_INTERVAL.total_seconds() // 60),
        last_run=SyncRunOut(
            started_at=last.started_at,
            finished_at=last.finished_at,
            status=last.status,
            devices=last.devices,
            updated=last.updated,
            new_cases=last.new_cases,
            missing_cases=last.missing_cases,
            error=last.error,
        )
        if last
        else None,
        next_run_at=next_run if enabled else None,
    )


class RunNowOut(BaseModel):
    scheduled_at: datetime


@router.post("/ninjaone/run")
def run_sync_now(request: Request, user: Editor, db: DbDep) -> RunNowOut:
    """Zieht den nächsten Abgleich vor. Läuft schon einer, bleibt es dabei."""
    stored = get_setting(db, NINJA_KEY)
    if not (isinstance(stored, dict) and stored.get("enabled") is True):
        raise _conflict("Der Abgleich mit NinjaOne ist in der Verwaltung ausgeschaltet.")
    now = now_utc()
    planned = db.scalars(
        select(Job)
        .where(Job.type == NINJA_SYNC, Job.status == JobStatus.PLANNED)
        .order_by(Job.scheduled_at)
        .limit(1)
    ).first()
    if planned is None:
        planned = enqueue(db, NINJA_SYNC, scheduled_at=now)
    elif planned.scheduled_at > now:
        planned.scheduled_at = now
    _audit(db, request, user, "abgleich_angestossen", "auftrag", 0, {"auftrag": NINJA_SYNC})
    db.commit()
    return RunNowOut(scheduled_at=planned.scheduled_at)
