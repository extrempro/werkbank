"""HTML-Editor der IT-Tools: abgeschottete Vorschau-Seite."""

import base64
import hashlib

import pytest
from sqlalchemy import delete
from sqlalchemy.orm import Session

from tests.test_auth import ORIGIN, client_for, login_as, make_app, make_settings
from werkbank.core.models import AppSetting
from werkbank.modules.tools.html_preview import PAGE, SCRIPT, SCRIPT_HASH, preview_policy

URL = "/api/tools/html-vorschau"


def test_policy_allows_only_own_script_and_inline_css() -> None:
    assert SCRIPT in PAGE
    assert base64.b64encode(hashlib.sha256(SCRIPT.encode()).digest()).decode() == SCRIPT_HASH
    policy = preview_policy(False)
    assert f"script-src 'sha256-{SCRIPT_HASH}'" in policy
    assert "sandbox allow-scripts" in policy
    assert "allow-same-origin" not in policy
    assert "img-src data:;" in policy
    assert "form-action 'none'" in policy
    assert "img-src data: https:" in preview_policy(True)
    # Das Skript entfernt, was weiterleiten oder nachladen könnte
    for tag in ("script", "meta[http-equiv]", "base", "iframe", "object", "embed"):
        assert tag in SCRIPT


@pytest.mark.db
def test_preview_page_needs_tools_role_and_follows_internet_setting(
    migrated_db: None, db_session: Session
) -> None:
    db_session.execute(delete(AppSetting))
    db_session.commit()
    other = client_for(make_app(make_settings()))
    login_as(other, ["Budget.Reader"], oid="html-ohne")
    assert other.get(URL).status_code == 403

    client = client_for(make_app(make_settings()))
    login_as(client, ["Tools.User"], oid="html-nutzer")
    response = client.get(URL)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["content-security-policy"] == preview_policy(True)
    assert response.headers["cache-control"] == "no-store"

    admin = client_for(make_app(make_settings()))
    login_as(admin, ["Werkbank.Admin"], oid="html-admin")
    changed = admin.put(
        "/api/admin/settings/tools-internet",
        json={"enabled": False},
        headers={"Origin": ORIGIN},
    )
    assert changed.status_code == 200
    assert client.get(URL).headers["content-security-policy"] == preview_policy(False)
