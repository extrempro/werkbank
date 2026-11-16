"""Zerlegt Objekte aus dem Tenant in einzelne Einstellungen (spec.md 7.2)."""

from collections.abc import Collection, Mapping
from dataclasses import dataclass
from typing import Any

# Felder, die sich ohne fachliche Änderung ändern und deshalb nie verglichen werden
DEFAULT_IGNORED_FIELDS: frozenset[str] = frozenset(
    {
        "@odata.context",
        "@odata.etag",
        "lastModifiedDateTime",
        "modifiedDateTime",
        "whenChanged",
        "whenChangedUTC",
    }
)

PATH_MAX_LENGTH = 1024


@dataclass(frozen=True)
class SettingValue:
    """Eine Einstellung mit ihrem aktuellen Wert, wie sie ein Abruf liefert."""

    path: str
    workload: str
    area: str
    object_id: str
    object_name: str | None
    property: str
    source: str
    value: Any


def _segment(value: str) -> str:
    """Pfadteil ohne Schrägstrich, damit der Pfad eindeutig zerlegbar bleibt."""
    return value.strip().replace("/", "_")


def setting_path(workload: str, area: str, object_id: str, prop: str) -> str:
    """Pfad nach dem Schema <workload>/<bereich>/<objekt>/<eigenschaft>."""
    path = "/".join(_segment(part) for part in (workload, area, object_id, prop))
    if len(path) > PATH_MAX_LENGTH:
        raise ValueError("Pfad der Einstellung ist zu lang")
    return path


def strip_ignored(value: Any, ignored: Collection[str]) -> Any:
    """Entfernt ignorierte Felder auf allen Ebenen."""
    if isinstance(value, Mapping):
        return {
            key: strip_ignored(item, ignored) for key, item in value.items() if key not in ignored
        }
    if isinstance(value, list):
        return [strip_ignored(item, ignored) for item in value]
    return value


def _scalar(value: Any) -> bool:
    return isinstance(value, str | int | float | bool)


def canonical(value: Any) -> Any:
    """Einheitliche Form eines Werts für Vergleich und Speicherung.

    Listen, die nur einfache Werte enthalten (Texte, Zahlen, Wahrheitswerte), werden sortiert:
    Die Quelle liefert sie in wechselnder Reihenfolge, gemeint ist eine Menge. Listen mit
    Objekten bleiben, wie sie sind, weil dort die Reihenfolge etwas bedeuten kann.
    """
    if isinstance(value, Mapping):
        return {key: canonical(item) for key, item in value.items()}
    if isinstance(value, list):
        items = [canonical(item) for item in value]
        if items and all(_scalar(item) for item in items):
            # Erst nach Art, dann nach Wert: Texte und Zahlen lassen sich nicht vergleichen.
            return sorted(items, key=lambda item: (type(item).__name__, item))
        return items
    return value


def normalize_object(
    *,
    workload: str,
    area: str,
    object_id: str,
    object_name: str | None,
    properties: Mapping[str, Any],
    source: str,
    ignored: Collection[str] = DEFAULT_IGNORED_FIELDS,
) -> list[SettingValue]:
    """Macht aus einem Objekt (z. B. einer Richtlinie) je Eigenschaft eine Einstellung.

    Das Objekt wird über seine stabile ID adressiert, der Anzeigename wird getrennt geführt.
    Verschachtelte Werte bleiben als JSON-Wert der Eigenschaft erhalten.
    """
    return [
        SettingValue(
            path=setting_path(workload, area, object_id, key),
            workload=workload,
            area=area,
            object_id=object_id,
            object_name=object_name,
            property=key,
            source=source,
            value=canonical(strip_ignored(value, ignored)),
        )
        for key, value in properties.items()
        if key not in ignored
    ]
