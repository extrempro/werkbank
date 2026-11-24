"""Gemeinsame Logik der Gerätezuordnung: Graph-Zugriff wählen, Status prüfen, aufräumen."""

import logging
from datetime import datetime, timedelta
from typing import Protocol

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.audit import write_audit
from werkbank.core.sessions import now_utc
from werkbank.modules.devices.graph import (
    AssociatedDevice,
    DeviceGraph,
    GraphError,
    ManagedDevice,
    Policy,
)
from werkbank.modules.devices.models import (
    OPEN_STATES,
    AssociationStatus,
    DeviceAdminSession,
    DeviceAssociation,
)

logger = logging.getLogger(__name__)

MODULE = "geraete"
OBJECT_TYPE = "geraet"
# Gerätedaten für die spätere Freigabe: so lange, danach gelöscht
PENDING_HOURS = 24
# Ohne Rückmeldung so lange prüfen, dann „Nicht abgeschlossen“
STALE_DAYS = 7
# Eine Registrierung zählt nur, wenn sie nach der Freigabe liegt (Uhren mit Puffer)
ENROLL_GRACE = timedelta(minutes=10)


class GraphApi(Protocol):
    def list_policies(self) -> list[Policy]: ...
    def find_by_serial(self, serial: str) -> list[AssociatedDevice]: ...
    def import_device(self, device_link: str, policy_id: str | None) -> AssociatedDevice: ...
    def get_device(self, device_id: str) -> AssociatedDevice: ...
    def confirm(self, device_id: str) -> AssociatedDevice: ...
    def managed_device(self, device_id: str) -> ManagedDevice | None: ...
    def managed_by_serial(self, serial: str) -> ManagedDevice | None: ...
    def organization(self) -> str: ...


# Ein gemeinsamer Client (threadsicher, hält die Verbindungen zu Graph offen)
_HTTP = httpx.Client(follow_redirects=False)


def delegated_graph(token: str) -> GraphApi:
    """Graph mit dem Token des Admin-Kontos."""
    return DeviceGraph(_HTTP, lambda: token)


def app_graph(settings: Settings) -> GraphApi | None:
    """Graph mit der Collector-App, nur lesend. None, wenn nicht eingerichtet oder ausgeschaltet."""
    if not (settings.collector_configured and settings.devices_monitor_enabled):
        return None
    from werkbank.modules.m365_config.utcm import graph_token_provider

    return DeviceGraph(_HTTP, graph_token_provider(settings))


def parse_graph_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.year >= 2000 and moment.tzinfo else None


def refresh_entry(entry: DeviceAssociation, graph: GraphApi, now: datetime | None = None) -> str:
    """Status von Microsoft holen (Stufe 1 Zuordnung, Stufe 2 Intune). Liefert den alten Status.

    Unbekannte Werte von associationState werden angezeigt, nicht als Fehler behandelt.
    """
    moment = now or now_utc()
    before = entry.status
    if entry.graph_id:
        try:
            device = graph.get_device(entry.graph_id)
            entry.association_state = device.association_state
            if device.managed_device_id:
                entry.managed_device_id = device.managed_device_id
        except GraphError as error:
            if error.status != 404:
                raise
            entry.association_state = "nicht gefunden"
        if entry.association_state == "associated" and entry.associated_at is None:
            entry.associated_at = moment
    managed = (
        graph.managed_device(entry.managed_device_id)
        if entry.managed_device_id
        else graph.managed_by_serial(entry.serial_number)
    )
    enrolled = parse_graph_time(managed.enrolled_at) if managed else None
    start = entry.approved_at or entry.scanned_at
    if managed is not None and enrolled is not None and enrolled >= start - ENROLL_GRACE:
        entry.managed_device_id = managed.id or entry.managed_device_id
        entry.device_name = managed.device_name
        entry.compliance = managed.compliance_state
        entry.user_principal_name = managed.user_principal_name
        entry.enrolled_at = enrolled
        entry.associated_at = entry.associated_at or enrolled
        entry.status = AssociationStatus.ENROLLED
    elif entry.association_state == "associated":
        entry.status = AssociationStatus.ASSOCIATED
    elif entry.association_state == "preassociated":
        entry.status = AssociationStatus.PREASSOCIATED
    entry.last_checked_at = moment
    return before


def expire_pending(db: Session, now: datetime | None = None) -> int:
    """Nicht freigegebene Geräte nach 24 Stunden samt Gerätedaten löschen."""
    moment = now or now_utc()
    rows = db.scalars(
        select(DeviceAssociation).where(
            DeviceAssociation.status == AssociationStatus.PENDING,
            DeviceAssociation.link_expires_at < moment,
        )
    ).all()
    for row in rows:
        write_audit(
            db,
            module=MODULE,
            action="geraet.verfallen",
            object_type=OBJECT_TYPE,
            object_id=row.serial_number,
            details={"hersteller": row.manufacturer, "modell": row.model},
        )
        db.delete(row)
    return len(rows)


def check_open(db: Session, graph: GraphApi | None, now: datetime | None = None) -> int:
    """Offene Einträge prüfen; nach 7 Tagen ohne Abschluss „Nicht abgeschlossen“."""
    moment = now or now_utc()
    checked = 0
    for row in db.scalars(
        select(DeviceAssociation).where(DeviceAssociation.status.in_(OPEN_STATES))
    ).all():
        if graph is not None:
            try:
                refresh_entry(row, graph, moment)
                checked += 1
            except GraphError as error:
                logger.warning("Status der Gerätezuordnung nicht lesbar: %s", error.status)
        start = row.approved_at or row.scanned_at
        if row.status in OPEN_STATES and start < moment - timedelta(days=STALE_DAYS):
            row.status = AssociationStatus.STALE
    return checked


def remove_expired_admin_tokens(db: Session, now: datetime | None = None) -> None:
    db.execute(delete(DeviceAdminSession).where(DeviceAdminSession.expires_at < (now or now_utc())))
