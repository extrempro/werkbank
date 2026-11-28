"""Auswertung der gespeicherten Stände: Namen auflösen, IPs und Ports suchen, Verwendungen zählen.

Alles hier arbeitet nur auf den gespeicherten Daten (siehe normalize.py) und ist ohne Datenbank
testbar. Die Reihenfolge der Policies je Gerät ist die des Geräts; die erste passende greift.
"""

import ipaddress
import re
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from typing import Any

IPv4Net = ipaddress.IPv4Network
ANY_NET = ipaddress.IPv4Network("0.0.0.0/0")
OPEN_ADDRESSES = frozenset({"all", "any", "all_ipv6", "all6"})
OPEN_INTERFACES = frozenset({"any"})
OPEN_SERVICES = frozenset({"ALL"})
MAX_DEPTH = 16

# Arten der Objekte auf der Seite „Adressen & Dienste“
KINDS = ("addresses", "address_groups", "services", "service_groups", "vips")


# --- Adressen ------------------------------------------------------------------------------


def ip_networks(entry: dict[str, Any]) -> list[IPv4Net] | None:
    """IPv4-Netze eines Adressobjekts; None, wenn es keine feste Adresse hat (FQDN, Land …)."""
    kind = entry.get("type")
    value = str(entry.get("value") or "")
    if kind in ("ipmask", "interface-subnet"):
        try:
            return [ipaddress.IPv4Network(value, strict=False)]
        except ValueError:
            return None
    if kind == "iprange" and "-" in value:
        start, _, end = value.partition("-")
        try:
            return list(
                ipaddress.summarize_address_range(
                    ipaddress.IPv4Address(start.strip()), ipaddress.IPv4Address(end.strip())
                )
            )
        except ValueError:
            return None
    return None


def vip_networks(entry: dict[str, Any]) -> list[IPv4Net]:
    """Externe Adresse einer VIP (ein Wert oder ein Bereich „a-b“)."""
    value = str(entry.get("extip") or "")
    try:
        if "-" in value:
            start, _, end = value.partition("-")
            return list(
                ipaddress.summarize_address_range(
                    ipaddress.IPv4Address(start.strip()), ipaddress.IPv4Address(end.strip())
                )
            )
        return [ipaddress.IPv4Network(value, strict=False)] if value else []
    except ValueError:
        return []


def mapped_networks(entry: dict[str, Any]) -> list[IPv4Net]:
    out: list[IPv4Net] = []
    for value in entry.get("mapped") or []:
        out.extend(vip_networks({"extip": value}))
    return out


# --- Dienste -------------------------------------------------------------------------------

PortRange = tuple[str, int, int]


def port_ranges(entry: dict[str, Any]) -> list[PortRange] | None:
    """Zielports eines Dienstes als (Protokoll, von, bis); None: alle (z. B. Dienst „ALL“)."""
    protocol = str(entry.get("protocol") or "")
    if entry.get("name") in OPEN_SERVICES or (
        protocol == "IP" and entry.get("protocol_number") in (0, None)
    ):
        return None
    out: list[PortRange] = []
    for proto in ("tcp", "udp", "sctp"):
        for part in str(entry.get(proto) or "").split():
            # „80“, „8000-8080“, „443:1024-65535“ (Ziel:Quelle)
            target = part.split(":", 1)[0]
            low, _, high = target.partition("-")
            try:
                start = int(low)
                end = int(high) if high else start
            except ValueError:
                continue
            out.append((proto, min(start, end), max(start, end)))
    return out


def service_text(entry: dict[str, Any]) -> str:
    parts = []
    for proto in ("tcp", "udp", "sctp"):
        if entry.get(proto):
            parts.append(f"{proto.upper()} {entry[proto]}")
    if not parts:
        protocol = str(entry.get("protocol") or "")
        if entry.get("name") in OPEN_SERVICES:
            return "alle Dienste"
        if protocol == "IP" and entry.get("protocol_number"):
            return f"IP-Protokoll {entry['protocol_number']}"
        return protocol or "-"
    return " · ".join(parts)


# --- Auflösen je Gerät ---------------------------------------------------------------------


@dataclass
class Resolver:
    """Namen eines Geräts auflösen: Adressen, Gruppen, VIPs, Dienste."""

    config: dict[str, Any]
    addresses: dict[str, dict[str, Any]] = field(init=False)
    address_groups: dict[str, dict[str, Any]] = field(init=False)
    vips: dict[str, dict[str, Any]] = field(init=False)
    vip_groups: dict[str, dict[str, Any]] = field(init=False)
    services: dict[str, dict[str, Any]] = field(init=False)
    service_groups: dict[str, dict[str, Any]] = field(init=False)

    def __post_init__(self) -> None:
        def index(key: str) -> dict[str, dict[str, Any]]:
            return {item["name"]: item for item in self.config.get(key) or [] if item.get("name")}

        self.addresses = index("addresses")
        self.address_groups = index("address_groups")
        self.vips = index("vips")
        self.vip_groups = index("vip_groups")
        self.services = index("services")
        self.service_groups = index("service_groups")

    # Adressen
    def networks(self, name: str, depth: int = 0) -> list[IPv4Net] | None:
        """Alle IPv4-Netze hinter einem Namen; None, wenn etwas ohne feste Adresse dabei ist."""
        if depth > MAX_DEPTH:
            return []
        if name in self.addresses:
            return ip_networks(self.addresses[name])
        if name in self.vips:
            return vip_networks(self.vips[name])
        group = self.address_groups.get(name) or self.vip_groups.get(name)
        if group is None:
            return None
        out: list[IPv4Net] = []
        unknown = False
        for member in group.get("members") or []:
            nets = self.networks(member, depth + 1)
            if nets is None:
                unknown = True
            else:
                out.extend(nets)
        return None if unknown and not out else out

    def contains_ip(self, name: str, ip: ipaddress.IPv4Address, depth: int = 0) -> bool:
        """Liegt die IP in diesem Objekt? „all“ (0.0.0.0/0) zählt nicht, sonst passt alles."""
        if depth > MAX_DEPTH or name in OPEN_ADDRESSES:
            return False
        if name in self.addresses:
            nets = ip_networks(self.addresses[name]) or []
            return any(ip in net for net in nets if net != ANY_NET)
        if name in self.vips:
            entry = self.vips[name]
            return any(ip in net for net in vip_networks(entry) + mapped_networks(entry))
        group = self.address_groups.get(name) or self.vip_groups.get(name)
        if group is None:
            return False
        if any(self.contains_ip(member, ip, depth + 1) for member in group.get("exclude") or []):
            return False
        return any(self.contains_ip(member, ip, depth + 1) for member in group.get("members") or [])

    def is_open_address(self, name: str) -> bool:
        if name in OPEN_ADDRESSES:
            return True
        entry = self.addresses.get(name)
        return entry is not None and ip_networks(entry) == [ANY_NET]

    # Dienste
    def ports(self, name: str, depth: int = 0) -> list[PortRange] | None:
        if depth > MAX_DEPTH:
            return []
        if name in self.services:
            return port_ranges(self.services[name])
        group = self.service_groups.get(name)
        if group is None:
            return []
        out: list[PortRange] = []
        for member in group.get("members") or []:
            ranges = self.ports(member, depth + 1)
            if ranges is None:
                return None
            out.extend(ranges)
        return out

    def contains_port(self, name: str, port: int, proto: str | None) -> bool:
        """Deckt der Dienst den Port ab? „ALL“ zählt nicht, sonst passt alles."""
        if name in OPEN_SERVICES:
            return False
        ranges = self.ports(name)
        if ranges is None:
            return False
        return any(low <= port <= high and (proto is None or proto == p) for p, low, high in ranges)

    def is_open_service(self, name: str) -> bool:
        return name in OPEN_SERVICES or (name in self.services and self.ports(name) is None)

    def is_vip(self, name: str) -> bool:
        return name in self.vips or name in self.vip_groups


# --- Suche ---------------------------------------------------------------------------------

PORT_PATTERN = re.compile(r"^(?:(tcp|udp|sctp)\s*[/:]\s*)?(\d{1,5})$", re.IGNORECASE)
ID_PATTERN = re.compile(r"^#(\d{1,6})$")


@dataclass(frozen=True)
class Query:
    text: str
    ip: ipaddress.IPv4Address | None = None
    port: int | None = None
    proto: str | None = None
    policy_id: int | None = None

    @property
    def empty(self) -> bool:
        return not self.text


def parse_query(raw: str) -> Query:
    text = raw.strip()[:200]
    if not text:
        return Query("")
    try:
        return Query(text, ip=ipaddress.IPv4Address(text))
    except ValueError:
        pass
    match = ID_PATTERN.match(text)
    if match:
        return Query(text, policy_id=int(match.group(1)))
    match = PORT_PATTERN.match(text)
    if match and int(match.group(2)) <= 65535:
        port = int(match.group(2))
        proto = match.group(1).lower() if match.group(1) else None
        # Eine reine Zahl kann auch eine Policy-ID sein
        return Query(text, port=port, proto=proto, policy_id=None if proto else port)
    return Query(text)


# --- Policies ------------------------------------------------------------------------------


def nat_label(policy: dict[str, Any], resolver: Resolver) -> str:
    if any(resolver.is_vip(name) for name in policy.get("dstaddr") or []):
        return "VIP"
    if policy.get("nat"):
        return "SNAT (Pool)" if policy.get("poolname") else "SNAT"
    return ""


def policy_rows(
    device: str, config: dict[str, Any], runtime: dict[str, Any]
) -> Iterator[dict[str, Any]]:
    """Policies eines Geräts in seiner Reihenfolge, mit Markierungen und Treffern."""
    resolver = Resolver(config)
    hits = runtime.get("hits") or {}
    for position, policy in enumerate(config.get("policies") or [], start=1):
        counter = hits.get(str(policy.get("id"))) or {}
        srcaddr = policy.get("srcaddr") or []
        dstaddr = policy.get("dstaddr") or []
        service = policy.get("service") or []
        yield {
            "device": device,
            "id": policy.get("id"),
            "position": position,
            "name": policy.get("name") or "",
            "status": bool(policy.get("status", True)),
            "srcintf": policy.get("srcintf") or [],
            "dstintf": policy.get("dstintf") or [],
            "srcaddr": srcaddr,
            "dstaddr": dstaddr,
            "srcaddr_negate": bool(policy.get("srcaddr_negate")),
            "dstaddr_negate": bool(policy.get("dstaddr_negate")),
            "internet_service": policy.get("internet_service") or [],
            "service": service,
            "service_negate": bool(policy.get("service_negate")),
            "action": policy.get("action") or "deny",
            "nat": nat_label(policy, resolver),
            "poolname": policy.get("poolname") or [],
            "schedule": policy.get("schedule") or "",
            "log": policy.get("log") or "",
            "profiles": policy.get("profiles") or {},
            "users": policy.get("users") or [],
            "comments": policy.get("comments") or "",
            "hits": counter.get("hits"),
            "last_used": counter.get("last_used"),
            "first_used": counter.get("first_used"),
            "bytes": counter.get("bytes"),
            "open": {
                "srcintf": any(n in OPEN_INTERFACES for n in policy.get("srcintf") or []),
                "dstintf": any(n in OPEN_INTERFACES for n in policy.get("dstintf") or []),
                "srcaddr": any(resolver.is_open_address(n) for n in srcaddr),
                "dstaddr": any(resolver.is_open_address(n) for n in dstaddr)
                and not policy.get("internet_service"),
                "service": any(resolver.is_open_service(n) for n in service),
            },
        }


def policy_matches(row: dict[str, Any], query: Query, resolver: Resolver) -> str | None:
    """Warum die Policy zur Suche passt (kurzer Text), oder None."""
    if query.empty:
        return ""
    if query.policy_id is not None and row["id"] == query.policy_id:
        return f"Policy-ID {query.policy_id}"
    if query.ip is not None:
        reasons = []
        if any(resolver.contains_ip(name, query.ip) for name in row["srcaddr"]):
            reasons.append("Quelle")
        if any(resolver.contains_ip(name, query.ip) for name in row["dstaddr"]):
            reasons.append("Ziel")
        return f"{query.ip} in {' und '.join(reasons)}" if reasons else None
    if query.port is not None:
        if any(resolver.contains_port(name, query.port, query.proto) for name in row["service"]):
            label = f"{query.proto.upper()}/{query.port}" if query.proto else f"Port {query.port}"
            return f"{label} im Dienst"
        if query.policy_id is None:
            return None
    needle = query.text.lower()
    fields: Iterable[str] = [
        row["name"],
        row["comments"],
        *row["srcintf"],
        *row["dstintf"],
        *row["srcaddr"],
        *row["dstaddr"],
        *row["service"],
        *row["internet_service"],
    ]
    return "Text" if any(needle in value.lower() for value in fields) else None


def interface_pair(row: dict[str, Any]) -> str:
    return f"{', '.join(row['srcintf']) or '-'} → {', '.join(row['dstintf']) or '-'}"


# --- Verwendungen und Objekte --------------------------------------------------------------


@dataclass
class Usage:
    """Wo ein Objekt auf einem Gerät steht: direkt in Policies und in Gruppen."""

    policies: list[tuple[int, str, str]] = field(default_factory=list)  # (ID, Name, Feld)
    groups: list[str] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.policies) + len(self.groups)


def usages(config: dict[str, Any]) -> dict[str, Usage]:
    """Direkte Verweise je Objektname auf einem Gerät (Policies, Gruppen, IP-Pools in Policies)."""
    result: dict[str, Usage] = {}

    def add_policy(name: str, policy: dict[str, Any], field_name: str) -> None:
        entry = result.setdefault(name, Usage())
        item = (int(policy.get("id") or 0), str(policy.get("name") or ""), field_name)
        if item not in entry.policies:
            entry.policies.append(item)

    for policy in config.get("policies") or []:
        for name in policy.get("srcaddr") or []:
            add_policy(name, policy, "Quelle")
        for name in policy.get("dstaddr") or []:
            add_policy(name, policy, "Ziel")
        for name in policy.get("service") or []:
            add_policy(name, policy, "Dienst")
        for name in policy.get("poolname") or []:
            add_policy(name, policy, "IP-Pool")
    for key in ("address_groups", "service_groups", "vip_groups"):
        for group in config.get(key) or []:
            for name in (group.get("members") or []) + (group.get("exclude") or []):
                entry = result.setdefault(name, Usage())
                if group["name"] not in entry.groups:
                    entry.groups.append(group["name"])
    return result


def policies_using(
    name: str, config: dict[str, Any], uses: dict[str, Usage], depth: int = 0
) -> list[tuple[int, str, str, bool]]:
    """Policies, die das Objekt nutzen, direkt oder über Gruppen: (ID, Name, Feld, über Gruppe)."""
    if depth > MAX_DEPTH:
        return []
    usage = uses.get(name)
    if usage is None:
        return []
    out = [(pid, pname, fname, depth > 0) for pid, pname, fname in usage.policies]
    for group in usage.groups:
        for item in policies_using(group, config, uses, depth + 1):
            if not any(existing[0] == item[0] for existing in out):
                out.append((item[0], item[1], item[2], True))
    return out


def object_value(kind: str, entry: dict[str, Any]) -> str:
    if kind == "addresses":
        return str(entry.get("value") or "") or str(entry.get("type") or "")
    if kind in ("address_groups", "service_groups"):
        count = len(entry.get("members") or [])
        return "1 Mitglied" if count == 1 else f"{count} Mitglieder"
    if kind == "services":
        return service_text(entry)
    if kind == "vips":
        mapped = ", ".join(entry.get("mapped") or [])
        port = (
            f" ({entry.get('extport')} → {entry.get('mappedport')})"
            if entry.get("portforward")
            else ""
        )
        return f"{entry.get('extip') or '-'} → {mapped or '-'}{port}"
    return ""


def object_matches(
    kind: str, entry: dict[str, Any], query: Query, resolver: Resolver
) -> str | None:
    if query.empty:
        return ""
    name = str(entry.get("name") or "")
    if query.ip is not None and kind in ("addresses", "address_groups", "vips"):
        if not resolver.contains_ip(name, query.ip):
            return None
        nets = resolver.networks(name) or []
        exact = any(net.num_addresses == 1 and query.ip in net for net in nets)
        return f"ist {query.ip}" if exact and kind == "addresses" else f"enthält {query.ip}"
    if query.port is not None and kind in ("services", "service_groups"):
        if resolver.contains_port(name, query.port, query.proto):
            return f"enthält Port {query.port}"
        return None
    needle = query.text.lower()
    fields = [name, object_value(kind, entry), str(entry.get("comment") or "")]
    if kind in ("address_groups", "service_groups"):
        fields.extend(entry.get("members") or [])
    return "Text" if any(needle in value.lower() for value in fields) else None
