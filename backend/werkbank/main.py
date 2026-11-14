"""Einstiegspunkt der Werkbank-API."""

from fastapi import FastAPI

from werkbank import __version__
from werkbank.security import SecurityHeadersMiddleware


def create_app() -> FastAPI:
    """Erzeugt die FastAPI-Anwendung."""
    app = FastAPI(
        title="Werkbank",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/health", include_in_schema=False)
    def health() -> dict[str, str]:
        """Healthcheck für Docker und Reverse Proxy. Enthält bewusst keine Details."""
        return {"status": "ok"}

    return app


app = create_app()
