import csv
import io
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.audit import write_audit
from werkbank.core.audit_api import safe_cell
from werkbank.core.models import AuditLog
from werkbank.main import create_app

ORIGIN = "https://testserver"


def make_app() -> FastAPI:
    settings = Settings(public_url=ORIGIN, environment="test", enable_test_login=True)
    return create_app(settings)


def login(roles: list[str], oid: str, name: str = "Ada Admin") -> TestClient:
    client = TestClient(make_app(), base_url=ORIGIN, follow_redirects=False)
    response = client.post(
        "/auth/test-login",
        json={"oid": oid, "name": name, "roles": roles},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 303
    return client


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("=SUMME(A1)", "'=SUMME(A1)"),
        ("+49", "'+49"),
        ("-1", "'-1"),
        ("@cmd", "'@cmd"),
        ("normal", "normal"),
        (None, ""),
        (5, "5"),
    ],
)
def test_safe_cell(value: object, expected: str) -> None:
    assert safe_cell(value) == expected


def test_audit_requires_login() -> None:
    client = TestClient(make_app(), base_url=ORIGIN)
    assert client.get("/api/audit").status_code == 401


@pytest.mark.db
def test_audit_forbidden_for_other_roles(migrated_db: None) -> None:
    client = login(["Config.Reader"], "audit-leser")
    assert client.get("/api/audit").status_code == 403
    assert client.get("/api/audit/export.csv").status_code == 403
    assert client.get("/api/admin/permissions").status_code == 403


@pytest.mark.db
def test_audit_list_and_filter(migrated_db: None, db_session: Session) -> None:
    write_audit(db_session, module="evergreen", action="vorgang.test", note="x")
    db_session.commit()
    client = login(["Werkbank.Admin"], "audit-auditor", "Ada Admin")

    everything = client.get("/api/audit").json()
    actions = [entry["action"] for entry in everything["entries"]]
    assert "anmeldung.erfolgreich" in actions
    assert "vorgang.test" in actions

    filtered = client.get("/api/audit", params={"module": "evergreen"}).json()
    assert {entry["module"] for entry in filtered["entries"]} == {"evergreen"}

    future = client.get("/api/audit", params={"since": "2999-01-01"}).json()
    assert future["entries"] == []

    page = client.get("/api/audit", params={"limit": 1}).json()
    assert len(page["entries"]) == 1
    assert page["has_more"] is True


@pytest.mark.db
def test_audit_export_is_csv_and_logged(migrated_db: None, db_session: Session) -> None:
    write_audit(db_session, module="kern", action="=gefaehrlich")
    db_session.commit()
    client = login(["Werkbank.Admin"], "audit-export")
    response = client.get("/api/audit/export.csv", params={"until": date.today().isoformat()})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(response.text.lstrip("﻿")), delimiter=";"))
    assert rows[0][0] == "Zeitpunkt (UTC)"
    assert any(row[3] == "'=gefaehrlich" for row in rows[1:])
    exports = db_session.scalars(select(AuditLog).where(AuditLog.action == "audit.export")).all()
    assert exports


@pytest.mark.db
def test_audit_shows_truncated_origin(migrated_db: None, db_session: Session) -> None:
    write_audit(db_session, module="kern", action="test.herkunft", ip="203.0.113.77")
    db_session.commit()
    client = login(["Werkbank.Admin"], "audit-herkunft")
    entries = client.get("/api/audit", params={"action": "test.herkunft"}).json()["entries"]
    assert entries[0]["origin"] == "203.0.113.0/24"
    export = client.get("/api/audit/export.csv", params={"action": "test.herkunft"})
    rows = list(csv.reader(io.StringIO(export.text.lstrip("\ufeff")), delimiter=";"))
    assert rows[0][-1] == "Herkunft (gekürzte IP)"
    assert rows[1][-1] == "203.0.113.0/24"
