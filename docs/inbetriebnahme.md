# Erste Inbetriebnahme

Reihenfolge für das erste Deployment mit Prüfschritten. Beispielwerte verwenden `example.com`; echte Adressen, Kennungen und Zertifikate gehören nicht ins Repository.

> **Stand:** Version 0.5. Die Reihenfolge beschreibt den Betrieb mit Docker Compose hinter einem Reverse Proxy, wahlweise mit einem Docker-Verwaltungswerkzeug, das den Ordner `deploy/` per Git-Sync holt.

## 1. Entra ID

Nach [`entra-setup.md`](entra-setup.md):

- [ ] App-Registrierung **Werkbank** (Abschnitt 1): Redirect-URI `https://werkbank.example.com/auth/callback`, Zertifikat hochgeladen, optionale Ansprüche `email`, `preferred_username`, `auth_time`, delegiert `User.Read`, „Zuweisung erforderlich“, Admin- und Zugangs-Gruppe angelegt und zugewiesen (1.8)
- [ ] Mindestens ein Konto hat die Rolle `Werkbank.Admin`, eines `Config.Reviewer` (kann dasselbe sein)
- [ ] Optional für Profilbilder: delegierte Berechtigung `User.Read` mit Administratorzustimmung (Abschnitt 1.5), danach `ENTRA_PROFILE_PHOTO=true`
- [ ] Conditional Access **CA-Werkbank-MFA** (Abschnitt 2), zuerst „Nur Bericht“
- [ ] App-Registrierung **Werkbank Collector** (Abschnitt 4.1) mit eigenem Zertifikat und Administratorzustimmung
- [ ] Dienstprinzipale von UTCM angelegt und Leserechte vergeben (Abschnitt 4.2)

Notieren: Verzeichnis-ID, Anwendungs-ID „Werkbank“, Anwendungs-ID „Werkbank Collector“.

## 2. Docker-Host

- [ ] Der Reverse Proxy erreicht den Host (gleicher Host oder internes Netz bzw. VPN); die Adresse des Hosts in diesem Netz ist bekannt
- [ ] Secrets liegen in `/opt/werkbank/secrets` (sieben Dateien, siehe [`deploy/README.md`](../deploy/README.md))
- [ ] Kopien von `settings_key` und `backup_key` liegen getrennt vom Host, z. B. im Passwortmanager
- [ ] Ausgehend erreichbar: `login.microsoftonline.com`, `graph.microsoft.com`, `ghcr.io` (Image holen); mit `TENANT_USAGE_ENABLED` auch `reports*.office.com` (z. B. `reports.office.com` oder regionale Hosts)

## 3. Projekt anlegen (Compose oder Git-Sync)

- [ ] Git-Sync auf das Repository, Branch `main`, Compose-Datei `deploy/docker-compose.yml`. Es genügt der Ordner `deploy/`. Das Image kommt fertig aus der GitHub-Registry
- [ ] Umgebungsvariablen eingetragen:

| Variable | Wert |
|---|---|
| `WERKBANK_SECRETS_DIR` | `/opt/werkbank/secrets` |
| `BIND_IP` | interne Adresse des Docker-Hosts, über die der Proxy ihn erreicht (nicht die öffentliche IP, nicht `0.0.0.0`) |
| `BIND_PORT` | freier Port, z. B. `8080` |
| `PUBLIC_URL` | `https://werkbank.example.com` (ohne Schrägstrich am Ende) |
| `TRUSTED_PROXY_IPS` | Adresse, von der die Anfragen des Proxys ankommen, zunächst die interne Adresse des Proxy-Servers |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `COLLECTOR_CLIENT_ID` | aus Schritt 1 |
| `ENTRA_ADMIN_GROUP_ID`, `ENTRA_ACCESS_GROUP_ID` | Objekt-IDs der beiden Gruppen ([`entra-setup.md`](entra-setup.md), 1.8); danach die Rechte unter Verwaltung › Berechtigungen vergeben |
| `ENVIRONMENT` | `production` |
| `WERKBANK_BACKUP_DIR` | freiwillig: Zielordner der Datensicherung auf dem Host, z. B. ein NAS-Mount (UID 10001 muss schreiben dürfen); ohne Angabe das Volume `backups` |
| `ENABLE_TEST_LOGIN` | `false` |

- [ ] Projekt bauen und starten; `web`, `worker` und `db` sind „healthy“

## 4. Reverse Proxy

- [ ] Öffentliche Adresse der Werkbank zeigt auf `BIND_IP:BIND_PORT` des Docker-Hosts
- [ ] TLS endet am Proxy; HSTS ist dort gesetzt
- [ ] `https://werkbank.example.com/health` antwortet mit `{"status":"ok"}`
- [ ] WebSockets werden durchgereicht (Upgrade für `/api/doku/live/…`, Live-Bearbeitung der Dokumentation); Zeitlimit für offene Verbindungen mindestens einige Minuten. Ohne WebSockets zeigt eine Doku-Seite dauerhaft „Wird verbunden …“
- [ ] Der Dienst `web` läuft mit einem Prozess (Vorgabe); die Live-Bearbeitung hält die offenen Seiten im Speicher dieses Prozesses

## 5. Prüfen

| Prüfung | Erwartung |
|---|---|
| Startseite ohne Anmeldung | Login-Seite, sonst nichts erreichbar |
| Anmeldung mit einem Konto mit Rolle | Weiterleitung zu Microsoft, MFA, zurück zur Startseite |
| Anmeldung mit einem Konto ohne Rolle | Entra lehnt ab („Zuweisung erforderlich“) |
| Doku-Seite in zwei Browsern öffnen (Rolle `Doku.Nutzer`, Mitglied im Arbeitsbereich) | oben rechts „Live · wird automatisch gespeichert“, Text erscheint im anderen Browser sofort |
| Audit-Log (Admin) | Eintrag `anmeldung.erfolgreich`; in der Spalte „Herkunft“ steht das Netz des Clients (gekürzte IP), **nicht** das des Proxys oder ein Docker-Netz (`172.x`). Sonst `TRUSTED_PROXY_IPS` auf die Adresse setzen, die dort bzw. im Protokoll des Dienstes `web` erscheint, und neu bereitstellen |
| Verwaltung nach mehr als 15 Minuten | Hinweis „Erneut anmelden“, danach erreichbar. Mit `auth_time` darf eine stille Anmeldung nicht genügen |
| M365-Konfiguration → Übersicht (Admin mit Config-Rolle) | Kein Hinweis „nicht eingerichtet“; „Jetzt abrufen“ startet einen Abruf |
| Snapshots nach einigen Minuten | Abruf „Erfolgreich“ mit Objekten; Einstellungen sind gefüllt |
| Evergreen → Microsoft 365, einige Stunden nach dem Start | Meldungen aus dem Nachrichtencenter der letzten 30 Tage stehen als Einträge mit Status „Neu“ da |
| Zweiter Abruf nach einer Änderung im Tenant | Änderung erscheint unter „Änderungen“ mit „Geändert von“ |
| Verwaltung › Datensicherung | „Schlüssel: vorhanden“, „Zielordner: beschreibbar“; „Täglich sichern“ einschalten, „Jetzt sichern“ ergibt einen Lauf „erfolgreich“; einmal `python -m werkbank.backup pruefen` wie in [`deploy/README.md`](../deploy/README.md) |
| Seite „Konto“ (Klick auf den Namen oben rechts) | Zeigt Rollen, Sitzung und die laufende Version |
| Update auf eine neue Version | Images holen und neu bereitstellen (siehe [`deploy/README.md`](../deploy/README.md)); danach Banner „Neue Version“, „Neu laden“ lädt sie; auf der Seite „Konto“ steht die neue Version |
| iPhone und iPad | Zum Home-Bildschirm hinzufügen, Anmeldung, Bedienung |

## 6. Wenn etwas nicht klappt

- **Nach einem Update sieht die Werkbank aus wie vorher:** Das neue Image wurde nicht geholt; ein Neustart nimmt das vorhandene. Auf dem Docker-Host im Projektordner `docker compose pull` und `docker compose up -d` ausführen. Steht in der `.env` eine feste Version (`WERKBANK_IMAGE`), dort die neue eintragen.
- **Anmeldung abgelehnt mit Grund `keine_gruppe` oder `gruppen_nicht_pruefbar` (Audit-Log):** Die Person ist in keiner der beiden Gruppen, eine Objekt-ID in `.env` stimmt nicht, oder an der App-Registrierung fehlt die delegierte Berechtigung `User.Read` mit Administratorzustimmung ([`entra-setup.md`](entra-setup.md), 1.5 und 1.8).
- **Anmeldung schlägt fehl, nachdem `ENTRA_PROFILE_PHOTO=true` gesetzt wurde:** An der App-Registrierung fehlt die delegierte Berechtigung `User.Read` oder die Administratorzustimmung ([`entra-setup.md`](entra-setup.md), 1.5).
- **Compose startet nicht, „bind source path does not exist: …/secrets/postgres_password“:** `WERKBANK_SECRETS_DIR` ist nicht gesetzt (dann sucht Compose im Ordner `secrets` neben der Compose-Datei) oder eine der sieben Dateien fehlt. Nach einem Update auf Version 0.6 fehlt oft `settings_key`, nach einem Update auf Version 0.126 `backup_key`; Anleitung in [`deploy/README.md`](../deploy/README.md), Schritte 2a und 2b.
- **„env file not found“:** Es gibt noch keine `.env` neben der Compose-Datei bzw. im Verwaltungswerkzeug sind noch keine Umgebungsvariablen für das Projekt eingetragen.
- **Anmeldung endet mit „Anmeldung nicht möglich“:** Im Audit-Log steht der Grund (`anmeldung.abgelehnt`), z. B. `falscher_mandant` oder `keine_rolle`.
- **Abruf fehlgeschlagen:** Unter Snapshots steht der Abruf als „Fehlgeschlagen“; die Fehlerangabe von Microsoft steht im Protokoll des Dienstes `worker`. Häufig fehlt dem Dienstprinzipal von UTCM ein Leserecht.
- **POST-Anfragen werden mit 403 abgewiesen:** `PUBLIC_URL` stimmt nicht exakt mit der Adresse im Browser überein.
