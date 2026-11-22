"""Aufträge des Moduls Tickets für den Worker."""

import logging
from datetime import timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.sessions import now_utc
from werkbank.modules.tickets.access import GroupSourceError, TestGroupSource, group_source
from werkbank.modules.tickets.models import (
    TicketAreaGrant,
    TicketAudit,
    TicketGroupMember,
    TicketMembershipCache,
)
from werkbank.modules.tickets.service import AUDIT_KEEP_DAYS, auto_close

logger = logging.getLogger(__name__)

GROUP_SYNC = "tickets.gruppen"
GROUP_SYNC_INTERVAL = timedelta(hours=1)
HOUSEKEEPING = "tickets.wartung"
HOUSEKEEPING_INTERVAL = timedelta(hours=1)


def sync_groups(db: Session, settings: Settings) -> int:
    """Mitglieder der Gruppen mit Rollen in Bereichen aus Entra übernehmen (stündlich).

    Für Auswahllisten und „reihum“; der Zugriff selbst wird bei jeder Anfrage geprüft.
    Schlägt die Abfrage einer Gruppe fehl, bleibt ihr letzter Stand.
    """
    source = group_source(db, settings)
    if isinstance(source, TestGroupSource):
        return 0
    groups = sorted(
        set(db.scalars(select(TicketAreaGrant.oid).where(TicketAreaGrant.kind == "group")))
    )
    now = now_utc()
    synced = 0
    for group_oid in groups:
        try:
            members = source.members(group_oid)
        except GroupSourceError as exc:
            logger.warning("Gruppe %s nicht abgleichbar: %s", group_oid, exc)
            continue
        db.execute(delete(TicketGroupMember).where(TicketGroupMember.group_oid == group_oid))
        for member in {m.oid: m for m in members}.values():
            db.add(
                TicketGroupMember(
                    group_oid=group_oid,
                    oid=member.oid,
                    name=member.name,
                    mail=member.mail,
                    synced_at=now,
                )
            )
        synced += 1
    # Gruppen ohne Rolle mehr: Mitglieder entfernen
    db.execute(delete(TicketGroupMember).where(TicketGroupMember.group_oid.not_in(groups)))
    db.commit()
    return synced


def group_sync_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    sync_groups(db, settings)


def housekeeping(db: Session) -> None:
    """Gelöste Tickets schließen, alten Zwischenspeicher und altes Protokoll löschen."""
    auto_close(db)
    now = now_utc()
    db.execute(
        delete(TicketMembershipCache).where(
            TicketMembershipCache.checked_at < now - timedelta(days=1)
        )
    )
    db.execute(
        delete(TicketAudit).where(TicketAudit.occurred_at < now - timedelta(days=AUDIT_KEEP_DAYS))
    )
    db.commit()


def housekeeping_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    housekeeping(db)
