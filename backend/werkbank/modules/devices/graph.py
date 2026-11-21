"""Das einzige Modul, das Adressen und Formen von Microsoft Graph für die Gerätezuordnung kennt.

Graph beta (deviceManagement/tenantAssociatedDevices), wie das Intune-Portal. Beta kann sich
ändern: Anpassungen nur hier. Aufrufe nach AutopilotQR (src/lib/graph.ts),
Copyright (c) 2026 Simon Eriksen, MIT-Lizenz (siehe THIRD_PARTY_NOTICES.md).

Fehler: 429 mit Retry-After höchstens 3 Versuche; 5xx nicht wiederholen (beim Import
deterministisch: Gerät erfüllt die Voraussetzungen nicht oder ist schon anderweitig zugeordnet).
Der Inhalt von deviceLink erscheint nie in Fehlermeldungen oder im Log.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

BETA = "https://graph.microsoft.com/beta"
V1 = "https://graph.microsoft.com/v1.0"
# Vorlage der Device-Preparation-Richtlinie (Einstellungskatalog)
APDP_TEMPLATE_ID = "70d256b3-6120-4f88-9e00-0972ec64fc83_1"
DEVICE_SELECT = (
    "id,serialNumber,manufacturerName,modelName,associationState,"
    "devicePreparationPolicyId,preassociationDateTime"
)
MANAGED_SELECT = "id,deviceName,enrolledDateTime,complianceState,userPrincipalName,serialNumber"
MAX_ATTEMPTS = 3
RETRY_CAP_SECONDS = 30
CONFIRM_TIMEOUT_SECONDS = 30
CONFIRM_INTERVAL_SECONDS = 3
TIMEOUT_SECONDS = 30.0
DONE_STATES = ("preassociated", "associated")


class GraphError(Exception):
    """Fehler von Graph mit Status, Code und request-id (für den Microsoft-Support)."""

    def __init__(self, message: str, status: int, code: str, request_id: str | None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.request_id = request_id


@dataclass(frozen=True)
class Policy:
    id: str
    name: str


@dataclass(frozen=True)
class AssociatedDevice:
    id: str
    serial_number: str | None
    manufacturer: str | None
    model: str | None
    association_state: str
    policy_id: str | None
    preassociated_at: str | None
    managed_device_id: str | None


@dataclass(frozen=True)
class ManagedDevice:
    id: str
    device_name: str | None
    enrolled_at: str | None
    compliance_state: str | None
    user_principal_name: str | None


def _device(data: dict[str, Any]) -> AssociatedDevice:
    def text(key: str) -> str | None:
        value = data.get(key)
        return str(value)[:256] if value is not None else None

    return AssociatedDevice(
        id=str(data.get("id") or ""),
        serial_number=text("serialNumber"),
        manufacturer=text("manufacturerName"),
        model=text("modelName"),
        association_state=str(data.get("associationState") or "unbekannt")[:64],
        policy_id=text("devicePreparationPolicyId"),
        preassociated_at=text("preassociationDateTime"),
        # Laut Community-Quellen vorhanden, von Microsoft nicht dokumentiert: nur nutzen, wenn da
        managed_device_id=text("managedDeviceId"),
    )


def _managed(data: dict[str, Any]) -> ManagedDevice:
    def text(key: str) -> str | None:
        value = data.get(key)
        return str(value)[:256] if value is not None else None

    return ManagedDevice(
        id=str(data.get("id") or ""),
        device_name=text("deviceName"),
        enrolled_at=text("enrolledDateTime"),
        compliance_state=text("complianceState"),
        user_principal_name=text("userPrincipalName"),
    )


class DeviceGraph:
    """Aufrufe mit einem Token: delegiert (Admin-Konto) oder App (Collector, nur lesend)."""

    def __init__(
        self,
        http: httpx.Client,
        token: Callable[[], str],
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._http = http
        self._token = token
        self._sleep = sleep

    def _request(self, method: str, url: str, body: dict[str, Any] | None = None) -> Any:
        for attempt in range(MAX_ATTEMPTS + 1):
            response = self._http.request(
                method,
                url,
                json=body,
                headers={"Authorization": f"Bearer {self._token()}", "Accept": "application/json"},
                timeout=TIMEOUT_SECONDS,
            )
            if response.status_code == 429 and attempt < MAX_ATTEMPTS:
                try:
                    wait = float(response.headers.get("Retry-After", ""))
                except ValueError:
                    wait = 2.0 * 2**attempt
                self._sleep(min(max(wait, 1.0), RETRY_CAP_SECONDS))
                continue
            break
        request_id = response.headers.get("request-id")
        if response.status_code >= 400:
            code, message = f"HTTP{response.status_code}", response.reason_phrase
            try:
                error = response.json().get("error") or {}
                code = str(error.get("code") or code)[:100]
                message = str(error.get("message") or message)[:300]
                inner = error.get("innerError") or {}
                request_id = str(inner.get("request-id") or request_id or "") or None
            except ValueError, AttributeError:
                pass
            raise GraphError(message, response.status_code, code, request_id)
        if response.status_code == 204 or not response.content:
            return None
        return response.json()

    def list_policies(self) -> list[Policy]:
        """Device-Preparation-Richtlinien (Seiten über @odata.nextLink)."""
        flt = (
            "(technologies has 'enrollment') and (platforms eq 'windows10') and "
            f"(TemplateReference/templateId eq '{APDP_TEMPLATE_ID}') and "
            "(Templatereference/templateFamily eq 'enrollmentConfiguration')"
        )
        url: str | None = (
            f"{BETA}/deviceManagement/configurationPolicies?$select=id,name"
            f"&$filter={quote(flt, safe='')}"
        )
        policies: list[Policy] = []
        pages = 0
        while url and pages < 20:
            page = self._request("GET", url) or {}
            for item in page.get("value", []):
                if item.get("id"):
                    policies.append(Policy(str(item["id"]), str(item.get("name") or "")[:256]))
            next_link = page.get("@odata.nextLink")
            url = next_link if isinstance(next_link, str) and next_link.startswith(BETA) else None
            pages += 1
        return sorted(policies, key=lambda policy: policy.name.casefold())

    def find_by_serial(self, serial: str) -> list[AssociatedDevice]:
        """Duplikatprüfung: contains() ist unscharf, danach nur exakte Treffer."""
        escaped = serial.replace("'", "''")
        flt = quote(f"contains(serialNumber,'{escaped}')", safe="")
        page = self._request(
            "GET",
            f"{BETA}/deviceManagement/tenantAssociatedDevices?$select={DEVICE_SELECT}"
            f"&$top=100&$filter={flt}",
        )
        devices = [_device(item) for item in (page or {}).get("value", [])]
        return [d for d in devices if (d.serial_number or "").casefold() == serial.casefold()]

    def import_device(self, device_link: str, policy_id: str | None) -> AssociatedDevice:
        body = {"deviceLink": device_link}
        if policy_id:
            body["devicePreparationPolicyId"] = policy_id
        result = self._request(
            "POST",
            f"{BETA}/deviceManagement/tenantAssociatedDevices/importTenantAssociatedDevice",
            body,
        )
        return _device(result or {})

    def get_device(self, device_id: str) -> AssociatedDevice:
        result = self._request(
            "GET",
            f"{BETA}/deviceManagement/tenantAssociatedDevices/{quote(device_id, safe='')}"
            f"?$select={DEVICE_SELECT}",
        )
        return _device(result or {})

    def confirm(self, device_id: str) -> AssociatedDevice:
        """Nach dem Import alle 3 s lesen, bis „preassociated“ oder „associated“ (höchstens 30 s).
        Erfolg nur über den Status, nie über Zeitstempel; direkt danach kurz 404."""
        last: AssociatedDevice | None = None
        for _ in range(CONFIRM_TIMEOUT_SECONDS // CONFIRM_INTERVAL_SECONDS):
            try:
                last = self.get_device(device_id)
                if last.association_state in DONE_STATES:
                    return last
            except GraphError as error:
                if error.status != 404:
                    raise
            self._sleep(CONFIRM_INTERVAL_SECONDS)
        state = last.association_state if last else "nicht gefunden"
        raise GraphError(
            f"Import angenommen, aber kein Status „vorab zugeordnet“ (zuletzt: {state}).",
            0,
            "ConfirmTimeout",
            None,
        )

    def managed_device(self, device_id: str) -> ManagedDevice | None:
        try:
            result = self._request(
                "GET",
                f"{V1}/deviceManagement/managedDevices/{quote(device_id, safe='')}"
                f"?$select={MANAGED_SELECT}",
            )
        except GraphError as error:
            if error.status == 404:
                return None
            raise
        return _managed(result or {})

    def managed_by_serial(self, serial: str) -> ManagedDevice | None:
        """In Intune registriertes Gerät; mehrere Treffer: das zuletzt registrierte."""
        escaped = serial.replace("'", "''")
        flt = quote(f"serialNumber eq '{escaped}'", safe="")
        page = self._request(
            "GET", f"{V1}/deviceManagement/managedDevices?$filter={flt}&$select={MANAGED_SELECT}"
        )
        devices = [_managed(item) for item in (page or {}).get("value", [])]
        if not devices:
            return None
        return max(devices, key=lambda device: device.enrolled_at or "")

    def me(self) -> dict[str, str]:
        result = self._request("GET", f"{V1}/me?$select=displayName,userPrincipalName") or {}
        return {
            "name": str(result.get("displayName") or "")[:256],
            "upn": str(result.get("userPrincipalName") or "")[:320],
        }

    def organization(self) -> str:
        result = self._request("GET", f"{V1}/organization?$select=id,displayName") or {}
        orgs = result.get("value") or [{}]
        return str(orgs[0].get("displayName") or "")[:256]


REQUIREMENTS = (
    "Secure Boot ist eingeschaltet",
    "TPM 2.0 ist vorhanden und aktiv (nicht im Modus mit eingeschränkter Funktion)",
    "Windows 11 24H2 oder 25H2 mit KB5120998 oder neuer",
    "Es ist ein physisches Gerät, keine virtuelle Maschine",
)


def explain(error: GraphError) -> dict[str, Any]:
    """Text für die Oberfläche je Fehlerart."""
    if error.status in (401, 403):
        return {
            "kind": "keine_berechtigung",
            "title": "Keine Berechtigung",
            "detail": "Das Admin-Konto braucht die Intune-Rolle für die Gerätezuordnung. "
            "Es wurde nichts geändert.",
        }
    if error.status == 400:
        return {
            "kind": "abgelehnt",
            "title": "Daten nicht akzeptiert",
            "detail": "Microsoft hat die Gerätedaten nicht angenommen. Bitte neu scannen.",
        }
    if error.status >= 500:
        return {
            "kind": "nicht_zuordenbar",
            "title": "Microsoft konnte das Gerät nicht zuordnen",
            "detail": "Meist erfüllt das Gerät die Voraussetzungen nicht oder ist schon einem "
            "anderen Tenant zugeordnet. Ein neuer Versuch ändert daran nichts.",
            "requirements": list(REQUIREMENTS),
        }
    if error.status == 429:
        return {
            "kind": "gedrosselt",
            "title": "Zu viele Anfragen",
            "detail": "Microsoft bremst gerade. Bitte in einer Minute noch einmal versuchen.",
        }
    if error.code == "ConfirmTimeout":
        return {"kind": "unbestaetigt", "title": "Noch nicht bestätigt", "detail": str(error)}
    return {"kind": "fehler", "title": f"Fehler {error.status or ''}".strip(), "detail": str(error)}
