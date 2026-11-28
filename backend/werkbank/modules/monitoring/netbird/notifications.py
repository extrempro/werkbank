"""Benachrichtigungen für NetBird: wiederholt fehlgeschlagener Abruf (an Admins), neue Hinweise
(an alle mit NetBird.Reader). Ein Hinweis, der nicht mehr zutrifft, schließt sich selbst (siehe
collector.sync_hints); kommt er später wieder, ist er eine neue Meldung.

Phase 5: gemeldete Änderungen an überwachten Gruppen und Policies an alle mit NetBird.Reader,
kritische (fremde Gruppe) zusätzlich an alle mit NetBird.Approver (auf Wunsch auch per Mail und
Teams, unabhängig von deren Einstellungen), Erinnerung an offene Änderungen an die Bestätiger."""

from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.notifications import FORCED_CHANNELS, Event
from werkbank.modules.monitoring.netbird.config import stored
from werkbank.modules.monitoring.netbird.models import NbChange, NbHint, NbRun
from werkbank.modules.monitoring.netbird.watch import load_watch

ADMIN_LINK = "/verwaltung/netbird"
FAILURES = 3
CHANGE_KIND = "monitoring.netbird_aenderung"
CRITICAL_KIND = "monitoring.netbird_kritisch"
REMINDER_KIND = "monitoring.netbird_erinnerung"
CHANGES_LINK = "/monitoring/netbird/gruppen"
# Nur jüngere Änderungen melden (Marken der Glocke gelten 30 Tage)
CHANGE_WINDOW = timedelta(days=7)
REMINDER_WINDOW = timedelta(days=25)
KIND_LABELS = {"group": "Gruppe", "policy": "Policy"}


def change_link(change_id: int) -> str:
    return f"{CHANGES_LINK}?auswahl={change_id}"


def change_title(change: NbChange) -> str:
    label = KIND_LABELS.get(change.kind, change.kind)
    return f"NetBird: {label} {change.object_name} {change.summary}"


def _critical_mail(db: Session) -> bool:
    return load_watch(stored(db)).critical_mail


FORCED_CHANNELS[CRITICAL_KIND] = _critical_mail


def netbird_notifications(db: Session, settings: Settings, now: datetime) -> Iterable[Event]:
    recent = list(db.scalars(select(NbRun).order_by(NbRun.id.desc()).limit(FAILURES)))
    if len(recent) == FAILURES and not any(run.ok for run in recent):
        last_ok = db.scalars(
            select(NbRun.id).where(NbRun.ok.is_(True)).order_by(NbRun.id.desc()).limit(1)
        ).first()
        yield Event(
            kind="monitoring.netbird_fehler",
            key=str(last_ok or 0),
            title="NetBird lässt sich nicht abrufen",
            link=ADMIN_LINK,
        )

    for hint in db.scalars(select(NbHint).order_by(NbHint.since)):
        yield Event(
            kind="monitoring.netbird_info"
            if hint.level == "info"
            else "monitoring.netbird_hinweis",
            key=f"{hint.key}@{int(hint.since.timestamp())}",
            title=f"NetBird: {hint.title}",
            link=hint.link,
        )

    for change in db.scalars(
        select(NbChange).where(
            NbChange.reported.is_(True),
            NbChange.status == "offen",
            NbChange.detected_at >= now - CHANGE_WINDOW,
        )
    ):
        yield Event(
            kind=CHANGE_KIND,
            key=str(change.id),
            title=change_title(change),
            link=change_link(change.id),
        )
        if change.critical:
            yield Event(
                kind=CRITICAL_KIND,
                key=str(change.id),
                title=f"{change_title(change)} (fremde Gruppe)",
                link=change_link(change.id),
            )
    reminder = load_watch(stored(db)).reminder
    if reminder:
        for change in db.scalars(
            select(NbChange).where(
                NbChange.status == "offen",
                NbChange.detected_at <= now - timedelta(days=reminder),
                NbChange.detected_at >= now - REMINDER_WINDOW,
            )
        ):
            yield Event(
                kind=REMINDER_KIND,
                key=str(change.id),
                title=f"NetBird: Änderung an {change.object_name} wartet seit "
                f"{(now - change.detected_at).days} Tagen auf Bestätigung",
                link=change_link(change.id),
            )
