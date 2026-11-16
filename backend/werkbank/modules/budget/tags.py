"""Tags am Budgetposten: Schreibweise bereinigen und Posten nach Tags auswählen."""

from collections.abc import Iterable

TAG_MAX_LENGTH = 30
TAGS_MAX = 10
MODE_ANY = "any"
MODE_ALL = "all"


def clean_tag(value: str) -> str:
    """Ein Tag ohne Rand und doppelte Leerzeichen. Fehler bei Steuerzeichen, Komma, Überlänge."""
    if any(ord(char) < 32 for char in value):
        raise ValueError("Keine Zeilenumbrüche oder Steuerzeichen")
    tag = " ".join(value.split())
    if not tag:
        raise ValueError("Ein Tag darf nicht leer sein")
    if "," in tag:
        raise ValueError("Ein Tag darf kein Komma enthalten")
    if len(tag) > TAG_MAX_LENGTH:
        raise ValueError(f"Ein Tag darf höchstens {TAG_MAX_LENGTH} Zeichen haben")
    return tag


def clean_tags(values: Iterable[str]) -> list[str]:
    """Bereinigte Tags ohne Doppelte; Groß- und Kleinschreibung zählt dabei nicht."""
    seen: set[str] = set()
    tags: list[str] = []
    for value in values:
        tag = clean_tag(value)
        if tag.casefold() not in seen:
            seen.add(tag.casefold())
            tags.append(tag)
    if len(tags) > TAGS_MAX:
        raise ValueError(f"Höchstens {TAGS_MAX} Tags")
    return tags


def adopt_spelling(tags: list[str], known: Iterable[str]) -> list[str]:
    """Übernimmt für schon vergebene Tags deren Schreibweise („cloud“ wird zu „Cloud“)."""
    spelling: dict[str, str] = {}
    for tag in known:
        spelling.setdefault(tag.casefold(), tag)
    return [spelling.get(tag.casefold(), tag) for tag in tags]


def matches(item_tags: Iterable[str], wanted: Iterable[str], mode: str) -> bool:
    """Ob ein Posten zur Auswahl passt: einer der Tags (any) oder alle (all)."""
    own = {tag.casefold() for tag in item_tags}
    want = {tag.casefold() for tag in wanted}
    if not want:
        return False
    return want <= own if mode == MODE_ALL else bool(want & own)
