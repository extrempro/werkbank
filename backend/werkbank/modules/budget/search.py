"""Suche im Modul IT-Budget: Budgetposten nach Name, Hinweis und Tag."""

from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.core.roles import Role
from werkbank.core.search import SearchHit
from werkbank.core.sessions import CurrentUser
from werkbank.modules.budget.models import BudgetAccount, BudgetItem

MODULE = "IT-Budget"
MAX_ITEMS = 8


def budget_search(db: Session, user: CurrentUser, query: str) -> list[SearchHit]:
    """Budgetposten, deren Name, Hinweis oder Tag den Suchtext enthält. Nur für Budget-Rollen."""
    if not user.has_any_role(Role.BUDGET_READER, Role.BUDGET_EDITOR, Role.BUDGET_MANAGER):
        return []
    needle = query.casefold()
    rows = db.execute(
        select(BudgetItem, BudgetAccount)
        .join(BudgetAccount, BudgetAccount.id == BudgetItem.account_id)
        .order_by(BudgetItem.active.desc(), BudgetItem.name, BudgetItem.id)
    ).all()
    hits: list[SearchHit] = []
    for item, account in rows:
        tags = [tag for tag in item.tags if needle in tag.casefold()]
        if not tags and needle not in item.name.casefold() and needle not in item.note.casefold():
            continue
        parts = [f"{account.number} {account.name}"]
        if item.tags:
            parts.append("Tags: " + ", ".join(item.tags))
        if not item.active:
            parts.append("stillgelegt")
        hits.append(
            SearchHit(
                module=MODULE,
                kind="Budgetposten",
                title=item.name,
                subtitle=" · ".join(parts),
                # Die Seite Budgetposten filtert mit diesem Suchtext auf den Posten.
                link=f"/budget/posten?suche={quote(item.name, safe='')}",
            )
        )
        if len(hits) == MAX_ITEMS:
            break
    return hits
