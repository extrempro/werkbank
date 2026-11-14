import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy.orm import Session

from werkbank.db import get_sessionmaker

BACKEND_DIR = Path(__file__).resolve().parent.parent


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Datenbanktests überspringen, wenn keine Testdatenbank konfiguriert ist."""
    if os.environ.get("DATABASE_URL"):
        return
    skip = pytest.mark.skip(reason="DATABASE_URL nicht gesetzt")
    for item in items:
        if "db" in item.keywords:
            item.add_marker(skip)


@pytest.fixture(scope="session")
def migrated_db() -> Iterator[None]:
    """Migriert die Testdatenbank auf den neuesten Stand und räumt danach auf."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    command.upgrade(cfg, "head")
    yield
    command.downgrade(cfg, "base")


@pytest.fixture
def db_session(migrated_db: None) -> Iterator[Session]:
    with get_sessionmaker()() as session:
        yield session
