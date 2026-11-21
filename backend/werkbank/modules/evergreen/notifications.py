"""Benachrichtigungen des Bereichs Evergreen (nur Hinweis mit Link, ohne Inhalt der Meldung)."""

from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.notifications import Event
from werkbank.modules.evergreen.models import SOFTWARE, EntryStatus, EvEntry


def evergreen_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    """Je Software ein Hinweis auf neue Einträge. Der Schlüssel ist der neueste Eintrag:
    kommen neue dazu, gibt es einen neuen Hinweis, sonst nicht (auch nicht beim ersten Abruf
    mit vielen Meldungen auf einmal)."""
    rows = db.execute(
        select(EvEntry.software, func.count(), func.max(EvEntry.id))
        .where(EvEntry.status == EntryStatus.NEW)
        .group_by(EvEntry.software)
    ).all()
    for software, count, newest in rows:
        name = SOFTWARE.get(software, software)
        yield Event(
            kind="evergreen.neu",
            key=f"{software}:{newest}",
            title=(
                f"Evergreen {name}: 1 neuer Eintrag"
                if count == 1
                else f"Evergreen {name}: {count} neue Einträge"
            ),
            link=f"/evergreen/{software}",
        )
