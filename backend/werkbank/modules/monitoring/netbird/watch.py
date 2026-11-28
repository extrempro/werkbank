"""Gruppen & Policies (Phase 5): überwachte Objekte per Präfix, Änderungen erkennen und melden.

Überwacht werden Gruppen, deren Name mit einem der Präfixe beginnt (Groß-/Kleinschreibung egal),
und Policies (Richtlinien), deren Name mit einem Policy-Präfix beginnt und/oder die eine
überwachte Gruppe als Quelle oder Ziel nutzen (beides einzeln schaltbar).

Bei jedem Abruf vergleicht die Werkbank die überwachten Objekte mit dem Stand des letzten Abrufs
(beide mit den aktuellen Einstellungen bewertet, damit eine geänderte Einstellung keine
Scheinänderungen erzeugt). Wer geändert hat, kommt aus dem Ereignisprotokoll; sonst „Entra
(SCIM)“ bei Gruppen aus Entra, sonst „unbekannt (per Abgleich erkannt)“.
"""

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from werkbank.modules.monitoring.netbird.policies import (
    ALL,
    DASH,
    group_name,
    ports_label,
    resource_name,
)

RETENTIONS = {"unbegrenzt": None, "3j": 3 * 365, "1j": 365, "90t": 90}
REMINDERS = (3, 7, 0)
NOTIFY_KEYS = ("policy_change", "policy_toggle", "group_change", "members_manual", "members_scim")
NOTIFY_DEFAULTS = {
    "policy_change": True,
    "policy_toggle": True,
    "group_change": True,
    "members_manual": True,
    "members_scim": False,
}
# Ereignisse dürfen etwas vor dem letzten Abruf liegen (Uhren, Verzögerung)
EVENT_SLACK = timedelta(minutes=2)
SCIM = "Entra (SCIM)"
MANUAL = ("von_hand", "Die Gruppe hat das Präfix, kommt aber nicht über SCIM.")
UNKNOWN = "unbekannt (per Abgleich erkannt)"


@dataclass(frozen=True)
class WatchSettings:
    group_prefixes: tuple[str, ...] = ()
    policy_prefixes: tuple[str, ...] = ()
    by_prefix: bool = True
    by_group: bool = True
    notify: Mapping[str, bool] = field(default_factory=lambda: dict(NOTIFY_DEFAULTS))
    critical_mail: bool = False
    retention: str = "unbegrenzt"
    reminder: int = 3
    auto_confirm: bool = True

    @property
    def active(self) -> bool:
        return bool(self.group_prefixes) or (self.by_prefix and bool(self.policy_prefixes))


def _names(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(str(item) for item in value if isinstance(item, str) and item.strip())


def load_watch(stored: Mapping[str, Any]) -> WatchSettings:
    raw = stored.get("watch")
    data = raw if isinstance(raw, Mapping) else {}
    notify_raw = data.get("notify")
    notify_data = notify_raw if isinstance(notify_raw, Mapping) else {}
    retention = str(data.get("retention") or "unbegrenzt")
    reminder = data.get("reminder")
    return WatchSettings(
        group_prefixes=_names(data.get("group_prefixes")),
        policy_prefixes=_names(data.get("policy_prefixes")),
        by_prefix=data.get("by_prefix") is not False,
        by_group=data.get("by_group") is not False,
        notify={
            key: notify_data[key] if isinstance(notify_data.get(key), bool) else default
            for key, default in NOTIFY_DEFAULTS.items()
        },
        critical_mail=data.get("critical_mail") is True,
        retention=retention if retention in RETENTIONS else "unbegrenzt",
        reminder=reminder if isinstance(reminder, int) and reminder in REMINDERS else 3,
        auto_confirm=data.get("auto_confirm") is not False,
    )


def _starts(name: str, prefixes: Iterable[str]) -> bool:
    lowered = name.casefold()
    return any(lowered.startswith(prefix.casefold()) for prefix in prefixes)


def watched_groups(data: Mapping[str, Any], watch: WatchSettings) -> dict[str, Mapping[str, Any]]:
    if not watch.group_prefixes:
        return {}
    return {
        g["id"]: g
        for g in data.get("groups") or []
        if g.get("id") and _starts(str(g.get("name") or ""), watch.group_prefixes)
    }


def _policy_groups(policy: Mapping[str, Any]) -> set[str]:
    out: set[str] = set()
    for rule in policy.get("rules") or []:
        out |= set(rule.get("sources") or []) | set(rule.get("destinations") or [])
    return out


def watched_policies(data: Mapping[str, Any], watch: WatchSettings) -> dict[str, Mapping[str, Any]]:
    groups = set(watched_groups(data, watch))
    out = {}
    for policy in data.get("policies") or []:
        name = str(policy.get("name") or "")
        by_prefix = watch.by_prefix and _starts(name, watch.policy_prefixes)
        by_group = watch.by_group and bool(_policy_groups(policy) & groups)
        if by_prefix or by_group:
            out[policy["id"]] = policy
    return out


def preview(data: Mapping[str, Any], watch: WatchSettings) -> dict[str, Any]:
    groups = watched_groups(data, watch)
    by_prefix = (
        {
            p["id"]
            for p in data.get("policies") or []
            if watch.by_prefix and _starts(str(p.get("name") or ""), watch.policy_prefixes)
        }
        if watch.policy_prefixes
        else set()
    )
    policies = watched_policies(data, watch)
    return {
        "groups": sorted(str(g.get("name") or "") for g in groups.values()),
        "policies": sorted(str(p.get("name") or "") for p in policies.values()),
        "policies_by_prefix": len(by_prefix),
        "policies_by_group": len(set(policies) - by_prefix),
        "policies_known": data.get("policies") is not None,
    }


# --- Stand eines Objekts ---------------------------------------------------------------------


def group_view(data: Mapping[str, Any], group: Mapping[str, Any]) -> dict[str, Any]:
    peers = {p["id"]: str(p.get("name") or p["id"]) for p in data.get("peers") or []}
    members = sorted(peers.get(pid, pid) for pid in group.get("peers") or [])
    return {
        "Name": str(group.get("name") or ""),
        "Herkunft": "Entra (SCIM)" if group.get("issued") == "integration" else "von Hand",
        "Mitglieder": members,
        "Ressourcen": int(group.get("resources_count") or 0),
    }


def policy_view(data: Mapping[str, Any], policy: Mapping[str, Any]) -> dict[str, Any]:
    groups = {g["id"]: g for g in data.get("groups") or [] if g.get("id")}
    checks = {p["id"]: p["name"] for p in data.get("posture_checks") or [] if p.get("id")}
    sources: list[str] = []
    destinations: list[str] = []
    ports: list[str] = []
    both = False
    for rule in policy.get("rules") or []:
        sources += [group_name(groups, gid) for gid in rule.get("sources") or []]
        if rule.get("source_resource"):
            sources.append(resource_name(data, rule["source_resource"]))
        destinations += [group_name(groups, gid) for gid in rule.get("destinations") or []]
        if rule.get("destination_resource"):
            destinations.append(resource_name(data, rule["destination_resource"]))
        ports.append(ports_label(rule))
        both = both or bool(rule.get("bidirectional"))
    return {
        "Name": str(policy.get("name") or ""),
        "Status": "aktiv" if policy.get("enabled") else "deaktiviert",
        "Quelle": sorted(dict.fromkeys(sources)),
        "Ziel": sorted(dict.fromkeys(destinations)),
        "Protokoll · Ports": " · ".join(dict.fromkeys(ports)),
        "Posture Checks": sorted(checks.get(c, c) for c in policy.get("posture_checks") or []),
        "Richtung": "beide Richtungen" if both else "eine Richtung",
    }


def _text(value: Any) -> str:
    if isinstance(value, list):
        return ", ".join(str(v) for v in value) or DASH
    if value is None or value == "":
        return DASH
    return str(value)


def compare(before: Mapping[str, Any] | None, after: Mapping[str, Any] | None) -> list[list[Any]]:
    """Vorher/Nachher je Feld: [Feld, vorher, nachher, geändert]."""
    keys = list((after or before or {}).keys())
    rows = []
    for key in keys:
        old = None if before is None else before.get(key)
        new = None if after is None else after.get(key)
        rows.append([key, _text(old), _text(new), old != new])
    return rows


# --- Erkennung --------------------------------------------------------------------------------


@dataclass
class Draft:
    kind: str
    object_id: str
    object_name: str
    action: str
    summary: str
    fields: list[list[Any]]
    category: str
    scim_group: bool = False
    flag: str = ""
    flag_text: str = ""


def _member_summary(before: Sequence[str], after: Sequence[str]) -> str:
    added = len(set(after) - set(before))
    removed = len(set(before) - set(after))
    parts = []
    if added:
        parts.append(f"{added} Mitglied{'er' if added != 1 else ''} hinzu")
    if removed:
        parts.append(f"{removed} Mitglied{'er' if removed != 1 else ''} weg")
    return ", ".join(parts) or "Ressourcen geändert"


def _foreign(data: Mapping[str, Any], policy: Mapping[str, Any], watch: WatchSettings) -> set[str]:
    """Gruppen ohne Präfix oder „All“ in einer überwachten Policy."""
    groups = {g["id"]: g for g in data.get("groups") or [] if g.get("id")}
    out = set()
    for gid in _policy_groups(policy):
        name = group_name(groups, gid)
        if name == ALL or not _starts(name, watch.group_prefixes):
            out.add(name)
    return out


def _group_drafts(
    old: Mapping[str, Any], new: Mapping[str, Any], watch: WatchSettings
) -> list[Draft]:
    before_all = {g["id"]: g for g in old.get("groups") or [] if g.get("id")}
    after_all = {g["id"]: g for g in new.get("groups") or [] if g.get("id")}
    ids = set(watched_groups(old, watch)) | set(watched_groups(new, watch))
    out: list[Draft] = []
    for gid in sorted(ids):
        prev, cur = before_all.get(gid), after_all.get(gid)
        group = cur or prev
        if group is None:
            continue
        scim = group.get("issued") == "integration"
        manual = (not scim) and _starts(str(group.get("name") or ""), watch.group_prefixes)
        flag = (
            ("von_hand", "Die Gruppe hat das Präfix, kommt aber nicht über SCIM.")
            if manual
            else ("", "")
        )
        name = str(group.get("name") or gid)
        if prev is None and cur is not None:
            view = group_view(new, cur)
            out.append(
                Draft(
                    "group",
                    gid,
                    name,
                    "angelegt",
                    "angelegt",
                    compare(None, view),
                    "group_change",
                    scim,
                    *flag,
                )
            )
            continue
        if cur is None and prev is not None:
            view = group_view(old, prev)
            out.append(
                Draft(
                    "group",
                    gid,
                    name,
                    "geloescht",
                    "gelöscht",
                    compare(view, None),
                    "group_change",
                    scim,
                    *flag,
                )
            )
            continue
        if prev is None or cur is None:
            continue
        before, after = group_view(old, prev), group_view(new, cur)
        if before["Name"] != after["Name"]:
            fields = compare({"Name": before["Name"]}, {"Name": after["Name"]})
            out.append(
                Draft(
                    "group",
                    gid,
                    name,
                    "umbenannt",
                    f"umbenannt von {before['Name']}",
                    fields,
                    "group_change",
                    scim,
                    *flag,
                )
            )
        if (
            before["Mitglieder"] != after["Mitglieder"]
            or before["Ressourcen"] != after["Ressourcen"]
        ):
            added = sorted(set(after["Mitglieder"]) - set(before["Mitglieder"]))
            removed = sorted(set(before["Mitglieder"]) - set(after["Mitglieder"]))
            fields = [
                ["Mitglieder", str(len(before["Mitglieder"])), str(len(after["Mitglieder"])), True],
                ["Neu", DASH, ", ".join(added) or DASH, bool(added)],
                ["Entfernt", ", ".join(removed) or DASH, DASH, bool(removed)],
                [
                    "Ressourcen",
                    str(before["Ressourcen"]),
                    str(after["Ressourcen"]),
                    before["Ressourcen"] != after["Ressourcen"],
                ],
            ]
            out.append(
                Draft(
                    "group",
                    gid,
                    name,
                    "mitglieder",
                    _member_summary(before["Mitglieder"], after["Mitglieder"]),
                    fields,
                    "members_scim" if scim else "members_manual",
                    scim,
                    *flag,
                )
            )
    return out


FIELD_SUMMARY = {
    "Quelle": "Quelle",
    "Ziel": "Ziel",
    "Protokoll · Ports": "Ports",
    "Posture Checks": "Posture Checks",
    "Richtung": "Richtung",
}


def _policy_drafts(
    old: Mapping[str, Any], new: Mapping[str, Any], watch: WatchSettings
) -> list[Draft]:
    if old.get("policies") is None or new.get("policies") is None:
        return []
    before_all = {p["id"]: p for p in old.get("policies") or [] if p.get("id")}
    after_all = {p["id"]: p for p in new.get("policies") or [] if p.get("id")}
    ids = set(watched_policies(old, watch)) | set(watched_policies(new, watch))
    out: list[Draft] = []
    for pid in sorted(ids):
        prev, cur = before_all.get(pid), after_all.get(pid)
        policy = cur or prev
        if policy is None:
            continue
        name = str(policy.get("name") or pid)
        flag, flag_text = "", ""
        if cur is not None and watch.group_prefixes:
            added = _foreign(new, cur, watch) - (_foreign(old, prev, watch) if prev else set())
            if added:
                flag = "fremde_gruppe"
                flag_text = (
                    f"Die überwachte Policy nutzt jetzt {', '.join(sorted(added))}, "
                    "eine Gruppe ohne Präfix oder „All“."
                )
        if prev is None and cur is not None:
            out.append(
                Draft(
                    "policy",
                    pid,
                    name,
                    "angelegt",
                    "angelegt",
                    compare(None, policy_view(new, cur)),
                    "policy_change",
                    flag=flag,
                    flag_text=flag_text,
                )
            )
            continue
        if cur is None and prev is not None:
            out.append(
                Draft(
                    "policy",
                    pid,
                    name,
                    "geloescht",
                    "gelöscht",
                    compare(policy_view(old, prev), None),
                    "policy_change",
                )
            )
            continue
        if prev is None or cur is None:
            continue
        before, after = policy_view(old, prev), policy_view(new, cur)
        if before == after:
            continue
        changed = [key for key in after if before.get(key) != after.get(key)]
        fields = compare(before, after)
        if changed == ["Status"]:
            action = "aktiviert" if after["Status"] == "aktiv" else "deaktiviert"
            out.append(
                Draft(
                    "policy",
                    pid,
                    name,
                    action,
                    action,
                    fields,
                    "policy_toggle",
                    flag=flag,
                    flag_text=flag_text,
                )
            )
            continue
        if changed == ["Name"]:
            out.append(
                Draft(
                    "policy",
                    pid,
                    name,
                    "umbenannt",
                    f"umbenannt von {before['Name']}",
                    fields,
                    "policy_change",
                    flag=flag,
                    flag_text=flag_text,
                )
            )
            continue
        labels = [FIELD_SUMMARY.get(key, key) for key in changed if key not in ("Status",)]
        summary = f"{', '.join(labels)} geändert" if labels else "geändert"
        if "Status" in changed:
            summary += " und " + ("aktiviert" if after["Status"] == "aktiv" else "deaktiviert")
        out.append(
            Draft(
                "policy",
                pid,
                name,
                "geaendert",
                summary,
                fields,
                "policy_change",
                flag=flag,
                flag_text=flag_text,
            )
        )
    return out


def detect(old: Mapping[str, Any], new: Mapping[str, Any], watch: WatchSettings) -> list[Draft]:
    if not watch.active:
        return []
    return _group_drafts(old, new, watch) + _policy_drafts(old, new, watch)


@dataclass(frozen=True)
class Who:
    name: str
    kind: str
    via: str


def who(draft: Draft, events: Sequence[Mapping[str, Any]]) -> Who:
    """Auslöser aus den Ereignissen seit dem letzten Abruf (target_id, bei Mitgliedern die
    Gruppe in den Angaben des Ereignisses)."""
    names: list[str] = []
    for event in events:
        code = str(event.get("code") or "")
        meta = event.get("meta") or {}
        if draft.kind == "policy":
            hit = event.get("target_id") == draft.object_id and code.startswith(
                ("policy.", "rule.")
            )
        elif draft.action == "mitglieder":
            hit = ".group." in code and meta.get("group_id") == draft.object_id
            hit = hit or (meta.get("group") == draft.object_name and ".group." in code)
        else:
            hit = event.get("target_id") == draft.object_id and code.startswith("group.")
        initiator = str(event.get("initiator") or "")
        if hit and initiator and initiator not in names:
            names.append(initiator)
    if names:
        return Who(", ".join(names)[:300], "person", "Abgleich, Person aus dem Ereignisprotokoll")
    if draft.scim_group:
        return Who(SCIM, "scim", "Abgleich, Gruppe kommt über SCIM aus Entra")
    return Who(UNKNOWN, "unbekannt", "Abgleich, kein passendes Ereignis")
