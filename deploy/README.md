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

Compose erwartet **fünf Dateien** in einem Ordner auf dem Docker-Host. Fehlt eine, startet nichts. Der Ordner liegt am besten außerhalb des Projektordners, damit ein Git-Sync ihn nicht anfasst; sein Pfad steht in `WERKBANK_SECRETS_DIR`.

| Datei | Inhalt | Für |
|---|---|---|
| `postgres_password` | Passwort der Datenbank | `web`, `worker`, `db` |
| `entra_client_key.pem`, `entra_client_cert.pem` | Zertifikat der App-Registrierung „Werkbank“ (Anmeldung) | `web` |
| `collector_client_key.pem`, `collector_client_cert.pem` | Zertifikat der App-Registrierung „Werkbank Collector“ (Abruf) | `worker` |

```bash
sudo mkdir -p /opt/werkbank/secrets && cd /opt/werkbank/secrets
openssl rand -hex 24 | sudo tee postgres_password > /dev/null
# Zertifikate: siehe docs/entra-setup.md, Abschnitte 1.3 und 4.1
sudo chmod 444 *          # lesbar für die Container
sudo chmod 711 .          # Ordner: nur root darf den Inhalt auflisten
```

Die Datenbank wird beim ersten Start angelegt. Migrationen laufen bei jedem Start des Web-Dienstes automatisch (`alembic upgrade head`).

Zum Ausprobieren ohne Entra legt `deploy/test-secrets.sh` Wegwerf-Dateien an (nie im Betrieb verwenden).

## Image

Das Image wird aus dem Repository gebaut, standardmäßig aus dem Stand von `main` auf GitHub (`WERKBANK_BUILD_CONTEXT`). Neben der Compose-Datei muss deshalb kein Quellcode liegen. Eine neue Version kommt erst mit einem **neuen Build** auf den Server; ein bloßer Neustart nimmt das vorhandene Image.

## Arcane

Arcane holt beim Git-Sync die Compose-Datei (und auf Wunsch die Dateien daneben) in einen eigenen Projektordner und ersetzt sie bei jedem Sync. Die Werte der `.env` pflegt man in Arcane; sie bleiben beim Sync erhalten.

1. **Git-Sync anlegen** (Pull): Repository dieses Projekts, Branch `main`, Compose-Datei `deploy/docker-compose.yml`.
2. **Umgebungsvariablen** des Projekts in Arcane nach [`.env.example`](.env.example) eintragen, mindestens `WERKBANK_SECRETS_DIR`, `BIND_IP`, `BIND_PORT`, `PUBLIC_URL`, `TRUSTED_PROXY_IPS`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `COLLECTOR_CLIENT_ID`.
3. **Secrets** wie oben auf dem Host anlegen.
4. Projekt **bauen und starten**. Nach einer neuen Version auf `main`: Projekt in Arcane neu bauen und neu bereitstellen.
5. Im **NetBird Reverse Proxy** die öffentliche Adresse der Werkbank auf `BIND_IP:BIND_PORT` des Docker-Hosts leiten.
6. In **Entra** die Redirect-URI `${PUBLIC_URL}/auth/callback` eintragen.

Die ganze Reihenfolge mit Prüfschritten steht in [`docs/inbetriebnahme.md`](../docs/inbetriebnahme.md).
