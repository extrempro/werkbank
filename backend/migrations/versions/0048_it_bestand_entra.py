"""IT-Bestand: Stand der Personen aus Entra für den stündlichen Abgleich

Revision ID: 0048
Revises: 0047
Erstellt: 2026-11-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0048"
down_revision: str | None = "0047"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "inventory_person_states",
        sa.Column("oid", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("upn", sa.String(length=200), nullable=False, server_default=""),
        sa.Column("state", sa.String(length=12), nullable=False, server_default="aktiv"),
        sa.Column("inactive_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "checked_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("inventory_person_states")
