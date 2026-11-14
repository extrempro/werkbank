"""M365-Konfiguration: Zahl der gelesenen Objekte je Abruf (Monatskontingent)

Revision ID: 0006
Revises: 0005
Erstellt: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "cfg_snapshots",
        sa.Column("resource_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("cfg_snapshots", "resource_count")
