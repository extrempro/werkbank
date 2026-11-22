"""Prüfung der Berechtigungen für den Abruf: Anforderungen je Typ, Token, Vergleich, API."""

import base64
import json
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

from werkbank.config import Settings
from werkbank.main import create_app
from werkbank.modules.m365_config.permissions import (
    CheckOut,
    PermissionGraph,
    collector_needs,
    get_checker,
    run_check,
    satisfied,
    token_roles,
    utcm_needs,
)

ORIGIN = "https://testserver"
KEY_FILE = Path(tempfile.mkdtemp()) / "settings_key"
KEY_FILE.write_text("nur-fuer-tests-" + "x" * 40, encoding="utf-8")


def fake_token(roles: list[str]) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"roles": roles}).encode()).decode().rstrip("=")
    return f"kopf.{payload}.signatur"


class FakeGraph(PermissionGraph):
    def __init__(self, assigned: dict[str, set[str]]) -> None:
        self.assigned = assigned

    def utcm_assignments(self) -> dict[str, set[str]]:
        return self.assigned


def test_needs_per_type() -> None:
    apps = utcm_needs("microsoft.intune.appprotectionpolicyios")
    assert apps is not None
    assert {n.permission for n in apps} == {"DeviceManagementApps.Read.All", "Group.Read.All"}
    enroll = utcm_needs("microsoft.intune.windowsautopilotdeploymentprofileazureadjoined")
    assert enroll is not None and enroll[0].permission == "DeviceManagementServiceConfig.Read.All"
    config = utcm_needs("microsoft.intune.devicecompliancepolicyios")
    assert config is not None and config[0].permission == "DeviceManagementConfiguration.Read.All"
    exchange = utcm_needs("microsoft.exchange.transportrule")
    assert exchange is not None and exchange[0].resource == "exchange"
    assert utcm_needs("microsoft.unbekannt.typ") is None


def test_token_roles_and_satisfied() -> None:
    assert token_roles(fake_token(["AuditLog.Read.All"])) == {"AuditLog.Read.All"}
    assert token_roles("kein-token") == set()
    assert satisfied("DeviceManagementApps.Read.All", {"DeviceManagementApps.ReadWrite.All"})
    assert not satisfied(
        "DeviceManagementApps.Read.All", {"DeviceManagementConfiguration.Read.All"}
    )


def test_run_check_finds_missing_intune_permissions() -> None:
    settings = Settings(
        collector_resources=(
            "microsoft.teams.federationconfiguration,"
            "microsoft.intune.appprotectionpolicyios,"
            "microsoft.intune.devicecompliancepolicyios,"
            "microsoft.foo.bar"
        )
    )
    graph = FakeGraph({"graph": {"Organization.Read.All", "Group.Read.All"}, "exchange": set()})
    token = fake_token(["ConfigurationMonitoring.ReadWrite.All", "ServiceMessage.Read.All"])
    result = run_check(settings, graph, token)
    missing = {i.permission for i in result.utcm if not i.granted}
    assert missing == {"DeviceManagementApps.Read.All", "DeviceManagementConfiguration.Read.All"}
    apps = next(i for i in result.utcm if i.permission == "DeviceManagementApps.Read.All")
    assert apps.types == ["microsoft.intune.appprotectionpolicyios"]
    assert result.unknown_types == ["microsoft.foo.bar"]
    assert result.notes  # Hinweis auf Entra-Rollen für Teams
    collector = {i.permission: i for i in result.collector}
    assert collector["AuditLog.Read.All"].granted is False
    assert collector["ConfigurationMonitoring.ReadWrite.All"].granted is True


def test_collector_needs_follow_switches() -> None:
    plain = {p for p, _, required in collector_needs(Settings()) if required}
    assert "Reports.Read.All" not in plain
    usage = {
        p for p, _, required in collector_needs(Settings(tenant_usage_enabled=True)) if required
    }
    assert "Reports.Read.All" in usage


def client(settings: Settings, roles: list[str]) -> TestClient:
    app = create_app(settings)
    app.dependency_overrides[get_checker] = lambda: (
        lambda s: run_check(s, FakeGraph({"graph": set(), "exchange": set()}), fake_token([]))
    )
    test = TestClient(app, base_url=ORIGIN, follow_redirects=False, headers={"Origin": ORIGIN})
    response = test.post(
        "/auth/test-login", json={"oid": "rechte", "name": "Ada Admin", "roles": roles}
    )
    assert response.status_code == 303
    return test


def make_settings(**extra: object) -> Settings:
    return Settings(
        public_url=ORIGIN,
        environment="test",
        enable_test_login=True,
        settings_key_file=KEY_FILE,
        **extra,  # type: ignore[arg-type]
    )


def test_api_requires_admin_and_reports(db_session: object) -> None:
    configured = make_settings(
        collector_client_id="11111111-1111-1111-1111-111111111111",
        entra_tenant_id="22222222-2222-2222-2222-222222222222",
    )
    assert (
        client(configured, ["Config.Reader"]).post("/api/admin/collector/check").status_code == 403
    )
    response = client(configured, ["Werkbank.Admin"]).post("/api/admin/collector/check")
    assert response.status_code == 200
    data = CheckOut.model_validate(response.json())
    assert data.configured is True
    assert any(not i.granted for i in data.utcm)
    unconfigured = client(make_settings(), ["Werkbank.Admin"]).post("/api/admin/collector/check")
    assert unconfigured.json()["configured"] is False
