"""Suche über alle Module (spec.md 6.10).

Jedes Modul meldet eine Funktion an, die zu einem Suchbegriff Treffer liefert. Die Funktion
prüft selbst, was die Person sehen darf; die Suche zeigt nie mehr als die Seiten des Moduls.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from werkbank.core.deps import CurrentUserDep, DbDep
from werkbank.core.sessions import CurrentUser

MIN_QUERY_LENGTH = 2
MAX_QUERY_LENGTH = 100


@dataclass(frozen=True)
class SearchHit:
    """Ein Treffer. kind: Art des Treffers als Text, z. B. „Einstellung“."""

    module: str
    kind: str
    title: str
    link: str
    subtitle: str | None = None


SearchProvider = Callable[[Session, CurrentUser, str], list[SearchHit]]

router = APIRouter(prefix="/api")


class SearchHitOut(BaseModel):
    module: str
    kind: str
    title: str
    subtitle: str | None
    link: str


class SearchOut(BaseModel):
    query: str
    hits: list[SearchHitOut]


@router.get("/search")
def search(
    request: Request,
    user: CurrentUserDep,
    db: DbDep,
    q: Annotated[str, Query(min_length=MIN_QUERY_LENGTH, max_length=MAX_QUERY_LENGTH)],
) -> SearchOut:
    """Treffer aus allen Modulen, die die angemeldete Person nutzen darf."""
    query = q.strip()
    if len(query) < MIN_QUERY_LENGTH:
        return SearchOut(query=query, hits=[])
    providers: Sequence[SearchProvider] = getattr(request.app.state, "search_providers", ())
    hits = [hit for provider in providers for hit in provider(db, user, query)]
    return SearchOut(
        query=query,
        hits=[
            SearchHitOut(
                module=hit.module,
                kind=hit.kind,
                title=hit.title,
                subtitle=hit.subtitle,
                link=hit.link,
            )
            for hit in hits
        ],
    )
