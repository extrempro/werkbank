"""API des Bereichs IT-Monitoring."""

from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.core.admin_settings import client_ip
from werkbank.core.app_settings import NETBOX_KEY, get_setting
from werkbank.core.audit import write_audit
from werkbank.core.deps import DbDep, require_roles
from werkbank.core.models import Job, JobStatus
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.modules.monitoring.dns_check import (
    DNS_CHECK,
    DNS_CHECK_INTERVAL,
    KEEP_RUNS_DAYS,
    latest_ok_runs,
    new_problem_keys,
)
from werkbank.modules.monitoring.models import MonDnsRow, MonDnsRun
from werkbank.worker.jobs import enqueue

router = APIRouter(prefix="/api/monitoring")
MODULE = "monitoring"

MonitoringUser = Annotated[
    CurrentUser, Depends(require_roles(Role.MONITORING_READER, Role.WERKBANK_ADMIN))
]
AdminUser = Annotated[CurrentUser, Depends(require_roles(Role.WERKBANK_ADMIN))]


class RunOut(BaseModel):
    id: int
    started_at: datetime
    finished_at: datetime | None
    status: str
    error: str | None
    zones: int
    records: int
    queries: int
    counts: dict[str, int]
    delegations: list[str]
    skipped_types: dict[str, int]


class RowOut(BaseModel):
    key: str
    fqdn: str
    type: str
    zone: str
    status: str
    # Seit dem vorletzten Lauf als Problem hinzugekommen
    new: bool
    netbox: list[str]
    inactive: list[str]
    public: list[str]
    missing: list[str]
    extra: list[str]
    notes: list[str]
    netbox_url: str | None


class HistoryOut(BaseModel):
    started_at: datetime
    status: str
    counts: dict[str, int]


class DnsOut(BaseModel):
    # In der Verwaltung eingerichtet und eingeschaltet
    enabled: bool
    interval_hours: int
    # Letzter Lauf, auch wenn er fehlgeschlagen ist
    last_run: RunOut | None
    # Letzter erfolgreicher Lauf, aus dem die Zeilen stammen
    result_run: RunOut | None
    next_run_at: datetime | None
    rows: list[RowOut]
    history: list[HistoryOut]


def _strings(value: Any) -> list[str]:
    return [str(item) for item in value] if isinstance(value, list) else []


def _run_out(run: MonDnsRun) -> RunOut:
    details = run.details if isinstance(run.details, dict) else {}
    skipped = details.get("skipped_types")
    return RunOut(
        id=run.id,
        started_at=run.started_at,
        finished_at=run.finished_at,
        status=run.status,
        error=run.error,
        zones=run.zones,
        records=run.records,
        queries=run.queries,
        counts={str(k): int(v) for k, v in (run.counts or {}).items()},
        delegations=_strings(details.get("delegations")),
        skipped_types=(
            {str(k): int(v) for k, v in skipped.items()} if isinstance(skipped, dict) else {}
        ),
    )


def _enabled(db: Session) -> bool:
    stored = get_setting(db, NETBOX_KEY)
    return isinstance(stored, dict) and stored.get("enabled") is True


def _next_run(db: Session) -> datetime | None:
    return db.scalar(
        select(Job.scheduled_at)
        .where(Job.type == DNS_CHECK, Job.status == JobStatus.PLANNED)
        .order_by(Job.scheduled_at)
        .limit(1)
    )


@router.get("/dns")
def dns_overview(user: MonitoringUser, db: DbDep) -> DnsOut:
    """Ergebnis des letzten DNS-Abgleichs mit NetBox und der Verlauf der letzten 90 Tage."""
    last = db.scalars(select(MonDnsRun).order_by(MonDnsRun.id.desc()).limit(1)).first()
    ok_runs = latest_ok_runs(db, 1)
    result = ok_runs[0] if ok_runs else None
    _, new_keys = new_problem_keys(db)
    rows: list[RowOut] = []
    if result is not None:
        for row in db.scalars(
            select(MonDnsRow)
            .where(MonDnsRow.run_id == result.id)
            .order_by(MonDnsRow.zone, MonDnsRow.fqdn, MonDnsRow.type)
        ):
            data = row.data if isinstance(row.data, dict) else {}
            url = data.get("netbox_url")
            rows.append(
                RowOut(
                    key=row.key,
                    fqdn=row.fqdn,
                    type=row.type,
                    zone=row.zone,
                    status=row.status,
                    new=row.key in new_keys,
                    netbox=_strings(data.get("netbox")),
                    inactive=_strings(data.get("inactive")),
                    public=_strings(data.get("public")),
                    missing=_strings(data.get("missing")),
                    extra=_strings(data.get("extra")),
                    notes=_strings(data.get("notes")),
                    netbox_url=url if isinstance(url, str) and url.startswith("https://") else None,
                )
            )
    since = now_utc() - timedelta(days=KEEP_RUNS_DAYS)
    history = [
        HistoryOut(
            started_at=run.started_at,
            status=run.status,
            counts={str(k): int(v) for k, v in (run.counts or {}).items()},
        )
        for run in db.scalars(
            select(MonDnsRun).where(MonDnsRun.started_at >= since).order_by(MonDnsRun.started_at)
        )
    ]
    return DnsOut(
        enabled=_enabled(db),
        interval_hours=int(DNS_CHECK_INTERVAL.total_seconds() // 3600),
        last_run=_run_out(last) if last else None,
        result_run=_run_out(result) if result else None,
        next_run_at=_next_run(db),
        rows=rows,
        history=history,
    )


class RunNowOut(BaseModel):
    scheduled_at: datetime


@router.post("/dns/run")
def run_now(request: Request, user: AdminUser, db: DbDep) -> RunNowOut:
    """Zieht den nächsten Abgleich vor (Admins). Läuft schon einer, bleibt es dabei."""
    now = now_utc()
    planned = db.scalars(
        select(Job)
        .where(Job.type == DNS_CHECK, Job.status == JobStatus.PLANNED)
        .order_by(Job.scheduled_at)
        .limit(1)
    ).first()
    if planned is None:
        planned = enqueue(db, DNS_CHECK, scheduled_at=now)
    elif planned.scheduled_at > now:
        planned.scheduled_at = now
    write_audit(
        db,
        module=MODULE,
        action="dns.abgleich_angestossen",
        user_id=user.user_id,
        object_type="auftrag",
        object_id=DNS_CHECK,
        ip=client_ip(request),
    )
    db.commit()
    return RunNowOut(scheduled_at=planned.scheduled_at)
