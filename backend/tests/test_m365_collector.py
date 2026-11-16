import json
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.models import AuditLog
from werkbank.core.sessions import now_utc
from werkbank.modules.m365_config.collector import (
    MONTHLY_RESOURCE_LIMIT,
    CollectorError,
    collect,
    parse_snapshot,
    resources_used_this_month,
    source_errors,
    source_status,
)
from werkbank.modules.m365_config.jobs import COLLECT
from werkbank.modules.m365_config.models import (
    CfgChange,
    CfgSetting,
    CfgSettingVersion,
    CfgSnapshot,
    ChangeKind,
    SnapshotStatus,
)
from werkbank.modules.m365_config.utcm import UTCM_URL, UtcmClient, UtcmError, check_graph_url
from werkbank.worker.tasks import CLEANUP, build_registry

CA = "microsoft.entra.conditionalaccesspolicy"
NL = "microsoft.entra.namedlocationpolicy"
POLICY_ID = "aaaaaaaa-1111-2222-3333-444444444444"
JOB_ID = "c91a1470-acc9-4585-bc03-522ae898f82f"
LOCATION = f"{UTCM_URL}/configurationSnapshots('{JOB_ID}')"

SETTINGS = Settings(
    environment="test",
    entra_tenant_id="00000000-0000-0000-0000-00000000aaaa",
    collector_client_id="00000000-0000-0000-0000-00000000cccc",
    collector_resources=f"{CA}, {NL.upper()}",
    collector_poll_seconds=0,
)


def ca_policy(state: str, name: str = "MFA für alle") -> dict[str, Any]:
    return {
        "displayName": name,
        "resourceType": CA,
        "properties": {
            "Id": POLICY_ID,
            "DisplayName": name,
            "State": state,
            "Ensure": "Present",
            "BuiltInControls": ["mfa"],
        },
    }


class FakeGraph:
    """Spielt Microsoft Graph für einen Abruf nach."""

    def __init__(
        self,
        resources: list[dict[str, Any]],
        *,
        status: str = "succeeded",
        error_details: list[str] | None = None,
        audits: list[dict[str, Any]] | None = None,
        old_jobs: list[dict[str, Any]] | None = None,
        polls_until_done: int = 1,
    ) -> None:
        self.resources = resources
        self.status = status
        self.error_details = error_details or []
        self.audits = audits or []
        self.old_jobs = old_jobs or []
        self.polls_until_done = polls_until_done
        self.polls = 0
        self.created: list[dict[str, Any]] = []
        self.deleted: list[str] = []
        self.tokens: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.tokens.append(request.headers.get("Authorization", ""))
        path = request.url.path
        if request.method == "POST" and path.endswith("/configurationSnapshots/createSnapshot"):
            self.created.append(json.loads(request.content))
            return httpx.Response(200, json={"id": JOB_ID, "status": "notStarted"})
        if request.method == "GET" and path.endswith("/configurationSnapshotJobs"):
            return httpx.Response(200, json={"value": self.old_jobs})
        if request.method == "GET" and path.endswith(f"/configurationSnapshotJobs/{JOB_ID}"):
            self.polls += 1
            if self.polls < self.polls_until_done:
                return httpx.Response(200, json={"id": JOB_ID, "status": "running"})
            return httpx.Response(
                200,
                json={
                    "id": JOB_ID,
                    "status": self.status,
                    "resourceLocation": LOCATION if self.status != "failed" else "",
                    "errorDetails": self.error_details,
                },
            )
        if request.method == "DELETE" and "/configurationSnapshotJobs/" in path:
            self.deleted.append(path.rsplit("/", 1)[1])
            return httpx.Response(204)
        if request.method == "GET" and "/configurationSnapshots(" in path:
            return httpx.Response(200, json={"id": JOB_ID, "resources": self.resources})
        if request.method == "GET" and path.endswith("/auditLogs/directoryAudits"):
            return httpx.Response(200, json={"value": self.audits})
        return httpx.Response(404, json={"error": {"message": f"unbekannt: {path}"}})

    def client(self) -> UtcmClient:
        http = httpx.Client(transport=httpx.MockTransport(self.handler))
        return UtcmClient(http, lambda: "test-token")


# --- ohne Datenbank -------------------------------------------------------------------


def test_only_graph_https_urls_are_allowed() -> None:
    assert check_graph_url(LOCATION) == LOCATION
    for url in (
        "http://graph.microsoft.com/v1.0/x",
        "https://graph.microsoft.com.example.com/x",
        "https://example.com/x",
    ):
        with pytest.raises(UtcmError):
            check_graph_url(url)


def test_download_refuses_foreign_location() -> None:
    client = FakeGraph([]).client()
    with pytest.raises(UtcmError):
        client.download("https://example.com/snapshot")


def test_graph_error_becomes_utcm_error() -> None:
    client = FakeGraph([]).client()
    with pytest.raises(UtcmError, match="404"):
        client.download(f"{UTCM_URL}/gibt-es-nicht")


def test_resource_list_is_normalized() -> None:
    assert SETTINGS.collector_resource_list() == [CA, NL]
    assert SETTINGS.collector_configured is True
    assert Settings(environment="test").collector_configured is False
    zero = "00000000-0000-0000-0000-000000000000"
    assert Settings(collector_client_id=zero, entra_tenant_id="x").collector_configured is False


def test_registry_contains_collector_only_when_configured() -> None:
    assert COLLECT in build_registry(SETTINGS)
    assert CLEANUP in build_registry(SETTINGS)
    assert COLLECT not in build_registry(Settings(environment="test"))


def test_parse_snapshot_uses_id_and_skips_internal_fields() -> None:
    singleton = {
        "displayName": "",
        "resourceType": "microsoft.entra.authorizationpolicy",
        "properties": {"IsSingleInstance": "Yes", "AllowInvitesFrom": "adminsAndGuestInviters"},
    }
    items, count = parse_snapshot({"resources": [ca_policy("enabled"), singleton, "kaputt"]})
    assert count == 2
    paths = {item.path for item in items}
    assert paths == {
        f"entra/conditionalaccesspolicy/{POLICY_ID}/DisplayName",
        f"entra/conditionalaccesspolicy/{POLICY_ID}/State",
        f"entra/conditionalaccesspolicy/{POLICY_ID}/BuiltInControls",
        "entra/authorizationpolicy/authorizationpolicy/AllowInvitesFrom",
    }
    state = next(item for item in items if item.property == "State")
    assert state.source == f"utcm:{CA}"
    assert state.object_name == "MFA für alle"


def test_parse_snapshot_handles_exchange_resources() -> None:
    rule = {
        "displayName": "",
        "resourceType": "microsoft.exchange.transportRule",
        "properties": {
            "Identity": "Externe Mails kennzeichnen",
            "Name": "Externe Mails kennzeichnen",
            "Enabled": True,
            "Ensure": "Present",
            "TenantId": "00000000-0000-0000-0000-00000000aaaa",
            "ApplicationId": "00000000-0000-0000-0000-00000000bbbb",
        },
    }
    second = {
        "resourceType": "microsoft.exchange.transportrule",
        "properties": {"Identity": "Weiterleitung blockieren", "Enabled": False},
    }
    org = {
        "resourceType": "microsoft.exchange.organizationconfig",
        "properties": {"IsSingleInstance": "Yes", "AuditDisabled": False},
    }
    items, count = parse_snapshot({"resources": [rule, second, org]})
    assert count == 3
    assert {item.workload for item in items} == {"exchange"}
    paths = {item.path for item in items}
    assert "exchange/transportrule/Externe Mails kennzeichnen/Enabled" in paths
    assert "exchange/transportrule/Weiterleitung blockieren/Enabled" in paths
    assert "exchange/organizationconfig/organizationconfig/AuditDisabled" in paths
    # Angaben zur Anmeldung des Abrufs und interne Felder sind keine Einstellungen
    properties = {item.property for item in items}
    assert properties.isdisjoint({"TenantId", "ApplicationId", "Ensure", "IsSingleInstance"})
    first = next(item for item in items if item.path.endswith("kennzeichnen/Enabled"))
    assert first.object_name == "Externe Mails kennzeichnen"
    assert first.source == "utcm:microsoft.exchange.transportrule"


def test_parse_snapshot_never_merges_objects_with_the_same_id() -> None:
    resource = {
        "resourceType": "microsoft.exchange.remotedomain",
        "properties": {"AllowedOOFType": "External"},
    }
    items, count = parse_snapshot({"resources": [resource, dict(resource)]})
    assert count == 2
    assert {item.object_id for item in items} == {"remotedomain", "remotedomain #2"}
    assert len({item.path for item in items}) == 2


def test_source_status_for_partial_snapshots() -> None:
    assert source_status([CA, NL], {"status": "succeeded"}) == {
        f"utcm:{CA}": True,
        f"utcm:{NL}": True,
    }
    partial = {"status": "partiallySuccessful", "errorDetails": [f"Fehler bei {NL.upper()}"]}
    assert source_status([CA, NL], partial) == {f"utcm:{CA}": True, f"utcm:{NL}": False}
    unclear = {"status": "partiallySuccessful", "errorDetails": []}
    assert not any(source_status([CA, NL], unclear).values())
    assert not any(source_status([CA, NL], {"status": "failed"}).values())


# --- mit Datenbank --------------------------------------------------------------------


@pytest.fixture
def db(db_session: Session) -> Session:
    """Leerer Bestand für jeden Test."""
    for table in (CfgChange, CfgSettingVersion, CfgSetting, CfgSnapshot):
        db_session.execute(delete(table))
    db_session.commit()
    return db_session


def no_sleep(seconds: float) -> None:
    return None


@pytest.mark.db
def test_collect_stores_baseline_and_cleans_up(db: Session) -> None:
    old_jobs = [
        {"id": "alt-1", "displayName": "Werkbank 20261101 000000", "status": "succeeded"},
        {"id": "fremd-1", "displayName": "Manuell angelegt", "status": "succeeded"},
        {"id": "laeuft-1", "displayName": "Werkbank 20261114 000000", "status": "running"},
    ]
    graph = FakeGraph([ca_policy("enabled")], old_jobs=old_jobs, polls_until_done=3)
    result = collect(db, SETTINGS, graph.client(), sleep=no_sleep)

    assert result.status == SnapshotStatus.OK
    assert (result.baseline, result.changes) == (3, 0)
    assert graph.polls == 3
    assert graph.created[0]["resources"] == [CA, NL]
    assert graph.created[0]["displayName"].startswith("Werkbank ")
    # nur eigene, abgeschlossene Aufträge werden entfernt, danach der neue
    assert graph.deleted == ["alt-1", JOB_ID]
    assert set(graph.tokens) == {"Bearer test-token"}

    snapshot = db.get(CfgSnapshot, result.snapshot_id)
    assert snapshot is not None
    assert snapshot.resource_count == 1
    assert resources_used_this_month(db, now_utc()) == 1
    entry = db.execute(
        select(AuditLog).where(
            AuditLog.action == "abruf.abgeschlossen",
            AuditLog.object_id == str(result.snapshot_id),
        )
    ).scalar_one()
    assert entry.module == "m365_config"
    assert entry.details is not None and entry.details["ausgangsstand"] == 3


@pytest.mark.db
def test_collect_detects_change_and_who_changed_it(db: Session) -> None:
    collect(db, SETTINGS, FakeGraph([ca_policy("enabled")]).client(), sleep=no_sleep)
    audits = [
        {
            "id": "audit-neu",
            "activityDateTime": "2026-11-14T10:00:00Z",
            "initiatedBy": {"user": {"userPrincipalName": "ada@example.com"}},
            "targetResources": [{"id": POLICY_ID.upper()}],
        },
        {
            "id": "audit-alt",
            "activityDateTime": "2026-11-14T08:00:00Z",
            "initiatedBy": {"app": {"displayName": "Ein Werkzeug"}},
            "targetResources": [{"id": POLICY_ID}],
        },
    ]
    graph = FakeGraph([ca_policy("disabled")], audits=audits)
    result = collect(db, SETTINGS, graph.client(), sleep=no_sleep)

    assert (result.changed, result.new, result.removed) == (1, 0, 0)
    change = db.execute(select(CfgChange)).scalar_one()
    assert change.kind == ChangeKind.CHANGED
    assert (change.old_value, change.new_value) == ("enabled", "disabled")
    assert change.changed_by == "ada@example.com"
    assert change.audit_ref == "audit-neu"


@pytest.mark.db
def test_failed_snapshot_is_recorded_and_changes_nothing(db: Session) -> None:
    collect(db, SETTINGS, FakeGraph([ca_policy("enabled")]).client(), sleep=no_sleep)
    graph = FakeGraph([], status="failed", error_details=["Keine Berechtigung"])
    with pytest.raises(CollectorError, match="Keine Berechtigung"):
        collect(db, SETTINGS, graph.client(), sleep=no_sleep)

    statuses = db.scalars(select(CfgSnapshot.status).order_by(CfgSnapshot.id)).all()
    assert statuses == [SnapshotStatus.OK, SnapshotStatus.FAILED]
    assert db.scalars(select(CfgChange)).all() == []
    assert all(setting.active for setting in db.scalars(select(CfgSetting)).all())


@pytest.mark.db
def test_timeout_is_reported(db: Session) -> None:
    graph = FakeGraph([ca_policy("enabled")], polls_until_done=1000)
    ticks = iter(range(0, 100_000, 600))
    with pytest.raises(CollectorError, match="nicht rechtzeitig"):
        collect(db, SETTINGS, graph.client(), sleep=no_sleep, clock=lambda: float(next(ticks)))
    assert db.scalars(select(CfgSnapshot.status)).all() == [SnapshotStatus.FAILED]


@pytest.mark.db
def test_monthly_quota_stops_collection(db: Session) -> None:
    db.add(
        CfgSnapshot(
            started_at=now_utc(),
            finished_at=now_utc(),
            status=SnapshotStatus.OK,
            resource_count=MONTHLY_RESOURCE_LIMIT,
        )
    )
    old = datetime.now(UTC) - timedelta(days=40)
    db.add(CfgSnapshot(started_at=old, status=SnapshotStatus.OK, resource_count=5))
    db.commit()
    assert resources_used_this_month(db, now_utc()) == MONTHLY_RESOURCE_LIMIT
    graph = FakeGraph([ca_policy("enabled")])
    with pytest.raises(CollectorError, match="Monatskontingent"):
        collect(db, SETTINGS, graph.client(), sleep=no_sleep)
    assert graph.created == []


@pytest.mark.db
def test_partial_snapshot_keeps_settings_of_failed_type(db: Session) -> None:
    location = {
        "displayName": "Büro",
        "resourceType": NL,
        "properties": {"Id": "nl-1", "DisplayName": "Büro", "IsTrusted": True},
    }
    collect(db, SETTINGS, FakeGraph([ca_policy("enabled"), location]).client(), sleep=no_sleep)
    graph = FakeGraph(
        [ca_policy("enabled")],
        status="partiallySuccessful",
        error_details=[f"Abruf von {NL} fehlgeschlagen"],
    )
    result = collect(db, SETTINGS, graph.client(), sleep=no_sleep)
    assert result.status == SnapshotStatus.PARTIAL
    assert result.changes == 0
    named = db.scalars(select(CfgSetting).where(CfgSetting.source == f"utcm:{NL}")).all()
    assert named and all(setting.active for setting in named)


def test_source_errors_carry_the_text_of_the_source() -> None:
    job = {
        "status": "partiallySuccessful",
        "errorDetails": [f"{NL.upper()}: Zugriff verweigert", "allgemeiner Hinweis"],
    }
    assert source_errors([CA, NL], job) == {f"utcm:{NL}": f"{NL.upper()}: Zugriff verweigert"}
    assert source_errors([CA, NL], {"status": "succeeded"}) == {}
    long = {"errorDetails": [f"{CA} " + "x" * 2000]}
    assert len(source_errors([CA], long)[f"utcm:{CA}"]) == 500
