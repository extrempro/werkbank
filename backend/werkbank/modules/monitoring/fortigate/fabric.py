"""Fabric-Sync: Welche Objekte verteilt die Security Fabric, welche sind nur lokal?

Je Gerät die Rolle beim Objekt-Sync (Quelle, Sync an, nur lokal) und je Objektname der Zustand
über alle Geräte. Grundlage sind `fabric-object` am Objekt und `fabric-object-unification` in
den Fabric-Einstellungen (auf einem Gerät mit „local“ werden Objekte nicht übernommen).
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

ROLE_SOURCE = "Quelle"
ROLE_SYNC = "Sync an"
ROLE_LOCAL = "nur lokal"
ROLE_NONE = "ohne Fabric"

STATE_SYNCED = "synchronisiert"
STATE_DIFFERS = "abweichend"
STATE_LOCAL = "lokal"
STATE_LOCAL_MANY = "lokal_mehrfach"
STATE_LABELS = {
    STATE_SYNCED: "synchronisiert",
    STATE_DIFFERS: "Sync abweichend",
    STATE_LOCAL: "lokal",
    STATE_LOCAL_MANY: "lokal, gleicher Name auf mehreren Geräten",
}
SYNC_KINDS = ("addresses", "address_groups", "services", "service_groups")


def device_role(config: Mapping[str, Any]) -> str:
    fabric = config.get("fabric") or {}
    if fabric.get("status") != "enable":
        return ROLE_NONE
    if not fabric.get("upstream"):
        return ROLE_SOURCE
    if fabric.get("unification") == "local":
        return ROLE_LOCAL
    return ROLE_SYNC


@dataclass(frozen=True)
class Entry:
    """Ein Objekt gleichen Namens auf einem Gerät."""

    device: str
    value: str
    fabric: bool
    used: bool


@dataclass(frozen=True)
class SyncState:
    state: str
    label: str
    candidate: bool


def object_state(entries: Iterable[Entry], roles: Mapping[str, str]) -> SyncState:
    items = list(entries)
    shared = [e for e in items if e.fabric]
    if shared:
        sync_devices = {d for d, role in roles.items() if role in (ROLE_SOURCE, ROLE_SYNC)}
        present = {e.device for e in shared}
        values = {e.value for e in shared}
        if len(values) > 1 or (sync_devices - present):
            return SyncState(STATE_DIFFERS, STATE_LABELS[STATE_DIFFERS], False)
        total = len(sync_devices) or len(present)
        return SyncState(STATE_SYNCED, f"synchronisiert ({len(present)}/{total} Geräte)", False)
    if len(items) > 1:
        candidate = sum(1 for e in items if e.used) >= 2
        return SyncState(
            STATE_LOCAL_MANY, f"lokal, gleicher Name auf {len(items)} Geräten", candidate
        )
    return SyncState(STATE_LOCAL, STATE_LABELS[STATE_LOCAL], False)
