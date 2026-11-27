"""Begrenzung der Anfragerate je Absender-IP (Schutz vor Missbrauch, spec.md 12.1).

Gezählt wird im Arbeitsspeicher des Web-Dienstes in festen Fenstern von einer Minute. Das
genügt, solange genau ein Web-Prozess läuft (so ist die Werkbank ausgelegt). Gespeichert wird
nichts dauerhaft; die Zähler verfallen nach Ablauf des Fensters.
"""

import logging
import math
import threading
import time
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

from fastapi import Request, Response, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from werkbank.config import Settings
from werkbank.core.audit import truncate_ip

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 60.0
MAX_KEYS = 10_000


@dataclass(frozen=True)
class RateLimitRule:
    """Höchstzahl Anfragen pro Minute für Pfade, die mit einem der Präfixe beginnen."""

    name: str
    prefixes: tuple[str, ...]
    limit: int

    def matches(self, path: str) -> bool:
        return self.limit > 0 and path.startswith(self.prefixes)


@dataclass(frozen=True)
class Decision:
    allowed: bool
    retry_after: float = 0.0
    first_violation: bool = False


class RateLimiter:
    """Zähler mit festem Zeitfenster je Schlüssel."""

    def __init__(
        self,
        window_seconds: float = WINDOW_SECONDS,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = MAX_KEYS,
    ) -> None:
        self._window = window_seconds
        self._clock = clock
        self._max_keys = max_keys
        self._lock = threading.Lock()
        # Schlüssel -> (Beginn des Fensters, Anzahl im Fenster)
        self._counters: dict[str, tuple[float, int]] = {}

    def hit(self, key: str, limit: int) -> Decision:
        """Zählt eine Anfrage und sagt, ob sie noch erlaubt ist."""
        now = self._clock()
        with self._lock:
            start, count = self._counters.get(key, (now, 0))
            if now - start >= self._window:
                start, count = now, 0
            count += 1
            if key not in self._counters and len(self._counters) >= self._max_keys:
                self._drop_expired(now)
            self._counters[key] = (start, count)
        if count <= limit:
            return Decision(allowed=True)
        return Decision(
            allowed=False,
            retry_after=max(self._window - (now - start), 1.0),
            first_violation=count == limit + 1,
        )

    def _drop_expired(self, now: float) -> None:
        """Räumt abgelaufene Zähler weg; notfalls alle, damit der Speicher begrenzt bleibt."""
        self._counters = {
            key: value for key, value in self._counters.items() if now - value[0] < self._window
        }
        if len(self._counters) >= self._max_keys:
            self._counters.clear()


def default_rules(settings: Settings) -> list[RateLimitRule]:
    """Regeln der Werkbank: Anmeldung, Exporte, Abfragen der IT-Tools ins Internet, übrige API."""
    return [
        RateLimitRule(
            "anmeldung",
            ("/auth/login", "/auth/callback", "/auth/test-login"),
            settings.rate_limit_login_per_minute,
        ),
        # Bestätigung einer Ausgabe per Einmal-Link (ohne Anmeldung): so streng wie die Anmeldung
        RateLimitRule("bestaetigung", ("/api/public/",), settings.rate_limit_login_per_minute),
        RateLimitRule("export", ("/api/audit/export.csv",), settings.rate_limit_export_per_minute),
        RateLimitRule(
            "werkzeuge-netz", ("/api/tools/net/",), settings.rate_limit_tools_net_per_minute
        ),
        RateLimitRule("api", ("/api/",), settings.rate_limit_api_per_minute),
    ]


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Antwortet mit 429 und Retry-After, wenn eine Regel überschritten ist."""

    def __init__(
        self, app: ASGIApp, rules: Sequence[RateLimitRule], limiter: RateLimiter | None = None
    ) -> None:
        super().__init__(app)
        self.rules = tuple(rules)
        self.limiter = limiter or RateLimiter()

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        path = request.url.path
        ip = request.client.host if request.client else "unbekannt"
        for rule in self.rules:
            if not rule.matches(path):
                continue
            decision = self.limiter.hit(f"{rule.name}:{ip}", rule.limit)
            if decision.allowed:
                continue
            if decision.first_violation:
                logger.warning(
                    "Anfragerate überschritten: Regel %s, Absender %s", rule.name, truncate_ip(ip)
                )
            return JSONResponse(
                {"detail": "Zu viele Anfragen. Bitte versuch es später erneut."},
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                headers={"Retry-After": str(math.ceil(decision.retry_after))},
            )
        return await call_next(request)
