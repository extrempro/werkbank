"""API des Bereichs IT-Bestand: Hardware, Inventurnummer, Ausmustern und Stammdaten."""

from datetime import date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, require_roles
from werkbank.core.models import User
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.inventory.models import (
    InventoryEvent,
    InventoryHardware,
    InventoryKind,
    InventoryMaker,
    InventoryModel,
    InventoryRetireReason,
)

router = APIRouter(prefix="/api/inventory")

MODULE = "bestand"
STATUS_ACTIVE = "aktiv"
STATUS_RETIRED = "ausgemustert"
SOURCE_MANUAL = "manuell"
# Verbleib beim Ausmustern und wie er im Verlauf heißt
WHEREABOUTS: dict[str, str] = {
    "entsorgt": "entsorgt",
    "abgegeben": "verkauft oder abgegeben",
    "leasing": "an Leasing zurück",
    "hersteller": "beim Hersteller",
}
# Obergrenze der Liste und des Verlaufs je Abruf
LIST_MAX = 5000
EVENTS_MAX = 500

Reader = Annotated[
    CurrentUser, Depends(require_roles(Role.INVENTORY_READER, Role.INVENTORY_EDITOR))
]
Editor = Annotated[CurrentUser, Depends(require_roles(Role.INVENTORY_EDITOR))]
ObjectId = Annotated[int, Path(ge=1)]


def client_ip(request: Request) -> str | None:
    return request.client.host if request.client else None


def single_line(value: str) -> str:
    """Ohne Zeilenumbrüche und Steuerzeichen, außen ohne Leerzeichen."""
    value = value.strip()
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError("Keine Zeilenumbrüche oder Steuerzeichen")
    return value


def _not_empty(value: str) -> str:
    if not value:
        raise ValueError("Darf nicht leer sein")
    return value


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


# --- Schemas ------------------------------------------------------------------------------


class NameIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def plain(cls, value: str) -> str:
        return _not_empty(single_line(value))


class KindIn(NameIn):
    has_storage: bool = False


class ModelIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def plain(cls, value: str) -> str:
        return _not_empty(single_line(value))


class KindOut(BaseModel):
    id: int
    name: str
    has_storage: bool
    used: int


class ModelOut(BaseModel):
    id: int
    name: str
    used: int


class MakerOut(BaseModel):
    id: int
    name: str
    models: list[ModelOut]


class ReasonOut(BaseModel):
    id: int
    name: str
    used: int


class MasterDataOut(BaseModel):
    kinds: list[KindOut]
    makers: list[MakerOut]
    reasons: list[ReasonOut]


class HardwareIn(BaseModel):
    kind_id: int = Field(ge=1)
    model_id: int | None = Field(default=None, ge=1)
    name: str = Field(min_length=1, max_length=160)
    serial: str = Field(default="", max_length=80)
    hostname: str = Field(default="", max_length=80)
    note: str = Field(default="", max_length=500)

    @field_validator("name", "serial", "hostname", "note")
    @classmethod
    def plain(cls, value: str) -> str:
        return single_line(value)

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, value: str) -> str:
        return _not_empty(value)


class HardwareCreate(HardwareIn):
    inventory_no: str | None = Field(default=None, max_length=40)

    @field_validator("inventory_no")
    @classmethod
    def clean_inventory_no(cls, value: str | None) -> str | None:
        return _inventory_no(value)


class InventoryNoIn(BaseModel):
    inventory_no: str | None = Field(default=None, max_length=40)

    @field_validator("inventory_no")
    @classmethod
    def clean_inventory_no(cls, value: str | None) -> str | None:
        return _inventory_no(value)


def _inventory_no(value: str | None) -> str | None:
    """Leere Eingabe bedeutet: keine Inventurnummer."""
    if value is None:
        return None
    value = single_line(value)
    return value or None


class RetireIn(BaseModel):
    reason_id: int = Field(ge=1)
    whereabouts: Literal["entsorgt", "abgegeben", "leasing", "hersteller"]
    retired_on: date
    wiped: bool = False
    note: str = Field(default="", max_length=300)

    @field_validator("note")
    @classmethod
    def plain(cls, value: str) -> str:
        return single_line(value)


class HardwareSummary(BaseModel):
    id: int
    name: str
    kind_id: int
    kind: str
    maker: str | None
    model: str | None
    serial: str
    inventory_no: str | None
    hostname: str
    source: str
    status: str


class RetireOut(BaseModel):
    retired_on: date
    reason: str
    whereabouts: str
    wiped: bool | None
    note: str


class EventOut(BaseModel):
    occurred_at: datetime
    who: str
    text: str


class HardwareOut(HardwareSummary):
    model_id: int | None
    maker_id: int | None
    note: str
    has_storage: bool
    created_at: datetime
    retire: RetireOut | None
    events: list[EventOut]


# --- Hilfsfunktionen ------------------------------------------------------------------------


def _audit(
    db: Session,
    request: Request,
    user: CurrentUser,
    action: str,
    object_type: str,
    object_id: int,
    details: dict[str, object] | None = None,
) -> None:
    write_audit(
        db,
        module=MODULE,
        action=f"bestand.{action}",
        user_id=user.user_id,
        object_type=object_type,
        object_id=str(object_id),
        ip=client_ip(request),
        details=details,
    )


def add_event(db: Session, hardware_id: int, user: CurrentUser | None, text: str) -> None:
    """Neuer Eintrag im Verlauf eines Geräts."""
    db.add(
        InventoryEvent(
            hardware_id=hardware_id,
            user_id=user.user_id if user else None,
            occurred_at=now_utc(),
            text=text[:400],
        )
    )


def _hardware(db: Session, hardware_id: int) -> InventoryHardware:
    row = db.get(InventoryHardware, hardware_id)
    if row is None:
        raise _not_found()
    return row


def _kind(db: Session, kind_id: int) -> InventoryKind:
    row = db.get(InventoryKind, kind_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unbekannte Hardware-Art"
        )
    return row


def _model(db: Session, model_id: int | None) -> InventoryModel | None:
    if model_id is None:
        return None
    row = db.get(InventoryModel, model_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unbekanntes Modell"
        )
    return row


def _check_serial(db: Session, serial: str, own_id: int | None) -> None:
    """Eine Seriennummer gehört zu höchstens einem Gerät (ohne Groß- und Kleinschreibung)."""
    if not serial:
        return
    query = select(InventoryHardware).where(
        func.lower(InventoryHardware.serial) == serial.casefold()
    )
    if own_id is not None:
        query = query.where(InventoryHardware.id != own_id)
    other = db.scalars(query.limit(1)).first()
    if other is not None:
        raise _conflict(f"Diese Seriennummer ist schon bei „{other.name}“ eingetragen.")


def _check_inventory_no(db: Session, inventory_no: str | None, own_id: int | None) -> None:
    if inventory_no is None:
        return
    query = select(InventoryHardware).where(InventoryHardware.inventory_no == inventory_no)
    if own_id is not None:
        query = query.where(InventoryHardware.id != own_id)
    other = db.scalars(query.limit(1)).first()
    if other is not None:
        raise _conflict(f"Diese Inventurnummer ist schon bei „{other.name}“ eingetragen.")


def _names(db: Session) -> tuple[dict[int, str], dict[int, tuple[str, str]]]:
    """Namen der Arten und je Modell (Hersteller, Modell)."""
    kinds = {row.id: row.name for row in db.scalars(select(InventoryKind)).all()}
    models = {
        model_id: (maker, model)
        for model_id, model, maker in db.execute(
            select(InventoryModel.id, InventoryModel.name, InventoryMaker.name).join(
                InventoryMaker, InventoryMaker.id == InventoryModel.maker_id
            )
        ).all()
    }
    return kinds, models


def _summary(
    row: InventoryHardware, kinds: dict[int, str], models: dict[int, tuple[str, str]]
) -> HardwareSummary:
    maker, model = models.get(row.model_id, (None, None)) if row.model_id else (None, None)
    return HardwareSummary(
        id=row.id,
        name=row.name,
        kind_id=row.kind_id,
        kind=kinds.get(row.kind_id, ""),
        maker=maker,
        model=model,
        serial=row.serial,
        inventory_no=row.inventory_no,
        hostname=row.hostname,
        source=row.source,
        status=row.status,
    )


def hardware_out(db: Session, row: InventoryHardware) -> HardwareOut:
    kinds, models = _names(db)
    base = _summary(row, kinds, models)
    kind = db.get(InventoryKind, row.kind_id)
    model = db.get(InventoryModel, row.model_id) if row.model_id else None
    retire = None
    if row.status == STATUS_RETIRED and row.retired_on is not None:
        reason = (
            db.get(InventoryRetireReason, row.retire_reason_id) if row.retire_reason_id else None
        )
        retire = RetireOut(
            retired_on=row.retired_on,
            reason=reason.name if reason else "",
            whereabouts=row.retire_whereabouts or "",
            wiped=row.retire_wiped,
            note=row.retire_note,
        )
    events = db.execute(
        select(InventoryEvent.occurred_at, InventoryEvent.text, User.display_name)
        .outerjoin(User, User.id == InventoryEvent.user_id)
        .where(InventoryEvent.hardware_id == row.id)
        .order_by(InventoryEvent.occurred_at.desc(), InventoryEvent.id.desc())
        .limit(EVENTS_MAX)
    ).all()
    return HardwareOut(
        **base.model_dump(),
        model_id=row.model_id,
        maker_id=model.maker_id if model else None,
        note=row.note,
        has_storage=bool(kind and kind.has_storage),
        created_at=row.created_at,
        retire=retire,
        events=[
            EventOut(occurred_at=at, who=name or "Werkbank", text=text) for at, text, name in events
        ],
    )


def _details(row: InventoryHardware) -> dict[str, object]:
    """Was ins Audit-Log kommt: Kennungen des Geräts, keine Personen."""
    return {
        "name": row.name,
        "art": row.kind_id,
        "seriennummer": row.serial,
        "inventurnummer": row.inventory_no,
        "status": row.status,
    }


def _model_label(db: Session, model: InventoryModel | None) -> str:
    if model is None:
        return "kein Modell"
    maker = db.get(InventoryMaker, model.maker_id)
    return f"{maker.name if maker else ''} {model.name}".strip()


# --- Hardware --------------------------------------------------------------------------------


@router.get("/hardware")
def list_hardware(
    user: Reader,
    db: DbDep,
    state: Annotated[Literal["aktiv", "ausgemustert", "alle"], Query()] = "aktiv",
) -> list[HardwareSummary]:
    """Geräte nach Status. Suche und weitere Filter übernimmt die Oberfläche."""
    query = select(InventoryHardware)
    if state != "alle":
        query = query.where(InventoryHardware.status == state)
    rows = db.scalars(
        query.order_by(func.lower(InventoryHardware.name), InventoryHardware.id).limit(LIST_MAX)
    ).all()
    kinds, models = _names(db)
    return [_summary(row, kinds, models) for row in rows]


@router.post("/hardware", status_code=status.HTTP_201_CREATED)
def create_hardware(request: Request, body: HardwareCreate, user: Editor, db: DbDep) -> HardwareOut:
    kind = _kind(db, body.kind_id)
    model = _model(db, body.model_id)
    _check_serial(db, body.serial, None)
    _check_inventory_no(db, body.inventory_no, None)
    row = InventoryHardware(
        kind_id=kind.id,
        model_id=model.id if model else None,
        name=body.name,
        serial=body.serial,
        hostname=body.hostname,
        note=body.note,
        inventory_no=body.inventory_no,
        source=SOURCE_MANUAL,
        status=STATUS_ACTIVE,
    )
    db.add(row)
    db.flush()
    add_event(db, row.id, user, "Von Hand erfasst")
    if body.inventory_no:
        add_event(db, row.id, user, f"Inventurnummer gesetzt: {body.inventory_no}")
    _audit(db, request, user, "geraet_angelegt", "geraet", row.id, _details(row))
    db.commit()
    db.refresh(row)
    return hardware_out(db, row)


@router.get("/hardware/{hardware_id}")
def read_hardware(hardware_id: ObjectId, user: Reader, db: DbDep) -> HardwareOut:
    return hardware_out(db, _hardware(db, hardware_id))


@router.put("/hardware/{hardware_id}")
def update_hardware(
    request: Request, hardware_id: ObjectId, body: HardwareIn, user: Editor, db: DbDep
) -> HardwareOut:
    row = _hardware(db, hardware_id)
    kind = _kind(db, body.kind_id)
    model = _model(db, body.model_id)
    _check_serial(db, body.serial, row.id)
    before = _details(row)
    changes: list[str] = []
    if row.name != body.name:
        changes.append(f"Bezeichnung: {row.name} → {body.name}")
    if row.kind_id != kind.id:
        old = db.get(InventoryKind, row.kind_id)
        changes.append(f"Art: {old.name if old else ''} → {kind.name}")
    if row.model_id != (model.id if model else None):
        old_model = db.get(InventoryModel, row.model_id) if row.model_id else None
        changes.append(f"Modell: {_model_label(db, old_model)} → {_model_label(db, model)}")
    if row.serial != body.serial:
        changes.append(f"Seriennummer: {row.serial or 'leer'} → {body.serial or 'leer'}")
    if row.hostname != body.hostname:
        changes.append(f"Hostname: {row.hostname or 'leer'} → {body.hostname or 'leer'}")
    if row.note != body.note:
        changes.append("Notiz geändert")
    row.kind_id = kind.id
    row.model_id = model.id if model else None
    row.name = body.name
    row.serial = body.serial
    row.hostname = body.hostname
    row.note = body.note
    if changes:
        add_event(db, row.id, user, "Geändert: " + "; ".join(changes))
        _audit(
            db,
            request,
            user,
            "geraet_geaendert",
            "geraet",
            row.id,
            {"vorher": before, "nachher": _details(row)},
        )
    db.commit()
    db.refresh(row)
    return hardware_out(db, row)


@router.put("/hardware/{hardware_id}/inventory-no")
def set_inventory_no(
    request: Request, hardware_id: ObjectId, body: InventoryNoIn, user: Editor, db: DbDep
) -> HardwareOut:
    """Setzt, ändert oder entfernt die Inventurnummer. Die Oberfläche fragt vorher nach."""
    row = _hardware(db, hardware_id)
    if row.inventory_no == body.inventory_no:
        return hardware_out(db, row)
    _check_inventory_no(db, body.inventory_no, row.id)
    before = row.inventory_no
    row.inventory_no = body.inventory_no
    if body.inventory_no is None:
        text = f"Inventurnummer entfernt (vorher {before})"
    elif before is None:
        text = f"Inventurnummer gesetzt: {body.inventory_no}"
    else:
        text = f"Inventurnummer geändert: {before} → {body.inventory_no}"
    add_event(db, row.id, user, text)
    _audit(
        db,
        request,
        user,
        "inventurnummer",
        "geraet",
        row.id,
        {"vorher": before, "nachher": body.inventory_no},
    )
    db.commit()
    db.refresh(row)
    return hardware_out(db, row)


@router.post("/hardware/{hardware_id}/retire")
def retire_hardware(
    request: Request, hardware_id: ObjectId, body: RetireIn, user: Editor, db: DbDep
) -> HardwareOut:
    """Mustert ein Gerät aus. Es bleibt mit Verlauf erhalten."""
    row = _hardware(db, hardware_id)
    if row.status == STATUS_RETIRED:
        raise _conflict("Das Gerät ist schon ausgemustert.")
    reason = db.get(InventoryRetireReason, body.reason_id)
    if reason is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Unbekannter Grund"
        )
    # Ein Tag Spielraum: Kurz nach Mitternacht ist es in Deutschland schon der nächste Tag.
    if body.retired_on > now_utc().date() + timedelta(days=1):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Das Datum darf nicht in der Zukunft liegen.",
        )
    kind = db.get(InventoryKind, row.kind_id)
    has_storage = bool(kind and kind.has_storage)
    if has_storage and not body.wiped:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Bitte bestätige, dass der Datenträger gelöscht oder vernichtet ist.",
        )
    row.status = STATUS_RETIRED
    row.retired_on = body.retired_on
    row.retire_reason_id = reason.id
    row.retire_whereabouts = body.whereabouts
    row.retire_wiped = body.wiped if has_storage else None
    row.retire_note = body.note
    text = (
        f"Ausgemustert am {body.retired_on:%d.%m.%Y}: "
        f"{reason.name}, {WHEREABOUTS[body.whereabouts]}"
    )
    if has_storage:
        text += ", Datenträger gelöscht oder vernichtet"
    if body.note:
        text += f". Notiz: {body.note}"
    add_event(db, row.id, user, text)
    _audit(
        db,
        request,
        user,
        "ausgemustert",
        "geraet",
        row.id,
        {
            **_details(row),
            "grund": reason.name,
            "verbleib": body.whereabouts,
            "datum": body.retired_on.isoformat(),
            "datentraeger_geloescht": row.retire_wiped,
        },
    )
    db.commit()
    db.refresh(row)
    return hardware_out(db, row)


@router.post("/hardware/{hardware_id}/reactivate")
def reactivate_hardware(
    request: Request, hardware_id: ObjectId, user: Editor, db: DbDep
) -> HardwareOut:
    """Nimmt ein ausgemustertes Gerät wieder in Betrieb, z. B. nach einem Versehen."""
    row = _hardware(db, hardware_id)
    if row.status != STATUS_RETIRED:
        raise _conflict("Das Gerät ist nicht ausgemustert.")
    row.status = STATUS_ACTIVE
    row.retired_on = None
    row.retire_reason_id = None
    row.retire_whereabouts = None
    row.retire_wiped = None
    row.retire_note = ""
    add_event(db, row.id, user, "Wieder in Betrieb genommen")
    _audit(db, request, user, "wieder_in_betrieb", "geraet", row.id, _details(row))
    db.commit()
    db.refresh(row)
    return hardware_out(db, row)


# --- Stammdaten ------------------------------------------------------------------------------


def master_data(db: Session) -> MasterDataOut:
    kind_use = dict(
        db.execute(
            select(InventoryHardware.kind_id, func.count()).group_by(InventoryHardware.kind_id)
        ).all()
    )
    model_use = dict(
        db.execute(
            select(InventoryHardware.model_id, func.count())
            .where(InventoryHardware.model_id.is_not(None))
            .group_by(InventoryHardware.model_id)
        ).all()
    )
    reason_use = dict(
        db.execute(
            select(InventoryHardware.retire_reason_id, func.count())
            .where(InventoryHardware.retire_reason_id.is_not(None))
            .group_by(InventoryHardware.retire_reason_id)
        ).all()
    )
    models_by_maker: dict[int, list[ModelOut]] = {}
    for model in db.scalars(
        select(InventoryModel).order_by(func.lower(InventoryModel.name), InventoryModel.id)
    ).all():
        models_by_maker.setdefault(model.maker_id, []).append(
            ModelOut(id=model.id, name=model.name, used=model_use.get(model.id, 0))
        )
    return MasterDataOut(
        kinds=[
            KindOut(
                id=row.id, name=row.name, has_storage=row.has_storage, used=kind_use.get(row.id, 0)
            )
            for row in db.scalars(
                select(InventoryKind).order_by(func.lower(InventoryKind.name), InventoryKind.id)
            ).all()
        ],
        makers=[
            MakerOut(id=row.id, name=row.name, models=models_by_maker.get(row.id, []))
            for row in db.scalars(
                select(InventoryMaker).order_by(func.lower(InventoryMaker.name), InventoryMaker.id)
            ).all()
        ],
        reasons=[
            ReasonOut(id=row.id, name=row.name, used=reason_use.get(row.id, 0))
            for row in db.scalars(
                select(InventoryRetireReason).order_by(
                    func.lower(InventoryRetireReason.name), InventoryRetireReason.id
                )
            ).all()
        ],
    )


NamedTable = type[InventoryKind] | type[InventoryMaker] | type[InventoryRetireReason]


def _name_free(db: Session, model: NamedTable, name: str, own_id: int | None) -> None:
    query = select(model).where(func.lower(model.name) == name.casefold())
    if own_id is not None:
        query = query.where(model.id != own_id)
    if db.scalars(query.limit(1)).first() is not None:
        raise _conflict("Diesen Namen gibt es schon.")


@router.get("/master-data")
def read_master_data(user: Reader, db: DbDep) -> MasterDataOut:
    return master_data(db)


@router.post("/kinds", status_code=status.HTTP_201_CREATED)
def create_kind(request: Request, body: KindIn, user: Editor, db: DbDep) -> MasterDataOut:
    _name_free(db, InventoryKind, body.name, None)
    row = InventoryKind(name=body.name, has_storage=body.has_storage)
    db.add(row)
    db.flush()
    _audit(db, request, user, "art_angelegt", "art", row.id, {"name": row.name})
    db.commit()
    return master_data(db)


@router.put("/kinds/{kind_id}")
def update_kind(
    request: Request, kind_id: ObjectId, body: KindIn, user: Editor, db: DbDep
) -> MasterDataOut:
    row = db.get(InventoryKind, kind_id)
    if row is None:
        raise _not_found()
    _name_free(db, InventoryKind, body.name, row.id)
    before = {"name": row.name, "datentraeger": row.has_storage}
    row.name = body.name
    row.has_storage = body.has_storage
    _audit(
        db,
        request,
        user,
        "art_geaendert",
        "art",
        row.id,
        {"vorher": before, "nachher": {"name": row.name, "datentraeger": row.has_storage}},
    )
    db.commit()
    return master_data(db)


@router.delete("/kinds/{kind_id}")
def delete_kind(request: Request, kind_id: ObjectId, user: Editor, db: DbDep) -> MasterDataOut:
    row = db.get(InventoryKind, kind_id)
    if row is None:
        raise _not_found()
    used = db.scalar(
        select(func.count())
        .select_from(InventoryHardware)
        .where(InventoryHardware.kind_id == row.id)
    )
    if used:
        raise _conflict("Diese Art wird noch von Geräten verwendet.")
    name = row.name
    db.delete(row)
    _audit(db, request, user, "art_geloescht", "art", kind_id, {"name": name})
    db.commit()
    return master_data(db)


@router.post("/makers", status_code=status.HTTP_201_CREATED)
def create_maker(request: Request, body: NameIn, user: Editor, db: DbDep) -> MasterDataOut:
    _name_free(db, InventoryMaker, body.name, None)
    row = InventoryMaker(name=body.name)
    db.add(row)
    db.flush()
    _audit(db, request, user, "hersteller_angelegt", "hersteller", row.id, {"name": row.name})
    db.commit()
    return master_data(db)


@router.put("/makers/{maker_id}")
def update_maker(
    request: Request, maker_id: ObjectId, body: NameIn, user: Editor, db: DbDep
) -> MasterDataOut:
    row = db.get(InventoryMaker, maker_id)
    if row is None:
        raise _not_found()
    _name_free(db, InventoryMaker, body.name, row.id)
    before = row.name
    row.name = body.name
    _audit(
        db,
        request,
        user,
        "hersteller_geaendert",
        "hersteller",
        row.id,
        {"vorher": before, "nachher": row.name},
    )
    db.commit()
    return master_data(db)


@router.delete("/makers/{maker_id}")
def delete_maker(request: Request, maker_id: ObjectId, user: Editor, db: DbDep) -> MasterDataOut:
    """Löscht den Hersteller samt Modellen, solange kein Gerät eines seiner Modelle nutzt."""
    row = db.get(InventoryMaker, maker_id)
    if row is None:
        raise _not_found()
    used = db.scalar(
        select(func.count())
        .select_from(InventoryHardware)
        .join(InventoryModel, InventoryModel.id == InventoryHardware.model_id)
        .where(InventoryModel.maker_id == row.id)
    )
    if used:
        raise _conflict("Modelle dieses Herstellers werden noch von Geräten verwendet.")
    name = row.name
    for model in db.scalars(select(InventoryModel).where(InventoryModel.maker_id == row.id)).all():
        db.delete(model)
    db.delete(row)
    _audit(db, request, user, "hersteller_geloescht", "hersteller", maker_id, {"name": name})
    db.commit()
    return master_data(db)


@router.post("/makers/{maker_id}/models", status_code=status.HTTP_201_CREATED)
def create_model(
    request: Request, maker_id: ObjectId, body: ModelIn, user: Editor, db: DbDep
) -> MasterDataOut:
    maker = db.get(InventoryMaker, maker_id)
    if maker is None:
        raise _not_found()
    _model_name_free(db, maker.id, body.name, None)
    row = InventoryModel(maker_id=maker.id, name=body.name)
    db.add(row)
    db.flush()
    _audit(
        db,
        request,
        user,
        "modell_angelegt",
        "modell",
        row.id,
        {"hersteller": maker.name, "name": row.name},
    )
    db.commit()
    return master_data(db)


def _model_name_free(db: Session, maker_id: int, name: str, own_id: int | None) -> None:
    query = select(InventoryModel).where(
        InventoryModel.maker_id == maker_id, func.lower(InventoryModel.name) == name.casefold()
    )
    if own_id is not None:
        query = query.where(InventoryModel.id != own_id)
    if db.scalars(query.limit(1)).first() is not None:
        raise _conflict("Dieses Modell gibt es bei diesem Hersteller schon.")


@router.put("/models/{model_id}")
def update_model(
    request: Request, model_id: ObjectId, body: ModelIn, user: Editor, db: DbDep
) -> MasterDataOut:
    row = db.get(InventoryModel, model_id)
    if row is None:
        raise _not_found()
    _model_name_free(db, row.maker_id, body.name, row.id)
    before = row.name
    row.name = body.name
    _audit(
        db,
        request,
        user,
        "modell_geaendert",
        "modell",
        row.id,
        {"vorher": before, "nachher": row.name},
    )
    db.commit()
    return master_data(db)


@router.delete("/models/{model_id}")
def delete_model(request: Request, model_id: ObjectId, user: Editor, db: DbDep) -> MasterDataOut:
    row = db.get(InventoryModel, model_id)
    if row is None:
        raise _not_found()
    used = db.scalar(
        select(func.count())
        .select_from(InventoryHardware)
        .where(InventoryHardware.model_id == row.id)
    )
    if used:
        raise _conflict("Dieses Modell wird noch von Geräten verwendet.")
    name = row.name
    db.delete(row)
    _audit(db, request, user, "modell_geloescht", "modell", model_id, {"name": name})
    db.commit()
    return master_data(db)


@router.post("/reasons", status_code=status.HTTP_201_CREATED)
def create_reason(request: Request, body: NameIn, user: Editor, db: DbDep) -> MasterDataOut:
    _name_free(db, InventoryRetireReason, body.name, None)
    row = InventoryRetireReason(name=body.name)
    db.add(row)
    db.flush()
    _audit(db, request, user, "grund_angelegt", "grund", row.id, {"name": row.name})
    db.commit()
    return master_data(db)


@router.put("/reasons/{reason_id}")
def update_reason(
    request: Request, reason_id: ObjectId, body: NameIn, user: Editor, db: DbDep
) -> MasterDataOut:
    row = db.get(InventoryRetireReason, reason_id)
    if row is None:
        raise _not_found()
    _name_free(db, InventoryRetireReason, body.name, row.id)
    before = row.name
    row.name = body.name
    _audit(
        db,
        request,
        user,
        "grund_geaendert",
        "grund",
        row.id,
        {"vorher": before, "nachher": row.name},
    )
    db.commit()
    return master_data(db)


@router.delete("/reasons/{reason_id}")
def delete_reason(request: Request, reason_id: ObjectId, user: Editor, db: DbDep) -> MasterDataOut:
    row = db.get(InventoryRetireReason, reason_id)
    if row is None:
        raise _not_found()
    used = db.scalar(
        select(func.count())
        .select_from(InventoryHardware)
        .where(InventoryHardware.retire_reason_id == row.id)
    )
    if used:
        raise _conflict("Dieser Grund ist bei ausgemusterten Geräten eingetragen.")
    name = row.name
    db.delete(row)
    _audit(db, request, user, "grund_geloescht", "grund", reason_id, {"name": name})
    db.commit()
    return master_data(db)
