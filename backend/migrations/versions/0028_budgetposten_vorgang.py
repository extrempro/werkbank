"""IT-Budget: Budgetposten als Vorgang mit erwarteten Kosten und Laufzeit

Der Plan je Posten und Geschäftsjahr, die Freigabe des Plans und der Partner am Posten
entfallen. Jeder Posten bekommt erwartete Kosten je Geschäftsjahr und eine Laufzeit:

- Posten mit Plan: Laufzeit vom ersten bis zum letzten geplanten Jahr, erwartete Kosten aus
  dem ersten geplanten Jahr. Weichen die Beträge ab oder fehlen Jahre dazwischen, steht der
  bisherige Plan in der Notiz.
- Posten ohne Plan: läuft im laufenden Geschäftsjahr, erwartete Kosten 0.
- Ein bisheriger Partner am Posten steht danach in der Notiz.

Rechnungspositionen bekommen das Kennzeichen „schließt den Posten ab“. Bestehende Positionen
ohne Vertrag schließen ab, Positionen mit Vertrag (laufende Zahlungen) nicht.

Revision ID: 0028
Revises: 0027
Erstellt: 2026-11-16
"""

from collections.abc import Sequence
from datetime import date

import sqlalchemy as sa
from alembic import op

revision: str = "0028"
down_revision: str | None = "0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

NOTE_MAX = 500


def _start_month(bind: sa.Connection) -> int:
    value = bind.execute(
        sa.text("SELECT value FROM app_settings WHERE key = 'budget.settings'")
    ).scalar()
    month = value.get("start_month") if isinstance(value, dict) else None
    return month if isinstance(month, int) and 1 <= month <= 12 else 1


def _year_name(year: int, start_month: int) -> str:
    return str(year) if start_month == 1 else f"{year}/{(year + 1) % 100:02d}"


def _euro(cents: int) -> str:
    text = f"{cents / 100:,.2f}".replace(",", "#").replace(".", ",").replace("#", ".")
    return f"{text} €"


def _with_note(note: str, addition: str) -> str:
    combined = f"{note} · {addition}" if note else addition
    return combined if len(combined) <= NOTE_MAX else combined[: NOTE_MAX - 1] + "…"


def upgrade() -> None:
    bind = op.get_bind()
    start_month = _start_month(bind)
    today = date.today()
    current = today.year if today.month >= start_month else today.year - 1

    op.add_column(
        "budget_items",
        sa.Column("amount_cents", sa.BigInteger(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column("budget_items", sa.Column("start_year", sa.Integer(), nullable=True))
    op.add_column("budget_items", sa.Column("end_year", sa.Integer(), nullable=True))

    plans: dict[int, dict[int, int]] = {}
    for item_id, year, amount in bind.execute(
        sa.text("SELECT item_id, fiscal_year, amount_cents FROM budget_plans")
    ):
        plans.setdefault(item_id, {})[year] = amount
    partners: dict[int, str] = {
        row_id: name
        for row_id, name in bind.execute(sa.text("SELECT id, name FROM budget_partners"))
    }
    items = bind.execute(sa.text("SELECT id, note, partner_id FROM budget_items")).all()
    for item_id, note, partner_id in items:
        planned = plans.get(item_id, {})
        if planned:
            years = sorted(planned)
            start, end = years[0], years[-1]
            amount = planned[start]
            uneven = len(set(planned.values())) > 1 or len(years) != end - start + 1
            if uneven:
                listed = "; ".join(
                    f"{_year_name(year, start_month)}: {_euro(planned[year])}" for year in years
                )
                note = _with_note(note, f"Plan vor der Umstellung: {listed}")
        else:
            start, end, amount = current, current, 0
        if partner_id is not None and partner_id in partners:
            note = _with_note(note, f"Partner vor der Umstellung: {partners[partner_id]}")
        bind.execute(
            sa.text(
                "UPDATE budget_items SET amount_cents = :amount, start_year = :start, "
                "end_year = :end, note = :note WHERE id = :id"
            ),
            {"amount": amount, "start": start, "end": end, "note": note, "id": item_id},
        )

    op.alter_column("budget_items", "start_year", nullable=False)
    op.create_index(op.f("ix_budget_items_start_year"), "budget_items", ["start_year"])
    op.drop_index(op.f("ix_budget_items_partner_id"), table_name="budget_items")
    op.drop_constraint(
        op.f("fk_budget_items_partner_id_budget_partners"), "budget_items", type_="foreignkey"
    )
    op.drop_column("budget_items", "partner_id")
    op.drop_table("budget_plans")
    op.drop_table("budget_years")

    op.add_column(
        "budget_invoice_lines",
        sa.Column("closes_item", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )
    op.execute("UPDATE budget_invoice_lines SET closes_item = false WHERE contract_id IS NOT NULL")


def downgrade() -> None:
    """Zurück zum Plan je Jahr: erwartete Kosten werden für jedes Jahr der Laufzeit zum Plan
    (ohne Ende bis fünf Jahre nach Beginn). Freigaben und Partner am Posten bleiben leer."""
    op.drop_column("budget_invoice_lines", "closes_item")
    op.create_table(
        "budget_years",
        sa.Column("fiscal_year", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("released_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["released_by"], ["users.id"], name=op.f("fk_budget_years_released_by_users")
        ),
        sa.PrimaryKeyConstraint("fiscal_year", name=op.f("pk_budget_years")),
    )
    op.create_table(
        "budget_plans",
        sa.Column("item_id", sa.Integer(), nullable=False),
        sa.Column("fiscal_year", sa.Integer(), nullable=False),
        sa.Column("amount_cents", sa.BigInteger(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("updated_by", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(
            ["item_id"],
            ["budget_items.id"],
            name=op.f("fk_budget_plans_item_id_budget_items"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by"], ["users.id"], name=op.f("fk_budget_plans_updated_by_users")
        ),
        sa.PrimaryKeyConstraint("item_id", "fiscal_year", name=op.f("pk_budget_plans")),
    )
    op.execute(
        """
        INSERT INTO budget_plans (item_id, fiscal_year, amount_cents)
        SELECT item.id, year, item.amount_cents
        FROM budget_items AS item,
             generate_series(item.start_year, coalesce(item.end_year, item.start_year + 5)) AS year
        """
    )
    op.add_column("budget_items", sa.Column("partner_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        op.f("fk_budget_items_partner_id_budget_partners"),
        "budget_items",
        "budget_partners",
        ["partner_id"],
        ["id"],
    )
    op.create_index(op.f("ix_budget_items_partner_id"), "budget_items", ["partner_id"])
    op.drop_index(op.f("ix_budget_items_start_year"), table_name="budget_items")
    op.drop_column("budget_items", "end_year")
    op.drop_column("budget_items", "start_year")
    op.drop_column("budget_items", "amount_cents")
