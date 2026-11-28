"""Befunde: Prüfregeln für Policies und Objekte eines Geräts.

Alles hier arbeitet nur auf den gespeicherten Daten und ist ohne Datenbank testbar. Geprüft
werden nur eingeschaltete Policies mit „accept“; „any“ in deny-Policies ist kein Befund.

Interfaces gelten als Internet-Seite (WAN), wenn ihre Rolle „wan“ ist. Zonen und SD-WAN-Zonen
zählen als WAN, wenn ein Mitglied die Rolle „wan“ hat. „any“ als Interface kann beides sein.
"""

import hashlib
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from werkbank.modules.monitoring.fortigate.analysis import (
    OPEN_INTERFACES,
    IPv4Net,
    PortRange,
    Resolver,
)

HIGH = "hoch"
MEDIUM = "mittel"
INFO = "hinweis"
SEVERITIES = (HIGH, MEDIUM, INFO)
SEVERITY_LABELS = {HIGH: "Hoch", MEDIUM: "Mittel", INFO: "Hinweis"}


@dataclass(frozen=True)
class Rule:
    code: str
    severity: str
    title: str
    description: str


RULES: tuple[Rule, ...] = (
    Rule(
        "any_any_all",
        HIGH,
        "Alles erlaubt (any/any/ALL)",
        "Erlaubt Quelle „all“, Ziel „all“ und alle Dienste.",
    ),
    Rule(
        "wan_any_internal",
        HIGH,
        "Aus dem Internet von überall nach innen",
        "Erlaubt Verbindungen von einem WAN-Interface mit Quelle „all“ zu einem internen Ziel.",
    ),
    Rule(
        "sensitive_nolog",
        HIGH,
        "Ohne Protokoll in schützenswerter Zone",
        "Erlaubt Verbindungen von oder zu einer schützenswerten Zone, ohne sie zu protokollieren.",
    ),
    Rule(
        "service_all",
        MEDIUM,
        "Alle Dienste erlaubt",
        "Erlaubt den Dienst „ALL“ statt einzelner Dienste.",
    ),
    Rule(
        "dst_any_internal",
        MEDIUM,
        "Ziel „all“ im internen Netz",
        "Erlaubt das Ziel „all“, obwohl die Verbindung nicht nur ins Internet geht.",
    ),
    Rule(
        "shadowed",
        MEDIUM,
        "Verdeckte Policy",
        "Eine Policy weiter oben deckt alle Verbindungen ab; diese Policy greift nie.",
    ),
    Rule(
        "name_differs",
        MEDIUM,
        "Gleicher Name, anderer Inhalt",
        "Ein lokales Objekt heißt auf mehreren Geräten gleich, hat aber einen anderen Inhalt.",
    ),
    Rule(
        "fabric_differs",
        MEDIUM,
        "Fabric-Objekt weicht ab",
        "Ein Fabric-Objekt hat auf einem Gerät einen anderen Inhalt oder fehlt.",
    ),
    Rule(
        "no_hits",
        INFO,
        "Keine Treffer im Zeitraum",
        "Die Policy hatte im eingestellten Zeitraum keinen Treffer.",
    ),
    Rule(
        "unused_objects",
        INFO,
        "Unbenutzte Objekte",
        "Objekte, auf die seit dem eingestellten Zeitraum nichts mehr verweist.",
    ),
    Rule(
        "internet_no_profiles",
        INFO,
        "Ins Internet ohne Sicherheitsprofile",
        "Erlaubt Verbindungen ins Internet ohne Virenschutz, Webfilter, IPS oder App-Kontrolle.",
    ),
)
RULES_BY_CODE = {rule.code: rule for rule in RULES}

# Zeitraum ohne Treffer bzw. Nutzung, ab dem ein Hinweis entsteht
UNUSED_DAYS = (30, 60, 90, 180, 365)
UNUSED_DAYS_DEFAULT = 90
# Profile, von denen mindestens eines für Internet-Verkehr erwartet wird (SSL zählt nicht)
SECURITY_PROFILES = ("av", "web", "ips", "app", "dns", "file", "group")


@dataclass(frozen=True)
class Options:
    """Einstellungen der Prüfung (Verwaltung, FortiGate)."""

    disabled: frozenset[str] = frozenset()
    sensitive: frozenset[str] = frozenset()
    unused_days: int = UNUSED_DAYS_DEFAULT

    def active(self, code: str) -> bool:
        return code not in self.disabled


@dataclass(frozen=True)
class Finding:
    code: str
    # Gerätename; leer bei Befunden über alle Geräte (Objekte gleichen Namens)
    device: str
    # Worum es geht, eindeutig je Regel und Gerät, z. B. „policy:7“ oder „addresses:srv-app“
    subject: str
    label: str
    detail: str
    # Fingerabdruck des Gegenstands; ändert er sich, fällt eine Ausnahme weg
    digest: str
    policy_id: int | None = None

    @property
    def rule(self) -> Rule:
        return RULES_BY_CODE[self.code]

    @property
    def severity(self) -> str:
        return self.rule.severity

    @property
    def key(self) -> str:
        return f"{self.device}|{self.code}|{self.subject}"


def fingerprint(value: object) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def policy_label(policy: Mapping[str, Any]) -> str:
    name = str(policy.get("name") or "")
    return f"Policy {policy.get('id')}" + (f" „{name}“" if name else "")


# --- Interfaces ----------------------------------------------------------------------------


def wan_names(config: Mapping[str, Any]) -> frozenset[str]:
    """Namen der Interfaces, Zonen und SD-WAN-Zonen auf der Internet-Seite."""
    wan = {
        str(item.get("name"))
        for item in config.get("interfaces") or []
        if item.get("role") == "wan" and item.get("name")
    }
    for zone in config.get("zones") or []:
        if any(member in wan for member in zone.get("interfaces") or []):
            wan.add(str(zone.get("name")))
    for zone_name, members in (config.get("sdwan_zones") or {}).items():
        if any(member in wan for member in members or []):
            wan.add(str(zone_name))
    return frozenset(wan)


def zone_members(config: Mapping[str, Any]) -> dict[str, set[str]]:
    """Zone → Interfaces (normale und SD-WAN-Zonen), für die schützenswerten Zonen."""
    out: dict[str, set[str]] = {}
    for zone in config.get("zones") or []:
        out[str(zone.get("name"))] = set(zone.get("interfaces") or [])
    for zone_name, members in (config.get("sdwan_zones") or {}).items():
        out.setdefault(str(zone_name), set()).update(members or [])
    return out


def touches(names: Iterable[str], wanted: frozenset[str], zones: Mapping[str, set[str]]) -> bool:
    """Steht eines der Interfaces (oder ein Mitglied einer Zone) in der gesuchten Menge?"""
    for name in names:
        if name in wanted or zones.get(name, set()) & wanted:
            return True
        # Eine schützenswerte Zone über ihr Interface angegeben
        if any(name in members for zone, members in zones.items() if zone in wanted):
            return True
    return False


def is_internet_only(intfs: Iterable[str], wan: frozenset[str]) -> bool:
    names = list(intfs)
    return bool(names) and all(name in wan for name in names)


def reaches_inside(intfs: Iterable[str], wan: frozenset[str]) -> bool:
    """Geht die Verbindung (auch) auf die interne Seite? „any“ zählt dazu."""
    return any(name in OPEN_INTERFACES or name not in wan for name in intfs)


def from_internet(intfs: Iterable[str], wan: frozenset[str]) -> bool:
    return any(name in wan or name in OPEN_INTERFACES for name in intfs)


# --- Verdeckte Policies --------------------------------------------------------------------


@dataclass
class Shape:
    """Was eine Policy abdeckt, vorbereitet für den Vergleich."""

    policy: dict[str, Any]
    srcintf: set[str]
    dstintf: set[str]
    src: list[IPv4Net] | None
    dst: list[IPv4Net] | None
    src_open: bool
    dst_open: bool
    ports: list[PortRange] | None
    svc_open: bool
    plain: bool  # ohne Negation, Internet-Dienste und Benutzer: vergleichbar


def _nets(resolver: Resolver, names: list[str]) -> list[IPv4Net] | None:
    out: list[IPv4Net] = []
    for name in names:
        nets = resolver.networks(name)
        if nets is None:
            return None
        out.extend(nets)
    return out


def _ports(resolver: Resolver, names: list[str]) -> list[PortRange] | None:
    out: list[PortRange] = []
    for name in names:
        ranges = resolver.ports(name)
        if not ranges:
            # Offen oder ohne Ports (ICMP, IP-Protokoll): nur über den Namen vergleichbar
            return None
        out.extend(ranges)
    return out


def shape(policy: dict[str, Any], resolver: Resolver) -> Shape:
    src = list(policy.get("srcaddr") or [])
    dst = list(policy.get("dstaddr") or [])
    svc = list(policy.get("service") or [])
    return Shape(
        policy=policy,
        srcintf=set(policy.get("srcintf") or []),
        dstintf=set(policy.get("dstintf") or []),
        src=_nets(resolver, src),
        dst=_nets(resolver, dst),
        src_open=any(resolver.is_open_address(n) for n in src),
        dst_open=any(resolver.is_open_address(n) for n in dst),
        ports=_ports(resolver, svc),
        svc_open=any(resolver.is_open_service(n) for n in svc),
        plain=not (
            policy.get("srcaddr_negate")
            or policy.get("dstaddr_negate")
            or policy.get("service_negate")
            or policy.get("internet_service")
            or policy.get("users")
        )
        and bool(src and dst and svc),
    )


def _covers_intf(earlier: set[str], later: set[str]) -> bool:
    return bool(earlier & OPEN_INTERFACES) or (bool(later) and later <= earlier)


def _covers_nets(
    e_open: bool,
    e_nets: list[IPv4Net] | None,
    e_names: list[str],
    l_open: bool,
    l_nets: list[IPv4Net] | None,
    l_names: list[str],
) -> bool:
    if e_open:
        return True
    if l_open:
        return False
    if e_nets is None or l_nets is None or not l_nets:
        return set(l_names) <= set(e_names)
    return all(any(net.subnet_of(other) for other in e_nets) for net in l_nets)


def _covers_ports(
    e_open: bool,
    e_ports: list[PortRange] | None,
    e_names: list[str],
    l_open: bool,
    l_ports: list[PortRange] | None,
    l_names: list[str],
) -> bool:
    if e_open:
        return True
    if l_open:
        return False
    if e_ports is None or l_ports is None:
        return set(l_names) <= set(e_names)
    return all(
        any(p == q and lo >= qlo and hi <= qhi for q, qlo, qhi in e_ports) for p, lo, hi in l_ports
    )


def covers(earlier: Shape, later: Shape) -> bool:
    """Deckt `earlier` alles ab, was `later` erlaubt oder verbietet?"""
    a, b = earlier.policy, later.policy
    if not (earlier.plain and later.plain):
        return False
    if a.get("schedule") not in ("", "always", b.get("schedule")):
        return False
    return (
        _covers_intf(earlier.srcintf, later.srcintf)
        and _covers_intf(earlier.dstintf, later.dstintf)
        and _covers_nets(
            earlier.src_open,
            earlier.src,
            a.get("srcaddr") or [],
            later.src_open,
            later.src,
            b.get("srcaddr") or [],
        )
        and _covers_nets(
            earlier.dst_open,
            earlier.dst,
            a.get("dstaddr") or [],
            later.dst_open,
            later.dst,
            b.get("dstaddr") or [],
        )
        and _covers_ports(
            earlier.svc_open,
            earlier.ports,
            a.get("service") or [],
            later.svc_open,
            later.ports,
            b.get("service") or [],
        )
    )


def shadowed(config: Mapping[str, Any]) -> dict[int, dict[str, Any]]:
    """Policy-ID → die erste eingeschaltete Policy weiter oben, die sie ganz abdeckt."""
    resolver = Resolver(dict(config))
    shapes = [
        shape(p, resolver) for p in config.get("policies") or [] if p.get("status", True) is True
    ]
    out: dict[int, dict[str, Any]] = {}
    for index, later in enumerate(shapes):
        for earlier in shapes[:index]:
            if covers(earlier, later):
                out[int(later.policy.get("id") or 0)] = earlier.policy
                break
    return out


# --- Prüfung eines Geräts ------------------------------------------------------------------


def _ts(value: object) -> datetime | None:
    return datetime.fromtimestamp(value, UTC) if isinstance(value, int) and value > 0 else None


def policy_findings(
    device: str,
    config: Mapping[str, Any],
    runtime: Mapping[str, Any],
    options: Options,
    *,
    now: datetime,
    observed_since: datetime | None,
) -> list[Finding]:
    """Befunde zu den Policies eines Geräts (in der Reihenfolge des Geräts)."""
    resolver = Resolver(dict(config))
    wan = wan_names(config)
    zones = zone_members(config)
    hits = runtime.get("hits") or {}
    hidden = shadowed(config) if options.active("shadowed") else {}
    period = timedelta(days=options.unused_days)
    out: list[Finding] = []
    for policy in config.get("policies") or []:
        if policy.get("status", True) is not True or policy.get("action") != "accept":
            continue
        pid = int(policy.get("id") or 0)
        label = policy_label(policy)
        digest = fingerprint(policy)
        srcintf = list(policy.get("srcintf") or [])
        dstintf = list(policy.get("dstintf") or [])
        src_open = not policy.get("srcaddr_negate") and any(
            resolver.is_open_address(n) for n in policy.get("srcaddr") or []
        )
        dst_open = (
            not policy.get("dstaddr_negate")
            and not policy.get("internet_service")
            and any(resolver.is_open_address(n) for n in policy.get("dstaddr") or [])
        )
        svc_open = not policy.get("service_negate") and any(
            resolver.is_open_service(n) for n in policy.get("service") or []
        )

        found: list[tuple[str, str]] = []

        def add(code: str, detail: str, found: list[tuple[str, str]] = found) -> None:
            if options.active(code):
                found.append((code, detail))

        all_open = src_open and dst_open and svc_open
        if all_open:
            add("any_any_all", "Quelle, Ziel und Dienst sind offen.")
        if src_open and from_internet(srcintf, wan) and reaches_inside(dstintf, wan):
            add(
                "wan_any_internal",
                f"Von {', '.join(srcintf)} mit Quelle „all“ nach {', '.join(dstintf)}.",
            )
        if (
            options.sensitive
            and policy.get("log") == "disable"
            and (
                touches(srcintf, options.sensitive, zones)
                or touches(dstintf, options.sensitive, zones)
            )
        ):
            add("sensitive_nolog", "Protokoll ist aus.")
        if svc_open and not all_open:
            add("service_all", "Dienst „ALL“.")
        if dst_open and not all_open and reaches_inside(dstintf, wan):
            add("dst_any_internal", f"Ziel „all“ über {', '.join(dstintf) or '-'}.")
        if pid in hidden:
            add("shadowed", f"Verdeckt von {policy_label(hidden[pid])}.")
        if (
            is_internet_only(dstintf, wan)
            and not any(key in (policy.get("profiles") or {}) for key in SECURITY_PROFILES)
            and options.active("internet_no_profiles")
        ):
            add("internet_no_profiles", "Nur die SSL-Prüfung oder gar kein Profil.")
        counter = hits.get(str(pid))
        if (
            counter is not None
            and observed_since is not None
            and now - observed_since >= period
            and options.active("no_hits")
        ):
            last = _ts(counter.get("last_used"))
            if last is None and not counter.get("hits"):
                add(
                    "no_hits",
                    "Kein Treffer seit dem letzten Zurücksetzen des Zählers "
                    "(Neustart oder Update setzt ihn zurück).",
                )
            elif last is not None and now - last >= period:
                add("no_hits", f"Zuletzt genutzt am {last:%d.%m.%Y}.")
        out.extend(
            Finding(code, device, f"policy:{pid}", label, detail, digest, pid)
            for code, detail in found
        )
    return out


def object_findings(
    states: Mapping[tuple[str, str], tuple[list[Any], Any]], options: Options
) -> list[Finding]:
    """Befunde zu Objekten über alle Geräte (Ergebnis von views._sync_rows)."""
    out: list[Finding] = []
    for (kind, name), (entries, state) in sorted(states.items()):
        values = sorted((e.device, e.value) for e in entries)
        digest = fingerprint(values)
        devices = ", ".join(sorted({e.device for e in entries}))
        if state.state == "abweichend" and options.active("fabric_differs"):
            out.append(
                Finding(
                    "fabric_differs",
                    "",
                    f"{kind}:{name}",
                    name,
                    f"Auf {devices}; Inhalt oder Vorhandensein unterscheidet sich.",
                    digest,
                )
            )
        elif (
            state.state == "lokal_mehrfach"
            and len({e.value for e in entries}) > 1
            and options.active("name_differs")
        ):
            out.append(
                Finding(
                    "name_differs",
                    "",
                    f"{kind}:{name}",
                    name,
                    "; ".join(f"{d}: {v}" for d, v in values),
                    digest,
                )
            )
    return out


def unused_finding(device: str, names: list[str], options: Options) -> Finding | None:
    if not names or not options.active("unused_objects"):
        return None
    count = len(names)
    return Finding(
        "unused_objects",
        device,
        "objects",
        f"{count} Objekt" if count == 1 else f"{count} Objekte",
        f"Seit mindestens {options.unused_days} Tagen unbenutzt.",
        fingerprint(sorted(names)),
    )
