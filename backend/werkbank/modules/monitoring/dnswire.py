"""DNS-Antworten im Wire-Format (RFC 1035) lesen, für den Abgleich mit NetBox.

Liefert die Antwort-Einträge in Präsentationsform, wie sie auch NetBox schreibt.
Unbekannte Typen erscheinen in der Form nach RFC 3597 (\\# Länge Hex).
"""

import ipaddress
from dataclasses import dataclass

TYPE_NAMES: dict[int, str] = {
    1: "A",
    2: "NS",
    5: "CNAME",
    6: "SOA",
    12: "PTR",
    15: "MX",
    16: "TXT",
    28: "AAAA",
    33: "SRV",
    39: "DNAME",
    99: "SPF",
    257: "CAA",
}
MAX_JUMPS = 64


class WireError(Exception):
    """Die Antwort lässt sich nicht lesen."""


@dataclass(frozen=True)
class Answer:
    name: str
    type: str
    ttl: int
    data: str


@dataclass(frozen=True)
class Response:
    rcode: int
    answers: list[Answer]


class _Reader:
    def __init__(self, buf: bytes) -> None:
        self.buf = buf
        self.pos = 0

    def need(self, count: int, at: int | None = None) -> None:
        if (self.pos if at is None else at) + count > len(self.buf):
            raise WireError("DNS-Antwort ist abgeschnitten.")

    def u8(self) -> int:
        self.need(1)
        value = self.buf[self.pos]
        self.pos += 1
        return value

    def u16(self) -> int:
        self.need(2)
        value = int.from_bytes(self.buf[self.pos : self.pos + 2], "big")
        self.pos += 2
        return value

    def u32(self) -> int:
        self.need(4)
        value = int.from_bytes(self.buf[self.pos : self.pos + 4], "big")
        self.pos += 4
        return value

    def take(self, count: int) -> bytes:
        self.need(count)
        value = self.buf[self.pos : self.pos + count]
        self.pos += count
        return value

    def name(self) -> str:
        """Name mit Kompressionszeigern, mit Punkt am Ende."""
        labels: list[str] = []
        pos = self.pos
        jumped = False
        jumps = 0
        while True:
            self.need(1, pos)
            length = self.buf[pos]
            if length == 0:
                pos += 1
                break
            if length & 0xC0 == 0xC0:
                self.need(2, pos)
                target = ((length & 0x3F) << 8) | self.buf[pos + 1]
                if not jumped:
                    self.pos = pos + 2
                jumped = True
                jumps += 1
                if jumps > MAX_JUMPS or target >= len(self.buf):
                    raise WireError("Fehlerhafte Namenskompression.")
                pos = target
                continue
            if length > 63:
                raise WireError("Ungültige Label-Länge.")
            self.need(length + 1, pos)
            labels.append(_escape_label(self.buf[pos + 1 : pos + 1 + length]))
            pos += length + 1
        if not jumped:
            self.pos = pos
        return ".".join(labels) + "." if labels else "."


def _escape_label(raw: bytes) -> str:
    out = []
    for byte in raw:
        char = chr(byte)
        if char in ".\\":
            out.append("\\" + char)
        elif byte < 0x21 or byte > 0x7E:
            out.append(f"\\{byte:03d}")
        else:
            out.append(char)
    return "".join(out)


def _character_string(reader: _Reader) -> str:
    raw = reader.take(reader.u8())
    out = []
    for byte in raw:
        if byte in (0x22, 0x5C):
            out.append("\\" + chr(byte))
        elif byte < 0x20 or byte > 0x7E:
            out.append(f"\\{byte:03d}")
        else:
            out.append(chr(byte))
    return '"' + "".join(out) + '"'


def _rdata(reader: _Reader, type_name: str, length: int) -> str:
    end = reader.pos + length
    reader.need(length)
    if type_name == "A" and length == 4:
        value = str(ipaddress.IPv4Address(reader.take(4)))
    elif type_name == "AAAA" and length == 16:
        value = str(ipaddress.IPv6Address(reader.take(16)))
    elif type_name in ("NS", "CNAME", "PTR", "DNAME"):
        value = reader.name()
    elif type_name == "MX":
        preference = reader.u16()
        value = f"{preference} {reader.name()}"
    elif type_name == "SRV":
        priority, weight, port = reader.u16(), reader.u16(), reader.u16()
        value = f"{priority} {weight} {port} {reader.name()}"
    elif type_name in ("TXT", "SPF"):
        parts = []
        while reader.pos < end:
            parts.append(_character_string(reader))
        value = " ".join(parts)
    elif type_name == "SOA":
        mname, rname = reader.name(), reader.name()
        numbers = [reader.u32() for _ in range(5)]
        value = " ".join([mname, rname, *map(str, numbers)])
    elif type_name == "CAA" and length >= 2:
        flags = reader.u8()
        tag = reader.take(reader.u8()).decode("ascii", "replace")
        content = reader.take(end - reader.pos).decode("utf-8", "replace")
        escaped = content.replace("\\", "\\\\").replace('"', '\\"')
        value = f'{flags} {tag} "{escaped}"'
    else:
        raw = reader.take(length)
        value = f"\\# {length} {raw.hex().upper()}"
    if reader.pos != end:
        raise WireError("Fehlerhafte Länge eines Eintrags.")
    return value


def parse_response(buf: bytes) -> Response:
    """Kopf und Antwort-Abschnitt; Authority und Additional werden nicht gebraucht."""
    reader = _Reader(buf)
    reader.u16()
    flags = reader.u16()
    questions, answers = reader.u16(), reader.u16()
    reader.u16()
    reader.u16()
    for _ in range(questions):
        reader.name()
        reader.u16()
        reader.u16()
    out: list[Answer] = []
    for _ in range(answers):
        name = reader.name()
        code = reader.u16()
        reader.u16()
        ttl = reader.u32()
        length = reader.u16()
        type_name = TYPE_NAMES.get(code, f"TYPE{code}")
        out.append(
            Answer(
                name=name.lower(), type=type_name, ttl=ttl, data=_rdata(reader, type_name, length)
            )
        )
    return Response(rcode=flags & 0x0F, answers=out)
