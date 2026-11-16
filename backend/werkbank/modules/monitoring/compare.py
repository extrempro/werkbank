"""Abgleich NetBox-DNS ↔ öffentliches DNS, reine Logik ohne Netzwerk.

Grundlage ist der NetBox-DNS-Abgleich aus den IT-Tools, beschränkt auf die Einträge aus NetBox:
Gesucht wird nichts Neues, geprüft wird nur, ob die Einträge aus NetBox öffentlich so stehen.
Namen werden klein und ohne Punkt am Ende geführt.
"""

import ipaddress
import re
from dataclasses import dataclass, field
from typing import Any

# Status einer Zeile
OK = "ok"
DIFF = "abweichend"
MISSING = "fehlt"
INACTIVE = "inaktiv"
ERROR = "fehler"
PROBLEMS = (DIFF, MISSING, ERROR)

# Typen, die der Abgleich prüft; andere Einträge aus NetBox werden gezählt, aber nicht abgefragt
CHECKED_TYPES = ("A", "AAAA", "CNAME", "MX", "TXT", "CAA", "NS", "SRV", "PTR", "SOA", "SPF")

# Felder des SOA, die zählen (die Seriennummer ändert sich laufend)
SOA_LABELS = (
    ("mname", "Primärer Nameserver", True),
    ("rname", "Verantwortlich", True),
    ("serial", "Seriennummer", False),
    ("refresh", "Refresh", True),
    ("retry", "Retry", True),
    ("expire", "Expire", True),
    ("minimum", "Negativ-TTL", True),
)


def strip_dot(name: str) -> str:
    return name.strip().lower().removesuffix(".")


def name_candidates(value: str, zone: str | None = None) -> list[str]:
    """Zielnamen: mit Punkt am Ende absolut, sonst relativ zur Zone; mit Punkten mehrdeutig."""
    clean = value.strip().lower()
    if clean == "@" and zone:
        return [strip_dot(zone)]
    if clean.endswith(".") or not zone:
        return [strip_dot(clean)]
    relative = f"{clean}.{strip_dot(zone)}"
    return [clean, relative] if "." in clean else [relative]


def txt_content(value: str) -> str:
    """Inhalt von TXT-Daten: "a" "b" → ab; ohne Anführungszeichen unverändert."""
    clean = value.strip()
    if not clean.startswith('"'):
        return clean
    out = []
    for match in re.finditer(r'"((?:[^"\\]|\\.)*)"', clean):
        out.append(
            re.sub(
                r"\\(\d{3}|.)",
                lambda esc: chr(int(esc.group(1))) if len(esc.group(1)) == 3 else esc.group(1),
                match.group(1),
            )
        )
    return "".join(out)


def caa_normalized(value: str) -> str:
    clean = value.strip()
    if clean.startswith("\\#"):
        parts = clean[2:].split()
        raw = bytes.fromhex("".join(parts[1:])) if len(parts) > 1 else b""
        if len(raw) >= 2:
            tag_len = raw[1]
            tag = raw[2 : 2 + tag_len].decode("ascii", "replace").lower()
            content = raw[2 + tag_len :].decode("utf-8", "replace")
            return f"{raw[0]} {tag} {content}"
    match = re.match(r"^(\d+)\s+(\S+)\s+(.*)$", clean)
    if not match:
        return clean.lower()
    return f"{int(match.group(1))} {match.group(2).lower()} {txt_content(match.group(3))}"


def _number(text: str) -> str:
    return str(int(text)) if text.isdigit() else text


def normalize_value(type_name: str, value: str, zone: str | None = None) -> list[str]:
    """Mögliche normalisierte Formen eines Werts (NetBox: mit Zone für relative Namen)."""
    clean = value.strip()
    kind = type_name.upper()
    if kind in ("A", "AAAA"):
        try:
            return [str(ipaddress.ip_address(clean))]
        except ValueError:
            return [clean.lower()]
    if kind in ("CNAME", "NS", "PTR", "DNAME"):
        return name_candidates(clean, zone)
    if kind == "MX":
        parts = clean.split()
        preference, target = [*parts, "", ""][:2]
        return [f"{_number(preference)} {t}" for t in name_candidates(target, zone)]
    if kind == "SRV":
        parts = clean.split()
        priority, weight, port, target = [*parts, "", "", "", ""][:4]
        head = f"{_number(priority)} {_number(weight)} {_number(port)}"
        return [f"{head} {t}" for t in name_candidates(target, zone)]
    if kind in ("TXT", "SPF"):
        return [txt_content(clean)]
    if kind == "CAA":
        return [caa_normalized(clean)]
    return [re.sub(r"\s+", " ", clean.lower())]


def parse_soa(value: str) -> dict[str, str] | None:
    parts = value.strip().split()
    if len(parts) < 7:
        return None
    keys = [key for key, _, _ in SOA_LABELS]
    soa = dict(zip(keys, parts[:7], strict=True))
    soa["mname"] = strip_dot(soa["mname"])
    soa["rname"] = strip_dot(soa["rname"])
    return soa


def soa_key(value: str) -> str:
    soa = parse_soa(value)
    if soa is None:
        return value.strip().lower()
    return " ".join(soa[key] for key, _, counts in SOA_LABELS if counts)


def compare_values(
    type_name: str, zone: str, expected: list[str], public: list[str]
) -> tuple[list[str], list[str]]:
    """Was in NetBox steht, aber öffentlich fehlt, und was öffentlich zusätzlich da ist."""
    if type_name.upper() == "SOA":
        public_keys = [soa_key(value) for value in public]
        expected_keys = [soa_key(value) for value in expected]
        missing = [value for value in expected if soa_key(value) not in public_keys]
        extra = [value for value in public if soa_key(value) not in expected_keys]
        return missing, extra
    normalized = [normalize_value(type_name, value)[0] for value in public]
    matched: set[int] = set()
    missing = []
    for value in expected:
        candidates = normalize_value(type_name, value, zone)
        hits = [index for index, norm in enumerate(normalized) if norm in candidates]
        if hits:
            matched.update(hits)
        else:
            missing.append(value)
    extra = [value for index, value in enumerate(public) if index not in matched]
    return missing, extra


def is_private_reverse_zone(zone: str) -> bool:
    """Reverse-Zonen privater Adressen gibt es im öffentlichen DNS nicht."""
    name = strip_dot(zone)
    if name.endswith(".in-addr.arpa"):
        octets = list(reversed(name.removesuffix(".in-addr.arpa").split(".")))
        try:
            first = int(octets[0])
            second = int(octets[1]) if len(octets) > 1 else None
        except ValueError:
            return False
        return (
            first in (10, 127)
            or (first == 192 and second == 168)
            or (first == 169 and second == 254)
            or (first == 172 and second is not None and 16 <= second <= 31)
        )
    if name.endswith(".ip6.arpa"):
        nibbles = "".join(reversed(name.removesuffix(".ip6.arpa").split(".")))
        return bool(re.match(r"^f[cd]", nibbles) or re.match(r"^fe[89ab]", nibbles))
    return False


def record_fqdn(record: dict[str, Any]) -> str:
    fqdn = record.get("fqdn")
    if isinstance(fqdn, str) and fqdn:
        return strip_dot(fqdn)
    zone = strip_dot(str(record["zone"]["name"]))
    name = str(record.get("name", "")).strip().lower()
    return zone if name in ("@", "") else f"{strip_dot(name)}.{zone}"


@dataclass(frozen=True)
class Delegation:
    fqdn: str
    targets: tuple[str, ...]


def find_delegations(records: list[dict[str, Any]], zone_names: set[str]) -> list[Delegation]:
    """Aktive NS-Einträge unterhalb der Zonenspitze ohne eigene Zone: extern verwaltet."""
    found: dict[str, list[str]] = {}
    for record in records:
        if (
            str(record.get("type", "")).upper() != "NS"
            or record.get("status", "active") != "active"
        ):
            continue
        fqdn = record_fqdn(record)
        if fqdn == strip_dot(str(record["zone"]["name"])) or fqdn in zone_names:
            continue
        found.setdefault(fqdn, []).append(strip_dot(str(record.get("value", ""))))
    return [Delegation(fqdn, tuple(targets)) for fqdn, targets in sorted(found.items())]


def excluded_by_delegation(fqdn: str, type_name: str, delegations: list[Delegation]) -> bool:
    """Unter einer Delegation verwaltet ein anderer; nur deren NS-Einträge bleiben im Abgleich."""
    best: Delegation | None = None
    for delegation in delegations:
        if (fqdn == delegation.fqdn or fqdn.endswith("." + delegation.fqdn)) and (
            best is None or len(delegation.fqdn) > len(best.fqdn)
        ):
            best = delegation
    return best is not None and not (fqdn == best.fqdn and type_name.upper() == "NS")


@dataclass
class PublicAnswer:
    values: list[str] = field(default_factory=list)
    ttl: int | None = None
    # Öffentlich ist der Name ein CNAME (bei Abfrage eines anderen Typs)
    cname: str | None = None
    error: str | None = None


@dataclass
class Row:
    fqdn: str
    type: str
    zone: str
    status: str
    netbox: list[str]
    inactive: list[str]
    public: list[str]
    missing: list[str]
    extra: list[str]
    notes: list[str]
    # Link auf den ersten Eintrag in NetBox
    netbox_url: str | None = None

    @property
    def key(self) -> str:
        return f"{self.fqdn}|{self.type}"


def build_row(
    *,
    fqdn: str,
    type_name: str,
    zone: str,
    expected: list[str],
    inactive: list[str],
    answer: PublicAnswer,
    configured_ttl: int | None,
    compare_ttl: bool,
    netbox_url: str | None = None,
) -> Row:
    row = Row(
        fqdn=fqdn,
        type=type_name.upper(),
        zone=zone,
        status=OK,
        netbox=expected,
        inactive=inactive,
        public=answer.values,
        missing=[],
        extra=[],
        notes=[],
        netbox_url=netbox_url,
    )
    if answer.cname:
        row.notes.append(f"Öffentlich ist {fqdn} ein CNAME auf {answer.cname}.")
    if answer.error:
        row.status = ERROR
        row.notes.append(answer.error)
        return row
    if not expected:
        if answer.values:
            row.status = DIFF
            row.extra = list(answer.values)
            row.notes.append("In NetBox nur inaktiv erfasst, öffentlich aber vorhanden.")
        else:
            row.status = INACTIVE
            row.notes.append("In NetBox inaktiv, öffentlich wie erwartet nicht vorhanden.")
        return row
    row.missing, row.extra = compare_values(type_name, zone, expected, answer.values)
    if not answer.values:
        row.status = MISSING
    elif row.missing or row.extra:
        row.status = DIFF
    if row.type == "SOA" and answer.values and expected:
        mine, theirs = parse_soa(expected[0]), parse_soa(answer.values[0])
        if mine and theirs:
            differing = [
                label for key, label, counts in SOA_LABELS if counts and mine[key] != theirs[key]
            ]
            if differing:
                row.notes.append(f"Abweichend: {', '.join(differing)}.")
            if mine["serial"] != theirs["serial"]:
                row.notes.append(
                    "Seriennummer unterschiedlich, die Zone ist eventuell noch nicht neu geladen "
                    "(zählt nicht als Abweichung)."
                )
    if (
        compare_ttl
        and row.status == OK
        and answer.ttl is not None
        and configured_ttl is not None
        and answer.ttl > configured_ttl
    ):
        # Resolver liefern die Rest-TTL aus dem Cache; nur „größer als in NetBox“ weicht ab
        row.status = DIFF
        row.notes.append(f"TTL öffentlich {answer.ttl} s, in NetBox {configured_ttl} s.")
    return row
