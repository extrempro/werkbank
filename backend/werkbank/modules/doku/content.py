"""Inhalt einer Seite: Dokument des Editors (Tiptap/ProseMirror) als JSON.

Der Server nimmt nur bekannte Bausteine, Auszeichnungen und Eigenschaften an (Positivliste) und
prüft Werte und Größe. Die Oberfläche baut daraus die Seite selbst auf; HTML wird nie gespeichert
oder ausgeliefert.
"""

import json
from typing import Any

# Größte Seite: Zeichen des JSON, Tiefe der Verschachtelung, Zahl der Bausteine
CONTENT_MAX_CHARS = 1_000_000
DEPTH_MAX = 40
NODES_MAX = 60_000
TEXT_MAX = 200_000
TITLE_MAX = 200

LINK_SCHEMES = ("https://", "mailto:")
# Verweise und Live-Bausteine (D3): nur Art, Kennung und Einstellungen, nie Titel oder Stand
REF_KINDS = ("ticket", "hardware", "stelle", "arbeitsplatz", "raum", "projekt", "vertrag")
LIVE_KINDS = ("tickets", "geraete", "projekt", "vertraege")
CALLOUT_KINDS = ("info", "warnung", "erfolg")


def _opt_id(value: object) -> bool:
    return value is None or (
        isinstance(value, int) and not isinstance(value, bool) and 0 < value < 2**31
    )


# Bausteine mit ihren erlaubten Eigenschaften und einer Prüfung je Wert
_NODES: dict[str, dict[str, Any]] = {
    "doc": {},
    "paragraph": {},
    "text": {},
    "heading": {"level": lambda v: v in (1, 2, 3)},
    "bulletList": {},
    "orderedList": {
        "start": lambda v: isinstance(v, int) and 0 <= v <= 100_000,
        "type": lambda v: v is None or v in ("1", "a", "A", "i", "I"),
    },
    "listItem": {},
    "taskList": {},
    "taskItem": {"checked": lambda v: isinstance(v, bool)},
    "blockquote": {},
    "codeBlock": {"language": lambda v: v is None or (isinstance(v, str) and len(v) <= 30)},
    "horizontalRule": {},
    "hardBreak": {},
    "table": {},
    "tableRow": {},
    "tableHeader": {},
    "tableCell": {},
    "callout": {"kind": lambda v: v in CALLOUT_KINDS},
    "werkbankRef": {
        "kind": lambda v: v in REF_KINDS,
        "id": lambda v: isinstance(v, str) and v.isdigit() and 0 < len(v) <= 12,
    },
    "liveBlock": {
        "kind": lambda v: v in LIVE_KINDS,
        "area": _opt_id,
        "status": lambda v: v is None or v in ("offen", "alle"),
        "q": lambda v: v is None or (isinstance(v, str) and len(v) <= 60),
        "floor": _opt_id,
        "room": _opt_id,
        "hwkind": _opt_id,
        "project": _opt_id,
        "months": lambda v: v is None or v in (3, 6, 12),
    },
}
_CELL_ATTRS = {
    "colspan": lambda v: isinstance(v, int) and 1 <= v <= 50,
    "rowspan": lambda v: isinstance(v, int) and 1 <= v <= 500,
    "colwidth": lambda v: (
        v is None or (isinstance(v, list) and len(v) <= 50 and all(isinstance(x, int) for x in v))
    ),
}
_NODES["tableHeader"] = _CELL_ATTRS
_NODES["tableCell"] = _CELL_ATTRS


def _valid_href(value: object) -> bool:
    if not isinstance(value, str) or not value or len(value) > 2000:
        return False
    if any(ord(ch) < 32 for ch in value):
        return False
    lower = value.lower()
    # Links innerhalb der Werkbank (z. B. auf eine andere Seite) oder https und mailto.
    # Kein Backslash in Pfaden: Browser lesen „/\host“ wie „//host“ (fremde Seite).
    return lower.startswith(LINK_SCHEMES) or (
        value.startswith("/") and not value.startswith("//") and "\\" not in value
    )


_MARKS: dict[str, dict[str, Any]] = {
    "bold": {},
    "italic": {},
    "strike": {},
    "underline": {},
    "code": {},
    "link": {
        "href": _valid_href,
        # Setzt der Editor selbst; der Server erzwingt feste Werte
        "target": lambda v: True,
        "rel": lambda v: True,
        "class": lambda v: True,
        "title": lambda v: v is None or (isinstance(v, str) and len(v) <= 300),
    },
}


class ContentError(ValueError):
    """Inhalt ist nicht erlaubt (Baustein, Eigenschaft, Größe)."""


def empty_doc() -> dict[str, Any]:
    return {"type": "doc", "content": [{"type": "paragraph"}]}


def _clean_attrs(kind: str, attrs: object, allowed: dict[str, Any]) -> dict[str, Any]:
    if attrs is None:
        return {}
    if not isinstance(attrs, dict):
        raise ContentError(f"Eigenschaften von „{kind}“ sind ungültig.")
    result: dict[str, Any] = {}
    for key, value in attrs.items():
        check = allowed.get(key)
        if check is None:
            # Unbekannte Eigenschaften (z. B. aus Erweiterungen des Editors) fallen weg
            continue
        if not check(value):
            raise ContentError(f"Wert von „{key}“ an „{kind}“ ist nicht erlaubt.")
        result[key] = value
    return result


class _Walker:
    def __init__(self) -> None:
        self.nodes = 0
        self.text: list[str] = []
        self.chars = 0

    def mark(self, mark: object) -> dict[str, Any]:
        if not isinstance(mark, dict) or mark.get("type") not in _MARKS:
            raise ContentError("Unbekannte Auszeichnung im Text.")
        kind = str(mark["type"])
        attrs = _clean_attrs(kind, mark.get("attrs"), _MARKS[kind])
        if kind == "link":
            if "href" not in attrs:
                raise ContentError("Link ohne Adresse.")
            # Feste Werte: neue Seite ohne Zugriff auf die Werkbank
            attrs["target"] = "_blank" if not str(attrs["href"]).startswith("/") else None
            attrs["rel"] = "noopener noreferrer nofollow"
            attrs["class"] = None
        return {"type": kind, "attrs": attrs} if attrs else {"type": kind}

    def node(self, node: object, depth: int) -> dict[str, Any]:
        if depth > DEPTH_MAX:
            raise ContentError("Der Inhalt ist zu tief verschachtelt.")
        self.nodes += 1
        if self.nodes > NODES_MAX:
            raise ContentError("Die Seite hat zu viele Bausteine.")
        if not isinstance(node, dict) or node.get("type") not in _NODES:
            raise ContentError("Unbekannter Baustein.")
        kind = str(node["type"])
        result: dict[str, Any] = {"type": kind}
        attrs = _clean_attrs(kind, node.get("attrs"), _NODES[kind])
        if attrs:
            result["attrs"] = attrs
        if kind == "text":
            value = node.get("text")
            if not isinstance(value, str) or not value:
                raise ContentError("Leerer Text.")
            value = "".join(ch for ch in value if ch in "\t" or ord(ch) >= 32)
            self.chars += len(value)
            if self.chars > TEXT_MAX:
                raise ContentError("Die Seite hat zu viel Text.")
            self.text.append(value)
            result["text"] = value
            marks = node.get("marks")
            if marks is not None:
                if not isinstance(marks, list) or len(marks) > 10:
                    raise ContentError("Auszeichnungen sind ungültig.")
                result["marks"] = [self.mark(mark) for mark in marks]
            return result
        children = node.get("content")
        if children is not None:
            if not isinstance(children, list):
                raise ContentError(f"Inhalt von „{kind}“ ist ungültig.")
            result["content"] = [self.node(child, depth + 1) for child in children]
        if kind in ("werkbankRef", "liveBlock") and "kind" not in attrs:
            raise ContentError("Verweis oder Live-Baustein ohne Art.")
        if kind == "werkbankRef" and "id" not in attrs:
            raise ContentError("Verweis ohne Kennung.")
        if kind in ("paragraph", "heading", "codeBlock", "tableCell", "tableHeader", "taskItem"):
            self.text.append("\n")
        return result


def clean_content(raw: object) -> tuple[dict[str, Any], str]:
    """Geprüfter Inhalt und sein reiner Text (für die Suche). Wirft ContentError."""
    if not isinstance(raw, dict) or raw.get("type") != "doc":
        raise ContentError("Der Inhalt muss ein Dokument sein.")
    walker = _Walker()
    doc = walker.node(raw, 0)
    if not doc.get("content"):
        doc = empty_doc()
    if doc_size(doc) > CONTENT_MAX_CHARS:
        raise ContentError("Die Seite ist zu groß.")
    text = " ".join("".join(walker.text).split())
    return doc, text


def doc_size(doc: dict[str, Any]) -> int:
    """Grobe Größe für die Grenze (Zeichen im JSON)."""
    return len(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
