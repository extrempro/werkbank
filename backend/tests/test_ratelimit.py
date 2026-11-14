from fastapi.testclient import TestClient

from werkbank.config import Settings
from werkbank.core.ratelimit import RateLimiter, RateLimitRule, default_rules
from werkbank.main import create_app

ORIGIN = "https://testserver"


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_limiter_blocks_after_limit_and_recovers() -> None:
    clock = FakeClock()
    limiter = RateLimiter(window_seconds=60, clock=clock)
    assert limiter.hit("a", 2).allowed
    assert limiter.hit("a", 2).allowed
    blocked = limiter.hit("a", 2)
    assert not blocked.allowed
    assert blocked.first_violation
    assert 1 <= blocked.retry_after <= 60
    assert not limiter.hit("a", 2).first_violation
    # anderer Schlüssel ist nicht betroffen
    assert limiter.hit("b", 2).allowed
    clock.now += 61
    assert limiter.hit("a", 2).allowed


def test_limiter_memory_is_bounded() -> None:
    clock = FakeClock()
    limiter = RateLimiter(window_seconds=60, clock=clock, max_keys=3)
    for index in range(10):
        assert limiter.hit(f"key-{index}", 5).allowed
    assert len(limiter._counters) <= 3


def test_rule_matching() -> None:
    rule = RateLimitRule("api", ("/api/",), 5)
    assert rule.matches("/api/me")
    assert not rule.matches("/health")
    assert not RateLimitRule("aus", ("/api/",), 0).matches("/api/me")


def test_default_rules_cover_login_export_and_api() -> None:
    rules = {rule.name: rule for rule in default_rules(Settings())}
    assert rules["anmeldung"].matches("/auth/login")
    assert rules["anmeldung"].matches("/auth/callback")
    assert rules["export"].matches("/api/audit/export.csv")
    assert rules["api"].matches("/api/audit")
    assert not any(rule.matches("/assets/app.js") for rule in rules.values())


def test_api_answers_429_with_retry_after() -> None:
    settings = Settings(public_url=ORIGIN, environment="test", rate_limit_api_per_minute=2)
    client = TestClient(create_app(settings), base_url=ORIGIN)
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me").status_code == 401
    blocked = client.get("/api/me")
    assert blocked.status_code == 429
    assert int(blocked.headers["Retry-After"]) >= 1
    # Sicherheits-Header auch auf der Ablehnung, andere Pfade bleiben erreichbar
    assert blocked.headers["X-Content-Type-Options"] == "nosniff"
    assert client.get("/health").status_code == 200


def test_login_is_limited_separately() -> None:
    settings = Settings(public_url=ORIGIN, environment="test", rate_limit_login_per_minute=1)
    client = TestClient(create_app(settings), base_url=ORIGIN, follow_redirects=False)
    body = {"oid": "x", "name": "X", "roles": ["Werkbank.Admin"]}
    headers = {"Origin": ORIGIN}
    # Test-Login ist abgeschaltet (404); die zweite Anfrage scheitert schon an der Begrenzung
    assert client.post("/auth/test-login", json=body, headers=headers).status_code == 404
    assert client.post("/auth/test-login", json=body, headers=headers).status_code == 429
