"""Statistik im IT-Bestand: Kennzahlen und Auswertungen für die Seite „Statistik“.

Gezählt werden aktive Geräte (ausgemusterte nur unter „Ausmusterung“). Filter: Hersteller,
Art, Standort und Abteilung (jeweils 0 = ohne). Die Zahlen entstehen bei jedem Aufruf aus dem
aktuellen Bestand. Die Seite gliedert sich in Bereiche mit je mehreren Auswertungen.
"""

import re
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.core.deps import DbDep
from werkbank.modules.budget.settings import fiscal_year_name, fiscal_year_of, load_settings
from werkbank.modules.inventory.api import STATUS_ACTIVE, STATUS_RETIRED, WHEREABOUTS, Reader
from werkbank.modules.inventory.loans import local_today
from werkbank.modules.inventory.models import (
    InventoryDepartment,
    InventoryFloor,
    InventoryHardware,
    InventoryKind,
    InventoryLoan,
    InventoryLoanItem,
    InventoryMaker,
    InventoryModel,
    InventoryPosition,
    InventoryRetireReason,
    InventoryRoom,
    InventorySection,
    InventorySite,
    InventoryWorkplace,
    InventoryWorkplacePosition,
)
from werkbank.modules.inventory.staff import workplace_summaries

router = APIRouter(prefix="/api/inventory")

# Lange Listen enden mit „Andere“
TOP_MODELS = 12
TOP_OS = 10
TOP_KINDS_LOANED = 6
NO_MAKER = "Ohne Hersteller"
NO_KIND = "Ohne Art"
NO_SITE = "Ohne Standort"
NO_DEPARTMENT = "Ohne Abteilung"
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
STATUS_LABELS = [
    "An einer Stelle",
    "Am Arbeitsplatz",
    "Im Lager, frei",
    "Verliehen",
    "Reserviert für einen Verleih",
]
# Betriebssysteme ohne Sicherheitsupdates des Herstellers (Anfang des Namens)
UNSUPPORTED_OS = ("Windows 7", "Windows 8", "Windows 10", "Windows Server 2012")
# So lange ohne Kontakt in NinjaOne gilt ein Gerät als „nicht online“
OFFLINE_DAYS = 30
# Erneuerungsbedarf: laufendes Geschäftsjahr und die drei folgenden
RENEWAL_YEARS = 4
OVERDUE = "überfällig"
_BUILT = re.compile(r"^(\d{4})-KW(\d{1,2})$")

FilterKey = Literal["maker", "kind", "site", "department"]


class Count(BaseModel):
    label: str
    count: int
    # Wert für den Filter, wenn ein Klick auf den Balken die Seite filtert
    value: int | None = None
    # Hervorheben (z. B. Betriebssystem ohne Support); immer zusätzlich im Text
    warn: bool = False


class Chart(BaseModel):
    key: str
    title: str
    items: list[Count]
    # Klick auf einen Balken setzt diesen Filter
    filter: FilterKey | None = None
    note: str = ""
    # Einheit der Zahlen, z. B. „Geräte“ oder „Verleihe“
    unit: str = "Geräte"


class Section(BaseModel):
    key: str
    title: str
    intro: str
    charts: list[Chart]


class Option(BaseModel):
    # ID; 0 = ohne
    id: int
    name: str
    count: int


class Kpis(BaseModel):
    total: int
    new_this_month: int
    free: int
    loans_open: int
    loans_overdue: int
    # None: Für keine Art ist eine Nutzungsdauer eingetragen
    renewal_due: int | None
    workplaces_gap: int
    missing: int


class StatisticsOut(BaseModel):
    makers: list[Option]
    kinds: list[Option]
    sites: list[Option]
    departments: list[Option]
    maker_id: int | None
    kind_id: int | None
    site_id: int | None
    department_id: int | None
    year_label: str
    kpis: Kpis
    sections: list[Section]


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


def add_years(start: date, years: int) -> date:
    try:
        return start.replace(year=start.year + years)
    except ValueError:  # 29. Februar
        return start.replace(year=start.year + years, day=28)


def unsupported_os(name: str) -> bool:
    return any(name == prefix or name.startswith(prefix + " ") for prefix in UNSUPPORTED_OS)


def fold(counter: Counter[str], top: int) -> list[Count]:
    """Die größten ``top`` Einträge, der Rest als „Andere“."""
    ranked_items = sorted(counter.items(), key=lambda item: (-item[1], item[0].casefold()))
    items = [Count(label=label, count=count) for label, count in ranked_items[:top]]
    rest = sum(count for _, count in ranked_items[top:])
    if rest:
        items.append(Count(label=OTHER, count=rest))
    return items


def ranked(counter: Counter[str]) -> list[Count]:
    return fold(counter, len(counter))


def _with_ids(counter: Counter[int], names: dict[int, str], empty: str) -> list[Count]:
    """Zählung nach ID mit Namen; ID 0 steht für „ohne“ und kommt ans Ende."""
    items = [
        Count(label=names.get(key, empty) if key else empty, count=count, value=key)
        for key, count in counter.items()
    ]
    return sorted(items, key=lambda item: (item.value == 0, -item.count, item.label.casefold()))


def _site_of_room(db: Session) -> dict[int, int]:
    """Raum → Standort."""
    return dict(
        db.execute(
            select(InventoryRoom.id, InventorySite.id)
            .join(InventoryFloor, InventoryFloor.id == InventoryRoom.floor_id)
            .join(InventorySection, InventorySection.id == InventoryFloor.section_id)
            .join(InventorySite, InventorySite.id == InventorySection.site_id)
        ).all()
    )


def _contact(facts: dict[str, Any]) -> datetime | None:
    value = facts.get("last_contact")
    if not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _zabbix_gaps(db: Session) -> tuple[int, int] | None:
    """Nicht überwacht und ohne Bestandseintrag aus dem Zabbix-Abgleich; None ohne Zabbix."""
    from werkbank.modules.monitoring.zabbix.config import stored_connection
    from werkbank.modules.monitoring.zabbix.inventory import match_inventory

    if stored_connection(db).get("enabled") is not True:
        return None
    matched = match_inventory(db)
    without = sum(1 for gap in matched.gaps.values() if gap == "ohne_bestand")
    return len(matched.unmonitored), without


@router.get("/statistics")
def statistics(
    user: Reader,
    db: DbDep,
    maker: Annotated[int | None, Query(ge=0)] = None,
    kind: Annotated[int | None, Query(ge=0)] = None,
    site: Annotated[int | None, Query(ge=0)] = None,
    department: Annotated[int | None, Query(ge=0)] = None,
) -> StatisticsOut:
    """Kennzahlen und Auswertungen; die Filter grenzen die Geräte ein (0 = ohne)."""
    today = local_today()
    now = datetime.now(UTC)
    budget = load_settings(db)
    kinds_all = {row.id: row for row in db.scalars(select(InventoryKind)).all()}
    kind_names = {key: row.name for key, row in kinds_all.items()}
    models = {row.id: (row.name, row.maker_id) for row in db.scalars(select(InventoryModel)).all()}
    maker_names = dict(db.execute(select(InventoryMaker.id, InventoryMaker.name)).all())
    site_names = dict(db.execute(select(InventorySite.id, InventorySite.name)).all())
    department_names = dict(
        db.execute(select(InventoryDepartment.id, InventoryDepartment.name)).all()
    )
    site_of_room = _site_of_room(db)
    workplace_room = dict(
        db.execute(select(InventoryWorkplace.id, InventoryWorkplace.room_id)).all()
    )
    positions = {row.id: row for row in db.scalars(select(InventoryPosition)).all()}
    links = list(
        db.execute(
            select(InventoryWorkplacePosition.workplace_id, InventoryWorkplacePosition.position_id)
        ).all()
    )
    departments_of_workplace: dict[int, set[int]] = {}
    for workplace_id, position_id in links:
        position = positions.get(position_id)
        departments_of_workplace.setdefault(workplace_id, set()).add(
            (position.department_id or 0) if position else 0
        )

    def maker_of(row: InventoryHardware) -> int:
        return (models.get(row.model_id, (None, None))[1] or 0) if row.model_id else 0

    def site_of(row: InventoryHardware) -> int:
        room = row.room_id or (workplace_room.get(row.workplace_id) if row.workplace_id else None)
        return site_of_room.get(room, 0) if room else 0

    def departments_of(row: InventoryHardware) -> set[int]:
        if row.position_id is not None:
            position = positions.get(row.position_id)
            return {(position.department_id or 0) if position else 0}
        if row.workplace_id is not None:
            return departments_of_workplace.get(row.workplace_id, {0})
        return {0}

    def matches(row: InventoryHardware, skip: str = "") -> bool:
        return (
            (skip == "maker" or maker is None or maker_of(row) == maker)
            and (skip == "kind" or kind is None or row.kind_id == kind)
            and (skip == "site" or site is None or site_of(row) == site)
            and (skip == "department" or department is None or department in departments_of(row))
        )

    all_rows = list(db.scalars(select(InventoryHardware)).all())
    active_all = [row for row in all_rows if row.status == STATUS_ACTIVE]
    active = [row for row in active_all if matches(row)]

    # Auswahl für die Filter: Zahlen jeweils unter den übrigen Filtern
    def options(skip: FilterKey, key_of: Any, names: dict[int, str], empty: str) -> list[Option]:
        counter: Counter[int] = Counter()
        for row in active_all:
            if matches(row, skip):
                for key in key_of(row):
                    counter[key] += 1
        return [
            Option(id=item.value or 0, name=item.label, count=item.count)
            for item in _with_ids(counter, names, empty)
        ]

    # Verleih: offen (begonnen) und reserviert (geplant)
    open_items = dict(
        db.execute(
            select(InventoryLoanItem.hardware_id, InventoryLoanItem.loan_id).where(
                InventoryLoanItem.returned_on.is_(None)
            )
        ).all()
    )
    loans = {loan.id: loan for loan in db.scalars(select(InventoryLoan)).all()}

    by_kind: Counter[int] = Counter()
    by_maker: Counter[int] = Counter()
    by_model: Counter[str] = Counter()
    by_age: Counter[str] = Counter()
    by_site: Counter[int] = Counter()
    by_status: Counter[str] = Counter()
    by_os: Counter[str] = Counter()
    free_by_kind: Counter[int] = Counter()
    renewal: Counter[str] = Counter()
    renewal_overdue_kind: Counter[str] = Counter()
    renewal_unknown = 0
    missing: Counter[str] = Counter()
    offline = 0
    new_this_month = 0
    lifetimes = {key: row.lifetime_years for key, row in kinds_all.items() if row.lifetime_years}
    current_year = fiscal_year_of(today, budget.start_month)
    years = [current_year + offset for offset in range(RENEWAL_YEARS)]
    for row in active:
        by_kind[row.kind_id] += 1
        by_maker[maker_of(row)] += 1
        model_name = models.get(row.model_id, (None, None))[0] if row.model_id else None
        by_model[model_name or "Ohne Modell"] += 1
        facts = row.ninja_facts or {}
        start = row.purchased_on or built_date(facts.get("built"))
        by_age[age_label(start, today)] += 1
        by_site[site_of(row)] += 1
        loan = loans.get(open_items[row.id]) if row.id in open_items else None
        if loan is not None and loan.issued_on > today:
            by_status["Reserviert für einen Verleih"] += 1
        elif loan is not None:
            by_status["Verliehen"] += 1
        elif row.position_id is not None:
            by_status["An einer Stelle"] += 1
        elif row.workplace_id is not None:
            by_status["Am Arbeitsplatz"] += 1
        else:
            by_status["Im Lager, frei"] += 1
            free_by_kind[row.kind_id] += 1
        os_name = facts.get("os") if row.ninja_id is not None else None
        by_os[os_name if isinstance(os_name, str) and os_name else "Ohne Angabe"] += 1
        if row.kind_id in lifetimes:
            if start is None:
                renewal_unknown += 1
            else:
                due = add_years(start, lifetimes[row.kind_id])
                if due <= today:
                    renewal[OVERDUE] += 1
                    renewal_overdue_kind[
                        f"{kind_names.get(row.kind_id, NO_KIND)} ({lifetimes[row.kind_id]} Jahre)"
                    ] += 1
                else:
                    year = fiscal_year_of(due, budget.start_month)
                    if year in years:
                        renewal[fiscal_year_name(year, budget.start_month)] += 1
        if start is None:
            missing["Ohne Anschaffungsdatum"] += 1
        if site_of(row) == 0 and row.room_id is None:
            missing["Ohne Raum"] += 1
        if row.model_id is None:
            missing["Ohne Modell"] += 1
        if not row.inventory_no:
            missing["Ohne Inventurnummer"] += 1
        if not row.serial.strip():
            missing["Ohne Seriennummer"] += 1
        if row.ninja_id is not None:
            contact = _contact(facts)
            if contact is not None and now - contact > timedelta(days=OFFLINE_DAYS):
                offline += 1
        if row.created_at.astimezone(UTC).date() >= today.replace(day=1):
            new_this_month += 1

    status_counts = {label: by_status[label] for label in STATUS_LABELS if by_status[label]}

    # Arbeitsplätze und Stellen: nur Standort- und Abteilungsfilter greifen
    workplaces = [
        entry
        for entry in workplace_summaries(db)
        if (site is None or (site_of_room.get(entry.room_id, 0) if entry.room_id else 0) == site)
        and (department is None or department in departments_of_workplace.get(entry.id, {0}))
    ]
    workplace_states = Counter(
        "Ohne Vorlage"
        if entry.complete is None
        else ("Vollständig" if entry.complete else "Es fehlt etwas")
        for entry in workplaces
    )
    hardware_of_position: Counter[int] = Counter(
        row.position_id for row in active_all if row.position_id is not None
    )
    hardware_of_workplace: Counter[int] = Counter(
        row.workplace_id for row in active_all if row.workplace_id is not None
    )
    for workplace_id, position_id in links:
        hardware_of_position[position_id] += hardware_of_workplace.get(workplace_id, 0)
    position_states: Counter[str] = Counter()
    for position in positions.values():
        if department is not None and (position.department_id or 0) != department:
            continue
        occupied = bool(position.person_oid)
        has = hardware_of_position.get(position.id, 0) > 0
        if occupied and has:
            position_states["Besetzt mit Hardware"] += 1
        elif occupied:
            position_states["Besetzt ohne Hardware"] += 1
        elif has:
            position_states["Unbesetzt mit Hardware"] += 1
        else:
            position_states["Unbesetzt ohne Hardware"] += 1

    # Verleih: Verleihe mit mindestens einem Gerät aus der Auswahl
    wanted = {row.id for row in all_rows if matches(row)}
    items = list(db.execute(select(InventoryLoanItem.loan_id, InventoryLoanItem.hardware_id)).all())
    filtered = maker is not None or kind is not None or site is not None or department is not None
    loan_ids = {loan_id for loan_id, hardware_id in items if hardware_id in wanted}
    shown_loans = [loan for loan in loans.values() if not filtered or loan.id in loan_ids]
    first_month = date(today.year, today.month, 1)
    months = []
    for back in range(11, -1, -1):
        year, month = divmod(first_month.year * 12 + first_month.month - 1 - back, 12)
        months.append(date(year, month + 1, 1))
    since = months[0]
    per_month: Counter[str] = Counter(
        f"{loan.issued_on:%Y-%m}" for loan in shown_loans if loan.issued_on >= since
    )
    month_names = (
        "Jan",
        "Feb",
        "Mär",
        "Apr",
        "Mai",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Okt",
        "Nov",
        "Dez",
    )
    kind_of_hardware = {row.id: row.kind_id for row in all_rows}
    shown_ids = {loan.id for loan in shown_loans if loan.issued_on >= since}
    loaned_kinds: Counter[str] = Counter(
        kind_names.get(kind_of_hardware.get(hardware_id, 0), NO_KIND)
        for loan_id, hardware_id in items
        if loan_id in shown_ids
    )
    punctual: Counter[str] = Counter()
    durations: list[int] = []
    for loan in shown_loans:
        if loan.returned_on is not None and loan.returned_on >= since:
            late = (loan.returned_on - loan.due_on).days
            punctual[
                "Pünktlich"
                if late <= 0
                else ("Bis 7 Tage später" if late <= 7 else "Mehr als 7 Tage später")
            ] += 1
            durations.append(max((loan.returned_on - loan.issued_on).days, 0))
        elif loan.returned_on is None and loan.due_on < today:
            punctual["Noch offen, überfällig"] += 1
    loans_open = sum(
        1 for loan in shown_loans if loan.returned_on is None and loan.issued_on <= today
    )
    loans_overdue = sum(
        1 for loan in shown_loans if loan.returned_on is None and loan.due_on < today
    )

    # Ausmusterung
    reasons = dict(db.execute(select(InventoryRetireReason.id, InventoryRetireReason.name)).all())
    retired = [
        row
        for row in all_rows
        if row.status == STATUS_RETIRED and row.retired_on is not None and matches(row)
    ]
    per_year: Counter[str] = Counter(str(row.retired_on.year) for row in retired if row.retired_on)
    this_year = [row for row in retired if row.retired_on and row.retired_on.year == today.year]
    reason_counts: Counter[str] = Counter(
        reasons.get(row.retire_reason_id or 0, "Ohne Grund") for row in this_year
    )
    whereabouts: Counter[str] = Counter(
        WHEREABOUTS.get(row.retire_whereabouts or "", "ohne Angabe") for row in this_year
    )
    with_storage = [
        row
        for row in this_year
        if kinds_all.get(row.kind_id) and kinds_all[row.kind_id].has_storage
    ]
    wiped = sum(1 for row in with_storage if row.retire_wiped)

    zabbix = _zabbix_gaps(db)
    sync = Counter[str]()
    sync[f"Seit {OFFLINE_DAYS} Tagen nicht online (NinjaOne)"] = offline
    if zabbix is not None:
        sync["Nicht in Zabbix überwacht"] = zabbix[0]
        sync["In Zabbix ohne Bestandseintrag"] = zabbix[1]

    year_label = budget.year_label
    renewal_items = (
        [Count(label=OVERDUE, count=renewal[OVERDUE], warn=renewal[OVERDUE] > 0)]
        + [
            Count(label=f"{year_label} {name}", count=renewal[name])
            for name in (fiscal_year_name(year, budget.start_month) for year in years)
        ]
        if lifetimes
        else []
    )
    sections = [
        Section(
            key="ueberblick",
            title="Überblick",
            intro="Was es gibt und wo es ist. Ein Klick auf einen Balken bei Art oder Hersteller "
            "filtert die ganze Seite.",
            charts=[
                Chart(
                    key="art",
                    title="Geräte je Art",
                    filter="kind",
                    items=_with_ids(by_kind, kind_names, NO_KIND),
                ),
                Chart(
                    key="status",
                    title="Wo die Geräte sind",
                    items=[Count(label=k, count=v) for k, v in status_counts.items()],
                    note="„Im Lager, frei“ sind Geräte ohne Stelle, Arbeitsplatz und Verleih.",
                ),
                Chart(
                    key="hersteller",
                    title="Hersteller",
                    filter="maker",
                    items=_with_ids(by_maker, maker_names, NO_MAKER),
                ),
                Chart(key="modell", title="Modelle", items=fold(by_model, TOP_MODELS)),
                Chart(
                    key="os",
                    title="Betriebssystem (NinjaOne)",
                    items=[
                        item.model_copy(update={"warn": unsupported_os(item.label)})
                        for item in fold(by_os, TOP_OS)
                    ],
                    note="Hervorgehoben: Systeme ohne Sicherheitsupdates des Herstellers.",
                ),
            ],
        ),
        Section(
            key="alter",
            title="Alter & Erneuerung",
            intro="Wie alt die Geräte sind und wann sie die Nutzungsdauer ihrer Art erreichen. "
            "Die Nutzungsdauer stellst du in den Stammdaten bei den Hardware-Arten ein.",
            charts=[
                Chart(
                    key="alter",
                    title="Alter der Geräte",
                    items=[
                        Count(label=label, count=by_age[label])
                        for label in [*AGE_LABELS, UNKNOWN_AGE]
                        if by_age[label]
                    ],
                    note="Grundlage: Anschaffungsdatum, sonst Baujahr aus NinjaOne.",
                ),
                Chart(
                    key="erneuerung",
                    title=f"Erneuerungsbedarf je {year_label}",
                    items=renewal_items,
                    note=(
                        f"{renewal_unknown} Geräte ohne Datum sind nicht dabei."
                        if lifetimes and renewal_unknown
                        else (
                            ""
                            if lifetimes
                            else "Noch keine Nutzungsdauer eingetragen. Das geht in den "
                            "Stammdaten bei den Hardware-Arten."
                        )
                    ),
                ),
                Chart(
                    key="erneuerung_art",
                    title="Überfällig nach Art",
                    items=ranked(renewal_overdue_kind),
                ),
            ],
        ),
        Section(
            key="orte",
            title="Standorte & Arbeitsplätze",
            intro="Verteilung auf die Standorte und wie vollständig Arbeitsplätze und Stellen "
            "ausgestattet sind.",
            charts=[
                Chart(
                    key="standort",
                    title="Geräte je Standort",
                    filter="site",
                    items=_with_ids(by_site, site_names, NO_SITE),
                    note="Standort über den Raum des Geräts, sonst über den Arbeitsplatz.",
                ),
                Chart(
                    key="ausstattung",
                    title="Ausstattung der Arbeitsplätze",
                    unit="Arbeitsplätze",
                    items=[
                        Count(
                            label=label,
                            count=workplace_states[label],
                            warn=label == "Es fehlt etwas",
                        )
                        for label in ("Vollständig", "Es fehlt etwas", "Ohne Vorlage")
                        if workplace_states[label]
                    ],
                    note="Verglichen mit der Vorlage des Arbeitsplatzes. Filter nach Art und "
                    "Hersteller wirken hier nicht.",
                ),
                Chart(
                    key="lager",
                    title="Freie Geräte im Lager",
                    filter="kind",
                    items=_with_ids(free_by_kind, kind_names, NO_KIND),
                    note="Was sofort ausgegeben oder verliehen werden kann.",
                ),
                Chart(
                    key="stellen",
                    title="Stellen",
                    unit="Stellen",
                    items=[
                        Count(label=label, count=position_states[label])
                        for label in (
                            "Besetzt mit Hardware",
                            "Besetzt ohne Hardware",
                            "Unbesetzt mit Hardware",
                            "Unbesetzt ohne Hardware",
                        )
                        if position_states[label]
                    ],
                    note="Hardware direkt an der Stelle oder an ihren Arbeitsplätzen. Unbesetzte "
                    "Stellen mit Hardware sind Kandidaten für das Lager.",
                ),
            ],
        ),
        Section(
            key="verleih",
            title="Verleih",
            intro="Wie viel in den letzten zwölf Monaten verliehen wurde und ob es pünktlich "
            "zurückkam.",
            charts=[
                Chart(
                    key="monate",
                    title="Neue Verleihe je Monat",
                    unit="Verleihe",
                    items=[
                        Count(
                            label=f"{month_names[month.month - 1]} {month.year}",
                            count=per_month[f"{month:%Y-%m}"],
                        )
                        for month in months
                    ],
                ),
                Chart(
                    key="verleih_art",
                    title="Am häufigsten verliehen",
                    items=fold(loaned_kinds, TOP_KINDS_LOANED),
                ),
                Chart(
                    key="rueckgabe",
                    title="Rückgabe",
                    unit="Verleihe",
                    items=[
                        Count(label=label, count=punctual[label], warn=label != "Pünktlich")
                        for label in (
                            "Pünktlich",
                            "Bis 7 Tage später",
                            "Mehr als 7 Tage später",
                            "Noch offen, überfällig",
                        )
                        if punctual[label]
                    ],
                    note=(
                        f"Durchschnittliche Dauer: {round(sum(durations) / len(durations))} Tage."
                        if durations
                        else ""
                    ),
                ),
            ],
        ),
        Section(
            key="ausmusterung",
            title="Ausmusterung",
            intro="Was die IT verlassen hat, warum und wohin.",
            charts=[
                Chart(
                    key="jahr",
                    title="Ausmusterungen je Jahr",
                    items=[Count(label=k, count=per_year[k]) for k in sorted(per_year)],
                ),
                Chart(
                    key="grund",
                    title=f"Gründe ({today.year})",
                    items=ranked(reason_counts),
                ),
                Chart(
                    key="verbleib",
                    title=f"Verbleib ({today.year})",
                    items=ranked(whereabouts),
                    note=(
                        f"Datenträger gelöscht oder vernichtet: {wiped} von {len(with_storage)} "
                        "bestätigt."
                        if with_storage
                        else ""
                    ),
                ),
            ],
        ),
        Section(
            key="daten",
            title="Datenqualität",
            intro="Wo Angaben fehlen oder der Bestand nicht zu anderen Quellen passt.",
            charts=[
                Chart(
                    key="luecken",
                    title="Fehlende Angaben",
                    items=[
                        Count(label=label, count=missing[label])
                        for label in (
                            "Ohne Anschaffungsdatum",
                            "Ohne Raum",
                            "Ohne Modell",
                            "Ohne Inventurnummer",
                            "Ohne Seriennummer",
                        )
                        if missing[label]
                    ],
                    note="„Ohne Raum“: weder das Gerät noch sein Arbeitsplatz hat einen Raum.",
                ),
                Chart(
                    key="abgleich",
                    title="Abgleich mit anderen Quellen",
                    items=[Count(label=k, count=v, warn=v > 0) for k, v in sync.items()],
                    note=(
                        "Zabbix ist nicht eingerichtet."
                        if zabbix is None
                        else "Der Zabbix-Abgleich zählt den ganzen Bestand, ohne Filter."
                    ),
                ),
            ],
        ),
    ]

    return StatisticsOut(
        makers=options("maker", lambda row: [maker_of(row)], maker_names, NO_MAKER),
        kinds=options("kind", lambda row: [row.kind_id], kind_names, NO_KIND),
        sites=options("site", lambda row: [site_of(row)], site_names, NO_SITE),
        departments=options(
            "department", lambda row: sorted(departments_of(row)), department_names, NO_DEPARTMENT
        ),
        maker_id=maker,
        kind_id=kind,
        site_id=site,
        department_id=department,
        year_label=year_label,
        kpis=Kpis(
            total=len(active),
            new_this_month=new_this_month,
            free=status_counts.get("Im Lager, frei", 0),
            loans_open=loans_open,
            loans_overdue=loans_overdue,
            renewal_due=renewal[OVERDUE] if lifetimes else None,
            workplaces_gap=workplace_states["Es fehlt etwas"],
            missing=sum(missing.values()),
        ),
        sections=sections,
    )
