"""Kern: Einstellungen der Werkbank, Aufbewahrungsfrist für das Audit-Log

Revision ID: 0013
Revises: 0012
Erstellt: 2026-11-15
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("value", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["users.id"], name=op.f("fk_app_settings_updated_by_users")
        ),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_app_settings")),
    )
    # Das Audit-Log bleibt nur anhängend. Einzige Ausnahme: Die Aufbewahrungsfrist darf Einträge
    # löschen, die älter als 30 Tage sind, und nur wenn der Aufräum-Auftrag das für seine
    # Transaktion ausdrücklich ankündigt. UPDATE und TRUNCATE bleiben immer gesperrt.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            IF TG_OP = 'DELETE'
               AND current_setting('werkbank.audit_purge', true) = 'on'
               AND OLD.occurred_at < now() - interval '30 days' THEN
                RETURN OLD;
            END IF;
            RAISE EXCEPTION 'audit_log ist nur anhängend (%)', TG_OP;
        END;
        $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger
        LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'audit_log ist nur anhängend (%)', TG_OP;
        END;
        $$;
        """
    )
    op.drop_table("app_settings")
