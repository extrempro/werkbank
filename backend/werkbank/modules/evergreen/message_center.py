"""Nachrichtencenter von Microsoft einlesen (spec.md 8.1).

Jede Meldung wird ein Eintrag im Unterabschnitt Microsoft 365 mit Status „neu“. Ändert
Microsoft eine Meldung später, werden die Angaben übernommen und im Verlauf vermerkt; der
Status bleibt.
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
from werkbank.modules.evergreen.models import EntrySource, EvEntry, NoteKind
from werkbank.modules.evergreen.service import MODULE, add_note, create_entry
from werkbank.modules.m365_config.utcm import UtcmClient

logger = logging.getLogger(__name__)

SOFTWARE_M365 = "m365"
FIRST_FETCH_DAYS = 30
# Überlappung beim Abruf, damit keine Meldung an der Zeitgrenze verloren geht
OVERLAP = timedelta(hours=1)
BODY_MAX_LENGTH = 20_000
UPDATED_TEXT = "Microsoft hat die Meldung aktualisiert."


@dataclass(frozen=True)
class FetchResult:
    received: int = 0
    new: int = 0
    updated: int = 0


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


def _fields(raw: dict[str, Any], message_id: str) -> dict[str, Any]:
    body = raw.get("body")
    services = raw.get("services")
    category = raw.get("category")
    text = html_to_text(body.get("content") if isinstance(body, dict) else None)
    return {
        "title": str(raw.get("title") or message_id)[:500],
        "services": [str(item)[:100] for item in services] if isinstance(services, list) else [],
        "category": str(category)[:32] if category else None,
        "major_change": bool(raw.get("isMajorChange")),
        "action_required_by": parse_time(raw.get("actionRequiredByDateTime")),
        "published_at": parse_time(raw.get("startDateTime")),
        "modified_at": parse_time(raw.get("lastModifiedDateTime")),
        "body": (text or "")[:BODY_MAX_LENGTH] or None,
    }


def fetch_messages(db: Session, client: UtcmClient) -> FetchResult:
    """Liest neue und geänderte Meldungen und legt dafür Einträge an bzw. aktualisiert sie."""
    now = now_utc()
    last = db.scalar(
        select(func.max(EvEntry.modified_at)).where(EvEntry.source == EntrySource.MESSAGE_CENTER)
    )
    since = last - OVERLAP if last else now - timedelta(days=FIRST_FETCH_DAYS)
    raw_messages = client.service_messages(since)

    new = updated = 0
    for raw in raw_messages:
        message_id = raw.get("id")
        if not isinstance(message_id, str) or not message_id or len(message_id) > 64:
            continue
        fields = _fields(raw, message_id)
        entry = db.execute(
            select(EvEntry).where(
                EvEntry.source == EntrySource.MESSAGE_CENTER, EvEntry.source_ref == message_id
            )
        ).scalar_one_or_none()
        if entry is None:
            create_entry(
                db,
                software=SOFTWARE_M365,
                source=EntrySource.MESSAGE_CENTER,
                source_ref=message_id,
                **fields,
            )
            new += 1
            continue
        if fields["modified_at"] == entry.modified_at:
            continue
        for name, value in fields.items():
            setattr(entry, name, value)
        add_note(db, entry, NoteKind.UPDATED, UPDATED_TEXT, None, now)
        updated += 1

    write_audit(
        db,
        module=MODULE,
        action="nachrichtencenter.abgerufen",
        details={"gelesen": len(raw_messages), "neu": new, "aktualisiert": updated},
    )
    db.commit()
    return FetchResult(received=len(raw_messages), new=new, updated=updated)
