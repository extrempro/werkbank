"""Verknüpfung der Tickets mit dem IT-Bestand (nur für Personen mit Rechten im IT-Bestand).

Der Melder wird über seine Mailadresse dem Benutzernamen (UPN) der Person an einer Stelle
zugeordnet (Groß- und Kleinschreibung egal). Gespeichert wird nichts; die Angaben werden beim
Öffnen des Tickets neu ermittelt.
"""

from datetime import date

from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from werkbank.modules.inventory.models import (
    InventoryDepartment,
    InventoryHardware,
    InventoryKind,
    InventoryLoan,
    InventoryLoanItem,
    InventoryPosition,
    InventoryRoom,
    InventoryWorkplace,
    InventoryWorkplacePosition,
)

POSITIONS_MAX = 5
DEVICES_MAX = 20


class LinkedDevice(BaseModel):
    id: int
    name: str
    kind: str
    inventory_no: str


class LinkedWorkplace(BaseModel):
    id: int
    number: str
    room: str


class LinkedPosition(BaseModel):
    id: int
    number: str
    name: str
    department: str
    workplaces: list[LinkedWorkplace]
    devices: list[LinkedDevice]


class LinkedLoan(BaseModel):
    id: int
    number: str
    due_on: date
    overdue: bool
    items: int


class ReporterInventory(BaseModel):
    positions: list[LinkedPosition]
    loans: list[LinkedLoan]


def positions_for(db: Session, mail: str) -> list[InventoryPosition]:
    if not mail.strip():
        return []
    return list(
        db.scalars(
            select(InventoryPosition)
            .where(func.lower(InventoryPosition.person_upn) == mail.strip().lower())
            .order_by(InventoryPosition.number)
            .limit(POSITIONS_MAX)
        )
    )


def reporter_inventory(db: Session, mail: str) -> ReporterInventory:
    """Stellen, Arbeitsplätze, Geräte und offene Verleihe zur Mailadresse des Melders."""
    kinds = dict(db.execute(select(InventoryKind.id, InventoryKind.name)).tuples().all())
    departments = dict(
        db.execute(select(InventoryDepartment.id, InventoryDepartment.name)).tuples().all()
    )
    positions: list[LinkedPosition] = []
    for pos in positions_for(db, mail):
        places = db.execute(
            select(InventoryWorkplace, InventoryRoom.name)
            .join(
                InventoryWorkplacePosition,
                InventoryWorkplacePosition.workplace_id == InventoryWorkplace.id,
            )
            .outerjoin(InventoryRoom, InventoryRoom.id == InventoryWorkplace.room_id)
            .where(InventoryWorkplacePosition.position_id == pos.id)
            .order_by(InventoryWorkplace.number)
        ).all()
        place_ids = [w.id for w, _ in places]
        devices = db.scalars(
            select(InventoryHardware)
            .where(
                InventoryHardware.status == "aktiv",
                or_(
                    InventoryHardware.position_id == pos.id,
                    InventoryHardware.workplace_id.in_(place_ids),
                ),
            )
            .order_by(InventoryHardware.name)
            .limit(DEVICES_MAX)
        ).all()
        positions.append(
            LinkedPosition(
                id=pos.id,
                number=pos.number,
                name=pos.name,
                department=departments.get(pos.department_id or 0, ""),
                workplaces=[
                    LinkedWorkplace(id=w.id, number=w.number, room=room or "") for w, room in places
                ],
                devices=[
                    LinkedDevice(
                        id=hw.id,
                        name=hw.name,
                        kind=kinds.get(hw.kind_id, ""),
                        inventory_no=hw.inventory_no or "",
                    )
                    for hw in devices
                ],
            )
        )
    loans: list[LinkedLoan] = []
    lower = mail.strip().lower()
    if lower:
        today = date.today()
        for loan in db.scalars(
            select(InventoryLoan)
            .where(
                InventoryLoan.returned_on.is_(None),
                or_(
                    func.lower(InventoryLoan.person_mail) == lower,
                    func.lower(InventoryLoan.person_upn) == lower,
                ),
            )
            .order_by(InventoryLoan.due_on)
        ):
            count = db.scalar(
                select(func.count())
                .select_from(InventoryLoanItem)
                .where(
                    InventoryLoanItem.loan_id == loan.id, InventoryLoanItem.returned_on.is_(None)
                )
            )
            loans.append(
                LinkedLoan(
                    id=loan.id,
                    number=loan.number,
                    due_on=loan.due_on,
                    overdue=loan.due_on < today,
                    items=count or 0,
                )
            )
    return ReporterInventory(positions=positions, loans=loans)
