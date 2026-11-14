# Deployment

Die `docker-compose.yml` enthält derzeit den Web-Dienst und die Datenbank. Worker und PowerShell folgen.
Die Einbindung in **Arcane** erfolgt, sobald Login und Datenbank vorhanden sind.

Geplanter Aufbau:

| Dienst | Aufgabe | Netzwerk |
|---|---|---|
| `web` | API und PWA | gebunden an `${BIND_IP}:${BIND_PORT}` |
| `worker` | Collector, Erinnerungen, Reports, Push | nur intern |
| `pwsh` | PowerShell-Jobs (Exchange Online, Teams) | nur intern |
| `db` | PostgreSQL | nur intern (Docker-Netz ohne Außenzugang) |

Konfiguration: `deploy/.env` nach Vorlage [`.env.example`](.env.example).
Secrets: Dateien unter `deploy/secrets/` auf dem Host (nicht im Repository), eingebunden als Docker-Secrets.

## Secrets anlegen

```bash
cd deploy
mkdir -p secrets && chmod 700 secrets
openssl rand -hex 24 > secrets/postgres_password
chmod 444 secrets/postgres_password   # lesbar für die Container, geschützt durch den Ordner (700)
```

Die Datenbank wird beim ersten Start angelegt. Migrationen laufen bei jedem Start des Web-Dienstes automatisch (`alembic upgrade head`).

## Arcane (ab Phase 1)

1. In Arcane ein Projekt per Git-Sync auf dieses Repository anlegen, Branch `main`, Compose-Datei `deploy/docker-compose.yml`.
2. `deploy/.env` und `deploy/secrets/` auf dem Host anlegen.
3. Im NetBird Reverse Proxy die öffentliche Adresse auf `BIND_IP:BIND_PORT` leiten.
4. In Entra die Redirect-URI `${PUBLIC_URL}/auth/callback` eintragen.
