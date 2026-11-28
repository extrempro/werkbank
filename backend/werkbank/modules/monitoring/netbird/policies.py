"""Richtlinien, Setup-Keys und Ereignisse von NetBird (Phase 3).

Prüfung der Richtlinien wie die any-Hinweise bei FortiGate: Quelle und Ziel „All“ mit allen
Ports (kritisch), Zugriff auf Server-Gruppen ohne Posture Check, TCP/UDP mit allen Ports (Warnung),
leere Gruppen in Richtlinien, lange deaktivierte Richtlinien, SCIM-Gruppen in keiner Richtlinie
(Info). Server-Gruppen legt die Verwaltung fest; ohne Eintrag entfällt diese Prüfung.
"""

import hashlib
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

ALL = "All"
DISABLED_LONG = timedelta(days=90)
KEY_WARN = timedelta(days=30)
KEY_SOON = timedelta(days=7)
POLICY_EVENTS = ("policy.add", "policy.update")
DASH = "\u2013"
MINUS = "\u2212"

CRITICAL, WARNING, INFO = "kritisch", "warnung", "info"


@dataclass(frozen=True)
class Finding:
    level: str
    code: str
    title: str
    text: str
    subject: str


def digest(policy: Mapping[str, Any]) -> str:
    """Fingerabdruck einer Richtlinie zum Erkennen von Änderungen."""
    raw = json.dumps(policy, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()


def _groups(data: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    return {g["id"]: g for g in data.get("groups") or [] if g.get("id")}


def group_name(groups: Mapping[str, Mapping[str, Any]], gid: str) -> str:
    group = groups.get(gid)
    return str(group.get("name") or gid) if group else gid


def is_all(groups: Mapping[str, Mapping[str, Any]], ids: Iterable[str]) -> bool:
    return any(group_name(groups, gid) == ALL for gid in ids)


def all_ports(rule: Mapping[str, Any]) -> bool:
    """Alle Ports: Protokoll „alle“ oder TCP/UDP ohne Ports und Bereiche."""
    protocol = rule.get("protocol") or "all"
    if protocol == "all":
        return True
    return protocol in ("tcp", "udp") and not rule.get("ports") and not rule.get("port_ranges")


def ports_label(rule: Mapping[str, Any]) -> str:
    protocol = rule.get("protocol") or "all"
    if protocol == "all":
        return "alle"
    if protocol == "icmp":
        return "ICMP"
    if protocol == "netbird-ssh":
        return "SSH (NetBird)"
    parts = [str(p) for p in rule.get("ports") or []]
    for start, end in rule.get("port_ranges") or []:
        parts.append(str(start) if start == end else f"{start}{DASH}{end}")
    return f"{protocol.upper()} {', '.join(parts)}" if parts else f"{protocol.upper()} alle Ports"


def resource_name(data: Mapping[str, Any], ref: Mapping[str, Any] | None) -> str:
    if not ref:
        return ""
    rid = str(ref.get("id") or "")
    if ref.get("type") == "peer":
        for peer in data.get("peers") or []:
            if peer.get("id") == rid:
                return str(peer.get("name") or rid)
        return rid
    for network in data.get("networks") or []:
        for item in network.get("resources") or []:
            if item.get("id") == rid:
                return str(item.get("name") or item.get("address") or rid)
    return rid


def _active_rules(policy: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    if not policy.get("enabled"):
        return []
    return [
        r
        for r in policy.get("rules") or []
        if r.get("enabled", True) and (r.get("action") or "accept") == "accept"
    ]


def parse_iso(value: object) -> datetime | None:
    if not isinstance(value, str) or not value or value.startswith("0001-"):
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else None


def findings(
    data: Mapping[str, Any], now: datetime, server_groups: Iterable[str] = ()
) -> list[Finding]:
    """Alle Befunde der Prüfung, schlimmste zuerst."""
    groups = _groups(data)
    servers = {name.strip().lower() for name in server_groups if name.strip()}
    meta = data.get("policy_meta") or {}
    out: list[Finding] = []
    used: set[str] = set()
    empty_in: dict[str, list[str]] = {}
    for policy in data.get("policies") or []:
        pid, name = policy["id"], policy.get("name") or policy["id"]
        subject = f"policy:{pid}"
        for rule in policy.get("rules") or []:
            used |= set(rule.get("sources") or []) | set(rule.get("destinations") or [])
        rules = _active_rules(policy)
        if any(
            is_all(groups, r.get("sources") or [])
            and is_all(groups, r.get("destinations") or [])
            and all_ports(r)
            for r in rules
        ):
            out.append(
                Finding(
                    CRITICAL,
                    "richtlinie_all",
                    f"Richtlinie {name}: Quelle und Ziel „All“, alle Ports",
                    "Jeder Peer erreicht damit jeden anderen auf allen Ports.",
                    subject,
                )
            )
        if servers and not policy.get("posture_checks"):
            hit = sorted(
                {
                    group_name(groups, gid)
                    for r in rules
                    for gid in r.get("destinations") or []
                    if group_name(groups, gid).lower() in servers
                }
            )
            if hit:
                out.append(
                    Finding(
                        WARNING,
                        "server_ohne_posture",
                        f"Richtlinie {name}: Zugriff auf {', '.join(hit)} ohne Posture Check",
                        "Geräte erreichen die Server, ohne dass ihr Zustand geprüft wird.",
                        subject,
                    )
                )
        open_rules = [r for r in rules if (r.get("protocol") in ("tcp", "udp")) and all_ports(r)]
        if open_rules:
            label = " und ".join(sorted({str(r["protocol"]).upper() for r in open_rules}))
            out.append(
                Finding(
                    WARNING,
                    "alle_ports",
                    f"Richtlinie {name}: {label} mit allen Ports",
                    "Besser nur die Ports freigeben, die gebraucht werden.",
                    subject,
                )
            )
        for rule in rules:
            for gid in list(rule.get("sources") or []) + list(rule.get("destinations") or []):
                group = groups.get(gid)
                if group is None or group.get("name") == ALL:
                    continue
                members = int(group.get("peers_count") or len(group.get("peers") or []))
                if members == 0 and not group.get("resources_count"):
                    names = empty_in.setdefault(gid, [])
                    if name not in names:
                        names.append(name)
        since = parse_iso((meta.get(pid) or {}).get("disabled_since"))
        if not policy.get("enabled") and since is not None and now - since > DISABLED_LONG:
            out.append(
                Finding(
                    INFO,
                    "richtlinie_deaktiviert",
                    f"Richtlinie {name} seit {(now - since).days} Tagen deaktiviert",
                    "Wird sie noch gebraucht? Sonst in NetBird löschen.",
                    subject,
                )
            )
    for gid, names in empty_in.items():
        out.append(
            Finding(
                INFO,
                "gruppe_leer",
                f"Gruppe {group_name(groups, gid)} ist leer, steht aber in {', '.join(names)}",
                "Die Richtlinie wirkt erst, wenn die Gruppe Mitglieder hat.",
                f"group:{gid}",
            )
        )
    scim = sorted(
        str(g.get("name") or gid)
        for gid, g in groups.items()
        if g.get("issued") == "integration" and gid not in used
    )
    if scim and data.get("policies") is not None:
        out.append(
            Finding(
                INFO,
                "scim_ungenutzt",
                f"{len(scim)} SCIM-Gruppe{'n' if len(scim) != 1 else ''} in keiner Richtlinie: "
                + ", ".join(scim),
                "Gruppen aus Entra ohne Richtlinie geben keinen Zugriff.",
                "scim",
            )
        )
    order = {CRITICAL: 0, WARNING: 1, INFO: 2}
    out.sort(key=lambda f: (order[f.level], f.title.lower()))
    return out


def key_expires(key: Mapping[str, Any]) -> datetime | None:
    moment = parse_iso(key.get("expires"))
    # NetBird setzt bei „kein Ablauf“ ein Datum weit in der Zukunft
    if moment is None or moment.year >= 9000:
        return None
    return moment


def key_active(key: Mapping[str, Any]) -> bool:
    return bool(key.get("valid")) and not key.get("revoked")


def policy_rows(data: Mapping[str, Any], now: datetime) -> list[dict[str, Any]]:
    groups = _groups(data)
    checks = {p["id"]: p["name"] for p in data.get("posture_checks") or [] if p.get("id")}
    meta = data.get("policy_meta") or {}
    rows = []
    for policy in data.get("policies") or []:
        sources: list[str] = []
        destinations: list[str] = []
        ports: list[str] = []
        for rule in policy.get("rules") or []:
            for gid in rule.get("sources") or []:
                sources.append(group_name(groups, gid))
            if rule.get("source_resource"):
                sources.append(resource_name(data, rule["source_resource"]))
            for gid in rule.get("destinations") or []:
                destinations.append(group_name(groups, gid))
            if rule.get("destination_resource"):
                destinations.append(resource_name(data, rule["destination_resource"]))
            ports.append(ports_label(rule))
        info = meta.get(policy["id"]) or {}
        since = parse_iso(info.get("disabled_since"))
        rows.append(
            {
                "id": policy["id"],
                "name": policy.get("name") or policy["id"],
                "sources": list(dict.fromkeys(sources)),
                "destinations": list(dict.fromkeys(destinations)),
                "ports": " · ".join(dict.fromkeys(ports)) or DASH,
                "posture_checks": [checks.get(c, c) for c in policy.get("posture_checks") or []],
                "enabled": bool(policy.get("enabled")),
                "disabled_days": (now - since).days
                if since and not policy.get("enabled")
                else None,
                "changed_at": info.get("changed_at"),
            }
        )
    rows.sort(key=lambda r: (not r["enabled"], r["name"].lower()))
    return rows


def setup_key_rows(data: Mapping[str, Any], now: datetime) -> list[dict[str, Any]]:
    groups = _groups(data)
    rows = []
    for key in data.get("setup_keys") or []:
        expires = key_expires(key)
        rows.append(
            {
                "id": key["id"],
                "name": key.get("name") or key["id"],
                "type": key.get("type") or "",
                "groups": [group_name(groups, g) for g in key.get("groups") or []],
                "expires": expires.isoformat() if expires else None,
                "days_left": (expires - now).days if expires else None,
                "state": key.get("state") or ("gültig" if key_active(key) else "ungültig"),
                "active": key_active(key),
                "used_times": key.get("used_times") or 0,
                "usage_limit": key.get("usage_limit") or 0,
                "ephemeral": bool(key.get("ephemeral")),
            }
        )
    rows.sort(key=lambda r: (not r["active"], r["days_left"] is None, r["days_left"] or 0))
    return rows


def peer_targets(data: Mapping[str, Any], peer_id: str) -> list[dict[str, str]]:
    """Ziele, die ein Peer laut den eingeschalteten Richtlinien erreicht."""
    groups = _groups(data)
    peer = next((p for p in data.get("peers") or [] if p.get("id") == peer_id), None)
    if peer is None:
        return []
    mine = set(peer.get("groups") or [])
    out: list[dict[str, str]] = []

    def side(ids: Iterable[str], ref: Mapping[str, Any] | None) -> tuple[bool, list[str]]:
        ids = list(ids)
        hit = bool(mine & set(ids)) or bool(
            ref and ref.get("type") == "peer" and ref.get("id") == peer_id
        )
        names = [group_name(groups, g) for g in ids]
        if ref:
            names.append(resource_name(data, ref))
        return hit, names

    for policy in data.get("policies") or []:
        for rule in _active_rules(policy):
            src_hit, src = side(rule.get("sources") or [], rule.get("source_resource"))
            dst_hit, dst = side(rule.get("destinations") or [], rule.get("destination_resource"))
            label = ports_label(rule)
            if src_hit:
                for name in dst:
                    out.append({"target": name, "ports": label, "policy": policy["name"]})
            if rule.get("bidirectional") and dst_hit:
                for name in src:
                    out.append({"target": name, "ports": label, "policy": policy["name"]})
    unique = {(o["target"], o["ports"], o["policy"]): o for o in out}
    return sorted(unique.values(), key=lambda o: (o["target"].lower(), o["policy"].lower()))


# --- Ereignisse --------------------------------------------------------------------------

CATEGORIES = {
    "peer": "Peers",
    "policy": "Richtlinien",
    "group": "Gruppen",
    "setupkey": "Setup-Keys",
    "user": "Benutzer",
    "network": "Netze",
    "service": "Reverse Proxy",
    "account": "Konto",
    "other": "Sonstige",
}

LABELS = {
    "peer.user.add": "Peer hinzugefügt",
    "peer.setupkey.add": "Peer über Setup-Key hinzugefügt",
    "user.peer.delete": "Peer gelöscht",
    "peer.rename": "Peer umbenannt",
    "peer.approve": "Peer freigegeben",
    "peer.approval.revoke": "Freigabe entzogen",
    "peer.login.expire": "Anmeldung abgelaufen",
    "user.peer.login": "Anmeldung am Peer",
    "peer.ssh.enable": "SSH am Peer eingeschaltet",
    "peer.ssh.disable": "SSH am Peer ausgeschaltet",
    "peer.login.expiration.enable": "Ablauf der Anmeldung eingeschaltet",
    "peer.login.expiration.disable": "Ablauf der Anmeldung ausgeschaltet",
    "policy.add": "Richtlinie angelegt",
    "policy.update": "Richtlinie geändert",
    "policy.delete": "Richtlinie gelöscht",
    "rule.add": "Regel angelegt",
    "rule.update": "Regel geändert",
    "rule.delete": "Regel gelöscht",
    "posture.check.create": "Posture Check angelegt",
    "posture.check.update": "Posture Check geändert",
    "posture.check.delete": "Posture Check gelöscht",
    "group.add": "Gruppe angelegt",
    "group.update": "Gruppe geändert",
    "group.delete": "Gruppe gelöscht",
    "peer.group.add": "Peer zur Gruppe hinzugefügt",
    "peer.group.delete": "Peer aus Gruppe entfernt",
    "user.group.add": "Benutzer zur Gruppe hinzugefügt",
    "user.group.delete": "Benutzer aus Gruppe entfernt",
    "resource.group.add": "Ressource zur Gruppe hinzugefügt",
    "resource.group.delete": "Ressource aus Gruppe entfernt",
    "setupkey.add": "Setup-Key angelegt",
    "setupkey.update": "Setup-Key geändert",
    "setupkey.revoke": "Setup-Key widerrufen",
    "setupkey.delete": "Setup-Key gelöscht",
    "setupkey.overuse": "Setup-Key zu oft benutzt",
    "setupkey.group.add": "Gruppe zum Setup-Key hinzugefügt",
    "setupkey.group.delete": "Gruppe vom Setup-Key entfernt",
    "user.join": "Benutzer beigetreten",
    "user.invite": "Benutzer eingeladen",
    "user.create": "Benutzer angelegt",
    "user.delete": "Benutzer gelöscht",
    "user.block": "Benutzer gesperrt",
    "user.unblock": "Benutzer entsperrt",
    "user.approve": "Benutzer freigegeben",
    "user.reject": "Benutzer abgelehnt",
    "user.role.update": "Rolle geändert",
    "service.user.create": "Dienstkonto angelegt",
    "service.user.delete": "Dienstkonto gelöscht",
    "personal.access.token.create": "API-Token angelegt",
    "personal.access.token.delete": "API-Token gelöscht",
    "dashboard.login": "Anmeldung am Dashboard",
    "route.add": "Route angelegt",
    "route.update": "Route geändert",
    "route.delete": "Route gelöscht",
    "network.create": "Netz angelegt",
    "network.update": "Netz geändert",
    "network.delete": "Netz gelöscht",
    "network.resource.create": "Ressource angelegt",
    "network.resource.update": "Ressource geändert",
    "network.resource.delete": "Ressource gelöscht",
    "network.router.create": "Routing-Peer angelegt",
    "network.router.update": "Routing-Peer geändert",
    "network.router.delete": "Routing-Peer gelöscht",
    "service.create": "Dienst angelegt",
    "service.update": "Dienst geändert",
    "service.delete": "Dienst gelöscht",
}


def category(code: str) -> str:
    if code.startswith("setupkey."):
        return "setupkey"
    if ".group." in code or code.startswith("group."):
        return "group"
    if code.startswith(("policy.", "rule.", "posture.")):
        return "policy"
    if code.startswith("peer.") or code.startswith("user.peer."):
        return "peer"
    if code.startswith(("user.", "service.user.", "personal.access.token.", "dashboard.")):
        return "user"
    if code.startswith(("network.", "route.", "nameserver.", "dns.")):
        return "network"
    if code.startswith(("service.", "domain.")):
        return "service"
    if code.startswith("account."):
        return "account"
    return "other"


def event_object(code: str, meta: Mapping[str, Any], target_id: str) -> str:
    if code in ("peer.group.add", "peer.group.delete"):
        return str(meta.get("peer_fqdn") or meta.get("peer_ip") or target_id)
    for key in ("name", "fqdn", "email", "resource_name", "group"):
        if meta.get(key):
            return str(meta[key])
    return target_id or DASH


def event_change(code: str, meta: Mapping[str, Any]) -> str:
    group = meta.get("group")
    if group and code.endswith(".group.add"):
        return f"+ {group}"
    if group and code.endswith(".group.delete"):
        return f"{MINUS} {group}"
    if code == "setupkey.add" and meta.get("type"):
        return f"Art {meta['type']}"
    if code == "user.role.update" and meta.get("role"):
        return f"Rolle {meta['role']}"
    return DASH


def event_label(code: str, activity: str) -> str:
    return LABELS.get(code) or activity or code
