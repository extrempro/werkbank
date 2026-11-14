# Deployment

Die `docker-compose.yml` enthält den Web-Dienst, den Worker und die Datenbank. PowerShell folgt.
Die Einbindung in **Arcane** erfolgt, sobald Login und Datenbank vorhanden sind.

Geplanter Aufbau:

| Dienst | Aufgabe | Netzwerk |
|---|---|---|
| `web` | API und Oberfläche (PWA), ein Image aus `backend/Dockerfile` mit Build-Kontext Repository-Wurzel | gebunden an `${BIND_IP}:${BIND_PORT}` |
| `worker` | Hintergrundaufträge: derzeit Aufräumen abgelaufener Sitzungen; später Collector, Erinnerungen, Reports, Push. Gleiches Image wie `web`, startet nach `web` (das die Datenbank migriert) | kein Port nach außen; ausgehend für Microsoft Graph |
| `pwsh` | PowerShell-Jobs (Exchange Online, Teams) | nur intern |
| `db` | PostgreSQL | nur intern (Docker-Netz ohne Außenzugang) |

Konfiguration: `deploy/.env` nach Vorlage [`.env.example`](.env.example).
Secrets: Dateien unter `deploy/secrets/` auf dem Host (nicht im Repository), eingebunden als Docker-Secrets.

## Netzwerk: `BIND_IP`, `BIND_PORT`, `TRUSTED_PROXY_IPS`

`BIND_IP` ist **nicht** die öffentliche IP. Es ist die Adresse auf dem Docker-Host, über die der NetBird Reverse Proxy den Web-Dienst erreicht:

| Aufbau | `BIND_IP` |
|---|---|
| Docker-Host ist NetBird-Peer, der Proxy erreicht ihn über das NetBird-Netz | NetBird-IP des Hosts (z. B. `100.64.0.10`) |
| Proxy läuft auf demselben Host | `127.0.0.1` |

Niemals die öffentliche IP oder `0.0.0.0` verwenden: Die Werkbank wäre dann am Proxy vorbei und ohne TLS direkt erreichbar.

`TRUSTED_PROXY_IPS` ist die Adresse, von der die Anfragen des Proxys beim Container ankommen. Nur von dort werden die Header für Client-IP und Protokoll (`X-Forwarded-For`, `X-Forwarded-Proto`) übernommen. Stimmt der Wert nicht, läuft die Werkbank trotzdem, im Audit-Log steht dann aber die IP des Proxys statt der des Nutzers.

Die öffentliche Adresse (mit `https://`) gehört in `PUBLIC_URL`.

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
3. Im NetBird Reverse Proxy die öffentliche Adresse der Werkbank (z. B. `werkbank.example.com`) als Ziel auf `BIND_IP:BIND_PORT` des Docker-Hosts leiten.
4. In Entra die Redirect-URI `${PUBLIC_URL}/auth/callback` eintragen.
