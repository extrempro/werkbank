"""Prüfung der Berechtigungen für den Abruf (Verwaltung, Seite Verbindungen).

1. Collector-App: Ihre Anwendungsberechtigungen stehen im eigenen Zugriffstoken (Claim `roles`);
   dafür ist keine weitere Berechtigung nötig.
2. Dienstprinzipal von UTCM: Die Werkbank liest seine zugewiesenen Anwendungsberechtigungen
   (`appRoleAssignments`) und vergleicht sie mit dem, was die Typen in `COLLECTOR_RESOURCES`
   laut Microsoft brauchen. Dafür braucht die Collector-App `Application.Read.All`.
   Entra-Rollen (z. B. „Globaler Leser“ für Exchange und Teams) prüft sie nicht; dafür wäre
   `RoleManagement.Read.Directory` nötig. Sie stehen als Hinweis im Ergebnis.

Gelesen werden nur Namen von Berechtigungen und Ressourcentypen, keine Personendaten.
"""

import base64
import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from werkbank.config import Settings
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, SettingsDep, require_recent_login
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser
from werkbank.modules.m365_config.utcm import (
    GRAPH_URL,
    UtcmClient,
    UtcmError,
    graph_token_provider,
)

UTCM_APP_ID = "03b07b79-c5bc-4b5e-9bfa-13acf4a99998"
GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000"
EXCHANGE_APP_ID = "00000002-0000-0ff1-ce00-000000000000"
HTTP_TIMEOUT_SECONDS = 20

# Conditional Access: UTCM gibt Namen statt Kennungen aus und braucht deshalb viele Leserechte
CA_PERMISSIONS = (
    "Policy.Read.All",
    "Application.Read.All",
    "Group.Read.All",
    "User.Read.All",
    "RoleManagement.Read.Directory",
    "Agreement.Read.All",
    "CustomSecAttributeDefinition.Read.All",
)
INTUNE_APPS = ("appprotectionpolicy", "appconfigurationpolicy")
INTUNE_ENROLLMENT = ("deviceenrollment", "windowsautopilot")


@dataclass(frozen=True)
class Need:
    """Berechtigung beim Dienstprinzipal von UTCM für einen Ressourcentyp."""

    resource: str  # "graph" oder "exchange"
    permission: str


def utcm_needs(resource_type: str) -> list[Need] | None:
    """Was ein Ressourcentyp laut Microsoft braucht; None, wenn die Werkbank es nicht kennt."""
    name = resource_type.lower()
    if name == "microsoft.entra.conditionalaccesspolicy":
        return [Need("graph", p) for p in CA_PERMISSIONS]
    if name in ("microsoft.entra.namedlocationpolicy", "microsoft.entra.authorizationpolicy"):
        return [Need("graph", "Policy.Read.All")]
    if name.startswith("microsoft.exchange."):
        return [Need("exchange", "Exchange.ManageAsApp")]
    if name.startswith("microsoft.teams."):
        return [Need("graph", "Organization.Read.All")]
    if name.startswith("microsoft.intune."):
        short = name.removeprefix("microsoft.intune.")
        if short.startswith(INTUNE_APPS):
            main = "DeviceManagementApps.Read.All"
        elif short.startswith(INTUNE_ENROLLMENT):
            main = "DeviceManagementServiceConfig.Read.All"
        else:
            main = "DeviceManagementConfiguration.Read.All"
        return [Need("graph", main), Need("graph", "Group.Read.All")]
    return None


def satisfied(wanted: str, granted: set[str]) -> bool:
    """Ein Schreibrecht deckt das Leserecht derselben Art (z. B. ReadWrite.All für Read.All)."""
    if wanted in granted:
        return True
    return wanted.replace(".Read.", ".ReadWrite.") in granted


def collector_needs(settings: Settings) -> list[tuple[str, str, bool]]:
    """(Berechtigung, wofür, Pflicht) für die Collector-App nach den eingeschalteten Funktionen."""
    needs: list[tuple[str, str, bool]] = [
        ("ConfigurationMonitoring.ReadWrite.All", "Abruf über UTCM (Snapshots)", True),
        ("AuditLog.Read.All", "„Geändert von“ bei Änderungen", True),
        ("ServiceMessage.Read.All", "Evergreen: Nachrichtencenter", True),
    ]
    optional = [
        (settings.secure_score_enabled, "SecurityEvents.Read.All", "Empfehlungen (Secure Score)"),
        (settings.tenant_monitor_enabled, "Organization.Read.All", "Lizenzen"),
        (settings.tenant_monitor_enabled, "User.Read.All", "Benutzerzahlen"),
        (settings.tenant_credentials_enabled, "Application.Read.All", "Zertifikate und Secrets"),
        (settings.tenant_health_enabled, "ServiceHealth.Read.All", "Dienststatus"),
        (settings.tenant_usage_enabled, "Reports.Read.All", "Nutzung der Dienste"),
        (
            settings.collector_sharepoint_enabled,
            "SharePointTenantSettings.Read.All",
            "SharePoint-Einstellungen",
        ),
        (
            settings.devices_monitor_enabled,
            "DeviceManagementServiceConfig.Read.All",
            "Gerätezuordnung",
        ),
        (
            settings.devices_monitor_enabled,
            "DeviceManagementManagedDevices.Read.All",
            "Gerätezuordnung",
        ),
    ]
    needs += [(perm, why, True) for on, perm, why in optional if on]
    # Ohne eigenen Schalter: werden genutzt, wenn vorhanden
    used = {perm for perm, _, _ in needs}
    for perm, why in (
        ("User.Read.All", "IT-Bestand: Personensuche und Abgleich mit Entra; Tickets: Personen"),
        ("GroupMember.Read.All", "Tickets: Rollen je Bereich über Gruppen"),
        ("Application.Read.All", "Diese Prüfung: Rechte des Dienstprinzipals von UTCM lesen"),
    ):
        if perm not in used:
            needs.append((perm, why, False))
    return needs


def token_roles(token: str) -> set[str]:
    """Anwendungsberechtigungen aus dem Zugriffstoken (ohne Prüfung der Signatur: eigenes Token)."""
    try:
        payload = token.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        data = json.loads(base64.urlsafe_b64decode(payload))
    except IndexError, ValueError:
        return set()
    roles = data.get("roles") if isinstance(data, dict) else None
    return {r for r in roles if isinstance(r, str)} if isinstance(roles, list) else set()


class PermissionGraph(UtcmClient):
    def _sp(self, app_id: str, select: str) -> dict[str, Any]:
        return self._json(
            "GET", f"{GRAPH_URL}/servicePrincipals(appId='{app_id}')", params={"$select": select}
        )

    def utcm_assignments(self) -> dict[str, set[str]]:
        """Zugewiesene Berechtigungen des Dienstprinzipals von UTCM je Ressource."""
        utcm = self._sp(UTCM_APP_ID, "id")
        resources: dict[str, tuple[str, dict[str, str]]] = {}
        for key, app_id in (("graph", GRAPH_APP_ID), ("exchange", EXCHANGE_APP_ID)):
            sp = self._sp(app_id, "id,appRoles")
            roles = {
                str(r.get("id")): str(r.get("value"))
                for r in sp.get("appRoles") or []
                if isinstance(r, dict)
            }
            resources[str(sp.get("id"))] = (key, roles)
        items = self._pages(
            f"{GRAPH_URL}/servicePrincipals/{utcm.get('id')}/appRoleAssignments",
            {"$select": "appRoleId,resourceId", "$top": "999"},
        )
        result: dict[str, set[str]] = {"graph": set(), "exchange": set()}
        for item in items:
            resource = resources.get(str(item.get("resourceId")))
            if resource is None:
                continue
            key, roles = resource
            value = roles.get(str(item.get("appRoleId")))
            if value:
                result[key].add(value)
        return result


class CollectorItem(BaseModel):
    permission: str
    purpose: str
    required: bool
    granted: bool


class UtcmItem(BaseModel):
    resource: str
    permission: str
    types: list[str]
    granted: bool


class CheckOut(BaseModel):
    configured: bool
    collector_error: str | None
    collector: list[CollectorItem]
    utcm_error: str | None
    utcm: list[UtcmItem]
    # Typen, für die die Werkbank die Anforderungen nicht kennt
    unknown_types: list[str]
    notes: list[str]


def run_check(settings: Settings, graph: PermissionGraph | None, token: str | None) -> CheckOut:
    notes: list[str] = []
    types = settings.collector_resource_list()
    if any(t.startswith(("microsoft.exchange.", "microsoft.teams.")) for t in types):
        notes.append(
            "Exchange und Teams brauchen zusätzlich die Entra-Rolle „Globaler Leser“ bzw. "
            "„Sicherheitsleseberechtigter“ beim Dienstprinzipal von UTCM. Die prüft die Werkbank "
            "nicht (dafür wäre RoleManagement.Read.Directory nötig)."
        )
    granted = token_roles(token) if token else set()
    collector = [
        CollectorItem(permission=p, purpose=why, required=req, granted=satisfied(p, granted))
        for p, why, req in collector_needs(settings)
    ]
    collector_error = None if token else "Kein Zugriffstoken der Collector-App."

    needs: dict[tuple[str, str], list[str]] = {}
    unknown: list[str] = []
    for t in types:
        found = utcm_needs(t)
        if found is None:
            unknown.append(t)
            continue
        for need in found:
            needs.setdefault((need.resource, need.permission), []).append(t)
    utcm_error: str | None = None
    assigned: dict[str, set[str]] = {"graph": set(), "exchange": set()}
    if graph is None:
        utcm_error = "Die Verbindung zur Collector-App ist nicht eingerichtet."
    else:
        try:
            assigned = graph.utcm_assignments()
        except UtcmError as exc:
            text = str(exc)
            if "mit 403" in text:
                utcm_error = (
                    "Die Collector-App darf die Rechte des Dienstprinzipals von UTCM nicht lesen. "
                    "Dafür braucht sie Application.Read.All."
                )
            elif "mit 404" in text:
                utcm_error = (
                    "Den Dienstprinzipal von UTCM gibt es im Tenant nicht (entra-setup.md 4.2)."
                )
            else:
                utcm_error = text
    utcm = [
        UtcmItem(
            resource="Exchange Online" if resource == "exchange" else "Microsoft Graph",
            permission=permission,
            types=sorted(type_list),
            granted=utcm_error is None and satisfied(permission, assigned[resource]),
        )
        for (resource, permission), type_list in sorted(needs.items())
    ]
    return CheckOut(
        configured=True,
        collector_error=collector_error,
        collector=collector,
        utcm_error=utcm_error,
        utcm=utcm,
        unknown_types=unknown,
        notes=notes,
    )


Checker = Callable[[Settings], CheckOut]


def graph_checker(settings: Settings) -> CheckOut:
    """Prüfung gegen Microsoft Graph mit der Collector-App."""
    try:
        provider = graph_token_provider(settings)
        token = provider()
    except (OSError, ValueError, UtcmError, RuntimeError) as exc:
        result = run_check(settings, None, None)
        result.collector_error = f"Anmeldung der Collector-App fehlgeschlagen: {type(exc).__name__}"
        result.utcm_error = result.collector_error
        return result
    with httpx.Client(timeout=HTTP_TIMEOUT_SECONDS, follow_redirects=False) as http:
        return run_check(settings, PermissionGraph(http, provider), token)


def get_checker() -> Checker:
    """Abhängigkeit; in Tests ersetzbar."""
    return graph_checker


router = APIRouter(prefix="/api/admin/collector")
AdminUser = Annotated[CurrentUser, Depends(require_recent_login(Role.WERKBANK_ADMIN))]


@router.post("/check")
def check_permissions(
    user: AdminUser,
    db: DbDep,
    settings: SettingsDep,
    checker: Annotated[Checker, Depends(get_checker)],
) -> CheckOut:
    """Berechtigungen der Collector-App und des Dienstprinzipals von UTCM prüfen (nur lesend)."""
    if not settings.collector_configured:
        return CheckOut(
            configured=False,
            collector_error="Die Verbindung zur Collector-App ist nicht eingerichtet.",
            collector=[],
            utcm_error=None,
            utcm=[],
            unknown_types=[],
            notes=[],
        )
    result = checker(settings)
    write_audit(
        db,
        module="m365_config",
        action="rechte_geprueft",
        user_id=user.user_id,
        details={
            "fehlen_collector": [
                i.permission for i in result.collector if i.required and not i.granted
            ],
            "fehlen_utcm": [i.permission for i in result.utcm if not i.granted],
        },
    )
    db.commit()
    return result
