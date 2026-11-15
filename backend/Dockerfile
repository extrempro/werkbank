# Werkbank – Image mit Backend (API) und Frontend (PWA)
# Build-Kontext ist das Wurzelverzeichnis des Repositorys (siehe deploy/docker-compose.build.yml).
# Der Release-Workflow baut daraus das veröffentlichte Image.

# --- Frontend bauen ---
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# --- Laufzeit ---
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN groupadd --system --gid 10001 werkbank \
    && useradd --system --uid 10001 --gid werkbank --no-create-home werkbank

WORKDIR /app
COPY backend/pyproject.toml backend/alembic.ini ./
COPY backend/werkbank ./werkbank
COPY backend/migrations ./migrations
RUN pip install .
COPY --from=frontend /build/dist /app/static

USER werkbank
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"]

# Beim Start: Datenbank migrieren, dann API starten.
# Proxy-Header nur von den in TRUSTED_PROXY_IPS genannten Adressen akzeptieren.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn werkbank.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips \"${TRUSTED_PROXY_IPS:-127.0.0.1}\""]
