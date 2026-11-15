"""Suche im Modul Evergreen: Vorgänge, die die Person sehen darf."""

import re

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from werkbank.core.models import WorkflowInstance
from werkbank.core.search import SearchHit
from werkbank.core.sessions import CurrentUser
from werkbank.modules.evergreen.models import EvItem
from werkbank.modules.evergreen.service import ALL_ROLES, visibility
from werkbank.modules.evergreen.workflow import evergreen_workflow

MODULE = "Evergreen"
MAX_ITEMS = 8
NUMBER = re.compile(r"^EV-(\d{4})-(\d{1,6})$", re.IGNORECASE)


def evergreen_search(db: Session, user: CurrentUser, query: str) -> list[SearchHit]:
    """Sucht in Nummer, Titel, Dienst und Zusammenfassung. Sichtbarkeit wie in der Liste."""
    if not user.has_any_role(*ALL_ROLES):
        return []
    conditions = [
        EvItem.title.icontains(query, autoescape=True),
        EvItem.service.icontains(query, autoescape=True),
        EvItem.summary.icontains(query, autoescape=True),
    ]
    number = NUMBER.match(query)
    if number:
        conditions.append(
            and_(EvItem.year == int(number.group(1)), EvItem.sequence == int(number.group(2)))
        )
    rows = db.execute(
        select(EvItem, WorkflowInstance)
        .join(WorkflowInstance, WorkflowInstance.id == EvItem.workflow_instance_id)
        .where(visibility(user), or_(*conditions))
        .order_by(WorkflowInstance.finished, EvItem.id.desc())
        .limit(MAX_ITEMS)
    ).all()
    flow = evergreen_workflow()
    return [
        SearchHit(
            module=MODULE,
            kind="Vorgang",
            title=item.title,
            subtitle=f"{item.number} · {flow.title_of(instance.step)}",
            link=f"/evergreen/{item.id}",
        )
        for item, instance in rows
    ]
