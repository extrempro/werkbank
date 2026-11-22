"""Benachrichtigungen (Glocke, spec.md 6.7).

Ein Auftrag im Worker fragt regelmäßig die Quellen der Module ab. Jede Quelle liefert die
Ereignisse, die gerade vorliegen, jeweils mit einem festen Schlüssel. Neu ist ein Ereignis,
wenn sein Schlüssel noch nicht gemeldet wurde; dann bekommt jede passende Person einen Eintrag.

Wird eine Art zum ersten Mal beobachtet, gilt der vorhandene Bestand als gemeldet. So
erzeugt die Einführung oder ein neues Modul keine Flut an alten Meldungen.

Empfänger richten sich nach den Rollen der letzten Anmeldung (User.last_roles). Beim Lesen
filtert die API zusätzlich nach den Rollen der laufenden Sitzung.
"""

import logging
import uuid
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import PUSH_KEY, SMTP_KEY, TEAMS_KEY, get_setting
from werkbank.core.deps import CurrentUserDep, DbDep
from werkbank.core.models import (
    Notification,
    NotificationChannel,
    NotificationKind,
    NotificationMark,
    NotificationMute,
    User,
)
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc

logger = logging.getLogger(__name__)

NOTIFY = "kern.benachrichtigungen"
NOTIFY_INTERVAL = timedelta(minutes=5)
KEEP_NOTIFICATIONS_DAYS = 90
# Marken für Ereignisse, die so lange nicht mehr gemeldet wurden, fallen weg
KEEP_MARKS_DAYS = 30
TITLE_MAX = 300
LINK_MAX = 300
LIST_MAX = 100


@dataclass(frozen=True)
class KindInfo:
    """Art einer Benachrichtigung: Bereich, Beschreibung für die Einstellungen und Rollen."""

    module: str
    label: str
    roles: tuple[str, ...]


ALL_ROLES: tuple[str, ...] = tuple(role.value for role in Role)

KINDS: dict[str, KindInfo] = {
    "config.aenderung_kritisch": KindInfo(
        "M365-Konfiguration",
        "Änderung an einer Einstellung mit hoher Kritikalität",
        (Role.CONFIG_REVIEWER,),
    ),
    "config.abweichung": KindInfo(
        "M365-Konfiguration", "Neue Abweichung vom Soll-Wert", (Role.CONFIG_REVIEWER,)
    ),
    "config.abruf_fehlgeschlagen": KindInfo(
        "M365-Konfiguration", "Abruf der Einstellungen fehlgeschlagen", (Role.WERKBANK_ADMIN,)
    ),
    "tenant.stoerung": KindInfo(
        "M365-Tenant",
        "Störung eines Microsoft-365-Dienstes beginnt oder ist behoben",
        (Role.TENANT_READER,),
    ),
    "tenant.zugangsdaten": KindInfo(
        "M365-Tenant",
        "Geheimnis oder Zertifikat einer App läuft bald ab",
        (Role.TENANT_READER,),
    ),
    "tenant.lizenzen": KindInfo(
        "M365-Tenant",
        "Lizenzen voll, überbucht oder Stichtag naht",
        (Role.TENANT_READER,),
    ),
    "evergreen.neu": KindInfo(
        "Evergreen",
        "Neue Einträge zum Sichten",
        (Role.EVERGREEN_EDITOR,),
    ),
    "geraete.zugeordnet": KindInfo(
        "Gerätezuordnung",
        "Ein Gerät, das du gescannt oder freigegeben hast, ist zugeordnet",
        (Role.DEVICES_ASSOCIATION,),
    ),
    "geraete.registriert": KindInfo(
        "Gerätezuordnung",
        "Ein Gerät, das du gescannt oder freigegeben hast, ist in Intune registriert",
        (Role.DEVICES_ASSOCIATION,),
    ),
    "budget.rechnung_pruefen": KindInfo(
        "IT-Budget", "Rechnung wartet auf Prüfung", (Role.BUDGET_MANAGER,)
    ),
    "budget.rechnung_gebucht": KindInfo(
        "IT-Budget",
        "Deine erfasste Rechnung wurde gebucht",
        (Role.BUDGET_EDITOR, Role.BUDGET_MANAGER),
    ),
    "budget.kuendigung": KindInfo(
        "IT-Budget",
        "Kündigungsfrist eines Vertrags in 60, 30 und 7 Tagen",
        (Role.BUDGET_EDITOR, Role.BUDGET_MANAGER),
    ),
    "budget.prognose": KindInfo(
        "IT-Budget",
        "Prognose eines Postens übersteigt den Planwert",
        (Role.BUDGET_EDITOR, Role.BUDGET_MANAGER),
    ),
    "monitoring.dns_abweichung": KindInfo(
        "IT-Monitoring",
        "DNS-Abgleich mit NetBox findet neue Abweichungen",
        (Role.MONITORING_READER, Role.WERKBANK_ADMIN),
    ),
    "monitoring.dns_fehlgeschlagen": KindInfo(
        "IT-Monitoring",
        "DNS-Abgleich mit NetBox ist fehlgeschlagen",
        (Role.MONITORING_READER, Role.WERKBANK_ADMIN),
    ),
    "monitoring.zabbix_fehler": KindInfo(
        "IT-Monitoring",
        "Zabbix lässt sich mehrmals hintereinander nicht abfragen",
        (Role.WERKBANK_ADMIN,),
    ),
    "monitoring.zabbix_dienstkonto": KindInfo(
        "IT-Monitoring",
        "Token für Zabbix läuft ab oder die Rolle des Dienstkontos erlaubt zu viel",
        (Role.WERKBANK_ADMIN,),
    ),
    # Tickets: Empfänger sind einzelne Personen (Rollen je Bereich liegen nicht in Entra);
    # deshalb hier alle App-Rollen, die Auswahl trifft das Ereignis über user_ids.
    "tickets.neu": KindInfo(
        "Tickets", "Neues, noch nicht zugewiesenes Ticket in deinem Bereich", ALL_ROLES
    ),
    "tickets.zugewiesen": KindInfo(
        "Tickets", "Ein Ticket wurde dir zugewiesen oder übergeben", ALL_ROLES
    ),
    "tickets.antwort": KindInfo("Tickets", "Antwort des Melders auf dein Ticket", ALL_ROLES),
    "tickets.erinnerung": KindInfo("Tickets", "Erinnerung zu deinem Ticket ist fällig", ALL_ROLES),
    "tickets.frist_bald": KindInfo("Tickets", "Frist deines Tickets ist bald erreicht", ALL_ROLES),
    "tickets.frist_ueberschritten": KindInfo(
        "Tickets", "Frist eines Tickets überschritten (Bereichsverwaltung)", ALL_ROLES
    ),
    "bestand.vorgang_neu": KindInfo(
        "IT-Bestand",
        "Neuer Vorgang im Eingang, z. B. ein neues Gerät in NinjaOne",
        (Role.INVENTORY_EDITOR,),
    ),
    "bestand.abgleich_fehlgeschlagen": KindInfo(
        "IT-Bestand",
        "Abgleich mit NinjaOne ist fehlgeschlagen",
        (Role.INVENTORY_EDITOR, Role.WERKBANK_ADMIN),
    ),
    "kern.auftrag_fehlgeschlagen": KindInfo(
        "Werkbank", "Ein Hintergrundauftrag ist fehlgeschlagen", (Role.WERKBANK_ADMIN,)
    ),
}


@dataclass(frozen=True)
class Event:
    """Etwas, das gemeldet werden soll.

    key: fester Schlüssel innerhalb der Art; dieselbe Sache wird nur einmal gemeldet.
    user_ids: nur diese Personen (zusätzlich zur Rollenprüfung), sonst alle mit passender Rolle.
    roles: schränkt die Rollen der Art für dieses Ereignis ein (z. B. Schritt im Ablauf).
    exclude: diese Personen nicht benachrichtigen (z. B. wer selbst gehandelt hat).
    """

    kind: str
    key: str
    title: str
    link: str
    roles: tuple[str, ...] | None = None
    user_ids: frozenset[uuid.UUID] | None = None
    exclude: frozenset[uuid.UUID] = field(default_factory=frozenset)


NotificationSource = Callable[[Session, Settings, datetime], Iterable[Event]]


def _mark_key(event: Event) -> str:
    return f"{event.kind}:{event.key}"[:200]


def _recipients(
    users: Sequence[tuple[uuid.UUID, list[str]]],
    muted: set[tuple[uuid.UUID, str]],
    event: Event,
) -> list[uuid.UUID]:
    info = KINDS[event.kind]
    roles = set(event.roles if event.roles is not None else info.roles) & set(info.roles)
    result = []
    for user_id, user_roles in users:
        if event.user_ids is not None and user_id not in event.user_ids:
            continue
        if user_id in event.exclude or (user_id, event.kind) in muted:
            continue
        if roles & set(user_roles or ()):
            result.append(user_id)
    return result


def dispatch(db: Session, events: Iterable[Event], *, now: datetime | None = None) -> int:
    """Legt für neue Ereignisse Benachrichtigungen an. Liefert die Zahl der Einträge."""
    now = now or now_utc()
    by_kind: dict[str, list[Event]] = {}
    for event in events:
        if event.kind not in KINDS:
            raise ValueError(f"Unbekannte Art: {event.kind}")
        by_kind.setdefault(event.kind, []).append(event)

    started = set(db.scalars(select(NotificationKind.kind)))
    users: list[tuple[uuid.UUID, list[str]]] = [
        (row.id, list(row.last_roles or [])) for row in db.execute(select(User.id, User.last_roles))
    ]
    muted = {(row.user_id, row.kind) for row in db.scalars(select(NotificationMute))}
    created = 0
    for kind in KINDS:
        kind_events = by_kind.get(kind, [])
        # Doppelte Schlüssel innerhalb eines Laufs nur einmal
        unique: dict[str, Event] = {}
        for event in kind_events:
            unique.setdefault(_mark_key(event), event)
        known: set[str] = set()
        if unique:
            known = set(
                db.scalars(
                    select(NotificationMark.key).where(NotificationMark.key.in_(list(unique)))
                )
            )
        first_run = kind not in started
        if known:
            db.execute(
                update(NotificationMark)
                .where(NotificationMark.key.in_(list(known)))
                .values(seen_at=now)
            )
        for key, event in unique.items():
            if key in known:
                continue
            db.add(NotificationMark(key=key, seen_at=now))
            if first_run:
                continue
            for user_id in _recipients(users, muted, event):
                db.add(
                    Notification(
                        user_id=user_id,
                        kind=event.kind,
                        title=event.title[:TITLE_MAX],
                        link=event.link[:LINK_MAX],
                        created_at=now,
                    )
                )
                created += 1
        if first_run:
            db.add(NotificationKind(kind=kind, started_at=now))
    db.flush()
    return created


def purge(db: Session, *, now: datetime | None = None) -> None:
    """Löscht alte Benachrichtigungen und Marken von Ereignissen, die es nicht mehr gibt.

    Eine Marke bleibt, solange eine Quelle das Ereignis meldet. Quellen, die nur die letzten
    Tage betrachten, müssen kürzer zurückschauen als KEEP_MARKS_DAYS, sonst käme eine
    gelöschte Marke als neues Ereignis zurück.
    """
    now = now or now_utc()
    db.execute(
        delete(Notification).where(
            Notification.created_at < now - timedelta(days=KEEP_NOTIFICATIONS_DAYS)
        )
    )
    db.execute(
        delete(NotificationMark).where(
            NotificationMark.seen_at < now - timedelta(days=KEEP_MARKS_DAYS)
        )
    )


def make_notify_job(
    sources: Sequence[NotificationSource],
) -> Callable[[Session, Settings, dict[str, Any]], None]:
    """Auftrag, der alle Quellen abfragt und neue Ereignisse meldet."""

    def notify_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
        now = now_utc()
        events: list[Event] = []
        for source in sources:
            # Eine fehlerhafte Quelle hält die anderen nicht auf
            try:
                events.extend(source(db, settings, now))
            except Exception:
                logger.exception("Quelle für Benachrichtigungen fehlgeschlagen: %s", source)
                db.rollback()
        dispatch(db, events, now=now)
        purge(db, now=now)

    return notify_job


# --- API -------------------------------------------------------------------------------------

router = APIRouter(prefix="/api/notifications")


def _allowed_kinds(user: CurrentUser) -> list[str]:
    return [kind for kind, info in KINDS.items() if user.has_any_role(*info.roles)]


class NotificationOut(BaseModel):
    id: int
    kind: str
    module: str
    title: str
    link: str
    created_at: datetime
    read: bool


class NotificationsOut(BaseModel):
    unread: int
    entries: list[NotificationOut]


class UnreadOut(BaseModel):
    unread: int


class KindOut(BaseModel):
    kind: str
    module: str
    label: str
    # Glocke
    enabled: bool
    mail: bool
    teams: bool
    push: bool


class ChannelsOut(BaseModel):
    # In der Verwaltung eingerichtet
    mail: bool
    teams: bool
    push: bool
    # Ohne Mailadresse im Konto gehen weder Mail noch Teams
    has_email: bool


class SettingsOut(BaseModel):
    kinds: list[KindOut]
    channels: ChannelsOut


class SettingsIn(BaseModel):
    # Arten ohne Glocke
    disabled: list[str] = Field(max_length=100)
    # Arten zusätzlich per Mail bzw. Teams; None: unverändert
    mail: list[str] | None = Field(default=None, max_length=100)
    teams: list[str] | None = Field(default=None, max_length=100)
    push: list[str] | None = Field(default=None, max_length=100)


@router.get("")
def list_notifications(
    user: CurrentUserDep, db: DbDep, limit: int = Query(20, ge=1, le=LIST_MAX)
) -> NotificationsOut:
    """Die neuesten Benachrichtigungen der angemeldeten Person und die Zahl der ungelesenen."""
    kinds = _allowed_kinds(user)
    mine = (Notification.user_id == user.user_id, Notification.kind.in_(kinds))
    rows = db.scalars(
        select(Notification)
        .where(*mine)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .limit(limit)
    )
    return NotificationsOut(
        unread=_unread(db, user).unread,
        entries=[
            NotificationOut(
                id=row.id,
                kind=row.kind,
                module=KINDS[row.kind].module,
                title=row.title,
                link=row.link,
                created_at=row.created_at,
                read=row.read_at is not None,
            )
            for row in rows
        ],
    )


def _unread(db: Session, user: CurrentUser) -> UnreadOut:
    count = db.scalar(
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.user_id == user.user_id,
            Notification.kind.in_(_allowed_kinds(user)),
            Notification.read_at.is_(None),
        )
    )
    return UnreadOut(unread=int(count or 0))


@router.post("/read-all")
def read_all(user: CurrentUserDep, db: DbDep) -> UnreadOut:
    """Alle Benachrichtigungen als gelesen markieren."""
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.user_id, Notification.read_at.is_(None))
        .values(read_at=now_utc())
    )
    db.commit()
    return _unread(db, user)


@router.post("/{notification_id}/read")
def read_one(notification_id: int, user: CurrentUserDep, db: DbDep) -> UnreadOut:
    """Eine Benachrichtigung als gelesen markieren."""
    row = db.get(Notification, notification_id)
    if row is None or row.user_id != user.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nicht gefunden")
    if row.read_at is None:
        row.read_at = now_utc()
        db.commit()
    return _unread(db, user)


def _channel_kinds(db: Session, user_id: uuid.UUID, channel: str) -> set[str]:
    return set(
        db.scalars(
            select(NotificationChannel.kind).where(
                NotificationChannel.user_id == user_id, NotificationChannel.channel == channel
            )
        )
    )


def _channels(db: Session, user: CurrentUser) -> ChannelsOut:
    smtp: Any = get_setting(db, SMTP_KEY)
    teams: Any = get_setting(db, TEAMS_KEY)
    push: Any = get_setting(db, PUSH_KEY)
    return ChannelsOut(
        push=isinstance(push, dict)
        and push.get("enabled") is True
        and bool(push.get("public_key")),
        mail=isinstance(smtp, dict) and bool(smtp.get("host")) and bool(smtp.get("sender_address")),
        teams=isinstance(teams, dict)
        and teams.get("enabled") is True
        and bool(teams.get("url_encrypted")),
        has_email=bool(user.email),
    )


@router.get("/settings")
def get_settings(user: CurrentUserDep, db: DbDep) -> SettingsOut:
    """Arten, die für die Person in Frage kommen, und auf welchen Wegen sie sie bekommt."""
    muted = set(
        db.scalars(select(NotificationMute.kind).where(NotificationMute.user_id == user.user_id))
    )
    mail = _channel_kinds(db, user.user_id, "mail")
    teams = _channel_kinds(db, user.user_id, "teams")
    push = _channel_kinds(db, user.user_id, "push")
    return SettingsOut(
        kinds=[
            KindOut(
                kind=kind,
                module=KINDS[kind].module,
                label=KINDS[kind].label,
                enabled=kind not in muted,
                mail=kind in mail,
                teams=kind in teams,
                push=kind in push,
            )
            for kind in _allowed_kinds(user)
        ],
        channels=_channels(db, user),
    )


def _save_channel(
    db: Session, user: CurrentUser, channel: str, wanted: set[str], allowed: set[str]
) -> None:
    current = _channel_kinds(db, user.user_id, channel)
    for kind in (current & allowed) - wanted:
        db.execute(
            delete(NotificationChannel).where(
                NotificationChannel.user_id == user.user_id,
                NotificationChannel.channel == channel,
                NotificationChannel.kind == kind,
            )
        )
    for kind in wanted - current:
        db.add(NotificationChannel(user_id=user.user_id, channel=channel, kind=kind))


@router.put("/settings")
def put_settings(body: SettingsIn, user: CurrentUserDep, db: DbDep) -> SettingsOut:
    """Speichert Glocke, Mail, Teams und Push je Art; nur Arten, die die Person sieht."""
    named = [*body.disabled, *(body.mail or []), *(body.teams or []), *(body.push or [])]
    if any(kind not in KINDS for kind in named):
        raise HTTPException(status_code=422, detail="Unbekannte Art einer Benachrichtigung")
    allowed = set(_allowed_kinds(user))
    wanted = {kind for kind in body.disabled if kind in allowed}
    current = set(
        db.scalars(select(NotificationMute.kind).where(NotificationMute.user_id == user.user_id))
    )
    for kind in (current & allowed) - wanted:
        db.execute(
            delete(NotificationMute).where(
                NotificationMute.user_id == user.user_id, NotificationMute.kind == kind
            )
        )
    for kind in wanted - current:
        db.add(NotificationMute(user_id=user.user_id, kind=kind))
    # Ohne Glocke gibt es auch keine Mail oder Teams-Nachricht: Die Art entsteht gar nicht.
    if body.mail is not None:
        _save_channel(db, user, "mail", {k for k in body.mail if k in allowed} - wanted, allowed)
    if body.teams is not None:
        _save_channel(db, user, "teams", {k for k in body.teams if k in allowed} - wanted, allowed)
    if body.push is not None:
        _save_channel(db, user, "push", {k for k in body.push if k in allowed} - wanted, allowed)
    db.commit()
    return get_settings(user, db)
