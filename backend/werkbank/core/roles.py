"""App-Rollen der Werkbank (Werte wie in Entra, siehe docs/entra-setup.md)."""

from enum import StrEnum


class Role(StrEnum):
    """Bekannte App-Rollen."""

    WERKBANK_ADMIN = "Werkbank.Admin"
    WERKBANK_AUDITOR = "Werkbank.Auditor"
    CONFIG_READER = "Config.Reader"
    CONFIG_REVIEWER = "Config.Reviewer"
    EVERGREEN_IT = "Evergreen.IT"
    EVERGREEN_TEAM = "Evergreen.Team"
    EVERGREEN_BETRIEBSRAT = "Evergreen.Betriebsrat"
    EVERGREEN_GF = "Evergreen.GF"
    TOOLS_USER = "Tools.User"
    TENANT_READER = "Tenant.Reader"
    BUDGET_EDITOR = "Budget.Editor"
    BUDGET_MANAGER = "Budget.Manager"
    BUDGET_READER = "Budget.Reader"


KNOWN_ROLES: frozenset[str] = frozenset(role.value for role in Role)


def filter_known_roles(roles: object) -> list[str]:
    """Behält nur bekannte Rollen, sortiert und ohne Doppelte. Unbekanntes wird verworfen."""
    if not isinstance(roles, list):
        return []
    return sorted({r for r in roles if isinstance(r, str) and r in KNOWN_ROLES})


# Anzeigename und Beschreibung je Rolle (wie in docs/entra-setup.md, Abschnitt 1.6)
ROLE_INFO: dict[str, tuple[str, str]] = {
    Role.WERKBANK_ADMIN: (
        "Werkbank Admin",
        "Verwaltung der Werkbank: Module, Konnektoren, Regeln, Audit-Log",
    ),
    Role.WERKBANK_AUDITOR: ("Werkbank Auditor", "Audit-Log und Reports lesen"),
    Role.CONFIG_READER: ("Konfiguration Leser", "M365-Konfiguration ansehen und exportieren"),
    Role.CONFIG_REVIEWER: (
        "Konfiguration Prüfer",
        "Änderungen bewerten, Beschreibungen und Soll-Werte pflegen",
    ),
    Role.EVERGREEN_IT: (
        "Evergreen IT",
        "Technische Bewertung und Umsetzung von Evergreen-Vorgängen",
    ),
    Role.EVERGREEN_TEAM: ("Evergreen Team", "Rückmeldungen der Fachabteilungen und BR-Vorlagen"),
    Role.EVERGREEN_BETRIEBSRAT: (
        "Evergreen Betriebsrat",
        "Stellungnahme zu vorgelegten Vorgängen",
    ),
    Role.EVERGREEN_GF: ("Evergreen Geschäftsführung", "Abnahme von Vorgängen"),
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
        "IT-Budget ansehen, Konten anlegen und ändern",
    ),
    Role.BUDGET_MANAGER: (
        "Budgetverwalter",
        "Wie Bearbeiter, dazu den Plan je Geschäftsjahr und die Einstellungen festlegen",
    ),
    Role.BUDGET_READER: ("Budget Leser", "IT-Budget ansehen"),
}
