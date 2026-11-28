"""Erfundene Beispielkonfiguration für Tests und die Test-Umgebung (keine echten Netze).

Drei Geräte einer Fabric: fw-edge (Root, Internet), fw-core (intern), fw-standort-b (über IPsec).
Die Antworten haben die Form der FortiOS-API, damit normalize.fetch sie verarbeiten kann.
"""

from collections.abc import Mapping
from typing import Any

from werkbank.modules.monitoring.fortigate.client import DeviceConfig, NotAvailableError


def _n(*names: str) -> list[dict[str, str]]:
    return [{"name": name} for name in names]


def _addr(name: str, subnet: str, fabric: bool = False, **extra: Any) -> dict[str, Any]:
    return {
        "name": name,
        "type": "ipmask",
        "subnet": subnet,
        "fabric-object": "enable" if fabric else "disable",
        **extra,
    }


COMMON_ADDRESSES = [
    _addr("all", "0.0.0.0 0.0.0.0"),
    _addr("Netz-Buero", "10.20.30.0 255.255.255.0", fabric=True),
    _addr("srv-datei", "10.20.30.15 255.255.255.255", fabric=True),
    _addr("srv-druck", "10.20.30.16 255.255.255.255", fabric=True),
    _addr("srv-app", "10.20.31.10 255.255.255.255", fabric=True),
    _addr("Netz-Gast-alt", "10.99.0.0 255.255.255.0", fabric=True),
]
COMMON_SERVICES = [
    {"name": "ALL", "protocol": "IP", "protocol-number": 0},
    {"name": "HTTPS", "protocol": "TCP/UDP/UDP-Lite/SCTP", "tcp-portrange": "443"},
    {"name": "HTTP", "protocol": "TCP/UDP/UDP-Lite/SCTP", "tcp-portrange": "80"},
    {
        "name": "DNS",
        "protocol": "TCP/UDP/UDP-Lite/SCTP",
        "tcp-portrange": "53",
        "udp-portrange": "53",
    },
    {"name": "SMB", "protocol": "TCP/UDP/UDP-Lite/SCTP", "tcp-portrange": "445"},
    {"name": "RDP", "protocol": "TCP/UDP/UDP-Lite/SCTP", "tcp-portrange": "3389"},
]

DEVICES: dict[str, dict[str, Any]] = {
    "fw-edge": {
        "status": {"hostname": "fw-edge", "model_name": "FortiGate 200G"},
        "serial": "FGT200GTK0000001",
        "firewall/policy": [
            {
                "policyid": 15,
                "name": "Standorte DNS",
                "srcintf": _n("ipsec-standort-b"),
                "dstintf": _n("wan1"),
                "srcaddr": _n("Netz-Standort-B"),
                "dstaddr": _n("all"),
                "service": _n("DNS"),
                "action": "accept",
                "nat": "enable",
                "logtraffic": "all",
            },
            {
                "policyid": 12,
                "name": "LAN ins Internet",
                "srcintf": _n("lan"),
                "dstintf": _n("wan1"),
                "srcaddr": _n("Netz-Buero"),
                "dstaddr": _n("all"),
                "service": _n("WEB-Dienste"),
                "action": "accept",
                "nat": "enable",
                "logtraffic": "all",
            },
            {
                "policyid": 7,
                "name": "Fernwartung Altsystem",
                "srcintf": _n("wan1"),
                "dstintf": _n("lan"),
                "srcaddr": _n("all"),
                "dstaddr": _n("VIP-Fernwartung"),
                "service": _n("ALL"),
                "action": "accept",
                "logtraffic": "disable",
            },
            {
                "policyid": 18,
                "name": "Standorte ins Internet",
                "srcintf": _n("ipsec-standort-b"),
                "dstintf": _n("wan1"),
                "srcaddr": _n("Netz-Standort-B"),
                "dstaddr": _n("all"),
                "service": _n("WEB-Dienste"),
                "action": "accept",
                "nat": "enable",
                "utm-status": "enable",
                "webfilter-profile": "Standard",
                "ips-sensor": "Standard",
                "ssl-ssh-profile": "certificate-inspection",
                "logtraffic": "all",
            },
        ],
        "firewall/address": [
            *COMMON_ADDRESSES,
            _addr("Netz-Standort-B", "10.40.0.0 255.255.0.0", fabric=True),
            _addr("test-host-1", "10.20.40.9 255.255.255.255"),
        ],
        "firewall/addrgrp": [
            {
                "name": "Grp-Server",
                "member": _n("srv-datei", "srv-druck", "srv-app"),
                "fabric-object": "enable",
            },
            {"name": "Grp-Alt-Buero", "member": _n("test-host-1", "srv-datei")},
        ],
        "firewall.service/custom": COMMON_SERVICES,
        "firewall.service/group": [{"name": "WEB-Dienste", "member": _n("HTTP", "HTTPS")}],
        "firewall/vip": [
            {
                "name": "VIP-Fernwartung",
                "type": "static-nat",
                "extip": "192.0.2.10",
                "mappedip": [{"range": "10.20.30.50"}],
                "extintf": "wan1",
                "portforward": "enable",
                "protocol": "tcp",
                "extport": "3389",
                "mappedport": "3389",
            }
        ],
        "firewall/vipgrp": [],
        "firewall/ippool": [],
        "system/interface": [
            {"name": "wan1", "ip": "192.0.2.2 255.255.255.248", "type": "physical", "role": "wan"},
            {"name": "lan", "ip": "10.20.0.1 255.255.0.0", "type": "physical", "role": "lan"},
            {
                "name": "ipsec-standort-b",
                "ip": "0.0.0.0 0.0.0.0",
                "type": "tunnel",
                "role": "undefined",
            },
        ],
        "system/zone": [],
        "system/csf": [
            {
                "status": "enable",
                "upstream": "",
                "fabric-object-unification": "default",
                "group-name": "fabric-a",
            }
        ],
        "system/ha": [{"mode": "a-p", "group-name": "cluster-edge"}],
        "firewall/local-in-policy": [
            {
                "policyid": 1,
                "intf": _n("lan"),
                "srcaddr": _n("Netz-Buero"),
                "dstaddr": _n("all"),
                "service": _n("HTTPS"),
                "action": "accept",
            },
        ],
        "router/static": [
            {
                "seq-num": 1,
                "dst": "0.0.0.0 0.0.0.0",
                "gateway": "192.0.2.1",
                "device": "wan1",
                "distance": 10,
            },
            {
                "seq-num": 2,
                "dst": "0.0.0.0 0.0.0.0",
                "dstaddr": "Netz-Standort-B",
                "device": "ipsec-standort-b",
            },
        ],
        "vpn.ipsec/phase2-interface": [
            {
                "name": "standort-b-p2",
                "phase1name": "ipsec-standort-b",
                "src-addr-type": "name",
                "src-name": "Netz-Buero",
                "dst-addr-type": "name",
                "dst-name": "Netz-Standort-B",
            },
        ],
        "system/sdwan": {
            "status": "enable",
            "service": [
                {"id": 1, "name": "Server bevorzugt", "src": _n("Netz-Buero"), "dst": _n("srv-app")}
            ],
        },
        "monitor/firewall/policy": [
            {"policyid": 15, "hit_count": 1200, "last_used": 1795800000},
            {
                "policyid": 12,
                "hit_count": 1284302,
                "last_used": 1795810000,
                "first_used": 1790000000,
            },
            {"policyid": 7, "hit_count": 41, "last_used": 1795500000},
            {"policyid": 18, "hit_count": 220415, "last_used": 1795809000},
        ],
        "monitor/system/ha-peer": [
            {"hostname": "fw-edge-a", "serial_no": "FGT200GTK0000001", "priority": 200},
            {"hostname": "fw-edge-b", "serial_no": "FGT200GTK0000002", "priority": 100},
        ],
    },
    "fw-core": {
        "status": {"hostname": "fw-core", "model_name": "FortiGate 120G"},
        "serial": "FGT120GTK0000003",
        "firewall/policy": [
            {
                "policyid": 31,
                "name": "Buero zu Servern",
                "srcintf": _n("lan"),
                "dstintf": _n("server"),
                "srcaddr": _n("Netz-Buero"),
                "dstaddr": _n("Grp-Server"),
                "service": _n("HTTPS", "SMB"),
                "action": "accept",
                "logtraffic": "all",
                "utm-status": "enable",
                "ips-sensor": "Standard",
            },
            {
                "policyid": 44,
                "name": "Buero zu Servern (alt)",
                "srcintf": _n("lan"),
                "dstintf": _n("server"),
                "srcaddr": _n("Netz-Buero"),
                "dstaddr": _n("Grp-Server"),
                "service": _n("HTTPS"),
                "action": "accept",
                "logtraffic": "all",
            },
            {
                "policyid": 52,
                "name": "Testzugang",
                "status": "disable",
                "srcintf": _n("lan"),
                "dstintf": _n("server"),
                "srcaddr": _n("test-host-1"),
                "dstaddr": _n("srv-app"),
                "service": _n("RDP"),
                "action": "accept",
            },
        ],
        "firewall/address": [
            *COMMON_ADDRESSES,
            _addr("test-host-1", "10.20.40.9 255.255.255.255"),
            _addr("Drucker-Netz", "10.20.30.0 255.255.255.128"),
        ],
        "firewall/addrgrp": [
            {
                "name": "Grp-Server",
                "member": _n("srv-datei", "srv-druck", "srv-app"),
                "fabric-object": "enable",
            },
        ],
        "firewall.service/custom": COMMON_SERVICES,
        "firewall.service/group": [],
        "firewall/vip": [],
        "firewall/vipgrp": [],
        "firewall/ippool": [],
        "system/interface": [
            {"name": "lan", "ip": "10.20.30.1 255.255.255.0", "type": "physical", "role": "lan"},
            {"name": "server", "ip": "10.20.31.1 255.255.255.0", "type": "physical", "role": "lan"},
        ],
        "system/zone": [],
        "system/csf": [{"status": "enable", "upstream": "fw-edge.example.com"}],
        "system/ha": [{"mode": "a-p", "group-name": "cluster-core"}],
        "monitor/firewall/policy": [
            {"policyid": 31, "hit_count": 882110, "last_used": 1795810000},
            {"policyid": 44, "hit_count": 0},
            {"policyid": 52, "hit_count": 0},
        ],
        "monitor/system/ha-peer": [
            {"hostname": "fw-core-a", "serial_no": "FGT120GTK0000003", "priority": 200},
            {"hostname": "fw-core-b", "serial_no": "FGT120GTK0000004", "priority": 100},
        ],
    },
    "fw-standort-b": {
        "status": {"hostname": "fw-standort-b", "model_name": "FortiGate 70G"},
        "serial": "FGT70GTK00000005",
        "firewall/policy": [
            {
                "policyid": 3,
                "name": "Standort B ins Internet",
                "srcintf": _n("lan"),
                "dstintf": _n("ipsec-zentrale"),
                "srcaddr": _n("Netz-Standort-B"),
                "dstaddr": _n("all"),
                "service": _n("ALL"),
                "action": "accept",
                "logtraffic": "all",
            },
            {
                "policyid": 9,
                "name": "Alles sperren",
                "srcintf": _n("any"),
                "dstintf": _n("any"),
                "srcaddr": _n("all"),
                "dstaddr": _n("all"),
                "service": _n("ALL"),
                "action": "deny",
            },
        ],
        "firewall/address": [
            *COMMON_ADDRESSES,
            _addr("Netz-Standort-B", "10.40.0.0 255.255.0.0", fabric=True),
            _addr("Drucker-Netz", "10.40.5.0 255.255.255.0"),
        ],
        "firewall/addrgrp": [
            {"name": "Grp-Server", "member": _n("srv-datei", "srv-app"), "fabric-object": "enable"},
        ],
        "firewall.service/custom": COMMON_SERVICES,
        "firewall.service/group": [],
        "firewall/vip": [],
        "firewall/vipgrp": [],
        "firewall/ippool": [],
        "system/interface": [
            {"name": "lan", "ip": "10.40.0.1 255.255.0.0", "type": "physical", "role": "lan"},
            {"name": "ipsec-zentrale", "ip": "0.0.0.0 0.0.0.0", "type": "tunnel"},
        ],
        "system/zone": [],
        "system/csf": [
            {
                "status": "enable",
                "upstream": "fw-edge.example.com",
                "fabric-object-unification": "local",
            }
        ],
        "system/ha": [{"mode": "standalone"}],
        "monitor/firewall/policy": [
            {"policyid": 3, "hit_count": 220415, "last_used": 1795809500},
            {"policyid": 9, "hit_count": 1902, "last_used": 1795810100},
        ],
    },
}


def sample_transport(config: DeviceConfig, path: str, params: Mapping[str, str]) -> Any:
    """Antwortet wie FortiOS für die erfundenen Geräte (nach Gerätename)."""
    device = DEVICES.get(config.name)
    if device is None:
        raise NotAvailableError(f"Unbekanntes Beispielgerät {config.name}.")
    envelope: dict[str, Any] = {
        "status": "success",
        "serial": device["serial"],
        "version": "v7.6.1",
        "build": 3510,
    }
    if path == "monitor/system/status":
        return {**envelope, "results": device["status"]}
    key = path.removeprefix("cmdb/")
    if key in device:
        return {**envelope, "results": device[key]}
    raise NotAvailableError(f"Den Endpunkt {path} gibt es auf diesem Gerät nicht.")
