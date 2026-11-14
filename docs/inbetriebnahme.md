# Erste Inbetriebnahme

Reihenfolge für das erste Deployment mit Prüfschritten. Beispielwerte verwenden `example.com`; echte Adressen, Kennungen und Zertifikate gehören nicht ins Repository.

> **Stand:** Einmal an einer echten Installation durchlaufen (Arcane Git-Sync, NetBird Reverse Proxy auf einem anderen Server, Entra-Anmeldung, Abruf über UTCM). Bestätigt: Arcane synchronisiert nur den Ordner `deploy/` und baut das Image aus GitHub; Anmeldung, Proxy und der erste Abruf funktionieren wie beschrieben. Noch nicht bestätigt: Änderungserkennung mit „Geändert von“ nach einer Änderung im Tenant, erneute Anmeldung für die Verwaltung mit `auth_time`, Installation auf iPhone und iPad.

## 1. Entra ID

Nach [`entra-setup.md`](entra-setup.md):

- [ ] App-Registrierung **Werkbank** (Abschnitt 1): Redirect-URI `https://werkbank.example.com/auth/callback`, Zertifikat hochgeladen, optionale Ansprüche `email`, `preferred_username`, `auth_time`, acht App-Rollen, „Zuweisung erforderlich“, Gruppen zugewiesen
- [ ] Mindestens ein Konto hat die Rolle `Werkbank.Admin`, eines `Config.Reviewer` (kann dasselbe sein)
- [ ] Conditional Access **CA-Werkbank-MFA** (Abschnitt 2), zuerst „Nur Bericht“
- [ ] App-Registrierung **Werkbank Collector** (Abschnitt 4.1) mit eigenem Zertifikat und Administratorzustimmung
- [ ] Dienstprinzipale von UTCM angelegt und Leserechte vergeben (Abschnitt 4.2)

Notieren: Verzeichnis-ID, Anwendungs-ID „Werkbank“, Anwendungs-ID „Werkbank Collector“.

## 2. Docker-Host

- [ ] Der Host ist Peer im NetBird-Netz; seine NetBird-IP ist bekannt
- [ ] Secrets liegen in `/opt/werkbank/secrets` (fünf Dateien, siehe [`deploy/README.md`](../deploy/README.md))
- [ ] Ausgehend erreichbar: `login.microsoftonline.com`, `graph.microsoft.com`, `github.com` (Build)

## 3. Arcane

- [ ] Git-Sync auf das Repository, Branch `main`, Compose-Datei `deploy/docker-compose.yml`. Arcane holt dabei nur den Ordner `deploy/`; das ist richtig so, das Image wird aus GitHub gebaut
- [ ] Umgebungsvariablen eingetragen:

| Variable | Wert |
|---|---|
| `WERKBANK_SECRETS_DIR` | `/opt/werkbank/secrets` |
| `BIND_IP` | NetBird-IP des Docker-Hosts (nicht die öffentliche IP, nicht `0.0.0.0`) |
| `BIND_PORT` | freier Port, z. B. `8080` |
| `PUBLIC_URL` | `https://werkbank.example.com` (ohne Schrägstrich am Ende) |
| `TRUSTED_PROXY_IPS` | Adresse, von der die Anfragen des Proxys ankommen, zunächst die NetBird-IP des Proxy-Servers |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `COLLECTOR_CLIENT_ID` | aus Schritt 1 |
| `ENVIRONMENT` | `production` |
| `ENABLE_TEST_LOGIN` | `false` |

- [ ] Projekt bauen und starten; `web`, `worker` und `db` sind „healthy“

## 4. NetBird Reverse Proxy

- [ ] Öffentliche Adresse der Werkbank zeigt auf `BIND_IP:BIND_PORT` des Docker-Hosts
- [ ] TLS endet am Proxy; HSTS ist dort gesetzt
- [ ] `https://werkbank.example.com/health` antwortet mit `{"status":"ok"}`

## 5. Prüfen

| Prüfung | Erwartung |
|---|---|
| Startseite ohne Anmeldung | Login-Seite, sonst nichts erreichbar |
| Anmeldung mit einem Konto mit Rolle | Weiterleitung zu Microsoft, MFA, zurück zur Startseite |
| Anmeldung mit einem Konto ohne Rolle | Entra lehnt ab („Zuweisung erforderlich“) |
| Audit-Log (Admin) | Eintrag `anmeldung.erfolgreich`; in der Spalte „Herkunft“ steht das Netz des Clients (gekürzte IP), **nicht** das des Proxys oder ein Docker-Netz (`172.x`). Sonst `TRUSTED_PROXY_IPS` auf die Adresse setzen, die dort bzw. im Protokoll des Dienstes `web` erscheint, und neu bereitstellen |
| Verwaltung nach mehr als 15 Minuten | Hinweis „Erneut anmelden“, danach erreichbar. Mit `auth_time` darf eine stille Anmeldung nicht genügen |
| M365-Konfiguration → Übersicht (Admin mit Config-Rolle) | Kein Hinweis „nicht eingerichtet“; „Jetzt abrufen“ startet einen Abruf |
| Snapshots nach einigen Minuten | Abruf „Erfolgreich“ mit Objekten; Einstellungen sind gefüllt |
| Zweiter Abruf nach einer Änderung im Tenant | Änderung erscheint unter „Änderungen“ mit „Geändert von“ |
| Update-Hinweis nach einer neuen Version | Banner „Neue Version“, „Neu laden“ lädt sie |
| iPhone und iPad | Zum Home-Bildschirm hinzufügen, Anmeldung, Bedienung |

## 6. Wenn etwas nicht klappt

- **Compose startet nicht, „bind source path does not exist: …/secrets/postgres_password“:** `WERKBANK_SECRETS_DIR` ist nicht gesetzt (dann sucht Compose im Ordner `secrets` neben der Compose-Datei) oder eine der fünf Dateien fehlt.
- **„env file not found“:** In Arcane sind noch keine Umgebungsvariablen für das Projekt eingetragen.
- **Anmeldung endet mit „Anmeldung nicht möglich“:** Im Audit-Log steht der Grund (`anmeldung.abgelehnt`), z. B. `falscher_mandant` oder `keine_rolle`.
- **Abruf fehlgeschlagen:** Unter Snapshots steht der Abruf als „Fehlgeschlagen“; die Fehlerangabe von Microsoft steht im Protokoll des Dienstes `worker`. Häufig fehlt dem Dienstprinzipal von UTCM ein Leserecht.
- **POST-Anfragen werden mit 403 abgewiesen:** `PUBLIC_URL` stimmt nicht exakt mit der Adresse im Browser überein.
