"""Vorgaben und Platzhalter für Mails an den Melder (Anrede „du“, je Bereich änderbar)."""

import re
from collections.abc import Mapping

# Dateitypen für Anhänge (Positivliste), siehe mailparse.detect_type
ALL_TYPES = (
    "pdf",
    "png",
    "jpg",
    "gif",
    "webp",
    "docx",
    "xlsx",
    "pptx",
    "txt",
    "csv",
    "eml",
    "msg",
    "zip",
)
DEFAULT_TYPES = list(ALL_TYPES)

EVENTS = ("in_progress", "assignee", "waiting", "solved", "closed")
DEFAULT_EVENTS = {
    "in_progress": False,
    "assignee": False,
    "waiting": True,
    "solved": True,
    "closed": False,
}

DEFAULT_ACK = (
    "Hallo {Name},\n\n"
    "danke für deine Nachricht. Dein Anliegen „{Betreff}“ hat die Nummer {Nr}. "
    "Wir melden uns, sobald wir mehr wissen.\n\n"
    "Wenn du noch etwas ergänzen möchtest, antworte einfach auf diese Mail."
)

EVENT_TEXTS = {
    "in_progress": "Hallo {Name},\n\nwir bearbeiten dein Anliegen „{Betreff}“ ({Nr}) jetzt.",
    "assignee": "Hallo {Name},\n\ndein Anliegen „{Betreff}“ ({Nr}) bearbeitet jetzt {Bearbeiter}.",
    "waiting": (
        "Hallo {Name},\n\nfür dein Anliegen „{Betreff}“ ({Nr}) brauchen wir noch eine Rückmeldung "
        "von dir. Antworte bitte einfach auf diese Mail."
    ),
    "solved": (
        "Hallo {Name},\n\ndein Anliegen „{Betreff}“ ({Nr}) ist gelöst. Wenn noch etwas nicht "
        "passt, antworte einfach auf diese Mail."
    ),
    "closed": "Hallo {Name},\n\ndein Anliegen „{Betreff}“ ({Nr}) ist abgeschlossen.",
}

REPLY_ABOVE = "Bitte oberhalb dieser Zeile antworten."

_PLACEHOLDER = re.compile(r"\{(Nr|Betreff|Name|Vorname|Bearbeiter|Datum)\}")


def first_name(name: str) -> str:
    """Vorname aus „Vorname Nachname“ oder „Nachname, Vorname“; sonst der Name."""
    name = name.strip()
    if "," in name:
        rest = name.split(",", 1)[1].strip()
        return rest.split()[0] if rest else name
    parts = name.split()
    return parts[0] if parts else ""


def fill(template: str, values: Mapping[str, str]) -> str:
    """Setzt Platzhalter ein. Unbekannte bleiben stehen; Werte werden nicht erneut ersetzt.

    Das Ergebnis ist Text. Für HTML kodiert der Aufrufer es (html.escape), damit eingesetzte
    Werte (z. B. ein Betreff mit spitzen Klammern) nie als HTML wirken.
    """
    return _PLACEHOLDER.sub(lambda m: values.get(m.group(1), m.group(0)), template)
