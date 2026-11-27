"""Benachrichtigungen zu Rückmeldungen (Glocke). Titel nennen nur die Nummer, keine Inhalte."""

from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.notifications import Event
from werkbank.modules.feedback.api import number
from werkbank.modules.feedback.models import FeedbackEntry, FeedbackReply

RECENT = timedelta(days=7)
KIND_LABELS = {"fehler": "Fehler", "idee": "Idee"}
STATUS_LABELS = {
    "neu": "neu",
    "in_arbeit": "in Arbeit",
    "erledigt": "erledigt",
    "abgelehnt": "nicht umgesetzt",
}


def feedback_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    since = now - RECENT
    for entry in db.scalars(select(FeedbackEntry).where(FeedbackEntry.created_at >= since)).all():
        yield Event(
            kind="rueckmeldung.neu",
            key=str(entry.id),
            title=f"{number(entry.id)}: neue Rückmeldung ({KIND_LABELS.get(entry.kind, 'Idee')})",
            link=f"/verwaltung/rueckmeldungen/{entry.id}",
            exclude=frozenset({entry.user_id}) if entry.user_id else frozenset(),
        )
    for reply, owner in db.execute(
        select(FeedbackReply, FeedbackEntry.user_id)
        .join(FeedbackEntry, FeedbackEntry.id == FeedbackReply.entry_id)
        .where(FeedbackReply.created_at >= since)
    ).all():
        if owner is None:
            continue
        yield Event(
            kind="rueckmeldung.antwort",
            key=str(reply.id),
            title=f"{number(reply.entry_id)}: Antwort der IT auf deine Rückmeldung",
            link="/konto/rueckmeldungen",
            user_ids=frozenset({owner}),
        )
    for entry in db.scalars(
        select(FeedbackEntry).where(
            FeedbackEntry.status_changed_at.is_not(None),
            FeedbackEntry.status_changed_at >= since,
            FeedbackEntry.user_id.is_not(None),
        )
    ).all():
        if entry.user_id is None or entry.status_changed_at is None:
            continue
        yield Event(
            kind="rueckmeldung.stand",
            key=f"{entry.id}:{entry.status}:{entry.status_changed_at.isoformat()}",
            title=f"{number(entry.id)}: Stand deiner Rückmeldung ist jetzt "
            f"„{STATUS_LABELS.get(entry.status, entry.status)}“",
            link="/konto/rueckmeldungen",
            user_ids=frozenset({entry.user_id}),
        )
