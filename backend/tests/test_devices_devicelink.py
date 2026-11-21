"""QR-Code der Gerätezuordnung lesen und umwandeln (nur erfundene Testdaten, keine echten Geräte).

Fälle nach AutopilotQR (src/lib/devicelink.test.ts), Copyright (c) 2026 Simon Eriksen, MIT.
Optionaler Golden-Test mit echten QR-Codes aus `backend/tests/fixtures-private/` (per .gitignore
ausgeschlossen): `<name>.qr.txt` und dazu `<name>.expected-devicelink.txt`.
"""

import base64
import copy
import gzip
import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

import pytest

from werkbank.modules.devices.devicelink import (
    DeviceLinkError,
    looks_like_device_link,
    parse_qr,
    scan_to_device,
    to_device_link,
    to_guid,
    unix_to_iso,
)

SAMPLE: dict[str, Any] = {
    "ver": "1.0",
    "dlict": "1792213878",
    "di": {
        "kl": [
            {"kn": "EK_1", "id": "00112233445566778899AABBCCDDEEFF", "kt": 1},
            {
                "kn": "IDK_1",
                "id": "FFEEDDCCBBAA99887766554433221100",
                "kt": 2,
                "kp": "UlNBMQAIAAADAAAAAAEAAA==",
            },
        ],
        "man": "BEISPIEL",
        "mod": "Modell 1",
        "sn": "SN12345",
        "sbu": "0123456789ABCDEF0123456789ABCDEF",
        "li": "AABBCCDDEEFF00112233445566778899",
        "lict": "1792210217",
    },
    "dlkd": {
        "sa": "RSA2048-SHA256",
        "skn": "IDK_1",
        "sig": "c2lnbmF0dXJl",
        "pssAlg": "SHA256",
        "pssSaltCb": 222,
    },
}


def gzip_b64(payload: Any) -> str:
    return base64.b64encode(gzip.compress(json.dumps(payload).encode())).decode()


def make_qr(payload: Any, serial: str = "SN12345", scheme: str = "devicelink") -> str:
    return f"{scheme}:/1/?sn={serial}&data={quote(gzip_b64(payload), safe='')}"


def changed(**parts: Any) -> dict[str, Any]:
    data = copy.deepcopy(SAMPLE)
    for key, value in parts.items():
        if key in ("di", "dlkd"):
            data[key].update(value)
        else:
            data[key] = value
    return data


def test_helpers() -> None:
    assert to_guid("7abadd81f0e14796906e75f83caa27d5") == "7ABADD81-F0E1-4796-906E-75F83CAA27D5"
    assert unix_to_iso("1792210217") == "2026-10-17T04:10:17Z"
    assert looks_like_device_link("deviceLink:/1/?sn=x&data=y")
    assert not looks_like_device_link("https://example.com")


def test_round_trip_in_windows_key_order() -> None:
    device = scan_to_device(make_qr(SAMPLE))
    assert device.serial_number == "SN12345"
    assert (device.manufacturer, device.model) == ("BEISPIEL", "Modell 1")
    assert device.link_id == "AABBCCDD-EEFF-0011-2233-445566778899"
    assert device.generated_at.isoformat() == "2026-10-17T05:11:18+00:00"
    text = base64.b64decode(device.device_link).decode()
    assert text.startswith(
        '{"Version":"1.0","DeviceLinkCreationTimeUtc":"2026-10-17T05:11:18Z",'
        '"DeviceInfo":{"DeviceIdKeyList":['
    )
    data = json.loads(text)
    assert list(data) == ["Version", "DeviceLinkCreationTimeUtc", "DeviceInfo", "DeviceLinkKeyData"]
    assert list(data["DeviceInfo"]) == [
        "DeviceIdKeyList",
        "Manufacturer",
        "ModelName",
        "SerialNumber",
        "SmbiosUuid",
        "LinkId",
        "LinkIdCreationTimeUtc",
    ]
    assert list(data["DeviceLinkKeyData"]) == [
        "DeviceInfoSigningAlgorithm",
        "DeviceInfoSigningKeyName",
        "DeviceInfoSignature",
        "DeviceInfoSignaturePssHashSchemeAlgorithm",
        "DeviceInfoSignaturePssSaltLength",
    ]
    # EK ohne öffentlichen Schlüssel: KeyPub fehlt
    assert data["DeviceInfo"]["DeviceIdKeyList"][0] == {
        "KeyName": "EK_1",
        "KeyId": "00112233-4455-6677-8899-AABBCCDDEEFF",
        "KeyType": 1,
    }
    assert data["DeviceInfo"]["DeviceIdKeyList"][1]["KeyPub"] == "UlNBMQAIAAADAAAAAAEAAA=="
    assert data["DeviceInfo"]["SmbiosUuid"] == "01234567-89AB-CDEF-0123-456789ABCDEF"
    assert data["DeviceLinkKeyData"]["DeviceInfoSignaturePssSaltLength"] == 222
    assert to_device_link(parse_qr(make_qr(SAMPLE))) == device.device_link


def test_uppercase_scheme_and_literal_plus() -> None:
    assert parse_qr(make_qr(SAMPLE, scheme="deviceLink"))
    # Ein „+“ im Base64 muss erhalten bleiben (parse_qs würde ein Leerzeichen daraus machen).
    raw = gzip_b64(SAMPLE)
    plus_payload = None
    for salt in range(400):
        candidate = changed(dlkd={"pssSaltCb": salt})
        if "+" in gzip_b64(candidate):
            plus_payload = candidate
            break
    assert plus_payload is not None
    assert parse_qr(f"devicelink:/1/?sn=SN12345&data={gzip_b64(plus_payload)}")
    assert parse_qr(f"devicelink:/1/?sn=SN12345&data={raw}")


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("https://example.com", "kein QR-Code der Windows-Gerätezuordnung"),
        ("devicelink:/1/?" + "a" * 5000, "zu groß"),
        ("devicelink:/1/?sn=SN12345", "fehlen"),
        ("devicelink:/1/?sn=SN12345&data=aGVsbG8=", "entpacken"),
        ("devicelink:/1/?sn=SN12345&data=***", "Base64"),
        ("devicelink:/1/?sn=SN12345&data=%FF", "Kodierung"),
    ],
)
def test_rejects_invalid_text(text: str, message: str) -> None:
    with pytest.raises(DeviceLinkError, match=message):
        parse_qr(text)


@pytest.mark.parametrize(
    ("payload", "serial", "message"),
    [
        (SAMPLE, "ANDERE", "Seriennummer passt nicht"),
        (changed(ver="2.0"), "SN12345", "Version"),
        (changed(dlkd={"skn": "NOPE"}), "SN12345", "Signaturschlüssel fehlt"),
        (changed(di={"li": "xyz"}), "SN12345", "Link-ID"),
        (changed(di={"sbu": "123"}), "SN12345", "SMBIOS"),
        (changed(dlict="12.5"), "SN12345", "Zeitstempel"),
        (changed(di={"kl": []}), "SN12345", "Geräteschlüssel"),
        (changed(dlkd={"sig": "!!"}), "SN12345", "Signatur"),
        ([1, 2], "SN12345", "kein Objekt"),
    ],
)
def test_rejects_invalid_content(payload: Any, serial: str, message: str) -> None:
    with pytest.raises(DeviceLinkError, match=message):
        parse_qr(make_qr(payload, serial=serial))


def test_rejects_gzip_bomb_and_not_json() -> None:
    bomb = base64.b64encode(gzip.compress(b"{" + b" " * 20_000 + b"}")).decode()
    with pytest.raises(DeviceLinkError, match="unerwartet groß"):
        parse_qr(f"devicelink:/1/?sn=SN12345&data={quote(bomb, safe='')}")
    not_json = base64.b64encode(gzip.compress(b"kein json")).decode()
    with pytest.raises(DeviceLinkError, match="kein gültiges JSON"):
        parse_qr(f"devicelink:/1/?sn=SN12345&data={quote(not_json, safe='')}")


PRIVATE = Path(__file__).with_name("fixtures-private")


@pytest.mark.skipif(not PRIVATE.is_dir(), reason="keine echten QR-Codes vorhanden (gewollt)")
def test_golden_real_devices() -> None:
    for qr_file in sorted(PRIVATE.glob("*.qr.txt")):
        device = scan_to_device(qr_file.read_text(encoding="utf-8"))
        expected = qr_file.with_name(qr_file.name.replace(".qr.txt", ".expected-devicelink.txt"))
        if expected.exists():
            assert device.device_link == expected.read_text(encoding="utf-8").strip()
