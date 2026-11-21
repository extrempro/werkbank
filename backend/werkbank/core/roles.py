"""App-Rollen der Werkbank (Werte wie in Entra, siehe docs/entra-setup.md)."""

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
    PROJECTS_READER = "Projekte.Reader"
    PROJECTS_EDITOR = "Projekte.Editor"
    INVENTORY_READER = "Bestand.Reader"
    INVENTORY_EDITOR = "Bestand.Editor"
    DEVICES_ASSOCIATION = "Geraete.Zuordnung"


KNOWN_ROLES: frozenset[str] = frozenset(role.value for role in Role)


def filter_known_roles(roles: object) -> list[str]:
    """Behält nur bekannte Rollen, sortiert und ohne Doppelte. Unbekanntes wird verworfen."""
    if not isinstance(roles, list):
        return []
    return sorted({r for r in roles if isinstance(r, str) and r in KNOWN_ROLES})


# Anzeigename und Beschreibung je Rolle (wie in docs/entra-setup.md, Abschnitt 1.6)
ROLE_INFO: dict[str, tuple[str, str]] = {
    Role.DEVICES_ASSOCIATION: (
        "Gerätezuordnung",
        "Neue Windows-Geräte per QR-Code scannen, zur Freigabe senden, freigeben, verwerfen",
    ),
    Role.WERKBANK_ADMIN: (
        "Werkbank Admin",
        "Verwaltung der Werkbank: Module, Konnektoren, Regeln, Audit-Log",
    ),
    Role.CONFIG_READER: ("Konfiguration Leser", "M365-Konfiguration ansehen und exportieren"),
    Role.CONFIG_REVIEWER: (
        "Konfiguration Prüfer",
        "Änderungen bewerten, Beschreibungen und Soll-Werte pflegen",
    ),
    Role.EVERGREEN_READER: (
        "Evergreen Leser",
        "Evergreen-Einträge mit Bewertung und Notizen ansehen",
    ),
    Role.EVERGREEN_EDITOR: (
        "Evergreen Bearbeiter",
        "Evergreen-Einträge anlegen, bewerten, Notizen anfügen, abschließen und wieder öffnen",
    ),
    Role.TOOLS_USER: (
        "IT-Tools Nutzer",
        "Bereich IT-Tools öffnen (Rechner, Generatoren, Konverter)",
    ),
    Role.TENANT_READER: (
        "Tenant Leser",
        "Lizenzen und Benutzerzahlen des Tenants mit Verlauf ansehen",
    ),
    Role.BUDGET_EDITOR: (
        "Budget Bearbeiter",
        "IT-Budget ansehen; Konten, Budgetposten, Verträge, Partner und Rechnungen pflegen",
    ),
    Role.BUDGET_MANAGER: (
        "Budgetverwalter",
        "Wie Bearbeiter, dazu Rechnungen buchen und die Einstellungen festlegen",
    ),
    Role.BUDGET_READER: ("Budget Leser", "IT-Budget ansehen"),
    Role.MONITORING_READER: (
        "Monitoring Leser",
        "Bereich IT-Monitoring ansehen (z. B. DNS-Abgleich mit NetBox)",
    ),
    Role.PROJECTS_READER: (
        "Projekte Leser",
        "IT-Projekte ansehen: Übersicht, Budget, Jour Fixe und Aufgaben",
    ),
    Role.PROJECTS_EDITOR: (
        "Projekte Bearbeiter",
        "IT-Projekte anlegen und pflegen: Einstellungen, Jour Fixe mit Anhängen und Aufgaben",
    ),
    Role.INVENTORY_READER: ("IT-Bestand Leser", "IT-Bestand ansehen: Hardware und Stammdaten"),
    Role.INVENTORY_EDITOR: (
        "IT-Bestand Bearbeiter",
        "IT-Bestand pflegen: Hardware erfassen, Inventurnummern setzen, ausmustern, Stammdaten",
    ),
}
