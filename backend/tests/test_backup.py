"""Datensicherung: Einstellungen, Zeitplan, Aufbewahrung, Sichern und Wiederherstellen."""

import json
import os
import shutil
import tempfile
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, make_url, select, text, update
from sqlalchemy.orm import Session

from werkbank.backup.__main__ import known_revisions
from werkbank.backup.jobs import JOB, backup_job
from werkbank.backup.service import (
    DB_FILE,
    FILES_FILE,
    INFO_FILE,
    KEEP_DEFAULT,
    SETTINGS_KEY,
    TRIGGER_COMMAND,
    TRIGGER_SCHEDULE,
    BackupConfig,
    BackupError,
    list_backups,
    load_config,
    prune,
    readiness,
    restore,
    run_backup,
    scheduled_due,
    verify,
)
from werkbank.config import Settings
from werkbank.core.app_settings import set_setting
from werkbank.core.deps import STEP_UP_HEADER
from werkbank.core.models import AuditLog, BackupRun, Job, UserSession
from werkbank.core.sessions import SESSION_COOKIE, hash_token, now_utc
from werkbank.main import create_app

ORIGIN = "https://testserver"
BASE = "/api/admin/backup"
KEY = "nur-fuer-tests-" + "k" * 40


def make_settings(root: Path, **extra: object) -> Settings:
    key = root / "backup_key"
    if not key.exists():
        key.write_text(KEY + "\n", encoding="utf-8")
    (root / "ziel").mkdir(exist_ok=True)
    (root / "dateien").mkdir(exist_ok=True)
    values: dict[str, object] = {
        "public_url": ORIGIN,
        "environment": "test",
        "enable_test_login": True,
        "backup_dir": root / "ziel",
        "backup_key_file": key,
        "budget_documents_dir": root / "dateien",
        "backup_pg_bin_dir": _pg_bin_dir() or root / "fehlt",
    }
    values.update(extra)
    return Settings(**values)  # type: ignore[arg-type]


def _server_major() -> int | None:
    url = os.environ.get("DATABASE_URL")
    if not url:
        return None
    engine = create_engine(url)
    try:
        with engine.connect() as conn:
            return int(str(conn.execute(text("SHOW server_version_num")).scalar_one())) // 10000
    except Exception:
        return None
    finally:
        engine.dispose()


def _pg_bin_dir() -> Path | None:
    """Werkzeuge in der Version des Servers (wie im Image); sonst werden Tests übersprungen."""
    major = _server_major()
    if major is None:
        return None
    path = Path(f"/usr/lib/postgresql/{major}/bin")
    return path if (path / "pg_dump").exists() else None


@pytest.fixture
def root() -> Iterator[Path]:
    path = Path(tempfile.mkdtemp())
    yield path
    shutil.rmtree(path, ignore_errors=True)


def fake_backup(folder: Path, name: str, size: int = 10) -> None:
    (folder / name).mkdir()
    info = {
        "format": 1,
        "created_at": "2026-11-01T02:00:00+00:00",
        "version": "0.1.0",
        "revision": "0001",
        "files": {DB_FILE: {"bytes": size, "sha256": "x"}, FILES_FILE: {"bytes": 0, "sha256": "y"}},
    }
    (folder / name / INFO_FILE).write_text(json.dumps(info), encoding="utf-8")


# --- ohne Datenbank -------------------------------------------------------------------


def test_list_and_prune_keep_newest(root: Path) -> None:
    settings = make_settings(root)
    folder = settings.backup_dir
    for day in range(1, 6):
        fake_backup(folder, f"werkbank-2026-11-0{day}-020000")
    (folder / "fremder-ordner").mkdir()
    (folder / "werkbank-2026-11-09-020000").mkdir()  # ohne info.json: unvollständig
    old_partial = folder / ".laufend-werkbank-2026-10-01-020000"
    old_partial.mkdir()
    os.utime(old_partial, (0, 0))
    names = [b.name for b in list_backups(settings)]
    assert names == [f"werkbank-2026-11-0{d}-020000" for d in (5, 4, 3, 2, 1)]
    removed = prune(settings, 3)
    assert removed == ["werkbank-2026-11-02-020000", "werkbank-2026-11-01-020000"]
    assert [b.name for b in list_backups(settings)][-1] == "werkbank-2026-11-03-020000"
    assert (folder / "fremder-ordner").exists()
    assert not old_partial.exists()


def test_readiness_reports_what_is_missing(root: Path) -> None:
    settings = make_settings(root, backup_dir=root / "gibt-es-nicht")
    state = readiness(settings)
    assert state.folder is False and state.ready is False
    (root / "backup_key").write_text("zu-kurz", encoding="utf-8")
    assert readiness(make_settings(root)).key is False


def test_restore_rejects_unknown_names(root: Path) -> None:
    settings = make_settings(root)
    with pytest.raises(BackupError):
        verify(settings, "../etc")
    with pytest.raises(BackupError):
        verify(settings, "werkbank-2026-11-01-020000")


# --- mit Datenbank --------------------------------------------------------------------


@pytest.fixture
def db(db_session: Session) -> Session:
    db_session.execute(delete(BackupRun))
    db_session.execute(delete(Job).where(Job.type == JOB))
    set_setting(db_session, SETTINGS_KEY, {}, None)
    db_session.commit()
    return db_session


@pytest.mark.db
def test_config_defaults_and_schedule(db: Session) -> None:
    assert load_config(db) == BackupConfig(enabled=False, hour=2, keep=KEEP_DEFAULT)
    set_setting(db, SETTINGS_KEY, {"enabled": True, "hour": 99, "keep": 0}, None)
    assert load_config(db) == BackupConfig(enabled=True, hour=2, keep=KEEP_DEFAULT)
    config = BackupConfig(enabled=True, hour=3, keep=5)
    # 01:30 Uhr Ortszeit (Winter: UTC+1) ist zu früh, 03:10 Uhr fällig
    early = datetime(2026, 11, 25, 0, 30, tzinfo=UTC)
    due = datetime(2026, 11, 25, 2, 10, tzinfo=UTC)
    assert not scheduled_due(db, config, early)
    assert scheduled_due(db, config, due)
    assert not scheduled_due(db, BackupConfig(enabled=False, hour=3, keep=5), due)
    # Ein geplanter Versuch je Tag, auch wenn er fehlschlug
    db.add(
        BackupRun(
            started_at=due,
            status="fehler",
            trigger=TRIGGER_SCHEDULE,
            name="werkbank-2026-11-25-031000",
        )
    )
    db.commit()
    assert not scheduled_due(db, config, due + timedelta(hours=2))
    assert scheduled_due(db, config, due + timedelta(days=1))


@pytest.mark.db
def test_failed_backup_is_recorded(db: Session, root: Path) -> None:
    settings = make_settings(root, backup_dir=root / "gibt-es-nicht")
    with pytest.raises(BackupError):
        run_backup(db, settings, trigger=TRIGGER_COMMAND)
    run = db.scalars(select(BackupRun)).one()
    assert run.status == "fehler"
    assert run.error is not None and "Zielordner" in run.error
    assert run.finished_at is not None
    # Im Auftrag: Der Auftrag schlägt fehl, damit die Admins benachrichtigt werden
    with pytest.raises(BackupError):
        backup_job(db, settings, {"manuell": True, "von": "Ada Admin"})


def client_for(settings: Settings, roles: list[str]) -> TestClient:
    client = TestClient(
        create_app(settings),
        base_url=ORIGIN,
        follow_redirects=False,
        headers={"Origin": ORIGIN},
    )
    response = client.post(
        "/auth/test-login", json={"oid": "ada", "name": "Ada Admin", "roles": roles}
    )
    assert response.status_code == 303, response.text
    return client


@pytest.mark.db
def test_admin_api(db: Session, root: Path) -> None:
    settings = make_settings(root)
    assert client_for(settings, ["Tools.User"]).get(BASE).status_code == 403
    admin = client_for(settings, ["Werkbank.Admin"])
    state = admin.get(BASE).json()
    assert state["enabled"] is False and state["keep"] == KEEP_DEFAULT
    assert state["readiness"]["key"] is True and state["readiness"]["folder"] is True
    saved = admin.put(BASE, json={"enabled": True, "hour": 4, "keep": 7})
    assert saved.status_code == 200
    assert (saved.json()["enabled"], saved.json()["hour"], saved.json()["keep"]) == (True, 4, 7)
    assert admin.put(BASE, json={"enabled": True, "hour": 24, "keep": 7}).status_code == 422
    assert admin.put(BASE, json={"enabled": True, "hour": 4, "keep": 0}).status_code == 422
    if readiness(settings).ready:
        started = admin.post(f"{BASE}/jetzt")
        assert started.status_code == 202
        assert started.json()["requested"] is True
        assert admin.post(f"{BASE}/jetzt").status_code == 409
        job = db.scalars(select(Job).where(Job.type == JOB)).one()
        assert job.payload == {"manuell": True, "von": "Ada Admin"}
    actions = set(db.scalars(select(AuditLog.action).where(AuditLog.module == "kern")))
    assert "sicherung.einstellungen_geaendert" in actions
    # Frische Anmeldung nötig
    token = admin.cookies.get(SESSION_COOKIE) or ""
    db.execute(
        update(UserSession)
        .where(UserSession.token_hash == hash_token(token))
        .values(authenticated_at=now_utc() - timedelta(minutes=16))
    )
    db.commit()
    stale = admin.put(BASE, json={"enabled": False, "hour": 4, "keep": 7})
    assert stale.status_code == 403 and stale.headers[STEP_UP_HEADER] == "required"


@pytest.mark.db
def test_start_needs_setup(db: Session, root: Path) -> None:
    settings = make_settings(root, backup_dir=root / "gibt-es-nicht")
    admin = client_for(settings, ["Werkbank.Admin"])
    assert admin.post(f"{BASE}/jetzt").status_code == 409


# --- echte Sicherung und Wiederherstellung (braucht pg_dump in Server-Version und gpg) ---

needs_tools = pytest.mark.skipif(
    _pg_bin_dir() is None or shutil.which("gpg") is None,
    reason="pg_dump in der Version des Servers oder gpg fehlt",
)


@pytest.fixture
def other_database() -> Iterator[str]:
    """Eigene, leere Datenbank als Ziel der Wiederherstellung."""
    url = make_url(os.environ["DATABASE_URL"])
    name = "werkbank_wiederherstellung_test"
    admin = create_engine(url, isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {name}"))
        conn.execute(text(f"CREATE DATABASE {name}"))
    target = url.set(database=name)
    yield target.render_as_string(hide_password=False)
    with admin.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)"))
    admin.dispose()


@pytest.mark.db
@needs_tools
def test_backup_and_restore_roundtrip(db: Session, root: Path, other_database: str) -> None:
    settings = make_settings(root, database_url=os.environ["DATABASE_URL"])
    files = settings.budget_documents_dir
    (files / "tickets").mkdir()
    (files / "tickets" / "anhang.pdf").write_bytes(b"%PDF-1.7 beispiel")
    (files / "beleg.pdf").write_bytes(b"%PDF-1.7 beleg")
    # Größer als ein Pipe-Puffer: Die Daten fließen gestreamt durch gpg und tar
    big = os.urandom(3 * 1024 * 1024)
    (files / "gross.bin").write_bytes(big)

    run = run_backup(db, settings, trigger=TRIGGER_COMMAND)
    assert run.status == "ok" and run.size_bytes and run.size_bytes > 0
    folder = settings.backup_dir / run.name
    assert sorted(p.name for p in folder.iterdir()) == [FILES_FILE, DB_FILE, INFO_FILE]
    # Verschlüsselt: weder Tabellennamen noch Dateiinhalte im Klartext
    assert b"alembic_version" not in (folder / DB_FILE).read_bytes()
    assert b"beleg" not in (folder / FILES_FILE).read_bytes()
    info = verify(settings, run.name)
    assert info["revision"] in known_revisions()

    # Zurückspielen in eine andere Datenbank und einen leeren Dateiordner mit Altlasten
    target_files = root / "ziel-dateien"
    target_files.mkdir()
    (target_files / "alt.pdf").write_bytes(b"weg damit")
    target = make_settings(root, database_url=other_database, budget_documents_dir=target_files)
    engine = create_engine(other_database)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE altlast (id int)"))
    restore(target, run.name, known_revisions())
    with engine.connect() as conn:
        revision = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
        tables = set(
            conn.execute(
                text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
            ).scalars()
        )
    engine.dispose()
    assert revision == info["revision"]
    assert "backup_runs" in tables and "altlast" not in tables
    assert (target_files / "beleg.pdf").read_bytes() == b"%PDF-1.7 beleg"
    assert (target_files / "tickets" / "anhang.pdf").exists()
    assert not (target_files / "alt.pdf").exists()
    assert (target_files / "gross.bin").read_bytes() == big


@pytest.mark.db
@needs_tools
def test_wrong_key_or_newer_backup_changes_nothing(
    db: Session, root: Path, other_database: str
) -> None:
    settings = make_settings(root, database_url=os.environ["DATABASE_URL"])
    run = run_backup(db, settings, trigger=TRIGGER_COMMAND)
    engine = create_engine(other_database)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE bleibt (id int)"))
    wrong = root / "falscher_key"
    wrong.write_text("falsch-" + "x" * 40, encoding="utf-8")
    target = make_settings(root, database_url=other_database, backup_key_file=wrong)
    with pytest.raises(BackupError, match="Entschlüsseln"):
        restore(target, run.name, known_revisions())
    target = make_settings(root, database_url=other_database)
    with pytest.raises(BackupError, match="neueren Werkbank"):
        restore(target, run.name, {"0001"})
    with engine.connect() as conn:
        assert conn.execute(text("SELECT to_regclass('public.bleibt')")).scalar() is not None
    engine.dispose()
