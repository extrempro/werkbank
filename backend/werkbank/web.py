"""Auslieferung der PWA (Frontend-Build) durch das Backend."""

from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import Response
from starlette.types import Scope

# Diese Pfade gehören zur API und werden nie durch die Oberfläche ersetzt.
API_PREFIXES = ("api/", "auth/", "health")

NO_CACHE = {"Cache-Control": "no-cache"}


class ImmutableStaticFiles(StaticFiles):
    """Dateien mit Versionskennung im Namen (Vite-Build) dürfen dauerhaft gecacht werden."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        if response.status_code == status.HTTP_200_OK:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


def mount_frontend(app: FastAPI, static_dir: Path) -> None:
    """Liefert den Frontend-Build aus, falls vorhanden. Unbekannte Pfade erhalten die index.html."""
    root = static_dir.resolve()
    index = root / "index.html"
    if not index.is_file():
        return

    assets = root / "assets"
    if assets.is_dir():
        # Komprimiert nur die statischen Dateien, nicht die API-Antworten.
        assets_app = GZipMiddleware(ImmutableStaticFiles(directory=assets), minimum_size=500)
        app.mount("/assets", assets_app, name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str) -> FileResponse:
        if path.startswith(API_PREFIXES):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
        candidate = (root / path).resolve()
        if path and candidate.is_file() and root in candidate.parents:
            headers: dict[str, str] | None = None
            if candidate.name == "sw.js":
                headers = {**NO_CACHE, "Service-Worker-Allowed": "/"}
            elif candidate.name == "manifest.webmanifest":
                headers = NO_CACHE
            return FileResponse(candidate, headers=headers)
        return FileResponse(index, headers=NO_CACHE)
