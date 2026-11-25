"""Evergreen: Rollout-Phasen der Meldungen neu vorschlagen

Die Regeln erkennen jetzt auch „Rollout Schedule“ und Zeilen wie „Worldwide: …“. Leere
Abschnitte lassen den Abgleich beim nächsten Lauf Abschnitte und ungeprüfte Vorschläge neu
berechnen; von Hand geprüfte Werte bleiben unangetastet.

Revision ID: 0088
Revises: 0087
Erstellt: 2026-11-25
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0088"
down_revision: str | None = "0087"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE ev_entries SET sections = '[]'::jsonb "
        "WHERE source = 'nachrichtencenter' AND body IS NOT NULL"
    )


def downgrade() -> None:
    # Die Abschnitte entstehen beim nächsten Abgleich ohnehin wieder.
    pass
