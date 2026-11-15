"""Lesbare Namen für verbreitete Lizenzen.

Microsoft Graph liefert nur den technischen Namen (z. B. „SPE_E3“). Die Liste deckt die
gängigen Lizenzen ab; für alle anderen zeigt die Werkbank den technischen Namen.
"""

LICENSE_NAMES: dict[str, str] = {
    "SPE_E3": "Microsoft 365 E3",
    "SPE_E5": "Microsoft 365 E5",
    "SPE_F1": "Microsoft 365 F3",
    "M365_F1": "Microsoft 365 F1",
    "SPB": "Microsoft 365 Business Premium",
    "O365_BUSINESS_PREMIUM": "Microsoft 365 Business Standard",
    "O365_BUSINESS_ESSENTIALS": "Microsoft 365 Business Basic",
    "O365_BUSINESS": "Microsoft 365 Apps for Business",
    "OFFICESUBSCRIPTION": "Microsoft 365 Apps for Enterprise",
    "STANDARDPACK": "Office 365 E1",
    "ENTERPRISEPACK": "Office 365 E3",
    "ENTERPRISEPREMIUM": "Office 365 E5",
    "DESKLESSPACK": "Office 365 F3",
    "EXCHANGESTANDARD": "Exchange Online (Plan 1)",
    "EXCHANGEENTERPRISE": "Exchange Online (Plan 2)",
    "EXCHANGEDESKLESS": "Exchange Online Kiosk",
    "EMS": "Enterprise Mobility + Security E3",
    "EMSPREMIUM": "Enterprise Mobility + Security E5",
    "AAD_PREMIUM": "Microsoft Entra ID P1",
    "AAD_PREMIUM_P2": "Microsoft Entra ID P2",
    "INTUNE_A": "Microsoft Intune Plan 1",
    "POWER_BI_STANDARD": "Power BI (kostenlos)",
    "POWER_BI_PRO": "Power BI Pro",
    "FLOW_FREE": "Power Automate (kostenlos)",
    "PROJECTPROFESSIONAL": "Project Plan 3",
    "PROJECTPREMIUM": "Project Plan 5",
    "VISIOCLIENT": "Visio Plan 2",
    "TEAMS_EXPLORATORY": "Microsoft Teams Exploratory",
    "MCOEV": "Microsoft Teams Telefon Standard",
    "MCOMEETADV": "Microsoft 365 Audiokonferenzen",
    "WINDOWS_STORE": "Windows Store for Business",
    "STREAM": "Microsoft Stream",
}


def license_name(part_number: str) -> str:
    """Lesbarer Name, sonst der technische Name."""
    return LICENSE_NAMES.get(part_number.upper(), part_number)
