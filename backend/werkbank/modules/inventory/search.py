"""Suche im IT-Bestand: Geräte, Stellen, Arbeitsplätze und Räume."""

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from werkbank.core.roles import Role
from werkbank.core.search import SearchHit
from werkbank.core.sessions import CurrentUser
from werkbank.modules.inventory.models import (
    InventoryFloor,
    InventoryHardware,
    InventoryKind,
    InventoryPosition,
    InventoryRoom,
    InventorySection,
    InventorySite,
    InventoryWorkplace,
)

MODULE = "IT-Bestand"
MAX_ITEMS = 8


def escape_like(value: str) -> str:
    """Platzhalter von LIKE als Text behandeln."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def inventory_search(db: Session, user: CurrentUser, query: str) -> list[SearchHit]:
    """Geräte, deren Kennungen den Suchtext enthalten. Nur für Rollen des IT-Bestands."""
    if not user.has_any_role(Role.INVENTORY_READER, Role.INVENTORY_EDITOR):
        return []
    pattern = f"%{escape_like(query.casefold())}%"
    rows = db.execute(
        select(InventoryHardware, InventoryKind.name)
        .join(InventoryKind, InventoryKind.id == InventoryHardware.kind_id)
        .where(
            or_(
                func.lower(InventoryHardware.name).like(pattern, escape="\\"),
                func.lower(InventoryHardware.serial).like(pattern, escape="\\"),
                func.lower(func.coalesce(InventoryHardware.inventory_no, "")).like(
                    pattern, escape="\\"
                ),
                func.lower(InventoryHardware.hostname).like(pattern, escape="\\"),
            )
        )
        .order_by(func.lower(InventoryHardware.name), InventoryHardware.id)
        .limit(MAX_ITEMS)
    ).all()
    hits: list[SearchHit] = []
    for row, kind in rows:
        parts = [kind]
        if row.inventory_no:
            parts.append(f"Inventurnummer {row.inventory_no}")
        if row.serial:
            parts.append(f"SN {row.serial}")
        if row.status == "ausgemustert":
            parts.append("ausgemustert")
        hits.append(
            SearchHit(
                module=MODULE,
                kind="Hardware",
                title=row.name,
                subtitle=" · ".join(parts),
                link=f"/bestand/hardware/{row.id}",
            )
        )
    if len(hits) < MAX_ITEMS:
        hits.extend(_positions(db, pattern, MAX_ITEMS - len(hits)))
    if len(hits) < MAX_ITEMS:
        hits.extend(_workplaces(db, pattern, MAX_ITEMS - len(hits)))
    if len(hits) < MAX_ITEMS:
        hits.extend(_rooms(db, pattern, MAX_ITEMS - len(hits)))
    return hits


def _positions(db: Session, pattern: str, limit: int) -> list[SearchHit]:
    """Stellen nach Nummer, Bezeichnung und Person."""
    rows = db.scalars(
        select(InventoryPosition)
        .where(
            or_(
                func.lower(InventoryPosition.number).like(pattern, escape="\\"),
                func.lower(InventoryPosition.name).like(pattern, escape="\\"),
                func.lower(InventoryPosition.person_name).like(pattern, escape="\\"),
            )
        )
        .order_by(InventoryPosition.number)
        .limit(limit)
    ).all()
    return [
        SearchHit(
            module=MODULE,
            kind="Stelle",
            title=f"{row.number} {row.name}",
            subtitle=row.person_name if row.person_oid else "unbesetzt",
            link=f"/bestand/stellen/{row.id}",
        )
        for row in rows
    ]


def _workplaces(db: Session, pattern: str, limit: int) -> list[SearchHit]:
    """Arbeitsplätze nach Nummer und Raum."""
    rows = db.execute(
        select(InventoryWorkplace, InventoryRoom.name)
        .outerjoin(InventoryRoom, InventoryRoom.id == InventoryWorkplace.room_id)
        .where(
            or_(
                func.lower(InventoryWorkplace.number).like(pattern, escape="\\"),
                func.lower(func.coalesce(InventoryRoom.name, "")).like(pattern, escape="\\"),
            )
        )
        .order_by(InventoryWorkplace.number)
        .limit(limit)
    ).all()
    return [
        SearchHit(
            module=MODULE,
            kind="Arbeitsplatz",
            title=row.number,
            subtitle=" · ".join(
                part
                for part in ("geteilt" if row.shared else "einzeln", f"Raum {room}" if room else "")
                if part
            ),
            link=f"/bestand/arbeitsplaetze/{row.id}",
        )
        for row, room in rows
    ]


def _rooms(db: Session, pattern: str, limit: int) -> list[SearchHit]:
    """Räume nach Name; der Treffer öffnet die Etage mit markiertem Raum."""
    rows = db.execute(
        select(InventoryRoom.id, InventoryRoom.name, InventoryFloor.id, InventoryFloor.name)
        .add_columns(InventorySite.name)
        .join(InventoryFloor, InventoryFloor.id == InventoryRoom.floor_id)
        .join(InventorySection, InventorySection.id == InventoryFloor.section_id)
        .join(InventorySite, InventorySite.id == InventorySection.site_id)
        .where(func.lower(InventoryRoom.name).like(pattern, escape="\\"))
        .order_by(func.lower(InventoryRoom.name), InventoryRoom.id)
        .limit(limit)
    ).all()
    return [
        SearchHit(
            module=MODULE,
            kind="Raum",
            title=f"Raum {name}",
            subtitle=f"{site} · {floor}",
            link=f"/bestand/standorte/etage/{floor_id}/raum/{room_id}",
        )
        for room_id, name, floor_id, floor, site in rows
    ]
