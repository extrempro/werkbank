"""IT-Projekte: Projekte, Ansprechpartner, Links, Aufgaben, Jour Fixe mit Anhängen,
Zuordnung der Budgetposten

Revision ID: 0037
Revises: 0036
Erstellt: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0037"
down_revision: str | None = "0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _child(name: str, *columns: sa.schema.SchemaItem) -> None:
    """Tabelle, die zu einem Projekt gehört und mit ihm gelöscht wird."""
    op.create_table(
        name,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        *columns,
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f(f"fk_{name}_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f(f"pk_{name}")),
    )
    op.create_index(op.f(f"ix_{name}_project_id"), name, ["project_id"])


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("description", sa.String(length=500), server_default="", nullable=False),
        sa.Column("status", sa.String(length=16), server_default="aktiv", nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=True),
        sa.Column("ends_on", sa.Date(), nullable=True),
        sa.Column("budget_cents", sa.BigInteger(), nullable=True),
        sa.Column("budget_approved_on", sa.Date(), nullable=True),
        sa.Column("budget_note", sa.String(length=200), server_default="", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_projects")),
        sa.UniqueConstraint("name", name=op.f("uq_projects_name")),
    )
    _child(
        "project_people",
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("role", sa.String(length=120), server_default="", nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("organisation", sa.String(length=160), server_default="", nullable=False),
        sa.Column("contact", sa.String(length=200), server_default="", nullable=False),
    )
    _child(
        "project_links",
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("url", sa.String(length=500), nullable=False),
    )
    _child(
        "project_tasks",
        sa.Column("text", sa.String(length=300), nullable=False),
        sa.Column("owner", sa.String(length=120), server_default="", nullable=False),
        sa.Column("due_on", sa.Date(), nullable=True),
        sa.Column("done", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("done_at", sa.DateTime(timezone=True), nullable=True),
    )
    _child(
        "project_meetings",
        sa.Column("held_on", sa.Date(), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("body", sa.Text(), server_default="", nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_project_meetings_created_by_users")
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["users.id"], name=op.f("fk_project_meetings_updated_by_users")
        ),
    )
    op.create_index(op.f("ix_project_meetings_held_on"), "project_meetings", ["held_on"])
    op.create_table(
        "project_meeting_files",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("meeting_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["meeting_id"],
            ["project_meetings.id"],
            name=op.f("fk_project_meeting_files_meeting_id_project_meetings"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], name=op.f("fk_project_meeting_files_created_by_users")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_project_meeting_files")),
    )
    op.create_index(
        op.f("ix_project_meeting_files_meeting_id"), "project_meeting_files", ["meeting_id"]
    )
    op.add_column("budget_items", sa.Column("project_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        op.f("fk_budget_items_project_id_projects"),
        "budget_items",
        "projects",
        ["project_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(op.f("ix_budget_items_project_id"), "budget_items", ["project_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_budget_items_project_id"), table_name="budget_items")
    op.drop_constraint(
        op.f("fk_budget_items_project_id_projects"), "budget_items", type_="foreignkey"
    )
    op.drop_column("budget_items", "project_id")
    op.drop_table("project_meeting_files")
    op.drop_table("project_meetings")
    op.drop_table("project_tasks")
    op.drop_table("project_links")
    op.drop_table("project_people")
    op.drop_table("projects")
