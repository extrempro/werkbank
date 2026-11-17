"""Web Push (RFC 8030) mit VAPID (RFC 8292) und verschlüsseltem Inhalt (RFC 8291).

Ohne Zusatzpaket: Signatur und Verschlüsselung mit „cryptography“, Versand mit httpx.
Der Inhalt ist Ende-zu-Ende verschlüsselt; der Push-Dienst (Google, Apple, Mozilla,
Microsoft) sieht ihn nicht. Er nennt trotzdem nur Bereich und Anzahl, nie fachliche Inhalte.
"""

import base64
import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

# Nur an diese Push-Dienste schickt der Server (kein beliebiges Ziel, kein SSRF)
PUSH_HOSTS = (
    "fcm.googleapis.com",
    ".push.apple.com",
    ".push.services.mozilla.com",
    ".notify.windows.com",
)
ENDPOINT_MAX = 1000
RECORD_SIZE = 4096
TTL_SECONDS = 24 * 60 * 60
JWT_LIFETIME_SECONDS = 12 * 60 * 60
TIMEOUT_SECONDS = 15
_B64 = re.compile(r"^[A-Za-z0-9_-]+={0,2}$")


class PushError(Exception):
    """Versand fehlgeschlagen; Text ohne Adresse."""


class SubscriptionGoneError(PushError):
    """Der Push-Dienst kennt das Abo nicht mehr (404/410): löschen."""


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(text: str) -> bytes:
    if not _B64.match(text):
        raise ValueError("kein Base64url")
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def valid_endpoint(url: str) -> bool:
    """https-Adresse eines bekannten Push-Dienstes, ohne Benutzerangaben, Port nur 443."""
    if len(url) > ENDPOINT_MAX or any(ord(char) < 33 for char in url):
        return False
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return (
        parts.scheme == "https"
        and parts.username is None
        and parts.password is None
        and parts.port in (None, 443)
        and bool(re.fullmatch(r"[a-z0-9.-]+", host))
        and any(host == suffix.lstrip(".") or host.endswith(suffix) for suffix in PUSH_HOSTS)
    )


def valid_keys(p256dh: str, auth: str) -> bool:
    """Öffentlicher Schlüssel des Browsers (65 Byte, P-256) und Auth-Geheimnis (16 Byte)."""
    try:
        public = b64url_decode(p256dh)
        secret = b64url_decode(auth)
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), public)
    except ValueError:
        return False
    return len(public) == 65 and len(secret) == 16


@dataclass(frozen=True)
class VapidKeys:
    private_pem: str
    # Öffentlicher Schlüssel, unkomprimiert, Base64url (für den Browser)
    public_key: str


def generate_vapid_keys() -> VapidKeys:
    private = ec.generate_private_key(ec.SECP256R1())
    pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode("ascii")
    return VapidKeys(private_pem=pem, public_key=b64url(_public_bytes(private.public_key())))


def _public_bytes(key: ec.EllipticCurvePublicKey) -> bytes:
    return key.public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )


def _load_private(pem: str) -> ec.EllipticCurvePrivateKey:
    key = serialization.load_pem_private_key(pem.encode("ascii"), password=None)
    if not isinstance(key, ec.EllipticCurvePrivateKey):
        raise PushError("Der Push-Schlüssel ist kein EC-Schlüssel.")
    return key


def vapid_header(endpoint: str, private_pem: str, subject: str, now: float | None = None) -> str:
    """Authorization-Kopf nach RFC 8292: signiertes JWT und öffentlicher Schlüssel."""
    key = _load_private(private_pem)
    parts = urlsplit(endpoint)
    claims = {
        "aud": f"{parts.scheme}://{parts.netloc}",
        "exp": int((now if now is not None else time.time()) + JWT_LIFETIME_SECONDS),
        "sub": subject,
    }
    header = {"typ": "JWT", "alg": "ES256"}
    signing_input = (
        b64url(json.dumps(header, separators=(",", ":")).encode())
        + "."
        + b64url(json.dumps(claims, separators=(",", ":")).encode())
    )
    der = key.sign(signing_input.encode("ascii"), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    signature = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    token = f"{signing_input}.{b64url(signature)}"
    return f"vapid t={token}, k={b64url(_public_bytes(key.public_key()))}"


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def encrypt(
    plaintext: bytes,
    p256dh: str,
    auth: str,
    *,
    salt: bytes | None = None,
    sender_key: ec.EllipticCurvePrivateKey | None = None,
) -> bytes:
    """Verschlüsselt den Inhalt für ein Abo (aes128gcm, ein Datensatz)."""
    receiver_public = b64url_decode(p256dh)
    auth_secret = b64url_decode(auth)
    receiver = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), receiver_public)
    sender = sender_key or ec.generate_private_key(ec.SECP256R1())
    sender_public = _public_bytes(sender.public_key())
    shared = sender.exchange(ec.ECDH(), receiver)
    ikm = _hkdf(auth_secret, shared, b"WebPush: info\x00" + receiver_public + sender_public, 32)
    salt = salt or os.urandom(16)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    if len(plaintext) + 1 + 16 > RECORD_SIZE:
        raise PushError("Der Inhalt ist zu lang für eine Push-Nachricht.")
    # Trennbyte 0x02 markiert den letzten (einzigen) Datensatz
    ciphertext = AESGCM(cek).encrypt(nonce, plaintext + b"\x02", None)
    header = salt + RECORD_SIZE.to_bytes(4, "big") + bytes([len(sender_public)]) + sender_public
    return header + ciphertext


@dataclass(frozen=True)
class Subscription:
    endpoint: str
    p256dh: str
    auth: str


def send(
    subscription: Subscription,
    payload: dict[str, Any],
    private_pem: str,
    subject: str,
    *,
    client: httpx.Client | None = None,
) -> None:
    """Schickt eine Nachricht. SubscriptionGoneError, wenn das Abo nicht mehr gilt."""
    if not valid_endpoint(subscription.endpoint):
        raise SubscriptionGoneError("Die Adresse des Abos ist nicht zulässig.")
    body = encrypt(
        json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        subscription.p256dh,
        subscription.auth,
    )
    headers = {
        "Authorization": vapid_header(subscription.endpoint, private_pem, subject),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "TTL": str(TTL_SECONDS),
        "Urgency": "normal",
    }
    http = client or httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False)
    try:
        response = http.post(subscription.endpoint, content=body, headers=headers)
    except httpx.HTTPError as error:
        raise PushError(f"Push-Dienst nicht erreichbar ({type(error).__name__}).") from error
    finally:
        if client is None:
            http.close()
    if response.status_code in (404, 410):
        raise SubscriptionGoneError(f"Abo abgelaufen ({response.status_code}).")
    if response.status_code >= 300:
        raise PushError(f"Der Push-Dienst hat mit {response.status_code} geantwortet.")
