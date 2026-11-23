"""Tickets: Rolle „Nur lesen“ entfernt, Weiterleiten, Absender und Empfänger an Einträgen

Rollen „Nur lesen“ werden gelöscht (so entschieden): Wer nur darüber Zugriff hatte, sieht die
Tickets danach nicht mehr.

Revision ID: 0070
Revises: 0069
Erstellt: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0070"
down_revision: str | None = "0069"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

GRANT_ROLE = "ck_ticket_area_grants_ck_ticket_grant_role"
ENTRY_KIND = "ck_ticket_entries_ck_ticket_entry_kind"


def upgrade() -> None:
    op.execute("DELETE FROM ticket_area_grants WHERE role = 'read'")
    op.drop_constraint(op.f(GRANT_ROLE), "ticket_area_grants", type_="check")
    op.create_check_constraint(op.f(GRANT_ROLE), "ticket_area_grants", "role IN ('admin', 'edit')")
    op.drop_constraint(op.f(ENTRY_KIND), "ticket_entries", type_="check")
    op.create_check_constraint(
        op.f(ENTRY_KIND),
        "ticket_entries",
        "kind IN ('inbound', 'reply', 'note', 'system', 'forward')",
    )
    op.add_column(
        "ticket_entries",
        sa.Column("author_mail", sa.String(length=320), server_default="", nullable=False),
    )
    op.add_column(
        "ticket_entries",
        sa.Column("recipients", sa.String(length=2000), server_default="", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("ticket_entries", "recipients")
    op.drop_column("ticket_entries", "author_mail")
    op.execute("DELETE FROM ticket_entries WHERE kind = 'forward'")
    op.drop_constraint(op.f(ENTRY_KIND), "ticket_entries", type_="check")
    op.create_check_constraint(
        op.f(ENTRY_KIND), "ticket_entries", "kind IN ('inbound', 'reply', 'note', 'system')"
    )
    op.drop_constraint(op.f(GRANT_ROLE), "ticket_area_grants", type_="check")
    op.create_check_constraint(
        op.f(GRANT_ROLE), "ticket_area_grants", "role IN ('admin', 'edit', 'read')"
    )
