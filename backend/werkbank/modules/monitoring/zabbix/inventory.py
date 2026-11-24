"""Abgleich der Zabbix-Hosts mit dem IT-Bestand, nur über die Seriennummer.

- Nicht überwacht: aktives Gerät der festgelegten Hardware-Arten, das zu keinem Host passt und
  nicht als „bewusst nicht überwacht“ markiert ist
- Ohne Bestandseintrag: Host mit Seriennummer, die im Bestand (aktiv) nicht vorkommt
- Seriennummer fehlt: überwachter Host ohne Seriennummer im Inventar und ohne Zuordnung von Hand

Kein Abgleich über Hostnamen. Eine Zuordnung von Hand gilt nur, solange Zabbix keine
Seriennummer liefert.
"""

import re
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.modules.inventory.models import InventoryHardware
from werkbank.modules.monitoring.zabbix.config import load_options
from werkbank.modules.monitoring.zabbix.models import ZbxHost, ZbxHostLink, ZbxUnmonitored

MATCH_SERIAL = "seriennummer"
MATCH_MANUAL = "hand"
GAP_NO_INVENTORY = "ohne_bestand"
GAP_NO_SERIAL = "seriennummer_fehlt"

_SPACE = re.compile(r"\s+")


def norm_serial(value: str) -> str:
    """Ohne Leerzeichen, Groß- und Kleinschreibung egal."""
    return _SPACE.sub("", value or "").upper()


@dataclass
class Match:
    # Host-ID → (Geräte-ID, Art der Verknüpfung)
    linked: dict[str, tuple[int, str]] = field(default_factory=dict)
    # Host-ID → Lücke
    gaps: dict[str, str] = field(default_factory=dict)
    # Geräte, die überwacht sein sollten, es aber nicht sind
    unmonitored: list[int] = field(default_factory=list)
    # bewusst nicht überwacht (Geräte-ID → Begründung)
    excluded: dict[int, str] = field(default_factory=dict)


def match_inventory(db: Session) -> Match:
    options = load_options(db)
    devices = list(
        db.execute(
            select(InventoryHardware.id, InventoryHardware.serial, InventoryHardware.kind_id).where(
                InventoryHardware.status == "aktiv"
            )
        )
    )
    by_serial: dict[str, int] = {}
    for device_id, serial, _ in sorted(devices):
        key = norm_serial(serial)
        if key and key not in by_serial:
            by_serial[key] = device_id
    manual = {row.hostid: row.hardware_id for row in db.scalars(select(ZbxHostLink))}
    active_ids = {device_id for device_id, _, _ in devices}
    result = Match(
        excluded={row.hardware_id: row.reason for row in db.scalars(select(ZbxUnmonitored))}
    )
    for host in db.scalars(select(ZbxHost)):
        key = norm_serial(host.serial)
        if key:
            device = by_serial.get(key)
            if device is not None:
                result.linked[host.hostid] = (device, MATCH_SERIAL)
            else:
                result.gaps[host.hostid] = GAP_NO_INVENTORY
        elif host.hostid in manual and manual[host.hostid] in active_ids:
            result.linked[host.hostid] = (manual[host.hostid], MATCH_MANUAL)
        elif host.monitored:
            result.gaps[host.hostid] = GAP_NO_SERIAL
    covered = {device for device, _ in result.linked.values()}
    wanted = set(options.kind_ids)
    result.unmonitored = sorted(
        device_id
        for device_id, _, kind_id in devices
        if kind_id in wanted and device_id not in covered and device_id not in result.excluded
    )
    return result
