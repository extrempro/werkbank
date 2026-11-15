"""Suche im Modul M365-Konfiguration: Einstellungen und erkannte Änderungen."""

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from werkbank.core.roles import Role
from werkbank.core.search import SearchHit
from werkbank.core.sessions import CurrentUser
from werkbank.modules.m365_config.models import CfgChange, CfgSetting, CfgSettingMeta

MODULE = "M365-Konfiguration"
MAX_SETTINGS = 8
MAX_CHANGES = 5

KIND_LABELS = {"neu": "Neu", "geaendert": "Geändert", "entfernt": "Entfernt"}


def _title(setting: CfgSetting) -> str:
    if setting.object_name:
        return f"{setting.object_name}: {setting.property}"
    return str(setting.property)


def m365_config_search(db: Session, user: CurrentUser, query: str) -> list[SearchHit]:
    """Nur für Personen mit Lese- oder Prüfrolle; dieselben Rechte wie die Seiten des Moduls."""
    if not user.has_any_role(Role.CONFIG_READER, Role.CONFIG_REVIEWER):
        return []

    settings = db.execute(
        select(CfgSetting)
        .outerjoin(CfgSettingMeta, CfgSettingMeta.setting_id == CfgSetting.id)
        .where(
            or_(
                CfgSetting.path.icontains(query, autoescape=True),
                CfgSetting.object_name.icontains(query, autoescape=True),
                CfgSettingMeta.description.icontains(query, autoescape=True),
                CfgSettingMeta.reasoning.icontains(query, autoescape=True),
            )
        )
        .order_by(CfgSetting.active.desc(), CfgSetting.path)
        .limit(MAX_SETTINGS)
    ).scalars()
    hits = [
        SearchHit(
            module=MODULE,
            kind="Einstellung" if setting.active else "Einstellung (entfernt)",
            title=_title(setting),
            subtitle=setting.path,
            link=f"/m365/einstellungen/{setting.id}",
        )
        for setting in settings
    ]

    changes = db.execute(
        select(CfgChange, CfgSetting)
        .join(CfgSetting, CfgSetting.id == CfgChange.setting_id)
        .where(
            or_(
                CfgChange.changed_by.icontains(query, autoescape=True),
                CfgChange.comment.icontains(query, autoescape=True),
            )
        )
        .order_by(CfgChange.id.desc())
        .limit(MAX_CHANGES)
    ).all()
    for change, setting in changes:
        when = change.detected_at.date().isoformat()
        who = change.changed_by or "unbekannt"
        hits.append(
            SearchHit(
                module=MODULE,
                kind="Änderung",
                title=_title(setting),
                subtitle=f"{KIND_LABELS.get(change.kind, change.kind)} am {when} von {who}",
                link=f"/m365/einstellungen/{setting.id}",
            )
        )
    return hits
