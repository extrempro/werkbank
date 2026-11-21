"""Gerätezuordnung: Rechte, Scannen, sofort freigeben, zur Freigabe senden, Freigabe durch eine
andere Person, Verwerfen, Ablauf nach 24 Stunden, Status. Graph ist nachgestellt."""

import tempfile
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_devices_devicelink import SAMPLE, changed, make_qr
from werkbank.config import Settings
from werkbank.core.models import AuditLog
from werkbank.core.sessions import now_utc
from werkbank.main import create_app
from werkbank.modules.devices.api import get_app_graph
from werkbank.modules.devices.graph import AssociatedDevice, ManagedDevice
from werkbank.modules.devices.models import DeviceAdminSession, DeviceAssociation
from werkbank.modules.devices.service import check_open, expire_pending

ORIGIN = "https://testserver"
HEADERS = {"Origin": ORIGIN}
BASE = "/api/devices"
ROLE = "Geraete.Zuordnung"


KEY_FILE = Path(tempfile.mkdtemp()) / "settings_key"
KEY_FILE.write_text("nur-fuer-tests-" + "x" * 40, encoding="utf-8")


def client_for(
    roles: list[str], oid: str, name: str = "Ina Beispiel", app_graph: Any = None
) -> TestClient:
    settings = Settings(
        public_url=ORIGIN, environment="test", enable_test_login=True, settings_key_file=KEY_FILE
    )
    app = create_app(settings)
    app.dependency_overrides[get_app_graph] = lambda: app_graph
    client = TestClient(app, base_url=ORIGIN, follow_redirects=False)
    response = client.post(
        "/auth/test-login", json={"oid": oid, "name": name, "roles": roles}, headers=HEADERS
    )
    assert response.status_code == 303, response.text
    return client


def connect_admin(client: TestClient, upn: str = "admin@example.com") -> None:
    response = client.post(f"{BASE}/admin/test-login", json={"upn": upn}, headers=HEADERS)
    assert response.status_code == 200, response.text
    assert response.json()["connected"] is True


def qr(serial: str) -> str:
    return make_qr(changed(di={"sn": serial}), serial=serial)


def post(client: TestClient, path: str, body: dict[str, Any] | None = None) -> Any:
    return client.post(f"{BASE}{path}", json=body or {}, headers=HEADERS)


@pytest.fixture
def db(db_session: Session) -> Session:
    db_session.execute(delete(DeviceAssociation))
    db_session.execute(delete(DeviceAdminSession))
    db_session.commit()
    return db_session


def audit_actions(db: Session, serial: str) -> list[str]:
    return list(
        db.scalars(
            select(AuditLog.action)
            .where(AuditLog.module == "geraete", AuditLog.object_id == serial)
            .order_by(AuditLog.id)
        )
    )


def test_api_requires_login() -> None:
    client = TestClient(create_app(Settings(public_url=ORIGIN, environment="test")))
    assert client.get(f"{BASE}/entries").status_code == 401


@pytest.mark.db
def test_role_is_checked_on_the_server(db: Session) -> None:
    other = client_for(["Config.Reader", "Bestand.Editor"], "geraete-fremd")
    assert other.get(f"{BASE}/entries").status_code == 403
    assert post(other, "/scan", {"qr": qr("SNTEST1")}).status_code == 403
    assert other.get(f"{BASE}/admin").status_code == 403
    assert other.get("/api/navigation").status_code == 200


@pytest.mark.db
def test_scan_without_admin_and_invalid_codes(db: Session) -> None:
    ina = client_for([ROLE], "geraete-ina")
    preview = post(ina, "/scan", {"qr": qr("SNSCAN1")}).json()
    assert preview["serial_number"] == "SNSCAN1"
    assert (preview["manufacturer"], preview["model"]) == ("BEISPIEL", "Modell 1")
    assert preview["admin_connected"] is False
    assert preview["policies"] == [] and preview["duplicate"] is None
    assert "device_link" not in preview and "qr" not in preview
    bad = post(ina, "/scan", {"qr": "https://example.com/irgendwas"})
    assert bad.status_code == 422 and "kein QR-Code" in bad.json()["detail"]
    assert post(ina, "/scan", {"qr": "x" * 5000}).status_code == 422
    # Ohne Admin-Konto kein Import
    assert post(ina, "/entries/import", {"qr": qr("SNSCAN1")}).status_code == 409


@pytest.mark.db
def test_scan_and_import_now(db: Session) -> None:
    ina = client_for([ROLE], "geraete-ina")
    connect_admin(ina)
    preview = post(ina, "/scan", {"qr": qr("SNNOW1")}).json()
    assert preview["admin_connected"] and preview["admin_upn"] == "admin@example.com"
    assert preview["tenant_name"] == "Beispiel-Tenant"
    policy = preview["policies"][0]
    result = post(ina, "/entries/import", {"qr": qr("SNNOW1"), "policy_id": policy["id"]}).json()
    assert result["ok"] is True, result
    entry = result["entry"]
    assert entry["status"] == "vorab" and entry["association_state"] == "preassociated"
    assert entry["policy_name"] == policy["name"]
    assert entry["scanned_by"] == entry["approved_by"] == "Ina Beispiel"
    assert entry["approved_admin"] == "admin@example.com"
    row = db.get(DeviceAssociation, entry["id"])
    assert row is not None and row.device_link_enc is None
    assert audit_actions(db, "SNNOW1") == ["geraet.gescannt", "geraet.freigegeben"]
    # Unbekannte Richtlinie wird abgelehnt
    assert post(ina, "/entries/import", {"qr": qr("SNNOW2"), "policy_id": "x"}).status_code == 422


@pytest.mark.db
def test_duplicate_and_errors_with_request_id(db: Session) -> None:
    ina = client_for([ROLE], "geraete-ina")
    connect_admin(ina)
    preview = post(ina, "/scan", {"qr": qr("SNDOPPELT1")}).json()
    assert preview["duplicate"]["association_state"] == "associated"
    blocked = post(ina, "/entries/import", {"qr": qr("SNDOPPELT1")}).json()
    assert blocked["ok"] is False and blocked["duplicate"] is not None

    failed = post(ina, "/entries/import", {"qr": qr("SNFEHLER500")}).json()
    assert failed["ok"] is False
    assert failed["error"]["kind"] == "nicht_zuordenbar"
    assert failed["error"]["request_id"] == "00000000-test-0500"
    assert any("TPM 2.0" in item for item in failed["error"]["requirements"])
    denied = post(ina, "/entries/import", {"qr": qr("SNOHNERECHT")}).json()
    assert denied["error"]["kind"] == "keine_berechtigung"
    assert db.scalars(select(DeviceAssociation)).all() == []


@pytest.mark.db
def test_send_for_approval_and_approve_by_other_person(db: Session) -> None:
    mobile = client_for([ROLE], "geraete-handy", "Mia Beispiel")
    created = post(mobile, "/entries/pending", {"qr": qr("SNWAIT1")})
    assert created.status_code == 201, created.text
    entry = created.json()
    assert entry["status"] == "freigabe" and entry["link_expires_at"]
    row = db.get(DeviceAssociation, entry["id"])
    assert row is not None and row.device_link_enc and "SNWAIT1" not in row.device_link_enc
    assert post(mobile, "/entries/pending", {"qr": qr("SNWAIT1")}).status_code == 409
    tasks = mobile.get("/api/tasks").json()["tasks"]
    assert any(task["title"] == "Geräte warten auf Freigabe" for task in tasks)

    # Ohne Admin-Konto geht die Freigabe nicht
    assert post(mobile, f"/entries/{entry['id']}/approve").status_code == 409
    pc = client_for([ROLE], "geraete-pc", "Ole Beispiel")
    connect_admin(pc, "admin2@example.com")
    approved = post(pc, f"/entries/{entry['id']}/approve").json()
    assert approved["ok"] is True
    done = approved["entry"]
    assert (done["status"], done["scanned_by"], done["approved_by"]) == (
        "vorab",
        "Mia Beispiel",
        "Ole Beispiel",
    )
    assert done["approved_admin"] == "admin2@example.com" and done["link_expires_at"] is None
    db.expire_all()
    row = db.get(DeviceAssociation, entry["id"])
    assert row is not None and row.device_link_enc is None
    assert post(pc, f"/entries/{entry['id']}/approve").status_code == 409
    assert pc.delete(f"{BASE}/entries/{entry['id']}", headers=HEADERS).status_code == 409


@pytest.mark.db
def test_discard_and_expiry_delete_device_data(db: Session) -> None:
    ina = client_for([ROLE], "geraete-ina")
    first = post(ina, "/entries/pending", {"qr": qr("SNWEG1")}).json()
    assert ina.delete(f"{BASE}/entries/{first['id']}", headers=HEADERS).json() == {"ok": True}
    assert db.get(DeviceAssociation, first["id"]) is None
    assert audit_actions(db, "SNWEG1") == ["geraet.zur_freigabe_gesendet", "geraet.verworfen"]

    second = post(ina, "/entries/pending", {"qr": qr("SNALT1")}).json()
    assert expire_pending(db, now_utc() + timedelta(hours=23)) == 0
    assert expire_pending(db, now_utc() + timedelta(hours=25)) == 1
    db.commit()
    assert db.get(DeviceAssociation, second["id"]) is None
    assert "geraet.verfallen" in audit_actions(db, "SNALT1")


class StatusGraph:
    """Antworten für die Statusprüfung (Stufe 1 und 2)."""

    def __init__(self, state: str, managed: ManagedDevice | None = None) -> None:
        self.state, self.managed = state, managed

    def get_device(self, device_id: str) -> AssociatedDevice:
        return AssociatedDevice(device_id, "SN", None, None, self.state, None, None, None)

    def managed_device(self, device_id: str) -> ManagedDevice | None:
        return self.managed

    def managed_by_serial(self, serial: str) -> ManagedDevice | None:
        return self.managed


@pytest.mark.db
def test_status_steps_unknown_states_and_stale(db: Session) -> None:
    ina = client_for([ROLE], "geraete-ina")
    connect_admin(ina)
    entry = post(ina, "/entries/import", {"qr": qr("SNSTATUS1")}).json()["entry"]
    row = db.get(DeviceAssociation, entry["id"])
    assert row is not None

    check_open(db, StatusGraph("associated"))  # type: ignore[arg-type]
    assert (row.status, row.association_state) == ("zugeordnet", "associated")
    check_open(db, StatusGraph("somethingNew"))  # type: ignore[arg-type]
    assert row.association_state == "somethingNew" and row.status == "zugeordnet"
    later = (now_utc() + timedelta(minutes=5)).isoformat()
    managed = ManagedDevice("md-1", "PC-0001", later, "compliant", "nutzer@example.com")
    check_open(db, StatusGraph("associated", managed))  # type: ignore[arg-type]
    assert (row.status, row.device_name, row.compliance) == ("registriert", "PC-0001", "compliant")
    db.commit()

    # Alte Registrierung desselben Geräts (vor der Freigabe) zählt nicht
    other = post(ina, "/entries/import", {"qr": qr("SNSTATUS2")}).json()["entry"]
    old_row = db.get(DeviceAssociation, other["id"])
    assert old_row is not None
    old = ManagedDevice("md-alt", "ALT", "2020-01-01T00:00:00Z", None, None)
    check_open(db, StatusGraph("preassociated", old))  # type: ignore[arg-type]
    assert old_row.status == "vorab"
    # Nach 7 Tagen ohne Rückmeldung
    check_open(db, None, now_utc() + timedelta(days=8))
    assert old_row.status == "nicht_abgeschlossen"
    db.commit()

    listed = ina.get(f"{BASE}/entries").json()
    assert listed["counts"]["registriert"] == 1 and listed["counts"]["nicht_abgeschlossen"] == 1
    only = ina.get(f"{BASE}/entries", params={"view": "nicht_abgeschlossen"}).json()["entries"]
    assert [e["serial_number"] for e in only] == ["SNSTATUS2"]
    found = ina.get(f"{BASE}/entries", params={"q": "pc-0001"}).json()["entries"]
    assert [e["serial_number"] for e in found] == ["SNSTATUS1"]


@pytest.mark.db
def test_refresh_uses_app_graph_or_admin(db: Session) -> None:
    ina = client_for([ROLE], "geraete-ina", app_graph=StatusGraph("associated"))
    connect_admin(ina)
    entry = post(ina, "/entries/import", {"qr": qr("SNREFRESH1")}).json()["entry"]
    refreshed = post(ina, f"/entries/{entry['id']}/refresh").json()
    assert refreshed["status"] == "zugeordnet"
    assert post(ina, "/refresh").json()["checked"] == 1

    # Ohne Hintergrundprüfung und ohne Admin-Konto: Hinweis statt Fehler
    plain = client_for([ROLE], "geraete-ohne")
    assert post(plain, f"/entries/{entry['id']}/refresh").status_code == 409


@pytest.mark.db
def test_admin_logout_removes_token(db: Session) -> None:
    ina = client_for([ROLE], "geraete-ina")
    connect_admin(ina)
    assert ina.get(f"{BASE}/admin").json()["upn"] == "admin@example.com"
    assert post(ina, "/admin/logout").json() == {
        "connected": False,
        "upn": None,
        "name": None,
        "expires_at": None,
    }
    assert db.scalars(select(DeviceAdminSession)).all() == []


def test_security_headers_allow_camera_and_wasm_only() -> None:
    client = TestClient(create_app(Settings(public_url=ORIGIN, environment="test")))
    response = client.get("/health")
    assert "camera=(self)" in response.headers["Permissions-Policy"]
    csp = response.headers["Content-Security-Policy"]
    assert "script-src 'self' 'wasm-unsafe-eval'" in csp
    assert "unsafe-eval'" not in csp.replace("'wasm-unsafe-eval'", "")
    assert SAMPLE["ver"] == "1.0"
