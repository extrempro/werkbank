"""M365-Konfiguration: Empfehlungen aus Microsoft Secure Score

Revision ID: 0016
Revises: 0015
Erstellt: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "cfg_recommendations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("control_id", sa.String(length=128), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=True),
        sa.Column("service", sa.String(length=128), nullable=True),
        sa.Column("action_type", sa.String(length=32), nullable=True),
        sa.Column("user_impact", sa.String(length=32), nullable=True),
        sa.Column("implementation_cost", sa.String(length=32), nullable=True),
        sa.Column("rank", sa.Integer(), nullable=True),
        sa.Column("max_score", sa.Float(), nullable=False),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("status_text", sa.Text(), nullable=True),
        sa.Column("remediation", sa.Text(), nullable=True),
        sa.Column("action_url", sa.String(length=500), nullable=True),
        sa.Column("deprecated", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_cfg_recommendations")),
        sa.UniqueConstraint("control_id", name=op.f("uq_cfg_recommendations_control_id")),
    )
    op.create_table(
        "cfg_recommendation_links",
        sa.Column("recommendation_id", sa.Integer(), nullable=False),
        sa.Column("setting_id", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_cfg_recommendation_links_created_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["recommendation_id"],
            ["cfg_recommendations.id"],
            name=op.f("fk_cfg_recommendation_links_recommendation_id_cfg_recommendations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["setting_id"],
            ["cfg_settings.id"],
            name=op.f("fk_cfg_recommendation_links_setting_id_cfg_settings"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "recommendation_id", "setting_id", name=op.f("pk_cfg_recommendation_links")
        ),
    )
    op.create_index(
        op.f("ix_cfg_recommendation_links_setting_id"),
        "cfg_recommendation_links",
        ["setting_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_cfg_recommendation_links_setting_id"), table_name="cfg_recommendation_links"
    )
    op.drop_table("cfg_recommendation_links")
    op.drop_table("cfg_recommendations")
