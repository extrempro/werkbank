"""Wo sich eine Stelle, ein Arbeitsplatz oder ein Gerät befindet: Räume und Plätze je Etage.

Grundlage für die Ortszeile und den Grundriss auf den Detailseiten.
- Arbeitsplatz: sein Raum und sein Platz.
- Stelle: die Räume und Plätze ihrer Arbeitsplätze.
- Gerät: sein eigener Raum; sonst der Raum des Arbeitsplatzes, dem es zugeordnet ist; sonst die
  Räume der Arbeitsplätze seiner Stelle. ``via`` sagt, woher der Ort kommt.
"""

from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.core.deps import DbDep
from werkbank.modules.inventory.api import (
    LocationOut,
    ObjectId,
    Reader,
    position_label,
    workplace_label,
)
from werkbank.modules.inventory.models import (
    InventoryHardware,
    InventoryPosition,
    InventoryWorkplace,
    InventoryWorkplacePosition,
)
from werkbank.modules.inventory.places import room_place

router = APIRouter(prefix="/api/inventory")

Kind = Literal["stelle", "arbeitsplatz", "geraet"]


class Via(BaseModel):
    kind: Kind
    id: int
    label: str


class FloorPlaces(BaseModel):
    floor_id: int
    # die Räume auf dieser Etage, in der Reihenfolge der Arbeitsplätze
    rooms: list[LocationOut]
    workplace_ids: list[int]


class WhereaboutsOut(BaseModel):
    via: Via | None
    floors: list[FloorPlaces]


def _places(db: Session, entries: list[tuple[int | None, int | None]]) -> list[FloorPlaces]:
    """(Raum, Arbeitsplatz) → je Etage die Räume und Arbeitsplätze, ohne Doppelte."""
    floors: dict[int, FloorPlaces] = {}
    for room_id, workplace_id in entries:
        place = room_place(db, room_id)
        if place is None:
            continue
        entry = floors.setdefault(
            place.floor_id, FloorPlaces(floor_id=place.floor_id, rooms=[], workplace_ids=[])
        )
        if all(room.room_id != place.room_id for room in entry.rooms):
            entry.rooms.append(LocationOut(**vars(place)))
        if workplace_id is not None and workplace_id not in entry.workplace_ids:
            entry.workplace_ids.append(workplace_id)
    return list(floors.values())


def _position_entries(db: Session, position_id: int) -> list[tuple[int | None, int | None]]:
    rows = db.scalars(
        select(InventoryWorkplace)
        .join(
            InventoryWorkplacePosition,
            InventoryWorkplacePosition.workplace_id == InventoryWorkplace.id,
        )
        .where(InventoryWorkplacePosition.position_id == position_id)
        .order_by(InventoryWorkplace.number)
    ).all()
    return [(row.room_id, row.id) for row in rows]


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")


@router.get("/whereabouts/{kind}/{object_id}")
def whereabouts(kind: Kind, object_id: ObjectId, user: Reader, db: DbDep) -> WhereaboutsOut:
    if kind == "arbeitsplatz":
        workplace = db.get(InventoryWorkplace, object_id)
        if workplace is None:
            raise _not_found()
        return WhereaboutsOut(via=None, floors=_places(db, [(workplace.room_id, workplace.id)]))
    if kind == "stelle":
        if db.get(InventoryPosition, object_id) is None:
            raise _not_found()
        return WhereaboutsOut(via=None, floors=_places(db, _position_entries(db, object_id)))

    device = db.get(InventoryHardware, object_id)
    if device is None:
        raise _not_found()
    holder = db.get(InventoryWorkplace, device.workplace_id) if device.workplace_id else None
    if device.room_id is not None:
        # Eigener Raum; der Platz des Arbeitsplatzes nur, wenn er im selben Raum liegt
        spot = holder.id if holder is not None and holder.room_id == device.room_id else None
        return WhereaboutsOut(via=None, floors=_places(db, [(device.room_id, spot)]))
    if holder is not None:
        return WhereaboutsOut(
            via=Via(kind="arbeitsplatz", id=holder.id, label=workplace_label(holder)),
            floors=_places(db, [(holder.room_id, holder.id)]),
        )
    position = db.get(InventoryPosition, device.position_id) if device.position_id else None
    if position is not None:
        return WhereaboutsOut(
            via=Via(kind="stelle", id=position.id, label=position_label(position)),
            floors=_places(db, _position_entries(db, position.id)),
        )
    return WhereaboutsOut(via=None, floors=[])
