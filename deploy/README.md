# Deployment

Die `docker-compose.yml` entsteht in Phase 1 zusammen mit dem ersten lauffähigen Code.
Erst dann wird das Repository in **Arcane** per Git-Sync eingebunden. Vorher gibt es nichts zu deployen.

Geplanter Aufbau:

| Dienst | Aufgabe | Netzwerk |
|---|---|---|
| `web` | API und PWA | gebunden an `${BIND_IP}:${BIND_PORT}` |
| `worker` | Collector, Erinnerungen, Reports, Push | nur intern |
| `pwsh` | PowerShell-Jobs (Exchange Online, Teams) | nur intern |
| `db` | PostgreSQL | nur intern |

Konfiguration: `deploy/.env` nach Vorlage [`.env.example`](.env.example).
Secrets: Dateien unter `deploy/secrets/` auf dem Host (nicht im Repository), eingebunden als Docker-Secrets.

## Arcane (ab Phase 1)

1. In Arcane ein Projekt per Git-Sync auf dieses Repository anlegen, Branch `main`, Compose-Datei `deploy/docker-compose.yml`.
2. `deploy/.env` und `deploy/secrets/` auf dem Host anlegen.
3. Im NetBird Reverse Proxy die öffentliche Adresse auf `BIND_IP:BIND_PORT` leiten.
4. In Entra die Redirect-URI `${PUBLIC_URL}/auth/callback` eintragen.
