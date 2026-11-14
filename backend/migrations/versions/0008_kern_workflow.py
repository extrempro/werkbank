"""Kern: Workflow-Abläufe und unveränderliches Protokoll der Aktionen

Revision ID: 0008
Revises: 0007
Erstellt: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workflow_instances",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("workflow", sa.String(length=64), nullable=False),
        sa.Column("object_type", sa.String(length=64), nullable=False),
        sa.Column("object_id", sa.String(length=128), nullable=False),
        sa.Column("step", sa.String(length=64), nullable=False),
        sa.Column("finished", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workflow_instances")),
        sa.UniqueConstraint(
            "workflow",
            "object_type",
            "object_id",
            name=op.f("uq_workflow_instances_workflow"),
        ),
    )
    op.create_index(
        op.f("ix_workflow_instances_step"), "workflow_instances", ["step"], unique=False
    )
    op.create_table(
        "workflow_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("instance_id", sa.Integer(), nullable=False),
        sa.Column("step", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("target", sa.String(length=64), nullable=False),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("on_behalf_of", sa.String(length=128), nullable=True),
        sa.Column("details", postgresql.JSONB(), nullable=True),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["instance_id"],
            ["workflow_instances.id"],
            name=op.f("fk_workflow_events_instance_id_workflow_instances"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_workflow_events_user_id_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workflow_events")),
    )
    op.create_index(
        op.f("ix_workflow_events_instance_id"), "workflow_events", ["instance_id"], unique=False
    )

    # Protokoll nur anhängend: UPDATE, DELETE und TRUNCATE werden abgewiesen.
    op.execute(
        """
        CREATE FUNCTION workflow_events_append_only() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'workflow_events ist nur anhängend (%)', TG_OP;
        END;
        $$;
        """
    )
    op.execute(
        "CREATE TRIGGER workflow_events_no_update_delete BEFORE UPDATE OR DELETE "
        "ON workflow_events FOR EACH ROW EXECUTE FUNCTION workflow_events_append_only();"
    )
    op.execute(
        "CREATE TRIGGER workflow_events_no_truncate BEFORE TRUNCATE ON workflow_events "
        "FOR EACH STATEMENT EXECUTE FUNCTION workflow_events_append_only();"
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS workflow_events_no_truncate ON workflow_events;")
    op.execute("DROP TRIGGER IF EXISTS workflow_events_no_update_delete ON workflow_events;")
    op.execute("DROP FUNCTION IF EXISTS workflow_events_append_only();")
    op.drop_table("workflow_events")
    op.drop_table("workflow_instances")
