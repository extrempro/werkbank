"""Sicherheits-Header für alle Antworten (OWASP ASVS, siehe docs/security/asvs-l2.md)."""

from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

CONTENT_SECURITY_POLICY = "; ".join(
    [
        "default-src 'self'",
        # WebAssembly für den QR-Scanner der Gerätezuordnung; erlaubt kein JavaScript-eval
        "script-src 'self' 'wasm-unsafe-eval'",
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
        "manifest-src 'self'",
        "worker-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
    ]
)

SECURITY_HEADERS: dict[str, str] = {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}


# API, Anmeldung und Zustand: nie zwischenspeichern, weder im Browser noch in einem Proxy.
# Antworten, die eine eigene Regel setzen (z. B. Profilbilder, Branding), behalten sie.
NO_STORE_PREFIXES = ("/api/", "/auth/", "/health")
NO_STORE = "no-store"


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Setzt die Sicherheits-Header auf jeder Antwort."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        if request.url.path.startswith(NO_STORE_PREFIXES):
            response.headers.setdefault("Cache-Control", NO_STORE)
        return response
