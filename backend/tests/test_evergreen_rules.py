"""Regeln für Meldungen des Nachrichtencenters (spec.md 8.1, 8.4), ohne Datenbank."""

from werkbank.modules.evergreen.rules import (
    info_only,
    kind_label,
    parse_phases,
    schedule_text,
    split_sections,
    suggest_affected,
)

MESSAGE = "\n".join(
    [
        "Updated November 20, 2026: We have updated the timeline below.",
        "[What and why:]",
        "Teams can summarize meetings without a recording.",
        "[When this will happen:]",
        "Targeted Release: We will begin rolling out early January 2027 and expect to "
        "complete by late January 2027.",
        "General Availability (Worldwide): We will begin rolling out late January 2027 and "
        "expect to complete by late February 2027.",
        "[How this affects your organization:]",
        "Users see a new button.",
        "What you need to do to prepare: Review the meeting policy.",
    ]
)


def test_sections_split_at_known_heads() -> None:
    sections = split_sections(MESSAGE)
    assert [s["head"] for s in sections] == [
        None,
        "What and why",
        "When this will happen",
        "How this affects your organization",
        "What you need to do to prepare",
    ]
    assert sections[0]["text"].startswith("Updated November 20, 2026")
    assert sections[4]["text"] == "Review the meeting policy."
    schedule = schedule_text(sections)
    assert schedule is not None and schedule.startswith("Targeted Release:")


def test_message_without_heads_stays_whole() -> None:
    assert split_sections("Nur ein Absatz.\nNoch einer.") == [
        {"head": None, "text": "Nur ein Absatz.\nNoch einer."}
    ]
    assert split_sections(None) == []
    assert schedule_text(split_sections("Kein Zeitplan")) is None


def test_phases_from_schedule() -> None:
    phases = parse_phases(schedule_text(split_sections(MESSAGE)))
    assert phases == [
        {"name": "Targeted Release", "start": "2027-01", "end": "2027-01"},
        {"name": "Allgemein verfügbar (weltweit)", "start": "2027-01", "end": "2027-02"},
    ]


def test_phases_edge_cases() -> None:
    assert parse_phases(None) == []
    assert parse_phases("No timeline yet.") == []
    # ohne Namen: eine Phase „Rollout“
    assert parse_phases("Rollout begins March 3, 2027 and completes in mid-April 2027.") == [
        {"name": "Rollout", "start": "2027-03", "end": "2027-04"}
    ]
    assert parse_phases("Public Preview: May 2027") == [
        {"name": "Vorschau", "start": "2027-05", "end": "2027-05"}
    ]
    many = "\n".join(f"Phase {i}: June 2027" for i in range(10))
    assert len(parse_phases(many)) == 6


def test_kind_affected_and_info() -> None:
    assert kind_label(["Retirement", "Admin impact"], "planForChange") == "Abkündigung"
    assert kind_label(["New feature"], "stayInformed") == "Neue Funktion"
    assert kind_label(["Feature update"], None) == "Funktionsupdate"
    assert kind_label([], "planForChange") == "Änderung"
    assert kind_label([], None) is None
    assert suggest_affected(["User impact", "Admin impact"]) == "Nutzer und Admins"
    assert suggest_affected(["admin impact"]) == "Admins"
    assert suggest_affected(None) is None
    assert info_only([], "stayInformed") is True
    assert info_only(["User impact"], "stayInformed") is False
    assert info_only([], "planForChange") is False


def test_evergreen_models_load_on_their_own() -> None:
    """Der Verweis auf die verknüpfte Einstellung braucht die Tabelle der M365-Konfiguration,
    auch wenn nur Evergreen geladen ist (Worker)."""
    import subprocess
    import sys

    code = (
        "import werkbank.core.models;"
        "import werkbank.modules.evergreen.models;"
        "from werkbank.db import Base;"
        "assert 'cfg_settings' in Base.metadata.tables;"
        "Base.metadata.sorted_tables"
    )
    result = subprocess.run(  # noqa: S603 - fester Code, keine Eingabe von außen
        [sys.executable, "-c", code], capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr


ROLLOUT_SCHEDULE = "\n".join(
    [
        "[Introduction]",
        "Free/Busy, MailTips and calendar sharing work across organizations.",
        "Rollout Schedule",
        "Worldwide: We will begin rolling out in August 2026 and expect to complete by "
        "September 15, 2026 for Free/Busy, Mailtips and December 4, 2026 (previously "
        "November 23) for Calendar Sharing.",
        "",
        "GCC, GCC High, DoD: We will communicate via Message center when we are ready to proceed.",
        "[How this affects your organization]",
        "Nothing to do.",
    ]
)


def test_phases_under_rollout_schedule() -> None:
    sections = split_sections(ROLLOUT_SCHEDULE)
    assert "Rollout Schedule" in [s["head"] for s in sections]
    assert parse_phases(schedule_text(sections)) == [
        {"name": "Weltweit", "start": "2026-08", "end": "2026-12"},
    ]


def test_previous_dates_do_not_count() -> None:
    line = "Worldwide: Complete by December 4, 2026 (previously January 23, 2027)."
    assert parse_phases(line) == [{"name": "Weltweit", "start": "2026-12", "end": "2026-12"}]


def test_phase_lines_without_schedule_head() -> None:
    text = "\n".join(
        [
            "[What is changing]",
            "A new option.",
            "Targeted Release: early March 2027 to late March 2027.",
            "General Availability (Worldwide): April 2027 to May 2027.",
            "Note: this is not a date line in 2027.",
        ]
    )
    assert parse_phases(schedule_text(split_sections(text))) == [
        {"name": "Targeted Release", "start": "2027-03", "end": "2027-03"},
        {"name": "Allgemein verfügbar (weltweit)", "start": "2027-04", "end": "2027-05"},
    ]
