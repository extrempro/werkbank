"""Konfiguration über Umgebungsvariablen (siehe deploy/.env.example)."""

from functools import lru_cache
from pathlib import Path

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
    environment: str = "production"

    postgres_host: str = "db"
    postgres_port: int = 5432
    postgres_db: str = "werkbank"
    postgres_user: str = "werkbank"
    postgres_password_file: Path = Path("/run/secrets/postgres_password")

    # Nur für Tests und lokale Entwicklung: vollständige Verbindungs-URL statt Einzelwerten.
    database_url: str | None = None

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


@lru_cache
def get_settings() -> Settings:
    """Liefert die Einstellungen (einmal gelesen, danach zwischengespeichert)."""
    return Settings()
