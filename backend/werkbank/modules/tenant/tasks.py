"""Aufgaben des Moduls Tenant für die Startseite."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import warn_days
from werkbank.core.roles import Role
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.core.tasks import TaskItem
from werkbank.modules.tenant.credentials import (
    ATTENTION_LEVELS,
    LEVEL_EXPIRED,
    days_left,
    level_for,
)
from werkbank.modules.tenant.models import TenantCredential

MODULE_LABEL = "Tenant"
CREDENTIALS_LINK = "/m365/zugangsdaten"


def tenant_tasks(db: Session, user: CurrentUser, settings: Settings) -> list[TaskItem]:
    """Ablaufende und abgelaufene Zertifikate und Secrets für Personen mit Tenant.Reader."""
    if not user.has_any_role(Role.TENANT_READER):
        return []
    levels = warn_days(db)
    now = now_utc()
    dates = db.scalars(
        select(TenantCredential.expires_at).where(
            TenantCredential.active.is_(True), TenantCredential.expires_at.is_not(None)
        )
    ).all()
    found = [level_for(days_left(expires_at, now), levels) for expires_at in dates]
    expired = sum(1 for level in found if level == LEVEL_EXPIRED)
    expiring = sum(1 for level in found if level in ATTENTION_LEVELS) - expired
    tasks: list[TaskItem] = []
    if expiring:
        tasks.append(
            TaskItem(
                module=MODULE_LABEL,
                title="Zertifikate und Secrets laufen bald ab",
                subtitle=f"Ablauf in höchstens {levels[0]} Tagen: rechtzeitig erneuern",
                link=CREDENTIALS_LINK,
                count=expiring,
            )
        )
    if expired:
        tasks.append(
            TaskItem(
                module=MODULE_LABEL,
                title="Zertifikate und Secrets sind abgelaufen",
                subtitle="Erneuern oder, wenn nicht mehr gebraucht, in Entra entfernen",
                link=CREDENTIALS_LINK,
                count=expired,
            )
        )
    return tasks
