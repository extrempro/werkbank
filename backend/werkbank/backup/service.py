"""Datensicherung: Datenbank und Dateien verschlüsselt in einen Zielordner schreiben.

Eine Sicherung ist ein Ordner ``werkbank-JJJJ-MM-TT-HHMMSS`` im Zielordner mit drei Dateien:

- ``datenbank.dump.gpg``: ``pg_dump`` im Custom-Format, mit GnuPG verschlüsselt
- ``dateien.tar.gpg``: alle Dateien der Werkbank (Belege, Anhänge, Projektdokumente) als tar,
  ebenfalls verschlüsselt
- ``info.json``: Version, Datenbank-Revision, Größen und SHA-256 der beiden Dateien (nicht
  geheim, damit sich eine Sicherung auch ohne Schlüssel einordnen lässt)

Verschlüsselt wird symmetrisch mit OpenPGP (AES-256), die Passphrase ist das Docker-Secret
``backup_key``. Damit lässt sich eine Sicherung im Notfall auch ohne Werkbank auf jedem
Rechner mit ``gpg --decrypt`` öffnen. Der Ordner entsteht erst unter einem vorläufigen Namen
und wird nach dem letzten Schreiben umbenannt: Halbe Sicherungen tragen nie den endgültigen
Namen.
"""

import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import IO, Any
from zoneinfo import ZoneInfo

from sqlalchemy import make_url, select, text
from sqlalchemy.orm import Session

from werkbank import __version__
from werkbank.config import Settings
from werkbank.core.app_settings import get_setting
from werkbank.core.models import BackupRun
from werkbank.core.sessions import now_utc

logger = logging.getLogger(__name__)

SETTINGS_KEY = "kern.sicherung"
LOCAL_TZ = ZoneInfo("Europe/Berlin")

KEEP_MIN = 1
KEEP_MAX = 365
KEEP_DEFAULT = 14
HOUR_DEFAULT = 2
MIN_KEY_LENGTH = 32

DB_FILE = "datenbank.dump.gpg"
FILES_FILE = "dateien.tar.gpg"
INFO_FILE = "info.json"
NAME_PATTERN = re.compile(r"^werkbank-\d{4}-\d{2}-\d{2}-\d{6}$")
PARTIAL_PREFIX = ".laufend-"
# Im tar liegen alle Dateien unter diesem Ordner
FILES_ARCNAME = "dateien"
ERROR_MAX_LENGTH = 2000
STDERR_MAX = 4000
CHUNK = 1024 * 1024

STATUS_RUNNING = "laeuft"
STATUS_OK = "ok"
STATUS_FAILED = "fehler"
TRIGGER_SCHEDULE = "zeitplan"
TRIGGER_MANUAL = "verwaltung"
TRIGGER_COMMAND = "kommando"


class BackupError(Exception):
    """Sicherung oder Wiederherstellung ist fehlgeschlagen; Text für Menschen."""


@dataclass(frozen=True)
class BackupConfig:
    enabled: bool
    hour: int
    keep: int


@dataclass(frozen=True)
class Readiness:
    """Was für eine Sicherung bereitsteht (Anzeige in der Verwaltung)."""

    key: bool
    folder: bool
    tools: bool

    @property
    def ready(self) -> bool:
        return self.key and self.folder and self.tools


@dataclass(frozen=True)
class BackupInfo:
    """Eine vorhandene Sicherung im Zielordner."""

    name: str
    created_at: datetime
    version: str
    revision: str
    size_bytes: int


def load_config(db: Session) -> BackupConfig:
    raw = get_setting(db, SETTINGS_KEY, {})
    data: dict[str, Any] = raw if isinstance(raw, dict) else {}
    hour = data.get("hour")
    keep = data.get("keep")
    return BackupConfig(
        enabled=data.get("enabled") is True,
        hour=hour if isinstance(hour, int) and 0 <= hour <= 23 else HOUR_DEFAULT,
        keep=keep if isinstance(keep, int) and KEEP_MIN <= keep <= KEEP_MAX else KEEP_DEFAULT,
    )


def files_dir(settings: Settings) -> Path:
    """Wurzel aller Dateien der Werkbank (Belege, Ticket-Anhänge, Projektdokumente)."""
    return settings.budget_documents_dir


def _tool(settings: Settings, name: str) -> Path:
    return settings.backup_pg_bin_dir / name


def key_available(settings: Settings) -> bool:
    try:
        material = settings.backup_key_file.read_text(encoding="utf-8").strip()
    except OSError:
        return False
    return len(material) >= MIN_KEY_LENGTH and "\n" not in material


def folder_writable(settings: Settings) -> bool:
    folder = settings.backup_dir
    return folder.is_dir() and os.access(folder, os.W_OK | os.X_OK)


def tools_available(settings: Settings) -> bool:
    needed = [_tool(settings, n) for n in ("pg_dump", "pg_restore", "psql")]
    return all(os.access(p, os.X_OK) for p in needed) and shutil.which("gpg") is not None


def readiness(settings: Settings) -> Readiness:
    return Readiness(
        key=key_available(settings),
        folder=folder_writable(settings),
        tools=tools_available(settings),
    )


# --- Hilfen für Prozesse ---------------------------------------------------------------


@contextmanager
def _gnupg_home() -> Iterator[str]:
    """Eigenes, leeres GnuPG-Verzeichnis je Lauf (das Image ist schreibgeschützt)."""
    # mkdtemp legt das Verzeichnis nur für den eigenen Benutzer an (0700), wie gpg es verlangt
    home = tempfile.mkdtemp(prefix="werkbank-gpg-")
    try:
        yield home
    finally:
        shutil.rmtree(home, ignore_errors=True)


def _gpg_encrypt(settings: Settings, home: str, target: Path) -> list[str]:
    return [
        "gpg",
        "--homedir",
        home,
        "--batch",
        "--yes",
        "--quiet",
        "--no-tty",
        "--pinentry-mode",
        "loopback",
        "--passphrase-file",
        str(settings.backup_key_file),
        "--symmetric",
        "--cipher-algo",
        "AES256",
        "--s2k-mode",
        "3",
        "--s2k-digest-algo",
        "SHA512",
        "--s2k-count",
        "65011712",
        "--output",
        str(target),
    ]


def _gpg_decrypt(settings: Settings, home: str, source: Path) -> list[str]:
    return [
        "gpg",
        "--homedir",
        home,
        "--batch",
        "--quiet",
        "--no-tty",
        "--pinentry-mode",
        "loopback",
        "--passphrase-file",
        str(settings.backup_key_file),
        "--decrypt",
        str(source),
    ]


def _pg_env(settings: Settings) -> dict[str, str]:
    """Umgebung für die PostgreSQL-Werkzeuge aus derselben Verbindung wie die Werkbank.

    Das Passwort steht nur in der Umgebung des Prozesses, nie in der Befehlszeile.
    """
    url = make_url(settings.sqlalchemy_url())
    env = {k: v for k, v in os.environ.items() if not k.startswith("PG")}
    values = {
        "PGHOST": url.host or str(url.query.get("host", "")),
        "PGPORT": str(url.port or url.query.get("port", "") or ""),
        "PGUSER": url.username or "",
        "PGPASSWORD": url.password or "",
        "PGDATABASE": url.database or "",
        "PGCONNECT_TIMEOUT": "10",
    }
    env.update({k: v for k, v in values.items() if v})
    return env


def _read_stderr(stream: IO[bytes] | None) -> str:
    if stream is None:
        return ""
    return stream.read()[-STDERR_MAX:].decode("utf-8", errors="replace").strip()


def _check(process: subprocess.Popen[bytes], what: str, stderr: str) -> None:
    if process.returncode != 0:
        detail = f": {stderr}" if stderr else ""
        raise BackupError(f"{what} ist fehlgeschlagen (Code {process.returncode}){detail}")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


# --- Sichern -------------------------------------------------------------------------


def _dump_database(settings: Settings, home: str, target: Path) -> None:
    dump = subprocess.Popen(  # noqa: S603 (feste Werkzeuge, Liste ohne Shell)
        [
            str(_tool(settings, "pg_dump")),
            "--format=custom",
            "--no-owner",
            "--no-privileges",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=_pg_env(settings),
    )
    gpg = subprocess.Popen(  # noqa: S603 (feste Werkzeuge, Liste ohne Shell)
        _gpg_encrypt(settings, home, target), stdin=dump.stdout, stderr=subprocess.PIPE
    )
    if dump.stdout is not None:
        dump.stdout.close()
    gpg.wait()
    dump.wait()
    _check(dump, "pg_dump", _read_stderr(dump.stderr))
    _check(gpg, "Verschlüsseln der Datenbank", _read_stderr(gpg.stderr))


def _archive_files(settings: Settings, home: str, target: Path) -> None:
    source = files_dir(settings)
    gpg = subprocess.Popen(  # noqa: S603 (feste Werkzeuge, Liste ohne Shell)
        _gpg_encrypt(settings, home, target), stdin=subprocess.PIPE, stderr=subprocess.PIPE
    )
    if gpg.stdin is None:
        raise BackupError("gpg ließ sich nicht starten.")
    try:
        with tarfile.open(fileobj=gpg.stdin, mode="w|") as archive:
            if source.is_dir():
                archive.add(source, arcname=FILES_ARCNAME)
    finally:
        gpg.stdin.close()
        gpg.wait()
    _check(gpg, "Verschlüsseln der Dateien", _read_stderr(gpg.stderr))


def _db_revision(db: Session) -> str:
    return str(db.execute(text("SELECT version_num FROM alembic_version")).scalar_one())


def backup_name(moment: datetime) -> str:
    return "werkbank-" + moment.astimezone(LOCAL_TZ).strftime("%Y-%m-%d-%H%M%S")


def run_backup(
    db: Session, settings: Settings, *, trigger: str, started_by: str | None = None
) -> BackupRun:
    """Erstellt eine Sicherung und räumt danach alte auf. Fehler: BackupError (Lauf mit Fehler)."""
    started = now_utc()
    run = BackupRun(
        started_at=started,
        status=STATUS_RUNNING,
        trigger=trigger,
        started_by=started_by,
        name=backup_name(started),
    )
    db.add(run)
    db.commit()
    partial = settings.backup_dir / (PARTIAL_PREFIX + run.name)
    try:
        state = readiness(settings)
        if not state.key:
            raise BackupError("Der Schlüssel backup_key fehlt oder ist zu kurz.")
        if not state.folder:
            raise BackupError("Der Zielordner fehlt oder ist nicht beschreibbar.")
        if not state.tools:
            raise BackupError("pg_dump, psql oder gpg fehlen im Image.")
        final = settings.backup_dir / run.name
        if final.exists():
            raise BackupError("Eine Sicherung mit diesem Namen gibt es schon.")
        partial.mkdir(mode=0o700)
        with _gnupg_home() as home:
            _dump_database(settings, home, partial / DB_FILE)
            _archive_files(settings, home, partial / FILES_FILE)
        files: dict[str, dict[str, Any]] = {
            name: {"bytes": (partial / name).stat().st_size, "sha256": _sha256(partial / name)}
            for name in (DB_FILE, FILES_FILE)
        }
        info: dict[str, Any] = {
            "format": 1,
            "created_at": started.isoformat(),
            "version": __version__,
            "revision": _db_revision(db),
            "files": files,
        }
        (partial / INFO_FILE).write_text(json.dumps(info, indent=2), encoding="utf-8")
        partial.rename(final)
        run.size_bytes = sum(int(f["bytes"]) for f in files.values())
        run.status = STATUS_OK
    except Exception as exc:
        shutil.rmtree(partial, ignore_errors=True)
        db.rollback()
        failed = db.get(BackupRun, run.id)
        message = str(exc) if isinstance(exc, BackupError) else type(exc).__name__
        if failed is not None:
            failed.status = STATUS_FAILED
            failed.error = message[:ERROR_MAX_LENGTH]
            failed.finished_at = now_utc()
            db.commit()
        logger.error("Datensicherung %s ist fehlgeschlagen (%s)", run.id, type(exc).__name__)
        raise BackupError(message) from exc
    run.finished_at = now_utc()
    db.commit()
    prune(settings, load_config(db).keep)
    return run


def prune(settings: Settings, keep: int) -> list[str]:
    """Behält die neuesten ``keep`` Sicherungen; entfernt ältere und liegengebliebene Reste."""
    removed: list[str] = []
    folder = settings.backup_dir
    if not folder.is_dir():
        return removed
    for backup in list_backups(settings)[keep:]:
        shutil.rmtree(folder / backup.name, ignore_errors=True)
        removed.append(backup.name)
    limit = (now_utc() - timedelta(days=1)).timestamp()
    for entry in folder.iterdir():
        if entry.name.startswith(PARTIAL_PREFIX) and entry.stat().st_mtime < limit:
            shutil.rmtree(entry, ignore_errors=True)
    return removed


def _read_info(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads((path / INFO_FILE).read_text(encoding="utf-8"))
    except OSError, ValueError:
        return None
    return data if isinstance(data, dict) else None


def list_backups(settings: Settings) -> list[BackupInfo]:
    """Vollständige Sicherungen im Zielordner, neueste zuerst."""
    folder = settings.backup_dir
    if not folder.is_dir():
        return []
    found: list[BackupInfo] = []
    for entry in folder.iterdir():
        if not entry.is_dir() or not NAME_PATTERN.match(entry.name):
            continue
        info = _read_info(entry)
        if info is None:
            continue
        try:
            created = datetime.fromisoformat(str(info["created_at"]))
            size = sum(int(f["bytes"]) for f in info["files"].values())
        except KeyError, TypeError, ValueError, AttributeError:
            continue
        found.append(
            BackupInfo(
                name=entry.name,
                created_at=created,
                version=str(info.get("version", "")),
                revision=str(info.get("revision", "")),
                size_bytes=size,
            )
        )
    return sorted(found, key=lambda b: b.name, reverse=True)


def scheduled_due(db: Session, config: BackupConfig, moment: datetime) -> bool:
    """Ist heute (Ortszeit) ab der eingestellten Stunde noch keine geplante Sicherung gelaufen?

    Pro Tag gibt es höchstens einen geplanten Versuch, auch wenn er fehlschlägt: Ein Fehler
    meldet sich als Benachrichtigung und wird nicht im Minutentakt wiederholt.
    """
    if not config.enabled:
        return False
    local = moment.astimezone(LOCAL_TZ)
    if local.hour < config.hour:
        return False
    day_start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    last = db.scalar(
        select(BackupRun.id)
        .where(BackupRun.trigger == TRIGGER_SCHEDULE, BackupRun.started_at >= day_start)
        .limit(1)
    )
    return last is None


# --- Prüfen und Wiederherstellen (nur über das Kommando) -------------------------------


def backup_path(settings: Settings, name: str) -> Path:
    if not NAME_PATTERN.match(name):
        raise BackupError("Unbekannter Name. Namen zeigt „python -m werkbank.backup liste“.")
    path = settings.backup_dir / name
    if _read_info(path) is None:
        raise BackupError(f"Die Sicherung {name} gibt es nicht oder sie ist unvollständig.")
    return path


def verify(settings: Settings, name: str) -> dict[str, Any]:
    """Prüfsummen vergleichen und beide Dateien probeweise entschlüsseln."""
    path = backup_path(settings, name)
    info = _read_info(path) or {}
    for file_name, meta in info.get("files", {}).items():
        if _sha256(path / file_name) != meta.get("sha256"):
            raise BackupError(f"Die Prüfsumme von {file_name} stimmt nicht.")
    if not key_available(settings):
        raise BackupError("Der Schlüssel backup_key fehlt oder ist zu kurz.")
    with _gnupg_home() as home:
        listing = subprocess.Popen(  # noqa: S603 (feste Werkzeuge, Liste ohne Shell)
            # Ganzes Archiv als SQL ausgeben und verwerfen: liest jeden Datenblock einmal
            # (--list läse nur das Inhaltsverzeichnis)
            [str(_tool(settings, "pg_restore")), "--file=-"],
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        _decrypt_into(settings, home, path / DB_FILE, listing.stdin)
        listing.wait()
        _check(listing, "Lesen der Datenbanksicherung", _read_stderr(listing.stderr))
        with (
            _decrypted(settings, home, path / FILES_FILE) as stream,
            tarfile.open(fileobj=stream, mode="r|") as archive,
        ):
            for _member in archive:
                pass
    return info


def _decrypt_into(settings: Settings, home: str, source: Path, sink: IO[bytes] | None) -> None:
    """Entschlüsselt in einen offenen Datenstrom und schließt ihn danach."""
    if sink is None:
        raise BackupError("Interner Fehler: kein Ziel zum Entschlüsseln.")
    gpg = subprocess.Popen(  # noqa: S603 (feste Werkzeuge, Liste ohne Shell)
        _gpg_decrypt(settings, home, source), stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    if gpg.stdout is None:
        raise BackupError("gpg ließ sich nicht starten.")
    consumer_stopped = False
    try:
        while chunk := gpg.stdout.read(CHUNK):
            sink.write(chunk)
    except BrokenPipeError:
        # Der Empfänger hat aufgehört zu lesen; seinen Fehler meldet der Aufrufer
        consumer_stopped = True
        gpg.kill()
    finally:
        try:
            sink.close()
        except BrokenPipeError:
            consumer_stopped = True
        gpg.wait()
    if not consumer_stopped:
        _check(gpg, "Entschlüsseln (falscher Schlüssel?)", _read_stderr(gpg.stderr))


@contextmanager
def _decrypted(settings: Settings, home: str, source: Path) -> Iterator[IO[bytes]]:
    gpg = subprocess.Popen(  # noqa: S603 (feste Werkzeuge, Liste ohne Shell)
        _gpg_decrypt(settings, home, source), stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    if gpg.stdout is None:
        raise BackupError("gpg ließ sich nicht starten.")
    try:
        yield gpg.stdout
        gpg.stdout.read()
    finally:
        gpg.stdout.close()
        gpg.wait()
    _check(gpg, "Entschlüsseln (falscher Schlüssel?)", _read_stderr(gpg.stderr))


def restore_database(settings: Settings, home: str, path: Path) -> None:
    """Ersetzt die ganze Datenbank in einer Transaktion: Schlägt etwas fehl, bleibt alles alt."""
    env = _pg_env(settings)
    psql = subprocess.Popen(  # noqa: S603 (feste Werkzeuge, Liste ohne Shell)
        [
            str(_tool(settings, "psql")),
            "--quiet",
            "--no-psqlrc",
            "--set=ON_ERROR_STOP=1",
            "--single-transaction",
            "--file=-",
        ],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        env=env,
    )
    if psql.stdin is None:
        raise BackupError("psql ließ sich nicht starten.")
    psql.stdin.write(b"DROP SCHEMA public CASCADE;\nCREATE SCHEMA public;\n")
    psql.stdin.flush()
    restore = subprocess.Popen(  # noqa: S603 (feste Werkzeuge, Liste ohne Shell)
        [str(_tool(settings, "pg_restore")), "--no-owner", "--no-privileges", "--file=-"],
        stdin=subprocess.PIPE,
        stdout=psql.stdin,
        stderr=subprocess.PIPE,
    )
    psql.stdin.close()
    _decrypt_into(settings, home, path / DB_FILE, restore.stdin)
    restore.wait()
    psql.wait()
    _check(restore, "pg_restore", _read_stderr(restore.stderr))
    _check(psql, "Einspielen der Datenbank", _read_stderr(psql.stderr))


def restore_files(settings: Settings, home: str, path: Path) -> None:
    """Spielt die Dateien zurück: erst vollständig auspacken, dann den alten Stand ersetzen."""
    target = files_dir(settings)
    target.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".wiederherstellung-", dir=target))
    try:
        with (
            _decrypted(settings, home, path / FILES_FILE) as stream,
            tarfile.open(fileobj=stream, mode="r|") as archive,
        ):
            archive.extractall(staging, filter="data")
        restored = staging / FILES_ARCNAME
        for entry in target.iterdir():
            if entry != staging:
                if entry.is_dir() and not entry.is_symlink():
                    shutil.rmtree(entry)
                else:
                    entry.unlink()
        if restored.is_dir():
            for entry in restored.iterdir():
                entry.rename(target / entry.name)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def restore(settings: Settings, name: str, known_revisions: set[str]) -> dict[str, Any]:
    """Prüft die Sicherung und spielt Datenbank und Dateien zurück."""
    path = backup_path(settings, name)
    info = verify(settings, name)
    revision = str(info.get("revision", ""))
    if revision not in known_revisions:
        raise BackupError(
            f"Die Sicherung stammt von einer neueren Werkbank (Revision {revision}). "
            "Erst das Image auf mindestens Version "
            f"{info.get('version', '?')} bringen, dann wiederherstellen."
        )
    with _gnupg_home() as home:
        restore_database(settings, home, path)
        restore_files(settings, home, path)
    return info
