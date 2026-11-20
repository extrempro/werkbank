"""Benachrichtigungen des Bereichs IT-Bestand (nur Hinweis mit Link, keine Gerätedaten)."""

from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.notifications import Event
from werkbank.modules.inventory.models import InventoryCase, InventorySyncRun
from werkbank.modules.inventory.sync import OPEN_STATES, STATUS_FAILED

CASES_LINK = "/bestand/vorgaenge"
# Vorgänge, die jünger sind, meldet die Glocke
NEW_CASE_DAYS = 2


def inventory_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    """Neue offene Vorgänge und ein fehlgeschlagener letzter Abgleich mit NinjaOne."""
    for case in db.scalars(
        select(InventoryCase).where(
            InventoryCase.status.in_(OPEN_STATES),
            InventoryCase.created_at >= now - timedelta(days=NEW_CASE_DAYS),
        )
    ):
        yield Event(
            kind="bestand.vorgang_neu",
            key=str(case.id),
            title=f"Neuer Vorgang {case.number} im IT-Bestand",
            link=f"{CASES_LINK}/{case.id}",
        )
    last = db.scalars(
        select(InventorySyncRun).order_by(InventorySyncRun.started_at.desc()).limit(1)
    ).first()
    if last is not None and last.status == STATUS_FAILED:
        yield Event(
            kind="bestand.abgleich_fehlgeschlagen",
            key=str(last.id),
            title="Abgleich mit NinjaOne ist fehlgeschlagen",
            link=CASES_LINK,
        )
