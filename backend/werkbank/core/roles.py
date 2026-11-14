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


KNOWN_ROLES: frozenset[str] = frozenset(role.value for role in Role)


def filter_known_roles(roles: object) -> list[str]:
    """Behält nur bekannte Rollen, sortiert und ohne Doppelte. Unbekanntes wird verworfen."""
    if not isinstance(roles, list):
        return []
    return sorted({r for r in roles if isinstance(r, str) and r in KNOWN_ROLES})
