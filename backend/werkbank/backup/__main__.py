"""Datensicherung per Kommando im Container: python -m werkbank.backup <befehl>.

Befehle:
  liste                         vorhandene Sicherungen
  sichern                       jetzt eine Sicherung erstellen
  pruefen NAME                  Prüfsummen vergleichen und probeweise entschlüsseln
  wiederherstellen NAME [--ja]  Datenbank und Dateien aus der Sicherung zurückspielen

Zum Wiederherstellen vorher web und worker anhalten (Anleitung in deploy/README.md).
"""

import argparse
import logging
import sys
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory

from werkbank.backup.service import (
    TRIGGER_COMMAND,
    BackupError,
    list_backups,
    restore,
    run_backup,
    verify,
)
from werkbank.config import Settings, get_settings
from werkbank.core.audit import write_audit
from werkbank.db import get_sessionmaker

# Im Image liegen alembic.ini und migrations in /app (Arbeitsverzeichnis), im Repository
# neben dem Paket.
ALEMBIC_CANDIDATES = (Path.cwd(), Path(__file__).resolve().parents[2])


def known_revisions() -> set[str]:
    """Alle Datenbank-Revisionen, die diese Version der Werkbank kennt."""
    base = next((p for p in ALEMBIC_CANDIDATES if (p / "alembic.ini").is_file()), None)
    if base is None:
        raise BackupError("alembic.ini nicht gefunden; das Kommando im Ordner /app starten.")
    config = Config(str(base / "alembic.ini"))
    config.set_main_option("script_location", str(base / "migrations"))
    script = ScriptDirectory.from_config(config)
    return {rev.revision for rev in script.walk_revisions()}


def _size(value: int) -> str:
    return f"{value / 1024 / 1024:.1f} MB"


def cmd_list(settings: Settings) -> int:
    backups = list_backups(settings)
    if not backups:
        print("Keine Sicherungen im Zielordner.")
    for b in backups:
        print(f"{b.name}  {_size(b.size_bytes):>10}  Version {b.version}  Revision {b.revision}")
    return 0


def cmd_backup(settings: Settings) -> int:
    with get_sessionmaker()() as db:
        run = run_backup(db, settings, trigger=TRIGGER_COMMAND)
        write_audit(
            db,
            module="kern",
            action="sicherung.erstellt",
            object_type="sicherung",
            object_id=run.name,
            details={"anlass": run.trigger, "bytes": run.size_bytes},
        )
        db.commit()
    print(f"Sicherung {run.name} erstellt ({_size(run.size_bytes or 0)}).")
    return 0


def cmd_verify(settings: Settings, name: str) -> int:
    verify(settings, name)
    print(f"Sicherung {name} ist vollständig und lässt sich entschlüsseln.")
    return 0


def cmd_restore(settings: Settings, name: str, confirmed: bool) -> int:
    if not confirmed:
        print(
            "Achtung: Datenbank und alle Dateien der Werkbank werden durch den Stand der "
            f"Sicherung {name} ersetzt. web und worker müssen angehalten sein."
        )
        answer = input("Zum Fortfahren den Namen der Sicherung eingeben: ").strip()
        if answer != name:
            print("Abgebrochen, nichts wurde geändert.")
            return 1
    info = restore(settings, name, known_revisions())
    with get_sessionmaker()() as db:
        write_audit(
            db,
            module="kern",
            action="sicherung.wiederhergestellt",
            object_type="sicherung",
            object_id=name,
            details={"version": info.get("version"), "revision": info.get("revision")},
        )
        db.commit()
    print(
        f"Sicherung {name} wurde wiederhergestellt. Jetzt web und worker starten; "
        "web bringt die Datenbank beim Start auf den Stand dieser Version."
    )
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m werkbank.backup", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("liste")
    commands.add_parser("sichern")
    check = commands.add_parser("pruefen")
    check.add_argument("name")
    back = commands.add_parser("wiederherstellen")
    back.add_argument("name")
    back.add_argument("--ja", action="store_true", help="ohne Rückfrage (für Skripte)")
    args = parser.parse_args(argv)
    settings = get_settings()
    logging.basicConfig(level=settings.log_level.upper(), format="%(levelname)s %(message)s")
    try:
        if args.command == "liste":
            return cmd_list(settings)
        if args.command == "sichern":
            return cmd_backup(settings)
        if args.command == "pruefen":
            return cmd_verify(settings, args.name)
        return cmd_restore(settings, args.name, args.ja)
    except BackupError as exc:
        print(f"Fehler: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
