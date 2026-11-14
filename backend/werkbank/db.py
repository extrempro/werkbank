"""Datenbankanbindung (SQLAlchemy 2)."""

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, MetaData, create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from werkbank.config import get_settings

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """Basisklasse aller Tabellen."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)


@lru_cache
def get_engine() -> Engine:
    """Erzeugt die Engine beim ersten Zugriff."""
    return create_engine(get_settings().sqlalchemy_url(), pool_pre_ping=True)


def get_sessionmaker() -> sessionmaker[Session]:
    """Liefert die Session-Fabrik."""
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def get_session() -> Iterator[Session]:
    """FastAPI-Abhängigkeit: eine Session pro Anfrage."""
    with get_sessionmaker()() as session:
        yield session


def database_ready() -> bool:
    """Prüft, ob die Datenbank erreichbar ist."""
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:
        return False
    return True
