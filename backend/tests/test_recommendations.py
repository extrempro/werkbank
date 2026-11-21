"""Empfehlungen aus Microsoft Secure Score: Abruf, Liste, Zuordnung zu Einstellungen."""

from typing import Any

import httpx
import pytest
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_m365_api import ORIGIN, SOURCE, client_for, policy
from werkbank.config import Settings
from werkbank.core.models import AuditLog
from werkbank.modules.m365_config.models import (
    CfgChange,
    CfgRecommendation,
    CfgRecommendationLink,
    CfgSetting,
    CfgSettingVersion,
    CfgSnapshot,
)
from werkbank.modules.m365_config.secure_score import FETCH_SECURE_SCORE, fetch_secure_score
from werkbank.modules.m365_config.utcm import UtcmClient, UtcmError
from werkbank.modules.m365_config.versioning import apply_snapshot
from werkbank.worker.tasks import build_registry

BASE = "/api/m365-config"
HEADERS = {"Origin": ORIGIN}


def profile(control_id: str, **overrides: Any) -> dict[str, Any]:
    data: dict[str, Any] = {
        "id": control_id,
        "title": f"Empfehlung {control_id}",
        "controlCategory": "Identity",
        "service": "AzureAD",
        "actionType": "Config",
        "userImpact": "Low",
        "implementationCost": "Moderate",
        "rank": 5,
        "maxScore": 10.0,
        "remediation": "<p>Richtlinie <b>einschalten</b>.</p><script>alert(1)</script>",
        "actionUrl": "https://entra.microsoft.com/",
        "deprecated": False,
    }
    data.update(overrides)
    return data


class FakeGraph:
    def __init__(self, profiles: list[dict[str, Any]], scores: list[dict[str, Any]]) -> None:
        self.profiles = profiles
        self.scores = scores
        self.status = 200

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.status != 200:
            return httpx.Response(self.status, json={"error": {"code": "Forbidden"}})
        if request.url.path.endswith("/security/secureScoreControlProfiles"):
            return httpx.Response(200, json={"value": self.profiles})
        if request.url.path.endswith("/security/secureScores"):
            return httpx.Response(200, json={"value": [{"controlScores": self.scores}]})
        return httpx.Response(404, json={})

    def client(self) -> UtcmClient:
        return UtcmClient(httpx.Client(transport=httpx.MockTransport(self.handler)), lambda: "t")


@pytest.fixture
def db(migrated_db: None, db_session: Session) -> Session:
    for table in (
        CfgRecommendationLink,
        CfgRecommendation,
        CfgChange,
        CfgSettingVersion,
        CfgSetting,
        CfgSnapshot,
    ):
        db_session.execute(delete(table))
    apply_snapshot(db_session, policy("p1", "MFA für alle", state="enabled"), {SOURCE: True})
    db_session.commit()
    return db_session


def fetch(db: Session) -> FakeGraph:
    graph = FakeGraph(
        [
            profile("AdminMFAV2", rank=1),
            profile("UserRiskPolicy", rank=2, actionUrl="javascript:alert(1)"),
            profile("Veraltet", deprecated=True),
        ],
        [
            {"controlName": "AdminMFAV2", "score": 10.0, "implementationStatus": "Alle geschützt."},
            {
                "controlName": "UserRiskPolicy",
                "score": 0.0,
                "implementationStatus": "<b>17</b> von 17 ohne Richtlinie.",
            },
        ],
    )
    fetch_secure_score(db, graph.client())
    return graph


@pytest.mark.db
def test_fetch_stores_controls_as_plain_text(db: Session) -> None:
    graph = fetch(db)
    rows = {row.control_id: row for row in db.scalars(select(CfgRecommendation)).all()}
    assert set(rows) == {"AdminMFAV2", "UserRiskPolicy", "Veraltet"}
    risk = rows["UserRiskPolicy"]
    assert risk.remediation == "Richtlinie einschalten."
    assert risk.status_text == "17 von 17 ohne Richtlinie."
    assert (risk.score, risk.max_score) == (0.0, 10.0)
    # nur https-Adressen werden als Link übernommen
    assert risk.action_url is None
    assert rows["AdminMFAV2"].action_url == "https://entra.microsoft.com/"
    assert rows["Veraltet"].score is None

    # zweiter Abruf: nichts doppelt, entfallene Controls werden abgemeldet
    graph.profiles = [profile("AdminMFAV2", rank=1, title="Neuer Titel")]
    result = fetch_secure_score(db, graph.client())
    assert (result.received, result.new, result.removed) == (1, 0, 2)
    db.expire_all()
    assert db.scalars(
        select(CfgRecommendation.control_id).where(CfgRecommendation.active)
    ).all() == ["AdminMFAV2"]
    assert db.scalars(select(CfgRecommendation.title).where(CfgRecommendation.active)).one() == (
        "Neuer Titel"
    )
    entry = db.scalars(
        select(AuditLog).where(AuditLog.action == "secure_score.abruf").order_by(AuditLog.id.desc())
    ).first()
    assert entry is not None and (entry.details or {})["entfallen"] == 2


@pytest.mark.db
def test_fetch_without_permission_fails_and_keeps_data(db: Session) -> None:
    graph = fetch(db)
    graph.status = 403
    with pytest.raises(UtcmError):
        fetch_secure_score(db, graph.client())
    db.rollback()
    assert len(db.scalars(select(CfgRecommendation).where(CfgRecommendation.active)).all()) == 3


def test_job_only_when_enabled() -> None:
    base: dict[str, Any] = {
        "public_url": ORIGIN,
        "environment": "test",
        "entra_tenant_id": "00000000-0000-0000-0000-00000000aaaa",
        "collector_client_id": "00000000-0000-0000-0000-00000000cccc",
    }
    assert FETCH_SECURE_SCORE not in build_registry(Settings(**base))
    assert FETCH_SECURE_SCORE in build_registry(Settings(**base, secure_score_enabled=True))
    without_collector = Settings(public_url=ORIGIN, environment="test", secure_score_enabled=True)
    assert FETCH_SECURE_SCORE not in build_registry(without_collector)


@pytest.mark.db
def test_list_views_and_roles(db: Session) -> None:
    fetch(db)
    stranger = client_for(["Evergreen.Editor"], "empfehlung-fremd")
    assert stranger.get(f"{BASE}/recommendations").status_code == 403

    reader = client_for(["Config.Reader"], "empfehlung-leser")
    data = reader.get(f"{BASE}/recommendations").json()
    assert data["enabled"] is False
    assert (data["open_count"], data["fulfilled_count"]) == (1, 1)
    assert (data["score"], data["max_score"]) == (10.0, 20.0)
    # veraltete Controls erscheinen nicht
    assert [entry["control_id"] for entry in data["entries"]] == ["UserRiskPolicy"]
    done = reader.get(f"{BASE}/recommendations", params={"view": "erfuellt"}).json()
    assert [entry["control_id"] for entry in done["entries"]] == ["AdminMFAV2"]
    assert done["entries"][0]["fulfilled"] is True
    everything = reader.get(f"{BASE}/recommendations", params={"view": "alle"}).json()
    assert [entry["control_id"] for entry in everything["entries"]] == [
        "AdminMFAV2",
        "UserRiskPolicy",
    ]
    assert reader.get(f"{BASE}/recommendations", params={"view": "x"}).status_code == 422
    assert reader.get(f"{BASE}/recommendations/999999").status_code == 404


@pytest.mark.db
def test_link_settings_to_a_recommendation(db: Session) -> None:
    fetch(db)
    setting_id = db.scalars(select(CfgSetting.id)).one()
    rec_id = db.scalars(
        select(CfgRecommendation.id).where(CfgRecommendation.control_id == "UserRiskPolicy")
    ).one()
    url = f"{BASE}/recommendations/{rec_id}/links"

    reader = client_for(["Config.Reader"], "empfehlung-leser")
    assert reader.post(url, json={"setting_id": setting_id}, headers=HEADERS).status_code == 403
    assert reader.delete(f"{url}/{setting_id}", headers=HEADERS).status_code == 403

    reviewer = client_for(["Config.Reviewer"], "empfehlung-reviewer")
    assert reviewer.post(url, json={"setting_id": 999999}, headers=HEADERS).status_code == 422
    linked = reviewer.post(url, json={"setting_id": setting_id}, headers=HEADERS)
    assert linked.status_code == 200, linked.text
    assert [entry["id"] for entry in linked.json()["settings"]] == [setting_id]
    assert linked.json()["remediation"] == "Richtlinie einschalten."
    # doppelt zuordnen ändert nichts
    again = reviewer.post(url, json={"setting_id": setting_id}, headers=HEADERS)
    assert len(again.json()["settings"]) == 1

    listing = reader.get(f"{BASE}/recommendations").json()["entries"]
    assert listing[0]["linked_settings"] == 1
    detail = reader.get(f"{BASE}/settings/{setting_id}").json()
    assert [entry["control_id"] for entry in detail["recommendations"]] == ["UserRiskPolicy"]
    assert detail["recommendations"][0]["status_text"] == "17 von 17 ohne Richtlinie."

    removed = reviewer.delete(f"{url}/{setting_id}", headers=HEADERS)
    assert removed.status_code == 200 and removed.json()["settings"] == []
    assert reader.get(f"{BASE}/settings/{setting_id}").json()["recommendations"] == []
    actions = db.scalars(
        select(AuditLog.action).where(
            AuditLog.object_type == "empfehlung", AuditLog.object_id == "UserRiskPolicy"
        )
    ).all()
    assert {"empfehlung.zugeordnet", "empfehlung.zuordnung_geloest"} <= set(actions)
