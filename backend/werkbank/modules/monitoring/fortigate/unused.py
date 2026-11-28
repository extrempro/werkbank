"""Unbenutzte Objekte: Was wird auf einem Gerät nirgends gebraucht?

Als genutzt zählt jeder Verweis: Firewall-, Local-in- und DoS-Policies, Gruppen, VIP-Gruppen,
IP-Pools in Policies, statische Routen, Policy-Routen, SD-WAN-Regeln und VPN-Selektoren.
Zwei Schalter machen die Prüfung strenger: Verweise nur aus deaktivierten Policies und nur aus
unbenutzten Gruppen zählen dann nicht. Nichts wird gelöscht; die Liste dient dem Aufräumen.
"""

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

# Arten, die auf „unbenutzt“ geprüft werden, mit Namensraum (Adressen und Dienste können
# gleich heißen, sind aber verschiedene Objekte)
UNUSED_KINDS: dict[str, str] = {
    "addresses": "addr",
    "address_groups": "addr",
    "vips": "addr",
    "services": "svc",
    "service_groups": "svc",
    "ippools": "pool",
}
GROUP_KINDS: dict[str, str] = {
    "address_groups": "addr",
    "vip_groups": "addr",
    "service_groups": "svc",
}

# Objekte, die FortiOS von Haus aus mitbringt. Annahme nach den Vorgaben von FortiOS 7.x; sie
# erscheinen nur, wenn „Standardobjekte ausblenden“ aus ist.
DEFAULT_ADDRESSES = frozenset(
    {
        "all",
        "none",
        "FIREWALL_AUTH_PORTAL_ADDRESS",
        "FABRIC_DEVICE",
        "SSLVPN_TUNNEL_ADDR1",
        "login.microsoft.com",
        "login.microsoftonline.com",
        "login.windows.net",
        "gmail.com",
        "wildcard.google.com",
        "wildcard.dropbox.com",
        "G Suite",
        "Microsoft Office 365",
        "EMS_ALL_UNKNOWN_CLIENTS",
        "EMS_ALL_UNMANAGEABLE_CLIENTS",
    }
)
DEFAULT_SERVICE_GROUPS = frozenset({"Email Access", "Web Access", "Windows AD", "Exchange Server"})
DEFAULT_SERVICE_CATEGORIES = frozenset(
    {
        "General",
        "Web Access",
        "File Access",
        "Email",
        "Network Services",
        "Authentication",
        "Remote Access",
        "Tunneling",
        "VoIP, Messaging & Other Applications",
        "Web Proxy",
    }
)


def is_default(kind: str, entry: dict[str, Any]) -> bool:
    name = str(entry.get("name") or "")
    if kind in ("addresses", "address_groups"):
        return name in DEFAULT_ADDRESSES
    if kind == "services":
        return name == "ALL" or entry.get("category") in DEFAULT_SERVICE_CATEGORIES
    if kind == "service_groups":
        return name in DEFAULT_SERVICE_GROUPS
    return False


@dataclass(frozen=True)
class Ref:
    """Ein Verweis auf ein Objekt."""

    source: str  # z. B. „Policy“, „Local-in“, „Route“, „Gruppe“
    label: str  # z. B. „#12 LAN ins Internet“
    active: bool = True
    group: str | None = None  # bei Gruppen: Name der Gruppe


@dataclass
class Refs:
    """Alle Verweise eines Geräts je (Namensraum, Name)."""

    by_name: dict[tuple[str, str], list[Ref]] = field(default_factory=dict)

    def add(self, space: str, names: Iterable[str], ref: Ref) -> None:
        for name in names:
            if name:
                self.by_name.setdefault((space, name), []).append(ref)

    def get(self, space: str, name: str) -> list[Ref]:
        return self.by_name.get((space, name), [])


def references(config: dict[str, Any]) -> Refs:
    refs = Refs()
    for policy in config.get("policies") or []:
        label = f"#{policy.get('id')} {policy.get('name') or ''}".strip()
        active = bool(policy.get("status", True))
        ref = Ref("Policy", label, active)
        refs.add("addr", (policy.get("srcaddr") or []) + (policy.get("dstaddr") or []), ref)
        refs.add("svc", policy.get("service") or [], ref)
        refs.add("pool", policy.get("poolname") or [], ref)
    for key, source in (("local_in", "Local-in-Policy"), ("dos", "DoS-Policy")):
        for policy in config.get(key) or []:
            ref = Ref(source, f"#{policy.get('id')}", bool(policy.get("status", True)))
            refs.add("addr", (policy.get("srcaddr") or []) + (policy.get("dstaddr") or []), ref)
            refs.add("svc", policy.get("service") or [], ref)
    for route in config.get("static_routes") or []:
        if route.get("dstaddr"):
            refs.add(
                "addr",
                [route["dstaddr"]],
                Ref("Statische Route", f"#{route.get('seq')}", bool(route.get("status", True))),
            )
    for route in config.get("policy_routes") or []:
        ref = Ref("Policy-Route", f"#{route.get('seq')}", bool(route.get("status", True)))
        refs.add("addr", (route.get("srcaddr") or []) + (route.get("dstaddr") or []), ref)
    for rule in config.get("sdwan_rules") or []:
        ref = Ref(
            "SD-WAN-Regel",
            str(rule.get("name") or f"#{rule.get('id')}"),
            bool(rule.get("status", True)),
        )
        refs.add("addr", (rule.get("srcaddr") or []) + (rule.get("dstaddr") or []), ref)
    for selector in config.get("vpn_selectors") or []:
        ref = Ref("VPN-Selektor", str(selector.get("name") or ""))
        refs.add("addr", (selector.get("srcaddr") or []) + (selector.get("dstaddr") or []), ref)
    for kind, space in GROUP_KINDS.items():
        for group in config.get(kind) or []:
            name = str(group.get("name") or "")
            ref = Ref("Gruppe", name, True, group=name)
            refs.add(space, (group.get("members") or []) + (group.get("exclude") or []), ref)
    return refs


@dataclass(frozen=True)
class Unused:
    kind: str
    name: str
    reason: str


def _direct(ref: Ref, disabled_is_unused: bool) -> bool:
    return ref.group is None and (ref.active or not disabled_is_unused)


def unused(
    config: dict[str, Any],
    *,
    disabled_is_unused: bool = True,
    unused_groups_count: bool = True,
) -> list[Unused]:
    """Unbenutzte Objekte eines Geräts mit kurzer Begründung."""
    refs = references(config)
    used: set[tuple[str, str]] = {
        key
        for key, items in refs.by_name.items()
        if any(_direct(r, disabled_is_unused) for r in items)
    }
    if unused_groups_count:
        # Mitgliedschaft zählt nur in genutzten Gruppen: so lange erweitern, bis nichts dazukommt
        changed = True
        while changed:
            changed = False
            for key, items in refs.by_name.items():
                if key in used:
                    continue
                if any(r.group and (key[0], r.group) in used for r in items):
                    used.add(key)
                    changed = True
    else:
        used |= {key for key, items in refs.by_name.items() if any(r.group for r in items)}
    out: list[Unused] = []
    for kind, space in UNUSED_KINDS.items():
        for entry in config.get(kind) or []:
            name = str(entry.get("name") or "")
            if not name or (space, name) in used:
                continue
            items = refs.get(space, name)
            if not items:
                reason = "keine Verwendung"
            elif all(r.group for r in items):
                reason = "nur in unbenutzten Gruppen: " + ", ".join(
                    sorted({r.label for r in items})
                )
            else:
                inactive = [r.label for r in items if r.group is None and not r.active]
                reason = (
                    "nur in deaktivierten Einträgen: " + ", ".join(inactive)
                    if inactive
                    else "keine Verwendung"
                )
            out.append(Unused(kind, name, reason))
    return out
