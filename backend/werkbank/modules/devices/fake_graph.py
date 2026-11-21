"""Nachgestellte Graph-API für automatische Tests (nur test/development mit Testanmeldung).

Verhalten nach Seriennummer (erfundene Testdaten):
- enthält „DOPPELT“: es gibt schon einen Eintrag bei Microsoft
- enthält „FEHLER500“: Import scheitert mit 500
- enthält „OHNERECHT“: Import scheitert mit 403
Sonst: Import gelingt, Status „preassociated“.
"""

import uuid
from typing import Any

from werkbank.modules.devices.graph import AssociatedDevice, GraphError, ManagedDevice, Policy

_DEVICES: dict[str, AssociatedDevice] = {}

POLICIES = [
    Policy("00000000-0000-0000-0000-0000000000a1", "Testrichtlinie Büro"),
    Policy("00000000-0000-0000-0000-0000000000a2", "Testrichtlinie Labor"),
]


class FakeDeviceGraph:
    def list_policies(self) -> list[Policy]:
        return list(POLICIES)

    def find_by_serial(self, serial: str) -> list[AssociatedDevice]:
        if "DOPPELT" in serial.upper():
            return [
                AssociatedDevice(
                    "fake-doppelt", serial, "BEISPIEL", "Modell", "associated", None, None, None
                )
            ]
        return [d for d in _DEVICES.values() if d.serial_number == serial]

    def import_device(self, device_link: str, policy_id: str | None) -> AssociatedDevice:
        import base64
        import json

        info: dict[str, Any] = json.loads(base64.b64decode(device_link))["DeviceInfo"]
        serial = str(info["SerialNumber"])
        upper = serial.upper()
        if "FEHLER500" in upper:
            raise GraphError("Internal error", 500, "InternalError", "00000000-test-0500")
        if "OHNERECHT" in upper:
            raise GraphError("Forbidden", 403, "Forbidden", "00000000-test-0403")
        device = AssociatedDevice(
            str(uuid.uuid4()),
            serial,
            str(info["Manufacturer"]),
            str(info["ModelName"]),
            "preassociated",
            policy_id,
            None,
            None,
        )
        _DEVICES[device.id] = device
        return device

    def get_device(self, device_id: str) -> AssociatedDevice:
        device = _DEVICES.get(device_id)
        if device is None:
            raise GraphError("Not found", 404, "NotFound", None)
        return device

    def confirm(self, device_id: str) -> AssociatedDevice:
        return self.get_device(device_id)

    def managed_device(self, device_id: str) -> ManagedDevice | None:
        return None

    def managed_by_serial(self, serial: str) -> ManagedDevice | None:
        return None

    def me(self) -> dict[str, str]:
        return {"name": "Test-Admin", "upn": "admin@example.com"}

    def organization(self) -> str:
        return "Beispiel-Tenant"
