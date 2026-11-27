"""Einstiegspunkt der Werkbank-API."""

import logging

from fastapi import FastAPI, Response, status

from werkbank import __version__
from werkbank.backup.api import router as backup_router
from werkbank.config import Settings, get_settings
from werkbank.core.account_sessions import router as account_sessions_router
from werkbank.core.admin_settings import router as admin_settings_router
from werkbank.core.audit_api import router as audit_router
from werkbank.core.auth import router as auth_router
from werkbank.core.avatar import router as avatar_router
from werkbank.core.branding import router as branding_router
from werkbank.core.csrf import OriginCheckMiddleware
from werkbank.core.navigation import router as navigation_router
from werkbank.core.notifications import router as notifications_router
from werkbank.core.permissions_api import router as permissions_router
from werkbank.core.push import router as push_router
from werkbank.core.ratelimit import RateLimitMiddleware, default_rules
from werkbank.core.search import router as search_router
from werkbank.core.tasks import router as tasks_router
from werkbank.db import database_ready
from werkbank.modules.budget.api import router as budget_router
from werkbank.modules.budget.imports import router as budget_imports_router
from werkbank.modules.budget.search import budget_search
from werkbank.modules.budget.tasks import budget_tasks
from werkbank.modules.devices.admin import router as devices_admin_router
from werkbank.modules.devices.api import router as devices_router
from werkbank.modules.devices.tasks import devices_tasks
from werkbank.modules.doku.admin_api import router as doku_admin_router
from werkbank.modules.doku.api import router as doku_router
from werkbank.modules.doku.collab import router as doku_live_router
from werkbank.modules.doku.d3_api import router as doku_d3_router
from werkbank.modules.evergreen.api import router as evergreen_router
from werkbank.modules.evergreen.search import evergreen_search
from werkbank.modules.evergreen.tasks import evergreen_tasks
from werkbank.modules.inventory.api import router as inventory_router
from werkbank.modules.inventory.cases import router as inventory_cases_router
from werkbank.modules.inventory.issues import public_router as inventory_issue_public_router
from werkbank.modules.inventory.issues import router as inventory_issues_router
from werkbank.modules.inventory.loans import router as inventory_loans_router
from werkbank.modules.inventory.locations import router as inventory_locations_router
from werkbank.modules.inventory.lookup import router as inventory_lookup_router
from werkbank.modules.inventory.ninja_admin import router as inventory_ninja_admin_router
from werkbank.modules.inventory.psref_sync import router as inventory_psref_router
from werkbank.modules.inventory.search import inventory_search
from werkbank.modules.inventory.staff import router as inventory_staff_router
from werkbank.modules.inventory.statistics import router as inventory_statistics_router
from werkbank.modules.inventory.tasks import inventory_tasks
from werkbank.modules.inventory.whereabouts import router as inventory_whereabouts_router
from werkbank.modules.m365_config.api import router as m365_config_router
from werkbank.modules.m365_config.permissions import router as collector_check_router
from werkbank.modules.m365_config.recommendations_api import router as recommendations_router
from werkbank.modules.m365_config.search import m365_config_search
from werkbank.modules.m365_config.snapshots_api import router as m365_snapshots_router
from werkbank.modules.m365_config.tasks import m365_config_tasks
from werkbank.modules.monitoring.admin import router as monitoring_admin_router
from werkbank.modules.monitoring.api import router as monitoring_router
from werkbank.modules.monitoring.zabbix.admin import router as zabbix_admin_router
from werkbank.modules.monitoring.zabbix.api import router as zabbix_router
from werkbank.modules.monitoring.zabbix.reports_api import router as zabbix_reports_router
from werkbank.modules.projects.api import router as projects_router
from werkbank.modules.projects.search import projects_search
from werkbank.modules.tenant.api import router as tenant_router
from werkbank.modules.tenant.tasks import tenant_tasks
from werkbank.modules.tenant.usage_api import router as tenant_usage_router
from werkbank.modules.tickets.achievements_api import router as tickets_achievements_router
from werkbank.modules.tickets.api import router as tickets_router
from werkbank.modules.tickets.mail_api import router as tickets_mail_router
from werkbank.modules.tickets.mail_api import test_router as tickets_mail_test_router
from werkbank.modules.tickets.mailbox import is_test
from werkbank.modules.tickets.ops_api import router as tickets_ops_router
from werkbank.modules.tickets.recent_api import router as tickets_recent_router
from werkbank.modules.tickets.settings_api import router as tickets_settings_router
from werkbank.modules.tickets.settings_api import test_router as tickets_test_router
from werkbank.modules.tickets.work_api import router as tickets_work_router
from werkbank.modules.tools.account import router as tools_account_router
from werkbank.modules.tools.api import router as tools_router
from werkbank.modules.tools.html_preview import router as tools_html_router
from werkbank.security import SecurityHeadersMiddleware
from werkbank.web import mount_frontend


def configure_logging(level: str) -> None:
    """Meldungen der Werkbank (Logger „werkbank.*“) ins Log des Containers, ab ``LOG_LEVEL``.

    uvicorn richtet nur seine eigenen Logger ein; ohne das gingen Hinweise und Warnungen aus
    Anfragen verloren.
    """
    logger = logging.getLogger("werkbank")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        logger.addHandler(handler)
        # nicht zusätzlich an den Root-Logger weiterreichen (sonst doppelt, falls der Server
        # selbst einen einrichtet)
        logger.propagate = False
    logger.setLevel(level.upper())


def create_app(settings: Settings | None = None) -> FastAPI:
    """Erzeugt die FastAPI-Anwendung."""
    settings = settings or get_settings()
    settings.validate_for_startup()
    configure_logging(settings.log_level)

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
        inventory_tasks,
        devices_tasks,
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
    app.include_router(account_sessions_router)
    app.include_router(audit_router)
    app.include_router(permissions_router)
    app.include_router(avatar_router)
    app.include_router(admin_settings_router)
    app.include_router(backup_router)
    app.include_router(branding_router)
    app.include_router(search_router)
    app.include_router(navigation_router)
    app.include_router(tasks_router)
    app.include_router(push_router)
    app.include_router(notifications_router)
    app.include_router(m365_snapshots_router)
    app.include_router(m365_config_router)
    app.include_router(recommendations_router)
    app.include_router(collector_check_router)
    app.include_router(tenant_router)
    app.include_router(tenant_usage_router)
    app.include_router(budget_router)
    app.include_router(budget_imports_router)
    app.include_router(projects_router)
    app.include_router(doku_router)
    app.include_router(doku_d3_router)
    app.include_router(doku_admin_router)
    app.include_router(doku_live_router)
    app.include_router(inventory_router)
    app.include_router(inventory_locations_router)
    app.include_router(inventory_staff_router)
    app.include_router(inventory_cases_router)
    app.include_router(inventory_ninja_admin_router)
    app.include_router(inventory_loans_router)
    app.include_router(inventory_issues_router)
    app.include_router(inventory_issue_public_router)
    app.include_router(inventory_psref_router)
    app.include_router(inventory_statistics_router)
    app.include_router(inventory_whereabouts_router)
    app.include_router(inventory_lookup_router)
    app.include_router(tools_router)
    app.include_router(tools_html_router)
    app.include_router(tools_account_router)
    app.include_router(monitoring_router)
    app.include_router(monitoring_admin_router)
    app.include_router(zabbix_router)
    app.include_router(zabbix_reports_router)
    app.include_router(zabbix_admin_router)
    app.include_router(evergreen_router)
    app.include_router(devices_admin_router)
    app.include_router(devices_router)
    # Einstellungen vor den Tickets, damit /api/tickets/settings nicht als Ticket-Nr. gilt
    app.include_router(tickets_settings_router)
    app.include_router(tickets_mail_router)
    if is_test(settings):
        # Nur für automatische Tests; in Produktion gibt es diese Pfade nicht
        app.include_router(tickets_mail_test_router)
        app.include_router(tickets_test_router)
    app.include_router(tickets_ops_router)
    app.include_router(tickets_work_router)
    app.include_router(tickets_recent_router)
    app.include_router(tickets_achievements_router)
    app.include_router(tickets_router)

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
