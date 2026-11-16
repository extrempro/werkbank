"""IT-Budget: Liste der Tags, gepflegt vom Budgetverwalter

Alle bisher an Budgetposten oder gespeicherten Statistiken vergebenen Tags kommen in die
Liste, in der Schreibweise, in der sie zuerst vergeben wurden.

Revision ID: 0029
Revises: 0028
Erstellt: 2026-11-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029"
down_revision: str | None = "0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "budget_tags",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=30), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_budget_tags")),
        sa.UniqueConstraint("name", name=op.f("uq_budget_tags_name")),
    )
    bind = op.get_bind()
    spelling: dict[str, str] = {}
    queries = (
        "SELECT tags FROM budget_items ORDER BY id",
        "SELECT tags FROM budget_statistics ORDER BY id",
    )
    for query in queries:
        for (tags,) in bind.execute(sa.text(query)):
            for tag in tags or []:
                if isinstance(tag, str) and tag.strip():
                    spelling.setdefault(tag.casefold(), tag[:30])
    for name in sorted(spelling.values(), key=str.casefold):
        bind.execute(sa.text("INSERT INTO budget_tags (name) VALUES (:name)"), {"name": name})


def downgrade() -> None:
    op.drop_table("budget_tags")
