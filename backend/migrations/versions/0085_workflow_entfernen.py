"""Kern: Workflow-Engine entfernt (seit dem Umbau von Evergreen in 0.76 ungenutzt)

Revision ID: 0085
Revises: 0084
Erstellt: 2026-11-24
"""

import importlib.util
from collections.abc import Sequence
from pathlib import Path

from alembic import op

revision: str = "0085"
down_revision: str | None = "0084"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS workflow_events_no_truncate ON workflow_events;")
    op.execute("DROP TRIGGER IF EXISTS workflow_events_no_update_delete ON workflow_events;")
    op.execute("DROP FUNCTION IF EXISTS workflow_events_append_only();")
    op.drop_table("workflow_events")
    op.drop_table("workflow_instances")


def downgrade() -> None:
    # Tabellen wie in 0008 wieder anlegen (leer)
    path = Path(__file__).with_name("0008_kern_workflow.py")
    spec = importlib.util.spec_from_file_location("migration_0008", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Migration 0008 nicht gefunden")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.upgrade()
