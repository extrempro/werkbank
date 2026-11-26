"""Abruf je Workload, Wiederholungen bei vorübergehenden Fehlern, Übernahme fertiger Aufträge."""

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.modules.m365_config.collector import (
    SHAREPOINT_SOURCE,
    CollectorError,
    collect,
    group_key,
    group_resources,
    job_name,
)
from werkbank.modules.m365_config.models import (
    CfgChange,
    CfgSetting,
    CfgSettingVersion,
    CfgSnapshot,
    ChangeKind,
    SnapshotStatus,
)
from werkbank.modules.m365_config.utcm import UTCM_URL, UtcmClient, UtcmError

CA = "microsoft.entra.conditionalaccesspolicy"
NL = "microsoft.entra.namedlocationpolicy"
DOMAIN = "microsoft.exchange.accepteddomain"
TEAMS = "microsoft.teams.meetingpolicy"

SETTINGS = Settings(
    environment="test",
    entra_tenant_id="00000000-0000-0000-0000-00000000aaaa",
    collector_client_id="00000000-0000-0000-0000-00000000cccc",
    collector_resources=f"{CA}, {DOMAIN}, {NL}",
    collector_poll_seconds=0,
)


def ca(state: str) -> dict[str, Any]:
    return {
        "displayName": "MFA",
        "resourceType": CA,
        "properties": {"Id": "ca-1", "DisplayName": "MFA", "State": state},
    }


def domain(kind: str) -> dict[str, Any]:
    return {
        "displayName": "example.com",
        "resourceType": DOMAIN,
        "properties": {"Identity": "example.com", "DomainType": kind},
    }


class Graph:
    """Microsoft Graph mit einem Auftrag je Workload (erkannt an den angefragten Typen)."""

    def __init__(
        self,
        documents: dict[str, list[dict[str, Any]]],
        *,
        download_errors: dict[str, list[httpx.Response]] | None = None,
        create_status: int = 200,
        job_status: dict[str, str] | None = None,
        old_jobs: list[dict[str, Any]] | None = None,
        sharepoint: dict[str, Any] | None = None,
    ) -> None:
        self.documents = documents
        self.download_errors = download_errors or {}
        self.create_status = create_status
        self.job_status = job_status or {}
        self.old_jobs = old_jobs or []
        self.sharepoint = sharepoint
        self.created: list[dict[str, Any]] = []
        self.deleted: list[str] = []
        self.downloads: list[str] = []
        self.posts = 0
        self.jobs: dict[str, str] = {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "POST" and path.endswith("/createSnapshot"):
            self.posts += 1
            if self.create_status != 200:
                return httpx.Response(
                    self.create_status,
                    json={"error": {"code": "UnknownError", "message": ""}},
                )
            body = json.loads(request.content)
            self.created.append(body)
            workload = body["resources"][0].split(".")[1]
            job_id = f"job-{workload}"
            self.jobs[job_id] = workload
            return httpx.Response(200, json={"id": job_id})
        if request.method == "GET" and path.endswith("/configurationSnapshotJobs"):
            return httpx.Response(200, json={"value": self.old_jobs})
        if request.method == "GET" and "/configurationSnapshotJobs/" in path:
            job_id = path.rsplit("/", 1)[1]
            workload = self.jobs[job_id]
            status = self.job_status.get(workload, "succeeded")
            return httpx.Response(
                200,
                json={
                    "id": job_id,
                    "status": status,
                    "resourceLocation": (
                        f"{UTCM_URL}/configurationSnapshots('{workload}')"
                        if status != "failed"
                        else ""
                    ),
                    "errorDetails": ["Keine Berechtigung"] if status == "failed" else [],
                },
            )
        if request.method == "DELETE" and "/configurationSnapshotJobs/" in path:
            self.deleted.append(path.rsplit("/", 1)[1])
            return httpx.Response(204)
        if request.method == "GET" and "/configurationSnapshots(" in path:
            workload = path.split("('", 1)[1].split("')", 1)[0]
            self.downloads.append(workload)
            pending = self.download_errors.get(workload) or []
            if pending:
                return pending.pop(0)
            return httpx.Response(200, json={"resources": self.documents.get(workload, [])})
        if request.method == "GET" and path.endswith("/admin/sharepoint/settings"):
            if self.sharepoint is None:
                return httpx.Response(403, json={"error": {"code": "Forbidden", "message": "Nein"}})
            return httpx.Response(200, json=self.sharepoint)
        if request.method == "GET" and path.endswith("/auditLogs/directoryAudits"):
            return httpx.Response(200, json={"value": []})
        return httpx.Response(404, json={"error": {"message": f"unbekannt: {path}"}})

    def client(self, waits: list[float]) -> UtcmClient:
        http = httpx.Client(transport=httpx.MockTransport(self.handler))
        return UtcmClient(http, lambda: "t", wait=waits.append)


def bad_gateway() -> httpx.Response:
    return httpx.Response(
        502,
        json={
            "error": {
                "code": "UnknownError",
                "message": "",
                "innerError": {"request-id": "11111111-2222-3333-4444-555555555555"},
            }
        },
    )


@pytest.fixture
def db(db_session: Session) -> Session:
    """Leerer Bestand für jeden Test."""
    for table in (CfgChange, CfgSettingVersion, CfgSetting, CfgSnapshot):
        db_session.execute(delete(table))
    db_session.commit()
    return db_session


def no_sleep(seconds: float) -> None:
    return None


# --- ohne Datenbank -------------------------------------------------------------------


def test_resources_are_grouped_by_workload() -> None:
    assert group_resources([CA, DOMAIN, NL, TEAMS, "anders"]) == {
        "entra": [CA, NL],
        "exchange": [DOMAIN],
        "teams": [TEAMS],
        "sonstige": ["anders"],
    }
    # Die Kennung hängt nur von den Typen ab, nicht von ihrer Reihenfolge
    assert group_key("entra", [CA, NL]) == group_key("entra", [NL, CA])
    assert group_key("entra", [CA]) != group_key("entra", [CA, NL])


def test_get_is_retried_with_growing_waits() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.method)
        return bad_gateway() if len(calls) == 1 else httpx.Response(200, json={"ok": True})

    waits: list[float] = []
    client = UtcmClient(
        httpx.Client(transport=httpx.MockTransport(handler)), lambda: "t", wait=waits.append
    )
    assert client.download(f"{UTCM_URL}/configurationSnapshots('x')") == {"ok": True}
    assert (calls, waits) == (["GET", "GET"], [5])


def test_get_gives_up_after_four_retries_with_graph_text() -> None:
    waits: list[float] = []
    client = UtcmClient(
        httpx.Client(transport=httpx.MockTransport(lambda request: bad_gateway())),
        lambda: "t",
        wait=waits.append,
    )
    with pytest.raises(UtcmError) as caught:
        client.download(f"{UTCM_URL}/configurationSnapshots('x')")
    assert waits == [5, 15, 45, 90]
    assert str(caught.value) == (
        "Microsoft Graph antwortet mit 502 (UnknownError) · "
        "request-id 11111111-2222-3333-4444-555555555555"
    )
    assert caught.value.status == 502


def test_retry_after_is_followed_and_capped() -> None:
    answers = [
        httpx.Response(429, headers={"Retry-After": "7"}),
        httpx.Response(429, headers={"Retry-After": "9999"}),
        httpx.Response(200, json={"value": []}),
    ]
    waits: list[float] = []
    client = UtcmClient(
        httpx.Client(transport=httpx.MockTransport(lambda request: answers.pop(0))),
        lambda: "t",
        wait=waits.append,
    )
    assert client.list_jobs() == []
    assert waits == [7, 120]


def test_timeouts_are_retried_but_post_and_delete_are_not() -> None:
    attempts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        attempts.append(request.method)
        if request.method == "GET" and len(attempts) == 1:
            raise httpx.ReadTimeout("langsam", request=request)
        return bad_gateway() if request.method != "GET" else httpx.Response(200, json={})

    waits: list[float] = []
    client = UtcmClient(
        httpx.Client(transport=httpx.MockTransport(handler)), lambda: "t", wait=waits.append
    )
    assert client.get_job("job-1") == {}
    with pytest.raises(UtcmError, match="502"):
        client.create_snapshot("Werkbank x", [CA])
    with pytest.raises(UtcmError, match="502"):
        client.delete_job("job-1")
    assert attempts == ["GET", "GET", "POST", "DELETE"]
    assert waits == [5]


# --- mit Datenbank --------------------------------------------------------------------


@pytest.mark.db
def test_one_job_per_workload_into_one_snapshot(db: Session) -> None:
    graph = Graph({"entra": [ca("enabled")], "exchange": [domain("Authoritative")]})
    result = collect(db, SETTINGS, graph.client([]), sleep=no_sleep)

    assert result.status == SnapshotStatus.OK
    assert [body["resources"] for body in graph.created] == [[CA, NL], [DOMAIN]]
    assert graph.created[0]["displayName"].startswith("Werkbank entra ")
    assert sorted(graph.deleted) == ["job-entra", "job-exchange"]
    assert db.scalars(select(CfgSnapshot)).all() == [db.get(CfgSnapshot, result.snapshot_id)]
    snapshot = db.get(CfgSnapshot, result.snapshot_id)
    assert snapshot is not None and snapshot.resource_count == 2


@pytest.mark.db
def test_failed_group_keeps_its_settings_and_others_are_taken(db: Session) -> None:
    collect(
        db,
        SETTINGS,
        Graph({"entra": [ca("enabled")], "exchange": [domain("Authoritative")]}).client([]),
        sleep=no_sleep,
    )
    # Exchange: fünfmal 502 beim Download (eine Anfrage und vier Wiederholungen)
    waits: list[float] = []
    graph = Graph(
        {"entra": [ca("disabled")], "exchange": []},
        download_errors={"exchange": [bad_gateway() for _ in range(5)]},
    )
    result = collect(db, SETTINGS, graph.client(waits), sleep=no_sleep)

    assert result.status == SnapshotStatus.PARTIAL
    assert (result.changed, result.removed) == (1, 0)
    assert waits == [5, 15, 45, 90]
    snapshot = db.get(CfgSnapshot, result.snapshot_id)
    assert snapshot is not None
    assert snapshot.source_status[f"utcm:{DOMAIN}"] is False
    assert snapshot.source_errors[f"utcm:{DOMAIN}"].startswith(
        "Exchange · Download: Microsoft Graph antwortet mit 502 (UnknownError)"
    )
    # Exchange bleibt im Bestand, nichts gilt als entfernt
    rows = db.scalars(select(CfgSetting).where(CfgSetting.workload == "exchange")).all()
    assert rows and all(row.active for row in rows)
    assert [change.kind for change in db.scalars(select(CfgChange)).all()] == [ChangeKind.CHANGED]
    # Der fertige Exchange-Auftrag bleibt bei UTCM für den nächsten Lauf stehen
    assert graph.deleted == ["job-entra"]


@pytest.mark.db
def test_download_succeeds_on_second_attempt(db: Session) -> None:
    graph = Graph(
        {"entra": [ca("enabled")], "exchange": [domain("Authoritative")]},
        download_errors={"exchange": [bad_gateway()]},
    )
    result = collect(db, SETTINGS, graph.client([]), sleep=no_sleep)
    assert result.status == SnapshotStatus.OK
    assert graph.downloads.count("exchange") == 2


@pytest.mark.db
def test_finished_job_of_earlier_run_is_taken_over(db: Session) -> None:
    started = datetime.now(UTC) - timedelta(hours=3)
    exchange_key = group_key("exchange", [DOMAIN])
    old_jobs = [
        {
            "id": "job-exchange",
            "displayName": job_name(exchange_key, started),
            "status": "succeeded",
            "resourceLocation": f"{UTCM_URL}/configurationSnapshots('exchange')",
            "createdDateTime": started.isoformat().replace("+00:00", "Z"),
        },
        # zu alt: wird gelöscht, nicht übernommen
        {
            "id": "job-alt",
            "displayName": job_name(exchange_key, started - timedelta(days=2)),
            "status": "succeeded",
            "resourceLocation": f"{UTCM_URL}/configurationSnapshots('alt')",
            "createdDateTime": (started - timedelta(days=2)).isoformat().replace("+00:00", "Z"),
        },
        # andere Typengruppe (Typenliste geändert): wird gelöscht
        {
            "id": "job-anders",
            "displayName": job_name(group_key("exchange", [DOMAIN, "x"]), started),
            "status": "succeeded",
            "resourceLocation": f"{UTCM_URL}/configurationSnapshots('anders')",
            "createdDateTime": started.isoformat().replace("+00:00", "Z"),
        },
    ]
    graph = Graph(
        {"entra": [ca("enabled")], "exchange": [domain("Authoritative")]}, old_jobs=old_jobs
    )
    graph.jobs["job-exchange"] = "exchange"
    result = collect(db, SETTINGS, graph.client([]), sleep=no_sleep)

    assert result.status == SnapshotStatus.OK
    assert [body["resources"] for body in graph.created] == [[CA, NL]]
    assert graph.downloads == ["entra", "exchange"]
    assert graph.deleted == ["job-alt", "job-anders", "job-entra", "job-exchange"]


@pytest.mark.db
def test_total_failure_stores_text_and_sharepoint_still_runs(db: Session) -> None:
    settings = SETTINGS.model_copy(update={"collector_sharepoint_enabled": True})
    graph = Graph({}, create_status=502, sharepoint={"sharingCapability": "disabled"})
    result = collect(db, settings, graph.client([]), sleep=no_sleep)

    # POST wird nicht wiederholt: ein Versuch je Gruppe
    assert graph.posts == 2
    assert result.status == SnapshotStatus.PARTIAL
    snapshot = db.get(CfgSnapshot, result.snapshot_id)
    assert snapshot is not None
    assert snapshot.source_status[SHAREPOINT_SOURCE] is True
    assert snapshot.source_errors[f"utcm:{CA}"].startswith(
        "Entra · Auftrag anlegen: Microsoft Graph antwortet mit 502 (UnknownError)"
    )

    # Ohne SharePoint scheitert alles: Snapshot mit Text je Quelle, Fehler für den Auftrag
    with pytest.raises(CollectorError, match="Exchange · Auftrag anlegen"):
        collect(db, SETTINGS, Graph({}, create_status=403).client([]), sleep=no_sleep)
    failed = db.scalars(select(CfgSnapshot).order_by(CfgSnapshot.id.desc())).first()
    assert failed is not None and failed.status == SnapshotStatus.FAILED
    assert failed.source_errors[f"utcm:{DOMAIN}"].startswith("Exchange · Auftrag anlegen: ")


@pytest.mark.db
def test_failed_utcm_job_is_reported_with_step(db: Session) -> None:
    graph = Graph({"entra": [ca("enabled")]}, job_status={"exchange": "failed"})
    result = collect(db, SETTINGS, graph.client([]), sleep=no_sleep)
    assert result.status == SnapshotStatus.PARTIAL
    snapshot = db.get(CfgSnapshot, result.snapshot_id)
    assert snapshot is not None
    assert (
        snapshot.source_errors[f"utcm:{DOMAIN}"]
        == "Exchange · UTCM meldet Fehler: Keine Berechtigung"
    )
    # Der gescheiterte Auftrag wird gleich weggeräumt
    assert "job-exchange" in graph.deleted
