"""Abruf eines Geräts und Umformung in eine schlanke, stabile Form.

Gespeichert wird nur, was die Seiten brauchen: keine Schlüssel, keine Zertifikate, keine
Benutzerkonten. Die Reihenfolge der Policies bleibt die des Geräts (First Match).
"""

import hashlib
import ipaddress
import json
from dataclasses import dataclass, field
from typing import Any

from werkbank.modules.monitoring.fortigate.client import (
    FortiGateClient,
    FortiGateError,
    NotAvailableError,
)

TEXT_MAX = 255
COMMENT_MAX = 1023


def _text(value: object, limit: int = TEXT_MAX) -> str:
    return str(value)[:limit] if isinstance(value, (str, int, float)) else ""


def _names(value: object, key: str = "name") -> list[str]:
    """[{"name": "a"}, …] → ["a", …]"""
    if not isinstance(value, list):
        return []
    return [_text(item.get(key)) for item in value if isinstance(item, dict) and item.get(key)]


def _on(value: object) -> bool:
    return value == "enable"


def cidr(subnet: object) -> str:
    """„10.0.0.0 255.255.255.0“ → „10.0.0.0/24“; Unlesbares bleibt, wie es ist."""
    text = _text(subnet).strip()
    parts = text.split()
    if len(parts) == 2:
        try:
            return str(ipaddress.IPv4Network(f"{parts[0]}/{parts[1]}", strict=False))
        except ValueError:
            return text
    return text


def interface_ip(value: object) -> str:
    """IP eines Interfaces mit Präfix, z. B. „10.0.0.1/24“; leer ohne Adresse."""
    text = _text(value).strip()
    parts = text.split()
    if len(parts) == 2 and parts[0] != "0.0.0.0":  # noqa: S104 (Interface ohne Adresse)
        try:
            network = ipaddress.IPv4Network(f"{parts[0]}/{parts[1]}", strict=False)
        except ValueError:
            return text
        return f"{parts[0]}/{network.prefixlen}"
    return ""


def _profiles(policy: dict[str, Any]) -> dict[str, str]:
    keys = {
        "av": "av-profile",
        "web": "webfilter-profile",
        "ips": "ips-sensor",
        "app": "application-list",
        "dns": "dnsfilter-profile",
        "ssl": "ssl-ssh-profile",
        "file": "file-filter-profile",
        "group": "profile-group",
    }
    out: dict[str, str] = {}
    if policy.get("utm-status") != "enable" and policy.get("profile-type") != "group":
        # Ohne Sicherheitsprofile; die SSL-Prüfung steht trotzdem in der Policy
        keys = {"ssl": "ssl-ssh-profile"}
    for short, key in keys.items():
        value = _text(policy.get(key))
        if value:
            out[short] = value
    return out


def policy(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("policyid"),
        "name": _text(item.get("name")),
        "status": item.get("status") != "disable",
        "srcintf": _names(item.get("srcintf")),
        "dstintf": _names(item.get("dstintf")),
        "srcaddr": _names(item.get("srcaddr")) + _names(item.get("srcaddr6")),
        "dstaddr": _names(item.get("dstaddr")) + _names(item.get("dstaddr6")),
        "srcaddr_negate": _on(item.get("srcaddr-negate")),
        "dstaddr_negate": _on(item.get("dstaddr-negate")),
        "internet_service": _names(item.get("internet-service-name"))
        + _names(item.get("internet-service-src-name")),
        "service": _names(item.get("service")),
        "service_negate": _on(item.get("service-negate")),
        "action": _text(item.get("action")) or "deny",
        "nat": _on(item.get("nat")),
        "poolname": _names(item.get("poolname")) if _on(item.get("ippool")) else [],
        "schedule": _text(item.get("schedule")),
        "log": _text(item.get("logtraffic")),
        "profiles": _profiles(item),
        "users": _names(item.get("users")) + _names(item.get("groups")),
        "comments": _text(item.get("comments"), COMMENT_MAX),
    }


def address(item: dict[str, Any]) -> dict[str, Any]:
    kind = _text(item.get("type")) or "ipmask"
    out: dict[str, Any] = {
        "name": _text(item.get("name")),
        "type": kind,
        "fabric": _on(item.get("fabric-object")),
        "interface": _text(item.get("associated-interface")),
        "comment": _text(item.get("comment"), COMMENT_MAX),
    }
    if kind in ("ipmask", "interface-subnet"):
        out["value"] = cidr(item.get("subnet"))
    elif kind == "iprange":
        out["value"] = f"{_text(item.get('start-ip'))}-{_text(item.get('end-ip'))}"
    elif kind == "fqdn":
        out["value"] = _text(item.get("fqdn"))
    elif kind == "geography":
        out["value"] = _text(item.get("country"))
    elif kind == "wildcard":
        out["value"] = _text(item.get("wildcard"))
    else:
        out["value"] = ""
    return out


def group(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _text(item.get("name")),
        "members": _names(item.get("member")),
        "exclude": _names(item.get("exclude-member")) if _on(item.get("exclude")) else [],
        "fabric": _on(item.get("fabric-object")),
        "comment": _text(item.get("comment"), COMMENT_MAX),
    }


def service(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _text(item.get("name")),
        "protocol": _text(item.get("protocol")),
        "tcp": _text(item.get("tcp-portrange")),
        "udp": _text(item.get("udp-portrange")),
        "sctp": _text(item.get("sctp-portrange")),
        "protocol_number": item.get("protocol-number")
        if isinstance(item.get("protocol-number"), int)
        else None,
        "category": _text(item.get("category")),
        "fabric": _on(item.get("fabric-object")),
        "comment": _text(item.get("comment"), COMMENT_MAX),
    }


def vip(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _text(item.get("name")),
        "type": _text(item.get("type")),
        "extip": _text(item.get("extip")),
        "mapped": _names(item.get("mappedip"), "range"),
        "extintf": _text(item.get("extintf")),
        "portforward": _on(item.get("portforward")),
        "protocol": _text(item.get("protocol")),
        "extport": _text(item.get("extport")),
        "mappedport": _text(item.get("mappedport")),
        "comment": _text(item.get("comment"), COMMENT_MAX),
    }


def ippool(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _text(item.get("name")),
        "type": _text(item.get("type")),
        "start": _text(item.get("startip")),
        "end": _text(item.get("endip")),
        "comment": _text(item.get("comments"), COMMENT_MAX),
    }


def interface(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _text(item.get("name")),
        "alias": _text(item.get("alias")),
        "ip": interface_ip(item.get("ip")),
        "type": _text(item.get("type")),
        "role": _text(item.get("role")),
        "parent": _text(item.get("interface")),
        "status": item.get("status") != "down",
    }


def zone(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _text(item.get("name")),
        "interfaces": _names(item.get("interface"), "interface-name"),
    }


def local_in(item: dict[str, Any]) -> dict[str, Any]:
    intf = item.get("intf")
    return {
        "id": item.get("policyid"),
        "intf": _names(intf) if isinstance(intf, list) else ([_text(intf)] if intf else []),
        "srcaddr": _names(item.get("srcaddr")),
        "dstaddr": _names(item.get("dstaddr")),
        "service": _names(item.get("service")),
        "action": _text(item.get("action")),
        "status": item.get("status") != "disable",
    }


def dos_policy(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("policyid"),
        "intf": [_text(item.get("interface"))] if item.get("interface") else [],
        "srcaddr": _names(item.get("srcaddr")),
        "dstaddr": _names(item.get("dstaddr")),
        "service": _names(item.get("service")),
        "status": item.get("status") != "disable",
    }


def static_route(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "seq": item.get("seq-num"),
        "dst": cidr(item.get("dst")) or "0.0.0.0/0",
        "dstaddr": _text(item.get("dstaddr")),
        "gateway": _text(item.get("gateway")),
        "device": _text(item.get("device")),
        "distance": item.get("distance") if isinstance(item.get("distance"), int) else None,
        "blackhole": _on(item.get("blackhole")),
        "status": item.get("status") != "disable",
    }


def policy_route(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "seq": item.get("seq-num"),
        "input": _names(item.get("input-device")),
        "srcaddr": _names(item.get("srcaddr")),
        "dstaddr": _names(item.get("dstaddr")),
        "output": _text(item.get("output-device")),
        "gateway": _text(item.get("gateway")),
        "status": item.get("status") != "disable",
    }


def sdwan_rule(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id"),
        "name": _text(item.get("name")),
        "srcaddr": _names(item.get("src")),
        "dstaddr": _names(item.get("dst")),
        "status": item.get("status") != "disable",
    }


def vpn_selector(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _text(item.get("name")),
        "tunnel": _text(item.get("phase1name")),
        "srcaddr": [_text(item.get("src-name"))]
        if item.get("src-addr-type") in ("name", "name6") and item.get("src-name")
        else [],
        "dstaddr": [_text(item.get("dst-name"))]
        if item.get("dst-addr-type") in ("name", "name6") and item.get("dst-name")
        else [],
        "src_subnet": cidr(item.get("src-subnet")),
        "dst_subnet": cidr(item.get("dst-subnet")),
    }


def digest(config: dict[str, Any]) -> str:
    raw = json.dumps(config, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()


@dataclass
class Fetched:
    config: dict[str, Any]
    runtime: dict[str, Any]
    notes: list[str] = field(default_factory=list)


# Pflicht: ohne diese Listen ist der Stand unbrauchbar, der Abruf gilt als fehlgeschlagen
REQUIRED: dict[str, tuple[str, Any]] = {
    "policies": ("firewall/policy", policy),
    "addresses": ("firewall/address", address),
    "address_groups": ("firewall/addrgrp", group),
    "services": ("firewall.service/custom", service),
    "service_groups": ("firewall.service/group", group),
}
# Freiwillig: fehlt eine (Recht oder Funktion), bleibt sie leer und der Abruf nennt es
OPTIONAL: dict[str, tuple[str, Any]] = {
    "vips": ("firewall/vip", vip),
    "vip_groups": ("firewall/vipgrp", group),
    "ippools": ("firewall/ippool", ippool),
    "interfaces": ("system/interface", interface),
    "zones": ("system/zone", zone),
    "local_in": ("firewall/local-in-policy", local_in),
    "dos": ("firewall/DoS-policy", dos_policy),
    "static_routes": ("router/static", static_route),
    "policy_routes": ("router/policy", policy_route),
    "vpn_selectors": ("vpn.ipsec/phase2-interface", vpn_selector),
}
LABELS = {
    "vips": "VIPs",
    "vip_groups": "VIP-Gruppen",
    "ippools": "IP-Pools",
    "interfaces": "Interfaces",
    "zones": "Zonen",
    "local_in": "Local-in-Policies",
    "dos": "DoS-Policies",
    "static_routes": "Statische Routen",
    "policy_routes": "Policy-Routen",
    "vpn_selectors": "VPN-Selektoren",
    "sdwan": "SD-WAN-Regeln",
    "fabric": "Security Fabric",
    "ha": "HA-Einstellungen",
    "hits": "Trefferzähler",
    "ha_peers": "HA-Mitglieder",
}


def _number(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def fetch(client: FortiGateClient) -> Fetched:
    """Liest Konfiguration und Laufzeitstand eines Geräts. Wirft FortiGateError, wenn eine
    Pflichtliste fehlt."""
    notes: list[str] = []
    status = client.monitor("system/status")
    info = status.results if isinstance(status.results, dict) else {}
    config: dict[str, Any] = {"hostname": _text(info.get("hostname"))}
    for key, (path, shape) in REQUIRED.items():
        config[key] = [shape(item) for item in client.cmdb(path)]
    for key, (path, shape) in OPTIONAL.items():
        try:
            config[key] = [shape(item) for item in client.cmdb(path)]
        except FortiGateError as error:
            config[key] = []
            notes.append(f"{LABELS[key]}: {error}")
    try:
        sdwan = client.cmdb("system/sdwan")
        rules = sdwan[0].get("service") if sdwan else None
        config["sdwan_rules"] = [sdwan_rule(item) for item in rules or [] if isinstance(item, dict)]
    except FortiGateError as error:
        config["sdwan_rules"] = []
        notes.append(f"{LABELS['sdwan']}: {error}")
    try:
        csf = client.cmdb("system/csf")
        settings = csf[0] if csf else {}
        config["fabric"] = {
            "status": _text(settings.get("status")),
            "upstream": _text(settings.get("upstream")),
            "unification": _text(settings.get("fabric-object-unification")),
            "configuration_sync": _text(settings.get("configuration-sync")),
            "group": _text(settings.get("group-name")),
        }
    except FortiGateError as error:
        config["fabric"] = {}
        notes.append(f"{LABELS['fabric']}: {error}")
    try:
        ha = client.cmdb("system/ha")
        settings = ha[0] if ha else {}
        config["ha"] = {
            "mode": _text(settings.get("mode")),
            "group": _text(settings.get("group-name")),
        }
    except FortiGateError as error:
        config["ha"] = {}
        notes.append(f"{LABELS['ha']}: {error}")

    runtime: dict[str, Any] = {
        "version": status.version,
        "build": status.build,
        "serial": status.serial,
        "model": _text(info.get("model_name") or info.get("model")),
        "hostname": _text(info.get("hostname")),
    }
    hits: dict[str, dict[str, int | None]] = {}
    try:
        for row in client.monitor("firewall/policy").results or []:
            if isinstance(row, dict) and _number(row.get("policyid")) is not None:
                hits[str(row["policyid"])] = {
                    "hits": _number(row.get("hit_count")),
                    "last_used": _number(row.get("last_used")),
                    "first_used": _number(row.get("first_used")),
                    "bytes": _number(row.get("bytes")),
                }
    except FortiGateError as error:
        notes.append(f"{LABELS['hits']}: {error}")
    runtime["hits"] = hits
    peers: list[dict[str, Any]] = []
    if config["ha"].get("mode") not in ("", "standalone", None):
        try:
            for row in client.monitor("system/ha-peer").results or []:
                if isinstance(row, dict):
                    peers.append(
                        {
                            "hostname": _text(row.get("hostname")),
                            "serial": _text(row.get("serial_no")),
                            "priority": _number(row.get("priority")),
                            "primary": bool(
                                row.get("is_manage_primary") or row.get("is_root_primary")
                            ),
                        }
                    )
        except NotAvailableError:
            pass
        except FortiGateError as error:
            notes.append(f"{LABELS['ha_peers']}: {error}")
    runtime["ha_peers"] = peers
    runtime["notes"] = notes
    return Fetched(config=config, runtime=runtime, notes=notes)
