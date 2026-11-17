"""Suche im Bereich IT-Projekte: Projekte nach Name und Beschreibung."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from werkbank.core.roles import Role
from werkbank.core.search import SearchHit
from werkbank.core.sessions import CurrentUser
from werkbank.modules.projects.models import Project

MODULE = "IT-Projekte"
MAX_ITEMS = 8


def projects_search(db: Session, user: CurrentUser, query: str) -> list[SearchHit]:
    """Projekte, deren Name oder Beschreibung den Suchtext enthält. Nur für Projekt-Rollen."""
    if not user.has_any_role(Role.PROJECTS_READER, Role.PROJECTS_EDITOR):
        return []
    needle = query.casefold()
    hits: list[SearchHit] = []
    for row in db.scalars(select(Project).order_by(func.lower(Project.name), Project.id)).all():
        if needle not in row.name.casefold() and needle not in row.description.casefold():
            continue
        subtitle = f"Status: {row.status}"
        if row.description:
            subtitle += f" · {row.description}"
        hits.append(
            SearchHit(
                module=MODULE,
                kind="Projekt",
                title=row.name,
                subtitle=subtitle,
                link=f"/projekte/{row.id}",
            )
        )
        if len(hits) == MAX_ITEMS:
            break
    return hits
