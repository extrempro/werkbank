"""Lesender Zugriff auf die JSON-RPC-API von Zabbix (7.x und 8.0).

Alle Unterschiede zwischen den Versionen liegen hier, nicht im übrigen Code. Anmeldung nur mit
API-Token im Header `Authorization: Bearer …`, nie mit `auth` im Body. Keine `hostinterface.*`-
Methoden: die gibt es in 8.0 nicht mehr; Schnittstellen kommen über `host.get`.

Zabbix steht meist im internen Netz. Erreicht wird nur die eine eingetragene https-Adresse, ohne
Weiterleitungen, mit TLS-Prüfung (optional gegen ein eigenes CA-Zertifikat).
"""

import json
import re
import ssl
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

import httpx

API_PATH = "api_jsonrpc.php"
TIMEOUT_SECONDS = 10.0
MAX_RESPONSE_BYTES = 20 * 1024 * 1024
URL_MAX = 300
# Unterstützte Hauptversionen; andere laufen weiter, die Verbindungsseite weist darauf hin
SUPPORTED_MAJORS = (7, 8)

# Methoden, die die Werkbank aufruft. role.get und token.get dienen nur der Prüfung des
# Dienstkontos (Rechte der Rolle, Ablauf des Tokens).
NEEDED_METHODS: tuple[str, ...] = (
    "problem.get",
    "trigger.get",
    "host.get",
    "hostgroup.get",
    "maintenance.get",
    "event.get",
    "role.get",
    "token.get",
)


class ZabbixError(Exception):
    """Zabbix ließ sich nicht lesen; die Meldung ist für Menschen gedacht."""


def valid_zabbix_url(value: str) -> bool:
    """https-Adresse der Zabbix-Oberfläche ohne Benutzerangaben, Abfrage und Fragment."""
    if not value or len(value) > URL_MAX or any(ord(char) < 33 for char in value):
        return False
    parts = urlsplit(value)
    return (
        parts.scheme == "https"
        and bool(parts.hostname)
        and parts.username is None
        and parts.password is None
        and not parts.query
        and not parts.fragment
        and not parts.path.endswith(".php")
    )


@dataclass(frozen=True)
class ZabbixConfig:
    # Adresse der Oberfläche, z. B. https://zabbix.example.com (ohne api_jsonrpc.php)
    url: str
    token: str
    ca_pem: str | None = None

    @property
    def api_url(self) -> str:
        return f"{self.url.rstrip('/')}/{API_PATH}"


# Sendet eine JSON-RPC-Anfrage: Konfiguration, Body, mit Token? → Antwort (dict)
Transport = Callable[[ZabbixConfig, dict[str, Any], bool], Any]


def _verify(config: ZabbixConfig) -> ssl.SSLContext | bool:
    if not config.ca_pem:
        return True
    context = ssl.create_default_context()
    try:
        context.load_verify_locations(cadata=config.ca_pem)
    except ssl.SSLError as error:
        raise ZabbixError("Das CA-Zertifikat für Zabbix lässt sich nicht lesen.") from error
    return context


def redirect_message(status: int, location: str | None) -> str:
    """Weiterleitung: die Werkbank folgt ihr nie (das Token bliebe sonst nicht bei Zabbix).

    Genannt wird nur Host und Pfad des Ziels, ohne Abfrage (dort stehen oft Sitzungsdaten
    einer Anmeldeseite)."""
    target = ""
    if location:
        parts = urlsplit(location.strip()[:URL_MAX])
        target = f"{parts.netloc}{parts.path}" if parts.netloc else parts.path
    hint = (
        "Steht davor ein Reverse Proxy mit Anmeldung, muss die Werkbank Zabbix ohne diese "
        "Anmeldung erreichen. Sonst die Adresse eintragen, auf die weitergeleitet wird."
    )
    if target:
        return f"Zabbix leitet weiter (HTTP {status}) nach „{_text(target, 150)}“. {hint}"
    return f"Zabbix leitet weiter (HTTP {status}). {hint}"


def http_transport(config: ZabbixConfig, body: dict[str, Any], with_token: bool) -> Any:
    headers = {"Content-Type": "application/json-rpc", "Accept": "application/json"}
    if with_token:
        headers["Authorization"] = f"Bearer {config.token}"
    try:
        with (
            httpx.Client(
                timeout=TIMEOUT_SECONDS, follow_redirects=False, verify=_verify(config)
            ) as client,
            client.stream("POST", config.api_url, content=json.dumps(body), headers=headers) as res,
        ):
            if 300 <= res.status_code < 400:
                raise ZabbixError(redirect_message(res.status_code, res.headers.get("location")))
            if res.status_code in (401, 403):
                # Zabbix selbst antwortet auch bei falschem Token mit HTTP 200 und einem
                # JSON-Fehler; 401/403 kommen meist von einem Proxy oder Webserver davor.
                raise ZabbixError(
                    f"Die Anfrage wird mit HTTP {res.status_code} abgelehnt, bevor sie Zabbix "
                    "erreicht, meist von einem Reverse Proxy, einer Zugriffsregel oder dem "
                    "Webserver davor. Das Token wurde dabei nicht geprüft."
                )
            if res.status_code != 200:
                raise ZabbixError(f"Zabbix antwortet mit HTTP {res.status_code}.")
            data = bytearray()
            for chunk in res.iter_bytes():
                data.extend(chunk)
                if len(data) > MAX_RESPONSE_BYTES:
                    raise ZabbixError("Die Antwort von Zabbix ist zu groß.")
    except httpx.TimeoutException as error:
        raise ZabbixError("Zabbix antwortet nicht rechtzeitig.") from error
    except httpx.ConnectError as error:
        text = str(error)
        if "CERTIFICATE_VERIFY_FAILED" in text or "certificate" in text.lower():
            raise ZabbixError(
                "Das Zertifikat von Zabbix ist nicht vertrauenswürdig. "
                "Bitte hinterlege das CA-Zertifikat in der Verwaltung."
            ) from error
        raise ZabbixError("Zabbix ist nicht erreichbar. Bitte prüf die Adresse.") from error
    except httpx.HTTPError as error:
        raise ZabbixError("Zabbix ist nicht erreichbar. Bitte prüf die Adresse.") from error
    try:
        return json.loads(bytes(data))
    except ValueError as error:
        raise ZabbixError("Die Antwort von Zabbix ist kein JSON. Stimmt die Adresse?") from error


@dataclass(frozen=True)
class Version:
    major: int
    minor: int
    text: str

    @property
    def supported(self) -> bool:
        return self.major in SUPPORTED_MAJORS


def parse_version(text: str) -> Version:
    match = re.match(r"^\s*(\d+)\.(\d+)", text or "")
    if not match:
        raise ZabbixError("Zabbix meldet eine unbekannte Version.")
    return Version(int(match.group(1)), int(match.group(2)), text.strip()[:40])


# ---------- Ergebnisse, unabhängig von der Version ----------


@dataclass(frozen=True)
class Interface:
    type: str  # agent, snmp, ipmi, jmx
    address: str
    port: str
    main: bool
    # True erreichbar, False nicht erreichbar, None unbekannt
    available: bool | None


@dataclass(frozen=True)
class Host:
    hostid: str
    host: str
    name: str
    monitored: bool
    in_maintenance: bool
    maintenanceid: str | None
    interfaces: list[Interface]
    # Aktiver Agent (ohne Schnittstelle): True, False oder None (unbekannt bzw. nicht genutzt)
    active_available: bool | None
    groups: list[tuple[str, str]] = field(default_factory=list)
    templates: list[str] = field(default_factory=list)
    serial: str = ""
    model: str = ""
    kind: str = ""

    @property
    def reachable(self) -> bool | None:
        """Erreichbar, wenn eine genutzte Schnittstelle erreichbar ist; None, wenn unbekannt."""
        states = [item.available for item in self.interfaces if item.available is not None]
        if self.active_available is not None:
            states.append(self.active_available)
        if not states:
            return None
        return any(states)


@dataclass(frozen=True)
class Problem:
    eventid: str
    triggerid: str
    name: str
    severity: int
    clock: int
    acknowledged: bool
    suppressed: bool
    tags: list[tuple[str, str]]


@dataclass(frozen=True)
class Event:
    """Beginn eines Problems aus event.get; r_eventid ist das Ende ("0": noch offen)."""

    eventid: str
    triggerid: str
    name: str
    severity: int
    clock: int
    r_eventid: str
    hostids: list[str]


# Tag, mit dem die Vorlagen von Zabbix „nicht erreichbar“ markieren
AVAILABILITY_TAG = ("scope", "availability")
# Ab Schweregrad Hoch zählt ein Problem als Ausfall
AVAILABILITY_SEVERITIES = (4, 5)
EVENTS_LIMIT = 20000


@dataclass(frozen=True)
class Maintenance:
    maintenanceid: str
    name: str
    with_data: bool
    active_since: int
    active_till: int
    hostids: list[str]
    groupids: list[str]
    # Einmalige Zeitfenster als (Beginn, Ende); wiederkehrende nur als Text
    once: list[tuple[int, int]]
    recurring: list[str]


@dataclass(frozen=True)
class RoleCheck:
    role: str
    api_access: bool
    # "allow" oder "deny"
    mode: str
    methods: list[str]


INTERFACE_TYPES = {"1": "agent", "2": "snmp", "3": "ipmi", "4": "jmx"}
TEXT_MAX = 255


def _text(value: Any, limit: int = TEXT_MAX) -> str:
    return str(value if value is not None else "")[:limit]


def _available(value: Any) -> bool | None:
    # 0 unbekannt, 1 erreichbar, 2 nicht erreichbar
    return {"1": True, "2": False}.get(str(value))


def _int(value: Any) -> int:
    try:
        return int(str(value))
    except ValueError:
        return 0


_DAYS = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")


def _describe_period(period: dict[str, Any]) -> str:
    """Wiederkehrendes Zeitfenster in Worten, z. B. „wöchentlich Di 20:00, 3 Std.“."""
    kind = str(period.get("timeperiod_type"))
    start = _int(period.get("start_time"))
    hours, minutes = divmod(start // 60, 60)
    length = _int(period.get("period"))
    duration = f"{length // 3600} Std." if length % 3600 == 0 else f"{round(length / 60)} Min."
    at = f"{hours:02d}:{minutes:02d}, {duration}"
    if kind == "2":
        every = _int(period.get("every")) or 1
        return f"täglich {at}" if every == 1 else f"alle {every} Tage {at}"
    if kind == "3":
        mask = _int(period.get("dayofweek"))
        days = " ".join(day for index, day in enumerate(_DAYS) if mask & (1 << index))
        return f"wöchentlich {days} {at}"
    if kind == "4":
        day = _int(period.get("day"))
        return f"monatlich am {day}. {at}" if day else f"monatlich {at}"
    return f"wiederkehrend {at}"


class ZabbixClient:
    """Liest aus Zabbix. Kennt die Version und kapselt die Unterschiede."""

    def __init__(self, config: ZabbixConfig, transport: Transport = http_transport) -> None:
        self.config = config
        self.transport = transport
        self._version: Version | None = None
        self._id = 0

    def call(self, method: str, params: Any, *, with_token: bool = True) -> Any:
        self._id += 1
        body = {"jsonrpc": "2.0", "method": method, "params": params, "id": self._id}
        data = self.transport(self.config, body, with_token)
        if not isinstance(data, dict):
            raise ZabbixError("Die Antwort von Zabbix hat ein unerwartetes Format.")
        error = data.get("error")
        if isinstance(error, dict):
            detail = _text(error.get("data") or error.get("message"), 200)
            lower = detail.lower()
            if "not authori" in lower or "session terminated" in lower:
                raise ZabbixError("Zabbix lehnt das Token ab (ungültig oder abgelaufen).")
            if "permission" in lower:
                raise ZabbixError(
                    f"Zabbix erlaubt „{method}“ nicht. Bitte prüf die Rolle des Dienstkontos."
                )
            raise ZabbixError(f"Zabbix meldet bei „{method}“: {detail}")
        if "result" not in data:
            raise ZabbixError("Die Antwort von Zabbix hat ein unerwartetes Format.")
        return data["result"]

    def _list(self, method: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        result = self.call(method, params)
        if not isinstance(result, list):
            raise ZabbixError(f"Zabbix liefert bei „{method}“ keine Liste.")
        return [item for item in result if isinstance(item, dict)]

    # ---------- Version ----------

    def version(self) -> Version:
        """apiinfo.version: Zabbix verlangt diese Abfrage ohne Token."""
        result = self.call("apiinfo.version", [], with_token=False)
        self._version = parse_version(str(result))
        return self._version

    # ---------- Probleme ----------

    def problems(self) -> list[Problem]:
        """Offene Probleme von Triggern (keine Quittierungs-Kommentare, keine Benutzer)."""
        rows = self._list(
            "problem.get",
            {
                "output": [
                    "eventid",
                    "objectid",
                    "name",
                    "severity",
                    "clock",
                    "acknowledged",
                    "suppressed",
                ],
                "source": 0,
                "object": 0,
                "selectTags": ["tag", "value"],
                "sortfield": ["eventid"],
                "sortorder": "DESC",
                "limit": 5000,
            },
        )
        return [
            Problem(
                eventid=_text(row.get("eventid"), 20),
                triggerid=_text(row.get("objectid"), 20),
                name=_text(row.get("name")),
                severity=min(max(_int(row.get("severity")), 0), 5),
                clock=_int(row.get("clock")),
                acknowledged=str(row.get("acknowledged")) == "1",
                suppressed=str(row.get("suppressed")) == "1",
                tags=[
                    (_text(tag.get("tag"), 100), _text(tag.get("value"), 100))
                    for tag in row.get("tags") or []
                    if isinstance(tag, dict)
                ][:20],
            )
            for row in rows
        ]

    def trigger_hosts(self, triggerids: list[str]) -> dict[str, list[str]]:
        """Trigger-ID → Host-IDs, nur für überwachte Trigger. problem.get nennt den Host nicht
        selbst und liefert auch Probleme, deren Trigger, Item oder Host inzwischen abgeschaltet
        ist; ``monitored`` lässt genau diese weg (wie die Problemansicht in Zabbix)."""
        out: dict[str, list[str]] = {}
        for start in range(0, len(triggerids), 500):
            chunk = triggerids[start : start + 500]
            for row in self._list(
                "trigger.get",
                {
                    "triggerids": chunk,
                    "monitored": True,
                    "output": ["triggerid"],
                    "selectHosts": ["hostid"],
                },
            ):
                out[_text(row.get("triggerid"), 20)] = [
                    _text(host.get("hostid"), 20)
                    for host in row.get("hosts") or []
                    if isinstance(host, dict)
                ]
        return out

    # ---------- Ereignisse (für die Berichte) ----------

    def problem_events(
        self, time_from: int, time_till: int, *, availability: bool = False
    ) -> list[Event]:
        """Probleme von Triggern, die in [time_from, time_till] begonnen haben.

        availability: nur Ausfälle (Tag scope: availability, ab Schweregrad Hoch)."""
        params: dict[str, Any] = {
            "output": ["eventid", "objectid", "name", "severity", "clock", "r_eventid"],
            "source": 0,
            "object": 0,
            "value": 1,
            "time_from": time_from,
            "time_till": time_till,
            "selectHosts": ["hostid"],
            "sortfield": ["clock", "eventid"],
            "sortorder": "ASC",
            "limit": EVENTS_LIMIT,
        }
        if availability:
            params["severities"] = list(AVAILABILITY_SEVERITIES)
            params["tags"] = [
                {"tag": AVAILABILITY_TAG[0], "value": AVAILABILITY_TAG[1], "operator": 1}
            ]
        rows = self._list("event.get", params)
        if len(rows) >= EVENTS_LIMIT:
            raise ZabbixError(
                f"Zabbix liefert mehr als {EVENTS_LIMIT} Probleme an einem Tag; "
                "die Berichte für diesen Tag wären unvollständig."
            )
        return [
            Event(
                eventid=_text(row.get("eventid"), 20),
                triggerid=_text(row.get("objectid"), 20),
                name=_text(row.get("name")),
                severity=min(max(_int(row.get("severity")), 0), 5),
                clock=_int(row.get("clock")),
                r_eventid=_text(row.get("r_eventid"), 20) or "0",
                hostids=[
                    _text(host.get("hostid"), 20)
                    for host in row.get("hosts") or []
                    if isinstance(host, dict)
                ],
            )
            for row in rows
        ]

    def event_clocks(self, eventids: list[str]) -> dict[str, int]:
        """Zeitpunkt von Ereignissen (hier: Ende der Probleme)."""
        out: dict[str, int] = {}
        for start in range(0, len(eventids), 1000):
            chunk = eventids[start : start + 1000]
            for row in self._list("event.get", {"eventids": chunk, "output": ["eventid", "clock"]}):
                out[_text(row.get("eventid"), 20)] = _int(row.get("clock"))
        return out

    # ---------- Hosts ----------

    def hosts(self, *, details: bool) -> list[Host]:
        """Alle Hosts mit Zustand; mit details auch Gruppen, Templates und Inventar."""
        params: dict[str, Any] = {
            "output": [
                "hostid",
                "host",
                "name",
                "status",
                "maintenance_status",
                "maintenanceid",
                "active_available",
            ],
            "selectInterfaces": ["type", "ip", "dns", "useip", "port", "main", "available"],
        }
        if details:
            params["selectHostGroups"] = ["groupid", "name"]
            params["selectParentTemplates"] = ["name"]
            params["selectInventory"] = ["serialno_a", "model", "type"]
        hosts: list[Host] = []
        for row in self._list("host.get", params):
            interfaces = [
                Interface(
                    type=INTERFACE_TYPES.get(str(item.get("type")), "andere"),
                    address=_text(
                        item.get("ip") if str(item.get("useip")) == "1" else item.get("dns"), 255
                    ),
                    port=_text(item.get("port"), 40),
                    main=str(item.get("main")) == "1",
                    available=_available(item.get("available")),
                )
                for item in row.get("interfaces") or []
                if isinstance(item, dict)
            ]
            raw_inventory = row.get("inventory")
            inventory: dict[str, Any] = raw_inventory if isinstance(raw_inventory, dict) else {}
            maintenanceid = _text(row.get("maintenanceid"), 20)
            hosts.append(
                Host(
                    hostid=_text(row.get("hostid"), 20),
                    host=_text(row.get("host")),
                    name=_text(row.get("name") or row.get("host")),
                    monitored=str(row.get("status")) == "0",
                    in_maintenance=str(row.get("maintenance_status")) == "1",
                    maintenanceid=maintenanceid if maintenanceid not in ("", "0") else None,
                    interfaces=interfaces,
                    active_available=_available(row.get("active_available")),
                    groups=[
                        (_text(group.get("groupid"), 20), _text(group.get("name")))
                        for group in row.get("hostgroups") or []
                        if isinstance(group, dict)
                    ],
                    templates=sorted(
                        _text(item.get("name"))
                        for item in row.get("parentTemplates") or []
                        if isinstance(item, dict)
                    ),
                    serial=_text(inventory.get("serialno_a"), 80).strip(),
                    model=_text(inventory.get("model"), 80).strip(),
                    kind=_text(inventory.get("type"), 80).strip(),
                )
            )
        return hosts

    def hostgroups(self) -> list[tuple[str, str]]:
        rows = self._list("hostgroup.get", {"output": ["groupid", "name"], "with_hosts": True})
        return sorted(
            ((_text(row.get("groupid"), 20), _text(row.get("name"))) for row in rows),
            key=lambda item: item[1].lower(),
        )

    # ---------- Wartungen ----------

    def maintenances(self) -> list[Maintenance]:
        """Wartungen. Den Zustand (läuft, demnächst, abgelaufen) errechnet die Werkbank selbst:
        die API liefert ihn nicht, und die Oberfläche von 8.0 nennt „Approaching“ jetzt
        „Upcoming“."""
        rows = self._list(
            "maintenance.get",
            {
                "output": [
                    "maintenanceid",
                    "name",
                    "maintenance_type",
                    "active_since",
                    "active_till",
                ],
                "selectHosts": ["hostid"],
                "selectHostGroups": ["groupid"],
                "selectTimeperiods": "extend",
            },
        )
        out: list[Maintenance] = []
        for row in rows:
            once: list[tuple[int, int]] = []
            recurring: list[str] = []
            for period in row.get("timeperiods") or []:
                if not isinstance(period, dict):
                    continue
                if str(period.get("timeperiod_type")) == "0":
                    start = _int(period.get("start_date"))
                    once.append((start, start + _int(period.get("period"))))
                else:
                    recurring.append(_describe_period(period))
            out.append(
                Maintenance(
                    maintenanceid=_text(row.get("maintenanceid"), 20),
                    name=_text(row.get("name")),
                    with_data=str(row.get("maintenance_type")) == "0",
                    active_since=_int(row.get("active_since")),
                    active_till=_int(row.get("active_till")),
                    hostids=[
                        _text(item.get("hostid"), 20)
                        for item in row.get("hosts") or []
                        if isinstance(item, dict)
                    ],
                    groupids=[
                        _text(item.get("groupid"), 20)
                        for item in row.get("hostgroups") or []
                        if isinstance(item, dict)
                    ],
                    once=sorted(once),
                    recurring=recurring[:10],
                )
            )
        return out

    # ---------- Dienstkonto ----------

    def own_user(self) -> tuple[str, str]:
        """User-ID und Rollen-ID des Dienstkontos (user.checkAuthentication mit dem Token)."""
        result = self.call(
            "user.checkAuthentication", {"token": self.config.token}, with_token=False
        )
        if not isinstance(result, dict):
            raise ZabbixError("Zabbix nennt das Dienstkonto nicht.")
        return _text(result.get("userid"), 20), _text(result.get("roleid"), 20)

    def role(self, roleid: str) -> RoleCheck:
        rows = self._list(
            "role.get",
            {
                "roleids": [roleid],
                "output": ["name"],
                "selectRules": ["api.access", "api.mode", "api"],
            },
        )
        if not rows:
            raise ZabbixError("Zabbix zeigt die Rolle des Dienstkontos nicht.")
        raw_rules = rows[0].get("rules")
        rules: dict[str, Any] = raw_rules if isinstance(raw_rules, dict) else {}
        raw_methods = rules.get("api")
        methods: list[Any] = raw_methods if isinstance(raw_methods, list) else []
        return RoleCheck(
            role=_text(rows[0].get("name"), 100),
            api_access=str(rules.get("api.access")) == "1",
            mode="allow" if str(rules.get("api.mode")) == "1" else "deny",
            methods=sorted({_text(method, 100) for method in methods})[:200],
        )

    def token_expiry(self, userid: str) -> int | None:
        """Ablauf des Tokens des Dienstkontos (Unix-Zeit), 0 = läuft nicht ab, None = unbekannt.

        Die API nennt nicht, welches Token gerade benutzt wird; maßgeblich ist das aktive Token
        des Dienstkontos, das zuerst abläuft."""
        rows = self._list(
            "token.get",
            {"userids": [userid], "output": ["expires_at", "status"]},
        )
        active = [_int(row.get("expires_at")) for row in rows if str(row.get("status")) == "0"]
        if not active:
            return None
        expiring = [value for value in active if value > 0]
        return min(expiring) if expiring else 0


def role_findings(check: RoleCheck) -> list[str]:
    """Warnungen zur Rolle: Platzhalter, Ablehn-Liste, mehr als nötig, Schreibmethoden."""
    if not check.api_access:
        return ["Die Rolle erlaubt keinen API-Zugriff."]
    if check.mode == "deny":
        return [
            "Die Rolle arbeitet mit einer Ablehn-Liste und erlaubt damit fast alle Methoden. "
            "Bitte richte eine Allow-Liste mit den nötigen Methoden ein."
        ]
    if not check.methods:
        return ["Die Allow-Liste der Rolle ist leer; ab Zabbix 8.0 sperrt das jeden Zugriff."]
    findings: list[str] = []
    wildcard = [method for method in check.methods if "*" in method]
    if wildcard:
        findings.append(
            "Die Rolle erlaubt Methoden mit Platzhalter („" + "“, „".join(wildcard[:5]) + "“)."
        )
    extra = [
        method for method in check.methods if "*" not in method and method not in NEEDED_METHODS
    ]
    writing = [
        method
        for method in extra
        if not method.endswith(".get") and method not in ("apiinfo.version",)
    ]
    if writing:
        findings.append("Die Rolle erlaubt schreibende Methoden: " + ", ".join(writing[:8]) + ".")
    reading = [method for method in extra if method not in writing]
    if reading:
        findings.append("Die Rolle erlaubt mehr als nötig: " + ", ".join(reading[:8]) + ".")
    missing = [method for method in NEEDED_METHODS if method not in check.methods and not wildcard]
    if missing:
        findings.append("Es fehlen: " + ", ".join(missing) + ".")
    return findings
