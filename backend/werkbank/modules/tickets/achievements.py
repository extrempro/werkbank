"""Erfolge für die Ticketarbeit: freiwillig, je Person, ab dem Einschalten gezählt.

Belohnt wird Sorgfalt, nicht Tempo: keine Zeiten, keine Rangliste, keine Auswertung für
Vorgesetzte. Jede Kategorie hat 30 Stufen (6 Ränge mit je 5); die Schwellen folgen einer Kurve,
die je Kategorie auf ihr Ziel gestreckt wird. Ein Ereignis zählt je Anlass (ref) nur einmal.
"""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from werkbank.core.sessions import now_utc
from werkbank.modules.tickets.models import (
    ENTRY_FORWARD,
    Ticket,
    TicketAchievementEvent,
    TicketAchievementProfile,
    TicketEntry,
    TicketTemplate,
)

LEVELS = 30
RANKS = 6
# Kurve für das größte Ziel (6.000); kleinere Ziele werden darauf gestreckt
BASE = (
    0, 1, 3, 6, 10, 15, 25, 40, 60, 85, 115, 150, 200, 260, 330, 410,
    500, 600, 720, 860, 1000, 1200, 1450, 1750, 2100, 2500, 3000, 3600, 4300, 5100, 6000,
)  # fmt: skip
STYLES = ("wappen", "neon", "fantasy", "pixel", "flach", "rang", "karte")
ALLROUNDER = "allrounder"
# Wie lange ein Ticket offen gewesen sein muss, damit es für „Langer Atem“ zählt
LONG_OPEN = timedelta(days=30)


@dataclass(frozen=True)
class Category:
    id: str
    name: str
    max: int


CATEGORIES = (
    Category("chronist", "Chronist", 6000),
    Category("quelle", "Wissensquelle", 3000),
    Category("staffel", "Staffelläufer", 1500),
    Category("ordnung", "Ordnungshüter", 600),
    Category("atem", "Langer Atem", 600),
    Category("bruecke", "Brückenbauer", 600),
)
CATEGORY_IDS = tuple(c.id for c in CATEGORIES)


def _nice(value: float) -> int:
    if value < 50:
        return round(value)
    if value < 200:
        return round(value / 5) * 5
    if value < 1000:
        return round(value / 10) * 10
    return round(value / 50) * 50


def thresholds(maximum: int) -> list[int]:
    """Schwellen für Stufe 0 bis 30; jede Stufe braucht mindestens eins mehr als die vorige."""
    out = [0]
    for k in range(1, LEVELS + 1):
        out.append(max(out[-1] + 1, _nice(BASE[k] * maximum / BASE[LEVELS])))
    return out


THRESHOLDS = {c.id: thresholds(c.max) for c in CATEGORIES}


def level_of(category: str, count: int) -> int:
    """Erreichte Stufe (0 bis 30) für eine Anzahl."""
    steps = THRESHOLDS[category]
    return max((k for k in range(LEVELS + 1) if steps[k] <= count), default=0)


def allrounder(levels: dict[str, int]) -> int:
    """Die Stufe, die in mindestens drei Kategorien erreicht ist."""
    ordered = sorted(levels.values(), reverse=True)
    return ordered[2] if len(ordered) >= 3 else 0


def wreaths(levels: dict[str, int]) -> list[int]:
    """Je Rang, wie viele Kategorien ihn erreicht haben (Meisterkranz bei allen sechs)."""
    return [sum(1 for lv in levels.values() if lv >= 5 * r + 1) for r in range(RANKS)]


def profile(db: Session, oid: str) -> TicketAchievementProfile | None:
    return db.get(TicketAchievementProfile, oid)


def is_enabled(db: Session, oid: str | None) -> bool:
    if not oid:
        return False
    found = profile(db, oid)
    return found is not None and found.enabled


def record(db: Session, oid: str | None, category: str, ref: str) -> None:
    """Zählt ein Ereignis, wenn die Person Erfolge eingeschaltet hat; doppelt zählt nicht."""
    if category not in CATEGORY_IDS or not is_enabled(db, oid):
        return
    db.execute(
        insert(TicketAchievementEvent)
        .values(oid=oid, category=category, ref=ref[:80])
        .on_conflict_do_nothing(constraint="uq_ticket_achievement_event")
    )


def counts(db: Session, oid: str) -> dict[str, int]:
    rows = db.execute(
        select(TicketAchievementEvent.category, func.count())
        .where(TicketAchievementEvent.oid == oid)
        .group_by(TicketAchievementEvent.category)
    ).all()
    found = {category: int(n) for category, n in rows}
    return {c: found.get(c, 0) for c in CATEGORY_IDS}


def levels(db: Session, oid: str) -> dict[str, int]:
    return {c: level_of(c, n) for c, n in counts(db, oid).items()}


def forget(db: Session, oid: str) -> None:
    """Beim Ausschalten: alles Gesammelte löschen."""
    db.execute(delete(TicketAchievementEvent).where(TicketAchievementEvent.oid == oid))


# --- Anlässe -----------------------------------------------------------------------------


def solved(db: Session, ticket: Ticket, oid: str | None) -> None:
    """Gelöst: mit Beschreibung zählt „Chronist“, nach über einem Monat offen „Langer Atem“."""
    ref = f"ticket:{ticket.id}"
    if ticket.solution_text.strip():
        record(db, oid, "chronist", ref)
    if ticket.created_at and now_utc() - ticket.created_at > LONG_OPEN:
        record(db, oid, "atem", ref)


def templates_used(
    db: Session, ticket: Ticket, template_ids: list[int], user_oid: str, ref: str
) -> None:
    """„Wissensquelle“: Bausteine des Bereichs, die jemand anderes angelegt hat, zählen für
    die Person, die sie angelegt hat; je Eintrag und Baustein einmal."""
    if not template_ids:
        return
    for template in db.scalars(
        select(TicketTemplate).where(
            TicketTemplate.id.in_(set(template_ids)),
            TicketTemplate.area_id == ticket.area_id,
        )
    ):
        author = template.created_by_oid
        if author and author != user_oid:
            record(db, author, "quelle", f"tpl:{template.id}:{ref}")


def external_answer(db: Session, ticket: Ticket) -> None:
    """„Brückenbauer“: Auf die letzte Weiterleitung nach außen kam eine Antwort. Zählt für
    die Person, die weitergeleitet hat, je Weiterleitung einmal."""
    forward = db.scalar(
        select(TicketEntry)
        .where(
            TicketEntry.ticket_id == ticket.id,
            TicketEntry.kind == ENTRY_FORWARD,
            TicketEntry.author_oid.is_not(None),
        )
        .order_by(TicketEntry.created_at.desc())
        .limit(1)
    )
    if forward is not None:
        record(db, forward.author_oid, "bruecke", f"entry:{forward.id}")
