"""Einstiegspunkt der Werkbank-API."""

from fastapi import FastAPI, Response, status

from werkbank import __version__
from werkbank.config import Settings, get_settings
from werkbank.core.audit_api import router as audit_router
from werkbank.core.auth import router as auth_router
from werkbank.core.csrf import OriginCheckMiddleware
from werkbank.core.ratelimit import RateLimitMiddleware, default_rules
from werkbank.db import database_ready
from werkbank.modules.m365_config.api import router as m365_config_router
from werkbank.security import SecurityHeadersMiddleware
from werkbank.web import mount_frontend


def create_app(settings: Settings | None = None) -> FastAPI:
    """Erzeugt die FastAPI-Anwendung."""
    settings = settings or get_settings()
    settings.validate_for_startup()

    app = FastAPI(
        title="Werkbank",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings
    # Reihenfolge: zuletzt hinzugefügt = äußerste Schicht. Sicherheits-Header immer setzen.
    app.add_middleware(OriginCheckMiddleware, allowed_origin=settings.public_origin)
    app.add_middleware(RateLimitMiddleware, rules=default_rules(settings))
    app.add_middleware(SecurityHeadersMiddleware)
    app.include_router(auth_router)
    app.include_router(audit_router)
    app.include_router(m365_config_router)

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

    # Zuletzt: alle übrigen GET-Pfade liefern die Oberfläche aus.
    mount_frontend(app, settings.static_dir)
    return app


app = create_app()
