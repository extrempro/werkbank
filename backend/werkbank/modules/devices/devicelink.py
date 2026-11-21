"""QR-Code „Scan QR code“ aus der Windows-Einrichtung lesen und in Graph-`deviceLink` umwandeln.

Portiert aus AutopilotQR (src/lib/devicelink.ts), https://github.com/Simsen/AutopilotQR
Copyright (c) 2026 Simon Eriksen, MIT-Lizenz (siehe THIRD_PARTY_NOTICES.md).

QR-Text:  devicelink:/1/?sn=<Seriennummer>&data=<urlkodiert base64(gzip(JSON))>
Das JSON nutzt kurze Schlüssel (ver, dlict, di{kl,man,mod,sn,sbu,li,lict}, dlkd{…}).
Graph `importTenantAssociatedDevice` erwartet `deviceLink` = Base64 des JSON mit langen
Schlüsseln in genau der Reihenfolge des CSV-Exports von Windows. Laut Autor der Vorlage am
17.10.2026 gegen Intune geprüft; der QR-Code enthält den öffentlichen EK-Schlüssel nicht, der
Dienst nimmt die Daten trotzdem an.

Die Daten sind vertraulich: nie protokollieren, nie unverschlüsselt speichern.
"""

import base64
import binascii
import json
import re
import zlib
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import unquote

SCHEME = re.compile(r"^devicelink:/1/\?", re.IGNORECASE)
HEX32 = re.compile(r"^[0-9a-fA-F]{32}$")
BASE64 = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")
# QR-Version 40 fasst unter 3 KB; Größeres stammt nicht von Windows
MAX_QR_LENGTH = 4096
# Schutz vor Gzip-Bomben
MAX_JSON_BYTES = 16 * 1024
UNIX_MIN = 1_500_000_000
UNIX_MAX = 4_000_000_000


class DeviceLinkError(ValueError):
    """Der QR-Code ist kein gültiger Code der Gerätezuordnung (Text für die Oberfläche)."""


@dataclass(frozen=True)
class ScannedDevice:
    serial_number: str
    manufacturer: str
    model: str
    link_id: str
    generated_at: datetime
    # Base64-Wert für Graph `deviceLink`
    device_link: str


def looks_like_device_link(text: str) -> bool:
    """Schnelle Prüfung für den Scanner: fremde QR-Codes still übergehen."""
    return bool(SCHEME.match(text.strip()))


def _query(raw: str) -> dict[str, str]:
    # Von Hand zerlegen: parse_qs würde ein „+“ zum Leerzeichen machen.
    params: dict[str, str] = {}
    for part in SCHEME.sub("", raw, count=1).split("&"):
        index = part.find("=")
        if index <= 0:
            continue
        try:
            params[part[:index]] = unquote(part[index + 1 :], errors="strict")
        except UnicodeDecodeError as error:
            raise DeviceLinkError("Der QR-Code enthält eine ungültige Kodierung.") from error
    return params


def _gunzip(data: bytes) -> bytes:
    decompressor = zlib.decompressobj(wbits=16 + zlib.MAX_WBITS)
    try:
        out = decompressor.decompress(data, MAX_JSON_BYTES + 1)
    except zlib.error as error:
        raise DeviceLinkError("Die Daten im QR-Code ließen sich nicht entpacken.") from error
    if len(out) > MAX_JSON_BYTES or decompressor.unconsumed_tail:
        raise DeviceLinkError("Die Daten im QR-Code sind unerwartet groß.")
    if not decompressor.eof:
        raise DeviceLinkError("Die Daten im QR-Code ließen sich nicht entpacken.")
    return out


def parse_qr(text: str) -> dict[str, Any]:
    """Liest den QR-Text und prüft den Inhalt. Fehler als DeviceLinkError mit lesbarem Text."""
    raw = text.strip()
    if len(raw) > MAX_QR_LENGTH:
        raise DeviceLinkError("Der QR-Code ist zu groß für einen Code der Gerätezuordnung.")
    if not SCHEME.match(raw):
        raise DeviceLinkError("Das ist kein QR-Code der Windows-Gerätezuordnung.")
    params = _query(raw)
    serial, data = params.get("sn"), params.get("data")
    if not serial or not data:
        raise DeviceLinkError("Im QR-Code fehlen Seriennummer oder Daten.")
    if not BASE64.match(data):
        raise DeviceLinkError("Die Daten im QR-Code sind kein gültiges Base64.")
    try:
        packed = base64.b64decode(data, validate=True)
    except binascii.Error as error:
        raise DeviceLinkError("Die Daten im QR-Code sind kein gültiges Base64.") from error
    try:
        payload = json.loads(_gunzip(packed).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise DeviceLinkError("Die Daten im QR-Code sind kein gültiges JSON.") from error
    _validate(payload, serial)
    return payload  # type: ignore[no-any-return]


def _unix(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    try:
        number = float(value)
    except TypeError, ValueError:
        return False
    return number.is_integer() and UNIX_MIN < number < UNIX_MAX


def _validate(payload: Any, serial_from_url: str) -> None:
    def fail(message: str) -> None:
        raise DeviceLinkError(f"Nicht unterstützter Inhalt des QR-Codes: {message}.")

    if not isinstance(payload, dict):
        fail("kein Objekt")
    if payload.get("ver") != "1.0":
        fail(f"Version {payload.get('ver')!s:.20} (erwartet 1.0)")
    info, keys = payload.get("di"), payload.get("dlkd")
    if not isinstance(info, dict) or not isinstance(keys, dict):
        fail("Geräteangaben oder Signatur fehlen")
        return
    for field in ("man", "mod", "sn"):
        if not isinstance(info.get(field), str) or not info.get(field):
            fail(f"{field} fehlt")
    if info["sn"] != serial_from_url:
        fail("Seriennummer passt nicht")
    if not HEX32.match(str(info.get("sbu") or "")):
        fail("ungültige SMBIOS-UUID")
    if not HEX32.match(str(info.get("li") or "")):
        fail("ungültige Link-ID")
    if not _unix(payload.get("dlict")) or not _unix(info.get("lict")):
        fail("ungültige Zeitstempel")
    key_list = info.get("kl")
    if not isinstance(key_list, list) or not key_list:
        fail("keine Geräteschlüssel")
        return
    for key in key_list:
        if (
            not isinstance(key, dict)
            or not isinstance(key.get("kn"), str)
            or not HEX32.match(str(key.get("id") or ""))
            or not isinstance(key.get("kt"), int)
            or isinstance(key.get("kt"), bool)
        ):
            fail("fehlerhafter Schlüssel")
            return
        if "kp" in key and not (isinstance(key["kp"], str) and BASE64.match(key["kp"])):
            fail("fehlerhafter öffentlicher Schlüssel")
    signer = next((key for key in key_list if key.get("kn") == keys.get("skn")), None)
    if signer is None or not signer.get("kp"):
        fail("Signaturschlüssel fehlt")
    if not isinstance(keys.get("sig"), str) or not BASE64.match(keys["sig"]):
        fail("ungültige Signatur")
    salt = keys.get("pssSaltCb")
    if (
        not isinstance(keys.get("sa"), str)
        or not isinstance(keys.get("pssAlg"), str)
        or not isinstance(salt, int)
        or isinstance(salt, bool)
    ):
        fail("ungültige Angaben zur Signatur")


def to_guid(hex_value: str) -> str:
    value = hex_value.upper()
    return f"{value[0:8]}-{value[8:12]}-{value[12:16]}-{value[16:20]}-{value[20:32]}"


def unix_to_iso(value: Any) -> str:
    """Unix-Sekunden → ISO ohne Millisekunden, z. B. 2026-10-17T04:10:17Z."""
    return datetime.fromtimestamp(int(float(value)), UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_device_link(payload: dict[str, Any]) -> str:
    """Base64(UTF-8(JSON)) mit langen Schlüsseln in der Reihenfolge des Windows-Exports."""
    info, keys = payload["di"], payload["dlkd"]
    key_list = []
    for key in info["kl"]:
        entry: dict[str, Any] = {
            "KeyName": key["kn"],
            "KeyId": to_guid(key["id"]),
            "KeyType": key["kt"],
        }
        if key.get("kp"):
            entry["KeyPub"] = key["kp"]
        key_list.append(entry)
    out = {
        "Version": payload["ver"],
        "DeviceLinkCreationTimeUtc": unix_to_iso(payload["dlict"]),
        "DeviceInfo": {
            "DeviceIdKeyList": key_list,
            "Manufacturer": info["man"],
            "ModelName": info["mod"],
            "SerialNumber": info["sn"],
            "SmbiosUuid": to_guid(info["sbu"]),
            "LinkId": to_guid(info["li"]),
            "LinkIdCreationTimeUtc": unix_to_iso(info["lict"]),
        },
        "DeviceLinkKeyData": {
            "DeviceInfoSigningAlgorithm": keys["sa"],
            "DeviceInfoSigningKeyName": keys["skn"],
            "DeviceInfoSignature": keys["sig"],
            "DeviceInfoSignaturePssHashSchemeAlgorithm": keys["pssAlg"],
            "DeviceInfoSignaturePssSaltLength": keys["pssSaltCb"],
        },
    }
    # Wie JSON.stringify: ohne Leerzeichen, Nicht-ASCII als UTF-8
    text = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def scan_to_device(text: str) -> ScannedDevice:
    """Lesen und umwandeln in einem Schritt."""
    payload = parse_qr(text)
    info = payload["di"]
    return ScannedDevice(
        serial_number=info["sn"],
        manufacturer=info["man"],
        model=info["mod"],
        link_id=to_guid(info["li"]),
        generated_at=datetime.fromtimestamp(int(float(payload["dlict"])), UTC),
        device_link=to_device_link(payload),
    )
