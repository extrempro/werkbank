"""CSRF-Schutz: verändernde Anfragen nur von der eigenen Origin (zusätzlich zu SameSite)."""

from collections.abc import Awaitable, Callable
from urllib.parse import urlsplit

from fastapi import Request, Response, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _origin_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


class OriginCheckMiddleware(BaseHTTPMiddleware):
    """Weist POST, PUT, PATCH und DELETE ab, wenn Origin bzw. Referer fremd sind oder fehlen."""

    def __init__(self, app: ASGIApp, allowed_origin: str) -> None:
        super().__init__(app)
        self.allowed_origin = allowed_origin

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        if request.method not in SAFE_METHODS:
            origin = request.headers.get("origin")
            referer = request.headers.get("referer")
            source = origin or (_origin_of(referer) if referer else None)
            if source != self.allowed_origin:
                return JSONResponse(
                    {"detail": "Anfrage von fremder Herkunft abgewiesen"},
                    status_code=status.HTTP_403_FORBIDDEN,
                )
        return await call_next(request)
