"""Tenant: Abruf von Lizenzen und Benutzerzahlen, Verlauf, API und Rollen."""

from datetime import timedelta
from typing import Any

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_m365_api import ORIGIN, client_for
from werkbank.config import Settings
from werkbank.core.models import AuditLog
from werkbank.core.sessions import now_utc
from werkbank.modules.m365_config.utcm import UtcmClient, UtcmError
from werkbank.modules.tenant.inventory import (
    FETCH_TENANT,
    RETENTION_DAYS,
    fetch_inventory,
    subscription_dates,
)
from werkbank.modules.tenant.models import TenantLicense, TenantLicenseSample, TenantUserSample
from werkbank.modules.tenant.names import license_name
from werkbank.worker.tasks import build_registry

BASE = "/api/tenant"
E3 = "05E9A617-0261-4CEE-BB44-138D3EF5D965"
F3 = "66b55226-6b4f-492c-910c-a3b7a3c9d993"


def sku(sku_id: str, part_number: str, total: int, consumed: int, **units: int) -> dict[str, Any]:
    return {
        "skuId": sku_id,
        "skuPartNumber": part_number,
        "appliesTo": "User",
        "capabilityStatus": "Enabled",
        "consumedUnits": consumed,
        "prepaidUnits": {"enabled": total, "suspended": 0, "warning": 0, "lockedOut": 0, **units},
    }


def subscription(sku_id: str, moment: str, **overrides: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "skuId": sku_id,
        "status": "Enabled",
        "isTrial": False,
        "nextLifecycleDateTime": moment,
    }
    data.update(overrides)
    return data


class FakeGraph:
    def __init__(self) -> None:
        self.skus = [sku(E3, "SPE_E3", 50, 48), sku(F3, "SPE_F1", 20, 25, warning=5)]
        self.subscriptions = [
            subscription(E3, "2027-06-01T00:00:00Z"),
            subscription(E3, "2027-03-01T00:00:00Z"),
            subscription(E3, "2026-01-01T00:00:00Z", status="Deleted"),
            subscription(F3, "2027-01-15T00:00:00Z", isTrial=True),
        ]
        self.counts = {
            "": "120",
            "userType eq 'Guest'": "20",
            "accountEnabled eq false": "12",
            "userType eq 'Guest' and accountEnabled eq false": "2",
            "assignedLicenses/$count ne 0": "70",
        }
        self.status = 200
        self.licensed_fails = False
        self.count_headers: list[str | None] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.status != 200:
            return httpx.Response(self.status, json={"error": {"code": "Forbidden"}})
        path = request.url.path
        if path.endswith("/subscribedSkus"):
            return httpx.Response(200, json={"value": self.skus})
        if path.endswith("/directory/subscriptions"):
            return httpx.Response(200, json={"value": self.subscriptions})
        if path.endswith("/users/$count"):
            self.count_headers.append(request.headers.get("ConsistencyLevel"))
            filter_text = request.url.params.get("$filter", "")
            if self.licensed_fails and filter_text.startswith("assignedLicenses"):
                return httpx.Response(400, json={"error": {"code": "BadRequest"}})
            return httpx.Response(200, text=self.counts[filter_text])
        return httpx.Response(404, json={})

    def client(self) -> UtcmClient:
        return UtcmClient(httpx.Client(transport=httpx.MockTransport(self.handler)), lambda: "t")


@pytest.fixture
def db(migrated_db: None, db_session: Session) -> Session:
    for table in (TenantLicenseSample, TenantLicense, TenantUserSample):
        db_session.execute(delete(table))
    db_session.commit()
    return db_session


def test_subscription_dates_use_earliest_running_subscription() -> None:
    dates = subscription_dates(FakeGraph().subscriptions)
    earliest, trial = dates[E3.lower()]
    assert earliest is not None and earliest.isoformat() == "2027-03-01T00:00:00+00:00"
    assert trial is False
    assert dates[F3][1] is True
    # unbrauchbare Einträge werden übergangen
    assert subscription_dates([{"skuId": 5}, {"skuId": "x", "status": "Enabled"}]) == {
        "x": (None, False)
    }


def test_license_names() -> None:
    assert license_name("SPE_E3") == "Microsoft 365 E3"
    assert license_name("spe_f1") == "Microsoft 365 F3"
    assert license_name("UNBEKANNT_X") == "UNBEKANNT_X"


@pytest.mark.db
def test_fetch_stores_state_and_one_sample_per_day(db: Session) -> None:
    graph = FakeGraph()
    result = fetch_inventory(db, graph.client())
    assert (result.licenses, result.new, result.removed, result.users) == (2, 2, 0, 120)
    # Die Zählung braucht die Kopfzeile für erweiterte Abfragen.
    assert graph.count_headers and set(graph.count_headers) == {"eventual"}

    rows = {row.part_number: row for row in db.scalars(select(TenantLicense)).all()}
    e3 = rows["SPE_E3"]
    assert (e3.sku_id, e3.total, e3.consumed, e3.trial) == (E3.lower(), 50, 48, False)
    assert e3.next_lifecycle is not None and e3.next_lifecycle.date().isoformat() == "2027-03-01"
    assert (rows["SPE_F1"].warning, rows["SPE_F1"].trial) == (5, True)
    users = db.scalars(select(TenantUserSample)).one()
    assert (users.total, users.guests, users.disabled, users.guests_disabled, users.licensed) == (
        120,
        20,
        12,
        2,
        70,
    )

    # zweiter Abruf am selben Tag: der Eintrag des Tages wird überschrieben, nichts doppelt
    graph.skus = [sku(E3, "SPE_E3", 60, 49)]
    graph.counts[""] = "121"
    result = fetch_inventory(db, graph.client())
    assert (result.licenses, result.new, result.removed) == (1, 0, 1)
    db.expire_all()
    samples = db.scalars(select(TenantLicenseSample).where(TenantLicenseSample.license_id == e3.id))
    assert [(sample.total, sample.consumed) for sample in samples] == [(60, 49)]
    assert db.scalars(select(TenantUserSample)).one().total == 121
    assert db.scalars(select(TenantLicense.part_number).where(TenantLicense.active)).all() == [
        "SPE_E3"
    ]
    entry = db.scalars(
        select(AuditLog).where(AuditLog.action == "inventar.abruf").order_by(AuditLog.id.desc())
    ).first()
    assert entry is not None and (entry.details or {})["entfallen"] == 1


@pytest.mark.db
def test_fetch_survives_missing_licensed_count_and_purges_old_samples(db: Session) -> None:
    graph = FakeGraph()
    fetch_inventory(db, graph.client())
    license_id = db.scalars(
        select(TenantLicense.id).where(TenantLicense.part_number == "SPE_E3")
    ).one()
    today = now_utc().date()
    old = today - timedelta(days=RETENTION_DAYS + 1)
    kept = today - timedelta(days=RETENTION_DAYS - 1)
    for day in (old, kept):
        db.add(TenantLicenseSample(license_id=license_id, day=day, total=1, consumed=1))
        db.add(TenantUserSample(day=day, total=1, guests=0, disabled=0, guests_disabled=0))
    db.commit()

    graph.licensed_fails = True
    fetch_inventory(db, graph.client())
    db.expire_all()
    current = db.get(TenantUserSample, today)
    assert current is not None and current.licensed is None
    assert db.get(TenantUserSample, old) is None
    assert db.get(TenantUserSample, kept) is not None
    assert db.get(TenantLicenseSample, (license_id, old)) is None
    assert db.get(TenantLicenseSample, (license_id, kept)) is not None


@pytest.mark.db
def test_fetch_without_permission_fails_and_keeps_data(db: Session) -> None:
    graph = FakeGraph()
    fetch_inventory(db, graph.client())
    graph.status = 403
    with pytest.raises(UtcmError):
        fetch_inventory(db, graph.client())
    db.rollback()
    assert len(db.scalars(select(TenantLicense).where(TenantLicense.active)).all()) == 2


def test_job_only_when_enabled() -> None:
    base: dict[str, Any] = {
        "public_url": ORIGIN,
        "environment": "test",
        "entra_tenant_id": "00000000-0000-0000-0000-00000000aaaa",
        "collector_client_id": "00000000-0000-0000-0000-00000000cccc",
    }
    assert FETCH_TENANT not in build_registry(Settings(**base))
    assert FETCH_TENANT in build_registry(Settings(**base, tenant_monitor_enabled=True))
    without_collector = Settings(public_url=ORIGIN, environment="test", tenant_monitor_enabled=True)
    assert FETCH_TENANT not in build_registry(without_collector)


@pytest.mark.db
def test_api_lists_licenses_and_history_for_readers_only(db: Session) -> None:
    fetch_inventory(db, FakeGraph().client())
    stranger = client_for(["Config.Reader"], "tenant-fremd")
    assert stranger.get(f"{BASE}/licenses").status_code == 403
    assert stranger.get(f"{BASE}/users").status_code == 403

    reader = client_for(["Tenant.Reader"], "tenant-leser")
    data = reader.get(f"{BASE}/licenses").json()
    assert data["enabled"] is False
    assert (data["total"], data["consumed"]) == (70, 73)
    assert [entry["name"] for entry in data["entries"]] == ["Microsoft 365 E3", "Microsoft 365 F3"]
    f3 = data["entries"][1]
    assert (f3["free"], f3["warning"], f3["trial"]) == (-5, 5, True)

    detail = reader.get(f"{BASE}/licenses/{f3['id']}").json()
    assert detail["license"]["part_number"] == "SPE_F1"
    assert [(sample["total"], sample["consumed"]) for sample in detail["samples"]] == [(20, 25)]
    assert reader.get(f"{BASE}/licenses/999999").status_code == 404
    assert reader.get(f"{BASE}/licenses/{f3['id']}", params={"days": 7}).status_code == 422

    users = reader.get(f"{BASE}/users", params={"days": 365}).json()
    current = users["current"]
    assert (current["total"], current["members"], current["guests"]) == (120, 100, 20)
    assert (current["enabled"], current["disabled"], current["licensed"]) == (108, 12, 70)
    assert len(users["samples"]) == 1


@pytest.mark.db
def test_api_is_empty_before_first_fetch(db: Session) -> None:
    reader = client_for(["Tenant.Reader"], "tenant-leer")
    data = reader.get(f"{BASE}/licenses").json()
    assert (data["fetched_at"], data["entries"]) == (None, [])
    users = reader.get(f"{BASE}/users").json()
    assert (users["current"], users["samples"]) == (None, [])
