"""Regeln für Meldungen des Nachrichtencenters (spec.md 8.1 und 8.4).

Ohne KI und ohne Übertragung von Daten: Der Text wird an den bekannten Überschriften in
Abschnitte zerlegt, aus „When this will happen“ entstehen Vorschläge für Rollout-Phasen,
aus den Kennzeichen (``tags``) Art und Betroffene.
"""

import re
from typing import Any

SCHEDULE_HEAD = "When this will happen"
MAX_PHASES = 6
SECTION_TEXT_MAX = 8000
HEAD_MAX = 120

# Überschriften, die Microsoft in den Meldungen verwendet (ohne Doppelpunkt, klein)
KNOWN_HEADS = (
    "introduction",
    "what and why",
    "what is changing",
    "why are we making this change",
    "when this will happen",
    "when will this happen",
    "how this will affect your organization",
    "how this affects your organization",
    "how this will affect your users",
    "what you need to do to prepare",
    "what you can do to prepare",
    "what you need to do",
    "compliance considerations",
    "additional information",
    "learn more",
    "before rollout",
    "after rollout",
)

TAG_USER = "user impact"
TAG_ADMIN = "admin impact"

MONTHS = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}
_MONTH_RE = re.compile(
    r"\b(" + "|".join(MONTHS) + r")\b(?:\s+\d{1,2}(?:st|nd|rd|th)?)?,?\s+(\d{4})",
    re.IGNORECASE,
)
_BRACKET_HEAD = re.compile(rf"^\[([^\[\]]{{2,{HEAD_MAX}}}?):?\]$")
_PHASE_LINE = re.compile(r"^(?P<name>[^:]{2,80}):\s*(?P<rest>.+)$")
_REGIONS = {"worldwide": "weltweit"}


def _head_of(line: str) -> tuple[str, str] | None:
    """Erkennt eine Überschrift am Anfang einer Zeile. Ergebnis: (Überschrift, Rest)."""
    stripped = line.strip()
    bracket = _BRACKET_HEAD.match(stripped)
    if bracket:
        return bracket.group(1).strip().rstrip(":"), ""
    plain = stripped.strip("[]*").strip()
    lowered = plain.casefold()
    for head in KNOWN_HEADS:
        if lowered == head or lowered == head + ":":
            return plain.rstrip(":").strip(), ""
        if lowered.startswith(head + ":"):
            return plain[: len(head)].strip(), plain[len(head) + 1 :].strip()
    return None


def split_sections(text: str | None) -> list[dict[str, Any]]:
    """Zerlegt den Text einer Meldung in Abschnitte (Überschrift, Text).

    Findet sich keine Überschrift, ist das Ergebnis ein einziger Abschnitt ohne Überschrift
    (die Meldung wird dann als Ganzes angezeigt). Text vor der ersten Überschrift wird ein
    Abschnitt ohne Überschrift.
    """
    if not text:
        return []
    sections: list[dict[str, Any]] = []
    head: str | None = None
    lines: list[str] = []
    found = False

    def flush() -> None:
        body = "\n".join(lines).strip()
        if body or head:
            sections.append({"head": head, "text": body[:SECTION_TEXT_MAX]})

    for line in text.splitlines():
        match = _head_of(line)
        if match is None:
            lines.append(line)
            continue
        found = True
        flush()
        head = match[0][:HEAD_MAX]
        lines = [match[1]] if match[1] else []
    flush()
    if not found:
        return [{"head": None, "text": text.strip()[:SECTION_TEXT_MAX]}]
    return sections


def schedule_text(sections: list[dict[str, Any]]) -> str | None:
    """Text des Abschnitts „When this will happen“, falls vorhanden."""
    for section in sections:
        head = section.get("head")
        if isinstance(head, str) and head.casefold() in (
            "when this will happen",
            "when will this happen",
        ):
            text = section.get("text")
            return text if isinstance(text, str) and text else None
    return None


def _phase_name(raw: str) -> str:
    name = " ".join(raw.split())
    lowered = name.casefold()
    region = ""
    paren = re.search(r"\(([^)]{1,40})\)", name)
    if paren:
        inner = paren.group(1).strip()
        region = f" ({_REGIONS.get(inner.casefold(), inner)})"
    if "targeted release" in lowered:
        return "Targeted Release" + region
    if "general availability" in lowered:
        return "Allgemein verfügbar" + region
    if "preview" in lowered:
        return "Vorschau" + region
    return name[:60]


def _months(text: str) -> list[str]:
    return [
        f"{int(year):04d}-{MONTHS[month.casefold()]:02d}" for month, year in _MONTH_RE.findall(text)
    ]


def parse_phases(schedule: str | None) -> list[dict[str, str]]:
    """Rollout-Phasen aus „When this will happen“, je Zeile „<Phase>: <Zeitangabe>“.

    Beginn ist der erste, Ende der letzte genannte Monat der Zeile. Eine Zeile ohne Namen,
    aber mit Monaten, wird die Phase „Rollout“, wenn sonst keine Phase erkannt wurde.
    """
    if not schedule:
        return []
    phases: list[dict[str, str]] = []
    unnamed: list[str] = []
    for line in schedule.splitlines():
        line = line.strip().lstrip("•-* ").strip()
        if not line:
            continue
        months = _months(line)
        if not months:
            continue
        match = _PHASE_LINE.match(line)
        if match and not _months(match.group("name")):
            phases.append(
                {"name": _phase_name(match.group("name")), "start": months[0], "end": months[-1]}
            )
        else:
            unnamed.extend(months)
        if len(phases) >= MAX_PHASES:
            break
    if not phases and unnamed:
        phases.append({"name": "Rollout", "start": unnamed[0], "end": unnamed[-1]})
    return phases


def _tags(tags: list[str] | None) -> set[str]:
    return {tag.casefold() for tag in tags or []}


def suggest_affected(tags: list[str] | None) -> str | None:
    found = _tags(tags)
    user, admin = TAG_USER in found, TAG_ADMIN in found
    if user and admin:
        return "Nutzer und Admins"
    if user:
        return "Nutzer"
    if admin:
        return "Admins"
    return None


def kind_label(tags: list[str] | None, category: str | None) -> str | None:
    """Art der Meldung für Badge und Liste."""
    found = _tags(tags)
    if "retirement" in found:
        return "Abkündigung"
    if "new feature" in found:
        return "Neue Funktion"
    if "feature update" in found:
        return "Funktionsupdate"
    if category == "planForChange":
        return "Änderung"
    if category == "preventOrFixIssue":
        return "Problem vermeiden"
    if category == "stayInformed":
        return "Information"
    return None


def info_only(tags: list[str] | None, category: str | None) -> bool:
    """Reine Info-Meldung: Kategorie „stayInformed“ ohne Auswirkung auf Nutzer oder Admins."""
    found = _tags(tags)
    return category == "stayInformed" and TAG_USER not in found and TAG_ADMIN not in found
