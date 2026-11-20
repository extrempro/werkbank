"""Suche im IT-Bestand: Geräte nach Bezeichnung, Seriennummer, Inventurnummer und Hostname."""

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from werkbank.core.roles import Role
from werkbank.core.search import SearchHit
from werkbank.core.sessions import CurrentUser
from werkbank.modules.inventory.models import InventoryHardware, InventoryKind

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
    return hits
