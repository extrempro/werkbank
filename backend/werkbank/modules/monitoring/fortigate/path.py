"""Pfad-Analyse: Welche FortiGates passiert eine Verbindung, und welche Policy greift jeweils?

Berechnet nur aus den gespeicherten Ständen, es wird kein Datenverkehr erzeugt. Je Gerät:
VIP (Ziel-NAT), Route (Policy-Routen, dann Routingtabelle des Geräts oder statische und
verbundene Routen, längstes Präfix, kleinste Distanz), erste passende Policy, Quell-NAT und
Profile. Das nächste Gerät ist das, dem die Gateway-Adresse gehört, oder bei IPsec das Gerät
am anderen Ende des Tunnels.

Grenzen (stehen auch in der Oberfläche): Internet-Dienste (ISDB), Benutzer und Gruppen,
Zeitpläne und die SD-WAN-Auswahl nach Leitungsqualität werden nicht ausgewertet.
"""

import ipaddress
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from werkbank.modules.monitoring.fortigate.analysis import (
    OPEN_ADDRESSES,
    OPEN_INTERFACES,
    IPv4Net,
    Resolver,
    mapped_networks,
    port_ranges,
    vip_networks,
)
from werkbank.modules.monitoring.fortigate.findings import wan_names

IPv4 = ipaddress.IPv4Address
MAX_HOPS = 8
# So viele übersprungene Policies davor nennt die Analyse („warum nicht diese?“)
SKIPPED_MAX = 3
PROTOCOLS = {"tcp": 6, "udp": 17, "icmp": 1}
# Stellvertreter für „irgendwo im Internet“ (Dokumentationsnetz, RFC 5737)
INTERNET_PROBE = IPv4("203.0.113.10")

LIMITS = (
    "Internet-Dienste (ISDB), Regeln nach Benutzer oder Gruppe, Zeitpläne und die SD-WAN-Auswahl "
    "nach Leitungsqualität wertet die Berechnung nicht aus. Grundlage ist der letzte Abruf."
)


@dataclass(frozen=True)
class Device:
    name: str
    config: Mapping[str, Any]
    runtime: Mapping[str, Any]


@dataclass(frozen=True)
class Flow:
    src: IPv4
    dst: IPv4
    proto: str  # tcp, udp, icmp
    port: int | None


@dataclass
class Route:
    network: IPv4Net
    interface: str
    gateway: str
    kind: str
    distance: int | None
    blackhole: bool = False

    @property
    def text(self) -> str:
        via = f"über {self.interface}" + (f" (Gateway {self.gateway})" if self.gateway else "")
        kind = {
            "connect": "verbunden",
            "static": "statisch",
            "ospf": "OSPF",
            "bgp": "BGP",
            "policy": "Policy-Route",
        }.get(self.kind, self.kind or "Route")
        distance = f", Distanz {self.distance}" if self.distance is not None else ""
        return f"{self.network} {via} ({kind}{distance})"


@dataclass
class Hop:
    device: str
    ingress: str
    src: str
    dst: str
    dnat: str = ""
    route: str = ""
    egress: str = ""
    policy: dict[str, Any] | None = None
    why: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    snat: str = ""
    profiles: dict[str, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)
    outcome: str = ""
    check: dict[str, Any] | None = None


@dataclass
class Result:
    hops: list[Hop]
    verdict: str
    allowed: bool
    error: str = ""


# --- Hilfen je Gerät -----------------------------------------------------------------------


def interface_nets(config: Mapping[str, Any]) -> list[tuple[str, IPv4, IPv4Net]]:
    """(Interface, eigene Adresse, Netz) aller Interfaces mit Adresse."""
    out = []
    for item in config.get("interfaces") or []:
        value = str(item.get("ip") or "")
        if not value:
            continue
        try:
            iface = ipaddress.IPv4Interface(value)
        except ValueError:
            continue
        out.append((str(item.get("name")), iface.ip, iface.network))
    return out


def zone_of(config: Mapping[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for zone in config.get("zones") or []:
        for member in zone.get("interfaces") or []:
            out[str(member)] = str(zone.get("name"))
    for name, members in (config.get("sdwan_zones") or {}).items():
        for member in members or []:
            out.setdefault(str(member), str(name))
    return out


def tunnel_names(config: Mapping[str, Any]) -> set[str]:
    names = {str(t.get("name")) for t in config.get("vpn_tunnels") or []}
    names |= {
        str(i.get("name")) for i in config.get("interfaces") or [] if i.get("type") == "tunnel"
    }
    return names


def _names_match(resolver: Resolver, names: Sequence[str], ip: IPv4) -> bool:
    for name in names:
        if name in OPEN_ADDRESSES or resolver.is_open_address(name):
            return True
        if resolver.contains_ip(name, ip):
            return True
    return False


def addr_match(resolver: Resolver, names: Sequence[str], ip: IPv4, negate: bool) -> bool:
    found = _names_match(resolver, names, ip)
    return not found if negate else found


def svc_match(resolver: Resolver, names: Sequence[str], flow: Flow, negate: bool) -> bool:
    def one(name: str, depth: int = 0) -> bool:
        if depth > 16:
            return False
        if resolver.is_open_service(name):
            return True
        if name in resolver.service_groups:
            return any(
                one(member, depth + 1)
                for member in resolver.service_groups[name].get("members") or []
            )
        entry = resolver.services.get(name)
        if entry is None:
            return False
        if flow.proto == "icmp":
            return str(entry.get("protocol") or "").upper() in ("ICMP", "ALL_ICMP")
        ranges = port_ranges(entry) or []
        return flow.port is not None and any(
            proto == flow.proto and low <= flow.port <= high for proto, low, high in ranges
        )

    found = any(one(name) for name in names)
    return not found if negate else found


def intf_match(names: Sequence[str], interface: str, zones: Mapping[str, str]) -> bool:
    return any(
        name in OPEN_INTERFACES or name == interface or name == zones.get(interface)
        for name in names
    )


def ingress_for(device: Device, ip: IPv4) -> str | None:
    """Interface, über das eine Adresse hereinkommt: verbundenes Netz, sonst die Route zu ihr."""
    best: tuple[int, str] | None = None
    for name, _, network in interface_nets(device.config):
        if ip in network and (best is None or network.prefixlen > best[0]):
            best = (network.prefixlen, name)
    if best is not None:
        return best[1]
    route = lookup_route(device, ip, ip, "")
    return route.interface if route is not None else None


def lookup_route(device: Device, dst: IPv4, src: IPv4, ingress: str) -> Route | None:
    config = device.config
    resolver = Resolver(dict(config))
    for item in config.get("policy_routes") or []:
        if item.get("status") is False:
            continue
        inputs = item.get("input") or []
        if inputs and ingress not in inputs:
            continue
        if item.get("srcaddr") and not _names_match(resolver, item["srcaddr"], src):
            continue
        if item.get("dstaddr") and not _names_match(resolver, item["dstaddr"], dst):
            continue
        if item.get("output"):
            return Route(
                ipaddress.IPv4Network("0.0.0.0/0"),
                str(item["output"]),
                str(item.get("gateway") or ""),
                "policy",
                None,
            )
    candidates: list[Route] = []
    table = device.runtime.get("routes") or []
    if table:
        for row in table:
            network = ipaddress.IPv4Network(row["dst"])
            if dst in network:
                candidates.append(
                    Route(
                        network,
                        str(row.get("interface") or ""),
                        str(row.get("gateway") or ""),
                        str(row.get("type") or ""),
                        row.get("distance"),
                    )
                )
    else:
        for name, _, network in interface_nets(config):
            if dst in network:
                candidates.append(Route(network, name, "", "connect", 0))
        for item in config.get("static_routes") or []:
            if item.get("status") is False:
                continue
            networks: list[IPv4Net] = []
            if item.get("dstaddr"):
                networks = resolver.networks(str(item["dstaddr"])) or []
            else:
                try:
                    networks = [ipaddress.IPv4Network(str(item.get("dst") or "0.0.0.0/0"))]
                except ValueError:
                    networks = []
            for network in networks:
                if dst in network:
                    candidates.append(
                        Route(
                            network,
                            str(item.get("device") or ""),
                            str(item.get("gateway") or ""),
                            "static",
                            item.get("distance") if item.get("distance") is not None else 10,
                            bool(item.get("blackhole")),
                        )
                    )
    if not candidates:
        return None
    candidates.sort(key=lambda r: (-r.network.prefixlen, r.distance or 0))
    return candidates[0]


def apply_vip(device: Device, flow: Flow, ingress: str) -> tuple[Flow, str]:
    """Ziel-NAT über eine VIP, die zur Zieladresse (und ggf. zum Port) passt."""
    for vip in device.config.get("vips") or []:
        extintf = str(vip.get("extintf") or "any")
        if extintf not in ("any", ingress):
            continue
        if not any(flow.dst in net for net in vip_networks(vip)):
            continue
        port = flow.port
        if vip.get("portforward"):
            proto = str(vip.get("protocol") or "tcp")
            low, _, high = str(vip.get("extport") or "").partition("-")
            try:
                start, end = int(low), int(high or low)
            except ValueError:
                continue
            if flow.proto != proto or flow.port is None or not start <= flow.port <= end:
                continue
            mapped_low = str(vip.get("mappedport") or "").partition("-")[0]
            if mapped_low.isdigit():
                port = int(mapped_low) + (flow.port - start)
        mapped = mapped_networks(vip)
        if not mapped:
            continue
        new_dst = mapped[0].network_address
        text = f"VIP „{vip.get('name')}“: Ziel {flow.dst} → {new_dst}"
        if port != flow.port:
            text += f", Port {flow.port} → {port}"
        return Flow(flow.src, new_dst, flow.proto, port), text
    return flow, ""


def first_policy(
    device: Device, flow: Flow, original_dst: IPv4, ingress: str, egress: str
) -> tuple[dict[str, Any] | None, list[str], list[str], list[str]]:
    """Erste passende Policy: (Policy, warum, übersprungene davor, Hinweise)."""
    config = device.config
    resolver = Resolver(dict(config))
    zones = zone_of(config)
    skipped: list[str] = []
    notes: list[str] = []
    for policy in config.get("policies") or []:
        if policy.get("status", True) is not True:
            continue
        if not intf_match(policy.get("srcintf") or [], ingress, zones):
            continue
        if not intf_match(policy.get("dstintf") or [], egress, zones):
            continue
        label = f"#{policy.get('id')}"
        if policy.get("users"):
            notes.append(f"{label} gilt nur für angemeldete Benutzer und wird nicht ausgewertet.")
            continue
        if policy.get("internet_service"):
            notes.append(f"{label} nutzt Internet-Dienste und wird nicht ausgewertet.")
            continue
        src_ok = addr_match(
            resolver, policy.get("srcaddr") or [], flow.src, bool(policy.get("srcaddr_negate"))
        )
        dst_names = policy.get("dstaddr") or []
        # Eine VIP in der Policy passt zur ursprünglichen Zieladresse
        dst_ok = addr_match(
            resolver, dst_names, flow.dst, bool(policy.get("dstaddr_negate"))
        ) or any(
            resolver.is_vip(name) and resolver.contains_ip(name, original_dst) for name in dst_names
        )
        svc_ok = svc_match(
            resolver, policy.get("service") or [], flow, bool(policy.get("service_negate"))
        )
        if src_ok and dst_ok and svc_ok:
            why = [
                f"{ingress} → {egress} passt",
                f"Quelle {', '.join(policy.get('srcaddr') or [])} enthält {flow.src}",
                f"Ziel {', '.join(dst_names)} enthält {original_dst}",
                f"Dienst {', '.join(policy.get('service') or [])} enthält "
                + (
                    flow.proto.upper() if flow.port is None else f"{flow.proto.upper()}/{flow.port}"
                ),
            ]
            if policy.get("schedule") not in ("", "always", None):
                notes.append(f"Zeitplan „{policy.get('schedule')}“ wird nicht geprüft.")
            return policy, why, skipped, notes
        if len(skipped) < SKIPPED_MAX:
            reasons = []
            if not src_ok:
                reasons.append("Quelle passt nicht")
            if not dst_ok:
                reasons.append("Ziel passt nicht")
            if not svc_ok:
                reasons.append(f"Dienst nur {', '.join(policy.get('service') or [])}")
            skipped.append(f"{label} davor passt nicht ({'; '.join(reasons)})")
    return None, [], skipped, notes


def _snat(device: Device, policy: dict[str, Any], egress: str, flow: Flow) -> tuple[Flow, str]:
    if not policy.get("nat"):
        return flow, ""
    pools = policy.get("poolname") or []
    if pools:
        for pool in device.config.get("ippools") or []:
            if pool.get("name") == pools[0]:
                try:
                    start = IPv4(str(pool.get("start")))
                except ValueError:
                    break
                return Flow(start, flow.dst, flow.proto, flow.port), f"SNAT auf Pool {pools[0]}"
        return flow, f"SNAT auf Pool {pools[0]}"
    for name, own, _ in interface_nets(device.config):
        if name == egress:
            return Flow(own, flow.dst, flow.proto, flow.port), f"SNAT auf {egress}-Adresse {own}"
    return flow, f"SNAT auf die Adresse von {egress}"


def next_device(
    devices: Sequence[Device], current: Device, route: Route
) -> tuple[Device, str] | None:
    """Gerät hinter dem Gateway (Adresse eines Interfaces) oder am Ende des IPsec-Tunnels."""
    if route.gateway:
        try:
            gateway = IPv4(route.gateway)
        except ValueError:
            return None
        for device in devices:
            if device.name == current.name:
                continue
            for name, own, _ in interface_nets(device.config):
                if own == gateway:
                    return device, name
        return None
    tunnel = next(
        (t for t in current.config.get("vpn_tunnels") or [] if t.get("name") == route.interface),
        None,
    )
    if tunnel is None or not tunnel.get("remote_gw"):
        return None
    local_ips = {
        str(own) for name, own, _ in interface_nets(current.config) if name == tunnel["interface"]
    }
    for device in devices:
        if device.name == current.name:
            continue
        owns = {str(own) for _, own, _ in interface_nets(device.config)}
        if tunnel["remote_gw"] not in owns:
            continue
        back = next(
            (
                t["name"]
                for t in device.config.get("vpn_tunnels") or []
                if t.get("remote_gw") in local_ips
            ),
            None,
        )
        return device, str(back or route.interface)
    return None


def start_device(devices: Sequence[Device], src: IPv4) -> tuple[Device, str] | None:
    """Gerät mit dem kleinsten verbundenen Netz, in dem die Quelle liegt."""
    best: tuple[int, Device, str] | None = None
    for device in devices:
        wan = wan_names(device.config)
        for name, _, network in interface_nets(device.config):
            if name in wan or src not in network:
                continue
            if best is None or network.prefixlen > best[0]:
                best = (network.prefixlen, device, name)
    return (best[1], best[2]) if best else None


# --- Ablauf --------------------------------------------------------------------------------


def trace(
    devices: Sequence[Device],
    flow: Flow,
    start: str | None = None,
    ingress: str | None = None,
) -> Result:
    hops: list[Hop] = []
    if start:
        device = next((d for d in devices if d.name == start), None)
        if device is None:
            return Result([], "", False, "Dieses Gerät gibt es nicht.")
        incoming = ingress or ingress_for(device, flow.src)
        if incoming is None:
            return Result(
                [],
                "",
                False,
                f"Auf {device.name} ist nicht zu erkennen, über welches Interface {flow.src} "
                "hereinkommt.",
            )
    else:
        found = start_device(devices, flow.src)
        if found is None:
            return Result(
                [],
                "",
                False,
                "Kein Gerät hat ein Netz mit dieser Quelle. Wähle das Startgerät aus.",
            )
        device, incoming = found
    seen: set[tuple[str, str]] = set()
    current = flow
    while len(hops) < MAX_HOPS:
        if (device.name, incoming) in seen:
            return Result(hops, "Schleife: Die Verbindung käme wieder an dieselbe Stelle.", False)
        seen.add((device.name, incoming))
        hop = Hop(device.name, incoming, str(current.src), str(current.dst))
        hops.append(hop)
        original_dst = current.dst
        current, hop.dnat = apply_vip(device, current, incoming)
        route = lookup_route(device, current.dst, current.src, incoming)
        if route is None:
            hop.outcome = f"Keine Route zu {current.dst}"
            return Result(hops, f"Verworfen auf {device.name}: keine Route.", False)
        hop.route = route.text
        hop.egress = route.interface
        if route.blackhole:
            hop.outcome = "Verworfen (Blackhole-Route)"
            return Result(hops, f"Verworfen auf {device.name}: Blackhole-Route.", False)
        policy, why, skipped, notes = first_policy(
            device, current, original_dst, incoming, route.interface
        )
        hop.skipped, hop.notes = skipped, notes
        if policy is None:
            hop.outcome = "Keine passende Policy: FortiOS verwirft (implizites Deny)"
            return Result(hops, f"Verworfen auf {device.name}: keine passende Policy.", False)
        hop.policy = {
            "id": policy.get("id"),
            "name": policy.get("name") or "",
            "action": policy.get("action") or "deny",
        }
        hop.why = why
        hop.profiles = dict(policy.get("profiles") or {})
        if policy.get("action") != "accept":
            hop.outcome = f"Verboten durch Policy #{policy.get('id')}"
            return Result(
                hops, f"Verboten auf {device.name} durch Policy #{policy.get('id')}.", False
            )
        current, hop.snat = _snat(device, policy, route.interface, current)
        if route.kind == "connect":
            hop.outcome = f"Zugestellt im Netz {route.network}"
            return Result(
                hops, f"Erlaubt über {len(hops)} Firewall(s), zugestellt auf {device.name}.", True
            )
        follow = next_device(devices, device, route)
        if follow is None:
            if route.interface in wan_names(device.config):
                hop.outcome = f"Ins Internet über {route.interface}"
                return Result(
                    hops,
                    f"Erlaubt über {len(hops)} Firewall(s) · Ausgang ins Internet: "
                    f"{device.name} {route.interface}" + (" mit SNAT" if hop.snat else ""),
                    True,
                )
            hop.outcome = f"Verlässt die bekannten Firewalls über {route.interface}"
            return Result(
                hops,
                f"Erlaubt bis {device.name}; danach über {route.interface} zu einem unbekannten "
                "Gerät.",
                True,
            )
        hop.outcome = f"Weiter zu {follow[0].name} ({follow[1]})"
        device, incoming = follow
    return Result(hops, "Abgebrochen: mehr als acht Firewalls.", False)


def internet_exits(devices: Sequence[Device]) -> list[dict[str, Any]]:
    """Internet-Ausgang je internem Netz: von jedem Netz eine Probe zu einer Internet-Adresse."""
    rows = []
    for device in devices:
        wan = wan_names(device.config)
        tunnels = tunnel_names(device.config)
        for name, own, network in interface_nets(device.config):
            if name in wan or name in tunnels or network.prefixlen >= 31:
                continue
            hosts = (host for host in network.hosts() if host != own)
            probe = next(hosts, None)
            if probe is None:
                continue
            result = trace(
                devices, Flow(probe, INTERNET_PROBE, "tcp", 443), start=device.name, ingress=name
            )
            last = result.hops[-1] if result.hops else None
            rows.append(
                {
                    "device": device.name,
                    "interface": name,
                    "network": str(network),
                    "allowed": result.allowed and bool(last and "Internet" in last.outcome),
                    "verdict": result.verdict or result.error,
                    "exit": f"{last.device} {last.egress}"
                    if last and "Internet" in last.outcome
                    else "",
                    "path": [hop.device for hop in result.hops],
                    "policies": [
                        f"{hop.device} #{hop.policy['id']}" for hop in result.hops if hop.policy
                    ],
                    "snat": next((hop.snat for hop in reversed(result.hops) if hop.snat), ""),
                    "profiles": dict(last.profiles) if last else {},
                }
            )
    return rows


def topology(devices: Sequence[Device]) -> dict[str, Any]:
    """Geräte, Verbindungen (gemeinsames Netz, IPsec) und Internet-Anschlüsse."""
    nodes = []
    links: list[dict[str, Any]] = []
    owners: dict[str, tuple[str, str]] = {}
    for device in devices:
        wan = sorted(
            name
            for name in wan_names(device.config)
            if name in {n for n, _, _ in interface_nets(device.config)}
        )
        nodes.append({"name": device.name, "internet": wan})
        for name, own, _ in interface_nets(device.config):
            owners[str(own)] = (device.name, name)
    names = [d.name for d in devices]
    for index, a in enumerate(devices):
        nets_a = {(str(net), name) for name, _, net in interface_nets(a.config)}
        for b in devices[index + 1 :]:
            for name_b, _, net_b in interface_nets(b.config):
                for net_a, name_a in nets_a:
                    if net_a == str(net_b) and net_b.prefixlen < 32:
                        links.append(
                            {
                                "a": a.name,
                                "b": b.name,
                                "kind": "Netz",
                                "label": f"{net_a} ({name_a} / {name_b})",
                            }
                        )
            # Gateway eines Geräts ist eine Adresse des anderen (z. B. Uplink in ein größeres Netz)
            for source, target in ((a, b), (b, a)):
                for item in source.config.get("static_routes") or []:
                    owner = owners.get(str(item.get("gateway") or ""))
                    if owner and owner[0] == target.name:
                        label = f"{item.get('device')} → {owner[1]}"
                        if not any(
                            link["a"] in (a.name, b.name) and link["b"] in (a.name, b.name)
                            for link in links
                        ):
                            links.append(
                                {
                                    "a": source.name,
                                    "b": target.name,
                                    "kind": "Route",
                                    "label": label,
                                }
                            )
    for device in devices:
        for tunnel in device.config.get("vpn_tunnels") or []:
            owner = owners.get(str(tunnel.get("remote_gw") or ""))
            if owner is None or owner[0] == device.name:
                continue
            pair = sorted((device.name, owner[0]))
            if any(
                sorted((link["a"], link["b"])) == pair and link["kind"] == "IPsec" for link in links
            ):
                continue
            links.append(
                {"a": device.name, "b": owner[0], "kind": "IPsec", "label": str(tunnel.get("name"))}
            )
    links.sort(key=lambda link: (names.index(link["a"]), names.index(link["b"]), link["kind"]))
    return {"nodes": nodes, "links": links}
