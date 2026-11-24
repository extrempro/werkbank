"""Tickets: eingebettete Bilder mit Nummer in der Nachricht

Revision ID: 0079
Revises: 0078
Erstellt: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0079"
down_revision: str | None = "0078"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ticket_attachments", sa.Column("inline_number", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("ticket_attachments", "inline_number")
