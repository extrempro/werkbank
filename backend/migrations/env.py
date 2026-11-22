"""Alembic-Umgebung: nutzt die Werkbank-Konfiguration und -Metadaten."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from werkbank.config import get_settings
from werkbank.core import models  # noqa: F401  (registriert die Tabellen)
from werkbank.db import Base
from werkbank.modules.budget import models as budget_models  # noqa: F401
from werkbank.modules.devices import models as devices_models  # noqa: F401
from werkbank.modules.evergreen import models as evergreen_models  # noqa: F401
from werkbank.modules.inventory import models as inventory_models  # noqa: F401
from werkbank.modules.m365_config import models as m365_config_models  # noqa: F401
from werkbank.modules.monitoring import models as monitoring_models  # noqa: F401
from werkbank.modules.monitoring.zabbix import models as zabbix_models  # noqa: F401
from werkbank.modules.projects import models as projects_models  # noqa: F401
from werkbank.modules.tenant import models as tenant_models  # noqa: F401
from werkbank.modules.tickets import models as tickets_models  # noqa: F401
from werkbank.modules.tools import models as tools_models  # noqa: F401

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
