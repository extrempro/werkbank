"""Geplante Umsetzung und Soll/Ist-Abgleich (spec.md 8.4 und 8.5).

Der Schritt „Umsetzung“ schließt nicht von Hand, sondern sobald alle Soll-Werte erfüllt sind:
Bei überwachten Einstellungen meldet das der Abruf aus dem Tenant, bei allen anderen
bestätigt die IT die Umsetzung je Eintrag.
"""

import logging
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from werkbank.core.models import WorkflowInstance
from werkbank.core.sessions import now_utc
from werkbank.core.workflow import perform_automatic
from werkbank.modules.evergreen.models import EvItem, EvPlan
from werkbank.modules.evergreen.workflow import evergreen_workflow
from werkbank.modules.m365_config.models import (
    CfgSetting,
    CfgSettingMeta,
    CfgSettingMetaHistory,
    CfgSettingVersion,
)
from werkbank.modules.m365_config.versioning import same_value

logger = logging.getLogger(__name__)

IMPLEMENTATION_STEP = "umsetzung"
COMPLETE_ACTION = "soll_ist_erfuellt"
TARGET_FIELD = "soll_wert"


class PlanStatus(StrEnum):
    FULFILLED = "erfuellt"
    OPEN = "offen"
    CONFIRMED = "bestaetigt"
    UNCONFIRMED = "unbestaetigt"


DONE = (PlanStatus.FULFILLED, PlanStatus.CONFIRMED)


@dataclass(frozen=True)
class PlanRow:
    entry: EvPlan
    setting: CfgSetting | None
    version: CfgSettingVersion | None

    @property
    def status(self) -> PlanStatus:
        if self.entry.setting_id is None or self.setting is None:
            return PlanStatus.CONFIRMED if self.entry.confirmed_at else PlanStatus.UNCONFIRMED
        matches = (
            self.setting.active
            and self.version is not None
            and same_value(self.version.value, self.entry.target_value)
        )
        return PlanStatus.FULFILLED if matches else PlanStatus.OPEN


def load_plan(db: Session, item_id: int) -> list[PlanRow]:
    """Einträge der geplanten Umsetzung mit Einstellung und aktuellem Wert."""
    rows = db.execute(
        select(EvPlan, CfgSetting, CfgSettingVersion)
        .outerjoin(CfgSetting, CfgSetting.id == EvPlan.setting_id)
        .outerjoin(
            CfgSettingVersion,
            and_(
                CfgSettingVersion.setting_id == CfgSetting.id,
                CfgSettingVersion.valid_to.is_(None),
            ),
        )
        .where(EvPlan.item_id == item_id)
        .order_by(EvPlan.id)
    ).all()
    return [PlanRow(entry=row[0], setting=row[1], version=row[2]) for row in rows]


def apply_target(db: Session, item: EvItem, entry: EvPlan, *, provisional: bool) -> None:
    """Hinterlegt den Soll-Wert dauerhaft an der Einstellung (M365-Konfiguration, spec.md 7.6)."""
    if entry.setting_id is None:
        return
    source = f"Evergreen {item.number}"
    if provisional:
        source += " (vorläufig bis Beschluss)"
    meta = db.get(CfgSettingMeta, entry.setting_id)
    if meta is None:
        meta = CfgSettingMeta(setting_id=entry.setting_id, target_set=False, target_value=None)
        db.add(meta)
    before: dict[str, Any] | None = {"wert": meta.target_value} if meta.target_set else None
    after = {"wert": entry.target_value}
    if before is None or not same_value(before, after):
        db.add(
            CfgSettingMetaHistory(
                setting_id=entry.setting_id,
                field=TARGET_FIELD,
                old_value=before,
                new_value=after,
                user_id=None,
                changed_at=now_utc(),
            )
        )
    meta.target_set = True
    meta.target_value = entry.target_value
    meta.target_source = source[:64]


def evaluate(db: Session, item: EvItem, instance: WorkflowInstance) -> bool:
    """Schließt die Umsetzung, wenn alles erfüllt ist. Der Aufrufer entscheidet über das Commit.

    Ohne geplante Umsetzung schließt der Schritt nur, wenn der Vorgang als „nicht steuerbar“
    gekennzeichnet ist: Dann gibt es nichts umzusetzen.
    """
    if instance.finished or instance.step != IMPLEMENTATION_STEP:
        return False
    rows = load_plan(db, item.id)
    if not rows:
        if not item.not_controllable:
            return False
        comment = "Nicht steuerbar: keine Umsetzung nötig"
    elif all(row.status in DONE for row in rows):
        comment = "Alle Soll-Werte sind umgesetzt"
    else:
        return False
    event = perform_automatic(
        db, evergreen_workflow(), instance.id, COMPLETE_ACTION, comment=comment
    )
    if event is None:
        return False
    for row in rows:
        apply_target(db, item, row.entry, provisional=False)
    return True


def check_open_items(db: Session) -> int:
    """Prüft alle Vorgänge im Schritt „Umsetzung“. Liefert, wie viele abgeschlossen wurden."""
    rows = db.execute(
        select(EvItem, WorkflowInstance)
        .join(WorkflowInstance, WorkflowInstance.id == EvItem.workflow_instance_id)
        .where(WorkflowInstance.step == IMPLEMENTATION_STEP, ~WorkflowInstance.finished)
    ).all()
    closed = 0
    for item, instance in rows:
        if evaluate(db, item, instance):
            closed += 1
            logger.info("Vorgang %s: Umsetzung abgeschlossen", item.number)
    db.commit()
    return closed
