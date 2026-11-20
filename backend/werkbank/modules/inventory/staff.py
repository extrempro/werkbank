"""Stellen und Arbeitsplätze im IT-Bestand, dazu Nummernkreise und die Personensuche.

Eine Stelle wird von einer Person aus Entra besetzt; die Besetzung pflegt nur die Werkbank.
Hardware und Arbeitsplätze hängen an der Stelle, nicht an der Person. Ein Arbeitsplatz ist
einzeln (höchstens eine Stelle) oder geteilt (mehrere Stellen) und kann eine Ausstattungsvorlage
haben; die Werkbank zeigt dann, was fehlt.
"""

import re
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from werkbank.core.deps import DbDep
from werkbank.core.models import User
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.inventory.api import (
    EVENTS_MAX,
    STATUS_ACTIVE,
    Editor,
    EventOut,
    HardwareSummary,
    LocationOut,
    ObjectId,
    Reader,
    _audit,
    _names,
    _not_empty,
    _places,
    _summary,
    place_label,
    position_label,
    single_line,
    workplace_label,
)
from werkbank.modules.inventory.models import (
    InventoryCase,
    InventoryDepartment,
    InventoryEvent,
    InventoryFloor,
    InventoryHardware,
    InventoryKind,
    InventoryKit,
    InventoryKitRow,
    InventoryKitRowKind,
    InventoryNumberRange,
    InventoryPosition,
    InventoryRoom,
    InventorySection,
    InventorySite,
    InventoryWorkplace,
    InventoryWorkplacePosition,
)
from werkbank.modules.inventory.people import (
    PeopleError,
    PeopleFinder,
    get_people_finder,
)
from werkbank.modules.inventory.places import room_place

router = APIRouter(prefix="/api/inventory")

RANGE_LABELS = {"stelle": "Stellen", "arbeitsplatz": "Arbeitsplätze", "vorgang": "Vorgänge"}
_PREFIX = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,9}$")
_OID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
LIST_MAX = 5000
POSITIONS_PER_WORKPLACE = 50


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _invalid(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


# --- Schemas ------------------------------------------------------------------------------


class PersonOut(BaseModel):
    oid: str
    name: str
    upn: str
    department: str = ""
    job_title: str = ""
    enabled: bool = True


class PersonIn(BaseModel):
    oid: str = Field(min_length=36, max_length=36)
    name: str = Field(min_length=1, max_length=200)
    upn: str = Field(default="", max_length=200)

    @field_validator("oid")
    @classmethod
    def plain_oid(cls, value: str) -> str:
        value = value.lower()
        if not _OID.match(value):
            raise ValueError("Keine gültige Objekt-ID")
        return value

    @field_validator("name", "upn")
    @classmethod
    def plain(cls, value: str) -> str:
        return single_line(value)

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, value: str) -> str:
        return _not_empty(value)


class NumberRangeOut(BaseModel):
    key: str
    label: str
    prefix: str
    next_number: str


class NumberRangeIn(BaseModel):
    prefix: str = Field(min_length=1, max_length=10)

    @field_validator("prefix")
    @classmethod
    def plain(cls, value: str) -> str:
        value = value.strip()
        if not _PREFIX.match(value):
            raise ValueError("Nur Buchstaben, Ziffern und . _ / -, höchstens 10 Zeichen")
        return value


class PositionIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    department_id: int | None = Field(default=None, ge=1)
    person: PersonIn | None = None
    note: str = Field(default="", max_length=500)

    @field_validator("name", "note")
    @classmethod
    def plain(cls, value: str) -> str:
        return single_line(value)

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, value: str) -> str:
        return _not_empty(value)


class PositionBrief(BaseModel):
    id: int
    number: str
    name: str
    person_name: str


class WorkplaceBrief(BaseModel):
    id: int
    number: str
    name: str
    shared: bool
    place: str | None


class PositionSummary(BaseModel):
    id: int
    number: str
    name: str
    department_id: int | None
    department: str
    person: PersonOut | None
    workplaces: int
    hardware: int
    # Standorte der Arbeitsplätze, z. B. „Haus Nord, Haus Süd“
    sites: str


class PositionOut(PositionSummary):
    note: str
    created_at: datetime
    workplace_list: list[WorkplaceBrief]
    hardware_list: list[HardwareSummary]
    events: list[EventOut]


class WorkplaceIn(BaseModel):
    name: str = Field(default="", max_length=80)
    room_id: int | None = Field(default=None, ge=1)
    shared: bool = False
    kit_id: int | None = Field(default=None, ge=1)
    position_ids: list[int] = Field(default_factory=list, max_length=POSITIONS_PER_WORKPLACE)
    note: str = Field(default="", max_length=500)

    @field_validator("name", "note")
    @classmethod
    def plain(cls, value: str) -> str:
        return single_line(value)


class EquipmentRow(BaseModel):
    label: str
    need: int
    have: int
    kinds: list[str]
    devices: list[str]


class Equipment(BaseModel):
    kit: str
    complete: bool
    missing: int
    rows: list[EquipmentRow]


class WorkplaceSummary(BaseModel):
    id: int
    number: str
    name: str
    shared: bool
    room_id: int | None
    place: str | None
    positions: list[PositionBrief]
    kit_id: int | None
    kit: str | None
    # None ohne Vorlage
    complete: bool | None
    missing: int


class WorkplaceOut(WorkplaceSummary):
    note: str
    location: LocationOut | None
    created_at: datetime
    hardware_list: list[HardwareSummary]
    equipment: Equipment | None
    events: list[EventOut]


class AssigneesOut(BaseModel):
    """Kurzlisten für Auswahlfelder, z. B. beim Gerät."""

    positions: list[PositionBrief]
    workplaces: list[WorkplaceBrief]


# --- Hilfsfunktionen ------------------------------------------------------------------------


def add_staff_event(
    db: Session,
    user: CurrentUser,
    text: str,
    *,
    position_id: int | None = None,
    workplace_id: int | None = None,
) -> None:
    db.add(
        InventoryEvent(
            position_id=position_id,
            workplace_id=workplace_id,
            user_id=user.user_id,
            occurred_at=now_utc(),
            text=text[:400],
        )
    )


def _events(db: Session, **target: int) -> list[EventOut]:
    ((column, value),) = target.items()
    rows = db.execute(
        select(InventoryEvent.occurred_at, InventoryEvent.text, User.display_name)
        .outerjoin(User, User.id == InventoryEvent.user_id)
        .where(getattr(InventoryEvent, column) == value)
        .order_by(InventoryEvent.occurred_at.desc(), InventoryEvent.id.desc())
        .limit(EVENTS_MAX)
    ).all()
    return [EventOut(occurred_at=at, who=name or "Werkbank", text=text) for at, text, name in rows]


def format_number(prefix: str, value: int) -> str:
    return f"{prefix}{value:03d}"


def next_number(
    db: Session,
    key: str,
    table: type[InventoryPosition] | type[InventoryWorkplace] | type[InventoryCase],
) -> str:
    """Nächste freie Nummer des Kreises; die Zeile ist bis zum Commit gesperrt."""
    number_range = db.scalars(
        select(InventoryNumberRange).where(InventoryNumberRange.key == key).with_for_update()
    ).first()
    if number_range is None:
        number_range = InventoryNumberRange(key=key, prefix="", next_value=1)
        db.add(number_range)
    value = number_range.next_value
    while True:
        number = format_number(number_range.prefix, value)
        taken = db.scalar(select(func.count()).select_from(table).where(table.number == number))
        value += 1
        if not taken:
            break
    number_range.next_value = value
    return number


def _department(db: Session, department_id: int | None) -> InventoryDepartment | None:
    if department_id is None:
        return None
    row = db.get(InventoryDepartment, department_id)
    if row is None:
        raise _invalid("Unbekannte Abteilung")
    return row


def _position(db: Session, position_id: int) -> InventoryPosition:
    row = db.get(InventoryPosition, position_id)
    if row is None:
        raise _not_found()
    return row


def _workplace(db: Session, workplace_id: int) -> InventoryWorkplace:
    row = db.get(InventoryWorkplace, workplace_id)
    if row is None:
        raise _not_found()
    return row


def _person(row: InventoryPosition) -> PersonOut | None:
    if row.person_oid is None:
        return None
    return PersonOut(oid=row.person_oid, name=row.person_name, upn=row.person_upn)


def _person_text(row: InventoryPosition) -> str:
    return row.person_name if row.person_oid else "unbesetzt"


def _site_names(db: Session) -> dict[int, str]:
    """Standort (Gebäude) je Raum."""
    return dict(
        db.execute(
            select(InventoryRoom.id, InventorySite.name)
            .join(InventoryFloor, InventoryFloor.id == InventoryRoom.floor_id)
            .join(InventorySection, InventorySection.id == InventoryFloor.section_id)
            .join(InventorySite, InventorySite.id == InventorySection.site_id)
        ).all()
    )


def _links(db: Session) -> list[tuple[int, int]]:
    """Paare (Arbeitsplatz, Stelle)."""
    return [
        (workplace_id, position_id)
        for workplace_id, position_id in db.execute(
            select(InventoryWorkplacePosition.workplace_id, InventoryWorkplacePosition.position_id)
        ).all()
    ]


def _hardware_counts(db: Session, column: str) -> dict[int, int]:
    attr = getattr(InventoryHardware, column)
    return dict(
        db.execute(
            select(attr, func.count())
            .where(attr.is_not(None), InventoryHardware.status == STATUS_ACTIVE)
            .group_by(attr)
        ).all()
    )


def _hardware_of(db: Session, **where: int) -> list[HardwareSummary]:
    ((column, value),) = where.items()
    rows = db.scalars(
        select(InventoryHardware)
        .where(
            getattr(InventoryHardware, column) == value, InventoryHardware.status == STATUS_ACTIVE
        )
        .order_by(func.lower(InventoryHardware.name), InventoryHardware.id)
    ).all()
    kinds, models = _names(db)
    places = _places(db)
    return [_summary(row, kinds, models, places) for row in rows]


def _sites_text(names: set[str]) -> str:
    return ", ".join(sorted(names, key=str.casefold))


def position_summaries(db: Session, only: int | None = None) -> list[PositionSummary]:
    query = select(InventoryPosition)
    if only is not None:
        query = query.where(InventoryPosition.id == only)
    rows = db.scalars(
        query.order_by(InventoryPosition.number, InventoryPosition.id).limit(LIST_MAX)
    ).all()
    departments = {row.id: row.name for row in db.scalars(select(InventoryDepartment)).all()}
    rooms_of_workplace = dict(
        db.execute(select(InventoryWorkplace.id, InventoryWorkplace.room_id)).all()
    )
    sites = _site_names(db)
    workplaces_of: dict[int, list[int]] = {}
    for workplace_id, position_id in _links(db):
        workplaces_of.setdefault(position_id, []).append(workplace_id)
    hardware = _hardware_counts(db, "position_id")
    result: list[PositionSummary] = []
    for row in rows:
        own = workplaces_of.get(row.id, [])
        names = {
            sites[room]
            for room in (rooms_of_workplace.get(workplace_id) for workplace_id in own)
            if room is not None and room in sites
        }
        result.append(
            PositionSummary(
                id=row.id,
                number=row.number,
                name=row.name,
                department_id=row.department_id,
                department=departments.get(row.department_id, "") if row.department_id else "",
                person=_person(row),
                workplaces=len(own),
                hardware=hardware.get(row.id, 0),
                sites=_sites_text(names),
            )
        )
    return result


def position_out(db: Session, row: InventoryPosition) -> PositionOut:
    summary = position_summaries(db, row.id)[0]
    places = _places(db)
    workplaces = db.scalars(
        select(InventoryWorkplace)
        .join(
            InventoryWorkplacePosition,
            InventoryWorkplacePosition.workplace_id == InventoryWorkplace.id,
        )
        .where(InventoryWorkplacePosition.position_id == row.id)
        .order_by(InventoryWorkplace.number)
    ).all()
    return PositionOut(
        **summary.model_dump(),
        note=row.note,
        created_at=row.created_at,
        workplace_list=[
            WorkplaceBrief(
                id=entry.id,
                number=entry.number,
                name=entry.name,
                shared=entry.shared,
                place=places.get(entry.room_id) if entry.room_id else None,
            )
            for entry in workplaces
        ],
        hardware_list=_hardware_of(db, position_id=row.id),
        events=_events(db, position_id=row.id),
    )


def equipment(db: Session, workplace: InventoryWorkplace) -> Equipment | None:
    """Vergleicht die Vorlage mit der Hardware am Arbeitsplatz und an seinen Stellen.

    Jedes Gerät zählt nur einmal; die Zeilen werden in ihrer Reihenfolge bedient.
    """
    if workplace.kit_id is None:
        return None
    kit = db.get(InventoryKit, workplace.kit_id)
    if kit is None:
        return None
    position_ids = [
        position_id for workplace_id, position_id in _links(db) if workplace_id == workplace.id
    ]
    pool_query = select(InventoryHardware).where(InventoryHardware.status == STATUS_ACTIVE)
    if position_ids:
        pool_query = pool_query.where(
            (InventoryHardware.workplace_id == workplace.id)
            | InventoryHardware.position_id.in_(position_ids)
        )
    else:
        pool_query = pool_query.where(InventoryHardware.workplace_id == workplace.id)
    pool = list(db.scalars(pool_query.order_by(InventoryHardware.id)).all())
    kind_names = {row.id: row.name for row in db.scalars(select(InventoryKind)).all()}
    rows_out: list[EquipmentRow] = []
    used: set[int] = set()
    for kit_row in db.scalars(
        select(InventoryKitRow)
        .where(InventoryKitRow.kit_id == kit.id)
        .order_by(InventoryKitRow.position, InventoryKitRow.id)
    ).all():
        kinds = set(
            db.scalars(
                select(InventoryKitRowKind.kind_id).where(InventoryKitRowKind.row_id == kit_row.id)
            ).all()
        )
        matched = [device for device in pool if device.id not in used and device.kind_id in kinds][
            : kit_row.count
        ]
        used.update(device.id for device in matched)
        rows_out.append(
            EquipmentRow(
                label=kit_row.label,
                need=kit_row.count,
                have=len(matched),
                kinds=sorted((kind_names.get(kind, "") for kind in kinds), key=str.casefold),
                devices=[device.name for device in matched],
            )
        )
    missing = sum(max(0, row.need - row.have) for row in rows_out)
    return Equipment(kit=kit.name, complete=missing == 0, missing=missing, rows=rows_out)


def workplace_summaries(db: Session, only: int | None = None) -> list[WorkplaceSummary]:
    query = select(InventoryWorkplace)
    if only is not None:
        query = query.where(InventoryWorkplace.id == only)
    rows = db.scalars(
        query.order_by(InventoryWorkplace.number, InventoryWorkplace.id).limit(LIST_MAX)
    ).all()
    places = _places(db)
    kits = {row.id: row.name for row in db.scalars(select(InventoryKit)).all()}
    positions = {row.id: row for row in db.scalars(select(InventoryPosition)).all()}
    positions_of: dict[int, list[PositionBrief]] = {}
    for workplace_id, position_id in _links(db):
        position = positions.get(position_id)
        if position is not None:
            positions_of.setdefault(workplace_id, []).append(
                PositionBrief(
                    id=position.id,
                    number=position.number,
                    name=position.name,
                    person_name=position.person_name if position.person_oid else "",
                )
            )
    result: list[WorkplaceSummary] = []
    for row in rows:
        check = equipment(db, row)
        result.append(
            WorkplaceSummary(
                id=row.id,
                number=row.number,
                name=row.name,
                shared=row.shared,
                room_id=row.room_id,
                place=places.get(row.room_id) if row.room_id else None,
                positions=sorted(positions_of.get(row.id, []), key=lambda entry: entry.number),
                kit_id=row.kit_id,
                kit=kits.get(row.kit_id) if row.kit_id else None,
                complete=check.complete if check else None,
                missing=check.missing if check else 0,
            )
        )
    return result


def workplace_out(db: Session, row: InventoryWorkplace) -> WorkplaceOut:
    summary = workplace_summaries(db, row.id)[0]
    place = room_place(db, row.room_id)
    return WorkplaceOut(
        **summary.model_dump(),
        note=row.note,
        location=LocationOut(**vars(place)) if place else None,
        created_at=row.created_at,
        hardware_list=_hardware_of(db, workplace_id=row.id),
        equipment=equipment(db, row),
        events=_events(db, workplace_id=row.id),
    )


# --- Personen aus Entra -----------------------------------------------------------------------


@router.get("/people")
def search_people(
    user: Editor,
    finder: Annotated[PeopleFinder, Depends(get_people_finder)],
    q: Annotated[str, Query(min_length=2, max_length=60)],
) -> list[PersonOut]:
    """Personen aus Entra für die Besetzung einer Stelle (nur für Bearbeiter)."""
    try:
        people = finder(q)
    except PeopleError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Die Suche in Entra ist gerade nicht möglich. {exc}",
        ) from exc
    return [PersonOut(**vars(person)) for person in people]


# --- Nummernkreise ----------------------------------------------------------------------------


def number_ranges(db: Session) -> list[NumberRangeOut]:
    rows = {row.key: row for row in db.scalars(select(InventoryNumberRange)).all()}
    result: list[NumberRangeOut] = []
    for key, label in RANGE_LABELS.items():
        row = rows.get(key)
        prefix = row.prefix if row else ""
        value = row.next_value if row else 1
        result.append(
            NumberRangeOut(
                key=key, label=label, prefix=prefix, next_number=format_number(prefix, value)
            )
        )
    return result


@router.get("/number-ranges")
def read_number_ranges(user: Reader, db: DbDep) -> list[NumberRangeOut]:
    return number_ranges(db)


@router.put("/number-ranges/{key}")
def update_number_range(
    request: Request,
    key: Literal["stelle", "arbeitsplatz", "vorgang"],
    body: NumberRangeIn,
    user: Editor,
    db: DbDep,
) -> list[NumberRangeOut]:
    """Neues Präfix; gilt nur für neue Einträge. Die Zahl läuft weiter."""
    row = db.get(InventoryNumberRange, key)
    if row is None:
        row = InventoryNumberRange(key=key, prefix=body.prefix, next_value=1)
        db.add(row)
        before = ""
    else:
        before = row.prefix
        row.prefix = body.prefix
    _audit(
        db,
        request,
        user,
        "nummernkreis",
        "nummernkreis",
        0,
        {"kreis": key, "vorher": before, "nachher": body.prefix},
    )
    db.commit()
    return number_ranges(db)


# --- Stellen ----------------------------------------------------------------------------------


def _position_details(row: InventoryPosition) -> dict[str, object]:
    """Ins Audit-Log: Kennungen der Stelle, ob besetzt, aber keine Namen von Personen."""
    return {
        "nummer": row.number,
        "bezeichnung": row.name,
        "abteilung": row.department_id,
        "besetzt": row.person_oid is not None,
    }


@router.get("/positions")
def list_positions(user: Reader, db: DbDep) -> list[PositionSummary]:
    return position_summaries(db)


@router.post("/positions", status_code=status.HTTP_201_CREATED)
def create_position(request: Request, body: PositionIn, user: Editor, db: DbDep) -> PositionOut:
    department = _department(db, body.department_id)
    row = InventoryPosition(
        number=next_number(db, "stelle", InventoryPosition),
        name=body.name,
        department_id=department.id if department else None,
        person_oid=body.person.oid if body.person else None,
        person_name=body.person.name if body.person else "",
        person_upn=body.person.upn if body.person else "",
        note=body.note,
    )
    db.add(row)
    db.flush()
    add_staff_event(db, user, "Stelle angelegt", position_id=row.id)
    if body.person:
        add_staff_event(db, user, f"Besetzt durch {body.person.name}", position_id=row.id)
    _audit(db, request, user, "stelle_angelegt", "stelle", row.id, _position_details(row))
    db.commit()
    db.refresh(row)
    return position_out(db, row)


@router.get("/positions/{position_id}")
def read_position(position_id: ObjectId, user: Reader, db: DbDep) -> PositionOut:
    return position_out(db, _position(db, position_id))


@router.put("/positions/{position_id}")
def update_position(
    request: Request, position_id: ObjectId, body: PositionIn, user: Editor, db: DbDep
) -> PositionOut:
    row = _position(db, position_id)
    department = _department(db, body.department_id)
    before = _position_details(row)
    changes: list[str] = []
    if row.name != body.name:
        changes.append(f"Bezeichnung: {row.name} → {body.name}")
    new_department = department.id if department else None
    if row.department_id != new_department:
        old = db.get(InventoryDepartment, row.department_id) if row.department_id else None
        old_name = old.name if old else "keine"
        new_name = department.name if department else "keine"
        changes.append(f"Abteilung: {old_name} → {new_name}")
    if row.note != body.note:
        changes.append("Notiz geändert")
    new_oid = body.person.oid if body.person else None
    person_changed = row.person_oid != new_oid
    if person_changed:
        changes.append(
            f"Besetzung: {_person_text(row)} → {body.person.name if body.person else 'unbesetzt'}"
        )
    row.name = body.name
    row.department_id = new_department
    row.note = body.note
    row.person_oid = new_oid
    # Name und Anmeldename aktualisieren, auch wenn dieselbe Person gewählt bleibt
    row.person_name = body.person.name if body.person else ""
    row.person_upn = body.person.upn if body.person else ""
    if changes:
        add_staff_event(db, user, "Geändert: " + "; ".join(changes), position_id=row.id)
        _audit(
            db,
            request,
            user,
            "stelle_geaendert",
            "stelle",
            row.id,
            {"vorher": before, "nachher": _position_details(row)},
        )
    db.commit()
    db.refresh(row)
    return position_out(db, row)


@router.delete("/positions/{position_id}")
def delete_position(
    request: Request, position_id: ObjectId, user: Editor, db: DbDep
) -> list[PositionSummary]:
    """Löscht eine Stelle ohne Hardware; Verknüpfungen zu Arbeitsplätzen entfallen."""
    row = _position(db, position_id)
    devices = db.scalar(
        select(func.count())
        .select_from(InventoryHardware)
        .where(InventoryHardware.position_id == row.id)
    )
    if devices:
        raise _conflict("An dieser Stelle hängt noch Hardware.")
    details = _position_details(row)
    for workplace_id in db.scalars(
        select(InventoryWorkplacePosition.workplace_id).where(
            InventoryWorkplacePosition.position_id == row.id
        )
    ).all():
        add_staff_event(
            db,
            user,
            f"Stelle entfernt: {position_label(row)} (Stelle gelöscht)",
            workplace_id=workplace_id,
        )
    db.delete(row)
    _audit(db, request, user, "stelle_geloescht", "stelle", position_id, details)
    db.commit()
    return position_summaries(db)


# --- Arbeitsplätze ----------------------------------------------------------------------------


def _workplace_details(row: InventoryWorkplace, position_ids: list[int]) -> dict[str, object]:
    return {
        "nummer": row.number,
        "bezeichnung": row.name,
        "raum": row.room_id,
        "geteilt": row.shared,
        "vorlage": row.kit_id,
        "stellen": sorted(position_ids),
    }


def _check_workplace(
    db: Session, body: WorkplaceIn
) -> tuple[list[InventoryPosition], int | None, int | None]:
    position_ids = list(dict.fromkeys(body.position_ids))
    if not body.shared and len(position_ids) > 1:
        raise _invalid(
            "Ein Einzelarbeitsplatz gehört zu höchstens einer Stelle. Wähle „geteilt“ oder "
            "entferne die übrigen Stellen."
        )
    positions = (
        list(
            db.scalars(
                select(InventoryPosition).where(InventoryPosition.id.in_(position_ids))
            ).all()
        )
        if position_ids
        else []
    )
    if len(positions) != len(position_ids):
        raise _invalid("Unbekannte Stelle")
    room_id = body.room_id
    if room_id is not None and db.get(InventoryRoom, room_id) is None:
        raise _invalid("Unbekannter Raum")
    kit_id = body.kit_id
    if kit_id is not None and db.get(InventoryKit, kit_id) is None:
        raise _invalid("Unbekannte Vorlage")
    order = {position_id: index for index, position_id in enumerate(position_ids)}
    positions.sort(key=lambda entry: order[entry.id])
    return positions, room_id, kit_id


def _workplace_position_ids(db: Session, workplace_id: int) -> list[int]:
    return list(
        db.scalars(
            select(InventoryWorkplacePosition.position_id).where(
                InventoryWorkplacePosition.workplace_id == workplace_id
            )
        ).all()
    )


def _set_positions(
    db: Session, user: CurrentUser, row: InventoryWorkplace, positions: list[InventoryPosition]
) -> list[str]:
    """Setzt die Stellen; liefert Texte für den Verlauf und vermerkt es bei den Stellen."""
    before = set(_workplace_position_ids(db, row.id))
    after = {position.id for position in positions}
    texts: list[str] = []
    for position in positions:
        if position.id not in before:
            db.add(InventoryWorkplacePosition(workplace_id=row.id, position_id=position.id))
            texts.append(f"Stelle hinzugefügt: {position_label(position)}")
            add_staff_event(
                db,
                user,
                f"Arbeitsplatz verknüpft: {workplace_label(row)}",
                position_id=position.id,
            )
    removed = before - after
    if removed:
        db.execute(
            delete(InventoryWorkplacePosition).where(
                InventoryWorkplacePosition.workplace_id == row.id,
                InventoryWorkplacePosition.position_id.in_(removed),
            )
        )
        for position in db.scalars(
            select(InventoryPosition).where(InventoryPosition.id.in_(removed))
        ).all():
            texts.append(f"Stelle entfernt: {position_label(position)}")
            add_staff_event(
                db,
                user,
                f"Arbeitsplatz entfernt: {workplace_label(row)}",
                position_id=position.id,
            )
    return texts


@router.get("/workplaces")
def list_workplaces(user: Reader, db: DbDep) -> list[WorkplaceSummary]:
    return workplace_summaries(db)


@router.get("/assignees")
def read_assignees(user: Reader, db: DbDep) -> AssigneesOut:
    """Stellen und Arbeitsplätze in Kurzform für Auswahlfelder."""
    places = _places(db)
    return AssigneesOut(
        positions=[
            PositionBrief(
                id=row.id,
                number=row.number,
                name=row.name,
                person_name=row.person_name if row.person_oid else "",
            )
            for row in db.scalars(select(InventoryPosition).order_by(InventoryPosition.number))
        ],
        workplaces=[
            WorkplaceBrief(
                id=row.id,
                number=row.number,
                name=row.name,
                shared=row.shared,
                place=places.get(row.room_id) if row.room_id else None,
            )
            for row in db.scalars(select(InventoryWorkplace).order_by(InventoryWorkplace.number))
        ],
    )


@router.post("/workplaces", status_code=status.HTTP_201_CREATED)
def create_workplace(request: Request, body: WorkplaceIn, user: Editor, db: DbDep) -> WorkplaceOut:
    positions, room_id, kit_id = _check_workplace(db, body)
    row = InventoryWorkplace(
        number=next_number(db, "arbeitsplatz", InventoryWorkplace),
        name=body.name,
        room_id=room_id,
        shared=body.shared,
        kit_id=kit_id,
        note=body.note,
    )
    db.add(row)
    db.flush()
    add_staff_event(db, user, "Arbeitsplatz angelegt", workplace_id=row.id)
    if room_id is not None:
        add_staff_event(
            db, user, f"Standort: {place_label(room_place(db, room_id))}", workplace_id=row.id
        )
    for text in _set_positions(db, user, row, positions):
        add_staff_event(db, user, text, workplace_id=row.id)
    _audit(
        db,
        request,
        user,
        "arbeitsplatz_angelegt",
        "arbeitsplatz",
        row.id,
        _workplace_details(row, [position.id for position in positions]),
    )
    db.commit()
    db.refresh(row)
    return workplace_out(db, row)


@router.get("/workplaces/{workplace_id}")
def read_workplace(workplace_id: ObjectId, user: Reader, db: DbDep) -> WorkplaceOut:
    return workplace_out(db, _workplace(db, workplace_id))


@router.put("/workplaces/{workplace_id}")
def update_workplace(
    request: Request, workplace_id: ObjectId, body: WorkplaceIn, user: Editor, db: DbDep
) -> WorkplaceOut:
    row = _workplace(db, workplace_id)
    positions, room_id, kit_id = _check_workplace(db, body)
    before = _workplace_details(row, _workplace_position_ids(db, row.id))
    changes: list[str] = []
    if row.name != body.name:
        changes.append(f"Bezeichnung: {row.name or 'leer'} → {body.name or 'leer'}")
    if row.shared != body.shared:
        changes.append("Typ: " + ("geteilt" if body.shared else "einzeln"))
    if row.room_id != room_id:
        changes.append(
            f"Standort: {place_label(room_place(db, row.room_id))} → "
            f"{place_label(room_place(db, room_id))}"
        )
    if row.kit_id != kit_id:
        old = db.get(InventoryKit, row.kit_id) if row.kit_id else None
        new = db.get(InventoryKit, kit_id) if kit_id else None
        changes.append(
            f"Ausstattung: {old.name if old else 'keine Vorlage'} → "
            f"{new.name if new else 'keine Vorlage'}"
        )
    if row.note != body.note:
        changes.append("Notiz geändert")
    row.name = body.name
    row.shared = body.shared
    row.room_id = room_id
    row.kit_id = kit_id
    row.note = body.note
    changes.extend(_set_positions(db, user, row, positions))
    if changes:
        add_staff_event(db, user, "Geändert: " + "; ".join(changes), workplace_id=row.id)
        _audit(
            db,
            request,
            user,
            "arbeitsplatz_geaendert",
            "arbeitsplatz",
            row.id,
            {
                "vorher": before,
                "nachher": _workplace_details(row, [position.id for position in positions]),
            },
        )
    db.commit()
    db.refresh(row)
    return workplace_out(db, row)


@router.delete("/workplaces/{workplace_id}")
def delete_workplace(
    request: Request, workplace_id: ObjectId, user: Editor, db: DbDep
) -> list[WorkplaceSummary]:
    row = _workplace(db, workplace_id)
    devices = db.scalar(
        select(func.count())
        .select_from(InventoryHardware)
        .where(InventoryHardware.workplace_id == row.id)
    )
    if devices:
        raise _conflict("An diesem Arbeitsplatz hängt noch Hardware.")
    details = _workplace_details(row, _workplace_position_ids(db, row.id))
    for position_id in _workplace_position_ids(db, row.id):
        add_staff_event(
            db,
            user,
            f"Arbeitsplatz entfernt: {workplace_label(row)} (Arbeitsplatz gelöscht)",
            position_id=position_id,
        )
    db.delete(row)
    _audit(db, request, user, "arbeitsplatz_geloescht", "arbeitsplatz", workplace_id, details)
    db.commit()
    return workplace_summaries(db)
