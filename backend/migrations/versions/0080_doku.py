"""Dokumentation (Phase D1): Arbeitsbereiche, Seiten, eigene Rechte, Versionen

Revision ID: 0080
Revises: 0079
Erstellt: 2026-11-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0080"
down_revision: str | None = "0079"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "doku_spaces",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), server_default="", nullable=False),
        sa.Column("archived", sa.Boolean(), server_default=sa.text("false"), nullable=False),
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
        sa.PrimaryKeyConstraint("id", name=op.f("pk_doku_spaces")),
        sa.UniqueConstraint("name", name=op.f("uq_doku_spaces_name")),
    )
    op.create_table(
        "doku_pages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("space_id", sa.Integer(), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("position", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("text", sa.Text(), server_default="", nullable=False),
        sa.Column("revision", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("own_rights", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("locked_by_name", sa.String(length=256), server_default="", nullable=False),
        sa.Column("locked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("editing_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("editors", sa.String(length=500), server_default="", nullable=False),
        sa.Column("created_by_name", sa.String(length=256), server_default="", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_by_name", sa.String(length=256), server_default="", nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_name", sa.String(length=256), server_default="", nullable=False),
        sa.Column("deleted_root", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["doku_pages.id"],
            name=op.f("fk_doku_pages_parent_id_doku_pages"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["space_id"],
            ["doku_spaces.id"],
            name=op.f("fk_doku_pages_space_id_doku_spaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_doku_pages")),
    )
    op.create_index(op.f("ix_doku_pages_deleted_at"), "doku_pages", ["deleted_at"], unique=False)
    op.create_index(op.f("ix_doku_pages_parent_id"), "doku_pages", ["parent_id"], unique=False)
    op.create_index(op.f("ix_doku_pages_space_id"), "doku_pages", ["space_id"], unique=False)
    op.create_table(
        "doku_space_members",
        sa.Column("space_id", sa.Integer(), nullable=False),
        sa.Column("oid", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=256), server_default="", nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.ForeignKeyConstraint(
            ["space_id"],
            ["doku_spaces.id"],
            name=op.f("fk_doku_space_members_space_id_doku_spaces"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("space_id", "oid", name=op.f("pk_doku_space_members")),
    )
    op.create_index(op.f("ix_doku_space_members_oid"), "doku_space_members", ["oid"], unique=False)
    op.create_table(
        "doku_page_rights",
        sa.Column("page_id", sa.Uuid(), nullable=False),
        sa.Column("oid", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=256), server_default="", nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("changed_by_name", sa.String(length=256), server_default="", nullable=False),
        sa.Column(
            "changed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["page_id"],
            ["doku_pages.id"],
            name=op.f("fk_doku_page_rights_page_id_doku_pages"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("page_id", "oid", name=op.f("pk_doku_page_rights")),
    )
    op.create_table(
        "doku_versions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("page_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("name", sa.String(length=120), server_default="", nullable=False),
        sa.Column("authors", sa.String(length=500), server_default="", nullable=False),
        sa.Column("note", sa.String(length=300), server_default="", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["page_id"],
            ["doku_pages.id"],
            name=op.f("fk_doku_versions_page_id_doku_pages"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_doku_versions")),
    )
    op.create_index(op.f("ix_doku_versions_page_id"), "doku_versions", ["page_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_doku_versions_page_id"), table_name="doku_versions")
    op.drop_table("doku_versions")
    op.drop_table("doku_page_rights")
    op.drop_index(op.f("ix_doku_space_members_oid"), table_name="doku_space_members")
    op.drop_table("doku_space_members")
    op.drop_index(op.f("ix_doku_pages_space_id"), table_name="doku_pages")
    op.drop_index(op.f("ix_doku_pages_parent_id"), table_name="doku_pages")
    op.drop_index(op.f("ix_doku_pages_deleted_at"), table_name="doku_pages")
    op.drop_table("doku_pages")
    op.drop_table("doku_spaces")
