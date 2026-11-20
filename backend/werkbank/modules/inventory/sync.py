"""Abgleich des IT-Bestands mit NinjaOne (alle 30 Minuten).

Ein Gerät aus NinjaOne gilt als bekannt, wenn seine NinjaOne-ID schon an einem Gerät steht.
Sonst wird es über die Seriennummer verknüpft (ohne Groß- und Kleinschreibung), aber nur mit
einem Gerät, das noch keine NinjaOne-ID hat. Der Hostname ist nur ein Hinweis: Er erscheint im
Vorgang als „möglicherweise dasselbe Gerät“, verknüpft wird darüber nie.

Vorgänge entstehen nur für neue Geräte (weder ID noch Seriennummer bekannt) und für Geräte, die
in NinjaOne fehlen. Taucht ein fehlendes Gerät wieder auf, schließt der Abgleich den Vorgang.

In der Verwaltung lassen sich Organisationen und Geräterollen auswählen. Die Auswahl legt nur fest,
welche neuen Geräte einen Vorgang bekommen. Verknüpfte Geräte gleicht die Werkbank weiter ab,
auch außerhalb der Auswahl; so entstehen bei einer geänderten Auswahl keine Vorgänge „fehlt“.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import NINJA_KEY, decrypt_secret, get_setting
from werkbank.core.sessions import now_utc
from werkbank.modules.inventory.api import STATUS_ACTIVE
from werkbank.modules.inventory.models import (
    InventoryCase,
    InventoryEvent,
    InventoryHardware,
    InventoryNinjaIgnore,
    InventorySyncRun,
)
from werkbank.modules.inventory.ninja import (
    REGIONS,
    Fetcher,
    NinjaConfig,
    NinjaDevice,
    NinjaError,
    fetch_devices,
)
from werkbank.modules.inventory.staff import next_number

logger = logging.getLogger(__name__)

NINJA_SYNC = "bestand.ninjaone"
NINJA_SYNC_INTERVAL = timedelta(minutes=30)
STATUS_OK = "ok"
STATUS_FAILED = "fehlgeschlagen"
CASE_NEW = "neu"
CASE_MISSING = "weg"
STATE_NEW = "neu"
STATE_WORK = "arbeit"
STATE_DONE = "fertig"
OPEN_STATES = (STATE_NEW, STATE_WORK)
SOURCE_NINJA = "ninja"
KEEP_RUNS_DAYS = 90
ERROR_MAX = 500


def load_ninja_config(
    db: Session, settings: Settings, *, require_enabled: bool = True
) -> NinjaConfig | None:
    """Einstellungen aus der Verwaltung; None, wenn ausgeschaltet oder unvollständig."""
    stored: Any = get_setting(db, NINJA_KEY)
    if not isinstance(stored, dict):
        return None
    if require_enabled and stored.get("enabled") is not True:
        return None
    region = stored.get("region")
    client_id = stored.get("client_id")
    token = stored.get("secret_encrypted")
    secret = decrypt_secret(settings, token) if isinstance(token, str) and token else None
    if region not in REGIONS or not isinstance(client_id, str) or not client_id or not secret:
        return None
    return NinjaConfig(region=str(region), client_id=client_id, client_secret=secret)


@dataclass(frozen=True)
class NinjaScope:
    """Auswahl aus der Verwaltung; leer heißt: alle."""

    organization_ids: frozenset[int] = frozenset()
    role_ids: frozenset[int] = frozenset()

    def includes(self, device: NinjaDevice) -> bool:
        if self.organization_ids and device.organization_id not in self.organization_ids:
            return False
        return not self.role_ids or device.role_id in self.role_ids


def _ids(value: Any) -> frozenset[int]:
    if not isinstance(value, list):
        return frozenset()
    return frozenset(item for item in value if isinstance(item, int) and not isinstance(item, bool))


def load_ninja_scope(db: Session) -> NinjaScope:
    stored: Any = get_setting(db, NINJA_KEY)
    if not isinstance(stored, dict):
        return NinjaScope()
    return NinjaScope(
        organization_ids=_ids(stored.get("organization_ids")),
        role_ids=_ids(stored.get("role_ids")),
    )


@dataclass
class SyncResult:
    devices: int = 0
    updated: int = 0
    new_cases: int = 0
    missing_cases: int = 0


def _event(
    db: Session, text: str, *, hardware_id: int | None = None, case_id: int | None = None
) -> None:
    db.add(
        InventoryEvent(
            hardware_id=hardware_id,
            case_id=case_id,
            user_id=None,
            occurred_at=now_utc(),
            text=text[:400],
        )
    )


def device_facts(device: NinjaDevice) -> dict[str, Any]:
    """Kenndaten für einen Vorgang „neu“; dazu die NinjaOne-ID."""
    return {"ninja_id": device.ninja_id, **device.facts()}


def _open_case(db: Session, kind: str, **where: int) -> InventoryCase | None:
    query = select(InventoryCase).where(
        InventoryCase.kind == kind, InventoryCase.status.in_(OPEN_STATES)
    )
    for column, value in where.items():
        query = query.where(getattr(InventoryCase, column) == value)
    return db.scalars(query.limit(1)).first()


def _new_case(
    db: Session,
    kind: str,
    title: str,
    facts: dict[str, Any],
    text: str,
    *,
    ninja_id: int | None = None,
    hardware_id: int | None = None,
    hint_hardware_id: int | None = None,
) -> InventoryCase:
    case = InventoryCase(
        number=next_number(db, "vorgang", InventoryCase),
        kind=kind,
        status=STATE_NEW,
        title=title[:200],
        ninja_id=ninja_id,
        hardware_id=hardware_id,
        hint_hardware_id=hint_hardware_id,
        facts=facts,
    )
    db.add(case)
    db.flush()
    _event(db, text, case_id=case.id)
    return case


def _apply(db: Session, row: InventoryHardware, device: NinjaDevice, now: datetime) -> bool:
    """Übernimmt Hostname und Kenndaten; True, wenn sich etwas geändert hat."""
    changed = False
    if device.hostname and row.hostname != device.hostname:
        _event(
            db,
            f"Hostname in NinjaOne geändert, übernommen: {row.hostname or 'leer'} → "
            f"{device.hostname}",
            hardware_id=row.id,
        )
        row.hostname = device.hostname
        changed = True
    if device.serial and not row.serial:
        _event(db, f"Seriennummer aus NinjaOne übernommen: {device.serial}", hardware_id=row.id)
        row.serial = device.serial
        changed = True
    facts = device.facts()
    if row.ninja_facts != facts:
        row.ninja_facts = facts
        changed = True
    row.ninja_seen_at = now
    row.ninja_missing_since = None
    return changed


def _hostname_hint(db: Session, hostname: str) -> InventoryHardware | None:
    """Gerät mit gleichem Hostname, das in NinjaOne fehlt oder gar nicht verknüpft ist."""
    if not hostname:
        return None
    return db.scalars(
        select(InventoryHardware)
        .where(func.lower(InventoryHardware.hostname) == hostname.casefold())
        .order_by(InventoryHardware.ninja_missing_since.desc().nulls_last(), InventoryHardware.id)
        .limit(1)
    ).first()


def apply_devices(
    db: Session, devices: list[NinjaDevice], now: datetime, scope: NinjaScope | None = None
) -> SyncResult:
    """Gleicht den Bestand mit der Liste aus NinjaOne ab (ohne Commit)."""
    result = SyncResult(devices=len(devices))
    seen: set[int] = set()
    ignored = set(db.scalars(select(InventoryNinjaIgnore.ninja_id)).all())
    for device in devices:
        seen.add(device.ninja_id)
        row = db.scalars(
            select(InventoryHardware).where(InventoryHardware.ninja_id == device.ninja_id)
        ).first()
        if row is None and device.serial:
            row = db.scalars(
                select(InventoryHardware)
                .where(
                    func.lower(InventoryHardware.serial) == device.serial.casefold(),
                    InventoryHardware.ninja_id.is_(None),
                )
                .limit(1)
            ).first()
            if row is not None:
                row.ninja_id = device.ninja_id
                _event(
                    db,
                    f"Mit NinjaOne verknüpft über die Seriennummer {device.serial}",
                    hardware_id=row.id,
                )
        if row is not None:
            if _apply(db, row, device, now):
                result.updated += 1
            missing = _open_case(db, CASE_MISSING, hardware_id=row.id)
            if missing is not None:
                missing.status = STATE_DONE
                missing.decision = "wieder_da"
                missing.closed_at = now
                _event(
                    db, "Gerät ist wieder in NinjaOne; Vorgang abgeschlossen", case_id=missing.id
                )
                _event(db, f"Wieder in NinjaOne (Vorgang {missing.number})", hardware_id=row.id)
            continue
        if device.ninja_id in ignored or (scope is not None and not scope.includes(device)):
            continue
        open_new = _open_case(db, CASE_NEW, ninja_id=device.ninja_id)
        if open_new is not None:
            # Kenndaten aktuell halten, damit die Entscheidung auf dem letzten Stand fußt
            open_new.facts = device_facts(device)
            continue
        hint = _hostname_hint(db, device.hostname)
        label = device.hostname or device.serial or f"ID {device.ninja_id}"
        _new_case(
            db,
            CASE_NEW,
            f"Neues Gerät in NinjaOne: {device.kind} {label}",
            device_facts(device),
            "Beim Abgleich mit NinjaOne gefunden"
            + (f"; gleicher Hostname wie „{hint.name}“" if hint else ""),
            ninja_id=device.ninja_id,
            hint_hardware_id=hint.id if hint else None,
        )
        result.new_cases += 1

    # Verknüpfte, aktive Geräte, die NinjaOne nicht mehr kennt
    for row in db.scalars(
        select(InventoryHardware).where(
            InventoryHardware.ninja_id.is_not(None),
            InventoryHardware.status == STATUS_ACTIVE,
        )
    ).all():
        if row.ninja_id in seen:
            continue
        if row.ninja_missing_since is None:
            row.ninja_missing_since = now
        if _open_case(db, CASE_MISSING, hardware_id=row.id) is not None:
            continue
        facts = {
            "ninja_id": row.ninja_id,
            "hostname": row.hostname,
            "serial": row.serial,
            "name": row.name,
            "last_seen": row.ninja_seen_at.isoformat() if row.ninja_seen_at else None,
        }
        _new_case(
            db,
            CASE_MISSING,
            f"Nicht mehr in NinjaOne: {row.hostname or row.name}",
            facts,
            "Beim Abgleich mit NinjaOne nicht mehr gefunden",
            ninja_id=row.ninja_id,
            hardware_id=row.id,
        )
        _event(db, "In NinjaOne nicht mehr gefunden", hardware_id=row.id)
        result.missing_cases += 1
    return result


def run_sync(
    db: Session, settings: Settings, fetch: Fetcher = fetch_devices
) -> InventorySyncRun | None:
    """Ein Lauf; None, wenn der Abgleich ausgeschaltet ist."""
    config = load_ninja_config(db, settings)
    if config is None:
        return None
    now = now_utc()
    run = InventorySyncRun(started_at=now, status=STATUS_OK)
    try:
        devices = fetch(config)
        linked = db.scalar(
            select(func.count())
            .select_from(InventoryHardware)
            .where(InventoryHardware.ninja_id.is_not(None))
        )
        if not devices and linked:
            # Eine leere Liste ist eher ein Fehler in NinjaOne als das Ende aller Geräte.
            raise NinjaError(
                "NinjaOne hat keine Geräte geliefert; der Abgleich hat nichts verändert."
            )
        result = apply_devices(db, devices, now, load_ninja_scope(db))
        run.devices = result.devices
        run.updated = result.updated
        run.new_cases = result.new_cases
        run.missing_cases = result.missing_cases
    except NinjaError as exc:
        db.rollback()
        run = InventorySyncRun(started_at=now, status=STATUS_FAILED, error=str(exc)[:ERROR_MAX])
        logger.warning("Abgleich mit NinjaOne fehlgeschlagen: %s", exc)
    run.finished_at = now_utc()
    db.add(run)
    db.execute(
        delete(InventorySyncRun).where(
            InventorySyncRun.started_at < now - timedelta(days=KEEP_RUNS_DAYS)
        )
    )
    db.commit()
    return run


def ninja_sync_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    run_sync(db, settings)
