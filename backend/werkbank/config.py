"""Konfiguration über Umgebungsvariablen (siehe deploy/.env.example)."""

import re
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL

_GUID = re.compile(r"^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$")


class Settings(BaseSettings):
    """Einstellungen der Werkbank.

    Secrets werden nicht als Umgebungsvariable gelesen, sondern aus Docker-Secrets (Dateien).
    """

    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    public_url: str = "http://localhost:8080"
    log_level: str = "info"
    # production | development | test
    environment: str = "production"

    postgres_host: str = "db"
    postgres_port: int = 5432
    postgres_db: str = "werkbank"
    postgres_user: str = "werkbank"
    postgres_password_file: Path = Path("/run/secrets/postgres_password")

    # Nur für Tests und lokale Entwicklung: vollständige Verbindungs-URL statt Einzelwerten.
    database_url: str | None = None

    # Anmeldung über Entra ID (siehe docs/entra-setup.md)
    entra_tenant_id: str = ""
    entra_client_id: str = ""
    entra_client_key_file: Path = Path("/run/secrets/entra_client_key.pem")
    entra_client_cert_file: Path = Path("/run/secrets/entra_client_cert.pem")
    entra_client_secret_file: Path = Path("/run/secrets/entra_client_secret")
    # Profilbild bei der Anmeldung aus Entra holen. Braucht die delegierte Berechtigung
    # User.Read an der App-Registrierung für die Anmeldung (docs/entra-setup.md).
    entra_profile_photo: bool = False
    # Gruppen in Entra (Objekt-IDs, docs/entra-setup.md): Mitglieder der Zugangs-Gruppe dürfen
    # sich anmelden, Mitglieder der Admin-Gruppe dazu in die Verwaltung. Die Rechte in den
    # Bereichen vergibt die Verwaltung. Leer: Übergang, Anmeldung wie bisher über App-Rollen.
    entra_admin_group_id: str = ""
    entra_access_group_id: str = ""
    # Schlüssel für geheime Werte aus der Verwaltung (z. B. SMTP-Passwort): beliebiger
    # Zufallstext mit mindestens 32 Zeichen als Secret-Datei.
    settings_key_file: Path = Path("/run/secrets/settings_key")

    session_idle_minutes: int = 30
    session_max_hours: int = 8
    step_up_minutes: int = 15

    # Datenabruf aus dem Tenant (App-Registrierung "Werkbank Collector", nur Zertifikat)
    collector_client_id: str = ""
    collector_client_key_file: Path = Path("/run/secrets/collector_client_key.pem")
    collector_client_cert_file: Path = Path("/run/secrets/collector_client_cert.pem")
    collector_interval_hours: int = 24
    # Abrufe ohne Änderungen nach so vielen Tagen löschen (0 = nie); die letzten 10 bleiben immer
    collector_snapshot_keep_days: int = 90
    # Empfehlungen aus Microsoft Secure Score (braucht die Berechtigung SecurityEvents.Read.All)
    secure_score_enabled: bool = False
    secure_score_interval_hours: int = 24
    # Lizenzen und Benutzerzahlen (braucht Organization.Read.All und User.Read.All)
    tenant_monitor_enabled: bool = False
    tenant_monitor_interval_hours: int = 24
    # Zertifikate und Secrets der Anwendungen (braucht Application.Read.All)
    tenant_credentials_enabled: bool = False
    # Dienststatus von Microsoft 365 (braucht ServiceHealth.Read.All), Abstand in Minuten
    tenant_health_enabled: bool = False
    tenant_health_interval_minutes: int = 15
    # Nutzung der Dienste als Summen (braucht Reports.Read.All), alle 12 Stunden
    tenant_usage_enabled: bool = False
    # UTCM-Ressourcentypen, kommagetrennt
    collector_resources: str = (
        "microsoft.entra.conditionalaccesspolicy,"
        "microsoft.entra.namedlocationpolicy,"
        "microsoft.entra.authorizationpolicy"
    )
    # SharePoint- und OneDrive-Mandanteneinstellungen über Microsoft Graph mitlesen (UTCM kann
    # SharePoint nicht); braucht SharePointTenantSettings.Read.All für die Collector-App
    collector_sharepoint_enabled: bool = False
    collector_timeout_minutes: int = 30
    # Abstand, in dem das Nachrichtencenter von Microsoft gelesen wird (Bereich Evergreen)
    message_center_interval_hours: int = 6
    # Gerätezuordnung: offene Einträge im Hintergrund mit der Collector-App prüfen (nur lesend;
    # braucht DeviceManagementServiceConfig.Read.All und DeviceManagementManagedDevices.Read.All)
    devices_monitor_enabled: bool = False
    collector_poll_seconds: int = 20
    # Tickets: so lange gilt die abgefragte Gruppenmitgliedschaft einer Person (Minuten)
    tickets_membership_cache_minutes: int = 5
    # Tickets: App-Registrierung „Werkbank Tickets“ für die Postfächer (Mail lesen, verschieben,
    # senden; in Exchange per RBAC auf die Ticket-Postfächer beschränkt), nur Zertifikat
    tickets_mail_client_id: str = ""
    # Vorgabe: dasselbe Zertifikat wie die Collector-App (in beiden App-Registrierungen
    # hochladen); für ein eigenes Zertifikat die Pfade und Docker-Secrets anpassen
    tickets_mail_client_key_file: Path = Path("/run/secrets/collector_client_key.pem")
    tickets_mail_client_cert_file: Path = Path("/run/secrets/collector_client_cert.pem")
    # Eigene Maildomänen, kommagetrennt; Absender anderer Domänen gelten als extern
    tickets_internal_domains: str = ""
    # Ablage der Anhänge und Originale (.eml), Unterordner im Volume der Belege
    tickets_files_dir: Path = Path("/data/belege/tickets")
    # Zeitzone für die Arbeitszeit der Fristen und für Erinnerungen
    tickets_timezone: str = "Europe/Berlin"

    # Höchstzahl Anfragen pro Minute und Absender-IP (0 = aus), siehe core/ratelimit.py
    rate_limit_login_per_minute: int = 60
    rate_limit_api_per_minute: int = 600
    rate_limit_export_per_minute: int = 10
    rate_limit_tools_net_per_minute: int = 300

    # Worker: Pause zwischen zwei Blicken in die Auftragsliste, wenn nichts zu tun ist
    worker_poll_seconds: int = 10

    # Verzeichnis mit dem Frontend-Build (im Docker-Image /app/static)
    static_dir: Path = Path("/app/static")

    # Ablage der PDF-Belege des IT-Budgets (im Container ein eigenes Volume) und ihre
    # Höchstgröße in Megabyte
    budget_documents_dir: Path = Path("/data/belege")
    budget_document_max_mb: int = 15
    # Ablage der PDF-Anhänge im Jour Fixe der IT-Projekte (Unterordner im selben Volume) und
    # ihre Höchstgröße in Megabyte
    project_documents_dir: Path = Path("/data/belege/projekte")
    project_document_max_mb: int = 20
    # Höchstgröße eines Grundrisses im IT-Bestand in Megabyte (Bild in der Datenbank)
    inventory_plan_max_mb: int = 10

    # Datensicherung: Zielordner (Volume oder Ordner auf dem Host, z. B. ein NAS), Schlüssel
    # für die Verschlüsselung (eigenes Docker-Secret, getrennt von settings_key) und die
    # PostgreSQL-Werkzeuge in der Version des Datenbank-Servers
    backup_dir: Path = Path("/data/backups")
    backup_key_file: Path = Path("/run/secrets/backup_key")
    backup_pg_bin_dir: Path = Path("/usr/lib/postgresql/16/bin")

    # Test-Login ohne Entra. Nur in den Umgebungen "test" und "development" zulässig.
    enable_test_login: bool = False

    def sqlalchemy_url(self) -> str | URL:
        """Verbindungs-URL für SQLAlchemy (Treiber psycopg 3)."""
        if self.database_url:
            return self.database_url
        password = self.postgres_password_file.read_text(encoding="utf-8").strip()
        return URL.create(
            drivername="postgresql+psycopg",
            username=self.postgres_user,
            password=password,
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_db,
        )

    @property
    def public_origin(self) -> str:
        """Origin der öffentlichen Adresse, z. B. https://werkbank.example.com."""
        parts = urlsplit(self.public_url)
        return f"{parts.scheme}://{parts.netloc}"

    @property
    def collector_configured(self) -> bool:
        """Der Abruf läuft nur, wenn Mandant und Collector-App eingetragen sind."""
        empty = ("", "00000000-0000-0000-0000-000000000000")
        return self.collector_client_id not in empty and self.entra_tenant_id not in empty

    @property
    def tickets_mail_configured(self) -> bool:
        """Postfächer der Tickets sind nur mit eigener App-Registrierung angebunden."""
        empty = ("", "00000000-0000-0000-0000-000000000000")
        return self.tickets_mail_client_id not in empty and self.entra_tenant_id not in empty

    def tickets_internal_domain_list(self) -> list[str]:
        """Eigene Maildomänen in Kleinbuchstaben, ohne „@“."""
        names = [n.strip().lower().lstrip("@") for n in self.tickets_internal_domains.split(",")]
        return [n for n in names if n]

    def collector_resource_list(self) -> list[str]:
        """Ressourcentypen in Kleinbuchstaben, ohne Doppelte, in der angegebenen Reihenfolge."""
        names = [name.strip().lower() for name in self.collector_resources.split(",")]
        return list(dict.fromkeys(name for name in names if name))

    @property
    def entra_groups_configured(self) -> bool:
        """Anmeldung über die Gruppen: beide Objekt-IDs sind eingetragen."""
        return bool(self.entra_admin_group_id.strip() and self.entra_access_group_id.strip())

    def validate_for_startup(self) -> None:
        """Bricht den Start ab, wenn die Konfiguration unsicher ist."""
        groups = [self.entra_admin_group_id.strip(), self.entra_access_group_id.strip()]
        if any(groups) and not all(groups):
            raise RuntimeError(
                "ENTRA_ADMIN_GROUP_ID und ENTRA_ACCESS_GROUP_ID nur zusammen eintragen."
            )
        if any(groups) and not all(_GUID.match(value) for value in groups):
            raise RuntimeError(
                "ENTRA_ADMIN_GROUP_ID und ENTRA_ACCESS_GROUP_ID sind keine Objekt-IDs."
            )
        if any(groups) and groups[0].lower() == groups[1].lower():
            raise RuntimeError("Admin- und Zugangs-Gruppe müssen verschiedene Gruppen sein.")
        if self.enable_test_login and self.environment not in ("test", "development"):
            raise RuntimeError(
                "ENABLE_TEST_LOGIN ist nur in den Umgebungen 'test' und 'development' erlaubt."
            )


@lru_cache
def get_settings() -> Settings:
    """Liefert die Einstellungen (einmal gelesen, danach zwischengespeichert)."""
    return Settings()
