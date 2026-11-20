"""Wo ein Raum liegt (Stadt, Standort, Abschnitt, Etage), etwa für die Anzeige am Gerät."""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.modules.inventory.models import (
    InventoryCity,
    InventoryFloor,
    InventoryRoom,
    InventorySection,
    InventorySite,
)


@dataclass(frozen=True)
class RoomPlace:
    """Wo ein Raum liegt, zum Anzeigen am Gerät."""

    room_id: int
    room: str
    floor_id: int
    floor: str
    section: str
    site: str
    city: str


def room_place(db: Session, room_id: int | None) -> RoomPlace | None:
    if room_id is None:
        return None
    row = db.execute(
        select(
            InventoryRoom.id,
            InventoryRoom.name,
            InventoryFloor.id,
            InventoryFloor.name,
            InventorySection.name,
            InventorySite.name,
            InventoryCity.name,
        )
        .join(InventoryFloor, InventoryFloor.id == InventoryRoom.floor_id)
        .join(InventorySection, InventorySection.id == InventoryFloor.section_id)
        .join(InventorySite, InventorySite.id == InventorySection.site_id)
        .join(InventoryCity, InventoryCity.id == InventorySite.city_id)
        .where(InventoryRoom.id == room_id)
    ).first()
    if row is None:
        return None
    return RoomPlace(*row)
