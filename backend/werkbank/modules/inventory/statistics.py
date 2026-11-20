"""Statistik im IT-Bestand: Zählungen für die Seite „Statistik“.

Gezählt werden aktive Geräte (ausgemusterte nur in „Ausmusterungen je Jahr“), auf Wunsch
nur eines Herstellers. Die Zahlen entstehen bei jedem Aufruf aus dem aktuellen Bestand.
"""

import re
from collections import Counter
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.core.deps import DbDep
from werkbank.modules.inventory.api import STATUS_ACTIVE, STATUS_RETIRED, Reader
from werkbank.modules.inventory.loans import local_today
from werkbank.modules.inventory.models import (
    InventoryFloor,
    InventoryHardware,
    InventoryKind,
    InventoryLoan,
    InventoryLoanItem,
    InventoryMaker,
    InventoryModel,
    InventoryRetireReason,
    InventoryRoom,
    InventorySection,
    InventorySite,
)

router = APIRouter(prefix="/api/inventory")

# Lange Listen enden mit „Andere“
TOP_MODELS = 12
TOP_OS = 10
NO_MAKER = "Ohne Hersteller"
OTHER = "Andere"
UNKNOWN_AGE = "unbekannt"
AGE_LABELS = [
    "unter 1 Jahr",
    "1 bis 2 Jahre",
    "2 bis 3 Jahre",
    "3 bis 4 Jahre",
    "4 bis 5 Jahre",
    "5 bis 6 Jahre",
    "6 Jahre und älter",
]
STATUS_LABELS = ["An einer Stelle", "An einem Arbeitsplatz", "Im Lager", "Verliehen"]
_BUILT = re.compile(r"^(\d{4})-KW(\d{1,2})$")


class Count(BaseModel):
    label: str
    count: int


class Chart(BaseModel):
    key: str
    title: str
    # True: Reihenfolge ist fest (z. B. Altersgruppen), nicht nach Größe
    ordered: bool
    items: list[Count]


class MakerOption(BaseModel):
    # Hersteller-ID; 0 = ohne Hersteller
    id: int
    name: str
    count: int


class RetireYear(BaseModel):
    year: int
    count: int
    reasons: list[Count]


class LoanStats(BaseModel):
    open: int
    overdue: int
    # Verleihe je Monat der letzten 12 Monate (JJJJ-MM), ältester zuerst
    months: list[Count]


class StatisticsOut(BaseModel):
    makers: list[MakerOption]
    maker_id: int | None
    total: int
    charts: list[Chart]
    loans: LoanStats
    retired: list[RetireYear]


def built_date(value: Any) -> date | None:
    """Baujahr aus dem Custom Field der Monitore („2024-KW12“) als Montag dieser Woche."""
    if not isinstance(value, str):
        return None
    match = _BUILT.match(value.strip())
    if not match:
        return None
    try:
        return date.fromisocalendar(int(match[1]), int(match[2]), 1)
    except ValueError:
        return None


def age_label(start: date | None, today: date) -> str:
    if start is None or start > today:
        return UNKNOWN_AGE
    years = today.year - start.year - ((today.month, today.day) < (start.month, start.day))
    return AGE_LABELS[min(years, len(AGE_LABELS) - 1)]


def fold(counter: Counter[str], top: int) -> list[Count]:
    """Die größten ``top`` Einträge, der Rest als „Andere“."""
    ranked = sorted(counter.items(), key=lambda item: (-item[1], item[0].casefold()))
    items = [Count(label=label, count=count) for label, count in ranked[:top]]
    rest = sum(count for _, count in ranked[top:])
    if rest:
        items.append(Count(label=OTHER, count=rest))
    return items


def ranked(counter: Counter[str]) -> list[Count]:
    return fold(counter, len(counter))


def _site_names(db: Session) -> dict[int, str]:
    """Raum → Name des Standorts."""
    rows = db.execute(
        select(InventoryRoom.id, InventorySite.name)
        .join(InventoryFloor, InventoryFloor.id == InventoryRoom.floor_id)
        .join(InventorySection, InventorySection.id == InventoryFloor.section_id)
        .join(InventorySite, InventorySite.id == InventorySection.site_id)
    ).all()
    return dict(rows)


Rows = list[tuple[InventoryHardware, int | None]]


def _maker_of(rows: Rows, maker_id: int | None) -> Rows:
    if maker_id is None:
        return rows
    return [row for row in rows if (row[1] or 0) == maker_id]


@router.get("/statistics")
def statistics(
    user: Reader,
    db: DbDep,
    maker: Annotated[int | None, Query(ge=0)] = None,
) -> StatisticsOut:
    """Zählungen für die Statistik; ``maker`` grenzt auf einen Hersteller ein (0 = ohne)."""
    today = local_today()
    kinds = dict(db.execute(select(InventoryKind.id, InventoryKind.name)).all())
    models = {row.id: (row.name, row.maker_id) for row in db.scalars(select(InventoryModel)).all()}
    makers = dict(db.execute(select(InventoryMaker.id, InventoryMaker.name)).all())
    all_rows = [
        (row, models.get(row.model_id, (None, None))[1] if row.model_id else None)
        for row in db.scalars(select(InventoryHardware)).all()
    ]
    active_all = [item for item in all_rows if item[0].status == STATUS_ACTIVE]

    maker_counts: Counter[int] = Counter((maker_id or 0) for _, maker_id in active_all)
    options = sorted(
        (
            MakerOption(id=key, name=makers.get(key, NO_MAKER) if key else NO_MAKER, count=count)
            for key, count in maker_counts.items()
        ),
        key=lambda option: (option.id == 0, option.name.casefold()),
    )

    active = [row for row, _ in _maker_of(active_all, maker)]
    on_loan = set(
        db.scalars(
            select(InventoryLoanItem.hardware_id).where(InventoryLoanItem.returned_on.is_(None))
        ).all()
    )
    sites = _site_names(db)

    by_kind: Counter[str] = Counter()
    by_model: Counter[str] = Counter()
    by_age: Counter[str] = Counter()
    by_site: Counter[str] = Counter()
    by_status: Counter[str] = Counter()
    by_os: Counter[str] = Counter()
    for row in active:
        by_kind[kinds.get(row.kind_id, "Ohne Art")] += 1
        model_name = models.get(row.model_id, (None, None))[0] if row.model_id else None
        by_model[model_name or "Ohne Modell"] += 1
        facts = row.ninja_facts or {}
        by_age[age_label(row.purchased_on or built_date(facts.get("built")), today)] += 1
        by_site[sites.get(row.room_id, "Ohne Standort") if row.room_id else "Ohne Standort"] += 1
        if row.id in on_loan:
            by_status["Verliehen"] += 1
        elif row.position_id is not None:
            by_status["An einer Stelle"] += 1
        elif row.workplace_id is not None:
            by_status["An einem Arbeitsplatz"] += 1
        else:
            by_status["Im Lager"] += 1
        os_name = facts.get("os") if row.ninja_id is not None else None
        by_os[os_name if isinstance(os_name, str) and os_name else "Ohne Angabe"] += 1

    charts = [
        Chart(key="art", title="Geräte je Art", ordered=False, items=ranked(by_kind)),
        Chart(
            key="modell", title="Geräte je Modell", ordered=False, items=fold(by_model, TOP_MODELS)
        ),
        Chart(
            key="alter",
            title="Alter der Geräte",
            ordered=True,
            items=[
                Count(label=label, count=by_age[label])
                for label in [*AGE_LABELS, UNKNOWN_AGE]
                if by_age[label]
            ],
        ),
        Chart(key="standort", title="Geräte je Standort", ordered=False, items=ranked(by_site)),
        Chart(
            key="status",
            title="Wo die Geräte sind",
            ordered=True,
            items=[
                Count(label=label, count=by_status[label])
                for label in STATUS_LABELS
                if by_status[label]
            ],
        ),
        Chart(key="os", title="Betriebssystem", ordered=False, items=fold(by_os, TOP_OS)),
    ]

    # Verleih: Verleihe mit mindestens einem Gerät des Herstellers
    loans = list(db.scalars(select(InventoryLoan)).all())
    if maker is not None:
        wanted = {row.id for row, _ in _maker_of(all_rows, maker)}
        with_devices = {
            loan_id
            for loan_id, hardware_id in db.execute(
                select(InventoryLoanItem.loan_id, InventoryLoanItem.hardware_id)
            ).all()
            if hardware_id in wanted
        }
        loans = [loan for loan in loans if loan.id in with_devices]
    first_month = date(today.year, today.month, 1)
    months = []
    for back in range(11, -1, -1):
        year, month = divmod(first_month.year * 12 + first_month.month - 1 - back, 12)
        months.append(f"{year:04d}-{month + 1:02d}")
    per_month: Counter[str] = Counter(f"{loan.issued_on:%Y-%m}" for loan in loans)
    loan_stats = LoanStats(
        open=sum(1 for loan in loans if loan.returned_on is None),
        overdue=sum(1 for loan in loans if loan.returned_on is None and loan.due_on < today),
        months=[Count(label=month, count=per_month[month]) for month in months],
    )

    # Ausmusterungen je Jahr, mit Gründen
    reasons = dict(db.execute(select(InventoryRetireReason.id, InventoryRetireReason.name)).all())
    per_year: dict[int, Counter[str]] = {}
    for row, _ in _maker_of(all_rows, maker):
        retired_on = row.retired_on
        if row.status != STATUS_RETIRED or retired_on is None:
            continue
        reason = reasons.get(row.retire_reason_id or 0, "Ohne Grund")
        per_year.setdefault(retired_on.year, Counter())[reason] += 1
    retired = [
        RetireYear(year=year, count=sum(counter.values()), reasons=ranked(counter))
        for year, counter in sorted(per_year.items())
    ]

    return StatisticsOut(
        makers=options,
        maker_id=maker,
        total=len(active),
        charts=charts,
        loans=loan_stats,
        retired=retired,
    )
