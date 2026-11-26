"""Kategorien der Neuerungen aus dem Microsoft-365-Nachrichtencenter.

Die Kategorie ergibt sich aus den Diensten der Meldung (erster Dienst, der passt; Reihenfolge
der Regeln entscheidet bei mehreren Treffern). Wer bearbeitet, kann sie je Eintrag ändern; die
eigene Wahl bleibt, auch wenn Microsoft die Meldung aktualisiert.
"""

from collections.abc import Iterable

TOPIC_LABELS: dict[str, str] = {
    "exchange": "Exchange & Outlook",
    "teams": "Teams",
    "sharepoint": "SharePoint & OneDrive",
    "apps": "Microsoft 365 Apps",
    "copilot": "Copilot & KI",
    "sicherheit": "Sicherheit & Identität",
    "geraete": "Geräte & Intune",
    "allgemein": "Verwaltung & Allgemein",
}
TOPICS = tuple(TOPIC_LABELS)
FALLBACK = "allgemein"

# Reihenfolge = Vorrang (z. B. „Copilot in Teams“ ist Copilot)
_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("copilot", ("copilot",)),
    ("teams", ("teams",)),
    ("exchange", ("exchange", "outlook")),
    ("sharepoint", ("sharepoint", "onedrive")),
    (
        "sicherheit",
        ("entra", "defender", "purview", "security", "compliance", "identity", "active directory"),
    ),
    ("geraete", ("intune", "windows", "endpoint", "autopilot")),
    ("apps", ("microsoft 365 apps", "word", "excel", "powerpoint", "office")),
)


def topic_for(services: Iterable[str]) -> str:
    """Kategorie aus den Diensten; ohne Treffer „Verwaltung & Allgemein“."""
    for service in services:
        name = service.casefold()
        for topic, words in _RULES:
            if any(word in name for word in words):
                return topic
    return FALLBACK


def effective_topic(manual: str | None, services: Iterable[str]) -> str:
    return manual if manual in TOPIC_LABELS else topic_for(services)
