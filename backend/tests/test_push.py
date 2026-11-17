"""Push aufs Handy: Verschlüsselung, Adressen, Inhalt, Verwaltung, Konto und Versand."""

import json
from datetime import timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from tests.test_admin_settings import HEADERS, admin, settings_with_key
from tests.test_auth import client_for, login_as, make_app
from werkbank.core.app_settings import PUSH_KEY
from werkbank.core.models import (
    AppSetting,
    Notification,
    NotificationChannel,
    PushSubscription,
    User,
)
from werkbank.core.push import deliver_push, get_push_sender, push_payload
from werkbank.core.sessions import now_utc
from werkbank.core.webpush import (
    PushError,
    Subscription,
    SubscriptionGoneError,
    b64url,
    b64url_decode,
    encrypt,
    generate_vapid_keys,
    send,
    valid_endpoint,
    valid_keys,
    vapid_header,
)

# Beispiel aus RFC 8291, Anhang A
RFC_PLAIN = b"When I grow up, I want to be a watermelon"
RFC_AUTH = "BTBZMqHH6r4Tts7J_aSIgg"
RFC_RECEIVER = (
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
)
RFC_SENDER_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
RFC_SALT = "DGv6ra1nlYgDCS1FRnbzlw"
RFC_RESULT = (
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS"
    "6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Q"
    "ulcy4a-fN"
)
FCM = "https://fcm.googleapis.com/fcm/send/abc123"


def test_encryption_matches_rfc_8291() -> None:
    sender = ec.derive_private_key(
        int.from_bytes(b64url_decode(RFC_SENDER_PRIVATE), "big"), ec.SECP256R1()
    )
    result = encrypt(
        RFC_PLAIN, RFC_RECEIVER, RFC_AUTH, salt=b64url_decode(RFC_SALT), sender_key=sender
    )
    assert b64url(result) == RFC_RESULT


def test_only_known_push_services() -> None:
    assert valid_endpoint(FCM)
    assert valid_endpoint("https://web.push.apple.com/QGuQyavXutnMH")
    assert valid_endpoint("https://updates.push.services.mozilla.com/wpush/v2/gAAA")
    assert valid_endpoint("https://wns2-am3p.notify.windows.com/w/?token=abc")
    for bad in (
        "http://fcm.googleapis.com/fcm/send/abc",
        "https://example.com/push",
        "https://fcm.googleapis.com.example.com/x",
        "https://user:pw@fcm.googleapis.com/x",
        "https://fcm.googleapis.com:8443/x",
        "https://evilpush.apple.com.example.org/x",
        "https://fcm.googleapis.com/x y",
    ):
        assert not valid_endpoint(bad), bad
    assert valid_keys(RFC_RECEIVER, RFC_AUTH)
    assert not valid_keys(RFC_RECEIVER, "kurz")
    assert not valid_keys("BBBB", RFC_AUTH)


def test_vapid_header_is_signed_for_the_push_service() -> None:
    keys = generate_vapid_keys()
    header = vapid_header(FCM, keys.private_pem, "https://werkbank.example.com", now=1000.0)
    token = header.split("t=")[1].split(",")[0]
    assert header.endswith(f"k={keys.public_key}")
    head, claims, signature = token.split(".")
    assert json.loads(b64url_decode(claims)) == {
        "aud": "https://fcm.googleapis.com",
        "exp": 1000 + 12 * 3600,
        "sub": "https://werkbank.example.com",
    }
    raw = b64url_decode(signature)
    public = ec.EllipticCurvePublicKey.from_encoded_point(
        ec.SECP256R1(), b64url_decode(keys.public_key)
    )
    public.verify(
        encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")),
        f"{head}.{claims}".encode(),
        ec.ECDSA(hashes.SHA256()),
    )


def test_send_reports_gone_and_errors() -> None:
    keys = generate_vapid_keys()
    seen: list[httpx.Request] = []

    def handler(status: int) -> httpx.Client:
        def respond(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            return httpx.Response(status)

        return httpx.Client(transport=httpx.MockTransport(respond))

    subscription = Subscription(FCM, RFC_RECEIVER, RFC_AUTH)
    send(
        subscription, {"title": "x"}, keys.private_pem, "https://w.example.com", client=handler(201)
    )
    assert seen[0].headers["Content-Encoding"] == "aes128gcm"
    assert seen[0].headers["TTL"] == "86400"
    assert seen[0].headers["Authorization"].startswith("vapid t=")
    # Der Inhalt ist verschlüsselt, nichts davon steht im Klartext in der Anfrage
    assert b'"title"' not in seen[0].content
    with pytest.raises(SubscriptionGoneError):
        send(subscription, {}, keys.private_pem, "https://w.example.com", client=handler(410))
    with pytest.raises(PushError):
        send(subscription, {}, keys.private_pem, "https://w.example.com", client=handler(500))
    with pytest.raises(SubscriptionGoneError):
        send(
            Subscription("https://example.com/x", RFC_RECEIVER, RFC_AUTH),
            {},
            keys.private_pem,
            "https://w.example.com",
        )


def test_payload_names_only_area_and_count() -> None:
    one = push_payload("Werkbank", ["budget.rechnung_pruefen"])
    assert one == {
        "title": "Werkbank",
        "body": "IT-Budget: eine neue Benachrichtigung",
        "url": "/benachrichtigungen",
        "tag": "werkbank-benachrichtigungen",
    }
    two = push_payload("Werkbank", ["budget.rechnung_pruefen", "budget.kuendigung"])
    assert two["body"] == "IT-Budget: 2 neue Benachrichtigungen"


# --- mit Datenbank --------------------------------------------------------------------------


@pytest.fixture
def db(migrated_db: None, db_session: Session) -> Session:
    for table in (Notification, NotificationChannel, PushSubscription, AppSetting):
        db_session.execute(delete(table))
    db_session.commit()
    return db_session


@pytest.mark.db
def test_admin_switches_push_and_creates_keys(db: Session, tmp_path: Path) -> None:
    settings = settings_with_key(tmp_path)
    client = admin(settings)
    base = "/api/admin/settings"
    assert client.get(base).json()["push"] == {
        "enabled": False,
        "key_set": False,
        "key_storage_available": True,
        "devices": 0,
    }
    on = client.put(f"{base}/push", json={"enabled": True}, headers=HEADERS)
    assert on.json()["push"]["enabled"] is True
    assert on.json()["push"]["key_set"] is True
    stored = db.scalars(select(AppSetting).where(AppSetting.key == PUSH_KEY)).one()
    db.refresh(stored)
    assert "PRIVATE KEY" not in json.dumps(stored.value)
    public_key = stored.value["public_key"]
    # Aus und wieder ein: derselbe Schlüssel, Abos bleiben gültig
    client.put(f"{base}/push", json={"enabled": False}, headers=HEADERS)
    client.put(f"{base}/push", json={"enabled": True}, headers=HEADERS)
    db.refresh(stored)
    assert stored.value["public_key"] == public_key


def enable(db: Session, tmp_path: Path) -> Any:
    settings = settings_with_key(tmp_path)
    admin(settings).put("/api/admin/settings/push", json={"enabled": True}, headers=HEADERS)
    return settings


@pytest.mark.db
def test_devices_and_channel_in_account(db: Session, tmp_path: Path) -> None:
    settings = enable(db, tmp_path)
    client = client_for(make_app(settings))
    login_as(client, ["Budget.Manager"], oid="push-konto")
    state = client.get("/api/notifications/push").json()
    assert state["available"] is True
    assert len(b64url_decode(state["public_key"])) == 65
    assert state["devices"] == []

    bad = client.post(
        "/api/notifications/push/subscriptions",
        json={"endpoint": "https://example.com/x", "p256dh": RFC_RECEIVER, "auth": RFC_AUTH},
        headers=HEADERS,
    )
    assert bad.status_code == 422
    body = {"endpoint": FCM, "p256dh": RFC_RECEIVER, "auth": RFC_AUTH, "label": "Android"}
    added = client.post("/api/notifications/push/subscriptions", json=body, headers=HEADERS)
    assert [device["label"] for device in added.json()["devices"]] == ["Android"]
    # Dasselbe Gerät noch einmal: kein zweiter Eintrag
    again = client.post("/api/notifications/push/subscriptions", json=body, headers=HEADERS)
    assert len(again.json()["devices"]) == 1

    data = client.get("/api/notifications/settings").json()
    assert data["channels"]["push"] is True
    saved = client.put(
        "/api/notifications/settings",
        json={"disabled": [], "push": ["budget.rechnung_pruefen"]},
        headers=HEADERS,
    ).json()["kinds"]
    assert {entry["kind"] for entry in saved if entry["push"]} == {"budget.rechnung_pruefen"}

    # Test an die eigenen Geräte
    sent: list[tuple[Subscription, dict[str, Any]]] = []
    client.app.dependency_overrides[get_push_sender] = lambda: (  # type: ignore[attr-defined]
        lambda subscription, payload, key, subject: sent.append((subscription, payload))
    )
    assert client.post("/api/notifications/push/test", headers=HEADERS).status_code == 200
    assert sent[0][0].endpoint == FCM
    assert sent[0][1]["body"].startswith("Test")

    removed = client.post(
        "/api/notifications/push/subscriptions/remove", json={"endpoint": FCM}, headers=HEADERS
    )
    assert removed.json()["devices"] == []
    assert client.post("/api/notifications/push/test", headers=HEADERS).status_code == 409


@pytest.mark.db
def test_deliver_push_once_and_drop_gone_devices(db: Session, tmp_path: Path) -> None:
    settings = enable(db, tmp_path)
    user = User(entra_oid="push:versand", display_name="Paul Push", email=None)
    db.add(user)
    db.flush()
    db.add(NotificationChannel(user_id=user.id, channel="push", kind="budget.rechnung_pruefen"))
    db.add(
        PushSubscription(
            user_id=user.id, endpoint=FCM, p256dh=RFC_RECEIVER, auth=RFC_AUTH, label="a"
        )
    )
    gone = "https://web.push.apple.com/alt"
    db.add(
        PushSubscription(
            user_id=user.id, endpoint=gone, p256dh=RFC_RECEIVER, auth=RFC_AUTH, label="b"
        )
    )
    db.flush()
    later = now_utc() + timedelta(seconds=5)
    for kind in ("budget.rechnung_pruefen", "budget.kuendigung"):
        db.add(Notification(user_id=user.id, kind=kind, title="Geheim", link="/", created_at=later))
    db.commit()

    sent: list[tuple[str, dict[str, Any]]] = []

    def sender(subscription: Subscription, payload: dict[str, Any], key: str, subject: str) -> None:
        if subscription.endpoint == gone:
            raise SubscriptionGoneError("weg")
        assert "PRIVATE KEY" in key
        sent.append((subscription.endpoint, payload))

    assert deliver_push(db, settings, sender=sender, brand_name="Werkbank") == 1
    # Nur die Art mit Push, ohne Titel der Benachrichtigung
    assert sent == [
        (
            FCM,
            {
                "title": "Werkbank",
                "body": "IT-Budget: eine neue Benachrichtigung",
                "url": "/benachrichtigungen",
                "tag": "werkbank-benachrichtigungen",
            },
        )
    ]
    assert db.scalars(select(PushSubscription.endpoint)).all() == [FCM]
    # Zweiter Lauf: nichts Neues
    assert deliver_push(db, settings, sender=sender, brand_name="Werkbank") == 0
    assert len(sent) == 1
