"""Alembic-Umgebung: nutzt die Werkbank-Konfiguration und -Metadaten."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from werkbank.config import get_settings
from werkbank.core import models  # noqa: F401  (registriert die Tabellen)
from werkbank.db import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_online() -> None:
    """Migrationen gegen die konfigurierte Datenbank ausführen."""
    engine = create_engine(get_settings().sqlalchemy_url())
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
