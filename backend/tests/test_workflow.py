import uuid
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from werkbank.core.models import AuditLog, User, WorkflowEvent, WorkflowInstance
from werkbank.core.sessions import CurrentUser, now_utc
from werkbank.core.workflow import (
    WorkflowDefinitionError,
    WorkflowError,
    available_actions,
    load_workflow,
    parse_workflow,
    perform_action,
    perform_automatic,
    start_workflow,
)

# Beispiel-Ablauf (früher der Ablauf von Evergreen); die Engine nutzt derzeit kein Bereich
FLOW = load_workflow(Path(__file__).with_name("fixtures") / "workflow_beispiel.yaml")


def minimal(**overrides: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "workflow": "test",
        "start": "a",
        "endzustaende": {"fertig": "Fertig"},
        "schritte": [
            {
                "id": "a",
                "titel": "A",
                "rollen": ["Evergreen.Editor"],
                "aktionen": [{"id": "weiter", "titel": "Weiter", "ziel": "fertig"}],
            }
        ],
    }
    data.update(overrides)
    return data


def person(*roles: str, user_id: uuid.UUID | None = None) -> CurrentUser:
    return CurrentUser(
        user_id=user_id or uuid.uuid4(),
        session_id=uuid.uuid4(),
        display_name="Test",
        email=None,
        roles=tuple(roles),
        authenticated_at=now_utc(),
        expires_at=now_utc(),
    )


# --- ohne Datenbank -------------------------------------------------------------------


def test_example_workflow_loads() -> None:
    assert FLOW.name == "evergreen"
    assert FLOW.start == "it_bewertung"
    assert list(FLOW.steps) == [
        "it_bewertung",
        "fachabteilungen",
        "vorlage_br",
        "betriebsrat",
        "geschaeftsfuehrung",
        "umsetzung",
    ]
    assert set(FLOW.end_states) == {"abgeschlossen", "ohne_vorlage_abgeschlossen", "abgelehnt"}
    br = FLOW.steps["betriebsrat"]
    assert br.roles == ("Evergreen.Reader",)
    assert br.on_behalf_roles == ("Projekte.Editor", "Evergreen.Editor")
    required = {
        (step.id, action.id)
        for step in FLOW.steps.values()
        for action in step.actions
        if action.comment_required
    }
    assert required == {
        ("it_bewertung", "nicht_pflichtig"),
        ("betriebsrat", "auflagen"),
        ("betriebsrat", "ablehnen"),
        ("geschaeftsfuehrung", "zurueckgeben"),
    }
    assert FLOW.steps["geschaeftsfuehrung"].action("zurueckgeben").target == "vorlage_br"  # type: ignore[union-attr]
    assert FLOW.steps["umsetzung"].actions[0].automatic is True
    assert FLOW.title_of("abgelehnt") == "Abgelehnt"
    assert FLOW.title_of("vorlage_br") == "Vorlage BR"


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"start": "gibt_es_nicht"}, "start"),
        ({"endzustaende": {}}, "endzustaende"),
        ({"schritte": []}, "schritte"),
        ({"workflow": ""}, "workflow"),
        (
            {
                "schritte": [
                    {"id": "a", "titel": "A", "rollen": ["Evergreen.Editor"], "aktionen": []}
                ]
            },
            "Sackgasse",
        ),
        (
            {
                "schritte": [
                    {
                        "id": "a",
                        "titel": "A",
                        "rollen": ["Evergreen.Editor"],
                        "aktionen": [{"id": "x", "titel": "X", "ziel": "nirgendwo"}],
                    }
                ]
            },
            "unbekanntes Ziel",
        ),
        (
            {
                "schritte": [
                    {
                        "id": "a",
                        "titel": "A",
                        "rollen": ["Erfunden.Rolle"],
                        "aktionen": [{"id": "x", "titel": "X", "ziel": "fertig"}],
                    }
                ]
            },
            "unbekannte Rolle",
        ),
        (
            {
                "schritte": [
                    {
                        "id": "a",
                        "titel": "A",
                        "rollen": [],
                        "aktionen": [{"id": "x", "titel": "X", "ziel": "fertig"}],
                    }
                ]
            },
            "keine zuständige Rolle",
        ),
    ],
)
def test_broken_definitions_are_rejected(change: dict[str, Any], message: str) -> None:
    with pytest.raises(WorkflowDefinitionError, match=message):
        parse_workflow(minimal(**change))


def test_minimal_definition_is_valid() -> None:
    assert parse_workflow(minimal()).steps["a"].actions[0].target == "fertig"
    with pytest.raises(WorkflowDefinitionError):
        parse_workflow(["kein", "objekt"])


def test_available_actions_by_role() -> None:
    instance = WorkflowInstance(
        id=1, workflow="evergreen", object_type="t", object_id="1", step="betriebsrat"
    )
    instance.finished = False
    direct = available_actions(FLOW, instance, person("Evergreen.Reader"))
    assert [item.action.id for item in direct] == ["zustimmen", "auflagen", "ablehnen"]
    assert not any(item.on_behalf for item in direct)
    proxy = available_actions(FLOW, instance, person("Projekte.Editor"))
    assert len(proxy) == 3 and all(item.on_behalf for item in proxy)
    assert available_actions(FLOW, instance, person("Budget.Manager")) == []
    assert available_actions(FLOW, instance, person("Config.Reviewer")) == []

    instance.step = "umsetzung"
    assert available_actions(FLOW, instance, person("Evergreen.Editor")) == []
    instance.step = "abgelehnt"
    instance.finished = True
    assert available_actions(FLOW, instance, person("Evergreen.Editor")) == []


# --- mit Datenbank --------------------------------------------------------------------


@pytest.fixture
def actor(db_session: Session) -> uuid.UUID:
    """Eine Person in der Datenbank, auf die Protokolleinträge verweisen können."""
    oid = "test:workflow-person"
    user = db_session.execute(select(User).where(User.entra_oid == oid)).scalar_one_or_none()
    if user is None:
        user = User(entra_oid=oid, display_name="Wilma Workflow")
        db_session.add(user)
        db_session.commit()
    return user.id


def new_instance(db: Session) -> WorkflowInstance:
    instance = start_workflow(db, FLOW, "test", uuid.uuid4().hex)
    db.commit()
    return instance


def events(db: Session, instance: WorkflowInstance) -> list[WorkflowEvent]:
    return list(
        db.scalars(
            select(WorkflowEvent)
            .where(WorkflowEvent.instance_id == instance.id)
            .order_by(WorkflowEvent.id)
        ).all()
    )


@pytest.mark.db
def test_full_path_to_completion(db_session: Session, actor: uuid.UUID) -> None:
    db = db_session
    instance = new_instance(db)
    assert (instance.step, instance.finished) == ("it_bewertung", False)

    steps = [
        ("pflichtig", "Evergreen.Editor", None),
        ("rueckmeldungen_liegen_vor", "Projekte.Editor", None),
        ("an_br_uebergeben", "Projekte.Editor", None),
        ("auflagen", "Evergreen.Reader", "Nur für die Pilotgruppe"),
        ("abnehmen", "Budget.Manager", None),
    ]
    for action, role, comment in steps:
        perform_action(db, FLOW, instance.id, action, person(role, user_id=actor), comment=comment)
        db.commit()
    db.refresh(instance)
    assert (instance.step, instance.finished) == ("umsetzung", False)

    # Umsetzung schließt nur automatisch
    with pytest.raises(WorkflowError) as error:
        perform_action(db, FLOW, instance.id, "soll_ist_erfuellt", person("Evergreen.Editor"))
    assert error.value.code == "invalid"
    db.rollback()
    assert perform_automatic(db, FLOW, instance.id, "soll_ist_erfuellt") is not None
    db.commit()
    db.refresh(instance)
    assert (instance.step, instance.finished) == ("abgeschlossen", True)

    log = events(db, instance)
    assert [(event.step, event.action, event.target) for event in log] == [
        ("it_bewertung", "pflichtig", "fachabteilungen"),
        ("fachabteilungen", "rueckmeldungen_liegen_vor", "vorlage_br"),
        ("vorlage_br", "an_br_uebergeben", "betriebsrat"),
        ("betriebsrat", "auflagen", "geschaeftsfuehrung"),
        ("geschaeftsfuehrung", "abnehmen", "umsetzung"),
        ("umsetzung", "soll_ist_erfuellt", "abgeschlossen"),
    ]
    assert log[3].comment == "Nur für die Pilotgruppe"
    assert log[3].on_behalf_of is None
    assert log[-1].user_id is None
    audit = db.scalars(
        select(AuditLog)
        .where(AuditLog.module == "evergreen", AuditLog.object_id == instance.object_id)
        .order_by(AuditLog.id)
    ).all()
    assert len(audit) == 6
    assert audit[-1].details is not None and audit[-1].details["automatisch"] is True

    # nach dem Ende ist nichts mehr möglich
    with pytest.raises(WorkflowError) as closed:
        perform_action(db, FLOW, instance.id, "pflichtig", person("Evergreen.Editor"))
    assert closed.value.code == "conflict"
    db.rollback()
    assert perform_automatic(db, FLOW, instance.id, "soll_ist_erfuellt") is None
    db.rollback()


@pytest.mark.db
def test_rules_role_comment_and_stale_step(db_session: Session, actor: uuid.UUID) -> None:
    db = db_session
    instance = new_instance(db)

    cases: list[tuple[str, str, dict[str, Any], str]] = [
        ("pflichtig", "Budget.Manager", {}, "forbidden"),
        ("nicht_pflichtig", "Evergreen.Editor", {}, "invalid"),
        ("nicht_pflichtig", "Evergreen.Editor", {"comment": "   "}, "invalid"),
        ("nicht_pflichtig", "Evergreen.Editor", {"comment": "x" * 4001}, "invalid"),
        ("zustimmen", "Evergreen.Editor", {}, "invalid"),
        ("pflichtig", "Evergreen.Editor", {"expected_step": "betriebsrat"}, "conflict"),
    ]
    for action, role, extra, code in cases:
        with pytest.raises(WorkflowError) as error:
            perform_action(db, FLOW, instance.id, action, person(role, user_id=actor), **extra)
        assert error.value.code == code, (action, role, extra)
        db.rollback()
    with pytest.raises(WorkflowError):
        perform_action(db, FLOW, 999_999_999, "pflichtig", person("Evergreen.Editor"))
    db.rollback()
    assert events(db, instance) == []

    perform_action(
        db,
        FLOW,
        instance.id,
        "nicht_pflichtig",
        person("Evergreen.Editor", user_id=actor),
        comment="  Betrifft keine Leistungs- oder Verhaltenskontrolle  ",
        expected_step="it_bewertung",
    )
    db.commit()
    db.refresh(instance)
    assert (instance.step, instance.finished) == ("ohne_vorlage_abgeschlossen", True)
    assert events(db, instance)[0].comment == "Betrifft keine Leistungs- oder Verhaltenskontrolle"


@pytest.mark.db
def test_decision_on_behalf_and_return_from_management(
    db_session: Session, actor: uuid.UUID
) -> None:
    db = db_session
    instance = new_instance(db)
    it = person("Evergreen.Editor", user_id=actor)
    for action in ("pflichtig", "rueckmeldungen_liegen_vor", "an_br_uebergeben"):
        perform_action(db, FLOW, instance.id, action, it)
    # IT erfasst den Beschluss des Betriebsrats aus dem Sitzungsprotokoll
    event = perform_action(
        db, FLOW, instance.id, "zustimmen", it, details={"sitzung": "2026-11-10"}
    )
    assert event.on_behalf_of == "Betriebsrat"
    assert event.details == {"sitzung": "2026-11-10"}
    # Geschäftsführung gibt zurück: wieder bei der Vorlage
    perform_action(
        db,
        FLOW,
        instance.id,
        "zurueckgeben",
        person("Budget.Manager", user_id=actor),
        comment="Bitte Kosten ergänzen",
    )
    db.commit()
    db.refresh(instance)
    assert (instance.step, instance.finished) == ("vorlage_br", False)
    audit = db.scalars(
        select(AuditLog).where(
            AuditLog.action == "workflow.zustimmen", AuditLog.object_id == instance.object_id
        )
    ).one()
    assert audit.details is not None and audit.details["im_auftrag_von"] == "Betriebsrat"


@pytest.mark.db
def test_protocol_cannot_be_changed(db_session: Session, actor: uuid.UUID) -> None:
    db = db_session
    instance = new_instance(db)
    perform_action(db, FLOW, instance.id, "pflichtig", person("Evergreen.Editor", user_id=actor))
    db.commit()
    for statement in (
        update(WorkflowEvent)
        .where(WorkflowEvent.instance_id == instance.id)
        .values(comment="nachträglich"),
        delete(WorkflowEvent).where(WorkflowEvent.instance_id == instance.id),
    ):
        with pytest.raises(DBAPIError):
            db.execute(statement)
        db.rollback()
    assert len(events(db, instance)) == 1


@pytest.mark.db
def test_one_workflow_per_object(db_session: Session) -> None:
    db = db_session
    object_id = uuid.uuid4().hex
    start_workflow(db, FLOW, "test", object_id)
    db.commit()
    with pytest.raises(DBAPIError):
        start_workflow(db, FLOW, "test", object_id)
    db.rollback()
