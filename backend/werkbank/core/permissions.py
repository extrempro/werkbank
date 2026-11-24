"""Berechtigungen der Werkbank: je Person und Bereich eine Stufe (docs/spec.md, Kapitel 4 und 6.1a).

Wer sich anmelden darf und wer in die Verwaltung darf, entscheiden zwei Gruppen in Entra
(Objekt-IDs in der Konfiguration, geprüft bei der Anmeldung über Graph). Was jemand in den
Bereichen darf, steht in der Datenbank und wird in der Verwaltung gepflegt. Intern bleiben die
bekannten Rollen (core/roles.py) die Bausteine: Jede Stufe steht für eine feste Menge Rollen,
und alle Prüfungen im Code fragen weiterhin nach Rollen.

Die Rollen gelten bei jeder Anfrage aus der Datenbank (load_session), Änderungen wirken sofort.
"""

from collections.abc import Iterable
from dataclasses import dataclass

from werkbank.core.models import User
from werkbank.core.roles import Role, filter_known_roles


@dataclass(frozen=True)
class Level:
    label: str
    roles: frozenset[str]


@dataclass(frozen=True)
class Area:
    key: str
    name: str
    hint: str
    levels: tuple[Level, ...]


def _levels(*entries: tuple[str, Iterable[str]]) -> tuple[Level, ...]:
    return (
        Level("Kein Zugriff", frozenset()),
        *(Level(label, frozenset(roles)) for label, roles in entries),
    )


# Reihenfolge wie in der Bereichsleiste. Höhere Stufen schließen die niedrigeren ein.
AREAS: tuple[Area, ...] = (
    Area(
        "tickets",
        "Tickets",
        "Nutzen: Tickets der eigenen Bereiche. Verwalten: Bereiche und Postfächer einrichten.",
        _levels(
            ("Nutzen", [Role.TICKETS_USER]),
            ("Verwalten", [Role.TICKETS_USER, Role.TICKETS_MANAGER]),
        ),
    ),
    Area(
        "doku",
        "Dokumentation",
        "Nutzen: Seiten der eigenen Arbeitsbereiche. Verwalten: Arbeitsbereiche, Papierkorb.",
        _levels(
            ("Nutzen", [Role.DOKU_USER]),
            ("Verwalten", [Role.DOKU_USER, Role.DOKU_ADMIN]),
        ),
    ),
    Area(
        "bestand",
        "IT-Bestand",
        "Hardware, Stammdaten und Vorgänge ansehen oder pflegen.",
        _levels(
            ("Lesen", [Role.INVENTORY_READER]),
            ("Bearbeiten", [Role.INVENTORY_READER, Role.INVENTORY_EDITOR]),
        ),
    ),
    Area(
        "geraete",
        "Gerätezuordnung",
        "Neue Windows-Geräte per QR-Code scannen, zur Freigabe senden und freigeben.",
        _levels(("Nutzen", [Role.DEVICES_ASSOCIATION])),
    ),
    Area(
        "projekte",
        "IT-Projekte",
        "Projekte mit Budget, Jour Fixe und Aufgaben ansehen oder pflegen.",
        _levels(
            ("Lesen", [Role.PROJECTS_READER]),
            ("Bearbeiten", [Role.PROJECTS_READER, Role.PROJECTS_EDITOR]),
        ),
    ),
    Area(
        "budget",
        "IT-Budget",
        "Verwalten: zusätzlich Rechnungen buchen und Einstellungen festlegen.",
        _levels(
            ("Lesen", [Role.BUDGET_READER]),
            ("Bearbeiten", [Role.BUDGET_READER, Role.BUDGET_EDITOR]),
            ("Verwalten", [Role.BUDGET_READER, Role.BUDGET_EDITOR, Role.BUDGET_MANAGER]),
        ),
    ),
    Area(
        "monitoring",
        "IT-Monitoring",
        "Nur Berichte: Berichte ohne Hostdetails. Lesen: der ganze Bereich.",
        _levels(
            ("Nur Berichte", [Role.MONITORING_REPORTS]),
            ("Lesen", [Role.MONITORING_READER]),
        ),
    ),
    Area(
        "m365",
        "M365-Einstellungen",
        "Lesen schließt die Tenant-Übersicht ein. Prüfen: Änderungen bewerten, Soll-Werte pflegen.",
        _levels(
            ("Lesen", [Role.CONFIG_READER, Role.TENANT_READER]),
            ("Prüfen", [Role.CONFIG_READER, Role.CONFIG_REVIEWER, Role.TENANT_READER]),
        ),
    ),
    Area(
        "evergreen",
        "Evergreen",
        "Einträge mit Bewertung ansehen oder anlegen und bewerten.",
        _levels(
            ("Lesen", [Role.EVERGREEN_READER]),
            ("Bearbeiten", [Role.EVERGREEN_READER, Role.EVERGREEN_EDITOR]),
        ),
    ),
    Area(
        "tools",
        "IT-Tools",
        "Rechner, Generatoren und Konverter.",
        _levels(("Nutzen", [Role.TOOLS_USER])),
    ),
)

AREA_BY_KEY: dict[str, Area] = {area.key: area for area in AREAS}
# Diese Rolle vergibt nur die Admin-Gruppe in Entra, nie die Verwaltung
ADMIN_ROLE = Role.WERKBANK_ADMIN.value


def levels_from_roles(roles: Iterable[str]) -> dict[str, int]:
    """Höchste Stufe je Bereich, deren Rollen in den gegebenen Rollen vorkommen.

    Eine Stufe zählt, sobald ihre wichtigste Rolle (die zuletzt hinzukommende) vorhanden ist.
    So wird aus der alten App-Rolle „Budget.Manager“ allein die Stufe „Verwalten“.
    """
    present = set(roles)
    result: dict[str, int] = {}
    for area in AREAS:
        for index in range(len(area.levels) - 1, 0, -1):
            level = area.levels[index]
            lower = area.levels[index - 1].roles if index > 1 else frozenset()
            key_roles = level.roles - lower or level.roles
            if key_roles & present:
                result[area.key] = index
                break
    return result


def roles_from_levels(levels: dict[str, int]) -> list[str]:
    """Rollen zu den Stufen. Unbekannte Bereiche und Stufen außerhalb des Bereichs zählen nicht."""
    roles: set[str] = set()
    for key, index in levels.items():
        area = AREA_BY_KEY.get(key)
        if area is not None and 0 <= index < len(area.levels):
            roles |= area.levels[index].roles
    return sorted(roles)


def normalize(roles: Iterable[str]) -> list[str]:
    """Rollen auf ganze Stufen bringen (ohne die Admin-Rolle)."""
    known = [role for role in filter_known_roles(list(roles)) if role != ADMIN_ROLE]
    return roles_from_levels(levels_from_roles(known))


def effective_roles(user: User) -> list[str]:
    """Rollen, mit denen die Person gerade arbeitet: Bereichsrechte und ggf. die Verwaltung."""
    roles = set(user.permissions or [])
    if user.is_admin:
        roles.add(ADMIN_ROLE)
    return sorted(roles)


def set_permissions(user: User, roles: Iterable[str], *, exact: bool = False) -> None:
    """Speichert die Bereichsrechte und hält last_roles (Benachrichtigungen, Audit) aktuell.

    Normal werden die Rollen auf ganze Stufen gebracht. `exact` übernimmt sie unverändert
    (nur Test-Login, damit Tests einzelne Rollen prüfen können).
    """
    if exact:
        user.permissions = [r for r in filter_known_roles(list(roles)) if r != ADMIN_ROLE]
    else:
        user.permissions = normalize(roles)
    user.last_roles = effective_roles(user)
