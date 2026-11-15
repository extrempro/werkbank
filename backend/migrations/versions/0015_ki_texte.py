"""M365-Konfiguration: KI-Texte je Art von Einstellung

Revision ID: 0015
Revises: 0014
Erstellt: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cfg_ai_texts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workload", sa.String(length=64), nullable=False),
        sa.Column("area", sa.String(length=128), nullable=False),
        sa.Column("property", sa.String(length=256), nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("reviewed_by", sa.Uuid(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["reviewed_by"], ["users.id"], name=op.f("fk_cfg_ai_texts_reviewed_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cfg_ai_texts")),
        sa.UniqueConstraint("workload", "area", "property", name=op.f("uq_cfg_ai_texts_workload")),
    )


def downgrade() -> None:
    op.drop_table("cfg_ai_texts")
