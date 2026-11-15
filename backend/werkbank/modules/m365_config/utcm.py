"""Zugriff auf Microsoft Graph: Unified Tenant Configuration Management (UTCM), nur lesend.

Die Werkbank lässt UTCM einen Snapshot erstellen, wartet auf das Ergebnis und lädt es herunter.
Verändert wird dabei nur die Liste der Snapshot-Aufträge in UTCM, nie eine Einstellung des
Tenants. Siehe docs/entra-setup.md, Abschnitt 4.
"""

import re
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

import httpx

from werkbank.config import Settings
from werkbank.core.credentials import certificate_credential

GRAPH_HOST = "graph.microsoft.com"
GRAPH_URL = f"https://{GRAPH_HOST}/v1.0"
UTCM_URL = f"{GRAPH_URL}/admin/configurationManagement"
GRAPH_SCOPE = f"https://{GRAPH_HOST}/.default"

JOB_SELECT = "id,displayName,status,resourceLocation,errorDetails,createdDateTime"
MAX_PAGES = 20
ERROR_TEXT_LENGTH = 300
_JOB_ID = re.compile(r"^[0-9A-Za-z-]{1,64}$")


class UtcmError(RuntimeError):
    """Fehler beim Zugriff auf Microsoft Graph."""


def check_graph_url(url: str) -> str:
    """Lässt nur HTTPS-Adressen von Microsoft Graph zu (Adressen stammen teils aus Antworten)."""
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname != GRAPH_HOST:
        raise UtcmError("Unerwartete Adresse in der Antwort von Microsoft Graph")
    return url


def graph_token_provider(settings: Settings) -> Callable[[], str]:
    """Liefert eine Funktion, die ein Zugriffstoken der Collector-App holt (MSAL cacht es)."""
    import msal

    app = msal.ConfidentialClientApplication(
        client_id=settings.collector_client_id,
        client_credential=certificate_credential(
            settings.collector_client_key_file, settings.collector_client_cert_file
        ),
        authority=f"https://login.microsoftonline.com/{settings.entra_tenant_id}",
    )

    def token() -> str:
        result = app.acquire_token_for_client(scopes=[GRAPH_SCOPE])
        value = result.get("access_token") if isinstance(result, dict) else None
        if not isinstance(value, str):
            error = result.get("error") if isinstance(result, dict) else None
            raise UtcmError(f"Anmeldung des Collectors fehlgeschlagen: {error or 'unbekannt'}")
        return value

    return token


class UtcmClient:
    """Die wenigen Aufrufe von Microsoft Graph, die der Abruf braucht."""

    def __init__(self, http: httpx.Client, token: Callable[[], str]) -> None:
        self._http = http
        self._token = token

    def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        check_graph_url(url)
        try:
            response = self._http.request(
                method, url, headers={"Authorization": f"Bearer {self._token()}"}, **kwargs
            )
        except httpx.HTTPError as exc:
            raise UtcmError(f"Microsoft Graph nicht erreichbar: {type(exc).__name__}") from exc
        if response.status_code >= 400:
            raise UtcmError(
                f"Microsoft Graph antwortet mit {response.status_code}: "
                f"{response.text[:ERROR_TEXT_LENGTH]}"
            )
        return response

    def _json(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        try:
            data = self._request(method, url, **kwargs).json()
        except ValueError as exc:
            raise UtcmError("Antwort von Microsoft Graph ist kein JSON") from exc
        if not isinstance(data, dict):
            raise UtcmError("Unerwartete Antwort von Microsoft Graph")
        return data

    def _pages(self, url: str, params: dict[str, str]) -> list[dict[str, Any]]:
        """Liest eine Liste samt Folgeseiten (begrenzt)."""
        items: list[dict[str, Any]] = []
        data = self._json("GET", url, params=params)
        for _ in range(MAX_PAGES):
            items.extend(item for item in data.get("value") or [] if isinstance(item, dict))
            next_link = data.get("@odata.nextLink")
            if not isinstance(next_link, str):
                break
            data = self._json("GET", next_link)
        return items

    @staticmethod
    def _job_url(job_id: str) -> str:
        if not _JOB_ID.match(job_id):
            raise UtcmError("Unerwartete Kennung eines Snapshot-Auftrags")
        return f"{UTCM_URL}/configurationSnapshotJobs/{job_id}"

    def create_snapshot(self, display_name: str, resources: list[str]) -> str:
        """Startet einen Snapshot und liefert die Kennung des Auftrags."""
        data = self._json(
            "POST",
            f"{UTCM_URL}/configurationSnapshots/createSnapshot",
            json={
                "displayName": display_name,
                "description": "Automatischer Abruf der Werkbank",
                "resources": resources,
            },
        )
        job_id = data.get("id")
        if not isinstance(job_id, str) or not _JOB_ID.match(job_id):
            raise UtcmError("Snapshot-Auftrag ohne Kennung")
        return job_id

    def get_job(self, job_id: str) -> dict[str, Any]:
        return self._json("GET", self._job_url(job_id), params={"$select": JOB_SELECT})

    def list_jobs(self) -> list[dict[str, Any]]:
        return self._pages(f"{UTCM_URL}/configurationSnapshotJobs", {"$select": JOB_SELECT})

    def delete_job(self, job_id: str) -> None:
        self._request("DELETE", self._job_url(job_id))

    def download(self, location: str) -> dict[str, Any]:
        """Lädt den fertigen Snapshot von der Adresse aus dem Auftrag."""
        return self._json("GET", location)

    def service_messages(self, since: datetime) -> list[dict[str, Any]]:
        """Meldungen des Nachrichtencenters, die seit einem Zeitpunkt geändert wurden."""
        moment = since.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        return self._pages(
            f"{GRAPH_URL}/admin/serviceAnnouncement/messages",
            {"$filter": f"lastModifiedDateTime ge {moment}", "$top": "100"},
        )

    def secure_score_profiles(self) -> list[dict[str, Any]]:
        """Alle Controls von Microsoft Secure Score mit Titel und Hinweisen zur Umsetzung."""
        return self._pages(f"{GRAPH_URL}/security/secureScoreControlProfiles", {"$top": "200"})

    def latest_secure_score(self) -> dict[str, Any] | None:
        """Der jüngste Stand des Tenants (Punkte je Control), oder None, wenn es keinen gibt."""
        data = self._json("GET", f"{GRAPH_URL}/security/secureScores", params={"$top": "1"})
        values = data.get("value")
        first = values[0] if isinstance(values, list) and values else None
        return first if isinstance(first, dict) else None

    def directory_audits(self, since: datetime) -> list[dict[str, Any]]:
        """Einträge des Entra-Audit-Logs seit einem Zeitpunkt (für „Geändert von“)."""
        moment = since.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        return self._pages(
            f"{GRAPH_URL}/auditLogs/directoryAudits",
            {"$filter": f"activityDateTime ge {moment}", "$top": "500"},
        )
