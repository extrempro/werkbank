"""Suche für Auswahlfelder im IT-Bestand: Stellen, Arbeitsplätze, Räume und Geräte.

Statt alle Einträge auf einmal zu laden, fragt die Oberfläche hier nach einem Suchbegriff und
bekommt höchstens 20 Treffer (zum Beispiel beim Zuordnen eines Geräts in einem Vorgang).
"""

from collections.abc import Iterable
from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import select

from werkbank.core.deps import DbDep
from werkbank.modules.inventory.api import STATUS_RETIRED, Reader
from werkbank.modules.inventory.models import (
    InventoryCity,
    InventoryDepartment,
    InventoryFloor,
    InventoryHardware,
    InventoryKind,
    InventoryPosition,
    InventoryRoom,
    InventorySection,
    InventorySite,
    InventoryWorkplace,
    InventoryWorkplacePosition,
)

router = APIRouter(prefix="/api/inventory")

LOOKUP_MAX = 20
# Arten, die als „vorhandener Rechner“ gelten (Vorgang „Gleiches Gerät“)
COMPUTER_KINDS = ("Notebook", "PC")

LookupKind = Literal["position", "workplace", "room", "hardware"]


class LookupItem(BaseModel):
    id: int
    label: str
    detail: str
    # nur bei Räumen: Etage, damit die Oberfläche den Grundriss zeigen kann
    floor_id: int | None = None


class LookupOut(BaseModel):
    items: list[LookupItem]
    total: int


def fold(text: str) -> str:
    """Klein, Umlaute ausgeschrieben: „ae“ findet „ä“."""
    return (
        text.casefold().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    )


def matches(words: list[str], *fields: str) -> bool:
    """Jedes Wort muss in einem der Felder vorkommen."""
    haystack = fold(" ".join(fields))
    return all(word in haystack for word in words)


def _pick(
    words: list[str], rows: Iterable[tuple[LookupItem, tuple[str, ...]]], limit: int
) -> LookupOut:
    found = [item for item, fields in rows if matches(words, *fields)]
    return LookupOut(items=found[:limit], total=len(found))


def _room_paths(db: DbDep) -> dict[int, tuple[str, str, int]]:
    """Raumname und Pfad (Stadt / Standort / Abschnitt / Etage) je Raum."""
    rows = db.execute(
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
        .order_by(InventoryCity.name, InventorySite.name, InventoryFloor.name, InventoryRoom.name)
    ).all()
    return {
        room_id: (room, f"{city} / {site} / {section} / {floor}", floor_id)
        for room_id, room, floor_id, floor, section, site, city in rows
    }


@router.get("/lookup")
def lookup(
    user: Reader,
    db: DbDep,
    kind: LookupKind,
    q: Annotated[str, Query(max_length=100)] = "",
    computers: bool = False,
    limit: Annotated[int, Query(ge=1, le=LOOKUP_MAX)] = LOOKUP_MAX,
) -> LookupOut:
    """Treffer für ein Auswahlfeld; ohne Suchbegriff die ersten Einträge."""
    words = fold(q).split()
    if kind == "position":
        departments = dict(
            db.execute(select(InventoryDepartment.id, InventoryDepartment.name)).all()
        )
        positions = db.scalars(select(InventoryPosition).order_by(InventoryPosition.number)).all()
        return _pick(
            words,
            (
                (
                    LookupItem(
                        id=row.id,
                        label=f"{row.number} {row.name}",
                        detail=" · ".join(
                            part
                            for part in (
                                row.person_name if row.person_oid else "unbesetzt",
                                departments.get(row.department_id or 0, ""),
                            )
                            if part
                        ),
                    ),
                    (
                        row.number,
                        row.name,
                        row.person_name,
                        row.person_upn,
                        departments.get(row.department_id or 0, ""),
                    ),
                )
                for row in positions
            ),
            limit,
        )
    rooms = _room_paths(db)
    if kind == "room":
        return _pick(
            words,
            (
                (
                    LookupItem(id=room_id, label=f"Raum {name}", detail=path, floor_id=floor_id),
                    (name, path),
                )
                for room_id, (name, path, floor_id) in rooms.items()
            ),
            limit,
        )
    if kind == "workplace":
        people: dict[int, list[str]] = {}
        for workplace_id, person, number in db.execute(
            select(
                InventoryWorkplacePosition.workplace_id,
                InventoryPosition.person_name,
                InventoryPosition.number,
            ).join(
                InventoryPosition, InventoryPosition.id == InventoryWorkplacePosition.position_id
            )
        ):
            people.setdefault(workplace_id, []).append(person or number)
        workplaces = db.scalars(
            select(InventoryWorkplace).order_by(InventoryWorkplace.number)
        ).all()

        def workplace_item(row: InventoryWorkplace) -> tuple[LookupItem, tuple[str, ...]]:
            room, path, _floor = rooms.get(row.room_id or 0, ("", "", 0))
            holders = ", ".join(people.get(row.id, [])) or "frei"
            label = f"{row.number} · Raum {room}" if room else row.number
            return (
                LookupItem(
                    id=row.id, label=label, detail=f"{holders} · {path}" if path else holders
                ),
                (row.number, room, path, holders),
            )

        return _pick(words, (workplace_item(row) for row in workplaces), limit)
    query = (
        select(InventoryHardware, InventoryKind.name)
        .join(InventoryKind, InventoryKind.id == InventoryHardware.kind_id)
        .where(InventoryHardware.status != STATUS_RETIRED)
        .order_by(InventoryHardware.name)
    )
    if computers:
        query = query.where(InventoryKind.name.in_(COMPUTER_KINDS))

    def hardware_item(row: InventoryHardware, kind_name: str) -> tuple[LookupItem, tuple[str, ...]]:
        parts = [kind_name]
        if row.hostname:
            parts.append(row.hostname)
        if row.serial:
            parts.append(f"SN {row.serial}")
        if row.inventory_no:
            parts.append(f"Inv. {row.inventory_no}")
        return (
            LookupItem(id=row.id, label=row.name, detail=" · ".join(parts)),
            (row.name, row.hostname, row.serial, row.inventory_no or "", kind_name),
        )

    return _pick(words, (hardware_item(row, name) for row, name in db.execute(query)), limit)
