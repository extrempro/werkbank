"""Texte aus fremden Quellen: HTML wird zu reinem Text, bevor es gespeichert wird."""

from html.parser import HTMLParser

BODY_MAX_LENGTH = 20_000
BLOCK_TAGS = frozenset({"p", "br", "div", "li", "tr", "h1", "h2", "h3", "h4", "ul", "ol", "table"})
SKIPPED_TAGS = frozenset({"script", "style"})


class _TextExtractor(HTMLParser):
    """Macht aus HTML reinen Text. Skripte und Formatierung entfallen."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in SKIPPED_TAGS:
            self._skip += 1
        elif tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in SKIPPED_TAGS:
            self._skip = max(self._skip - 1, 0)
        elif tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.parts.append(data)


def html_to_text(html: str | None) -> str | None:
    """Text ohne HTML, mit höchstens einer Leerzeile zwischen Absätzen."""
    if not html:
        return None
    parser = _TextExtractor()
    parser.feed(html)
    parser.close()
    lines = [" ".join(line.split()) for line in "".join(parser.parts).splitlines()]
    result: list[str] = []
    for line in lines:
        if line or (result and result[-1]):
            result.append(line)
    text = "\n".join(result).strip()
    return text[:BODY_MAX_LENGTH] or None
