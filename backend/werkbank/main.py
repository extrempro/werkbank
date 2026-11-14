"""Einstiegspunkt der Werkbank-API."""

from fastapi import FastAPI, Response, status

from werkbank import __version__
from werkbank.db import database_ready
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
        """Lebenszeichen für Docker. Enthält bewusst keine Details."""
        return {"status": "ok"}

    @app.get("/health/ready", include_in_schema=False)
    def ready(response: Response) -> dict[str, str]:
        """Bereitschaft: Datenbank erreichbar. Enthält bewusst keine Details."""
        if database_ready():
            return {"status": "ok"}
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "unavailable"}

    return app


app = create_app()
