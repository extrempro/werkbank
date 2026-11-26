"""Tickets: Empfänger in Kopie je Antwort getrennt speichern

Antworten haben jetzt Felder „An“ und „Cc“ wie im Mailprogramm. `recipients` hält bei neuen
Antworten nur „An“, `recipients_cc` die Kopie. Bei älteren Einträgen bleibt `recipients_cc`
leer (NULL); dort gilt weiter: Melder ist „An“, alle anderen sind Kopie.

Revision ID: 0093
Revises: 0092
Erstellt: 2026-11-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0093"
down_revision: str | None = "0092"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("ticket_entries", sa.Column("recipients_cc", sa.String(2000), nullable=True))


def downgrade() -> None:
    op.drop_column("ticket_entries", "recipients_cc")
