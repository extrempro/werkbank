"""Große Workloads in mehrere UTCM-Aufträge teilen (COLLECTOR_MAX_TYPES_PER_JOB)."""

import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from pydantic import ValidationError
from sqlalchemy import delete
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.modules.m365_config.collector import (
    MAX_VISIBLE_JOBS,
    collect,
    job_description,
    job_name,
    plan_groups,
    split_types,
)
from werkbank.modules.m365_config.models import (
    CfgChange,
    CfgSetting,
    CfgSettingVersion,
    CfgSnapshot,
    SnapshotStatus,
)
from werkbank.modules.m365_config.utcm import UTCM_URL, UtcmClient

CA = "microsoft.entra.conditionalaccesspolicy"
INTUNE = [f"microsoft.intune.typ{index:02d}" for index in range(29)]


def settings(resources: list[str], limit: int = 10) -> Settings:
    return Settings(
        environment="test",
        entra_tenant_id="00000000-0000-0000-0000-00000000aaaa",
        collector_client_id="00000000-0000-0000-0000-00000000cccc",
        collector_resources=",".join(resources),
        collector_poll_seconds=0,
        collector_max_types_per_job=limit,
    )


def resource(resource_type: str) -> dict[str, Any]:
    name = resource_type.rsplit(".", 1)[1]
    return {
        "displayName": name,
        "resourceType": resource_type,
        "properties": {"Id": name, "DisplayName": name, "Wert": 1},
    }


class Graph:
    """Microsoft Graph mit einem Auftrag je angefragter Typenliste (Kennung = erster Typ)."""

    def __init__(
        self,
        *,
        download_errors: dict[str, int] | None = None,
        old_jobs: list[dict[str, Any]] | None = None,
    ) -> None:
        self.download_errors = download_errors or {}
        self.old_jobs = old_jobs or []
        self.created: list[dict[str, Any]] = []
        self.deleted: list[str] = []
        self.downloads: list[str] = []
        self.jobs: dict[str, list[str]] = {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.method == "POST" and path.endswith("/createSnapshot"):
            body = json.loads(request.content)
            self.created.append(body)
            job_id = "job-" + body["resources"][0].rsplit(".", 1)[1]
            self.jobs[job_id] = body["resources"]
            return httpx.Response(200, json={"id": job_id})
        if request.method == "GET" and path.endswith("/configurationSnapshotJobs"):
            return httpx.Response(200, json={"value": self.old_jobs})
        if request.method == "GET" and "/configurationSnapshotJobs/" in path:
            job_id = path.rsplit("/", 1)[1]
            return httpx.Response(
                200,
                json={
                    "id": job_id,
                    "status": "succeeded",
                    "resourceLocation": f"{UTCM_URL}/configurationSnapshots('{job_id}')",
                    "errorDetails": [],
                },
            )
        if request.method == "DELETE" and "/configurationSnapshotJobs/" in path:
            self.deleted.append(path.rsplit("/", 1)[1])
            return httpx.Response(204)
        if request.method == "GET" and "/configurationSnapshots(" in path:
            job_id = path.split("('", 1)[1].split("')", 1)[0]
            self.downloads.append(job_id)
            if self.download_errors.get(job_id, 0) > 0:
                self.download_errors[job_id] -= 1
                return httpx.Response(502, json={"error": {"code": "UnknownError", "message": ""}})
            return httpx.Response(
                200, json={"resources": [resource(name) for name in self.jobs.get(job_id, [])]}
            )
        if request.method == "GET" and path.endswith("/auditLogs/directoryAudits"):
            return httpx.Response(200, json={"value": []})
        return httpx.Response(404, json={"error": {"message": f"unbekannt: {path}"}})

    def client(self) -> UtcmClient:
        http = httpx.Client(transport=httpx.MockTransport(self.handler))
        return UtcmClient(http, lambda: "t", wait=lambda _seconds: None)


def no_sleep(seconds: float) -> None:
    return None


@pytest.fixture
def db(db_session: Session) -> Session:
    for table in (CfgChange, CfgSettingVersion, CfgSetting, CfgSnapshot):
        db_session.execute(delete(table))
    db_session.commit()
    return db_session


def own_job(job_id: str, key: str, started: datetime, status: str = "succeeded") -> dict[str, Any]:
    return {
        "id": job_id,
        "displayName": job_name(key, started),
        "description": job_description(key),
        "status": status,
        "resourceLocation": f"{UTCM_URL}/configurationSnapshots('{job_id}')",
        "createdDateTime": started.isoformat().replace("+00:00", "Z"),
    }


# --- ohne Datenbank -------------------------------------------------------------------


def test_split_types_into_even_parts_in_stable_order() -> None:
    parts = split_types(INTUNE, 10)
    assert [len(part) for part in parts] == [10, 10, 9]
    assert [name for part in parts for name in part] == INTUNE
    assert [len(part) for part in split_types(INTUNE, 1)] == [1] * 29
    assert split_types(INTUNE, 50) == [INTUNE]
    assert [len(part) for part in split_types(INTUNE[:21], 10)] == [7, 7, 7]
    assert split_types([], 10) == []


def test_plan_groups_keeps_keys_between_runs() -> None:
    first = plan_groups([CA, *INTUNE], 10)
    second = plan_groups([CA, *INTUNE], 10)
    assert [job.key for job in first] == [job.key for job in second]
    assert [job.label for job in first] == [
        "Entra",
        "Intune · Teil 1/3",
        "Intune · Teil 2/3",
        "Intune · Teil 3/3",
    ]
    assert len({job.key for job in first}) == 4
    # Die Grenzen der Auftragstexte bleiben eingehalten
    for job in first:
        assert len(job_description(job.key)) <= 32
        assert len(job_name(job.key, datetime.now(UTC))) <= 32


def test_invalid_limit_is_rejected_at_start() -> None:
    for bad in (0, 51, -3):
        with pytest.raises(ValidationError, match="collector_max_types_per_job"):
            settings([CA], bad)
    assert Settings(environment="test").collector_max_types_per_job == 10


# --- mit Datenbank --------------------------------------------------------------------


class Records(logging.Handler):
    """Sammelt die Meldungen eines Loggers (unabhängig von der Logging-Konfiguration der App)."""

    def __init__(self) -> None:
        super().__init__(logging.INFO)
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(record.getMessage())


@pytest.mark.db
def test_parts_go_into_one_snapshot_with_size_log(db: Session) -> None:
    graph = Graph()
    logger = logging.getLogger("werkbank.modules.m365_config.collector")
    records = Records()
    level, disabled = logger.level, logger.disabled
    # Alembic (fileConfig) schaltet beim Anlegen der Testdatenbank vorhandene Logger ab
    logger.disabled = False
    logger.addHandler(records)
    logger.setLevel(logging.INFO)
    try:
        result = collect(db, settings([CA, *INTUNE]), graph.client(), sleep=no_sleep)
    finally:
        logger.removeHandler(records)
        logger.setLevel(level)
        logger.disabled = disabled

    assert result.status == SnapshotStatus.OK
    assert [len(body["resources"]) for body in graph.created] == [1, 10, 10, 9]
    snapshot = db.get(CfgSnapshot, result.snapshot_id)
    assert snapshot is not None and snapshot.resource_count == 30
    assert all(snapshot.source_status[f"utcm:{name}"] for name in INTUNE)
    messages = records.messages
    assert any("4 Aufträge geplant" in text for text in messages)
    sizes = [
        text for text in messages if text.startswith("Intune · Teil 2/3: 10 Typen, 10 Objekte")
    ]
    assert len(sizes) == 1 and " KB, Download " in sizes[0]
    # keine Namen der Objekte im Protokoll
    assert not any("typ05" in text for text in messages)


@pytest.mark.db
def test_failed_part_is_named_and_others_are_taken(db: Session) -> None:
    first_of_part_two = INTUNE[10].rsplit(".", 1)[1]
    graph = Graph(download_errors={f"job-{first_of_part_two}": 99})
    result = collect(db, settings(INTUNE), graph.client(), sleep=no_sleep)

    assert result.status == SnapshotStatus.PARTIAL
    snapshot = db.get(CfgSnapshot, result.snapshot_id)
    assert snapshot is not None
    for name in INTUNE[10:20]:
        assert snapshot.source_status[f"utcm:{name}"] is False
        assert snapshot.source_errors[f"utcm:{name}"].startswith(
            "Intune · Teil 2/3 · Download: Microsoft Graph antwortet mit 502"
        )
    for name in INTUNE[:10] + INTUNE[20:]:
        assert snapshot.source_status[f"utcm:{name}"] is True
    # Der fertige, nicht geladene Auftrag bleibt für den nächsten Lauf stehen
    assert f"job-{first_of_part_two}" not in graph.deleted


@pytest.mark.db
def test_parts_without_free_slot_are_skipped(db: Session) -> None:
    started = datetime.now(UTC) - timedelta(minutes=5)
    # Zehn fremde, laufende Aufträge belegen Plätze; nur zwei sind frei
    foreign = [
        {"id": f"fremd-{index}", "displayName": f"Fremd {index}", "status": "running"}
        for index in range(MAX_VISIBLE_JOBS - 2)
    ]
    graph = Graph(old_jobs=foreign)
    result = collect(db, settings(INTUNE), graph.client(), sleep=no_sleep)

    assert result.status == SnapshotStatus.PARTIAL
    assert len(graph.created) == 2
    snapshot = db.get(CfgSnapshot, result.snapshot_id)
    assert snapshot is not None
    assert snapshot.source_errors[f"utcm:{INTUNE[-1]}"] == (
        "Intune · Teil 3/3: kein freier Platz bei UTCM"
    )
    assert all(snapshot.source_status[f"utcm:{name}"] for name in INTUNE[:20])
    assert started < datetime.now(UTC)


@pytest.mark.db
def test_finished_part_of_earlier_run_is_taken_over(db: Session) -> None:
    started = datetime.now(UTC) - timedelta(hours=2)
    jobs = plan_groups(INTUNE, 10)
    part_three = jobs[2]
    old_id = "job-alt-teil3"
    graph = Graph(old_jobs=[own_job(old_id, part_three.key, started)])
    graph.jobs[old_id] = part_three.resources
    result = collect(db, settings(INTUNE), graph.client(), sleep=no_sleep)

    assert result.status == SnapshotStatus.OK
    assert [body["resources"] for body in graph.created] == [jobs[0].resources, jobs[1].resources]
    assert old_id in graph.downloads
    assert old_id in graph.deleted
