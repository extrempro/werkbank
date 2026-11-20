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
    InventoryKind,
    InventoryMaker,
    InventoryModel,
    InventoryMonitorIgnore,
    InventoryNinjaIgnore,
    InventorySyncRun,
    InventoryWorkplacePosition,
)
from werkbank.modules.inventory.monitors import MonitorLine, valid_field_name
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
CASE_MONITOR = "monitor"
CASE_PERSON = "person_inaktiv"
MONITOR_KIND = "Monitor"
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
    field = stored.get("monitor_field")
    client_id = stored.get("client_id")
    token = stored.get("secret_encrypted")
    secret = decrypt_secret(settings, token) if isinstance(token, str) and token else None
    if region not in REGIONS or not isinstance(client_id, str) or not client_id or not secret:
        return None
    return NinjaConfig(
        region=str(region),
        client_id=client_id,
        client_secret=secret,
        monitor_field=field if isinstance(field, str) and valid_field_name(field) else "",
    )


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
    monitors_added: int = 0


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


def kind_named(db: Session, name: str) -> InventoryKind | None:
    return db.scalars(
        select(InventoryKind).where(func.lower(InventoryKind.name) == name.casefold())
    ).first()


def model_for(db: Session, maker_name: str, model_name: str) -> InventoryModel | None:
    """Hersteller und Modell aus NinjaOne; fehlen sie in den Stammdaten, entstehen sie neu."""
    if not maker_name or not model_name:
        return None
    maker = db.scalars(
        select(InventoryMaker).where(func.lower(InventoryMaker.name) == maker_name.casefold())
    ).first()
    if maker is None:
        maker = InventoryMaker(name=maker_name[:80])
        db.add(maker)
        db.flush()
    model = db.scalars(
        select(InventoryModel).where(
            InventoryModel.maker_id == maker.id,
            func.lower(InventoryModel.name) == model_name.casefold(),
        )
    ).first()
    if model is None:
        model = InventoryModel(maker_id=maker.id, name=model_name[:120])
        db.add(model)
        db.flush()
    return model


def suggested_workplace(db: Session, host: InventoryHardware) -> int | None:
    """Arbeitsplatz des Rechners, sonst der erste Arbeitsplatz seiner Stelle."""
    if host.workplace_id is not None:
        return host.workplace_id
    if host.position_id is None:
        return None
    return db.scalars(
        select(InventoryWorkplacePosition.workplace_id)
        .where(InventoryWorkplacePosition.position_id == host.position_id)
        .order_by(InventoryWorkplacePosition.workplace_id)
        .limit(1)
    ).first()


def host_label(host: InventoryHardware) -> str:
    return host.hostname or host.name


def create_monitor(
    db: Session,
    facts: dict[str, Any],
    host: InventoryHardware | None,
    *,
    workplace_id: int | None = None,
    position_id: int | None = None,
) -> InventoryHardware:
    """Legt einen Monitor aus dem Custom Field an (ohne Verlauf; den schreibt der Aufrufer)."""
    kind = kind_named(db, MONITOR_KIND)
    if kind is None:
        raise LookupError(MONITOR_KIND)
    maker = facts.get("maker") if isinstance(facts.get("maker"), str) else ""
    model_name = facts.get("model") if isinstance(facts.get("model"), str) else ""
    serial = facts.get("serial") if isinstance(facts.get("serial"), str) else ""
    model = model_for(db, str(maker), str(model_name))
    row = InventoryHardware(
        kind_id=kind.id,
        model_id=model.id if model else None,
        name=(f"{maker} {model_name}".strip() or f"Monitor {serial}")[:160],
        serial=str(serial)[:80],
        hostname="",
        note="",
        inventory_no=None,
        workplace_id=workplace_id,
        position_id=position_id,
        source=SOURCE_NINJA,
        status=STATUS_ACTIVE,
        connected_to_id=host.id if host else None,
        ninja_facts={key: value for key, value in facts.items() if not key.endswith("_id")},
    )
    db.add(row)
    db.flush()
    return row


def _monitor_case(db: Session, serial: str) -> InventoryCase | None:
    return db.scalars(
        select(InventoryCase)
        .where(
            InventoryCase.kind == CASE_MONITOR,
            InventoryCase.status.in_(OPEN_STATES),
            func.lower(InventoryCase.facts["serial"].astext) == serial.casefold(),
        )
        .limit(1)
    ).first()


def apply_monitors(
    db: Session, host: InventoryHardware, lines: tuple[MonitorLine, ...]
) -> tuple[int, int]:
    """Monitore eines Rechners abgleichen; liefert (neu angelegt, neue Vorgänge).

    Bekannte Monitore (gleiche Seriennummer) bekommen nur die neuen Kenndaten und, wenn sie an
    einem anderen Rechner hängen, einen Eintrag im Verlauf; ihre Zuordnung bleibt. Neue Monitore
    an einem PC mit Arbeitsplatz kommen direkt an diesen Arbeitsplatz, alle anderen in einen
    Vorgang.
    """
    added = cases = 0
    host_kind = db.get(InventoryKind, host.kind_id)
    for line in lines:
        facts = {**line.facts(), "host": host_label(host)}
        monitor = db.scalars(
            select(InventoryHardware)
            .where(
                func.lower(InventoryHardware.serial) == line.serial.casefold(),
                InventoryHardware.id != host.id,
            )
            .limit(1)
        ).first()
        if monitor is not None:
            if monitor.connected_to_id != host.id:
                before = (
                    db.get(InventoryHardware, monitor.connected_to_id)
                    if monitor.connected_to_id
                    else None
                )
                _event(
                    db,
                    f"Angeschlossen an: {host_label(before) if before else 'unbekannt'} → "
                    f"{host_label(host)} (laut NinjaOne)",
                    hardware_id=monitor.id,
                )
                monitor.connected_to_id = host.id
            if monitor.ninja_facts != facts:
                monitor.ninja_facts = facts
            continue
        if db.get(InventoryMonitorIgnore, line.serial.casefold()[:80]) is not None:
            continue
        open_case = _monitor_case(db, line.serial)
        if open_case is not None:
            open_case.facts = {**open_case.facts, **facts}
            continue
        is_pc = host_kind is not None and host_kind.name.casefold() == "pc"
        if is_pc and host.workplace_id is not None and kind_named(db, MONITOR_KIND):
            row = create_monitor(db, facts, host, workplace_id=host.workplace_id)
            _event(
                db,
                f"Aus NinjaOne übernommen (Custom Field an {host_label(host)}), an den "
                "Arbeitsplatz des PCs",
                hardware_id=row.id,
            )
            added += 1
            continue
        _new_case(
            db,
            CASE_MONITOR,
            f"Neuer Monitor an {host_label(host)}",
            {
                **facts,
                "host_id": host.id,
                "suggest_workplace_id": suggested_workplace(db, host),
            },
            f"Im Custom Field von {host_label(host)} gefunden"
            + ("; Notebook, daher Arbeitsplatz bestätigen" if not is_pc else ""),
        )
        cases += 1
    return added, cases


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
            added, cases = apply_monitors(db, row, device.monitors)
            result.monitors_added += added
            result.new_cases += cases
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
        run.updated = result.updated + result.monitors_added
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
