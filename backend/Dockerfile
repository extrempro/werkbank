# Werkbank – Backend (API und später Auslieferung der PWA)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN groupadd --system --gid 10001 werkbank \
    && useradd --system --uid 10001 --gid werkbank --no-create-home werkbank

WORKDIR /app
COPY pyproject.toml alembic.ini ./
COPY werkbank ./werkbank
COPY migrations ./migrations
RUN pip install .

USER werkbank
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"]

# Beim Start: Datenbank migrieren, dann API starten.
# Proxy-Header nur von den in TRUSTED_PROXY_IPS genannten Adressen akzeptieren.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn werkbank.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips \"${TRUSTED_PROXY_IPS:-127.0.0.1}\""]
