"""Auslieferung der PWA (Frontend-Build) durch das Backend."""

from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Diese Pfade gehören zur API und werden nie durch die Oberfläche ersetzt.
API_PREFIXES = ("api/", "auth/", "health")

NO_CACHE = {"Cache-Control": "no-cache"}


def mount_frontend(app: FastAPI, static_dir: Path) -> None:
    """Liefert den Frontend-Build aus, falls vorhanden. Unbekannte Pfade erhalten die index.html."""
    root = static_dir.resolve()
    index = root / "index.html"
    if not index.is_file():
        return

    assets = root / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

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
