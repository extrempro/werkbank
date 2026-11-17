"""Push aufs Handy (spec.md 6.7, 11): Abos je Gerät, Schlüssel, Versand.

Die Verwaltung schaltet Push ein; dabei entsteht ein VAPID-Schlüsselpaar, der private Teil liegt
verschlüsselt in der Datenbank (wie die übrigen Geheimnisse, app_settings). Jede Person schaltet
Push je Gerät ein und wählt im Konto die Arten. Eine Push-Nachricht nennt nur Bereich und Anzahl
und führt auf die Seite „Benachrichtigungen“.
"""

import logging
import uuid
from collections import Counter
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from werkbank.config import Settings
from werkbank.core.app_settings import (
    PUSH_KEY,
    decrypt_secret,
    encrypt_secret,
    get_setting,
    set_setting,
)
from werkbank.core.audit import write_audit
from werkbank.core.deps import CurrentUserDep, DbDep, SettingsDep
from werkbank.core.models import Notification, NotificationChannel, PushSubscription
from werkbank.core.notifications import KINDS
from werkbank.core.notify_channels import load_brand
from werkbank.core.sessions import now_utc
from werkbank.core.webpush import (
    PushError,
    Subscription,
    SubscriptionGoneError,
    generate_vapid_keys,
    send,
    valid_endpoint,
    valid_keys,
)

logger = logging.getLogger(__name__)

CHANNEL_PUSH = "push"
PUSH_DELIVER = "kern.push_versand"
PUSH_DELIVER_INTERVAL = timedelta(minutes=2)
# Ältere, noch nicht mitgeteilte Benachrichtigungen werden nicht mehr gepusht
MAX_AGE = timedelta(hours=24)
DEVICES_MAX = 10
LINK_PATH = "/benachrichtigungen"
TAG = "werkbank-benachrichtigungen"
MODULE = "kern"

PushSender = Callable[[Subscription, dict[str, Any], str, str], None]


def _send(subscription: Subscription, payload: dict[str, Any], key: str, subject: str) -> None:
    send(subscription, payload, key, subject)


def get_push_sender() -> PushSender:
    """In Tests ersetzbar."""
    return _send


PushSenderDep = Annotated[PushSender, Depends(get_push_sender)]


# --- Schlüssel und Einstellung ------------------------------------------------------------


def stored_push(db: Session) -> dict[str, Any]:
    value: Any = get_setting(db, PUSH_KEY)
    return value if isinstance(value, dict) else {}


def push_public_key(db: Session) -> str | None:
    """Öffentlicher Schlüssel, wenn Push eingeschaltet ist."""
    data = stored_push(db)
    key = data.get("public_key")
    return key if data.get("enabled") is True and isinstance(key, str) and key else None


def load_push_key(db: Session, settings: Settings) -> str | None:
    """Privater Schlüssel (PEM), wenn Push eingeschaltet und lesbar ist."""
    data = stored_push(db)
    token = data.get("private_key_encrypted")
    if data.get("enabled") is not True or not isinstance(token, str) or not token:
        return None
    return decrypt_secret(settings, token)


def enable_push(db: Session, settings: Settings, enabled: bool, user_id: uuid.UUID) -> None:
    """Schaltet Push ein oder aus. Beim ersten Einschalten entsteht das Schlüsselpaar."""
    data = stored_push(db)
    token = data.get("private_key_encrypted")
    public_key = data.get("public_key")
    if enabled and (not token or decrypt_secret(settings, str(token)) is None):
        keys = generate_vapid_keys()
        # Wirft SecretKeyMissingError, wenn die Schlüsseldatei fehlt
        token = encrypt_secret(settings, keys.private_pem)
        public_key = keys.public_key
        # Neue Schlüssel: Alte Abos passen nicht mehr dazu
        db.execute(delete(PushSubscription))
    set_setting(
        db,
        PUSH_KEY,
        {"enabled": enabled, "private_key_encrypted": token, "public_key": public_key},
        user_id,
    )


# --- Inhalt --------------------------------------------------------------------------------


def push_payload(brand_name: str, kinds: list[str]) -> dict[str, Any]:
    """Titel und Text ohne fachlichen Inhalt: nur Bereich und Anzahl."""
    counts = Counter(KINDS[kind].module for kind in kinds if kind in KINDS)
    total = sum(counts.values())
    if len(counts) == 1:
        module, count = next(iter(counts.items()))
        body = (
            f"{module}: eine neue Benachrichtigung"
            if count == 1
            else f"{module}: {count} neue Benachrichtigungen"
        )
    else:
        parts = ", ".join(f"{module} ({count})" for module, count in sorted(counts.items()))
        body = f"{total} neue Benachrichtigungen: {parts}"
    return {"title": brand_name, "body": body, "url": LINK_PATH, "tag": TAG}


# --- Versand -------------------------------------------------------------------------------


def _pending(db: Session, since: datetime) -> dict[uuid.UUID, list[Notification]]:
    rows = db.scalars(
        select(Notification)
        .join(
            NotificationChannel,
            (NotificationChannel.user_id == Notification.user_id)
            & (NotificationChannel.kind == Notification.kind)
            & (NotificationChannel.channel == CHANNEL_PUSH),
        )
        .where(
            Notification.pushed_at.is_(None),
            Notification.read_at.is_(None),
            Notification.created_at >= since,
            Notification.created_at >= NotificationChannel.created_at,
        )
        .order_by(Notification.id)
    ).all()
    grouped: dict[uuid.UUID, list[Notification]] = {}
    for row in rows:
        grouped.setdefault(row.user_id, []).append(row)
    return grouped


def deliver_push(
    db: Session,
    settings: Settings,
    *,
    sender: PushSender = _send,
    brand_name: str | None = None,
    now: datetime | None = None,
) -> int:
    """Schickt je Person eine Sammelnachricht an alle ihre Geräte. Liefert die Zahl der Personen."""
    key = load_push_key(db, settings)
    if key is None:
        return 0
    if brand_name is None:
        brand_name = load_brand(db).name
    now = now or now_utc()
    subject = settings.public_origin
    reached = 0
    for user_id, rows in _pending(db, now - MAX_AGE).items():
        devices = db.scalars(
            select(PushSubscription).where(PushSubscription.user_id == user_id)
        ).all()
        if not devices:
            continue
        payload = push_payload(brand_name, [row.kind for row in rows])
        delivered = False
        for device in devices:
            try:
                sender(
                    Subscription(device.endpoint, device.p256dh, device.auth),
                    payload,
                    key,
                    subject,
                )
            except SubscriptionGoneError:
                db.delete(device)
                continue
            except PushError as error:
                logger.warning("Push fehlgeschlagen: %s", error)
                continue
            device.last_success_at = now
            delivered = True
        if delivered:
            db.execute(
                update(Notification)
                .where(Notification.id.in_([row.id for row in rows]))
                .values(pushed_at=now)
            )
            reached += 1
        db.commit()
    return reached


def push_job(db: Session, settings: Settings, payload: dict[str, Any]) -> None:
    deliver_push(db, settings)


# --- API für das eigene Konto --------------------------------------------------------------

router = APIRouter(prefix="/api/notifications/push")


class DeviceOut(BaseModel):
    id: int
    label: str
    created_at: datetime
    last_success_at: datetime | None


class PushStateOut(BaseModel):
    # Von der Verwaltung eingeschaltet
    available: bool
    public_key: str | None
    devices: list[DeviceOut]


class SubscriptionIn(BaseModel):
    endpoint: str = Field(max_length=1000)
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)
    label: str = Field(default="", max_length=60)


class EndpointIn(BaseModel):
    endpoint: str = Field(max_length=1000)


def _state(db: Session, user_id: uuid.UUID) -> PushStateOut:
    public_key = push_public_key(db)
    devices = db.scalars(
        select(PushSubscription)
        .where(PushSubscription.user_id == user_id)
        .order_by(PushSubscription.created_at)
    ).all()
    return PushStateOut(
        available=public_key is not None,
        public_key=public_key,
        devices=[
            DeviceOut(
                id=device.id,
                label=device.label,
                created_at=device.created_at,
                last_success_at=device.last_success_at,
            )
            for device in devices
        ],
    )


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.get("")
def push_state(user: CurrentUserDep, db: DbDep) -> PushStateOut:
    """Ob Push eingeschaltet ist, der öffentliche Schlüssel und die eigenen Geräte."""
    return _state(db, user.user_id)


@router.post("/subscriptions")
def subscribe(
    request: Request, body: SubscriptionIn, user: CurrentUserDep, db: DbDep
) -> PushStateOut:
    """Meldet dieses Gerät an. Dasselbe Gerät ersetzt seinen alten Eintrag."""
    if push_public_key(db) is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Push ist nicht eingeschaltet."
        )
    if not valid_endpoint(body.endpoint) or not valid_keys(body.p256dh, body.auth):
        raise HTTPException(status_code=422, detail="Das Abo des Browsers ist nicht gültig.")
    label = "".join(char for char in body.label if char.isprintable()).strip()[:60]
    existing = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    if existing is not None:
        existing.user_id = user.user_id
        existing.p256dh = body.p256dh
        existing.auth = body.auth
        existing.label = label
    else:
        count = len(
            db.scalars(
                select(PushSubscription.id).where(PushSubscription.user_id == user.user_id)
            ).all()
        )
        if count >= DEVICES_MAX:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Höchstens {DEVICES_MAX} Geräte. Bitte zuerst ein altes entfernen.",
            )
        db.add(
            PushSubscription(
                user_id=user.user_id,
                endpoint=body.endpoint,
                p256dh=body.p256dh,
                auth=body.auth,
                label=label,
            )
        )
    write_audit(
        db,
        module=MODULE,
        action="konto.push_geraet_angemeldet",
        user_id=user.user_id,
        object_type="push",
        ip=_ip(request),
        details={"geraet": label},
    )
    db.commit()
    return _state(db, user.user_id)


@router.post("/subscriptions/remove")
def unsubscribe_endpoint(
    request: Request, body: EndpointIn, user: CurrentUserDep, db: DbDep
) -> PushStateOut:
    """Meldet dieses Gerät ab (der Browser kennt nur seine Adresse)."""
    db.execute(
        delete(PushSubscription).where(
            PushSubscription.user_id == user.user_id, PushSubscription.endpoint == body.endpoint
        )
    )
    write_audit(
        db,
        module=MODULE,
        action="konto.push_geraet_abgemeldet",
        user_id=user.user_id,
        object_type="push",
        ip=_ip(request),
    )
    db.commit()
    return _state(db, user.user_id)


@router.delete("/subscriptions/{device_id}")
def remove_device(
    request: Request, device_id: int, user: CurrentUserDep, db: DbDep
) -> PushStateOut:
    """Entfernt eines der eigenen Geräte (z. B. ein verlorenes Handy)."""
    db.execute(
        delete(PushSubscription).where(
            PushSubscription.user_id == user.user_id, PushSubscription.id == device_id
        )
    )
    write_audit(
        db,
        module=MODULE,
        action="konto.push_geraet_abgemeldet",
        user_id=user.user_id,
        object_type="push",
        object_id=str(device_id),
        ip=_ip(request),
    )
    db.commit()
    return _state(db, user.user_id)


@router.post("/test")
def test_push(
    user: CurrentUserDep, db: DbDep, settings: SettingsDep, sender: PushSenderDep
) -> PushStateOut:
    """Schickt eine Testnachricht an die eigenen Geräte."""
    key = load_push_key(db, settings)
    if key is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Push ist nicht eingeschaltet."
        )
    devices = db.scalars(
        select(PushSubscription).where(PushSubscription.user_id == user.user_id)
    ).all()
    if not devices:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Auf keinem Gerät ist Push eingeschaltet.",
        )
    payload = {
        "title": load_brand(db).name,
        "body": "Test: Push kommt auf diesem Gerät an.",
        "url": "/konto",
        "tag": "werkbank-test",
    }
    failures = 0
    for device in devices:
        try:
            sender(
                Subscription(device.endpoint, device.p256dh, device.auth),
                payload,
                key,
                settings.public_origin,
            )
            device.last_success_at = now_utc()
        except SubscriptionGoneError:
            db.delete(device)
            failures += 1
        except PushError as error:
            logger.warning("Push-Test fehlgeschlagen: %s", error)
            failures += 1
    db.commit()
    if failures == len(devices):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Die Testnachricht ist bei keinem Gerät angekommen.",
        )
    return _state(db, user.user_id)
