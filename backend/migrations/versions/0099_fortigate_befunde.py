"""IT-Monitoring, FortiGate: Befunde (seit wann) und Ausnahmen

Revision ID: 0099
Revises: 0098
Erstellt: 2026-11-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0099"
down_revision: str | None = "0098"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mon_fg_findings",
        sa.Column("key", sa.String(600), primary_key=True),
        sa.Column("device", sa.String(80), nullable=False),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("severity", sa.String(10), nullable=False),
        sa.Column("first_seen", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_mon_fg_findings_device", "mon_fg_findings", ["device"])
    op.create_table(
        "mon_fg_exceptions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("key", sa.String(600), nullable=False, unique=True),
        sa.Column("device", sa.String(80), nullable=False),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("subject", sa.String(500), nullable=False),
        sa.Column("label", sa.String(300), nullable=False),
        sa.Column("digest", sa.String(64), nullable=False),
        sa.Column("reason", sa.String(500), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_by",
            sa.Uuid,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )


def downgrade() -> None:
    op.drop_table("mon_fg_exceptions")
    op.drop_index("ix_mon_fg_findings_device", table_name="mon_fg_findings")
    op.drop_table("mon_fg_findings")
