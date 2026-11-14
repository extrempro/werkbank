"""Konfiguration über Umgebungsvariablen (siehe deploy/.env.example)."""

from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL


class Settings(BaseSettings):
    """Einstellungen der Werkbank.

    Secrets werden nicht als Umgebungsvariable gelesen, sondern aus Docker-Secrets (Dateien).
    """

    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    public_url: str = "http://localhost:8080"
    trusted_proxy_ips: str = "127.0.0.1"
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

    session_idle_minutes: int = 30
    session_max_hours: int = 8
    step_up_minutes: int = 15

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

    def validate_for_startup(self) -> None:
        """Bricht den Start ab, wenn die Konfiguration unsicher ist."""
        if self.enable_test_login and self.environment not in ("test", "development"):
            raise RuntimeError(
                "ENABLE_TEST_LOGIN ist nur in den Umgebungen 'test' und 'development' erlaubt."
            )


@lru_cache
def get_settings() -> Settings:
    """Liefert die Einstellungen (einmal gelesen, danach zwischengespeichert)."""
    return Settings()
