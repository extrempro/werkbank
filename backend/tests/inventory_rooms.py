"""Hilfe für Tests: ein Raum, damit sich Arbeitsplätze anlegen lassen (Raum ist Pflicht)."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.modules.inventory.models import (
    InventoryCity,
    InventoryFloor,
    InventoryRoom,
    InventorySection,
    InventorySite,
)

CITY = "Teststadt Räume"


def room_for_tests(db: Session, name: str = "T.01") -> int:
    """Legt bei Bedarf Stadt, Standort, Abschnitt, Etage und Raum an und gibt die Raum-ID."""
    city = db.scalar(select(InventoryCity).where(InventoryCity.name == CITY))
    if city is None:
        city = InventoryCity(name=CITY)
        db.add(city)
        db.flush()
        site = InventorySite(city_id=city.id, name="Testhaus")
        db.add(site)
        db.flush()
        section = InventorySection(site_id=site.id, name="Bauteil T")
        db.add(section)
        db.flush()
        db.add(InventoryFloor(section_id=section.id, name="EG", position=0))
        db.flush()
    floor = db.scalar(
        select(InventoryFloor)
        .join(InventorySection, InventorySection.id == InventoryFloor.section_id)
        .join(InventorySite, InventorySite.id == InventorySection.site_id)
        .where(InventorySite.city_id == city.id)
    )
    assert floor is not None
    room = db.scalar(
        select(InventoryRoom).where(InventoryRoom.floor_id == floor.id, InventoryRoom.name == name)
    )
    if room is None:
        room = InventoryRoom(floor_id=floor.id, name=name, x=1, y=1, w=10, h=10)
        db.add(room)
    db.commit()
    return room.id
