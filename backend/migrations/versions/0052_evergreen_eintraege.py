"""Evergreen nur noch für die IT: Einträge mit Status und Notizen statt Ablauf

Die bisherigen Evergreen-Daten (Vorgänge, Meldungen, geplante Umsetzung, Protokoll des
Ablaufs) werden gelöscht, wie vom Betreiber beschlossen. Die Meldungen holt der nächste Abruf
des Nachrichtencenters wieder (die letzten 30 Tage). Die Ablauf-Engine im Kern bleibt.

Revision ID: 0052
Revises: 0051
Erstellt: 2026-11-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0052"
down_revision: str | None = "0051"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Alte Evergreen-Daten löschen
    op.drop_table("ev_plan")
    op.drop_table("ev_messages")
    op.execute(
        "CREATE TEMP TABLE ev_old_instances AS SELECT workflow_instance_id AS id FROM ev_items"
    )
    op.drop_table("ev_items")
    # Das Protokoll des Ablaufs ist sonst unveränderlich (Trigger); nur für diese Löschung aus.
    op.execute("ALTER TABLE workflow_events DISABLE TRIGGER workflow_events_no_update_delete")
    op.execute(
        "DELETE FROM workflow_events WHERE instance_id IN (SELECT id FROM ev_old_instances)"
        " OR instance_id IN (SELECT id FROM workflow_instances WHERE workflow = 'evergreen')"
    )
    op.execute("ALTER TABLE workflow_events ENABLE TRIGGER workflow_events_no_update_delete")
    op.execute(
        "DELETE FROM workflow_instances WHERE id IN (SELECT id FROM ev_old_instances)"
        " OR workflow = 'evergreen'"
    )
    op.execute("DROP TABLE ev_old_instances")

    # Benachrichtigungen, Aufträge und Navigation, die es so nicht mehr gibt
    op.execute(
        "DELETE FROM notifications WHERE kind IN"
        " ('evergreen.schritt', 'evergreen.kommentar', 'evergreen.rollout', 'evergreen.meldung')"
    )
    op.execute(
        "DELETE FROM notification_mutes WHERE kind IN"
        " ('evergreen.schritt', 'evergreen.kommentar', 'evergreen.rollout', 'evergreen.meldung')"
    )
    op.execute(
        "DELETE FROM notification_channels WHERE kind IN"
        " ('evergreen.schritt', 'evergreen.kommentar', 'evergreen.rollout', 'evergreen.meldung')"
    )
    op.execute(
        "DELETE FROM notification_kinds WHERE kind IN"
        " ('evergreen.schritt', 'evergreen.kommentar', 'evergreen.rollout', 'evergreen.meldung')"
    )
    op.execute(
        "DELETE FROM notification_marks WHERE key LIKE 'evergreen.schritt:%'"
        " OR key LIKE 'evergreen.kommentar:%' OR key LIKE 'evergreen.rollout:%'"
        " OR key LIKE 'evergreen.meldung:%'"
    )
    op.execute("DELETE FROM jobs WHERE type = 'evergreen.umsetzung_pruefen'")
    op.execute("DELETE FROM nav_entries WHERE path LIKE '/evergreen%'")

    op.create_table(
        "ev_entries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("software", sa.String(length=32), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_ref", sa.String(length=128), nullable=True),
        sa.Column("services", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("category", sa.String(length=32), nullable=True),
        sa.Column("major_change", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("action_required_by", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("modified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("year", "sequence", name=op.f("uq_ev_entries_year")),
        sa.UniqueConstraint("source", "source_ref", name=op.f("uq_ev_entries_source")),
    )
    op.create_index(op.f("ix_ev_entries_software"), "ev_entries", ["software"])
    op.create_index(op.f("ix_ev_entries_status"), "ev_entries", ["status"])
    op.create_table(
        "ev_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "entry_id",
            sa.Integer(),
            sa.ForeignKey("ev_entries.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index(op.f("ix_ev_notes_entry_id"), "ev_notes", ["entry_id"])


def downgrade() -> None:
    # Die gelöschten Daten kommen nicht zurück; zurück geht nur der Aufbau der Tabellen
    # (wie in 0009 bis 0011).
    op.drop_table("ev_notes")
    op.drop_table("ev_entries")
    op.create_table(
        "ev_items",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("service", sa.String(length=100), nullable=True),
        sa.Column("source", sa.String(length=32), nullable=False),
        sa.Column("source_ref", sa.String(length=128), nullable=True),
        sa.Column("major_change", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("rollout_date", sa.Date(), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("departments_feedback", sa.Text(), nullable=True),
        sa.Column(
            "not_controllable", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column("workflow_instance_id", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["workflow_instance_id"],
            ["workflow_instances.id"],
            name=op.f("fk_ev_items_workflow_instance_id_workflow_instances"),
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_ev_items_created_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ev_items")),
        sa.UniqueConstraint("year", "sequence", name=op.f("uq_ev_items_year")),
        sa.UniqueConstraint("source", "source_ref", name=op.f("uq_ev_items_source")),
        sa.UniqueConstraint("workflow_instance_id", name=op.f("uq_ev_items_workflow_instance_id")),
    )
    op.create_table(
        "ev_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("services", postgresql.JSONB(), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=True),
        sa.Column("major_change", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("action_required_by", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("modified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=True),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["item_id"], ["ev_items.id"], name=op.f("fk_ev_messages_item_id_ev_items")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ev_messages")),
        sa.UniqueConstraint("message_id", name=op.f("uq_ev_messages_message_id")),
    )
    op.create_index(op.f("ix_ev_messages_status"), "ev_messages", ["status"], unique=False)
    op.create_index(op.f("ix_ev_messages_item_id"), "ev_messages", ["item_id"], unique=False)
    op.create_table(
        "ev_plan",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("setting_id", sa.Integer(), nullable=True),
        sa.Column("label", sa.String(length=300), nullable=False),
        sa.Column("target_value", postgresql.JSONB(), nullable=False),
        sa.Column("instruction", sa.Text(), nullable=True),
        sa.Column("provisional", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("confirmed_by", sa.Uuid(), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["item_id"], ["ev_items.id"], name=op.f("fk_ev_plan_item_id_ev_items")
        ),
        sa.ForeignKeyConstraint(
            ["setting_id"],
            ["cfg_settings.id"],
            name=op.f("fk_ev_plan_setting_id_cfg_settings"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["confirmed_by"], ["users.id"], name=op.f("fk_ev_plan_confirmed_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_ev_plan_created_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ev_plan")),
    )
    op.create_index(op.f("ix_ev_plan_item_id"), "ev_plan", ["item_id"], unique=False)
    op.create_index(op.f("ix_ev_plan_setting_id"), "ev_plan", ["setting_id"], unique=False)
