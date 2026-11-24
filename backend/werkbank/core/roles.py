"""Rollen der Werkbank: interne Bausteine der Berechtigungen (core/permissions.py).

Die Werte entsprechen den früheren App-Rollen in Entra; sie werden bei der Umstellung einmal
übernommen (docs/entra-setup.md).
"""

from enum import StrEnum


class Role(StrEnum):
    """Bekannte App-Rollen."""

    WERKBANK_ADMIN = "Werkbank.Admin"
    CONFIG_READER = "Config.Reader"
    CONFIG_REVIEWER = "Config.Reviewer"
    EVERGREEN_READER = "Evergreen.Reader"
    EVERGREEN_EDITOR = "Evergreen.Editor"
    TOOLS_USER = "Tools.User"
    TENANT_READER = "Tenant.Reader"
    BUDGET_EDITOR = "Budget.Editor"
    BUDGET_MANAGER = "Budget.Manager"
    BUDGET_READER = "Budget.Reader"
    MONITORING_READER = "Monitoring.Reader"
    MONITORING_REPORTS = "Monitoring.Berichte"
    PROJECTS_READER = "Projekte.Reader"
    PROJECTS_EDITOR = "Projekte.Editor"
    INVENTORY_READER = "Bestand.Reader"
    INVENTORY_EDITOR = "Bestand.Editor"
    DEVICES_ASSOCIATION = "Geraete.Zuordnung"
    TICKETS_USER = "Tickets.Nutzer"
    TICKETS_MANAGER = "Tickets.Verwaltung"
    DOKU_USER = "Doku.Nutzer"
    DOKU_ADMIN = "Doku.Admin"


KNOWN_ROLES: frozenset[str] = frozenset(role.value for role in Role)


def filter_known_roles(roles: object) -> list[str]:
    """Behält nur bekannte Rollen, sortiert und ohne Doppelte. Unbekanntes wird verworfen."""
    if not isinstance(roles, list):
        return []
    return sorted({r for r in roles if isinstance(r, str) and r in KNOWN_ROLES})
