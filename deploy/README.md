# Deployment

Die `docker-compose.yml` enthält den Web-Dienst, den Worker und die Datenbank. Ein Dienst für PowerShell (`pwsh`) folgt mit Phase 4 und ist noch nicht enthalten.

Aufbau:

| Dienst | Aufgabe | Netzwerk |
|---|---|---|
| `web` | API und Oberfläche (PWA), fertiges Image aus der GitHub-Registry (`ghcr.io/extrempro/werkbank`) | gebunden an `${BIND_IP}:${BIND_PORT}` |
| `worker` | Hintergrundaufträge: Aufräumen abgelaufener Sitzungen, Abruf der Tenant-Einstellungen, Nachrichtencenter, Prüfung der Umsetzung in Evergreen; Versand von Mail, Teams und Push; später Erinnerungen. Gleiches Image wie `web`, startet nach `web` (das die Datenbank migriert) | kein Port nach außen; ausgehend für Microsoft Graph und, wenn Push eingeschaltet ist, HTTPS zu den Push-Diensten (`fcm.googleapis.com`, `*.push.apple.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`) |
| `pwsh` (geplant) | PowerShell-Jobs (Exchange Online, Teams) | nur intern |
| `db` | PostgreSQL | nur intern (Docker-Netz ohne Außenzugang) |

Konfiguration: `deploy/.env` nach Vorlage [`.env.example`](.env.example).
Secrets: Dateien in einem Ordner auf dem Host (nicht im Repository), eingebunden als Docker-Secrets. Siehe „Secrets anlegen“.

## Netzwerk: `BIND_IP`, `BIND_PORT`, `TRUSTED_PROXY_IPS`

`BIND_IP` ist **nicht** die öffentliche IP. Es ist die Adresse auf dem Docker-Host, über die der Reverse Proxy den Web-Dienst erreicht:

| Aufbau | `BIND_IP` |
|---|---|
| Proxy läuft auf einem anderen Server und erreicht den Docker-Host über ein internes Netz oder VPN | interne Adresse des Hosts in diesem Netz (z. B. `10.0.0.10`) |
| Proxy läuft auf demselben Host | `127.0.0.1` |

Niemals die öffentliche IP oder `0.0.0.0` verwenden: Die Werkbank wäre dann am Proxy vorbei und ohne TLS direkt erreichbar.

`TRUSTED_PROXY_IPS` ist die Adresse, von der die Anfragen des Proxys beim Container ankommen. Nur von dort werden die Header für Client-IP und Protokoll (`X-Forwarded-For`, `X-Forwarded-Proto`) übernommen. Stimmt der Wert nicht, läuft die Werkbank trotzdem, im Audit-Log steht dann aber die IP des Proxys statt der des Nutzers.

Die öffentliche Adresse (mit `https://`) gehört in `PUBLIC_URL`.

## Secrets anlegen

Compose erwartet **sieben Dateien** in einem Ordner auf dem Docker-Host. Fehlt eine, startet nichts. Der Ordner liegt am besten außerhalb des Projektordners, damit ein Git-Sync ihn nicht anfasst; sein Pfad steht in `WERKBANK_SECRETS_DIR`.

| Datei | Inhalt | Für |
|---|---|---|
| `postgres_password` | Passwort der Datenbank | `web`, `worker`, `db` |
| `entra_client_key.pem`, `entra_client_cert.pem` | Zertifikat der App-Registrierung „Werkbank“ (Anmeldung) | `web` |
| `collector_client_key.pem`, `collector_client_cert.pem` | Zertifikat der App-Registrierung „Werkbank Collector“ (Abruf, Personensuche im IT-Bestand) | `worker`, `web` |
| `settings_key` | Schlüssel, mit dem geheime Werte aus der Verwaltung (z. B. das SMTP-Passwort) verschlüsselt in der Datenbank liegen | `web`, `worker` |
| `backup_key` | Passphrase, mit der die Datensicherung verschlüsselt wird (siehe [Datensicherung](#datensicherung)) | `web`, `worker` |

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

**2a. Schlüssel für die Verwaltung erzeugen.** Ebenfalls zufällig; er muss nie eingetippt werden.

```bash
openssl rand -base64 48 | sudo tee settings_key > /dev/null
```

Diesen Schlüssel sichern (z. B. im Passwortmanager) und nicht ändern: Geht er verloren, lassen sich in der Verwaltung gespeicherte Passwörter nicht mehr lesen und müssen neu eingetragen werden.

**2b. Schlüssel für die Datensicherung erzeugen.** Eine Zeile, zufällig.

```bash
openssl rand -base64 48 | tr -d '\n' | sudo tee backup_key > /dev/null
```

Auch diesen Schlüssel getrennt von den Sicherungen aufbewahren (z. B. im Passwortmanager): Ohne ihn lässt sich keine Sicherung öffnen.

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

**Kontrolle:** `ls -l /opt/werkbank/secrets` zeigt genau die sechs Dateien aus der Tabelle.

Die Zertifikate gelten 730 Tage. Ablaufdatum in den Kalender eintragen; danach neu erzeugen und wieder hochladen.

Die Datenbank wird beim ersten Start angelegt. Migrationen laufen bei jedem Start des Web-Dienstes automatisch (`alembic upgrade head`).

Zum Ausprobieren ohne Entra legt `deploy/test-secrets.sh` Wegwerf-Dateien an (nie im Betrieb verwenden).

## Image

Das Image wird bei jedem Release gebaut und in der GitHub-Registry veröffentlicht: `ghcr.io/extrempro/werkbank`, mit der Versionsnummer als Tag (z. B. `0.17.1`) und zusätzlich `latest` für die neueste Version. Auf dem Server wird nichts gebaut, und neben der Compose-Datei muss kein Quellcode liegen. Das Image gibt es für `linux/amd64`.

Ohne Angabe läuft `latest`. Wer eine feste Version will, setzt `WERKBANK_IMAGE=ghcr.io/extrempro/werkbank:0.17.1` in der `.env`.

**Update auf eine neue Version:**

```bash
docker compose pull
docker compose up -d
```

Verwaltungswerkzeuge haben dafür meist eine eigene Funktion (Images holen und neu bereitstellen) und können nach neuen Images suchen. Ein bloßer Neustart nimmt das vorhandene Image. Welche Version läuft, steht in der Werkbank auf der Seite „Konto“.

**Selbst bauen** (Entwicklung): aus dem ausgecheckten Repository mit dem Zusatz `docker-compose.build.yml`, siehe [`CONTRIBUTING.md`](../CONTRIBUTING.md).

**Umstieg von einer Installation, die das Image selbst gebaut hat** (bis Version 0.17.0): Compose-Datei aktualisieren (bei Git-Sync: synchronisieren), dann Images holen und neu bereitstellen. Die Variablen `WERKBANK_REF`, `WERKBANK_BUILD_CONTEXT` und `WERKBANK_DOCKERFILE` haben keine Wirkung mehr und können aus der `.env` entfernt werden. Daten und Secrets bleiben unberührt. Das alte Image `werkbank-web:local` kann danach gelöscht werden.

## Betrieb mit Git-Sync

Viele Docker-Verwaltungswerkzeuge können ein Projekt per Git-Sync aus einem Repository holen. Sie legen die Compose-Datei und die Dateien daneben in einen eigenen Projektordner und ersetzen sie bei jedem Sync. Die Werte der `.env` pflegt man dann im Werkzeug; sie bleiben beim Sync erhalten.

1. **Git-Sync anlegen** (Pull): Repository dieses Projekts, Branch `main`, Compose-Datei `deploy/docker-compose.yml`. Es genügt der Ordner `deploy/`.
2. **Umgebungsvariablen** des Projekts im Werkzeug nach [`.env.example`](.env.example) eintragen, mindestens `WERKBANK_SECRETS_DIR`, `BIND_IP`, `BIND_PORT`, `PUBLIC_URL`, `TRUSTED_PROXY_IPS`, `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `COLLECTOR_CLIENT_ID`.
3. **Secrets** wie oben auf dem Host anlegen.
4. Projekt **starten**. Das Image wird dabei aus der Registry geholt.
   **Nach einer neuen Version:** Images holen und neu bereitstellen (siehe „Image“). Welche Version läuft, steht in der Werkbank auf der Seite „Konto“.
5. Im **Reverse Proxy** die öffentliche Adresse der Werkbank auf `BIND_IP:BIND_PORT` des Docker-Hosts leiten.
6. In **Entra** die Redirect-URI `${PUBLIC_URL}/auth/callback` eintragen.

Die ganze Reihenfolge mit Prüfschritten steht in [`docs/inbetriebnahme.md`](../docs/inbetriebnahme.md).

## Datensicherung

Die Werkbank sichert sich selbst: Unter **Verwaltung › Datensicherung** stellst du Uhrzeit und Aufbewahrung ein und startest bei Bedarf eine Sicherung sofort. Dieselbe Anleitung wie hier steht unten auf dieser Seite.

Jede Sicherung ist ein Ordner `werkbank-JJJJ-MM-TT-HHMMSS` im Zielordner mit drei Dateien:

| Datei | Inhalt |
|---|---|
| `datenbank.dump.gpg` | die Datenbank (`pg_dump`, Custom-Format), verschlüsselt |
| `dateien.tar.gpg` | alle Dateien aus dem Volume `belege` (Belege, Ticket-Anhänge, Projektdokumente) als tar, verschlüsselt |
| `info.json` | Version der Werkbank, Datenbank-Revision, Größen und SHA-256 der beiden Dateien (nicht geheim) |

Verschlüsselt wird mit GnuPG (OpenPGP, symmetrisch, AES-256); die Passphrase ist das Secret `backup_key`. Datenbank und Dateien stammen aus demselben Lauf und passen zusammen.

### Einrichten

1. Secret `backup_key` anlegen (siehe [Secrets anlegen](#secrets-anlegen), Schritt 2b).
2. Zielordner festlegen (freiwillig). Ohne Angabe landen die Sicherungen im Docker-Volume `backups`, also auf demselben Host. Besser ist ein Ordner, der mitgesichert wird, etwa ein NAS-Mount, in der `.env`:

   ```bash
   WERKBANK_BACKUP_DIR=/mnt/sicherung/werkbank
   ```

   Der Ordner muss dem Benutzer der Werkbank gehören (UID 10001):

   ```bash
   sudo mkdir -p /mnt/sicherung/werkbank
   sudo chown 10001:10001 /mnt/sicherung/werkbank
   sudo chmod 700 /mnt/sicherung/werkbank
   ```

3. `docker compose up -d`. In der Verwaltung steht dann „Schlüssel: vorhanden“ und „Zielordner: beschreibbar“. „Täglich sichern“ einschalten und einmal „Jetzt sichern“.

Die Aufbewahrung zählt Sicherungen, nicht Tage: Nach jeder neuen Sicherung löscht die Werkbank die ältesten über der eingestellten Zahl (Vorgabe 14). Schlägt eine Sicherung fehl, bekommen die Admins eine Benachrichtigung; der geplante Lauf wird erst am nächsten Tag wiederholt.

### Zurückspielen

Das Zurückspielen ersetzt die ganze Datenbank und alle Dateien. Die Datenbank wird in einer Transaktion eingespielt: Schlägt etwas fehl, bleibt der alte Stand. Alle Befehle im Ordner mit der `docker-compose.yml`:

```bash
# 1. Sicherungen anzeigen und die gewünschte prüfen (Prüfsummen, Schlüssel, vollständig lesbar)
docker compose exec worker python -m werkbank.backup liste
docker compose exec worker python -m werkbank.backup pruefen werkbank-JJJJ-MM-TT-HHMMSS

# 2. Werkbank anhalten, die Datenbank läuft weiter
docker compose stop web worker

# 3. Zurückspielen; der Befehl fragt nach dem Namen der Sicherung
docker compose run --rm --no-deps worker python -m werkbank.backup wiederherstellen werkbank-JJJJ-MM-TT-HHMMSS

# 4. Starten; web bringt die Datenbank auf den Stand der laufenden Version
docker compose up -d
```

- Das Image muss mindestens die Version haben, mit der die Sicherung erstellt wurde (`info.json`). Sonst bricht der Befehl ab, ohne etwas zu ändern.
- **Neuer Server:** Werkbank wie in [`docs/inbetriebnahme.md`](../docs/inbetriebnahme.md) einrichten, dabei dieselben Secrets verwenden, auch `settings_key` (sonst müssen gespeicherte Zugangsdaten neu eingetragen werden). Den Ordner der Sicherung in den Zielordner kopieren, dann ab Schritt 2.
- `docker compose exec worker python -m werkbank.backup sichern` erstellt eine Sicherung von Hand, z. B. vor einem Update.

### Im Notfall ohne Werkbank

Auf jedem Rechner mit `gpg` und dem Schlüssel:

```bash
gpg --batch --pinentry-mode loopback --passphrase-file backup_key \
  --decrypt datenbank.dump.gpg > datenbank.dump
gpg --batch --pinentry-mode loopback --passphrase-file backup_key \
  --decrypt dateien.tar.gpg | tar -x
```

`datenbank.dump` lässt sich mit `pg_restore` (PostgreSQL 16) in eine leere Datenbank einspielen.

### Volumes von Hand sichern

Wer zusätzlich auf Ebene des Hosts sichert: Die Volumes `db-data` (Datenbank) und `belege` (Dateien) gehören zusammen und werden zusammen gesichert und zurückgespielt; die Dateien liegen unter zufälligen Namen, die Zuordnung steht nur in der Datenbank. Den Schlüssel `backup_key` nie in dieselbe Sicherung legen wie die Sicherungen selbst.
