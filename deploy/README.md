# Deployment

Die `docker-compose.yml` enthält den Web-Dienst, den Worker und die Datenbank. PowerShell folgt.
Die Einbindung in **Arcane** erfolgt, sobald Login und Datenbank vorhanden sind.

Geplanter Aufbau:

| Dienst | Aufgabe | Netzwerk |
|---|---|---|
| `web` | API und Oberfläche (PWA), ein Image aus `deploy/Dockerfile` (holt den Quellcode von GitHub) oder aus `backend/Dockerfile` mit Build-Kontext Repository-Wurzel | gebunden an `${BIND_IP}:${BIND_PORT}` |
| `worker` | Hintergrundaufträge: derzeit Aufräumen abgelaufener Sitzungen; später Collector, Erinnerungen, Reports, Push. Gleiches Image wie `web`, startet nach `web` (das die Datenbank migriert) | kein Port nach außen; ausgehend für Microsoft Graph |
| `pwsh` | PowerShell-Jobs (Exchange Online, Teams) | nur intern |
| `db` | PostgreSQL | nur intern (Docker-Netz ohne Außenzugang) |

Konfiguration: `deploy/.env` nach Vorlage [`.env.example`](.env.example).
Secrets: Dateien in einem Ordner auf dem Host (nicht im Repository), eingebunden als Docker-Secrets. Siehe „Secrets anlegen“.

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

Ein Secret ist hier eine Datei auf dem Docker-Host, die Docker beim Start in den Container einblendet. So stehen Passwort und Schlüssel weder im Repository noch in den Umgebungsvariablen.

**1. Ordner anlegen**

```bash
sudo mkdir -p /opt/werkbank/secrets
cd /opt/werkbank/secrets
```

**2. Datenbank-Passwort erzeugen.** Es wird zufällig erzeugt und muss nie eingetippt werden; Datenbank und Werkbank lesen es aus der Datei.

```bash
openssl rand -hex 24 | sudo tee postgres_password > /dev/null
```

**3. Zertifikat für die Anmeldung** (App-Registrierung „Werkbank“)

```bash
sudo openssl req -x509 -newkey rsa:3072 -sha256 -days 730 -nodes \
  -keyout entra_client_key.pem -out entra_client_cert.pem \
  -subj "/CN=Werkbank Login"
```

**4. Zertifikat für den Abruf** (App-Registrierung „Werkbank Collector“)

```bash
sudo openssl req -x509 -newkey rsa:3072 -sha256 -days 730 -nodes \
  -keyout collector_client_key.pem -out collector_client_cert.pem \
  -subj "/CN=Werkbank Collector"
```

Je Zertifikat entstehen zwei Dateien: `…_key.pem` ist der private Schlüssel und bleibt auf dem Server. `…_cert.pem` ist der öffentliche Teil und wird in Entra hochgeladen.

**5. Rechte setzen**

```bash
sudo chmod 444 *     # die Container laufen nicht als root und müssen die Dateien lesen können
sudo chmod 711 .     # außer root kann niemand den Inhalt des Ordners auflisten
```

Wer ein Konto auf dem Host hat und die Dateinamen kennt, kann die Dateien lesen. Der Docker-Host sollte deshalb nur für Administratoren zugänglich sein.

**6. Zertifikate in Entra hochladen.** Die beiden `…_cert.pem` auf den eigenen Rechner holen (z. B. mit `scp`; der Inhalt ist nicht geheim) und hochladen unter **Zertifikate & Geheimnisse → Zertifikate → Zertifikat hochladen**:

- `entra_client_cert.pem` in der App-Registrierung „Werkbank“
- `collector_client_cert.pem` in der App-Registrierung „Werkbank Collector“

Die `…_key.pem` werden nirgends hochgeladen und nicht vom Server kopiert.

**7. Ordner eintragen:** `WERKBANK_SECRETS_DIR=/opt/werkbank/secrets` in den Umgebungsvariablen des Projekts.

**Kontrolle:** `ls -l /opt/werkbank/secrets` zeigt genau die fünf Dateien aus der Tabelle.

Die Zertifikate gelten 730 Tage. Ablaufdatum in den Kalender eintragen; danach neu erzeugen und wieder hochladen.

Die Datenbank wird beim ersten Start angelegt. Migrationen laufen bei jedem Start des Web-Dienstes automatisch (`alembic upgrade head`).

Zum Ausprobieren ohne Entra legt `deploy/test-secrets.sh` Wegwerf-Dateien an (nie im Betrieb verwenden).

## Image

Das Image wird mit `deploy/Dockerfile` gebaut. Dieses Dockerfile holt den Quellcode beim Bauen selbst von GitHub, standardmäßig den Stand von `main` (`WERKBANK_REF` für einen Tag, Branch oder Commit). Neben der Compose-Datei muss deshalb nur das Dockerfile liegen, kein Quellcode. Wer aus einem ausgecheckten Repository baut, setzt `WERKBANK_BUILD_CONTEXT=..` und `WERKBANK_DOCKERFILE=backend/Dockerfile`. Eine neue Version kommt erst mit einem **neuen Build** auf den Server; ein bloßer Neustart nimmt das vorhandene Image.

## Arcane

Arcane holt beim Git-Sync die Compose-Datei (und auf Wunsch die Dateien daneben) in einen eigenen Projektordner und ersetzt sie bei jedem Sync. Die Werte der `.env` pflegt man in Arcane; sie bleiben beim Sync erhalten.

1. **Git-Sync anlegen** (Pull): Repository dieses Projekts, Branch `main`, Compose-Datei `deploy/docker-compose.yml`. Arcane holt den Ordner `deploy/` und findet dort auch das `Dockerfile`, das es zum Bauen braucht.
2. **Umgebungsvariablen** des Projekts in Arcane nach [`.env.example`](.env.example) eintragen, mindestens `WERKBANK_SECRETS_DIR`, `BIND_IP`, `BIND_PORT`, `PUBLIC_URL`, `TRUSTED_PROXY_IPS`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `COLLECTOR_CLIENT_ID`.
3. **Secrets** wie oben auf dem Host anlegen.
4. Projekt **bauen und starten**.
   **Nach einer neuen Version auf `main`** muss das Image neu gebaut werden. Ein reines Neu-Bereitstellen in Arcane kann das vorhandene Image `werkbank-web:local` weiterverwenden; dann läuft der alte Stand weiter. Sicher ist der Neubau auf dem Docker-Host im Projektordner (je nach Einrichtung mit `sudo`):

   ```bash
   docker compose build --no-cache --pull
   docker compose up -d
   ```

   Welche Version läuft, steht in der Werkbank auf der Seite „Konto“.
5. Im **NetBird Reverse Proxy** die öffentliche Adresse der Werkbank auf `BIND_IP:BIND_PORT` des Docker-Hosts leiten.
6. In **Entra** die Redirect-URI `${PUBLIC_URL}/auth/callback` eintragen.

Die ganze Reihenfolge mit Prüfschritten steht in [`docs/inbetriebnahme.md`](../docs/inbetriebnahme.md).
