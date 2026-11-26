"""Suche im Bereich Evergreen: Einträge nach Nummer, Titel, Meldung und Text."""

import re

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from werkbank.core.search import SearchHit
from werkbank.core.sessions import CurrentUser
from werkbank.modules.evergreen.models import SOFTWARE, EvEntry
from werkbank.modules.evergreen.service import OPEN_STATES, READER_ROLES

MODULE = "Evergreen"
MAX_ITEMS = 8
NUMBER = re.compile(r"^EV-(\d{4})-(\d{1,6})$", re.IGNORECASE)
STATUS_LABEL = {"neu": "Neu", "bearbeitet": "Bearbeitet", "abgeschlossen": "Abgeschlossen"}


def evergreen_search(db: Session, user: CurrentUser, query: str) -> list[SearchHit]:
    """Offene Einträge zuerst, dann die neuesten."""
    if not user.has_any_role(*READER_ROLES):
        return []
    conditions = [
        EvEntry.title.icontains(query, autoescape=True),
        EvEntry.source_ref.icontains(query, autoescape=True),
        EvEntry.body.icontains(query, autoescape=True),
    ]
    number = NUMBER.match(query)
    if number:
        conditions.append(
            and_(EvEntry.year == int(number.group(1)), EvEntry.sequence == int(number.group(2)))
        )
    rows = db.scalars(
        select(EvEntry)
        .where(or_(*conditions))
        .order_by(EvEntry.status.notin_(OPEN_STATES), EvEntry.id.desc())
        .limit(MAX_ITEMS)
    ).all()
    return [
        SearchHit(
            module=MODULE,
            kind="Eintrag",
            title=entry.title,
            subtitle=(
                f"{entry.number} · {SOFTWARE.get(entry.software, entry.software)}"
                f" · {STATUS_LABEL.get(entry.status, entry.status)}"
            ),
            link=f"/m365/neuerungen/{entry.id}",
        )
        for entry in rows
    ]
