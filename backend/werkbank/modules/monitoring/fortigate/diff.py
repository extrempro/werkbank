"""Unterschiede zwischen zwei Konfigurationsständen eines Geräts.

Je Bereich (Policies, Adressen, Routen …) werden Einträge über ihren Schlüssel (ID, Name oder
Sequenz) verglichen: neu, entfernt, geändert mit den geänderten Feldern. Bei Policies zählt
auch eine neue Position in der Reihenfolge als Änderung, denn sie ändert, welche zuerst greift.
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

# Bereich → (Bezeichnung, Schlüsselfeld, Pfad in der FortiOS-Konfiguration für „geändert von“)
SECTIONS: dict[str, tuple[str, str, str]] = {
    "policies": ("Policy", "id", "firewall.policy"),
    "addresses": ("Adresse", "name", "firewall.address"),
    "address_groups": ("Adressgruppe", "name", "firewall.addrgrp"),
    "services": ("Dienst", "name", "firewall.service.custom"),
    "service_groups": ("Dienstgruppe", "name", "firewall.service.group"),
    "vips": ("VIP", "name", "firewall.vip"),
    "vip_groups": ("VIP-Gruppe", "name", "firewall.vipgrp"),
    "ippools": ("IP-Pool", "name", "firewall.ippool"),
    "interfaces": ("Interface", "name", "system.interface"),
    "zones": ("Zone", "name", "system.zone"),
    "static_routes": ("Route", "seq", "router.static"),
    "policy_routes": ("Policy-Route", "seq", "router.policy"),
    "local_in": ("Local-in-Policy", "id", "firewall.local-in-policy"),
    "dos": ("DoS-Policy", "id", "firewall.DoS-policy"),
    "sdwan_rules": ("SD-WAN-Regel", "id", "system.sdwan"),
    "vpn_selectors": ("VPN-Selektor", "name", "vpn.ipsec.phase2-interface"),
    "vpn_tunnels": ("VPN-Tunnel", "name", "vpn.ipsec.phase1-interface"),
}
# Einzelne Einstellungen (kein Listeneintrag)
SINGLE: dict[str, tuple[str, str]] = {
    "fabric": ("Security Fabric", "system.csf"),
    "ha": ("HA", "system.ha"),
}
# Gruppen für den Filter „Art“
KIND_GROUPS: dict[str, tuple[str, ...]] = {
    "policy": ("policies", "local_in", "dos"),
    "adresse": ("addresses", "vips"),
    "gruppe": ("address_groups", "service_groups", "vip_groups"),
    "dienst": ("services",),
    "route": ("static_routes", "policy_routes", "sdwan_rules"),
    "sonstiges": ("ippools", "interfaces", "zones", "vpn_selectors", "vpn_tunnels", "fabric", "ha"),
}

FIELD_LABELS = {
    "name": "Name",
    "status": "Status",
    "srcintf": "Quell-Interface",
    "dstintf": "Ziel-Interface",
    "srcaddr": "Quelle",
    "dstaddr": "Ziel",
    "service": "Dienst",
    "action": "Aktion",
    "nat": "NAT",
    "poolname": "IP-Pool",
    "schedule": "Zeitplan",
    "log": "Log",
    "profiles": "Profile",
    "users": "Benutzer",
    "comments": "Kommentar",
    "comment": "Kommentar",
    "members": "Mitglieder",
    "value": "Wert",
    "position": "Position",
}
VALUE_MAX = 300
# Anzeige für „kein Wert“ (Gedankenstrich)
EMPTY = "\u2013"


@dataclass
class Change:
    section: str
    kind: str  # neu, entfernt, geändert
    key: str
    title: str
    fields: list[dict[str, str]] = field(default_factory=list)

    @property
    def label(self) -> str:
        return SECTIONS[self.section][0] if self.section in SECTIONS else SINGLE[self.section][0]

    @property
    def cfgpath(self) -> str:
        return SECTIONS[self.section][2] if self.section in SECTIONS else SINGLE[self.section][1]


def text(value: object) -> str:
    if value is None or value == "" or value == []:
        return EMPTY
    if isinstance(value, bool):
        return "an" if value else "aus"
    if isinstance(value, list):
        return ", ".join(str(item) for item in value)[:VALUE_MAX]
    if isinstance(value, dict):
        return ", ".join(f"{k}: {v}" for k, v in sorted(value.items()))[:VALUE_MAX]
    return str(value)[:VALUE_MAX]


def _title(section: str, entry: Mapping[str, Any], key: str) -> str:
    if section == "policies":
        name = str(entry.get("name") or "")
        return f"#{key}" + (f" {name}" if name else "")
    if section in ("static_routes", "policy_routes"):
        return f"#{key} {entry.get('dst') or text(entry.get('dstaddr'))}"
    return key


def _fields(old: Mapping[str, Any], new: Mapping[str, Any]) -> list[dict[str, str]]:
    out = []
    for name in sorted(set(old) | set(new)):
        if old.get(name) != new.get(name):
            out.append(
                {
                    "field": FIELD_LABELS.get(name, name),
                    "before": text(old.get(name)),
                    "after": text(new.get(name)),
                }
            )
    return out


def diff_configs(old: Mapping[str, Any], new: Mapping[str, Any]) -> list[Change]:
    changes: list[Change] = []
    for section, (_, key_field, _) in SECTIONS.items():
        before = {str(e.get(key_field)): e for e in old.get(section) or []}
        after = {str(e.get(key_field)): e for e in new.get(section) or []}
        if section not in old and section in new:
            # Bereich kam mit einer neuen Version der Werkbank dazu: keine Änderung am Gerät
            continue
        order_old = list(before)
        order_new = list(after)
        for key, entry in after.items():
            if key not in before:
                change = Change(section, "neu", key, _title(section, entry, key))
                change.fields = [
                    {"field": FIELD_LABELS.get(k, k), "before": EMPTY, "after": text(v)}
                    for k, v in sorted(entry.items())
                    if v not in (None, "", [], {}, False) and k != key_field
                ]
                changes.append(change)
                continue
            fields = _fields(before[key], entry)
            if section == "policies":
                common_old = [k for k in order_old if k in after]
                common_new = [k for k in order_new if k in before]
                if common_old.index(key) != common_new.index(key):
                    fields.append(
                        {
                            "field": "Position",
                            "before": str(order_old.index(key) + 1),
                            "after": str(order_new.index(key) + 1),
                        }
                    )
            if fields:
                changes.append(
                    Change(section, "geändert", key, _title(section, entry, key), fields)
                )
        for key, entry in before.items():
            if key not in after:
                change = Change(section, "entfernt", key, _title(section, entry, key))
                change.fields = [
                    {"field": FIELD_LABELS.get(k, k), "before": text(v), "after": EMPTY}
                    for k, v in sorted(entry.items())
                    if v not in (None, "", [], {}, False) and k != key_field
                ]
                changes.append(change)
    for section in SINGLE:
        if section not in old:
            continue
        fields = _fields(old.get(section) or {}, new.get(section) or {})
        if fields:
            changes.append(Change(section, "geändert", section, SINGLE[section][0], fields))
    return changes


def match_events(change: Change, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Ereignisse des FortiAnalyzers, die zu dieser Änderung passen (Pfad und Objekt)."""
    out = []
    for event in events:
        if str(event.get("cfgpath") or "") != change.cfgpath:
            continue
        obj = str(event.get("cfgobj") or "")
        if change.section in SINGLE or not obj or obj == change.key:
            out.append(event)
    return out
