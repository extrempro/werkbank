"""Einstiegspunkt der Werkbank-API."""

from fastapi import FastAPI, Response, status

from werkbank import __version__
from werkbank.config import Settings, get_settings
from werkbank.core.admin_settings import router as admin_settings_router
from werkbank.core.audit_api import router as audit_router
from werkbank.core.auth import router as auth_router
from werkbank.core.avatar import router as avatar_router
from werkbank.core.branding import router as branding_router
from werkbank.core.csrf import OriginCheckMiddleware
from werkbank.core.notifications import router as notifications_router
from werkbank.core.push import router as push_router
from werkbank.core.ratelimit import RateLimitMiddleware, default_rules
from werkbank.core.search import router as search_router
from werkbank.core.tasks import router as tasks_router
from werkbank.db import database_ready
from werkbank.modules.budget.api import router as budget_router
from werkbank.modules.budget.imports import router as budget_imports_router
from werkbank.modules.budget.search import budget_search
from werkbank.modules.budget.tasks import budget_tasks
from werkbank.modules.evergreen.api import router as evergreen_router
from werkbank.modules.evergreen.search import evergreen_search
from werkbank.modules.evergreen.tasks import evergreen_tasks
from werkbank.modules.evergreen.workflow import evergreen_workflow
from werkbank.modules.inventory.api import router as inventory_router
from werkbank.modules.inventory.locations import router as inventory_locations_router
from werkbank.modules.inventory.search import inventory_search
from werkbank.modules.inventory.staff import router as inventory_staff_router
from werkbank.modules.m365_config.api import router as m365_config_router
from werkbank.modules.m365_config.recommendations_api import router as recommendations_router
from werkbank.modules.m365_config.search import m365_config_search
from werkbank.modules.m365_config.snapshots_api import router as m365_snapshots_router
from werkbank.modules.m365_config.tasks import m365_config_tasks
from werkbank.modules.monitoring.admin import router as monitoring_admin_router
from werkbank.modules.monitoring.api import router as monitoring_router
from werkbank.modules.projects.api import router as projects_router
from werkbank.modules.projects.search import projects_search
from werkbank.modules.tenant.api import router as tenant_router
from werkbank.modules.tenant.tasks import tenant_tasks
from werkbank.modules.tenant.usage_api import router as tenant_usage_router
from werkbank.modules.tools.account import router as tools_account_router
from werkbank.modules.tools.api import router as tools_router
from werkbank.security import SecurityHeadersMiddleware
from werkbank.web import mount_frontend


def create_app(settings: Settings | None = None) -> FastAPI:
    """Erzeugt die FastAPI-Anwendung."""
    settings = settings or get_settings()
    settings.validate_for_startup()
    # Workflow-Beschreibungen beim Start prüfen: Ein Fehler darin soll sofort auffallen.
    evergreen_workflow()

    app = FastAPI(
        title="Werkbank",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = settings
    # Module, die Aufgaben für die Startseite melden
    app.state.task_providers = [
        m365_config_tasks,
        evergreen_tasks,
        tenant_tasks,
        budget_tasks,
    ]
    # Module, die Treffer für die Suche liefern
    app.state.search_providers = [
        m365_config_search,
        evergreen_search,
        budget_search,
        projects_search,
        inventory_search,
    ]
    # Reihenfolge: zuletzt hinzugefügt = äußerste Schicht. Sicherheits-Header immer setzen.
    app.add_middleware(OriginCheckMiddleware, allowed_origin=settings.public_origin)
    app.add_middleware(RateLimitMiddleware, rules=default_rules(settings))
    app.add_middleware(SecurityHeadersMiddleware)
    app.include_router(auth_router)
    app.include_router(audit_router)
    app.include_router(avatar_router)
    app.include_router(admin_settings_router)
    app.include_router(branding_router)
    app.include_router(search_router)
    app.include_router(tasks_router)
    app.include_router(push_router)
    app.include_router(notifications_router)
    app.include_router(m365_snapshots_router)
    app.include_router(m365_config_router)
    app.include_router(recommendations_router)
    app.include_router(tenant_router)
    app.include_router(tenant_usage_router)
    app.include_router(budget_router)
    app.include_router(budget_imports_router)
    app.include_router(projects_router)
    app.include_router(inventory_router)
    app.include_router(inventory_locations_router)
    app.include_router(inventory_staff_router)
    app.include_router(tools_router)
    app.include_router(tools_account_router)
    app.include_router(monitoring_router)
    app.include_router(monitoring_admin_router)
    app.include_router(evergreen_router)

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
