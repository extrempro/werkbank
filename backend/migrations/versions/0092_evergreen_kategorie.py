"""Evergreen: Kategorie je Eintrag von Hand; Neuerungen ziehen unter Microsoft 365

Die Kategorie ergibt sich sonst aus den Diensten (wird nicht gespeichert). Angeheftete und
zuletzt besuchte Seiten der alten Adresse „/evergreen/m365“ zeigen auf „/m365/neuerungen“.

Revision ID: 0092
Revises: 0091
Erstellt: 2026-11-26
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0092"
down_revision: str | None = "0091"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD = "/evergreen/m365"
NEW = "/m365/neuerungen"


def _move_paths(old: str, new: str) -> None:
    bind = op.get_bind()
    # Steht die neue Adresse schon da, fällt die alte weg (eindeutig je Person und Art)
    bind.execute(
        sa.text(
            "DELETE FROM nav_entries AS o WHERE o.path = :old AND EXISTS ("
            "SELECT 1 FROM nav_entries AS n "
            "WHERE n.user_id = o.user_id AND n.kind = o.kind AND n.path = :new)"
        ),
        {"old": old, "new": new},
    )
    bind.execute(
        sa.text("UPDATE nav_entries SET path = :new WHERE path = :old"), {"old": old, "new": new}
    )


def upgrade() -> None:
    op.add_column("ev_entries", sa.Column("topic", sa.String(20), nullable=True))
    _move_paths(OLD, NEW)


def downgrade() -> None:
    _move_paths(NEW, OLD)
    op.drop_column("ev_entries", "topic")
