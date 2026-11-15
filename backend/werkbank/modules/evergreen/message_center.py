"""Nachrichtencenter von Microsoft einlesen (spec.md 8.1).

Alle Meldungen landen im Eingang. Größere Änderungen („Major Change“) und Meldungen mit
Handlungsbedarf werden automatisch zu Vorgängen; die übrigen übernimmt die IT bei Bedarf.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.core.audit import write_audit
from werkbank.core.sessions import now_utc
from werkbank.core.text import html_to_text
from werkbank.modules.evergreen.models import EvItem, EvMessage, ItemSource, MessageStatus
from werkbank.modules.evergreen.service import MODULE, create_item
from werkbank.modules.m365_config.utcm import UtcmClient

logger = logging.getLogger(__name__)

FIRST_FETCH_DAYS = 30
# Überlappung beim Abruf, damit keine Meldung an der Zeitgrenze verloren geht
OVERLAP = timedelta(hours=1)
SUMMARY_MAX_LENGTH = 8000


@dataclass(frozen=True)
class FetchResult:
    received: int = 0
    new: int = 0
    updated: int = 0
    items_created: int = 0


def parse_time(value: Any) -> datetime | None:
    """Zeitangabe von Microsoft Graph. Leere und Platzhalter-Werte (Jahr 1) gelten als fehlend."""
    if not isinstance(value, str) or not value:
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.year < 2000:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def wants_item(message: EvMessage) -> bool:
    """Regel für die automatische Übernahme: Major Change oder Handlungsbedarf mit Frist."""
    return message.major_change or message.action_required_by is not None


def adopt(db: Session, message: EvMessage, created_by: Any = None) -> EvItem:
    """Macht aus einer Meldung einen Vorgang. Der Aufrufer entscheidet über das Commit."""
    deadline = message.action_required_by
    item = create_item(
        db,
        title=message.title[:300],
        service=", ".join(message.services)[:100] or None,
        summary=(message.body or "")[:SUMMARY_MAX_LENGTH] or None,
        rollout_date=deadline.date() if deadline else None,
        major_change=message.major_change,
        source=ItemSource.MESSAGE_CENTER,
        source_ref=message.message_id,
        created_by=created_by,
    )
    message.status = MessageStatus.ADOPTED
    message.item_id = item.id
    return item


def _apply(message: EvMessage, raw: dict[str, Any]) -> None:
    body = raw.get("body")
    services = raw.get("services")
    message.title = str(raw.get("title") or message.message_id)[:500]
    message.services = [str(item)[:100] for item in services] if isinstance(services, list) else []
    category = raw.get("category")
    message.category = str(category)[:32] if category else None
    message.major_change = bool(raw.get("isMajorChange"))
    message.action_required_by = parse_time(raw.get("actionRequiredByDateTime"))
    message.published_at = parse_time(raw.get("startDateTime"))
    message.modified_at = parse_time(raw.get("lastModifiedDateTime"))
    message.body = html_to_text(body.get("content") if isinstance(body, dict) else None)


def fetch_messages(db: Session, client: UtcmClient) -> FetchResult:
    """Liest neue und geänderte Meldungen und legt Vorgänge nach der Regel an."""
    now = now_utc()
    last = db.scalar(select(func.max(EvMessage.modified_at)))
    since = last - OVERLAP if last else now - timedelta(days=FIRST_FETCH_DAYS)
    raw_messages = client.service_messages(since)

    new = updated = created = 0
    for raw in raw_messages:
        message_id = raw.get("id")
        if not isinstance(message_id, str) or not message_id or len(message_id) > 64:
            continue
        message = db.execute(
            select(EvMessage).where(EvMessage.message_id == message_id)
        ).scalar_one_or_none()
        if message is None:
            message = EvMessage(message_id=message_id, status=MessageStatus.NEW, fetched_at=now)
            _apply(message, raw)
            db.add(message)
            db.flush()
            new += 1
            if wants_item(message):
                adopt(db, message)
                created += 1
            continue
        before = message.modified_at
        _apply(message, raw)
        if message.modified_at != before:
            updated += 1
            # Wird eine ignorierte oder neue Meldung nachträglich wichtig, entsteht ein Vorgang.
            if message.item_id is None and wants_item(message):
                adopt(db, message)
                created += 1

    write_audit(
        db,
        module=MODULE,
        action="nachrichtencenter.abgerufen",
        details={
            "gelesen": len(raw_messages),
            "neu": new,
            "aktualisiert": updated,
            "vorgaenge_angelegt": created,
        },
    )
    db.commit()
    return FetchResult(received=len(raw_messages), new=new, updated=updated, items_created=created)
