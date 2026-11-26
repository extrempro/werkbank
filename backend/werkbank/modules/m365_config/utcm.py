"""Zugriff auf Microsoft Graph: Unified Tenant Configuration Management (UTCM), nur lesend.

Die Werkbank lässt UTCM einen Snapshot erstellen, wartet auf das Ergebnis und lädt es herunter.
Verändert wird dabei nur die Liste der Snapshot-Aufträge in UTCM, nie eine Einstellung des
Tenants. Siehe docs/entra-setup.md, Abschnitt 4.
"""

import logging
import re
import time
from collections.abc import Callable
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
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
_REQUEST_ID = re.compile(r"^[0-9A-Za-z-]{1,64}$")

logger = logging.getLogger(__name__)

# Vorübergehende Fehler: Lesende Anfragen (GET) werden mit wachsender Wartezeit wiederholt.
# Anlegen (POST) und Löschen (DELETE) nie, damit nichts doppelt passiert.
RETRY_STATUS = frozenset({429, 502, 503, 504})
RETRY_DELAYS: tuple[float, ...] = (5, 15, 45, 90)
# Höchstens so lange wird einem Retry-After von Microsoft gefolgt
RETRY_AFTER_MAX = 120.0


class UtcmError(RuntimeError):
    """Fehler beim Zugriff auf Microsoft Graph."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


def _retry_after(response: httpx.Response) -> float | None:
    """Wartezeit aus dem Header Retry-After (Sekunden oder Datum), begrenzt."""
    value = response.headers.get("Retry-After", "").strip()
    if not value:
        return None
    try:
        seconds = float(value)
    except ValueError:
        try:
            seconds = (parsedate_to_datetime(value) - datetime.now(UTC)).total_seconds()
        except TypeError, ValueError:
            return None
    return min(max(seconds, 0.0), RETRY_AFTER_MAX)


def graph_error_text(response: httpx.Response) -> str:
    """Kurzer Fehlertext: Status, Fehlercode und Meldung von Graph, dazu die request-id.

    Beispiel: „Microsoft Graph antwortet mit 502 (UnknownError) · request-id 1a2b…“.
    """
    code = message = request_id = ""
    try:
        data = response.json()
    except ValueError:
        data = None
    error = data.get("error") if isinstance(data, dict) else None
    if isinstance(error, dict):
        code = str(error.get("code") or "")
        message = str(error.get("message") or "")
        inner = error.get("innerError")
        if isinstance(inner, dict):
            request_id = str(inner.get("request-id") or "")
    elif response.text:
        message = response.text
    request_id = request_id or response.headers.get("request-id", "")
    text = f"Microsoft Graph antwortet mit {response.status_code}"
    if code:
        text += f" ({code[:60]})"
    if message.strip():
        text += f": {' '.join(message.split())[:ERROR_TEXT_LENGTH]}"
    if _REQUEST_ID.match(request_id):
        text += f" · request-id {request_id}"
    return text


def check_graph_url(url: str) -> str:
    """Lässt nur HTTPS-Adressen von Microsoft Graph zu (Adressen stammen teils aus Antworten)."""
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname != GRAPH_HOST:
        raise UtcmError("Unerwartete Adresse in der Antwort von Microsoft Graph")
    return url


# Nutzungsberichte (Reports.Read.All): nur Summen je Dienst, keine Personen
USAGE_REPORTS = frozenset({"getOffice365ServicesUserCounts", "getOffice365ActiveUserCounts"})
USAGE_PERIODS = frozenset({"D7", "D30", "D90", "D180"})
# Download-Adressen der Berichte: Microsoft nennt reports.office.com, vergibt aber auch
# regionale Hosts (z. B. reportsXYZ.office.com). Erlaubt: ein Label, das mit „reports“ beginnt,
# direkt vor office.com, optional mit Unterdomänen davor.
_REPORT_HOST = re.compile(r"^(?:[a-z0-9-]+\.)*reports[a-z0-9-]*\.office\.com$")
REPORT_MAX_BYTES = 2_000_000


def check_report_url(url: str) -> str:
    """Download-Adresse eines Berichts: nur HTTPS ohne eigenen Port bei reports*.office.com.

    Die Fehlermeldung nennt nur den Host, nie den Pfad: Der enthält den Download-Schlüssel.
    """
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    try:
        port = parts.port
    except ValueError:
        port = -1
    if parts.scheme != "https" or port is not None or not _REPORT_HOST.match(host):
        shown = host[:100] if host else "ohne Host"
        raise UtcmError(
            f"Unerwartete Download-Adresse des Berichts ({parts.scheme or '-'}://{shown})"
        )
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

    def __init__(
        self,
        http: httpx.Client,
        token: Callable[[], str],
        *,
        wait: Callable[[float], None] = time.sleep,
        retry_delays: tuple[float, ...] = RETRY_DELAYS,
    ) -> None:
        self._http = http
        self._token = token
        self._wait = wait
        self._retry_delays = retry_delays

    def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        """Eine Anfrage an Graph. GET wird bei vorübergehenden Fehlern wiederholt."""
        check_graph_url(url)
        extra_headers = kwargs.pop("headers", {})
        delays = self._retry_delays if method == "GET" else ()
        attempt = 0
        while True:
            try:
                headers = {"Authorization": f"Bearer {self._token()}", **extra_headers}
                response = self._http.request(method, url, headers=headers, **kwargs)
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                if attempt < len(delays):
                    self._retry(method, type(exc).__name__, attempt, delays[attempt])
                    attempt += 1
                    continue
                raise UtcmError(f"Microsoft Graph nicht erreichbar: {type(exc).__name__}") from exc
            except httpx.HTTPError as exc:
                raise UtcmError(f"Microsoft Graph nicht erreichbar: {type(exc).__name__}") from exc
            if response.status_code in RETRY_STATUS and attempt < len(delays):
                delay = _retry_after(response)
                self._retry(
                    method,
                    str(response.status_code),
                    attempt,
                    delays[attempt] if delay is None else delay,
                )
                attempt += 1
                continue
            if response.status_code >= 400:
                raise UtcmError(graph_error_text(response), status=response.status_code)
            return response

    def _retry(self, method: str, reason: str, attempt: int, delay: float) -> None:
        # Ohne Adresse und Tenant-Daten: nur Methode, Grund und Wartezeit
        logger.warning(
            "Microsoft Graph: %s mit %s, Wiederholung %d von %d in %.0f s",
            method,
            reason,
            attempt + 1,
            len(self._retry_delays),
            delay,
        )
        self._wait(delay)

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

    def sharepoint_settings(self) -> dict[str, Any]:
        """Mandanteneinstellungen von SharePoint und OneDrive (nur lesen)."""
        return self._json("GET", f"{GRAPH_URL}/admin/sharepoint/settings")

    def download(self, location: str) -> dict[str, Any]:
        """Lädt den fertigen Snapshot von der Adresse aus dem Auftrag."""
        return self._json("GET", location)

    def report_csv(self, report: str, period: str) -> str:
        """Nutzungsbericht als CSV (nur Summen). Graph leitet auf eine vorab angemeldete
        Download-Adresse um; die wird ohne Token und nur bei Microsoft abgerufen."""
        if report not in USAGE_REPORTS or period not in USAGE_PERIODS:
            raise UtcmError("Unbekannter Nutzungsbericht")
        response = self._request("GET", f"{GRAPH_URL}/reports/{report}(period='{period}')")
        if response.status_code in (301, 302, 303, 307, 308):
            location = check_report_url(response.headers.get("location", ""))
            try:
                response = self._http.get(location)
            except httpx.HTTPError as exc:
                raise UtcmError(f"Bericht nicht erreichbar: {type(exc).__name__}") from exc
            if response.status_code >= 400:
                raise UtcmError(f"Download des Berichts antwortet mit {response.status_code}")
        elif response.status_code != 200:
            raise UtcmError(f"Unerwartete Antwort auf den Bericht: {response.status_code}")
        if len(response.content) > REPORT_MAX_BYTES:
            raise UtcmError("Bericht ist unerwartet groß")
        return response.content.decode("utf-8-sig", errors="replace")

    def service_messages(self, since: datetime) -> list[dict[str, Any]]:
        """Meldungen des Nachrichtencenters, die seit einem Zeitpunkt geändert wurden."""
        moment = since.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
        return self._pages(
            f"{GRAPH_URL}/admin/serviceAnnouncement/messages",
            {"$filter": f"lastModifiedDateTime ge {moment}", "$top": "100"},
        )

    def health_overviews(self) -> list[dict[str, Any]]:
        """Aktueller Zustand je Dienst des Tenants (ServiceHealth.Read.All)."""
        return self._pages(f"{GRAPH_URL}/admin/serviceAnnouncement/healthOverviews", {})

    def health_issues(self, since: datetime | None) -> list[dict[str, Any]]:
        """Störungen und Hinweise, seit einem Zeitpunkt geändert (ohne Zeitpunkt: alle)."""
        params = {"$top": "100"}
        if since is not None:
            moment = since.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
            params["$filter"] = f"lastModifiedDateTime ge {moment}"
        return self._pages(f"{GRAPH_URL}/admin/serviceAnnouncement/issues", params)

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

    def subscribed_skus(self) -> list[dict[str, Any]]:
        """Lizenzen des Tenants mit gekauften und zugewiesenen Einheiten."""
        return self._pages(f"{GRAPH_URL}/subscribedSkus", {})

    def directory_subscriptions(self) -> list[dict[str, Any]]:
        """Abos des Tenants mit Zustand und nächstem Stichtag."""
        return self._pages(f"{GRAPH_URL}/directory/subscriptions", {})

    def applications(self) -> list[dict[str, Any]]:
        """App-Registrierungen mit ihren Zertifikaten und Secrets (ohne geheime Werte)."""
        return self._pages(
            f"{GRAPH_URL}/applications",
            {
                "$select": "id,appId,displayName,passwordCredentials,keyCredentials",
                "$top": "999",
            },
        )

    def sso_service_principals(self) -> list[dict[str, Any]]:
        """Unternehmensanwendungen mit SAML-Anmeldung und ihren Signaturzertifikaten.

        Gefiltert wird hier und nicht bei Microsoft, weil das Feld dort nicht verlässlich
        filterbar ist.
        """
        principals = self._pages(
            f"{GRAPH_URL}/servicePrincipals",
            {
                "$select": "id,appId,displayName,keyCredentials,preferredSingleSignOnMode",
                "$top": "999",
            },
        )
        return [entry for entry in principals if entry.get("preferredSingleSignOnMode") == "saml"]

    def user_count(self, filter_text: str | None) -> int:
        """Zahl der Konten, optional gefiltert. Liest nur die Zahl, keine Personen."""
        params = {"$filter": filter_text} if filter_text else {}
        response = self._request(
            "GET",
            f"{GRAPH_URL}/users/$count",
            params=params,
            headers={"ConsistencyLevel": "eventual"},
        )
        text = response.text.strip().lstrip("\ufeff")
        if not text.isdigit() or len(text) > 12:
            raise UtcmError("Unerwartete Antwort von Microsoft Graph (Anzahl)")
        return int(text)
