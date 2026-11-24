"""Berechtigungen in der Werkbank statt App-Rollen in Entra

Bereichsrechte je Person, Kennzeichen für die Admin-Gruppe und der Zeitpunkt der einmaligen
Übernahme der alten App-Rollen (bei der nächsten Anmeldung).

Revision ID: 0082
Revises: 0081
Erstellt: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0082"
down_revision: str | None = "0081"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("permissions", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )
    op.add_column(
        "users", sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.add_column("users", sa.Column("permissions_since", sa.DateTime(timezone=True)))
    op.add_column("users", sa.Column("permissions_origin", sa.String(16)))


def downgrade() -> None:
    op.drop_column("users", "permissions_origin")
    op.drop_column("users", "permissions_since")
    op.drop_column("users", "is_admin")
    op.drop_column("users", "permissions")
