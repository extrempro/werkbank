"""Graph-Modul der Gerätezuordnung (nachgestellte Antworten) und zweite Anmeldung."""

import json
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_devices_api import HEADERS, KEY_FILE, ORIGIN, ROLE
from werkbank.config import Settings
from werkbank.core.app_settings import decrypt_secret
from werkbank.core.auth import get_entra_client
from werkbank.main import create_app
from werkbank.modules.devices.admin import ADMIN_SCOPES
from werkbank.modules.devices.graph import BETA, DeviceGraph, GraphError, explain
from werkbank.modules.devices.models import DeviceAdminSession

TENANT = "00000000-0000-0000-0000-00000000aaaa"


def graph(handler: Any) -> tuple[DeviceGraph, list[float]]:
    sleeps: list[float] = []
    client = httpx.Client(transport=httpx.MockTransport(handler))
    return DeviceGraph(client, lambda: "token", sleep=sleeps.append), sleeps


def test_retry_on_429_then_success() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) < 3:
            return httpx.Response(429, headers={"Retry-After": "2"})
        return httpx.Response(200, json={"id": "a1", "associationState": "preassociated"})

    api, sleeps = graph(handler)
    assert api.get_device("a1").association_state == "preassociated"
    assert sleeps == [2.0, 2.0] and len(calls) == 3
    assert calls[0].headers["Authorization"] == "Bearer token"


def test_429_gives_up_after_three_retries_and_5xx_is_not_retried() -> None:
    calls = []

    def throttled(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(429, headers={"Retry-After": "999"})

    api, sleeps = graph(throttled)
    with pytest.raises(GraphError) as error:
        api.get_device("x")
    assert error.value.status == 429 and len(calls) == 4 and sleeps == [30, 30, 30]

    posts = []

    def broken(request: httpx.Request) -> httpx.Response:
        posts.append(request)
        return httpx.Response(
            500,
            json={
                "error": {
                    "code": "InternalError",
                    "message": "x",
                    "innerError": {"request-id": "r-1"},
                }
            },
        )

    api, _ = graph(broken)
    with pytest.raises(GraphError) as error:
        api.import_device("ZGF0YQ==", "p1")
    assert (error.value.status, error.value.request_id, len(posts)) == (500, "r-1", 1)
    body = json.loads(posts[0].content)
    assert body == {"deviceLink": "ZGF0YQ==", "devicePreparationPolicyId": "p1"}
    info = explain(error.value)
    assert info["kind"] == "nicht_zuordenbar" and len(info["requirements"]) == 4
    assert "ZGF0YQ" not in str(error.value)


def test_policies_paging_and_exact_serial_match() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "configurationPolicies" in url and "seite2" not in url:
            assert "70d256b3-6120-4f88-9e00-0972ec64fc83_1" in request.url.params["$filter"]
            return httpx.Response(
                200,
                json={
                    "value": [{"id": "p2", "name": "Zweite"}],
                    "@odata.nextLink": f"{BETA}/deviceManagement/configurationPolicies?seite2",
                },
            )
        if "seite2" in url:
            return httpx.Response(200, json={"value": [{"id": "p1", "name": "Erste"}]})
        if "tenantAssociatedDevices" in url:
            assert request.url.params["$filter"] == "contains(serialNumber,'A''B')"
            return httpx.Response(
                200,
                json={
                    "value": [
                        {"id": "d1", "serialNumber": "A'B", "associationState": "associated"},
                        {"id": "d2", "serialNumber": "XA'BX", "associationState": "associated"},
                    ]
                },
            )
        return httpx.Response(404)

    api, _ = graph(handler)
    assert [p.name for p in api.list_policies()] == ["Erste", "Zweite"]
    assert [d.id for d in api.find_by_serial("A'B")] == ["d1"]


def test_confirm_waits_through_404_and_times_out() -> None:
    answers = iter([404, 200])

    def handler(request: httpx.Request) -> httpx.Response:
        code = next(answers, 200)
        if code == 404:
            return httpx.Response(404, json={"error": {"code": "NotFound"}})
        return httpx.Response(200, json={"id": "d1", "associationState": "preassociated"})

    api, sleeps = graph(handler)
    assert api.confirm("d1").association_state == "preassociated"
    assert sleeps == [3]

    def pending(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "d1", "associationState": "pending"})

    api, sleeps = graph(pending)
    with pytest.raises(GraphError) as error:
        api.confirm("d1")
    assert error.value.code == "ConfirmTimeout" and len(sleeps) == 10


def test_managed_device_newest_by_enrollment() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "value": [
                    {"id": "alt", "enrolledDateTime": "2025-01-01T00:00:00Z"},
                    {"id": "neu", "enrolledDateTime": "2026-11-01T00:00:00Z", "deviceName": "PC"},
                ]
            },
        )

    api, _ = graph(handler)
    found = api.managed_by_serial("SN1")
    assert found is not None and found.id == "neu" and found.device_name == "PC"


class FakeEntra:
    def __init__(self, result: dict[str, Any]) -> None:
        self.result = result
        self.scopes: list[str] = []
        self.kwargs: dict[str, Any] = {}

    def initiate_auth_code_flow(
        self, scopes: list[str], redirect_uri: str | None = None, **kwargs: Any
    ) -> dict[str, Any]:
        self.scopes, self.kwargs = scopes, {"redirect_uri": redirect_uri, **kwargs}
        return {"auth_uri": "https://login.example.com/authorize", "state": "abc"}

    def acquire_token_by_auth_code_flow(
        self, auth_code_flow: dict[str, Any], auth_response: dict[str, Any], **kwargs: Any
    ) -> dict[str, Any]:
        return self.result


def admin_client(fake: FakeEntra) -> TestClient:
    settings = Settings(
        public_url=ORIGIN,
        environment="test",
        enable_test_login=True,
        settings_key_file=KEY_FILE,
        entra_tenant_id=TENANT,
    )
    app = create_app(settings)
    app.dependency_overrides[get_entra_client] = lambda: fake
    client = TestClient(app, base_url=ORIGIN, follow_redirects=False)
    login = client.post(
        "/auth/test-login",
        json={"oid": "geraete-admin", "name": "Ina", "roles": [ROLE]},
        headers=HEADERS,
    )
    assert login.status_code == 303
    return client


@pytest.mark.db
def test_second_login_keeps_only_access_token(db_session: Session) -> None:
    db_session.execute(delete(DeviceAdminSession))
    db_session.commit()
    fake = FakeEntra(
        {
            "access_token": "zugriff-123",
            "refresh_token": "nie-speichern",
            "expires_in": 3599,
            "id_token_claims": {
                "tid": TENANT,
                "preferred_username": "admin@example.com",
                "name": "Admin",
            },
        }
    )
    client = admin_client(fake)
    start = client.get("/api/devices/admin/login")
    assert start.status_code == 303 and start.headers["location"].startswith(
        "https://login.example.com"
    )
    assert fake.scopes == ADMIN_SCOPES and fake.kwargs["prompt"] == "select_account"
    assert fake.kwargs["redirect_uri"] == f"{ORIGIN}/auth/geraete/callback"
    back = client.get("/auth/geraete/callback?code=x&state=abc")
    assert back.headers["location"] == "/m365/geraete/zuordnung?admin=verbunden"
    row = db_session.scalars(select(DeviceAdminSession)).one()
    assert "zugriff-123" not in row.token_enc and "nie-speichern" not in row.token_enc
    settings = Settings(settings_key_file=KEY_FILE)
    assert decrypt_secret(settings, row.token_enc) == "zugriff-123"
    status = client.get("/api/devices/admin").json()
    assert status["connected"] and status["upn"] == "admin@example.com"


@pytest.mark.db
def test_second_login_rejects_other_tenant(db_session: Session) -> None:
    db_session.execute(delete(DeviceAdminSession))
    db_session.commit()
    fake = FakeEntra({"access_token": "t", "id_token_claims": {"tid": "anderer"}})
    client = admin_client(fake)
    client.get("/api/devices/admin/login")
    back = client.get("/auth/geraete/callback?code=x&state=abc")
    assert back.headers["location"].endswith("admin=fehler")
    assert db_session.scalars(select(DeviceAdminSession)).all() == []
    # Ohne vorher begonnene Anmeldung ebenfalls nichts
    assert client.get("/auth/geraete/callback").headers["location"].endswith("admin=fehler")
