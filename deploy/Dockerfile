# Werkbank – Image für den Betrieb, wenn neben dieser Datei kein Quellcode liegt
# (z. B. ein Git-Sync, der nur den Ordner deploy/ holt).
#
# Der Quellcode kommt beim Bauen als Archiv von GitHub. Docker lädt das Archiv bei jedem Build
# und baut nur neu, wenn sich der Stand geändert hat. Die Schritte danach entsprechen
# backend/Dockerfile (dort ist der Build-Kontext das ausgecheckte Repository). Änderungen am
# Ablauf immer in beiden Dateien vornehmen; die CI baut beide.
#
# Anderer Stand: --build-arg WERKBANK_REF=v0.3.0 (Tag, Branch oder Commit).

ARG WERKBANK_REPO=extrempro/werkbank
ARG WERKBANK_REF=main

# --- Quellcode holen ---
FROM node:22-alpine AS source
ARG WERKBANK_REPO
ARG WERKBANK_REF
ADD https://github.com/${WERKBANK_REPO}/archive/${WERKBANK_REF}.tar.gz /tmp/source.tar.gz
RUN mkdir /src && tar -xzf /tmp/source.tar.gz -C /src --strip-components=1

# --- Frontend bauen ---
FROM node:22-alpine AS frontend
WORKDIR /build
COPY --from=source /src/frontend/package.json /src/frontend/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY --from=source /src/frontend/ ./
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
COPY --from=source /src/backend/pyproject.toml /src/backend/alembic.ini ./
COPY --from=source /src/backend/werkbank ./werkbank
COPY --from=source /src/backend/migrations ./migrations
RUN pip install .
COPY --from=frontend /build/dist /app/static

USER werkbank
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"]

# Beim Start: Datenbank migrieren, dann API starten.
# Proxy-Header nur von den in TRUSTED_PROXY_IPS genannten Adressen akzeptieren.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn werkbank.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips \"${TRUSTED_PROXY_IPS:-127.0.0.1}\""]
