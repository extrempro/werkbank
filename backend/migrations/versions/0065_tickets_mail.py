"""Tickets: E-Mail (Bereich, Anhänge, Eingänge, Zu prüfen, Sperrliste, Ausgang, Gestaltung)

Revision ID: 0065
Revises: 0064
Erstellt: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0065"
down_revision: str | None = "0064"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:

    op.create_table(
        "ticket_mail_design",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("accent", sa.String(length=7), server_default="", nullable=False),
        sa.Column("footer", sa.Text(), server_default="", nullable=False),
        sa.Column("privacy_url", sa.String(length=500), server_default="", nullable=False),
        sa.Column("logo_png", sa.LargeBinary(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_mail_design")),
    )
    op.create_table(
        "ticket_blocks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("area_id", sa.Integer(), nullable=False),
        sa.Column("value", sa.String(length=320), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["area_id"],
            ["ticket_areas.id"],
            name=op.f("fk_ticket_blocks_area_id_ticket_areas"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_blocks")),
        sa.UniqueConstraint("area_id", "value", name="uq_ticket_block"),
    )
    op.create_table(
        "ticket_mail_log",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("area_id", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.String(length=998), server_default="", nullable=False),
        sa.Column("sender", sa.String(length=320), server_default="", nullable=False),
        sa.Column("subject", sa.String(length=250), server_default="", nullable=False),
        sa.Column("result", sa.String(length=20), nullable=False),
        sa.Column("detail", sa.String(length=300), server_default="", nullable=False),
        sa.Column("ticket_number", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["area_id"],
            ["ticket_areas.id"],
            name=op.f("fk_ticket_mail_log_area_id_ticket_areas"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_mail_log")),
    )
    op.create_index(
        "ix_ticket_mail_log_area_message",
        "ticket_mail_log",
        ["area_id", "message_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_ticket_mail_log_created_at"), "ticket_mail_log", ["created_at"], unique=False
    )
    op.create_table(
        "ticket_review",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("area_id", sa.Integer(), nullable=False),
        sa.Column("graph_id", sa.String(length=300), server_default="", nullable=False),
        sa.Column("message_id", sa.String(length=998), nullable=False),
        sa.Column("sender", sa.String(length=320), nullable=False),
        sa.Column("sender_name", sa.String(length=200), server_default="", nullable=False),
        sa.Column("subject", sa.String(length=250), server_default="", nullable=False),
        sa.Column("raw", sa.LargeBinary(), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["area_id"],
            ["ticket_areas.id"],
            name=op.f("fk_ticket_review_area_id_ticket_areas"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_review")),
        sa.UniqueConstraint("area_id", "message_id", name="uq_ticket_review"),
    )
    op.create_index(op.f("ix_ticket_review_area_id"), "ticket_review", ["area_id"], unique=False)
    op.create_table(
        "ticket_mail_out",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=True),
        sa.Column("area_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("recipients", sa.String(length=2000), nullable=False),
        sa.Column("message_id", sa.String(length=998), server_default="", nullable=False),
        sa.Column("error", sa.String(length=500), server_default="", nullable=False),
        sa.Column(
            "sent_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["ticket_id"],
            ["tickets.id"],
            name=op.f("fk_ticket_mail_out_ticket_id_tickets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_mail_out")),
    )
    op.create_index(
        op.f("ix_ticket_mail_out_ticket_id"), "ticket_mail_out", ["ticket_id"], unique=False
    )
    op.create_table(
        "ticket_attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("ticket_id", sa.Uuid(), nullable=False),
        sa.Column("entry_id", sa.Uuid(), nullable=True),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column(
            "content_type",
            sa.String(length=100),
            server_default="application/octet-stream",
            nullable=False,
        ),
        sa.Column("size", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("key", sa.String(length=64), nullable=True),
        sa.Column("original", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("removed_reason", sa.String(length=200), server_default="", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["entry_id"],
            ["ticket_entries.id"],
            name=op.f("fk_ticket_attachments_entry_id_ticket_entries"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["ticket_id"],
            ["tickets.id"],
            name=op.f("fk_ticket_attachments_ticket_id_tickets"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ticket_attachments")),
    )
    op.create_index(
        op.f("ix_ticket_attachments_entry_id"), "ticket_attachments", ["entry_id"], unique=False
    )
    op.create_index(
        op.f("ix_ticket_attachments_ticket_id"), "ticket_attachments", ["ticket_id"], unique=False
    )
    op.add_column(
        "ticket_areas",
        sa.Column("sender_name", sa.String(length=120), server_default="", nullable=False),
    )
    op.add_column(
        "ticket_areas",
        sa.Column("header_title", sa.String(length=120), server_default="", nullable=False),
    )
    op.add_column(
        "ticket_areas", sa.Column("signature", sa.Text(), server_default="", nullable=False)
    )
    op.add_column(
        "ticket_areas",
        sa.Column("ack_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "ticket_areas", sa.Column("ack_text", sa.Text(), server_default="", nullable=False)
    )
    op.add_column(
        "ticket_areas",
        sa.Column(
            "mail_events",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "ticket_areas",
        sa.Column("external_policy", sa.String(length=10), server_default="accept", nullable=False),
    )
    op.add_column(
        "ticket_areas",
        sa.Column("max_attachment_mb", sa.Integer(), server_default=sa.text("15"), nullable=False),
    )
    op.add_column(
        "ticket_areas",
        sa.Column(
            "allowed_types",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "ticket_areas",
        sa.Column("processed_days", sa.Integer(), server_default=sa.text("30"), nullable=False),
    )
    op.add_column(
        "ticket_areas",
        sa.Column("ignored_days", sa.Integer(), server_default=sa.text("7"), nullable=False),
    )
    op.add_column(
        "ticket_areas",
        sa.Column("reopen_policy", sa.String(length=10), server_default="days", nullable=False),
    )
    op.add_column(
        "ticket_areas",
        sa.Column("reopen_days", sa.Integer(), server_default=sa.text("14"), nullable=False),
    )
    op.add_column(
        "ticket_areas", sa.Column("mailbox_checked_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column(
        "ticket_areas", sa.Column("mailbox_error", sa.Text(), server_default="", nullable=False)
    )
    op.add_column(
        "ticket_entries", sa.Column("quote", sa.Text(), server_default="", nullable=False)
    )
    op.add_column("ticket_entries", sa.Column("message_id", sa.String(length=998), nullable=True))
    op.create_index(
        op.f("ix_ticket_entries_message_id"), "ticket_entries", ["message_id"], unique=False
    )
    op.add_column(
        "tickets", sa.Column("first_response_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_check_constraint(
        "ck_ticket_area_external",
        "ticket_areas",
        "external_policy IN ('accept', 'review', 'reject')",
    )
    op.create_check_constraint(
        "ck_ticket_area_reopen", "ticket_areas", "reopen_policy IN ('days', 'always', 'new')"
    )
    # Vorgaben für vorhandene Bereiche (wie DEFAULT_TYPES und DEFAULT_EVENTS in mail_texts.py)
    op.execute(
        "UPDATE ticket_areas SET allowed_types = "
        '\'["pdf", "png", "jpg", "gif", "webp", "docx", "xlsx", "pptx", '
        '"txt", "csv", "eml", "msg", "zip"]\'::jsonb, '
        'mail_events = \'{"in_progress": false, "assignee": false, "waiting": true, '
        '"solved": true, "closed": false}\'::jsonb'
    )


def downgrade() -> None:
    op.drop_constraint("ck_ticket_area_reopen", "ticket_areas", type_="check")
    op.drop_constraint("ck_ticket_area_external", "ticket_areas", type_="check")

    op.drop_column("tickets", "first_response_at")
    op.drop_index(op.f("ix_ticket_entries_message_id"), table_name="ticket_entries")
    op.drop_column("ticket_entries", "message_id")
    op.drop_column("ticket_entries", "quote")
    op.drop_column("ticket_areas", "mailbox_error")
    op.drop_column("ticket_areas", "mailbox_checked_at")
    op.drop_column("ticket_areas", "reopen_days")
    op.drop_column("ticket_areas", "reopen_policy")
    op.drop_column("ticket_areas", "ignored_days")
    op.drop_column("ticket_areas", "processed_days")
    op.drop_column("ticket_areas", "allowed_types")
    op.drop_column("ticket_areas", "max_attachment_mb")
    op.drop_column("ticket_areas", "external_policy")
    op.drop_column("ticket_areas", "mail_events")
    op.drop_column("ticket_areas", "ack_text")
    op.drop_column("ticket_areas", "ack_enabled")
    op.drop_column("ticket_areas", "signature")
    op.drop_column("ticket_areas", "header_title")
    op.drop_column("ticket_areas", "sender_name")
    op.drop_index(op.f("ix_ticket_attachments_ticket_id"), table_name="ticket_attachments")
    op.drop_index(op.f("ix_ticket_attachments_entry_id"), table_name="ticket_attachments")
    op.drop_table("ticket_attachments")
    op.drop_index(op.f("ix_ticket_mail_out_ticket_id"), table_name="ticket_mail_out")
    op.drop_table("ticket_mail_out")
    op.drop_index(op.f("ix_ticket_review_area_id"), table_name="ticket_review")
    op.drop_table("ticket_review")
    op.drop_index(op.f("ix_ticket_mail_log_created_at"), table_name="ticket_mail_log")
    op.drop_index("ix_ticket_mail_log_area_message", table_name="ticket_mail_log")
    op.drop_table("ticket_mail_log")
    op.drop_table("ticket_blocks")
    op.drop_table("ticket_mail_design")
