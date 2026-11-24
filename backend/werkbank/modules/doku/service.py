"""Abläufe der Dokumentation: Speichern, Versionen, Papierkorb, Einstellungen."""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Literal

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from werkbank.core.app_settings import get_setting, set_setting
from werkbank.core.sessions import now_utc
from werkbank.modules.doku.models import DokuPage, DokuVersion

SETTINGS_KEY = "doku"
VERSION_MINUTES = (5, 10, 30)
TRASH_DAYS = 30
EDITORS_MAX = 500


@dataclass
class DokuSettings:
    # Automatische Version nach so vielen Minuten Bearbeitung
    version_minutes: int = 10
    # Automatische Versionen aufbewahren: 1 Jahr oder immer (benannte bleiben immer)
    keep_auto: Literal["1y", "immer"] = "1y"


def load_settings(db: Session) -> DokuSettings:
    raw = get_setting(db, SETTINGS_KEY, {}) or {}
    minutes = raw.get("version_minutes") if isinstance(raw, dict) else None
    keep = raw.get("keep_auto") if isinstance(raw, dict) else None
    return DokuSettings(
        version_minutes=minutes if minutes in VERSION_MINUTES else 10,
        keep_auto="immer" if keep == "immer" else "1y",
    )


def save_settings(db: Session, value: DokuSettings, user_id: uuid.UUID | None) -> None:
    set_setting(
        db,
        SETTINGS_KEY,
        {"version_minutes": value.version_minutes, "keep_auto": value.keep_auto},
        user_id,
    )


def _add_editor(page: DokuPage, name: str) -> None:
    names = [n for n in page.editors.split(", ") if n]
    if name and name not in names:
        names.append(name)
    page.editors = ", ".join(names)[:EDITORS_MAX]


def snapshot(
    db: Session, page: DokuPage, *, name: str = "", note: str = "", authors: str = ""
) -> DokuVersion:
    """Den jetzigen Stand als Version ablegen; danach beginnt die Bearbeitungszeit neu."""
    version = DokuVersion(
        page_id=page.id,
        title=page.title,
        content=page.content,
        name=name,
        note=note,
        authors=(authors or page.editors or page.updated_by_name)[:EDITORS_MAX],
    )
    db.add(version)
    page.editing_since = None
    page.editors = ""
    return version


def record_edit(
    db: Session, page: DokuPage, editor: str, settings: DokuSettings, now: datetime | None = None
) -> None:
    """Nach dem Speichern: Bearbeitung merken, nach der eingestellten Zeit eine Version."""
    now = now or now_utc()
    page.updated_at = now
    page.updated_by_name = editor
    page.revision += 1
    _add_editor(page, editor)
    if page.editing_since is None:
        page.editing_since = now
    elif now - page.editing_since >= timedelta(minutes=settings.version_minutes):
        snapshot(db, page)


def flush_versions(db: Session, now: datetime | None = None) -> int:
    """Auftrag: Seiten, an denen länger als eingestellt nicht mehr gespeichert wurde, bekommen
    ihre Version (sonst fehlte der letzte Stand, bis jemand weiterschreibt)."""
    now = now or now_utc()
    settings = load_settings(db)
    limit = now - timedelta(minutes=settings.version_minutes)
    pages = db.scalars(
        select(DokuPage).where(
            DokuPage.editing_since.is_not(None),
            DokuPage.editing_since <= limit,
            DokuPage.deleted_at.is_(None),
        )
    ).all()
    for page in pages:
        snapshot(db, page)
    db.commit()
    return len(pages)


def subtree(db: Session, root: DokuPage, *, deleted_at: datetime | None = None) -> list[DokuPage]:
    """Seite mit allen Unterseiten (im Papierkorb: nur die zusammen gelöschten)."""
    pages = list(
        db.scalars(
            select(DokuPage).where(
                DokuPage.space_id == root.space_id,
                DokuPage.deleted_at.is_(None)
                if deleted_at is None
                else DokuPage.deleted_at == deleted_at,
            )
        )
    )
    children: dict[uuid.UUID | None, list[DokuPage]] = {}
    for page in pages:
        children.setdefault(page.parent_id, []).append(page)
    result = [root]
    index = 0
    while index < len(result):
        result.extend(children.get(result[index].id, []))
        index += 1
    return result


def trash(db: Session, page: DokuPage, name: str) -> int:
    """In den Papierkorb, mit allen Unterseiten."""
    now = now_utc()
    pages = subtree(db, page)
    for entry in pages:
        entry.deleted_at = now
        entry.deleted_by_name = name
        entry.deleted_root = entry.id == page.id
    return len(pages)


def restore(db: Session, page: DokuPage) -> int:
    """Aus dem Papierkorb zurück; fehlt die Seite darüber, kommt sie nach oben."""
    if page.deleted_at is None:
        return 0
    pages = subtree(db, page, deleted_at=page.deleted_at)
    parent = db.get(DokuPage, page.parent_id) if page.parent_id else None
    if parent is None or parent.deleted_at is not None:
        page.parent_id = None
    page.position = next_position(db, page.space_id, page.parent_id)
    for entry in pages:
        entry.deleted_at = None
        entry.deleted_by_name = ""
        entry.deleted_root = False
    return len(pages)


def next_position(db: Session, space_id: int, parent_id: uuid.UUID | None) -> int:
    query = select(func.max(DokuPage.position)).where(
        DokuPage.space_id == space_id, DokuPage.deleted_at.is_(None)
    )
    query = query.where(
        DokuPage.parent_id.is_(None) if parent_id is None else DokuPage.parent_id == parent_id
    )
    current = db.scalar(query)
    return (current or 0) + 1


def cleanup(db: Session, now: datetime | None = None) -> dict[str, int]:
    """Nachts: Papierkorb nach 30 Tagen leeren; automatische Versionen nach der Frist löschen,
    die jüngste je Tag und alle benannten bleiben."""
    now = now or now_utc()
    removed_result = db.execute(
        delete(DokuPage).where(
            DokuPage.deleted_root.is_(True),
            DokuPage.deleted_at <= now - timedelta(days=TRASH_DAYS),
        )
    )
    removed = int(getattr(removed_result, "rowcount", 0) or 0)
    versions = 0
    if load_settings(db).keep_auto == "1y":
        limit = now - timedelta(days=365)
        old = db.execute(
            select(DokuVersion.id, DokuVersion.page_id, DokuVersion.created_at).where(
                DokuVersion.name == "", DokuVersion.created_at < limit
            )
        ).all()
        newest: dict[tuple[uuid.UUID, Any], tuple[datetime, int]] = {}
        for version_id, page_id, created in old:
            key = (page_id, created.date())
            if key not in newest or created > newest[key][0]:
                newest[key] = (created, version_id)
        keep = {version_id for _, version_id in newest.values()}
        drop = [version_id for version_id, _, _ in old if version_id not in keep]
        if drop:
            result = db.execute(delete(DokuVersion).where(DokuVersion.id.in_(drop)))
            versions = int(getattr(result, "rowcount", 0) or 0)
    db.commit()
    return {"seiten": removed, "versionen": versions}
