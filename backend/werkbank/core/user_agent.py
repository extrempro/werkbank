"""Kurzbeschreibung eines Geräts aus der Browserkennung, z. B. „Edge unter Windows“.

Gespeichert wird nur dieser Text aus festen Wörtern, nie die Kennung selbst und keine IP-Adresse.
"""

# Reihenfolge zählt: Edge und Opera geben sich zusätzlich als Chrome und Safari aus,
# Chrome als Safari.
_BROWSERS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("Edg/", "EdgA/", "EdgiOS/"), "Edge"),
    (("OPR/", "Opera"), "Opera"),
    (("Firefox/", "FxiOS/"), "Firefox"),
    (("SamsungBrowser/",), "Samsung Internet"),
    (("CriOS/", "Chrome/", "Chromium/"), "Chrome"),
    (("Safari/",), "Safari"),
)

# iPhone und iPad vor macOS (iPads melden sich teils als „Macintosh“), Android vor Linux.
_SYSTEMS: tuple[tuple[str, str], ...] = (
    ("iPhone", "auf dem iPhone"),
    ("iPad", "auf dem iPad"),
    ("Android", "unter Android"),
    ("Windows", "unter Windows"),
    ("CrOS", "unter ChromeOS"),
    ("Macintosh", "unter macOS"),
    ("Mac OS X", "unter macOS"),
    ("Linux", "unter Linux"),
)

UNKNOWN = "Unbekanntes Gerät"


def describe_device(user_agent: str | None) -> str:
    """„Browser unter System“ aus der Kennung; „Unbekanntes Gerät“, wenn nichts passt."""
    if not user_agent:
        return UNKNOWN
    text = user_agent[:512]
    browser = next((name for marks, name in _BROWSERS if any(mark in text for mark in marks)), None)
    system = next((name for mark, name in _SYSTEMS if mark in text), None)
    if browser and system:
        return f"{browser} {system}"
    if browser:
        return browser
    if system:
        return f"Browser {system}"
    return UNKNOWN
