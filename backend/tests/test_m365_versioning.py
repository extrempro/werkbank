from typing import Any

import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from werkbank.modules.m365_config.models import (
    CfgChange,
    CfgSetting,
    CfgSettingVersion,
    CfgSnapshot,
    ChangeKind,
    ChangeStatus,
    SnapshotStatus,
)
from werkbank.modules.m365_config.normalize import (
    SettingValue,
    normalize_object,
    setting_path,
    strip_ignored,
)
from werkbank.modules.m365_config.versioning import apply_snapshot, same_value

SOURCE = "test:richtlinien"
OTHER = "test:andere"


def policy(object_id: str, name: str, **properties: Any) -> list[SettingValue]:
    return normalize_object(
        workload="entra",
        area="conditionalAccessPolicy",
        object_id=object_id,
        object_name=name,
        properties=properties,
        source=SOURCE,
    )


# --- ohne Datenbank -------------------------------------------------------------------


def test_path_schema_and_slashes() -> None:
    assert setting_path("entra", "bereich", "id-1", "state") == "entra/bereich/id-1/state"
    assert setting_path("entra", "a/b", "id", "x") == "entra/a_b/id/x"
    with pytest.raises(ValueError, match="zu lang"):
        setting_path("entra", "bereich", "x" * 2000, "state")


def test_ignored_fields_are_removed_on_all_levels() -> None:
    value = {
        "state": "enabled",
        "lastModifiedDateTime": "2026-01-01",
        "conditions": {"whenChanged": "x", "users": [{"id": 1, "@odata.etag": "e"}]},
    }
    assert strip_ignored(value, {"lastModifiedDateTime", "whenChanged", "@odata.etag"}) == {
        "state": "enabled",
        "conditions": {"users": [{"id": 1}]},
    }


def test_normalize_object_one_setting_per_property() -> None:
    items = policy("p1", "MFA für alle", state="enabled", modifiedDateTime="2026-01-01")
    assert [item.path for item in items] == ["entra/conditionalAccessPolicy/p1/state"]
    assert items[0].object_name == "MFA für alle"
    assert items[0].value == "enabled"


def test_same_value_ignores_key_order_but_not_list_order() -> None:
    assert same_value({"a": 1, "b": [1, 2]}, {"b": [1, 2], "a": 1})
    assert not same_value([1, 2], [2, 1])
    assert not same_value(None, "null")


# --- mit Datenbank --------------------------------------------------------------------


@pytest.fixture
def db(db_session: Session) -> Session:
    """Leerer Bestand für jeden Test."""
    for table in (CfgChange, CfgSettingVersion, CfgSetting, CfgSnapshot):
        db_session.execute(delete(table))
    db_session.commit()
    return db_session


def changes(db: Session) -> list[CfgChange]:
    return list(db.scalars(select(CfgChange).order_by(CfgChange.id)).all())


@pytest.mark.db
def test_first_snapshot_is_baseline_without_changes(db: Session) -> None:
    result = apply_snapshot(
        db, policy("p1", "MFA", state="enabled", grant={"mfa": True}), {SOURCE: True}
    )
    db.commit()
    assert result.status == SnapshotStatus.OK
    assert (result.baseline, result.changes) == (2, 0)
    assert changes(db) == []
    versions = db.scalars(select(CfgSettingVersion)).all()
    assert len(versions) == 2
    assert all(version.valid_to is None for version in versions)


@pytest.mark.db
def test_unchanged_value_creates_no_new_version(db: Session) -> None:
    apply_snapshot(db, policy("p1", "MFA", grant={"a": 1, "b": 2}), {SOURCE: True})
    result = apply_snapshot(db, policy("p1", "MFA", grant={"b": 2, "a": 1}), {SOURCE: True})
    db.commit()
    assert result.changes == 0
    assert len(db.scalars(select(CfgSettingVersion)).all()) == 1


@pytest.mark.db
def test_changed_new_and_removed_are_detected(db: Session) -> None:
    apply_snapshot(
        db,
        policy("p1", "MFA", state="enabled") + policy("p2", "Alt", state="enabled"),
        {SOURCE: True},
    )
    result = apply_snapshot(
        db,
        policy("p1", "MFA umbenannt", state="disabled") + policy("p3", "Neu", state="enabled"),
        {SOURCE: True},
    )
    db.commit()
    assert (result.changed, result.new, result.removed) == (1, 1, 1)

    by_kind = {change.kind: change for change in changes(db)}
    assert set(by_kind) == {ChangeKind.CHANGED, ChangeKind.NEW, ChangeKind.REMOVED}
    assert by_kind[ChangeKind.CHANGED].old_value == "enabled"
    assert by_kind[ChangeKind.CHANGED].new_value == "disabled"
    assert by_kind[ChangeKind.NEW].old_value is None
    assert by_kind[ChangeKind.REMOVED].new_value is None
    assert all(change.status == ChangeStatus.OPEN for change in by_kind.values())

    p1 = db.execute(select(CfgSetting).where(CfgSetting.object_id == "p1")).scalar_one()
    assert p1.object_name == "MFA umbenannt"
    history = db.scalars(
        select(CfgSettingVersion)
        .where(CfgSettingVersion.setting_id == p1.id)
        .order_by(CfgSettingVersion.id)
    ).all()
    assert [version.value for version in history] == ["enabled", "disabled"]
    assert history[0].valid_to is not None and history[1].valid_to is None

    p2 = db.execute(select(CfgSetting).where(CfgSetting.object_id == "p2")).scalar_one()
    assert p2.active is False
    snapshot = db.get(CfgSnapshot, result.snapshot_id)
    assert snapshot is not None and snapshot.change_count == 3


@pytest.mark.db
def test_failed_source_does_not_mark_settings_removed(db: Session) -> None:
    apply_snapshot(db, policy("p1", "MFA", state="enabled"), {SOURCE: True})
    result = apply_snapshot(db, [], {SOURCE: False})
    db.commit()
    assert result.status == SnapshotStatus.FAILED
    assert result.changes == 0
    setting = db.execute(select(CfgSetting)).scalar_one()
    assert setting.active is True


@pytest.mark.db
def test_partial_snapshot_only_touches_ok_sources(db: Session) -> None:
    other = normalize_object(
        workload="exchange",
        area="transportRule",
        object_id="r1",
        object_name="Regel",
        properties={"enabled": True},
        source=OTHER,
    )
    apply_snapshot(db, policy("p1", "MFA", state="enabled") + other, {SOURCE: True, OTHER: True})
    result = apply_snapshot(db, policy("p1", "MFA", state="disabled"), {SOURCE: True, OTHER: False})
    db.commit()
    assert result.status == SnapshotStatus.PARTIAL
    assert (result.changed, result.removed) == (1, 0)


@pytest.mark.db
def test_removed_setting_that_returns_is_new_again(db: Session) -> None:
    apply_snapshot(db, policy("p1", "MFA", state="enabled"), {SOURCE: True})
    apply_snapshot(db, policy("p9", "Platzhalter", state="x"), {SOURCE: True})
    result = apply_snapshot(
        db,
        policy("p1", "MFA", state="enabled") + policy("p9", "Platzhalter", state="x"),
        {SOURCE: True},
    )
    db.commit()
    assert (result.new, result.changed, result.removed) == (1, 0, 0)
    setting = db.execute(select(CfgSetting).where(CfgSetting.object_id == "p1")).scalar_one()
    assert setting.active is True
    open_versions = db.scalars(
        select(CfgSettingVersion).where(
            CfgSettingVersion.setting_id == setting.id, CfgSettingVersion.valid_to.is_(None)
        )
    ).all()
    assert len(open_versions) == 1


@pytest.mark.db
def test_json_null_is_a_value(db: Session) -> None:
    apply_snapshot(db, policy("p1", "MFA", sessionControls=None), {SOURCE: True})
    result = apply_snapshot(db, policy("p1", "MFA", sessionControls={"signIn": 1}), {SOURCE: True})
    db.commit()
    assert result.changed == 1
    change = changes(db)[0]
    assert change.old_value is None
    assert change.new_value == {"signIn": 1}


@pytest.mark.db
def test_new_source_later_is_its_own_baseline(db: Session) -> None:
    apply_snapshot(db, policy("p1", "MFA", state="enabled"), {SOURCE: True})
    other = normalize_object(
        workload="exchange",
        area="transportRule",
        object_id="r1",
        object_name="Regel",
        properties={"enabled": True},
        source=OTHER,
    )
    result = apply_snapshot(
        db, policy("p1", "MFA", state="enabled") + other, {SOURCE: True, OTHER: True}
    )
    db.commit()
    assert (result.baseline, result.changes) == (1, 0)
