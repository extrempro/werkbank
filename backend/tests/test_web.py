from pathlib import Path

from fastapi.testclient import TestClient

from werkbank.config import Settings
from werkbank.main import create_app


def make_client(static_dir: Path) -> TestClient:
    (static_dir / "assets").mkdir(parents=True)
    (static_dir / "index.html").write_text("<html>Werkbank</html>", encoding="utf-8")
    (static_dir / "sw.js").write_text("// sw", encoding="utf-8")
    (static_dir / "assets" / "app-123.js").write_text("console.log(1)", encoding="utf-8")
    settings = Settings(public_url="https://testserver", static_dir=static_dir)
    return TestClient(create_app(settings), base_url="https://testserver")


def test_index_and_spa_fallback(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    for path in ("/", "/evergreen", "/m365/aenderungen"):
        response = client.get(path)
        assert response.status_code == 200
        assert "Werkbank" in response.text
        assert response.headers["cache-control"] == "no-cache"


def test_service_worker_headers(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    response = client.get("/sw.js")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["service-worker-allowed"] == "/"


def test_assets_served_with_long_cache(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    response = client.get("/assets/app-123.js")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_api_paths_not_replaced_by_frontend(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    assert client.get("/api/gibt-es-nicht").status_code == 404
    assert client.get("/auth/gibt-es-nicht").status_code == 404


def test_security_headers_on_frontend(tmp_path: Path) -> None:
    client = make_client(tmp_path)
    response = client.get("/")
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
