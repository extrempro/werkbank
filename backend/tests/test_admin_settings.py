"""Verwaltung, Bereich Allgemein: SMTP, Aufbewahrungsfrist, Bereinigung des Audit-Logs."""

from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from tests.test_auth import ORIGIN, client_for, login_as, make_app, make_settings
from werkbank.config import Settings
from werkbank.core.app_settings import (
    AUDIT_RETENTION_KEY,
    SMTP_KEY,
    decrypt_secret,
    encrypt_secret,
    secret_key_available,
)
from werkbank.core.mail import MailError, SmtpConfig, build_message, get_mail_sender
from werkbank.core.models import AppSetting, AuditLog
from werkbank.core.sessions import now_utc
from werkbank.worker.tasks import purge_audit_log

BASE = "/api/admin/settings"
SECRET = "geheim"  # noqa: S105  (Testwert)
HEADERS = {"Origin": ORIGIN}
SMTP = {
    "host": "smtp.example.com",
    "port": 587,
    "security": "starttls",
    "username": "werkbank@example.com",
    "sender_address": "werkbank@example.com",
    "sender_name": "Werkbank",
}


def settings_with_key(tmp_path: Path, **overrides: Any) -> Settings:
    key = tmp_path / "settings_key"
    key.write_text("ein-langer-zufaelliger-schluessel-fuer-tests-0123456789\n", encoding="utf-8")
    return make_settings(settings_key_file=key, **overrides)


def admin(settings: Settings, sent: list[tuple[SmtpConfig, str, str]] | None = None) -> TestClient:
    app = make_app(settings)
    if sent is not None:

        def sender(config: SmtpConfig, recipient: str, subject: str, body: str) -> None:
            if config.host == "kaputt.example.com":
                raise MailError("Der Server ist nicht erreichbar oder hat abgelehnt (OSError).")
            sent.append((config, recipient, subject))

        app.dependency_overrides[get_mail_sender] = lambda: sender
    client = client_for(app)
    login_as(client, ["Werkbank.Admin"], oid="einstellungen-admin")
    return client


@pytest.fixture
def clean(migrated_db: None, db_session: Session) -> Session:
    db_session.execute(delete(AppSetting))
    db_session.commit()
    return db_session


def test_encryption_roundtrip_and_missing_key(tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    token = encrypt_secret(settings, "geheim")
    assert "geheim" not in token
    assert decrypt_secret(settings, token) == "geheim"
    # anderer Schlüssel oder fehlende Datei: nicht lesbar, kein Absturz
    other = tmp_path / "anderer"
    other.write_text("ein-ganz-anderer-schluessel-mit-genug-zeichen-987654321", encoding="utf-8")
    assert decrypt_secret(make_settings(settings_key_file=other), token) is None
    missing = make_settings(settings_key_file=tmp_path / "fehlt")
    assert decrypt_secret(missing, token) is None
    assert secret_key_available(settings) and not secret_key_available(missing)
    short = tmp_path / "kurz"
    short.write_text("zu kurz", encoding="utf-8")
    assert not secret_key_available(make_settings(settings_key_file=short))


def test_message_headers_cannot_be_injected() -> None:
    config = SmtpConfig(
        "smtp.example.com", 587, "starttls", None, None, "wb@example.com", "Werkbank"
    )
    message = build_message(config, "erika@example.com", "Test", "Text")
    assert message["From"] == "Werkbank <wb@example.com>"
    with pytest.raises(ValueError):
        build_message(config, "erika@example.com", "Test\nBcc: boese@example.com", "Text")


@pytest.mark.db
def test_settings_need_admin_and_recent_login(clean: Session, tmp_path: Path) -> None:
    anonymous = client_for(make_app())
    assert anonymous.get(BASE).status_code == 401
    reader = client_for(make_app())
    login_as(reader, ["Config.Reviewer"], oid="einstellungen-leser")
    assert reader.get(BASE).status_code == 403
    assert reader.put(f"{BASE}/smtp", json=SMTP, headers=HEADERS).status_code == 403
    assert reader.post(f"{BASE}/smtp/test", headers=HEADERS).status_code == 403

    stale = admin(settings_with_key(tmp_path, step_up_minutes=0))
    response = stale.get(BASE)
    assert response.status_code == 403
    assert response.headers["x-werkbank-step-up"] == "required"


@pytest.mark.db
def test_smtp_is_saved_with_encrypted_password(clean: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    client = admin(settings)
    initial = client.get(BASE).json()
    assert initial["smtp"]["host"] == "" and initial["smtp"]["password_set"] is False
    assert initial["smtp"]["password_storage_available"] is True
    assert initial["audit_retention_days"] == 90

    saved = client.put(f"{BASE}/smtp", json={**SMTP, "password": "s3hr-geheim"}, headers=HEADERS)
    assert saved.status_code == 200, saved.text
    assert saved.json()["smtp"]["password_set"] is True
    assert "s3hr-geheim" not in saved.text
    assert "password_encrypted" not in saved.text

    stored = clean.get(AppSetting, SMTP_KEY)
    assert stored is not None
    assert "s3hr-geheim" not in str(stored.value)
    assert decrypt_secret(settings, stored.value["password_encrypted"]) == "s3hr-geheim"

    # Ohne Angabe bleibt das Passwort, ein leerer Text löscht es.
    kept = client.put(f"{BASE}/smtp", json={**SMTP, "port": 2525}, headers=HEADERS).json()
    assert kept["smtp"]["password_set"] is True and kept["smtp"]["port"] == 2525
    cleared = client.put(f"{BASE}/smtp", json={**SMTP, "password": ""}, headers=HEADERS).json()
    assert cleared["smtp"]["password_set"] is False

    audit = clean.scalars(
        select(AuditLog).where(AuditLog.action == "einstellungen.smtp_geaendert")
    ).all()
    assert audit and all("s3hr-geheim" not in str(entry.details) for entry in audit)


@pytest.mark.db
def test_smtp_validation(clean: Session, tmp_path: Path) -> None:
    client = admin(settings_with_key(tmp_path))

    def put(**changes: Any) -> int:
        return client.put(f"{BASE}/smtp", json={**SMTP, **changes}, headers=HEADERS).status_code

    assert put(host="https://smtp.example.com/pfad") == 422
    assert put(host="smtp.example.com\r\nX: y") == 422
    assert put(port=0) == 422
    assert put(security="irgendwas") == 422
    assert put(sender_address="keine-adresse") == 422
    assert put(sender_address="a@example.com\nBcc: b@example.com") == 422
    assert put(sender_name="Name\nBcc: b@example.com") == 422
    # Passwort nur über eine verschlüsselte Verbindung und nur mit Benutzername
    assert put(security="none", password=SECRET) == 422
    assert put(username="", password=SECRET) == 422
    assert put(security="none", username="") == 200

    without_key = admin(make_settings(settings_key_file=tmp_path / "fehlt"))
    assert without_key.get(BASE).json()["smtp"]["password_storage_available"] is False
    response = without_key.put(f"{BASE}/smtp", json={**SMTP, "password": "x"}, headers=HEADERS)
    assert response.status_code == 409
    assert "settings_key" in response.json()["detail"]


@pytest.mark.db
def test_test_mail_goes_to_own_address(clean: Session, tmp_path: Path) -> None:
    sent: list[tuple[SmtpConfig, str, str]] = []
    client = admin(settings_with_key(tmp_path), sent)
    missing = client.post(f"{BASE}/smtp/test", headers=HEADERS)
    assert missing.status_code == 502 and "noch kein SMTP-Server" in missing.json()["detail"]

    client.put(f"{BASE}/smtp", json={**SMTP, "password": SECRET}, headers=HEADERS)
    ok = client.post(f"{BASE}/smtp/test", headers=HEADERS)
    assert ok.status_code == 200 and ok.json() == {"recipient": "erika@example.com"}
    config, recipient, subject = sent[0]
    assert recipient == "erika@example.com" and subject == "Testmail der Werkbank"
    assert config.password == SECRET and config.username == "werkbank@example.com"

    client.put(f"{BASE}/smtp", json={**SMTP, "host": "kaputt.example.com"}, headers=HEADERS)
    failed = client.post(f"{BASE}/smtp/test", headers=HEADERS)
    assert failed.status_code == 502 and "nicht erreichbar" in failed.json()["detail"]
    results = clean.scalars(
        select(AuditLog.result).where(AuditLog.action == "einstellungen.smtp_test")
    ).all()
    assert "ok" in results and "fehler" in results


@pytest.mark.db
def test_audit_retention_setting(clean: Session, tmp_path: Path) -> None:
    client = admin(settings_with_key(tmp_path))
    assert (
        client.put(f"{BASE}/audit-retention", json={"days": 29}, headers=HEADERS).status_code == 422
    )
    assert (
        client.put(f"{BASE}/audit-retention", json={"days": 4000}, headers=HEADERS).status_code
        == 422
    )
    saved = client.put(f"{BASE}/audit-retention", json={"days": 180}, headers=HEADERS)
    assert saved.status_code == 200 and saved.json()["audit_retention_days"] == 180
    stored = clean.get(AppSetting, AUDIT_RETENTION_KEY)
    assert stored is not None and stored.value == 180


@pytest.mark.db
def test_audit_purge_removes_only_entries_past_retention(clean: Session) -> None:
    def add(action: str, days_old: int) -> None:
        clean.add(
            AuditLog(
                module="test",
                action=action,
                result="ok",
                occurred_at=now_utc() - timedelta(days=days_old),
            )
        )

    add("bereinigung.alt", 91)
    add("bereinigung.grenze", 89)
    add("bereinigung.neu", 1)
    clean.commit()

    assert purge_audit_log(clean) >= 1
    clean.commit()
    left = clean.scalars(select(AuditLog.action).where(AuditLog.action.like("bereinigung.%"))).all()
    assert sorted(left) == ["bereinigung.grenze", "bereinigung.neu"]
    assert clean.scalars(select(AuditLog).where(AuditLog.action == "audit.bereinigt")).first()

    # Ohne Ankündigung bleibt das Audit-Log nur anhängend, auch für alte Einträge.
    add("bereinigung.alt", 200)
    clean.commit()
    with pytest.raises(DBAPIError):
        clean.execute(delete(AuditLog).where(AuditLog.action == "bereinigung.alt"))
    clean.rollback()
    # Selbst mit Ankündigung ist nichts löschbar, was jünger als 30 Tage ist.
    clean.execute(text("select set_config('werkbank.audit_purge', 'on', true)"))
    with pytest.raises(DBAPIError):
        clean.execute(delete(AuditLog).where(AuditLog.action == "bereinigung.neu"))
    clean.rollback()
