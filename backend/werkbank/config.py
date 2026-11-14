"""Konfiguration über Umgebungsvariablen (siehe deploy/.env.example)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Einstellungen der Werkbank.

    Secrets werden hier nicht gelesen, sie kommen aus Docker-Secrets.
    """

    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    public_url: str = "http://localhost:8080"
    trusted_proxy_ips: str = "127.0.0.1"
    log_level: str = "info"
    environment: str = "production"


@lru_cache
def get_settings() -> Settings:
    """Liefert die Einstellungen (einmal gelesen, danach zwischengespeichert)."""
    return Settings()
