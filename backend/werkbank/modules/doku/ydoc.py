"""Umwandlung zwischen dem gemeinsamen Dokument (Yjs) und dem JSON des Editors (ProseMirror).

Aufbau wie im Browser (`@tiptap/y-tiptap`): Das Dokument hat ein XmlFragment `default`. Jeder
Baustein ist ein XmlElement mit dem Namen des Bausteins und seinen Eigenschaften als Attribute.
Text steht in XmlText; Auszeichnungen sind Formatierungen `{name: eigenschaften}` (bei
überlappenden Auszeichnungen mit Anhängsel `name--hash`).
"""

import re
from typing import Any

from pycrdt import Doc, XmlElement, XmlFragment, XmlText

FIELD = "default"
_HASHED = re.compile(r"^(.*)(--[a-zA-Z0-9+/=]{8})$")


def _mark_name(attr: str) -> str:
    match = _HASHED.match(attr)
    return match.group(1) if match else attr


def _text_nodes(text: XmlText) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    for value, attrs in text.diff():
        if not isinstance(value, str) or not value:
            continue
        node: dict[str, Any] = {"type": "text", "text": value}
        if attrs:
            marks = []
            for name, mark_attrs in attrs.items():
                mark: dict[str, Any] = {"type": _mark_name(name)}
                if isinstance(mark_attrs, dict) and mark_attrs:
                    mark["attrs"] = _plain(dict(mark_attrs))
                marks.append(mark)
            node["marks"] = marks
        nodes.append(node)
    return nodes


def _plain(value: Any) -> Any:
    """Zahlen kommen aus Yjs als Gleitkommazahl zurück; ganze Zahlen wieder als int."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [_plain(item) for item in value]
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    return value


def _element(element: XmlElement) -> dict[str, Any]:
    node: dict[str, Any] = {"type": element.tag or ""}
    attrs = {
        key: _plain(value) for key, value in element.attributes.__iter__() if value is not None
    }
    if attrs:
        node["attrs"] = attrs
    children = _children(element)
    if children:
        node["content"] = children
    return node


def _children(parent: XmlFragment | XmlElement) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for child in parent.children:
        if isinstance(child, XmlText):
            result.extend(_text_nodes(child))
        elif isinstance(child, XmlElement):
            result.append(_element(child))
    return result


def doc_to_json(doc: Doc[Any]) -> dict[str, Any]:
    """Gemeinsames Dokument → JSON des Editors (ungeprüft; danach `clean_content`)."""
    fragment = doc.get(FIELD, type=XmlFragment)
    return {"type": "doc", "content": _children(fragment)}


def _fill(parent: XmlFragment | XmlElement, content: list[dict[str, Any]]) -> None:
    run: list[dict[str, Any]] = []

    def flush() -> None:
        if not run:
            return
        text = parent.children.append(XmlText())
        position = 0
        for node in run:
            value = str(node.get("text", ""))
            marks = {
                str(mark["type"]): dict(mark.get("attrs") or {})
                for mark in node.get("marks") or []
                if isinstance(mark, dict) and mark.get("type")
            }
            text.insert(position, value, marks or None)
            position += len(value)
        run.clear()

    for node in content:
        if node.get("type") == "text":
            run.append(node)
            continue
        flush()
        attrs = {k: v for k, v in (node.get("attrs") or {}).items() if v is not None}
        element = parent.children.append(XmlElement(str(node["type"])))
        for key, value in attrs.items():
            element.attributes[key] = value
        _fill(element, list(node.get("content") or []))
    flush()


def json_to_doc(content: dict[str, Any]) -> Doc[Any]:
    """JSON des Editors (geprüft) → neues gemeinsames Dokument."""
    doc: Doc[Any] = Doc()
    fragment = doc.get(FIELD, type=XmlFragment)
    with doc.transaction():
        _fill(fragment, list(content.get("content") or []))
    return doc


def doc_state(doc: Doc[Any]) -> bytes:
    """Vollständiger Stand zum Speichern."""
    return doc.get_update()


def doc_from_state(state: bytes) -> Doc[Any]:
    doc: Doc[Any] = Doc()
    doc.apply_update(state)
    return doc
