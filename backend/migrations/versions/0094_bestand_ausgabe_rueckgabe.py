"""IT-Bestand: Ausgabe mit Vorbereitung und Rückgabe, Zubehör und Checklisten-Vorlagen

Revision ID: 0094
Revises: 0093
Erstellt: 2026-11-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0094"
down_revision: str | None = "0093"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _user(name: str) -> sa.Column:
    return sa.Column(name, sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


def _created() -> sa.Column:
    return sa.Column(
        "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
    )


def upgrade() -> None:
    op.create_table(
        "inventory_accessories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "kind_id",
            sa.Integer(),
            sa.ForeignKey("inventory_kinds.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(80), nullable=False),
        sa.UniqueConstraint("kind_id", "name", name="uq_inventory_accessories_kind_name"),
    )
    op.create_index("ix_inventory_accessories_kind_id", "inventory_accessories", ["kind_id"])

    op.create_table(
        "inventory_checklist_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reason", sa.String(16), nullable=True),
        sa.Column(
            "kind_id",
            sa.Integer(),
            sa.ForeignKey("inventory_kinds.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("label", sa.String(160), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("(reason IS NULL) <> (kind_id IS NULL)", name="reason_or_kind"),
    )
    op.create_index(
        "ix_inventory_checklist_templates_kind_id", "inventory_checklist_templates", ["kind_id"]
    )

    op.create_table(
        "inventory_issues",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("number", sa.String(20), nullable=False, unique=True),
        sa.Column("person_oid", sa.String(36), nullable=False),
        sa.Column("person_name", sa.String(200), nullable=False),
        sa.Column("person_upn", sa.String(200), nullable=False, server_default=""),
        sa.Column("person_mail", sa.String(200), nullable=False, server_default=""),
        sa.Column(
            "position_id",
            sa.Integer(),
            sa.ForeignKey("inventory_positions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("reason", sa.String(16), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="vorbereitung"),
        sa.Column("condition", sa.String(16), nullable=False, server_default="neuwertig"),
        sa.Column("condition_note", sa.String(300), nullable=False, server_default=""),
        sa.Column("attach_rules", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notify_teams", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("confirm_method", sa.String(16), nullable=False),
        sa.Column("pickup_place", sa.String(120), nullable=False, server_default=""),
        sa.Column("pickup_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("token_hash", sa.String(64), nullable=True, unique=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("signature_png", sa.LargeBinary(), nullable=True),
        sa.Column("signed_name", sa.String(200), nullable=False, server_default=""),
        sa.Column("rules_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("confirmed_via", sa.String(16), nullable=False, server_default=""),
        _user("created_by"),
        _user("handed_by"),
        _created(),
        sa.Column("ready_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("handed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_inventory_issues_person_oid", "inventory_issues", ["person_oid"])
    op.create_index("ix_inventory_issues_position_id", "inventory_issues", ["position_id"])
    op.create_index("ix_inventory_issues_state", "inventory_issues", ["state"])

    op.create_table(
        "inventory_issue_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "issue_id",
            sa.Integer(),
            sa.ForeignKey("inventory_issues.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "hardware_id",
            sa.Integer(),
            sa.ForeignKey("inventory_hardware.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("accessories", JSONB(), nullable=False, server_default="[]"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.UniqueConstraint(
            "issue_id", "hardware_id", name="uq_inventory_issue_items_issue_hardware"
        ),
    )
    op.create_index("ix_inventory_issue_items_issue_id", "inventory_issue_items", ["issue_id"])
    op.create_index(
        "ix_inventory_issue_items_hardware_id", "inventory_issue_items", ["hardware_id"]
    )
    op.create_index(
        "uq_inventory_issue_items_active",
        "inventory_issue_items",
        ["hardware_id"],
        unique=True,
        postgresql_where=sa.text("active"),
    )

    op.create_table(
        "inventory_issue_tasks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "issue_id",
            sa.Integer(),
            sa.ForeignKey("inventory_issues.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "hardware_id",
            sa.Integer(),
            sa.ForeignKey("inventory_hardware.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("label", sa.String(160), nullable=False),
        sa.Column("sort", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
        _user("done_by"),
    )
    op.create_index("ix_inventory_issue_tasks_issue_id", "inventory_issue_tasks", ["issue_id"])

    op.create_table(
        "inventory_issue_messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "issue_id",
            sa.Integer(),
            sa.ForeignKey("inventory_issues.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("channel", sa.String(8), nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="offen"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.String(200), nullable=False, server_default=""),
        _created(),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_inventory_issue_messages_issue_id", "inventory_issue_messages", ["issue_id"]
    )

    op.create_table(
        "inventory_returns",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("number", sa.String(20), nullable=False, unique=True),
        sa.Column("person_oid", sa.String(36), nullable=False),
        sa.Column("person_name", sa.String(200), nullable=False),
        sa.Column("reason", sa.String(16), nullable=False),
        sa.Column("state", sa.String(16), nullable=False, server_default="offen"),
        _user("created_by"),
        _user("closed_by"),
        _created(),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_inventory_returns_person_oid", "inventory_returns", ["person_oid"])
    op.create_index("ix_inventory_returns_state", "inventory_returns", ["state"])

    op.create_table(
        "inventory_return_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "return_id",
            sa.Integer(),
            sa.ForeignKey("inventory_returns.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "hardware_id",
            sa.Integer(),
            sa.ForeignKey("inventory_hardware.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "position_id",
            sa.Integer(),
            sa.ForeignKey("inventory_positions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "loan_id",
            sa.Integer(),
            sa.ForeignKey("inventory_loans.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("state", sa.String(10), nullable=False, server_default="offen"),
        sa.Column("condition", sa.String(16), nullable=False, server_default="in_ordnung"),
        sa.Column(
            "room_id",
            sa.Integer(),
            sa.ForeignKey("inventory_rooms.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("accessories_ok", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("wiped", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint(
            "return_id", "hardware_id", name="uq_inventory_return_items_return_hardware"
        ),
    )
    op.create_index("ix_inventory_return_items_return_id", "inventory_return_items", ["return_id"])
    op.create_index(
        "ix_inventory_return_items_hardware_id", "inventory_return_items", ["hardware_id"]
    )

    op.bulk_insert(
        sa.table(
            "inventory_number_ranges",
            sa.column("key", sa.String),
            sa.column("prefix", sa.String),
            sa.column("next_value", sa.Integer),
        ),
        [
            {"key": "ausgabe", "prefix": "A-", "next_value": 1},
            {"key": "rueckgabe", "prefix": "R-", "next_value": 1},
        ],
    )


def downgrade() -> None:
    op.execute("DELETE FROM inventory_number_ranges WHERE key IN ('ausgabe', 'rueckgabe')")
    for table in (
        "inventory_return_items",
        "inventory_returns",
        "inventory_issue_messages",
        "inventory_issue_tasks",
        "inventory_issue_items",
        "inventory_issues",
        "inventory_checklist_templates",
        "inventory_accessories",
    ):
        op.drop_table(table)
