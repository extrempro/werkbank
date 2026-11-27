# Werkbank – Spezifikation

| | |
|---|---|
| Status | Entwurf v0.2 – zur Abstimmung |
| Stand | 15.11.2026 |
| Verantwortlich | IT-Leitung |
| Lizenz | MIT (Open Source) |

> Dieses Dokument beschreibt **was** die Werkbank kann (Funktionen, Datenmodell, Screens) und **unter welchen Bedingungen** sie betrieben wird. Wie einzelne Teile programmiert werden, steht im Code und in den Architektur-Notizen unter `docs/`.
> Entscheidungen sind in Kapitel 16 gesammelt.

---

## 1. Zweck

Die Werkbank ist eine Open-Source-Web-App (installierbar als PWA) für IT-Abteilungen. Sie wird selbst betrieben (self-hosted). Sie bündelt wiederkehrende Verwaltungs- und Freigabeaufgaben in einer Oberfläche mit gemeinsamer Anmeldung, Rollen, Aufgabenliste, Protokollierung und Berichten.

Erste Module:

1. **M365-Konfiguration** – erfasst die Einstellungen des Microsoft-365-Tenants, erkennt Änderungen und führt einen Verlauf je Einstellung.
2. **Evergreen** – Neuerungen von Software (zunächst Microsoft 365) für die IT sichten, mit Notizen festhalten und abschließen.

Weitere Module (z. B. Lizenzen, Zertifikate, Firewall-Konfiguration) sollen später ohne Umbau des Kerns ergänzt werden können.

### Nicht-Ziele (Version 1)

- Keine schreibenden Änderungen am M365-Tenant durch die Werkbank. Sie liest nur.
- Kein eigener Benutzer-/Passwortspeicher. Anmeldung ausschließlich über Microsoft Entra ID.
- Keine Mandantenfähigkeit (ein Tenant, eine Organisation).

---

## 2. Begriffe

| Begriff | Bedeutung |
|---|---|
| Kern | Funktionen, die alle Module nutzen (Anmeldung, Rechte, Aufgaben, Kommentare, Audit-Log, Benachrichtigungen, Reports). |
| Modul | Fachlicher Bereich mit eigenen Daten, Seiten, Rollen und Jobs. |
| Einstellung | Ein einzelner Konfigurationswert im Tenant, eindeutig über einen **Pfad** adressiert, z. B. `entra/conditionalAccess/<Richtlinie>/state`. |
| Snapshot | Ein vollständiger Abruf der Tenant-Konfiguration zu einem Zeitpunkt. |
| Änderung | Ein Unterschied einer Einstellung zwischen zwei Snapshots (neu, geändert, entfernt). |
| Soll-Wert | Der beschlossene oder gewünschte Wert einer Einstellung. |
| Eintrag (Evergreen) | Eine Neuerung einer Software mit Status neu, bearbeitet oder abgeschlossen und Notizen. |
| Konnektor | Zugang zu einem externen System (Graph, Exchange Online PowerShell, …). |

---

## 3. Rahmenbedingungen

### 3.1 Betrieb

| Punkt | Festlegung |
|---|---|
| Laufzeit | Docker / Docker Compose |
| Veröffentlichung | Hinter einem **Reverse Proxy**, **öffentlich erreichbar**. TLS endet am Proxy. |
| Deployment | Docker Compose. Für den Betrieb genügt der Ordner `deploy/` (Compose-Datei und `Dockerfile`), z. B. per **Git-Sync** eines Docker-Verwaltungswerkzeugs. Das Dockerfile holt den Quellcode beim Bauen von GitHub. Eine neue Version läuft erst nach einem neuen Build des Images (`deploy/README.md`); ein Merge auf `main` allein stellt noch nichts bereit. |
| Netzwerkbindung | `BIND_IP` und `BIND_PORT` über `.env`. `BIND_IP` ist die Adresse, über die der Reverse Proxy den Docker-Host erreicht (interne Adresse des Hosts oder `127.0.0.1`), **nicht** die öffentliche IP. Details: `deploy/README.md`. |
| Konfiguration | Ausschließlich über Umgebungsvariablen bzw. Docker-Secrets. `.env.example` im Repo, `.env` niemals. |
| Datensicherung | Eingebaut, im Worker: täglich zur eingestellten Stunde (Ortszeit Europe/Berlin), höchstens ein geplanter Versuch je Tag, zusätzlich „Jetzt sichern“ in der Verwaltung und per Kommando. Je Lauf ein Ordner mit `pg_dump` (Custom-Format) und tar aller Dateien, beide mit GnuPG symmetrisch verschlüsselt (AES-256, Passphrase im Docker-Secret `backup_key`, getrennt von `settings_key`), dazu `info.json` mit Version, Revision und SHA-256. Ziel ist das Volume `backups` oder ein Ordner auf dem Host (`WERKBANK_BACKUP_DIR`). Aufbewahrung als Anzahl (Vorgabe 14). Zurückspielen nur per Kommando bei angehaltener Werkbank (`python -m werkbank.backup wiederherstellen`), die Datenbank in einer Transaktion; Anleitung in `deploy/README.md` und auf der Seite. Die PostgreSQL-Werkzeuge im Image haben die Hauptversion des Servers (16). |
| Zeitzone | Speicherung in UTC, Anzeige in der Zeitzone des Browsers. |
| Sprache | Oberfläche Deutsch. Die Texte stehen bisher direkt in den Seiten; eine zentrale Ablage für weitere Sprachen ist noch nicht umgesetzt. |

### 3.2 Code und Repository

| Punkt | Festlegung |
|---|---|
| Hosting | GitHub, **öffentliches** Repository [`extrempro/werkbank`](https://github.com/extrempro/werkbank). |
| Lizenz | MIT |
| Öffentlichkeit | Keine internen Informationen im Repo: keine Firmen-, Personen-, Host- oder Tenant-Namen, nur neutrale Beispieldaten. Firmenspezifisches nur über Konfiguration. |
| Branches | Arbeit nur auf Feature-Branches (`feature/…`, `fix/…`, `docs/…`). `main` ist geschützt. |
| Merge | Nur per Pull Request mit grünen Checks. PRs erstellt Claude **nur auf ausdrückliche Aufforderung**. |
| Commits | Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `security:` …) |
| Versionen | SemVer. Jeder PR, der die Anwendung ändert, hebt die Version an. Nach dem Mergen legt der Workflow `release.yml` Tag `vX.Y.Z` und GitHub Release mit dem Abschnitt aus `CHANGELOG.md` an. Was Anwender bemerken, steht zusätzlich in der App unter „Neuigkeiten“ (`frontend/src/release-notes.ts`). |
| Abhängigkeiten | Dependabot (pip, npm, Docker, Docker Compose, GitHub Actions) |
| Statische Analyse | CodeQL (GitHub Code Scanning) und Semgrep |
| Secret Scanning | GitHub Secret Scanning mit Push Protection, zusätzlich Betterleaks (Nachfolger von gitleaks) |

---

## 4. Rollen und Berechtigungen

Seit 0.121.0 vergibt die Werkbank die Rechte selbst (6.2). Zwei Gruppen in Entra regeln nur den Einlass: Die **Zugangs-Gruppe** darf sich anmelden, die **Admin-Gruppe** darf sich anmelden und in die Verwaltung. In der Verwaltung bekommt jede Person je Bereich eine **Stufe** (z. B. Lesen, Bearbeiten, Verwalten). Intern steht jede Stufe für feste Rollen aus der Tabelle unten; alle Prüfungen im Code fragen weiter nach diesen Rollen. Jede Prüfung erfolgt **serverseitig**, mit den Rechten aus der Datenbank bei jeder Anfrage. Das Ausblenden in der Oberfläche ist nur Komfort.

| Bereich | Stufen (Rollen) |
|---|---|
| Tickets | Nutzen (`Tickets.Nutzer`), Verwalten (+ `Tickets.Verwaltung`) |
| Dokumentation | Nutzen (`Doku.Nutzer`), Verwalten (+ `Doku.Admin`) |
| IT-Bestand | Lesen (`Bestand.Reader`), Bearbeiten (+ `Bestand.Editor`) |
| Gerätezuordnung | Nutzen (`Geraete.Zuordnung`) |
| IT-Projekte | Lesen (`Projekte.Reader`), Bearbeiten (+ `Projekte.Editor`) |
| IT-Budget | Lesen (`Budget.Reader`), Bearbeiten (+ `Budget.Editor`), Verwalten (+ `Budget.Manager`) |
| IT-Monitoring | Nur Berichte (`Monitoring.Berichte`), Lesen (`Monitoring.Reader`) |
| M365-Einstellungen | Lesen (`Config.Reader`, `Tenant.Reader`), Prüfen (+ `Config.Reviewer`) |
| Evergreen | Lesen (`Evergreen.Reader`), Bearbeiten (+ `Evergreen.Editor`) |
| IT-Tools | Nutzen (`Tools.User`) |

`Werkbank.Admin` vergibt nur die Admin-Gruppe, nie die Verwaltung.

| Rolle | Modul | Darf |
|---|---|---|
| `Werkbank.Admin` | Kern | Verwaltung: Module, Konnektoren, Kommentarregeln, Benachrichtigungsregeln, Audit-Log vollständig |
| `Config.Reader` | M365-Konfiguration | Einstellungen, Verlauf, Änderungen, Snapshots ansehen (Export der Snapshots seit 0.132.1 nur `Werkbank.Admin`) |
| `Config.Reviewer` | M365-Konfiguration | zusätzlich Änderungen bewerten, Beschreibungen und Begründungen pflegen, Soll-Werte setzen |
| `Evergreen.Reader` | Evergreen | Einträge mit Bewertung und Notizen ansehen; keine Aufgaben und Benachrichtigungen |
| `Evergreen.Editor` | Evergreen | Einträge anlegen, bewerten, Notizen anfügen, abschließen und wieder öffnen; Aufgabe und Benachrichtigung bei neuen Einträgen |
| `Tools.User` | IT-Tools | Bereich IT-Tools öffnen. Die Tools rechnen vollständig im Browser und haben keine Daten auf dem Server; die Rolle steuert deshalb nur, wer den Bereich sieht |
| `Tenant.Reader` | Tenant | Lizenzen, Benutzerzahlen und Nutzung der Dienste mit Verlauf, Zertifikate und Secrets, Dienststatus ansehen |
| `Budget.Editor` | IT-Budget | Budget ansehen; Konten, Budgetposten, Verträge, Partner und Rechnungen pflegen |
| `Budget.Manager` | IT-Budget | wie `Budget.Editor`, dazu Rechnungen buchen, Partner zusammenlegen und die Einstellungen des Budgets festlegen |
| `Budget.Reader` | IT-Budget | Budget ansehen (z. B. Geschäftsführung, Controlling) |
| `Monitoring.Reader` | IT-Monitoring | Bereich IT-Monitoring ansehen (Start, alle Quellen mit Hostdetails, Berichte) |
| `Monitoring.Berichte` | IT-Monitoring | Nur die Berichte von IT-Monitoring ansehen und exportieren, ohne Hostdetails (z. B. Geschäftsführung, Controlling) |
| `Projekte.Reader` | IT-Projekte | Projekte ansehen: Übersicht, Budget, Jour Fixe mit Anhängen, Aufgaben |
| `Projekte.Editor` | IT-Projekte | Projekte anlegen, ändern und löschen; Jour Fixe, Anhänge und Aufgaben pflegen |
| `Bestand.Reader` | IT-Bestand | Hardware mit Verlauf und Stammdaten ansehen |
| `Bestand.Editor` | IT-Bestand | Hardware erfassen und ändern, Inventurnummern setzen, ausmustern und wieder in Betrieb nehmen, Stammdaten pflegen |
| `Tickets.Nutzer` | Tickets | Nur Anmeldung, z. B. für Mitglieder anderer Abteilungen; ohne Rolle in einem Bereich kein Zugriff auf Tickets |
| `Doku.Nutzer` | Dokumentation | Bereich öffnen; welche Seiten jemand sieht und ändert, regeln die Arbeitsbereiche und eigenen Rechte von Seiten (8f) |
| `Doku.Admin` | Dokumentation | Arbeitsbereiche anlegen, Personen zuordnen, archivieren, Seiten mit eigenen Rechten zurücksetzen, Versionen einstellen, Papierkorb. Sieht Inhalte nur als Mitglied |
| `Tickets.Verwaltung` | Tickets | Bereiche anlegen, Postfächer anbinden, Rollen der Bereiche vergeben und Vorgabe der Aufbewahrung. Kein Zugriff auf Tickets; die Rollen je Bereich (Bereichsverwaltung, Bearbeiten) liegen in der Werkbank, nicht in Entra (8e) |
| `Geraete.Zuordnung` | Gerätezuordnung | Neue Windows-Geräte per QR-Code scannen, zur Freigabe senden, verwerfen; mit verbundenem Admin-Konto freigeben (dem Tenant zuordnen) |

Sichtbarkeit:

- Wer nur eine Evergreen-Rolle hat, sieht nur **Start** und **Evergreen**.
- Technische Details (Pfade, Links zu Einstellungen) sind für Nicht-IT-Rollen ausgeblendet.

---

## 5. Architektur

```
             Internet
                │  HTTPS
       ┌────────▼────────┐
       │  Reverse Proxy  │
       │   (TLS endet)   │
       └────────┬────────┘
                │  HTTP (intern, BIND_IP:BIND_PORT)
┌───────────────▼──────────────────────────────────────────┐
│ werkbank-web   (FastAPI: API + ausgelieferte PWA)       │
│   └─ Kern + Module                                      │
├─────────────────────────────────────────────────────────┤
│ werkbank-worker (gleicher Code, Jobs/Zeitplan)          │──► Microsoft Graph
│   └─ Collector, Erinnerungen, Reports, Push             │──► Nachrichtencenter
├─────────────────────────────────────────────────────────┤
│ werkbank-pwsh  (PowerShell 7, nur fest definierte Jobs) │──► Exchange Online / Teams
├─────────────────────────────────────────────────────────┤
│ postgres                                                │
└─────────────────────────────────────────────────────────┘
```

| Baustein | Technik |
|---|---|
| Backend | Python 3.14+, FastAPI, SQLAlchemy 2, Alembic (Migrationen je Modul), Pydantic |
| Frontend | React + Vite + TypeScript, als PWA mit Service Worker |
| Worker | gleicher Code wie Backend, eigener Container (`python -m werkbank.worker`), Job-Tabelle in PostgreSQL (keine zusätzliche Queue in v1). Genau ein Worker; regelmäßige Aufträge plant er selbst ein. Fehlgeschlagene Aufträge stehen im Audit-Log. |
| PowerShell | Container mit PowerShell 7, ExchangeOnlineManagement- und MicrosoftTeams-Modul. Nimmt **nur** benannte Jobs vom Worker an (kein freier Befehl). |
| Datenbank | PostgreSQL 16+, JSONB für Einstellungswerte |
| Container | non-root, schreibgeschütztes Dateisystem wo möglich, Healthchecks, Image-Versionen fest |

### 5.1 Modulschnittstelle

Ein Modul liefert:

- Datenbanktabellen und Migrationen
- API-Routen und Seiten
- Rollen, Stufen und Rechte
- Jobs (z. B. Collector)
- Aufgaben für die Aufgabenliste
- Dashboard-Kacheln
- Berichtsvorlagen
- Navigationseinträge

Module werden über die Verwaltung aktiviert oder deaktiviert.

---

## 6. Kernfunktionen

### 6.1 Anmeldung

- **Microsoft Entra ID**, OpenID Connect, Authorization Code Flow mit PKCE. Einrichtung: [`docs/entra-setup.md`](entra-setup.md).
- Einlass über zwei Gruppen in Entra (Objekt-IDs `ENTRA_ADMIN_GROUP_ID`, `ENTRA_ACCESS_GROUP_ID`), geprüft bei jeder Anmeldung im Namen der Person über Graph (`POST /me/checkMemberGroups`, transitiv, delegiert `User.Read`). Wer in keiner ist, wird abgelehnt; Graph nicht erreichbar heißt ebenfalls Ablehnung. Ohne eingetragene Gruppen (Übergang) gilt wie bisher: Anmeldung mit mindestens einer App-Rolle, Verwaltung mit `Werkbank.Admin`.
- Unternehmensanwendung mit „Zuweisung erforderlich“ empfohlen; zugewiesen werden die beiden Gruppen.
- **Backend-for-Frontend**: Tokens bleiben im Backend. Der Browser erhält nur ein Session-Cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-`-Präfix).
- Session: Leerlauf-Timeout 30 Minuten, absolute Dauer 8 Stunden. Abmelden beendet die Session serverseitig.
- **Erneute Anmeldung (Step-up)** beim Öffnen der Verwaltung, wenn die letzte Anmeldung länger als 15 Minuten zurückliegt (`STEP_UP_MINUTES`). Die Werkbank schickt die Person dann mit `prompt=login` zu Entra. Liefert Entra den Zeitpunkt der letzten echten Anmeldung mit (`auth_time`), zählt dieser; eine stille Anmeldung über eine bestehende Entra-Sitzung gilt dann nicht als frisch. Dieselbe Regel gilt, wenn Rechte vergeben oder entzogen werden: Rollen in Ticket-Bereichen (auch beim Anlegen eines Bereichs), Personen eines Doku-Arbeitsbereichs (nur wenn sich Personen oder Rollen ändern, nicht bei Name oder Beschreibung) und das Zurücksetzen eigener Seitenrechte durch die Doku-Verwaltung. Eigene Rechte einer Seite („Rechte und Teilen“) brauchen keine frische Anmeldung.
- Jede Anmeldung beendet die vorherige Sitzung desselben Browsers (neues Token).
- **Angemeldete Geräte** (Konto): Liste der eigenen gültigen Sitzungen (`GET /api/account/sessions`), dieses Gerät zuerst und markiert, je Sitzung Gerät, angemeldet seit und zuletzt aktiv. Andere Geräte lassen sich einzeln (`DELETE /api/account/sessions/{id}`, nur eigene, nicht die laufende: 409) oder alle auf einmal abmelden (`POST /api/account/sessions/logout-others`); dieses Gerät über „Abmelden“. Das Gerät ist eine Kurzbeschreibung aus der Browserkennung aus festen Wörtern („Edge unter Windows“, `core/user_agent.py`), gespeichert in `user_sessions.device`; die Kennung selbst und keine IP-Adresse. Audit `sitzung.beendet` bzw. `sitzungen.andere_beendet`.
- **Profilbild (optional, `ENTRA_PROFILE_PHOTO`):** Bei der Anmeldung liest die Werkbank mit der delegierten Berechtigung `User.Read` das eigene Bild der Person, speichert es und zeigt es allen angemeldeten Personen. Das Zugriffstoken wird danach verworfen. Ein Fehler beim Abruf verhindert die Anmeldung nicht.
- **Seite „Konto“:** eigene Angaben, Rollen, angemeldete Geräte, Darstellung, Schriftgröße und Abstände im Menü (je Browser), Version.
- **Entra Conditional Access** mit einer eigenen Richtlinie nur für die Werkbank, da MFA im Tenant noch nicht allgemein erzwungen wird:
  - **Benutzer:** alle Gruppen mit Werkbank-Rollen (bzw. alle Benutzer)
  - **Zielressource:** Enterprise-App „Werkbank“
  - **Gewähren:** MFA erforderlich (Authentifizierungsstärke „Multifaktor-Authentifizierung“)
  - **Einführung:** zuerst „Nur Bericht“, dann „Ein“
  - Die Collector-App (Zertifikat, keine Benutzeranmeldung) ist davon nicht betroffen.
  - Voraussetzung: Entra ID P1 für alle Werkbank-Nutzer.
- Login-Seite: Name der App, Button „Mit Microsoft anmelden“, Hinweis auf Datenschutz. Ohne Anmeldung ist außer Login-Seite, Offline-Seite und statischen Dateien nichts erreichbar.
- Auf iOS als installierte PWA: Redirect statt Popup.

### 6.1a Berechtigungen (Verwaltung › Berechtigungen)

- Liste aller Personen, die sich je angemeldet haben oder aufgenommen wurden, mit Stufen je Bereich; Ansicht „Nach Bereich“ als Matrix.
- Stufen setzen und „Alle Rechte entziehen“ (mit Bestätigung) nur `Werkbank.Admin` mit frischer Anmeldung; jede Änderung mit vorher/nachher im Audit-Log (`berechtigungen.geaendert`). Änderungen wirken sofort, auch in laufenden Sitzungen.
- **Einmalige Übernahme:** Bei der ersten Anmeldung nach der Umstellung werden die App-Rollen aus dem Token als ganze Stufen übernommen (die wichtigste Rolle einer Stufe genügt, z. B. `Budget.Manager` → Verwalten; `Tenant.Reader` → M365 Lesen). `Werkbank.Admin` wird nicht übernommen. Danach und sobald ein Admin Rechte gespeichert hat, zählen App-Rollen nicht mehr.
- **Person hinzufügen:** Suche in Entra über die Collector-App (`User.Read.All`), nur Personen, die die Werkbank noch nicht kennt; aufgenommen ohne Rechte. Anmelden kann sich die Person nur als Mitglied einer der beiden Gruppen.

### 6.2 Aufgabenliste („Meine Aufgaben“)

- Startseite für alle Rollen.
- Module melden Aufgaben über eine gemeinsame Schnittstelle: Titel, Untertitel, Modul, Fälligkeit, Ziel-Link, zuständige Rolle bzw. Person.
- Beispiele: offene Änderung prüfen (Config.Reviewer), Evergreen-Schritt (zuständige Rolle), Konnektor-Fehler (Admin).
- Zähler in der Kopfzeile und in der Navigation.
- Stand: Die Aufgaben werden bei jeder Abfrage aus dem Stand der Module ermittelt (`/api/tasks`) und nicht gespeichert; der Zähler steht in der Navigation beim Eintrag „Start“. M365-Konfiguration meldet offene Änderungen und Abweichungen vom Soll-Wert (`Config.Reviewer`) sowie einen fehlgeschlagenen Abruf (`Werkbank.Admin`). Der Zähler steht auch in der Kopfzeile. Die Zähler laden die Aufgaben bei jedem Seitenwechsel, nach jeder Änderung, wenn das Fenster wieder in den Vordergrund kommt, und alle fünf Minuten neu. Evergreen meldet Bearbeitern je Software die Zahl neuer Einträge. Eine Tabelle `tasks` für einzeln zugewiesene Aufgaben ist bisher nicht nötig und nicht umgesetzt.

### 6.3 Workflow-Engine

Entfernt in 0.124.2 (entschieden, Migration 0085): Die Engine für Abläufe in YAML (Schritte, Rollen, Aktionen, unveränderliches Protokoll) wurde seit dem Umbau von Evergreen in 0.76 von keinem Bereich mehr genutzt. Code, Tabellen (`workflow_instances`, `workflow_events`, Migration 0085) und die Abhängigkeit `pyyaml` sind entfernt. Braucht ein Bereich wieder einen festen Ablauf, wird er dort umgesetzt oder die Engine neu aufgebaut.

### 6.4 Kommentare und Kommentarregeln

- Kommentare an jedem Objekt (Änderung, Einstellung, Vorgang). Nur Klartext, keine HTML-Darstellung.
- **Kommentarregeln** zentral in der Verwaltung pflegbar. Eine Regel gilt als erfüllt bei mindestens 10 Zeichen **oder** einer Ticket-/Change-Nummer (Muster konfigurierbar, Standard `#\d+`, `CHG-\d+`, `INC-\d+`).
- Schnellauswahl-Texte je Modul konfigurierbar.
- Der Button einer Aktion ist deaktiviert, solange eine Pflichtregel nicht erfüllt ist. Ein Hinweis erklärt, warum.
- Die Prüfung erfolgt zusätzlich serverseitig.

Standardregeln:

| Bereich | Fall | Kommentar |
|---|---|---|
| Änderungen | ungewollt | Pflicht |
| Änderungen | gewollt bei Kritikalität „Hoch“ | Pflicht |
| Änderungen | gewollt bei Änderung durch Konto außerhalb der IT | Pflicht |
| Änderungen | Einstellung durch BR-Beschluss geregelt | Pflicht |
| Änderungen | gewollt, sonst | optional |
| Evergreen | Notiz anfügen | Pflicht (die Notiz selbst) |
| Evergreen | abschließen, wieder öffnen | optional |

### 6.5 Anhänge

- Erlaubt: PDF, PNG, JPG. Max. 10 MB je Datei. Die Prüfung erfolgt über den tatsächlichen Dateiinhalt, nicht nur über die Endung.
- Speicherung in einem eigenen Docker-Volume, Metadaten in der Datenbank. Download nur mit Berechtigung auf das zugehörige Objekt.
- Kein Virenscan (entschieden): Geprüft werden Dateiart über den Inhalt und Größe; Dateien werden nie ausgeführt und nur als Download ausgeliefert.

### 6.6 Audit-Log

- Nur Anhängen erlaubt, keine Änderung, kein Löschen über die App. Einzige Ausnahme ist die Aufbewahrungsfrist.
- Protokolliert: Anmeldung und Abmeldung, Rollennutzung, Bewertungen, Änderungen an Beschreibungen, Soll-Werten und Regeln, Verwaltungsaktionen, Exporte, Zugriffe auf Anhänge.
- Felder: Zeitpunkt, Person (Entra-Objekt-ID und Anzeigename), Modul, Aktion, Objekt, Ergebnis, IP (gekürzt, siehe Datenschutz).
- Aufbewahrung: 90 Tage, in der Verwaltung einstellbar (30 bis 3650 Tage). Der Worker löscht ältere Einträge stündlich und protokolliert die Bereinigung. Die Datenbank lässt das Löschen nur für diesen Auftrag zu und nie für Einträge unter 30 Tagen.

### 6.7 Benachrichtigungen

| Kanal | Inhalt |
|---|---|
| Mail (über den SMTP-Server aus der Verwaltung) | kurzer Hinweis mit Link, **ohne** fachliche Inhalte |
| Teams-Kanal (IT) | kritische Änderungen und Konnektor-Fehler |
| Web Push | Name aus dem Branding, Bereich und Anzahl (z. B. „IT-Budget: 2 neue Benachrichtigungen“), **keine fachlichen Inhalte**; Tippen öffnet „Benachrichtigungen“ |

- Push ist pro Person per Opt-in zu aktivieren und jederzeit abschaltbar.
- Stand: Umgesetzt sind die **Glocke** in der Kopfzeile, **Mail und Teams** und **Push** (siehe unten).

**Push (umgesetzt):** Die Verwaltung schaltet Push unter Verwaltung › Mail & Teams ein; beim ersten Einschalten erzeugt der Server ein VAPID-Schlüsselpaar (P-256), der private Teil liegt mit `settings_key` verschlüsselt in der Datenbank (`app_settings`, Schlüssel `push`), nie im Repository und nie in einer Antwort. Jede Person schaltet Push im Konto je Gerät ein (Erlaubnis des Browsers, Abo beim Push-Dienst; höchstens 10 Geräte) und wählt je Art die Spalte „Push“ (Vorgabe: aus). Ein Auftrag (`kern.push_versand`, alle 2 Minuten) schickt je Person eine Sammelnachricht an alle ihre Geräte, nur für ungelesene Benachrichtigungen der eingeschalteten Arten, die nach dem Einschalten und in den letzten 24 Stunden entstanden sind. Inhalt: Titel = Name aus dem Branding, Text = Bereich und Anzahl, Ziel immer `/benachrichtigungen`. Verschlüsselt nach RFC 8291 (aes128gcm), signiert nach RFC 8292 (VAPID, `sub` = `PUBLIC_URL`), TTL 24 Stunden, ohne Zusatzpaket (`core/webpush.py`). Der Server schickt nur an bekannte Push-Dienste (`fcm.googleapis.com`, `*.push.apple.com`, `*.push.services.mozilla.com`, `*.notify.windows.com`); abgelaufene Abos (404/410) löscht er. Audit-Log: `einstellungen.push_geaendert`, `konto.push_geraet_angemeldet`, `konto.push_geraet_abgemeldet`.

**Mail und Teams (umgesetzt):** Ein Auftrag (`kern.benachrichtigungen_versand`, alle 15 Minuten) fasst je Person und Kanal die neuen, ungelesenen Benachrichtigungen der eingeschalteten Arten zusammen und schickt höchstens eine Nachricht: Name aus dem Branding, Anrede mit „du“, Zahl der Benachrichtigungen je Bereich, Link auf „Benachrichtigungen“ und auf das Konto, **keine fachlichen Inhalte** (keine Titel). Jede Person stellt je Art Glocke, Mail und Teams im Konto ein; Mail und Teams sind anfangs aus, mitgeteilt wird nur, was nach dem Einschalten entsteht. Ohne Glocke gibt es auch keine Mail und kein Teams. Ohne Mailadresse in Entra weder Mail noch Teams. Fehlgeschlagene Sendungen werden beim nächsten Lauf wiederholt, nach 24 Stunden verfallen sie.

- **Mail:** über den SMTP-Server aus der Verwaltung, als Text und HTML im gemeinsamen Aussehen aller Mails (`core/mail_layout.py`): Farbe, Logo (PNG, eingebettet, keine externe Adresse), Fußzeile und Datenschutz-Link aus dem Branding. Ebenso die Mails des Verleihs im IT-Bestand.
- **Teams:** Adaptive Card an einen Power-Automate-Workflow, der sie als Flow-Bot in den Chat der Person stellt (Empfänger: Mailadresse). Die Adresse des Workflows trägt ein Admin unter Verwaltung › Allgemein ein; sie liegt verschlüsselt in der Datenbank, wird nie ausgegeben und muss eine https-Adresse von Power Automate bzw. Logic Apps sein (`…logic.azure.com`, `…api.powerplatform.com`, Port 443, keine Weiterleitungen). Testnachricht an die eigene Adresse. Einrichtung: [`docs/teams-workflow.md`](teams-workflow.md).

**Glocke (umgesetzt):** Ein Auftrag im Worker (`kern.benachrichtigungen`, alle 5 Minuten) fragt die Quellen der Module ab. Jede Quelle meldet die aktuell vorliegenden Ereignisse mit festem Schlüssel; gemeldet wird nur, was neu ist, jedes Ereignis einmal. Beim ersten Lauf einer Art gilt der Bestand als gemeldet (keine Flut alter Meldungen). Empfänger sind alle Personen, deren Rollen bei der letzten Anmeldung passen; die API zeigt zusätzlich nur Arten, die zu den Rollen der laufenden Sitzung passen. Alle Arten sind eingeschaltet; jede Person kann einzelne Arten im Konto ausschalten. Gespeichert werden Art, Titel, Link und Zeitpunkt (Titel nennt z. B. Vorgang, Vertrag oder Rechnungsnummer), Aufbewahrung 90 Tage.

| Art | Bereich | Rollen | Auslöser |
|---|---|---|---|
| Kritische Änderung | M365-Konfiguration | Config.Reviewer | offene Änderung an einer Einstellung mit Kritikalität hoch (letzte 7 Tage) |
| Abweichung | M365-Konfiguration | Config.Reviewer | neue Abweichung vom Soll-Wert (je Einstellung und Version) |
| Abruf fehlgeschlagen | M365-Konfiguration | Werkbank.Admin | letzter Snapshot fehlgeschlagen |
| Störung | M365-Tenant | Tenant.Reader | Störung (nicht Hinweis) beginnt und ist behoben |
| Zugangsdaten | M365-Tenant | Tenant.Reader | Geheimnis oder Zertifikat erreicht Warnung, dringend, abgelaufen |
| Lizenzen | M365-Tenant | Tenant.Reader | aufgebraucht, überbucht, Stichtag in 30 Tagen |
| Neue Einträge | Evergreen | Evergreen.Editor | neue Einträge je Software (ein Hinweis mit Anzahl; erneut, sobald weitere dazukommen) |
| Rechnung prüfen | IT-Budget | Budget.Manager | neue, noch nicht gebuchte Rechnung |
| Rechnung gebucht | IT-Budget | wer sie erfasst hat | gebucht von einer anderen Person |
| Kündigung | IT-Budget | Budget.Editor, Budget.Manager | 60, 30 und 7 Tage vor dem Kündigungstermin |
| Ist über Plan | IT-Budget | Budget.Editor, Budget.Manager | Ist eines Postens im laufenden Geschäftsjahr übersteigt den Plan |
| Auftrag fehlgeschlagen | Werkbank | Werkbank.Admin | Hintergrundauftrag fehlgeschlagen (außer dem Abruf der Einstellungen) |
- Regeln je Modul in der Verwaltung, z. B. „Änderung an Kritikalität Hoch → sofort Teams“.

### 6.8 Reports

- Erzeugung als PDF und CSV im Worker.
- Geplanter Versand per Mail mit Link, kein Anhang mit Inhalten. Abruf nach Anmeldung.
- Vorlagen liefern die Module (Kapitel 8.7; für die M365-Konfiguration entfällt das, 7.7).

### 6.9 Beschreibungstexte mit KI (optional)

- Vorschläge für verständliche Beschreibungen von Einstellungen.
- Übergeben werden nur technische Metadaten (Name, Schema-Text, Wert, Microsoft-Ankündigung), **keine personenbezogenen Daten**.
- Ergebnis gekennzeichnet als „KI-generiert, ungeprüft“, bis eine berechtigte Person es übernimmt.
- Abschaltbar in der Verwaltung. Anbieter, Vertrag (AVV) und Freigabe durch den Datenschutz klärt der Betreiber außerhalb der Werkbank.
- Evergreen (seit 0.85, 8.4): Vorschläge für Rollout-Phasen und Steckbrief aus dem Text der Meldung von Microsoft, mit eigenem Schalter „Vorschläge für Evergreen“ neben „Beschreibungen für Einstellungen“; derselbe Anbieter und dieselbe Höchstzahl je Stunde (je Bereich). Übergeben wird nur öffentlicher Text von Microsoft, keine Daten aus dem Tenant.
- Stand: umgesetzt für Einstellungen der M365-Konfiguration. Anbieter (Art der Schnittstelle: OpenAI-kompatibel über `/chat/completions` oder Anthropic über `/messages` mit adaptivem Mitdenken bei geringem Aufwand (`output_config.effort: low`, `max_tokens` 4000), ohne `temperature`; Adresse, Modell, Schlüssel) und Höchstzahl je Stunde stehen in der Verwaltung; bei Fehlern zeigt die Werkbank die Meldung des Anbieters gekürzt (höchstens 200 Zeichen, einzeilig, nie der Schlüssel), Standard ist ausgeschaltet. Abweichung zum Schutz der Daten: Übergeben werden nur Dienst, Bereich und Name der Eigenschaft, **nicht** der Wert und nicht der Name des Objekts (beides kann Personen- oder Firmennamen enthalten). Ein Text gilt deshalb für alle Einstellungen derselben Art (`cfg_ai_texts`). Der Worker erzeugt die Texte stündlich für Einstellungen ohne eigene Beschreibung; Reviewer geben frei oder verwerfen.

### 6.10 Suche

Globale Suche über Einstellungen (Pfad, Name, Wert, Beschreibung, Begründung) und Vorgänge (ID, Titel, Zusammenfassung). Ergebnisse gefiltert nach Berechtigung.

- Stand: umgesetzt als `GET /api/search` mit einem Anbieter je Modul (`core/search.py`), Suchfeld in der Kopfzeile und Seite „Suche“. Gesucht wird in Einstellungen (Pfad, Name, Beschreibung, Begründung), erkannten Änderungen (geändert von, Kommentar) und Vorgängen (Nummer, Titel, Dienst, Zusammenfassung). Jeder Anbieter wendet dieselben Rechte an wie die Seiten seines Moduls. Abweichung: Im Wert einer Einstellung wird noch nicht gesucht. Die IT-Tools liegen im Browser; die Seite „Suche“ ergänzt passende Tools selbst, wenn die Person die Rolle `Tools.User` hat, und passende Abschnitte des Handbuchs (6.11). Diese Treffer stehen sofort da, auch während der Server noch sucht oder wenn seine Suche fehlschlägt.
- Schnellsuche (Strg+K / ⌘K, Suchfeld in der Kopfzeile, am Handy „Suche“ unten): findet Seiten der Navigation nach Name, Gruppe und Bereich, nur mit Recht, ganz im Browser; ohne Eingabe „Zuletzt besucht“. „In allen Einträgen suchen“ führt zur Seite „Suche“ mit dem Suchbegriff.

### 6.10a Navigation, Anheften und „Zuletzt besucht“

- Bereichsleiste (ein Symbol je Bereich), Seitenmenü mit Gruppen und Kontomenü; am Handy eine Leiste unten mit Menü als Blatt (Gestaltung: `docs/design.md`, Kapitel 1). Bereiche, Gruppen und Seiten nach Rollen in `areasFor` (`frontend/src/navigation.ts`).
- Anheften und „Zuletzt besucht“ werden je Person auf dem Server gespeichert (Tabelle `nav_entries`, Migration 0051): `GET /api/navigation`, `PUT /api/navigation/pins` (höchstens 20, Reihenfolge wie übergeben), `POST /api/navigation/recent` (die letzten 10 bleiben), `DELETE /api/navigation/recent`. Nur eigene Einträge; nur Pfade aus der Liste erlaubter Seiten in `core/navigation.py`, die dieselbe Rollenlogik spiegelt; beim Ausgeben wird erneut nach Rollen gefiltert. Ohne Netz zeigt die Oberfläche den zuletzt geladenen Stand; der Service Worker speichert nichts davon.
- Aufgabe für `Bestand.Editor`: „Offene Vorgänge bearbeiten“ (neue und angefangene Vorgänge im IT-Bestand, `modules/inventory/tasks.py`).

### 6.10b Bestätigen

Aktionen mit Folgen fragen vorher in einem Bestätigungsdialog nach (Regeln in `docs/design.md`, Abschnitt „Bestätigen“; `components/ConfirmDialog.tsx`). PC und Tablet: Fenster in der Mitte; Handy: Blatt von unten. Überschrift als Frage, ein bis zwei Sätze, was passiert, Knopf mit dem Verb; bei Unumkehrbarem roter Knopf und Hinweis. Fokus zuerst auf „Abbrechen“, Esc, Klick daneben und Wischen nach unten brechen ab; bei mehreren offenen Fenstern (z. B. Geräte-Ansicht) gilt Esc nur dem obersten. Betroffen sind u. a. Löschen in allen Bereichen, Rechnung buchen, Posten und Evergreen-Einträge abschließen und wieder öffnen, Partner zusammenlegen, Import abbrechen und verwerfen, Inventurnummer setzen, Gerät ausmustern, Grundriss entfernen, Geräte freigeben, zur Freigabe senden, verwerfen und Admin-Konto trennen, andere Geräte abmelden, Push-Gerät entfernen, Branding-Bilder entfernen und den Tool-Verlauf löschen.

### 6.11 Handbuch, Info-Symbole und Hilfe

- Seite „Handbuch“ (`/handbuch`) für alle, erreichbar über das Kontomenü oben rechts, die Seite „Konto“, die Suche, „Hilfe“ an jedem Seitentitel und „Mehr im Handbuch“ in den Info-Symbolen.
- Aufbau (seit 0.84): **Bereiche** in der Reihenfolge der Bereichsleiste (Grundlagen, Microsoft 365, Evergreen, IT-Monitoring, IT-Bestand, IT-Budget, IT-Projekte, IT-Tools, Verwaltung, Fragen und Hilfe), darin **Teile** wie die Gruppen im Seitenmenü (z. B. IT-Budget: Überblick, Ausgaben, Stammdaten, Verwaltung) und je **Thema** eine Seite (`/handbuch/<bereich>/<thema>`; `/handbuch/<bereich>` listet die Themen). Alte Adressen (`/handbuch/<kapitel>#<abschnitt>`) werden nicht weitergeleitet.
- **Untermenü:** Auf Handbuch-Seiten steht im Seitenmenü statt des Menüs eines Bereichs das Handbuch: Suche (filtert sofort), „Übersicht“, die Bereiche zum Auf- und Zuklappen mit Zahl der Themen (Zustand je Browser, `werkbank-handbuch-gruppen`; der geöffnete Bereich ist anfangs offen), darin die Teile mit Überschrift und die Themen (gewählt mit `aria-current`). Am Handy öffnet „Alle Themen“ dasselbe Menü in einem Blatt von unten.
- **Themenseite:** Pfad (Handbuch › Bereich › Teil), Titel, für welche Rollen das Thema gilt, Verweis auf die passende Seite der Werkbank, Inhalt (Text, Anleitungen in Schritten, Begriffe, Hinweise, Verweise), „Weitere Themen in <Teil>“ und vorheriges/nächstes Thema.
- Jede Person sieht die Themen ihrer Rollen (Rollen am Thema, sonst am Teil, sonst am Bereich); `Werkbank.Admin` sieht alles. Ein Thema ohne passende Rolle gilt als nicht vorhanden.
- **Info-Symbole:** Fachbegriffe, berechnete Werte und Felder mit Folgen tragen ein „i“ (gemeinsame Komponente `components/InfoTip.tsx`). Klick oder Enter öffnet eine Blase mit höchstens zwei Sätzen und „Mehr im Handbuch ›“ (nur, wenn die Person das Thema sehen darf); Esc, ein Klick daneben oder ein zweiter Klick schließt sie. Die Texte stehen zentral in `frontend/src/help/terms.ts`, jeweils mit Thema im Handbuch.
- **Begriffe A–Z** (`/handbuch/hilfe/begriffe`): alle Erklärungen der Info-Symbole, deren Thema die Person sehen darf, alphabetisch mit Verweis auf das Thema.
- **Hilfe zu dieser Seite:** Hinter dem Seitentitel (neben dem Stern) steht „Hilfe“; es führt zum passenden Thema (Zuordnung Pfad → Thema in `help/terms.ts`, längster passender Pfad, erstes sichtbares Thema).
- Die Inhalte liegen als Daten in `frontend/src/handbook/content.ts` und werden nur als Text dargestellt. Die Suche im Handbuch und die Treffer auf der Seite „Suche“ ermittelt der Browser.
- Nur Bedienung; Einrichtung und Betrieb stehen weiter in `docs/`.

---

## 7. Modul M365-Konfiguration

### 7.1 Datenquellen

| Quelle | Inhalt |
|---|---|
| UTCM (Microsoft Graph v1.0, Snapshots) | breite Abdeckung über Entra, Exchange, Intune, Teams, Security & Compliance |
| Microsoft Graph (v1.0/beta) | Ergänzung für nicht abgedeckte Bereiche (SharePoint- und OneDrive-Mandanteneinstellungen), Entra-Audit-Logs („wer hat geändert“) |
| Exchange Online PowerShell | Org-, Transport-, Anti-Spam-Konfiguration u. a. |
| Teams PowerShell | Richtlinien, die nicht über Graph verfügbar sind |

- Zugriff ausschließlich **lesend**, Anmeldung per **Zertifikat** (separate App-Registrierung „Werkbank Collector“).
- Abruf **einmal täglich** (`COLLECTOR_INTERVAL_HOURS`), zusätzlich manuell durch Admin.
- **Berechtigungen prüfen** (Verwaltung › Verbindungen, `POST /api/admin/collector/check`, `Werkbank.Admin` mit frischer Anmeldung, nur lesend): Die Rechte der Collector-App kommen aus ihrem Zugriffstoken (`roles`); verglichen werden Pflichtrechte (Abruf, „Geändert von“, Nachrichtencenter) und die Rechte der eingeschalteten Funktionen, dazu freiwillige (User.Read.All, GroupMember.Read.All, Application.Read.All). Beim Dienstprinzipal von UTCM liest die Werkbank die zugewiesenen Anwendungsberechtigungen bei Microsoft Graph und Exchange Online (`appRoleAssignments`, braucht `Application.Read.All` der Collector-App) und vergleicht sie je Typ aus `COLLECTOR_RESOURCES` (Conditional Access, benannte Standorte, Autorisierung, Exchange: `Exchange.ManageAsApp`, Teams: `Organization.Read.All`, Intune: je nach Typ `DeviceManagementConfiguration.Read.All`, `DeviceManagementApps.Read.All` oder `DeviceManagementServiceConfig.Read.All` und `Group.Read.All`); ein Schreibrecht deckt das Leserecht. Entra-Rollen (Globaler Leser, Sicherheitsleseberechtigter) werden nicht geprüft, dafür steht ein Hinweis da. Audit `rechte_geprueft` mit den fehlenden Rechten.
- **Aufbewahrung der Abrufe:** Nach jedem Abruf löscht der Worker Abrufe, die älter als `COLLECTOR_SNAPSHOT_KEEP_DAYS` Tage sind (Vorgabe 90, 0 = nie) und an denen kein Verlauf hängt (keine Version einer Einstellung und keine erkannte Änderung). Abrufe mit Änderungen und die letzten 10 Abrufe bleiben immer erhalten. Audit `snapshots_bereinigt` mit Anzahl.
- **Seite Snapshots:** zuerst die letzten 10 Abrufe, „Weitere anzeigen“ lädt jeweils 10 nach (`GET /api/m365-config/snapshots?limit=&offset=`). Je Abruf nur die Zusammenfassung der Quellen (vollständig, mit Fehler); die Fehler sind aufklappbar und nach fehlender Berechtigung gruppiert.
- **Ablauf mit UTCM:** Der Worker teilt die eingetragenen Ressourcentypen (`COLLECTOR_RESOURCES`) nach Workload auf (Präfix `microsoft.<workload>.`, z. B. Entra, Exchange, Teams, Intune) und lässt UTCM je Workload einen eigenen Snapshot-Auftrag erstellen. Workloads mit mehr als `COLLECTOR_MAX_TYPES_PER_JOB` Typen (Vorgabe 10, gültig 1–50, sonst startet die Werkbank nicht) werden in möglichst gleich große Teile geteilt (z. B. 29 → 10/10/9, Reihenfolge wie in `COLLECTOR_RESOURCES`), jeder Teil ist ein eigener Auftrag mit eigener Kennung (Hash seiner Typen in der Beschreibung), damit fertige Aufträge im nächsten Lauf (24 h) weiter übernommen werden. Grund: Sehr große Ergebnisse (z. B. Intune mit vielen Settings-Catalog-Profilen) scheiterten beim Download mit 502. Vor dem Anlegen räumt die Werkbank eigene, fertige, nicht übernehmbare Aufträge weg und zählt die freien Plätze (höchstens 12 sichtbare Aufträge je Tenant); Teile ohne Platz werden in diesem Lauf mit „<Workload> · Teil x/y: kein freier Platz bei UTCM“ übersprungen, ohne Gesamtfehler. Fehlertexte nennen Workload und Teil („Intune · Teil 2/3 · Download: …“) und betreffen nur dessen Typen; der Snapshot steht dann auf „teilweise“. Protokoll: beim Start die Zahl geplanter Aufträge (Warnung ab mehr als 10), nach jedem Download Workload, Teil, Zahl der Typen und Objekte, Größe in KB und Dauer, ohne Inhalte. Die Aufträge laufen nacheinander: anlegen, auf das Ergebnis warten, herunterladen. Alle Ergebnisse gehen in einen gemeinsamen Abgleich mit dem Bestand (7.3), also einen Snapshot der Werkbank. Den Verlauf hält die Werkbank; UTCM bewahrt Snapshots höchstens 7 Tage auf. Die UTCM-Monitore werden nicht genutzt.
- **Benennung der Aufträge** (seit 0.144.1): Name `Werkbank <JJMMTT> <HHMMSS> <4 Zeichen der Kennung>` (z. B. „Werkbank 261126 075220 3f9a“), Beschreibung `Werkbank <workload> <Kennung>` mit der Typengruppe (Kennung: die ersten 8 Zeichen der SHA-256-Prüfsumme der Typen; lange Workload-Namen werden gekürzt). Beide höchstens 32 Zeichen, nur Buchstaben ohne Umlaute, Ziffern und Leerzeichen; die Werkbank prüft das vor dem Senden. Die Grenze ist nicht dokumentiert, sondern beobachtet: Namen mit 39 Zeichen lehnte UTCM mit 400 ab. Eigene Aufträge erkennt die Werkbank am Präfix „Werkbank “ im Namen; ältere Namensformate (bis 0.144.0) werden nur aufgeräumt, nie übernommen.
- **Fehler je Workload:** Scheitert eine Workload, fehlen nur ihre Typen: Der Snapshot ist „teilweise“, ihre Einstellungen bleiben unverändert und gelten nicht als entfernt. „Fehlgeschlagen“ ist er erst, wenn keine Quelle gelesen werden konnte; auch dann steht der Fehlertext je Typ am Snapshot (`source_errors`), und die Verwaltung bekommt eine Aufgabe. Der Fehlertext nennt Workload und Schritt (`Auftrag anlegen`, `Status`, `Zeitüberschreitung`, `Download`, `UTCM meldet Fehler`), z. B. „Exchange · Download: Microsoft Graph antwortet mit 502 (UnknownError) · request-id …“, gekürzt auf die zulässige Länge. Bei Ablehnungen hängt die Werkbank die Validierungsdetails von Graph an („Details: Feld: Meldung“, aus `error.details[]`, einem `errors`-Objekt oder `innerError.message`), nur Feldnamen und Meldungen von Graph, keine Werte der Anfrage.
- **Wiederholungen:** Lesende Anfragen (GET) an Microsoft Graph wiederholt die Werkbank bei 429, 502, 503, 504 sowie bei Zeitüberschreitung oder Verbindungsfehler bis zu viermal mit 5, 15, 45 und 90 Sekunden Abstand; ein `Retry-After` geht vor, höchstens 120 Sekunden. Anlegen (POST) und Löschen (DELETE) werden nicht wiederholt. Jede Wiederholung steht als Warnung im Log, ohne Daten des Tenants.
- **Fertige Aufträge weiterverwenden:** Scheitert nur der Download eines fertigen Auftrags, bleibt der Auftrag bei UTCM stehen. Der nächste Abruf übernimmt ihn, wenn er dieselbe Typengruppe betrifft (Kennung aus Workload und Prüfsumme der Typen in der Beschreibung des Auftrags) und höchstens 24 Stunden alt ist; sonst löscht er ihn.
- **Grenzen von UTCM:** höchstens 20.000 gelesene Objekte pro Tenant und Monat, höchstens 12 sichtbare Snapshot-Aufträge. Die Werkbank zählt die gelesenen Objekte je Abruf, warnt ab 80 % und ruft bei ausgeschöpftem Kontingent nicht mehr ab; geprüft wird vor jeder Workload, damit ein Abruf das Kontingent nicht überzieht. Vor dem Anlegen zählt sie die sichtbaren Aufträge (fremde, laufende, weiterverwendbare) und legt keinen weiteren an, wenn 12 erreicht sind. Eigene, abgeschlossene Snapshot-Aufträge entfernt sie nach dem Abgleich wieder.
- **Berechtigungen:** Die Collector-App braucht `ConfigurationMonitoring.ReadWrite.All` (Schreibrecht nur auf die Snapshot-Aufträge von UTCM, nicht auf Einstellungen des Tenants) und `AuditLog.Read.All` für „Geändert von“. Die eigentlichen Leserechte erhält der Dienstprinzipal „Tenant Configuration Management“ von Microsoft (für Conditional Access neben `Policy.Read.All` auch Leserechte auf Benutzer, Gruppen, Rollen und Anwendungen, weil UTCM Namen statt Kennungen ausgibt). Einrichtung: [`docs/entra-setup.md`](entra-setup.md), Abschnitt 4.
- **Erster Umfang:** Entra (Conditional-Access-Richtlinien, benannte Standorte, Autorisierungsrichtlinie). Weitere Typen über `COLLECTOR_RESOURCES`.
- **Microsoft Teams:** über UTCM wie Exchange (`docs/entra-setup.md` 4.4). Vorgesehen sind die organisationsweiten Richtlinien (externer Zugriff, Gäste, Client, Besprechungen, Chat, Kanäle, Veranstaltungen, Dateien, Anrufe, Apps, Updates), nicht Typen je Person oder Team und nicht die Telefonie im Detail.
- **Intune:** über UTCM wie Exchange (`docs/entra-setup.md` 4.6). Vorgesehen sind Compliance-Richtlinien, Konfigurationsprofile, Endpunktsicherheit, App-Schutz und App-Konfiguration sowie die Registrierung (Beschränkungen, Statusseite, Autopilot), nicht Geräte, Personen, Netzwerk- und Zertifikatsprofile.
- **SharePoint und OneDrive:** UTCM kann SharePoint nicht lesen. Mit `COLLECTOR_SHAREPOINT_ENABLED` liest der Abruf zusätzlich `GET /admin/sharepoint/settings` über Microsoft Graph (Berechtigung `SharePointTenantSettings.Read.All` der Collector-App, `docs/entra-setup.md` 4.5). Quelle `graph:sharepoint`, ein Objekt „SharePoint und OneDrive“ im Bereich `tenantsettings`; zählt nicht gegen das Kontingent von UTCM. Schlägt das Lesen fehl, ist der Abruf teilweise erfolgreich und nichts gilt als entfernt.
- **Exchange Online:** über UTCM möglich, sobald der Dienstprinzipal von UTCM die Leserechte hat und die Typen in `COLLECTOR_RESOURCES` stehen (`docs/entra-setup.md` 4.3). Vorgesehen sind die organisationsweiten Einstellungen (Organisation, Transport, Schutz, Zugriff), nicht Objekte je Postfach oder Gruppe. Exchange-Objekte werden über ihre Kennung (`Identity`) adressiert. „Geändert von“ bleibt bei Exchange leer. Ein PowerShell-Container ist dafür nicht nötig.

### 7.2 Normalisierung

- Jede Quelle wird in einzelne Einstellungen zerlegt: `pfad`, `wert` (JSON), `quelle`, `workload`.
- Pfadschema: `<workload>/<bereich>/<objekt>/<eigenschaft>`. Objekte werden über ihre stabile ID adressiert, der Anzeigename wird separat gespeichert.
- Konfigurierbare Liste **ignorierter Felder** (z. B. `lastModifiedDateTime`, `whenChanged`).

### 7.3 Versionierung und Änderungserkennung

- Tabelle `setting_versions` mit `gueltig_ab` und `gueltig_bis`. Eine neue Zeile nur bei geändertem Wert.
- Art der Änderung: **neu** (Pfad unbekannt), **geändert**, **entfernt** (Pfad fehlt im vollständigen Snapshot).
- Ein Snapshot mit Fehlern in einer Quelle markiert Pfade dieser Quelle **nicht** als entfernt.
- Der **erste erfolgreiche Abruf einer Quelle** ist der Ausgangsstand: Die Einstellungen werden mit ihrer ersten Version gespeichert, aber nicht als Änderungen zur Bewertung vorgelegt.
- Eine entfernte Einstellung, die wieder auftaucht, gilt erneut als **neu**.
- Verglichen wird der JSON-Wert; die Reihenfolge der Schlüssel in Objekten spielt keine Rolle, die Reihenfolge in Listen schon.
- „Geändert von“: Abgleich mit Entra-Audit-Log bzw. Unified Audit Log im Zeitfenster, sonst „unbekannt“.

### 7.4 Bewertung von Änderungen

- Status: **offen**, **gewollt**, **ungewollt**.
- Bewertung durch `Config.Reviewer` mit Kommentarregeln (6.4). Sammelbewertung mehrerer Änderungen mit einem Kommentar.
- Rücksetzen einer Bewertung möglich (protokolliert).
- Stand der Kommentarregeln: „ungewollt“ verlangt immer einen Kommentar, „gewollt“ bei Kritikalität „Hoch“. Die Regel zu Konten außerhalb der IT ist offen; die zum BR-Beschluss entfällt (Evergreen ohne Freigabe-Ablauf).

### 7.5 Metadaten je Einstellung

| Feld | Herkunft |
|---|---|
| Beschreibung | Microsoft-Schema, KI-Vorschlag oder manuell |
| Begründung „Warum bei uns so“ | manuell |
| Kritikalität (Niedrig/Mittel/Hoch) | manuell, Vorschlag je Bereich |
| Soll-Wert | manuell (Soll-Werte, die früher aus Evergreen-Beschlüssen kamen, bleiben stehen) |
| Empfehlung/Benchmark | Microsoft Secure Score: Empfehlungen („Controls“) mit Stand im Tenant, von Reviewern von Hand den Einstellungen zugeordnet. CIS-Benchmarks werden wegen der Lizenz nicht mitgeliefert |
| Verantwortlich | Person oder Abteilung |
| Link Microsoft Learn | je Bereich hinterlegt |

Alle Metadaten haben einen eigenen Verlauf (je geändertem Feld ein Eintrag mit Person und Zeitpunkt). Pflege durch `Config.Reviewer`. Der Link muss mit `https://` beginnen. Stand: Beschreibung, Begründung, Kritikalität, Soll-Wert (manuell), Verantwortlich und Link sind umgesetzt; KI-Texte je Art von Einstellung sind umgesetzt (6.9), Empfehlungen aus Microsoft Secure Score ebenfalls (Seite „Empfehlungen“, `SECURE_SCORE_ENABLED`, tägliche Abfrage; Microsoft liefert keinen Bezug zu einzelnen Einstellungen, deshalb die Zuordnung von Hand).

### 7.6 Soll/Ist

- Weicht der Ist-Wert vom Soll-Wert ab, wird die Einstellung markiert (Detail, Liste mit Filter, Zähler in der Übersicht) und eine Aufgabe erzeugt (Aufgabe auf der Startseite für `Config.Reviewer`).
- Abweichung von einem **BR-Beschluss** löst eine sofortige Benachrichtigung aus.

### 7.7 Reports

Entfällt (entschieden im November 2026): Für die M365-Konfiguration gibt es keine Reports. Übersicht, Änderungen mit Filtern und Snapshots decken den Bedarf.

---

## 8. Modul Evergreen

Evergreen ist nur für die IT (seit 0.76; vorher Freigabe-Ablauf mit Betriebsrat und Geschäftsführung, dessen Daten beim Update gelöscht wurden). Je Software gibt es einen Unterabschnitt; zurzeit **Microsoft 365**, seit 0.144 im Bereich Microsoft 365 unter **Neuerungen › Nachrichtencenter** (`/m365/neuerungen`). Der eigene Bereich „Evergreen“ ist ausgeblendet, bis weitere Software dazukommt (`software` am Eintrag). Alte Adressen (`/evergreen`, `/evergreen/m365[/<ID>]`) leiten auf die neue Adresse um; angeheftete Seiten und zuletzt besuchte Seiten zieht die Migration `0092` mit um.

### 8.1 Quellen für Einträge

1. **Nachrichtencenter** (Graph `admin/serviceAnnouncement/messages`): Der Worker liest alle 6 Stunden (`MESSAGE_CENTER_INTERVAL_HOURS`) die seit dem letzten Abruf geänderten Meldungen, beim ersten Mal die der letzten 30 Tage. Aktiv, sobald der Collector eingerichtet ist; die Collector-App braucht `ServiceMessage.Read.All`. **Jede** Meldung wird ein Eintrag mit Status „neu“. Übernommen werden Titel, Dienste, Kategorie, Kennzeichen (`tags`, z. B. „User impact“, „Admin impact“, „New feature“, „Feature update“, „Retirement“), „Major Change“, „Action required by“, Veröffentlichung, letzte Änderung und der Text ohne HTML. Ändert Microsoft eine Meldung, werden die Angaben überschrieben und im Verlauf vermerkt („Meldung aktualisiert“); der Status bleibt.
   - **Abschnitte:** Beim Einlesen wird der Text an den Überschriften der Meldung zerlegt (z. B. „What and why“, „When this will happen:“, „How this affects your organization:“, „What you need to do to prepare:“), bevor das HTML entfernt wird. Gespeichert wird die Liste der Abschnitte (Überschrift, Text). Findet die Werkbank keine bekannten Überschriften, gibt es einen einzigen Abschnitt ohne Überschrift, und die Meldung wird als Ganzes angezeigt.
   - **Zeitplan geändert:** Ändert sich bei einer Aktualisierung der Abschnitt „When this will happen“, bleibt der vorherige Text als „vorheriger Zeitplan“ mit Zeitpunkt erhalten (immer nur der letzte), und der Verlauf vermerkt „Zeitplan geändert“.
2. **Von Hand** (`Evergreen.Editor`): Titel, optional Dienst und Beschreibung.
3. **Erkannte Änderung** aus M365-Konfiguration (`Evergreen.Editor`, Seite „Änderungen“): Titel aus Objekt, Eigenschaft und Art, Text mit Pfad, Vorher, Nachher und Urheber. Höchstens ein Eintrag je Änderung.

Doppelte Einträge verhindert die Kombination aus Quelle und Kennung (z. B. `MC123456`, `aenderung:17`).

### 8.2 Status und Notizen

| Status | Bedeutung | Weiter |
|---|---|---|
| neu | angelegt, noch nicht gesichtet | erste Notiz → bearbeitet; abschließen |
| bearbeitet | mindestens eine Notiz | weitere Notizen; abschließen |
| abgeschlossen | nichts mehr zu tun | wieder öffnen → bearbeitet |

- Notizen (1 bis 4000 Zeichen) fügen Bearbeiter beliebig oft an, auch unterschiedliche Personen. An abgeschlossenen Einträgen erst nach dem Wiederöffnen.
- „Abschließen“ und „Wieder öffnen“ nehmen optional einen Text als Notiz mit.
- Verlauf (`ev_notes`): Notiz, Abgeschlossen, Wieder geöffnet, Meldung aktualisiert; mit Person (bzw. „Werkbank“) und Zeitpunkt. Audit-Log: `eintrag.angelegt`, `eintrag.notiz`, `eintrag.abgeschlossen`, `eintrag.wieder_geoeffnet`, `nachrichtencenter.abgerufen`.
- Texte (Meldung, Notizen) werden nur als Text dargestellt, nie als HTML.

### 8.3 Liste nach Kategorien und Seite des Eintrags

Seit 0.144: Liste über die volle Breite, nach Kategorien geordnet; ein Eintrag ist eine eigene Seite (vorher seit 0.83 „Liste und Ansicht“ nebeneinander).

- Nummer `EV-JJJJ-NNN`. Kopf: „Microsoft 365 · Neuerungen“, Überschrift „Nachrichtencenter“, rechts „N offen, davon M neu“.
- Filterzeile (`FilterBar`): Suche (Nummer, Titel, Kennung der Meldung, Dienste, Text), Status mit Anzahl – **Offen** (Standard: neu und bearbeitet), **Neu**, **Mit Frist** (offen und „Handeln bis“ gesetzt), **Abgeschlossen** – und unter „Kategorie“ eine einzelne Kategorie (Anzahl je Kategorie in der geladenen Liste); darunter der Schalter „Reine Info-Meldungen ausblenden“ (Standard an, `werkbank-evergreen-info` im Browser). Reine Info-Meldung: Kategorie `stayInformed` und weder „User impact“ noch „Admin impact“ in den Kennzeichen. Am Handy wie alle Filter (`design.md`): Status als Auswahl, Kategorie im Blatt.
- **Kategorien** (feste Reihenfolge, je mit Farbe der Bereichsfarben und immer mit Namen): Exchange & Outlook, Teams, SharePoint & OneDrive, Microsoft 365 Apps, Copilot & KI, Sicherheit & Identität, Geräte & Intune, Verwaltung & Allgemein. Automatisch aus den Diensten der Meldung nach festen Stichwörtern (`modules/evergreen/topics.py`, Copilot vor allem anderen, sonst der erste passende Dienst, sonst „Verwaltung & Allgemein“); berechnet beim Lesen, gespeichert wird nur eine Wahl von Hand (`ev_entries.topic`).
- Je Kategorie ein Abschnitt mit farbigem Rand links, Überschrift als Knopf zum Auf- und Zuklappen (`aria-expanded`, Zähler) und einer Zeile „N Meldungen, M neu, K mit Frist · häufigste Dienste“. Innerhalb: zuerst mit Frist (früheste zuerst), dann neu, dann die übrigen. Leere Kategorien entfallen. Die ganze Liste wird geladen; bei mehr als 500 Treffern Hinweis, die Suche einzugrenzen.
- Listeneintrag (seit 0.145 je Meldung eine eigene Karte mit Rand und Abstand auf grauem Grund): Nummer (Schrift für Werte) und Status als Text mit Punkt (blau bei Neu) in einer Zeile, Titel dunkel und halbfett (höchstens zwei Zeilen), darunter Dienst · Art und gegebenenfalls „Handeln bis TT.MM.JJJJ“ in Orange. Die ganze Karte ist ein Link (`/m365/neuerungen/<ID>`).
- **Seite des Eintrags:** oben der Pfad „Microsoft 365 › Neuerungen › Kategorie › MC…“ („Neuerungen“ führt zur Liste), dann Steckbrief, Rollout und Reiter (8.4), unten „‹ Vorherige in Kategorie“ und „Nächste in Kategorie ›“ in der Reihenfolge der Liste (mit dem gewählten Status und der Suche).
- **Kategorie ändern** (`Evergreen.Editor`, im Steckbrief unter den Badges): Chip mit Namen und „(automatisch)“, Knopf „Kategorie ändern“ öffnet die Auswahl (`FixedChoice`: „Automatisch“ und die acht Kategorien) mit „Übernehmen“. `PUT /api/evergreen/entries/{id}/topic` mit `{topic}` (oder `null` für automatisch); Verlauf „Kategorie geändert“ („Kategorie: A → B“), Audit `eintrag.kategorie`. Eine Wahl von Hand bleibt bei Aktualisierungen aus dem Nachrichtencenter.
- Aufgabe auf der Startseite und Benachrichtigung „Neue Einträge“ nur für `Evergreen.Editor`.

### 8.4 Ansicht eines Eintrags

**Steckbrief** (oberste Karte):

- Kopfzeile klein: EV-Nummer · Kennung der Meldung (MC…) · „veröffentlicht am …“, rechts das Status-Badge. Darunter der Titel (H2).
- Badges: Dienst (grau); **Art** aus den Kennzeichen – „Neue Funktion“, „Funktionsupdate“, „Änderung“ (blau), „Abkündigung“ (rot); „Betrifft Nutzer“, „Betrifft Admins“, „Größere Änderung“ und „Handlung nötig“ (orange, wenn „Handeln bis“ gesetzt ist).
- Vier Kacheln, die umbrechen: **Betroffen** (z. B. „Alle Nutzer“, „Admins“), **Standard** (nach dem Rollout an, aus oder entfällt), **Steuerbar** (ja/nein und womit), **Handeln bis** (Datum und „noch N Tage“). Eine Kachel mit Frist oder „standardmäßig eingeschaltet“ ist orange hinterlegt.

**Rollout** als Zeitstrahl:

- Monate als Spalten (vom ersten bis zum letzten Monat der Phasen, mindestens der aktuelle Monat), je Phase ein Balken (z. B. „Targeted Release“, „Allgemein verfügbar“), senkrechte Markierung „heute“. Abgeschlossene Phasen gefüllt, kommende umrandet.
- Hat sich der Zeitplan geändert (8.1), erscheint der Hinweis „Zeitplan geändert: vorher …“; liegen für den alten Plan Phasen mit Datum vor, stehen sie schraffiert mit gestricheltem Rand darüber.
- Die Grafik ist für Screenreader verborgen; dieselben Phasen mit Datum stehen zusätzlich als Liste darunter (auch ohne Grafik lesbar).
- Ohne Phasen: Hinweis „Noch kein Zeitplan eingetragen“ und der Abschnitt „When this will happen“ als Text.

**Drei Reiter** darunter (echte Tabs: `role="tablist"`, Pfeiltasten, Pos1/Ende):

1. **Unsere Bewertung** (Standard)
   - Kurzfassung (Klartext für Menschen ohne IT-Hintergrund), Was ändert sich für Mitarbeitende?, Schulung / Kommunikation (je Text, höchstens 4000 Zeichen).
   - **Mitbestimmungsrelevant?** Auswahl Ja / Nein / Noch prüfen (Radiogruppe) und Begründung. Hilfetext: „Eignet sich die Funktion zur Leistungs- oder Verhaltenskontrolle, oder verarbeitet sie neue personenbezogene Daten?“
   - **Verknüpfte Einstellung** aus der M365-Konfiguration: Pfad, aktueller Wert als Badge und Link „Einstellung und Verlauf öffnen“ (nur mit Recht auf die M365-Konfiguration; sonst nur der Pfad). Verknüpft wird von Hand über eine Auswahl mit Suche (`design.md`); höchstens eine Einstellung je Eintrag, „Verknüpfung lösen“ möglich.
   - Steckbrief-Felder (Betroffen, Standard, Steuerbar) und Rollout-Phasen (Name, Beginn, Ende als Monat, höchstens 6) werden ebenfalls hier bearbeitet.
   - **Vorschläge per KI** (seit 0.85, 6.9): Ist in der Verwaltung „Vorschläge für Evergreen“ eingeschaltet, liest der KI-Anbieter Rollout-Phasen und Steckbrief (Betroffen, Standard, Steuerbar und womit) aus dem Text der Meldung. Übergeben werden nur Titel, Dienste und die Abschnitte „When this will happen“, „How this affects your organization“ und „What you need to do to prepare“ (je höchstens 3000 Zeichen), nie Notizen, Bewertungen oder Daten aus dem Tenant. Die Antwort muss ein festes JSON-Format haben (höchstens 6 Phasen mit Name, Beginn und Ende als Monat; Standard an/aus/entfällt; Steuerbar ja/nein); alles andere verwirft die Werkbank. Die KI wird gefragt, wenn eine Meldung neu ist oder Microsoft den Zeitplan geändert hat (stündlicher Auftrag `evergreen.ki_vorschlaege`), einmalig für alle offenen Meldungen von vor 0.85 und von Hand über „KI-Vorschlag holen“ (`Evergreen.Editor`). Die Höchstzahl je Stunde aus der Verwaltung gilt für Evergreen gesamt (Auftrag und Knopf). Jede Antwort steht im Verlauf („KI-Vorschlag“ mit den gefüllten Feldern) und im Audit-Log (`eintrag.ki_vorschlag`).
   - **Vorschläge per Regeln** (ohne KI, wenn sie aus ist oder nichts liefert): Im Abschnitt mit dem Zeitplan („When this will happen“, „Rollout Schedule“, „Rollout Timeline“, „Timeline“; fehlt er, die Zeilen der Meldung, die mit einer Phase wie „Worldwide:“ oder „Targeted Release:“ beginnen und einen Monat nennen) werden Zeilen der Form „<Phase>: <Zeitangabe>“ erkannt (z. B. „Targeted Release: early January 2027“; Monatsnamen englisch, „early/mid/late“ werden ignoriert, frühere Termine in Klammern („previously …“) zählen nicht, Beginn und Ende sind der früheste und späteste Monat der Zeile, Phasen auf Deutsch benannt: Targeted Release, Allgemein verfügbar, Vorschau …). Aus den Kennzeichen folgt „Betroffen“ („Nutzer“, „Admins“, „Nutzer und Admins“).
   - Vorschläge der KI tragen das Badge „KI-Vorschlag, ungeprüft“ (violett), Vorschläge der Regeln „Vorschlag, ungeprüft“ (grau). Beide gelten als geprüft, sobald jemand die Bewertung speichert. Von Hand geprüfte Werte überschreibt kein Vorschlag; ungeprüfte Vorschläge werden ersetzt (KI vor Regeln).
   - Ändert Microsoft den Zeitplan (8.1), werden die bisherigen Phasen als „vorher“ gesichert (schraffiert im Zeitstrahl), und die neuen Phasen gelten wieder als Vorschlag.
   - „Bewertung speichern“ (Hauptaktion). „Als BR-Vorlage übernehmen“ (Nebenaktion) ist vorgesehen, aber noch nicht umgesetzt und wird nicht angezeigt (16, Punkt 16).
2. **Text von Microsoft:** der Originaltext nach Abschnitten in einklappbaren Blöcken (`<details>`, `lang="en"`), der erste offen; darüber „Zuletzt von Microsoft geändert: …“. Einträge von Hand oder aus erkannten Änderungen zeigen hier ihre Beschreibung.
3. **Notizen und Verlauf:** Verlauf, Notiz, Abschließen und Wieder öffnen wie in 8.2.

- Lesen alle mit `Evergreen.Reader` oder `Evergreen.Editor`; Bewertung, Steckbrief, Phasen und Verknüpfung ändern nur `Evergreen.Editor`, auch an abgeschlossenen Einträgen. Für Leser sind die Felder Text, nicht Formular.
- Jede gespeicherte Änderung steht im Verlauf als „Bewertung geändert“ mit den geänderten Feldern (Feldname, vorher, nachher; lange Texte gekürzt) und im Audit-Log (`eintrag.bewertet`). Eine Bewertung setzt den Status „neu“ auf „bearbeitet“ wie eine Notiz.

---

---

## 7a. Modul Tenant

Überblick über den Microsoft-365-Tenant mit Verlauf. Die Daten kommen über Microsoft Graph mit der Collector-App; der Abruf ist freiwillig (`TENANT_MONITOR_ENABLED`).

- **Zugriff:** Rolle `Tenant.Reader`. Die Seiten stehen im Bereich Microsoft 365 unter „Tenant“.
- **Datensparsamkeit:** Gespeichert werden nur Summen. Die Werkbank liest keine Namen von Personen und keine Nutzungsdaten einzelner Konten.
- **Verlauf:** Je Tag ein Eintrag (der letzte Abruf des Tages gilt). Aufbewahrung: drei Jahre, danach löscht der Abruf alte Einträge.
- **Diagramme:** Liniendiagramm, höchstens drei Reihen in fester Farbfolge; jede Reihe in einem eigenen Feld mit eigener, enger Achse um ihre Werte (mindestens vier Einheiten, nicht unter null bei positiven Werten), damit kleine Änderungen sichtbar sind; Werte eines Tages per Zeiger oder Regler, dazu immer eine Tabelle.
- **Stand:** Lizenzen (gekauft, zugewiesen, frei, Einheiten in Kulanzfrist oder gesperrt, nächster Stichtag der Abos, Testabo) und Benutzerzahlen (gesamt, Gäste, deaktiviert, mit Lizenz). Hinweise in der Liste: aufgebraucht, überbucht, Stichtag in höchstens 30 Tagen.
- **Zertifikate und Secrets:** Der Abruf (`TENANT_CREDENTIALS_ENABLED`, Berechtigung `Application.Read.All`) liest App-Registrierungen und Unternehmensanwendungen mit SAML. Gespeichert werden Anwendung, Art, Bezeichnung, Beginn und Ablauf, nie der geheime Wert. Einstufung nach Restlaufzeit: Hinweis, Warnung, dringend, abgelaufen; der Vorlauf (Standard 60, 30 und 7 Tage) steht in der Verwaltung unter „Allgemein“. Ab dem Hinweis stehen die Einträge als Aufgabe auf der Startseite (Rolle `Tenant.Reader`); die Glocke meldet sie (Art `tenant.zugangsdaten`), per Mail, Teams oder Push, sobald die Person den Weg im Konto einschaltet (6.7).
- **Dienststatus:** Der Abruf (`TENANT_HEALTH_ENABLED`, Berechtigung `ServiceHealth.Read.All`, alle 15 Minuten) liest den Zustand von Exchange Online, Microsoft Teams, SharePoint Online und Microsoft Entra sowie deren Störungen und Hinweise samt Mitteilungen von Microsoft (als Text ohne HTML). Die Seite „Dienststatus“ zeigt je Dienst eine Ampel aus den offenen Meldungen (Störung, Hinweis, in Ordnung; offen ist eine Meldung, solange Microsoft sie nicht als behoben, beendet oder Fehlalarm führt; das Schwerste oben) mit den offenen Meldungen als Grund und Sprung dorthin; den Zustand laut Microsoft nur klein dazu, offene und in den letzten 30 Tagen beendete Störungen und Hinweise sowie „Ausfälle je Dienst“ (Störungen, Stunden mit Störung und Hinweise je Jahr; Stunden als Vereinigung der Zeiträume je Dienst, Fehlalarme zählen nirgends). Diagramme: Kalender der letzten 90 Tage je Dienst im Würfel der Kachel (Wochen als Spalten, Montag oben; Tag mit Störung, Hinweis oder ohne Meldung; Tage in UTC), dazu die Liste der Meldungen des Zeitraums (Art, Dienst, Titel, Zeitraum, Dauer), Ausfalldauer je Dienst als waagerechte Balken je Jahr, Störungen pro Monat über 36 Monate, wählbar je Dienst; dazu immer Text oder Tabelle. Jede Meldung verlinkt auf dieselbe Meldung im Microsoft 365 Admin Center (Anmeldung dort nötig). Störungen und Hinweise bleiben drei Jahre. Aufgaben auf der Startseite gibt es dafür nicht; Beginn und Ende einer Störung meldet die Glocke (6.7).
- **Nutzung:** Der Abruf (`TENANT_USAGE_ENABLED`, Berechtigung `Reports.Read.All`, alle 12 Stunden) liest die Nutzungsberichte von Microsoft 365 mit Summen: `getOffice365ServicesUserCounts` für 7, 30, 90 und 180 Tage (aktive und inaktive Benutzer je Dienst) und `getOffice365ActiveUserCounts` über 180 Tage (aktive Benutzer je Dienst und Tag). Dienste: Exchange, OneDrive, SharePoint, Teams, Viva Engage. Berichte je Person liest die Werkbank nicht. Graph leitet auf einen vorab angemeldeten Download um (`reports.office.com` oder ein regionaler Host `reports…`.office.com); den ruft die Werkbank über HTTPS ohne Token ab, andere Adressen lehnt sie ab und nennt dabei nur den Host, nie den Pfad mit dem Download-Schlüssel. Die Berichte haben bei Microsoft etwa zwei Tage Verzug; die Seite nennt den Stand. Die Tageswerte bleiben drei Jahre. Die Seite „Nutzung“ zeigt je Dienst aktiv und inaktiv für den gewählten Zeitraum und den Verlauf der aktiven Benutzer je Dienst (auch als Tabelle). Aufgaben und Benachrichtigungen gibt es dafür nicht.

## 7b. Modul IT-Budget

Das Budget der IT nach Konten, je Geschäftsjahr. Alle Beträge sind brutto und werden in Cent gespeichert.

- **Zugriff:** `Budget.Reader` liest, `Budget.Editor` pflegt zusätzlich Konten, Budgetposten, Verträge, Partner und Rechnungen, `Budget.Manager` bucht außerdem Rechnungen und legt die Einstellungen fest. Eigener Bereich „IT-Budget“ in der Navigation.
- **Einstellungen:** Beginn des Geschäftsjahrs (erster Tag eines Monats, Dauer immer zwölf Monate), Bezeichnung des Geschäftsjahrs in der Oberfläche und eine Kostenstelle. Ein Geschäftsjahr wird intern nach dem Kalenderjahr benannt, in dem es beginnt, und als „2026“ oder „2026/27“ angezeigt. Dazu die Liste der Tags (siehe Tags).
- **Konten:** Kontonummer (eindeutig), Bezeichnung, Art (laufende Kosten oder Investition), Notiz. Konten werden nicht gelöscht, sondern stillgelegt; stillgelegte Konten erscheinen in der Übersicht nur, solange für sie im gewählten Jahr oder im Vorjahr etwas geplant ist.
- **Budgetposten:** Ein Budgetposten ist ein Vorhaben unter einem Konto, z. B. ein Projekt oder eine Software. Jeder Posten hat eine **feste Nummer** `BP-<Jahr>-<laufende Nummer>` (z. B. BP-2026-012): Das Jahr ist das erste Geschäftsjahr beim Anlegen, die laufende Nummer zählt je Jahr hoch; die Nummer ändert sich danach nie, auch wenn sich der Beginn ändert (Spalten `number_year`, `number_seq`, Migration `0056`; bestehende Posten wurden in der Reihenfolge ihrer Anlage nummeriert). Er wird als ein Vorgang angelegt („Posten hinzufügen“): Konto, Bezeichnung (je Konto eindeutig), Betrag je Geschäftsjahr und Laufzeit. Der Betrag wird netto oder brutto mit frei wählbarem Steuersatz eingetragen; gespeichert werden Netto, Steuersatz und Brutto (Spalten `net_cents`, `tax_rate_bp`, Migration `0072`; bestehende Posten bekamen 19 % und ein aus dem Brutto gerechnetes Netto), fürs Budget zählt das Brutto. Netto, Steuersatz und Brutto müssen auf 1 Cent zusammenpassen (einmalig in einem Geschäftsjahr, mehrere Jahre bis zu einem Geschäftsjahr oder bis auf Weiteres, ab einem Geschäftsjahr). Die erwarteten Kosten gelten in jedem Jahr der Laufzeit; sie sind der Plan. Optional ein Vertrag; ein Posten hat höchstens einen. Optional ein IT-Projekt (Kapitel 8c); ein Posten gehört höchstens zu einem, abgeschlossene Projekte sind nur wählbar, wenn der Posten schon dazugehört. Vertrag, Projekt, Tags, Notiz und Stilllegen stehen im Abschnitt „Verknüpfen“ der Maske. **Partner** (Firma) ist am Posten Pflicht beim Anlegen und Ändern; ältere Posten ohne Partner zeigen „Partner fehlt“, bis sie bearbeitet werden. Der Partner am Posten ist eine Angabe; Rechnungen haben unabhängig davon ihren eigenen Rechnungssteller. Partner zusammenlegen nimmt die Posten mit; ein Partner mit Posten lässt sich nicht löschen; die Partnerseite zeigt seine Posten.
- **Status je Geschäftsjahr:** Ein Posten ist in jedem Jahr seiner Laufzeit „offen“; sobald eine Rechnungsposition auf ihm liegt „Rechnung liegt vor“; „abgeschlossen“, sobald eine gebuchte Position mit dem Kennzeichen „schließt den Posten ab“ auf ihm liegt oder jemand mit `Budget.Editor` oder `Budget.Manager` den Posten unter „Budgetposten“ für das gewählte Geschäftsjahr abhakt („Abschließen“; gespeichert je Posten und Jahr in `budget_item_closures`, Audit `budget.posten_abgeschlossen`). „Wieder öffnen“ nimmt nur das Abhaken zurück (`budget.posten_wieder_geoeffnet`); schließt eine Rechnungsposition ab, bleibt der Posten zu, bis das Kennzeichen an der Position entfernt wird. Das Geschäftsjahr einer Position bestimmt das Rechnungsdatum. Der Status aus Rechnungen wird nicht gespeichert, sondern aus den Positionen gerechnet.
- **Mehrjahresübersicht:** Erwartete Kosten, Ist und Status aller Budgetposten über fünf Geschäftsjahre, als Ausblick (ab dem laufenden) oder Rückblick (bis zum laufenden). Eingegeben wird hier nichts; die Zahlen ergeben sich aus Laufzeit und Rechnungen.
- **Excel-Export:** Die Mehrjahresübersicht lässt sich als Excel-Datei herunterladen: ein Blatt mit erwarteten Kosten, Ist und Status je Posten und Jahr, ein Blatt mit allen Rechnungspositionen des Zeitraums. Texte stehen als Text in den Zellen, nie als Formel. Die Datei schreibt die Werkbank ohne Zusatzpaket.
- **Tags:** Die Tags stehen in einer Liste, die nur `Budget.Manager` unter Einstellungen pflegt: anlegen, umbenennen, löschen (je höchstens 30 Zeichen, ohne Komma, eindeutig ohne Rücksicht auf Groß- und Kleinschreibung). Ein Budgetposten wählt bis zu zehn Tags aus dieser Liste; andere nimmt der Server nicht an. Umbenennen ändert den Tag auch an allen Posten und gespeicherten Statistiken, Löschen entfernt ihn dort; eine Statistik ohne verbleibenden Tag wird gelöscht. Bei der Einführung kamen alle bis dahin vergebenen Tags in die Liste. Die Seite Budgetposten filtert nach Status (auch „Ohne Partner“), Tag, IT-Projekt und Suchtext (Nummer, Name, Konto, Partner, Tag), sortiert nach jeder Spalte und gruppiert nach Konto, Partner oder gar nicht. Die Suche über alle Module findet Budgetposten über Nummer, Name, Notiz und Tag (nur mit einer Rolle des Budgets) und öffnet den Posten.
- **Statistik** (`/budget/statistik`): Oben das Geschäftsjahr (Vorgabe: das laufende; Auswahl von zehn Jahren zurück bis fünf voraus) und ein früheres Jahr zum Vergleich (Vorgabe: das Vorjahr, „keinem Jahr“ möglich). Alle Beträge brutto; Plan sind die erwarteten Kosten der Posten (je Jahr, ohne Monat), Ist sind gebuchte Rechnungspositionen nach Rechnungsdatum. Drei Reiter:
  - **Überblick** (`GET /api/budget/statistics/summary?year=&compare=`): Geplant, Ist, Verfügbar, Ausschöpfung (nach angefangenen Monaten), Veränderung zum Vergleichsjahr im selben Zeitraum (im laufenden Jahr bis zum selben Tag, sonst ganzes Jahr). Verlauf: Ist aufsummiert je Monat, das Vergleichsjahr und die erwarteten Kosten als waagerechte Linie (keine Monatsverteilung des Plans); Monate antippbar, Tabellenansicht. Ausgaben je Monat, die vier Konten mit der höchsten Ausschöpfung und eine Kachel Verträge (Jahreskosten laufender Verträge, Zahl mit Kündigungstermin in 90 Tagen, die nächsten drei Kündigungstermine).
  - **Konten und Partner** (`GET /api/budget/statistics/compare?year=`): Jahresvergleich je Konto oder je Art (laufend/Investition) für das gewählte Jahr und bis zu vier davor (Mehrfachauswahl, das gewählte ist immer dabei; Farbe nach Abstand zum gewählten Jahr aus der Diagrammpalette). Im laufenden Jahr „Bis heute“ (je Jahr Ist bis zum selben Tag) oder „Ganzes Jahr“ (laufende und künftige Jahre mit den erwarteten Kosten, gestrichelt; frühere mit dem Ist). Darstellung als knapp überlappende Säulen, überlappende Balken oder Balken nebeneinander; gewählte Gruppe mit allen Beträgen und Verlauf über fünf Jahre; Tabellenansicht. Darunter Plan und Ist je Konto mit Markierung des Jahresfortschritts und die größten Rechnungssteller (fünf, Rest „Weitere“).
  - **Nach Tags** (`POST /api/budget/statistics/query`, `start` = gewähltes Jahr − 4): je gewähltem Tag eine Gruppe (`per_tag`) mit denselben Jahren, Zeitraum und Darstellungen wie im Jahresvergleich; müssen alle Tags am Posten stehen, eine gemeinsame Gruppe. Dazu die passenden Posten. Vorgabe: einer der Tags reicht. Eine Auswahl lässt sich unter einem Namen speichern; gespeicherte Statistiken sehen alle Rollen des Budgets, anlegen und löschen dürfen Budget.Editor und Budget.Manager. Einen Ausblick gibt es über ein künftiges Jahr oben.
- **Audit:** Jede Änderung an Einstellungen, Konten, Budgetposten (mit erwarteten Kosten und Laufzeit vorher und nachher), Verträgen, Partnern, Rechnungen und gespeicherten Statistiken steht im Audit-Log (Modul `budget`).
- **Partner:** Firmen als Vertragspartner, Rechnungssteller oder beides, mit eigener Kundennummer. Keine Personen. Partner werden stillgelegt, nicht gelöscht.
- **Verträge:** Bezeichnung, Vertragspartner, abweichender Rechnungssteller, keiner, einer oder mehrere zugeordnete Budgetposten (ein Posten gehört höchstens zu einem Vertrag; die Zuordnung lässt sich am Vertrag und am Posten pflegen, ein Posten mit anderem Vertrag steht am Vertrag nicht zur Wahl, ein Hinweis nennt die Zahl), Betrag je Zahlung netto oder brutto mit Steuersatz (aus dem Netto rechnet der Server das Brutto, aus einem eingetragenen Brutto das Netto, kaufmännisch gerundet; fürs Budget zählt das Brutto), Turnus (monatlich, vierteljährlich, halbjährlich, jährlich, einmalig), Beginn, Ende der Laufzeit, Verlängerung, Kündigungsfrist, Kündigungstag und Stand des Auftragsverarbeitungsvertrags (AVV). Die Zuordnung zeigt nur, zu welchen Posten der Vertrag gehört; die Kosten des Vertrags gehen allein über die Rechnungspositionen ins Budget, nichts wird aufgeteilt oder gebunden. **Soll und Ist je Geschäftsjahr** (Auswahl oben, Vorgabe das laufende): Soll = Summe der Zahlungen, die im Geschäftsjahr fällig werden (erste am Vertragsbeginn, dann im Abstand des Turnus; nach einer Kündigung nur bis zum Kündigungstag, danach nichts mehr). Ist = gebuchte Rechnungspositionen der zugeordneten Posten, die im Geschäftsjahr abgeschlossen sind; bei monatlichen Verträgen mit einem Posten je Monat wächst das Ist mit jedem abgeschlossenen Monat. Die Liste zeigt den Betrag je Zahlung mit Turnus, bei monatlichen, vierteljährlichen und halbjährlichen Verträgen dazu die Summe eines vollen Jahres, Soll und Ist sowie wie viele der zugeordneten Posten abgeschlossen sind. **Monatsposten:** Bei einem laufenden monatlichen Vertrag schlägt die Ansicht vor, für das gewählte Geschäftsjahr je fälliger Zahlung einen Budgetposten anzulegen (Konto wählbar, Vorgabe das Konto der schon zugeordneten Posten). Jeder Posten heißt „<Vertrag> <Monat> <Jahr>“, hat Partner und Bruttobetrag des Vertrags, läuft nur in diesem Geschäftsjahr und wird dem Vertrag zugeordnet; Monate, für die es im Konto schon einen Posten mit diesem Namen gibt, werden übersprungen (`POST /api/budget/contracts/{id}/monthly-items`, `Budget.Editor` und `Budget.Manager`, Audit `budget.monatsposten_angelegt`).
- **Zahlungen im Geschäftsjahr:** Summe der Zahlungen eines Vertrags, die im Geschäftsjahr fällig werden, nur zur Information an Vertrag und Vertragsliste. Die erste Zahlung zählt zum Beginn, die weiteren im Turnus. Ein Vertrag mit Verlängerung läuft weiter, bis er gekündigt ist.
- **Kündigungstermin:** Ende der Laufzeit abzüglich der Kündigungsfrist; ist er für die laufende Laufzeit verstrichen, gilt der Termin der nächsten. Die Übersicht listet Termine der nächsten 120 Tage; ab 60 Tagen vorher steht der Vertrag als Aufgabe auf der Startseite (für `Budget.Editor` und `Budget.Manager`).
- **Rechnungen:** Eine Rechnung hat einen Kopf (Rechnungssteller, Rechnungsnummer, interne Nummer, Rechnungsdatum) und eine bis 50 Positionen. Jede Position gehört zu genau einem Budgetposten und hat Netto, Steuersatz, Brutto, Bezeichnung und die Kennzeichen „Projekt“ und „jährlich“. So lässt sich eine Rechnung auf mehrere Budgetposten verteilen und kann mehrere Steuersätze enthalten. Die Maske nimmt den Betrag netto oder brutto mit frei wählbarem Steuersatz; den anderen Wert rechnet die Werkbank. Das Brutto je Position rechnet der Server aus Netto und Steuersatz; ein von Hand eingetragenes Brutto darf höchstens 1 Euro abweichen. Die Rechnung trägt die Summen ihrer Positionen. Wird der Rechnungsbetrag laut Beleg angegeben, muss er der Summe der Positionen entsprechen. Das Rechnungsdatum entscheidet über das Geschäftsjahr; das Ist zählt je Position beim Budgetposten der Position. Jede Position hat zusätzlich das Kennzeichen „schließt den Posten ab“; ohne Angabe ist es gesetzt, außer der Budgetposten hat einen Vertrag (laufende Zahlungen). Einen eigenen Vertrag hat die Position nicht; angezeigt wird der Vertrag ihres Budgetpostens. In der Maske wählt man zuerst den Rechnungssteller; jede Position wählt ihren Budgetposten aus einer Liste, in der die Posten dieses Partners oben stehen und die übrigen nach Status im Geschäftsjahr des Rechnungsdatums gruppiert sind. Ein Suchfeld grenzt die Liste ein.
- **Prüfung:** `Budget.Editor` erfasst mit dem Stand „zu prüfen“. `Budget.Manager` prüft und bucht; erfasst er selbst, ist die Rechnung sofort gebucht. Nur gebuchte Rechnungen zählen zum Ist. Gebuchte Rechnungen ändert und löscht nur der Budgetverwalter. Offene Rechnungen stehen ihm als Aufgabe auf der Startseite.
- **Links und Verknüpfungen:** Budgetposten, Rechnungen und Verträge haben eigene Adressen (`/budget/posten/{id}`, `/budget/rechnungen/{id}`, `/budget/vertraege/{id}`; bei Posten und Rechnungen mit `?jahr=` für das Geschäftsjahr). Die Ansicht folgt der Adresse; oben steht sie mit „Link kopieren“ (volle Adresse in die Zwischenablage). Der Block „Verknüpft“ springt vom Posten zu Vertrag und Rechnungen, von der Rechnung zu den Budgetposten der Positionen und deren Verträgen, vom Vertrag zu den Posten und deren Rechnungen; jeder Eintrag hat ein Symbol zum Kopieren seines Links und, bei Rechnungen mit Beleg, das PDF-Symbol. Dafür liefern Budgetposten und die Posten eines Vertrags ihre Rechnungen mit (`invoices`: Nummer, Datum, Geschäftsjahr, Status, Beleg ja/nein; neueste zuerst, höchstens 20). Wer einen Link öffnet, braucht eine Budget-Rolle.
- **Beleg:** An jede Rechnung lässt sich ein PDF hängen (höchstens 15 MB, geprüft wird der Dateianfang, nicht die Endung). Die Datei liegt außerhalb der Datenbank in einem eigenen Volume unter einem zufälligen Namen; der Dateiname zur Anzeige steht in der Datenbank. Herunterladen dürfen alle mit Budget-Rolle, immer als Download. Ein PDF-Symbol öffnet den Beleg direkt: in den Zeilen der Budgetposten und Rechnungen, an den Positionen einer Rechnung und unter „Verknüpft“. Der Status eines Budgetpostens hängt nur daran, ob eine Rechnung angelegt ist, nicht am Beleg. Hochladen, ersetzen und entfernen darf, wer die Rechnung ändern darf. Mit der Rechnung wird auch der Beleg gelöscht. Einen Virenscan gibt es nicht.
- **Ist und Prognose:** Ist = Summe der gebuchten Rechnungspositionen (brutto) im Geschäftsjahr. Prognose = bei einem abgeschlossenen Posten das Ist, sonst das Höhere aus erwarteten Kosten und Ist. Abweichung = Prognose minus erwartete Kosten. Ein Budget je Konto gibt es nicht; das Konto zeigt die Summen seiner Posten.
- **Partner im Detail:** Verträge der Firma (als Vertragspartner oder Rechnungssteller), die Budgetposten, denen diese Verträge zugeordnet sind oder auf denen ihre Rechnungspositionen liegen, und ihre Rechnungen aus allen Jahren. `Budget.Manager` kann einen Partner mit einem anderen zusammenlegen: Verträge und Rechnungen wandern zum Ziel, der Quellpartner wird gelöscht (nicht umkehrbar, steht im Audit-Log).
- **Löschen:** Verträge, Budgetposten, Rechnungen und Partner lassen sich nach Bestätigung löschen (`Budget.Editor`, `Budget.Manager`; gebuchte Rechnungen nur `Budget.Manager`). Ein Vertrag jederzeit, seine Budgetposten bleiben dann ohne Vertrag; ein Partner nur ohne Verträge und Rechnungen; ein Budgetposten nur, solange ihm kein Vertrag zugeordnet ist und keine Rechnungsposition auf ihm liegt. Mit einem Vertrag wird auch seine Zuordnung zu Posten gelöscht. Konten werden weiter nur stillgelegt. Jedes Löschen steht im Audit-Log.
- **Oberfläche:** Alle Seiten haben denselben Kopf mit Kostenstelle und laufendem Geschäftsjahr. Das auf einer Seite gewählte Geschäftsjahr gilt für die anderen mit, bis die Werkbank neu lädt. Formulare öffnen sich über den Knopf „… anlegen“ oder „Bearbeiten“ oberhalb der Tabelle. Wer nur lesen darf, sieht einen Hinweis.
- **Stand:** Einstellungen, Konten, Budgetposten mit Status, Partner, Verträge, Rechnungen mit Positionen, Übersicht, Mehrjahresübersicht mit Excel-Export, Tags, Statistik und der Import aus Excel sind umgesetzt.
- **Import aus Excel** (`/budget/import`, nur `Budget.Manager`): Je Datei ein Vorgang, je Zeile eine Entscheidung. Hochladen (.xlsx bis 10 MB, eigenes Lesen ohne Zusatzpaket: erstes sichtbares Blatt, Archiv- und Größengrenzen, XML mit DOCTYPE oder ENTITY wird abgelehnt; die Datei wird nicht gespeichert) legt einen Entwurf an. Erkannt werden: Geschäftsjahr aus der Überschrift („… 2026 / 2027“), Kopfzeile mit Rech.Nr. (interne Nummer), Firma, Kosten (brutto), Datum, RE (Rechnungsnummer), Bezeichnung, die Kontospalten (Kontonummer in der Zeile darüber; das Konto einer Zeile ist die Spalte, in der ihr Betrag steht) und „Jährlich“; darunter je Konto Nummer, Budget und Bezeichnung. Die erste Spalte (Kostenstelle) und „Projekte“ werden nicht übernommen. Beim Start wählt man Geschäftsjahr und die Art neuer Konten; fehlende Konten werden angelegt; das Budget je Konto aus der Datei wird nicht als Posten übernommen. Jede Zeile wird geprüft (Partner: gleicher Name, ähnlicher Name ohne Rechtsform, schon für die Firma entschieden oder neu; Bezeichnung, Konto, Betrag, Jährlich) und übernommen oder übersprungen (wieder zu öffnen). Übernehmen legt je Zeile einen eigenen Budgetposten mit dem gewählten Partner an (Name aus der Bezeichnung, sonst der Partner; im Konto schon vorhanden: mit Nummer, z. B. „Mobilfunk (2)“; erwartete Kosten = Betrag, nur im Geschäftsjahr des Imports; Rechnungsnummer, interne Nummer und Datum aus der Datei in der Notiz). **Eine Rechnung legt der Import nicht an.** Hinweise: Datum außerhalb des Geschäftsjahrs, kein oder mehrere Konten, keine Firma. Übernommene Zeilen mit „Jährlich“ lassen sich in die Planung übernehmen: Ihr Posten läuft im folgenden Geschäftsjahr weiter (bis auf Weiteres oder nur dieses Jahr), mit den eingetragenen erwarteten Kosten je Jahr; es entsteht kein zweiter Posten. Offene oder übersprungene Zeilen lassen sich einzeln löschen; übernommene bleiben. **Import abbrechen** löscht alle offenen und übersprungenen Zeilen; der Vorgang bleibt mit den übernommenen Zeilen als „abgebrochen“ in der Liste und ist keine Aufgabe mehr (weitere Übernahmen gehen dann nicht). Offene Vorgänge stehen als Aufgabe auf der Startseite. Löschen eines Vorgangs lässt Konten, Partner und Posten stehen. Alles im Audit-Log (`budget.import_…`).

## 7c. Modul Gerätezuordnung

Neue Windows-Geräte per QR-Code aus der Einrichtung (Windows Autopilot Device Preparation, „Scan QR code“) dem Tenant zuordnen und bis zur Registrierung in Intune verfolgen. Vorlage: AutopilotQR (MIT, Hinweis in `THIRD_PARTY_NOTICES.md`).

- **Ort und Zugriff:** Bereich Microsoft 365, Gruppe „Geräte“, Seite „Gerätezuordnung“ (`/m365/geraete/zuordnung`). Rolle `Geraete.Zuordnung` für alles in diesem Modul, geprüft auf dem Server.
- **Zwei Konten:** Angemeldet ist die Person mit ihrem Office-Konto. Die Zuordnung bei Microsoft läuft mit einem **Admin-Konto** mit Intune-Rechten. Dafür gibt es eine zweite Anmeldung über den Server (Autorisierungscode mit PKCE, `prompt=select_account`, Rückweg `/auth/geraete/callback`) mit der bestehenden Werkbank-App und den delegierten Berechtigungen `DeviceManagementServiceConfig.ReadWrite.All`, `DeviceManagementConfiguration.Read.All`, `DeviceManagementManagedDevices.Read.All`, `User.Read`. Der Server prüft, dass das Konto aus dem eigenen Tenant kommt und die Anmeldung zur Sitzung gehört. Gespeichert wird nur das Zugriffstoken, verschlüsselt und an die Sitzung gebunden (Tabelle `dev_admin_sessions`, gelöscht mit der Sitzung, bei „Trennen“ und spätestens nach 60 Minuten; kein Aktualisierungstoken, kein MSAL im Browser). Es gibt keine Anwendungsberechtigung mit Schreibrecht.
- **Scanner:** Kamera (Rückkamera, `getUserMedia`) mit laufender Erkennung, dazu „Foto auswählen“ als Ausweg. Erkennung mit `zxing-wasm` (nur Leseteil); die WASM-Datei liegt unter `/assets/` der Werkbank, kein CDN. Dafür erlaubt die CSP `'wasm-unsafe-eval'` und `Permissions-Policy` die Kamera für die eigene Herkunft (`camera=(self)`). Fremde QR-Codes übergeht der Scanner still. Der Server prüft den Code erneut (Länge höchstens 4096 Zeichen, entpackt höchstens 16 KB, Pflichtfelder) und baut daraus die Gerätedaten (deviceLink) in der Form, die Microsoft erwartet.
- **Ablauf a – sofort:** Scannen › Prüfen (Hersteller, Modell, Seriennummer, Zeitpunkt des QR-Codes, Ziel-Tenant, Duplikat, Richtlinie) › Freigeben. Freigeben geht erst, wenn die Person den Ziel-Tenant bestätigt.
- **Ablauf b – später:** „Zur Freigabe senden“ legt den Eintrag mit Status „Wartet auf Freigabe“ an. Die Gerätedaten liegen verschlüsselt in der Datenbank, höchstens 24 Stunden. Freigeben kann dieselbe oder eine andere Person mit Rolle und verbundenem Admin-Konto, „Verwerfen“ löscht den Eintrag samt Gerätedaten. Pro Seriennummer wartet höchstens ein Eintrag.
- **Gerätedaten:** Nach dem Import, beim Verwerfen und nach 24 Stunden gelöscht (Auftrag `geraete.status`). Sie stehen nie im Log, im Audit, in Antworten an den Browser oder im Cache des Service Workers.
- **Microsoft Graph (beta, alles in `modules/devices/graph.py`):**
  - Richtlinien: `deviceManagement/configurationPolicies` mit der Vorlage `70d256b3-6120-4f88-9e00-0972ec64fc83_1` (Device Preparation). Der Name kommt von Microsoft, nicht aus dem Browser.
  - Duplikat: `deviceManagement/tenantAssociatedDevices` mit `contains(serialNumber, …)`, danach genauer Vergleich. Gibt es die Seriennummer schon, ist der Import gesperrt.
  - Import: `tenantAssociatedDevices/importTenantAssociatedDevice`, danach Bestätigung: alle 3 Sekunden bis 30 Sekunden nachsehen, bis der Eintrag „vorab zugeordnet“ ist.
  - Status: `tenantAssociatedDevices/{id}` und `managedDevices` (v1.0). Hat der Eintrag eine Kennung des verwalteten Geräts, gilt sie; sonst der Abgleich über die Seriennummer (neuestes Gerät, registriert frühestens 10 Minuten vor der Freigabe).
- **Fehler:** 429 mit `Retry-After`, höchstens 3 neue Versuche. 5xx ohne neuen Versuch, mit den Voraussetzungen am Gerät (physisches Gerät; Windows 11 24H2/25H2 mit KB5120998 oder neuer; TPM 2.0, nicht im Modus mit eingeschränkter Funktion; Secure Boot). 400: „Bitte neu scannen“. 401/403: „Keine Berechtigung“ (Intune-Rolle fehlt). Die Request-ID von Microsoft steht immer dabei und lässt sich kopieren.
- **Status:** Wartet auf Freigabe › Vorab zugeordnet (Import bestätigt) › Zugeordnet (am Gerät wurde „Weiter“ geklickt) › In Intune registriert. Ohne Fortschritt nach 7 Tagen: „Nicht abgeschlossen“; dann prüft die Werkbank nicht mehr von selbst, „Status aktualisieren“ geht weiter.
- **Prüfung im Hintergrund:** Auftrag `geraete.status` alle 5 Minuten, nur lesend mit der Collector-App (Anwendungsberechtigungen `DeviceManagementServiceConfig.Read.All`, `DeviceManagementManagedDevices.Read.All`), eingeschaltet mit `DEVICES_MONITOR_ENABLED=true`. Ohne sie prüft „Alle aktualisieren“ mit dem verbundenen Admin-Konto. Ob der App-Zugriff auf `tenantAssociatedDevices` (beta, nicht dokumentiert) geht, ist im eigenen Tenant zu prüfen.
- **Oberfläche:** Kopf mit „Alle aktualisieren“ und „QR-Code scannen“, Karte zum Admin-Konto, Hinweis auf wartende Geräte, vier Zähler, Ansichten (Alle, Wartet auf Freigabe, Offen, Abgeschlossen, Nicht abgeschlossen) und Suche, Tabelle am Computer, Karten am Handy. Seitenleiste je Gerät mit Verlauf in vier Schritten, Gerätedaten, Request-ID, Daten aus Intune und Aktionen. Scan-Dialog in drei Schritten, am Handy bildschirmfüllend.
- **Aufgaben und Benachrichtigungen:** Aufgabe „Geräte warten auf Freigabe“ für die Rolle. Die Glocke meldet „Zugeordnet“ und „In Intune registriert“ an die Person, die gescannt oder freigegeben hat (Arten `geraete.zugeordnet`, `geraete.registriert`), auf Wunsch per Push, ohne Gerätedaten im Text.
- **Audit je Gerät:** gescannt, zur Freigabe gesendet, freigegeben (mit Admin-Konto, Richtlinie, Ergebnis), Freigabe fehlgeschlagen (Status, Request-ID), Import gesperrt (Duplikat), verworfen, verfallen; Admin-Konto verbunden, abgelehnt, getrennt.
- **Offen (Test mit echter Hardware):** wie lange die Gerätedaten aus dem QR-Code gültig sind (dokumentiert ist es nicht; die Werkbank begrenzt auf 24 Stunden), und ob die Collector-App `tenantAssociatedDevices` lesen darf. Für den Bericht zur Bereitstellung (Device Preparation) gibt es keine Graph-Schnittstelle; er steht nur im Intune Admin Center.

## 8a. Bereich IT-Tools

Kleine Werkzeuge für den Alltag in der IT (Rechner, Generatoren, Konverter), übernommen aus einer eigenständigen Toolbox.

- **Alles im Browser:** Die Tools rechnen im Browser. Eingaben verlassen den Rechner nicht, mit einer Ausnahme: den Abfragen ins Internet (siehe unten).
- **Abfragen ins Internet:** DNS Lookup, DNS-/Mail-Check, RDAP und „Passwort prüfen“ brauchen fremde Dienste. Weil die Sicherheitsrichtlinie dem Browser nur die Werkbank erlaubt, fragt der Server (`/api/tools/net/…`, Rolle `Tools.User`): DNS über HTTPS (RFC 8484) bei Cloudflare, Google oder Quad9 (fest, keine eigenen Resolver; bis 20 Abfragen je Anfrage), RDAP über das Verzeichnis der IANA bei der zuständigen Registry (höchstens drei Weiterleitungen), Have I Been Pwned nur mit den ersten fünf Zeichen des SHA-1-Hashs und Auffüllung, crt.sh für die Subdomain-Suche. Regeln: nur https auf Port 443, nur Ziele mit ausschließlich öffentlichen Adressen, Zeitlimit und Höchstgröße je Antwort, eigenes Limit von 300 Anfragen je Minute und Absender. Ausgewertet wird im Browser. Angefragte Namen werden nicht gespeichert und nicht protokolliert. Ein Werkbank-Admin kann die Abfragen unter Verwaltung › Allgemein ausschalten (Vorgabe: an; Änderung steht im Audit-Log); dann antwortet der Server mit 403 und die Tools zeigen einen Hinweis.
- **Zugriff:** Rolle `Tools.User`. Die Tools haben keine Daten auf dem Server; die Rolle steuert die Sichtbarkeit des Bereichs und erlaubt die Abfragen ins Internet über den Server.
- **Aufbau:** Jedes Tool liegt in `frontend/src/tools/<ordner>/` (Rechenlogik mit Tests, Oberfläche) und ist in `frontend/src/tools/index.ts` eingetragen. Die Oberfläche eines Tools wird erst beim Öffnen geladen.
- **Teilbare Links:** Einstellungen eines Tools stehen in der Adresszeile (`/it-tools/<id>?…`). Dort stehen nie Geheimnisse: keine Kennwörter, Schlüssel oder eingegebenen Texte. Kurze, harmlose Eingaben dürfen dort stehen (z. B. eine Zahl, ein Zeitstempel, ein regulärer Ausdruck).
- **Je Konto** (`tool_prefs`, `tool_history`, nur die eigene Person, Rolle `Tools.User`): **Favoriten** (bisherige Favoriten aus dem Browser wandern beim ersten Laden mit; der Browser hält eine Kopie für den Fall ohne Server), **zuletzt genutzt** (die letzten sechs geöffneten Tools, oben in der Übersicht) und **Verlauf**: Ändern sich die Einstellungen eines Tools (das, was `useToolParams` in die Adresszeile schreibt) und bleiben 2 Sekunden gleich, speichert der Server sie mit kurzer Zusammenfassung; gleiche Einstellungen wie zuletzt nur aufgefrischt; höchstens 200 Einträge und 90 Tage je Person. Wieder öffnen über die Adresse mit den Einstellungen. Auf der Seite eines Tools „Zuletzt verwendete Einstellungen“ (fünf), Seite „Verlauf“ (`/it-tools/verlauf`) nach Tagen, Löschen je Eintrag oder alles, Schalter „Verlauf speichern“ (Vorgabe an). Kennwörter, Schlüssel und eingegebene Texte stehen nie in der Adresszeile und damit nie im Verlauf.
- **Stand:** Subnetz-Rechner, Subnetting-Bits, Netze zusammenfassen, Firewall-Regeln prüfen, MAC-Adressen (Herstellerliste der IEEE eingebaut), Port-Nachschlagewerk, chmod-Rechner, Base64, URL-Encoder, HTML-Entities, JWT-Decoder, SAML-Decoder, JSON-, YAML- und XML-Formatter, SQL (Formatter und JOINs), CSV ↔ JSON, JSON ↔ YAML ↔ TOML, Zahlensysteme, Unix-Zeitstempel, Zeitzonen-Umrechner, Schreibweise ändern, Listen bereinigen, Regex-Tester, Zeichen zählen, Text-Diff, Cron-Ausdruck erklären, die Rechner (RAID, Speichereinheiten, Speicherbedarf, Übertragungsdauer, Verfügbarkeit, Stromkosten, USV, VoIP-Bandbreite), die Tools für AD und M365 (AD-Zeitstempel, DN-Zerleger, ImmutableID ↔ objectGUID, LDAP-Escaper, userAccountControl, E-Mail-Header und Rückläufer mit .eml und .msg), die Planungs-Tools (Amortisation, Backup-Planer, Netzplan mit kritischem Pfad, Nutzwertanalyse), Bild-Konverter (auch Bilder zu einer PDF und PDF-Seiten als Bilder; PDFs zeichnet pdf.js im Browser, Bibliothek, Worker, Schriften und Dekoder liefert die Werkbank selbst unter `/assets/` und `/pdfjs/` aus, kein CDN), die Zertifikats-Tools (Zertifikate anzeigen und umwandeln mit PEM, DER, P7B, PFX und .p15 für APC-Netzwerkkarten; CSR erstellen), die Abfrage-Tools (DNS Lookup mit Subdomain-Suche, DNS-/Mail-Check, RDAP, Passwort prüfen) und die Generatoren (UUID, Passwort, Passphrase, Passwort-Hash, Prüfsummen, HMAC, QR-Code, Lorem ipsum).
- **Was nie im Link steht:** Kennwörter, eingegebene Texte, Listen von Netzen, Regelwerke, MAC-Adressen, E-Mail-Header, die Tabellen von Netzplan und Nutzwertanalyse, die Inhalte von QR-Codes, Bilder, Zertifikate, Schlüssel und die Angaben eines CSR (Namen und SANs), abgefragte Domains, Namen und Adressen. Ein Verweis aus einem anderen Tool darf eine Domain mitgeben; das Tool übernimmt sie und nimmt sie sofort aus der Adresszeile. Der OpenSSL-Befehl im CSR-Tool setzt die Namen in einfache Anführungszeichen.
- **HTML-Editor** (`/it-tools/html-editor`): Die Vorschau ist eine eigene Seite `GET /api/tools/html-vorschau` (Rolle `Tools.User`) im iframe (`sandbox="allow-scripts"`). Sie hat eine eigene Richtlinie: `sandbox allow-scripts` ohne `allow-same-origin` (undurchsichtiger Ursprung, kein Zugriff auf Cookies und Werkbank), nur ihr eigenes Skript (Hash), CSS inline erlaubt, Bilder `data:` und mit „Abfragen ins Internet“ auch `https:` direkt aus dem Browser, `form-action 'none'`, `base-uri 'none'`. Das HTML kommt über einen eigenen Nachrichtenkanal (`MessageChannel`, den die Seite dem Elternfenster gibt) aus dem Browser, nie per `postMessage` an `*`; das Skript entfernt Skripte, Meta-Weiterleitungen, `base` und eingebettete Rahmen. Der Inhalt geht nie an den Server. Leeren und Vorlage laden mit Bestätigung.
- **Dateien aus den Tools:** Downloads entstehen im Browser über eine kurzlebige `blob:`-Adresse. Vorschaubilder werden als `data:`-Adresse angezeigt, weil die Sicherheitsrichtlinie (`img-src 'self' data:`) keine `blob:`-Bilder erlaubt. Texte, die aus einem Link in einen Befehl zum Kopieren gelangen (Port-Nachschlagewerk), werden auf harmlose Zeichen beschränkt.

## 8b. Bereich IT-Monitoring

Regelmäßige Prüfungen und Überwachung der IT aus mehreren **Quellen**. Zugriff: `Monitoring.Reader` für alles, `Monitoring.Berichte` nur für die Berichte (serverseitig geprüft). `Werkbank.Admin` allein sieht das Monitoring nicht (entschieden, 0.123.1); Admins richten die Anbindungen in der Verwaltung ein. „Jetzt prüfen“ beim DNS-Abgleich nur mit `Werkbank.Admin` und `Monitoring.Reader`.

### Aufbau: Quellen als Module

- Jede Quelle ist ein eigenes Modul unter `backend/werkbank/modules/monitoring/<quelle>/` bzw. `frontend/src/modules/monitoring/<quelle>/` mit eigenen Tabellen (`mon_<quelle>_…`), eigenem Collector, eigenen Seiten und einer Gruppe im Seitenmenü. Quellen sind zurzeit **Zabbix** und **NetBox** (DNS-Abgleich); weitere kommen ebenso dazu.
- Jede Quelle meldet sich mit einer schmalen **Zusammenfassung** für die Startseite an (Schnittstelle `MonitoringSource` im Backend): Name, eingerichtet ja/nein, Zustand (in Ordnung, Warnung, Fehler, unbekannt), Stand der Daten, zwei bis vier Kennzahlen, wichtigste Probleme (höchstens 20, mit Schweregrad, Standort und Link) und Einträge für „Zu erledigen“. Die Startseite kennt keine Einzelheiten einer Quelle.
- Seitenmenü: **Start** oben; darunter je Quelle eine Gruppe: **Zabbix** (Übersicht, Hosts, Wartungen, Berichte, Verbindung) und **NetBox** (DNS-Abgleich). Wer nur `Monitoring.Berichte` hat, sieht nur die Berichte.

### Monitoring-Start (`/monitoring`)

Klick auf „Monitoring“ in der Bereichsleiste.

- Kennzahlen über alle Quellen: offene Probleme (davon Katastrophe und Hoch), nicht erreichbare Hosts, Abweichungen im DNS, Quellen mit Fehler.
- Je Quelle eine Karte mit Zustand, Stand der Daten und Kennzahlen:
  - **Zabbix:** Zustand der Verbindung, Probleme nach Schweregrad, Hosts (gesamt, nicht erreichbar, in Wartung), Verfügbarkeit des laufenden Monats; Links in Übersicht, Hosts und Berichte.
  - **DNS-Abgleich mit NetBox:** Zahl der Abweichungen (alle Zeilen außer „in Ordnung“) und Zeit des letzten Abgleichs aus dem bestehenden Modul, Link auf `/monitoring/dns`.
- Wichtigste Probleme aus allen Quellen, nach Schweregrad und Alter, filterbar nach Quelle.
- „Zu erledigen“ aus allen Quellen.
- Übersicht nach Standort: je Standort Hosts, Probleme und nicht erreichbare Hosts; dazu „ohne Standort“.
- „Stand der Daten“ je Quelle sichtbar; fällt eine Quelle aus, zeigt die Karte den letzten Stand mit Zeit und einen Hinweis.

### Zabbix

Liest Daten aus Zabbix über die JSON-RPC-API. **Erst einmal nur lesen.**

#### Verbindung und Collector

- **Nur der Server spricht mit der API von Zabbix.** Ein Collector im Worker fragt ab und speichert in der Werkbank-Datenbank. Der Browser sieht nie das Token; Seiten lesen nur aus der Werkbank. Für den Sprung nach Zabbix (siehe Seiten) bekommt der Browser nur die Adresse der Oberfläche.
- Konfiguration in der **Verwaltung › Verbindungen › Zabbix** (wie NetBox, nur `Werkbank.Admin`): https-Adresse von Zabbix (die Werkbank hängt `api_jsonrpc.php` an), API-Token (verschlüsselt gespeichert, nie ausgegeben), optional CA-Zertifikat (PEM) einer eigenen PKI, Ein/Aus, „Verbindung prüfen“ (Version, Dienstkonto, erlaubte Methoden, Ablauf des Tokens). TLS-Prüfung immer an, keine Weiterleitungen, nur diese eine eingetragene Adresse, Zeitlimit 10 s je Anfrage, Antworten höchstens 20 MB. Ohne Adresse und Token ist die Quelle „nicht eingerichtet“.
- Anmeldung nur per API-Token im Header `Authorization: Bearer …`, nie per `auth` im Body. `apiinfo.version` wird ohne Token abgefragt (Zabbix verlangt das so).
- Takt (Aufträge im Worker, je Auftrag höchstens ein Lauf gleichzeitig):
  - jede Minute: `problem.get` (offene Probleme, ohne unterdrückte in den Zahlen), `trigger.get` (Host zu den Problemen), `host.get` (Verfügbarkeit der Schnittstellen und des aktiven Agenten, Wartungsstatus)
  - alle 15 Minuten: `maintenance.get`
  - stündlich: `apiinfo.version`, `host.get` mit `selectInterfaces`, `selectHostGroups`, `selectParentTemplates`, `selectInventory` (nur Seriennummer und wenige Felder), `hostgroup.get`, dazu Prüfung von Token und Rolle (siehe Sicherheit; Dienstkonto über `user.checkAuthentication` mit dem Token, dann `role.get` und `token.get`). Die Namen der Templates kommen mit `host.get`, `template.get` ist nicht nötig
  - stündlich geprüft (Auftrag „berichte“): je abgeschlossenem Tag (Zeitzone Europe/Berlin) `event.get` für die Ausfälle (Tag `scope: availability`, Schweregrad Hoch und Katastrophe, Beginn bis 90 Tage vor dem Tag) und für alle Probleme, die an dem Tag begonnen haben, dazu `event.get` mit den Ende-Ereignissen; verdichtet zu Ausfallzeiten je Host und Tag, Auslösern je Monat und Ausfällen. Höchstens 7 Tage je Lauf. **Nicht rückwirkend:** Die Sammlung beginnt mit dem Tag des ersten Laufs (`reports_since`)
- **Versionen 7.x und 8.0:** Die Version kommt aus `apiinfo.version` (beim Start und stündlich) und steht auf der Verbindungsseite. Alle Unterschiede liegen in einem API-Client (`zabbix/client.py`), nicht im übrigen Code. Keine `hostinterface.*`-Methoden; Schnittstellen nur über `host.get` mit `selectInterfaces`. Den Zustand eines Wartungszeitraums (aktiv, demnächst, abgelaufen; in Zabbix 8.0 „Upcoming“ statt früher „Approaching“) errechnet die Werkbank selbst aus `active_since`, `active_till` und den Zeitfenstern; die API liefert ihn nicht. Unbekannte Hauptversionen: Abruf läuft weiter, Hinweis auf der Verbindungsseite.
- **Ausfall von Zabbix** blockiert die Werkbank nicht: Fehler werden je Auftrag festgehalten, die Seiten zeigen den letzten Stand mit Zeit und den Fehler in einfachen Worten. Nach drei fehlgeschlagenen Läufen in Folge eine Benachrichtigung an `Werkbank.Admin` (ohne fachliche Inhalte).
- **Zabbix bleibt die Quelle:** keine Rohverläufe, keine Werte von Items. Gespeichert wird nur, was Übersicht, Verknüpfung und Berichte brauchen:
  - `mon_zbx_hosts` (Host-ID, technischer und sichtbarer Name, Status überwacht/nicht, Verfügbarkeit, in Wartung, Schnittstellen mit Typ/Adresse/Port/Verfügbarkeit, Hostgruppen, Templates, Seriennummer aus dem Inventar, zuletzt gesehen, Standort, verknüpftes Gerät),
  - `mon_zbx_problems` (offene Probleme: Event-ID, Trigger-ID, Host, Name, Schweregrad, seit, quittiert ja/nein, unterdrückt ja/nein, Tags),
  - `mon_zbx_maintenances` (Name, Zeitraum, Zeitfenster, Hosts und Hostgruppen, mit/ohne Datensammlung),
  - `mon_zbx_downtime` (je Host und Tag in Sekunden: überwachte Zeit, Wartung, Ausfall ohne Zeiten in Wartung; mit Name, Standort und Hostgruppen des Tages), `mon_zbx_trigger_stats` (je Monat, Trigger und Host: Anzahl und Dauer), `mon_zbx_outages` (Ausfälle mit Host, Standort, Name, Beginn, Ende), `mon_zbx_report_days` (erzeugte Tage), `mon_zbx_maint_log` (beobachtete Wartungszeiten je Host, 40 Tage); Migration 0062,
  - `mon_zbx_runs` (je Auftrag: Zeit, Dauer, Ergebnis, Fehler; 30 Tage),
  - `mon_zbx_problem_hours` (je Stunde nur die Zahl der offenen und der schweren Probleme beim letzten Abruf der Stunde, für den Verlauf der Übersicht; 48 Stunden).
  Hosts und Probleme, die in Zabbix verschwinden, werden gelöscht; Berichtsdaten bleiben 3 Jahre.
- **Keine personenbezogenen Daten:** keine Quittierungs-Kommentare, keine Benutzernamen aus Zabbix, keine Inventarfelder außer Seriennummer, Modell und Typ.

#### Schweregrade

Wie in Zabbix: Katastrophe, Hoch, Durchschnitt, Warnung, Information (und „Nicht klassifiziert“ wie Information). Die Farben unterscheiden sich auch in der Helligkeit und stehen nie allein: immer mit Text bzw. Symbol. Hell und dunkel getrennt festgelegt, Kontrast nach WCAG 2.2 AA.

#### Standorte

- **Standort aus der Hostgruppe.** Auf der Verbindungsseite ordnet ein Admin Hostgruppen einem Standort des IT-Bestands zu (Ebene „Standort“ unter Stadt). Ein Host mit mehreren passenden Gruppen nimmt die erste nach Reihenfolge der Zuordnung; ohne passende Gruppe erscheint er unter „ohne Standort“.
- Die Namen der Standorte stehen nur in der Datenbank, nicht im Code.

#### Abgleich mit dem IT-Bestand

- **Nur über die Seriennummer** aus dem Zabbix-Inventar gegen die Seriennummer im IT-Bestand (befüllt aus NinjaOne oder von Hand); Vergleich ohne Leerzeichen, Groß- und Kleinschreibung egal. Kein Abgleich über Hostnamen.
- Listen: **Nicht überwacht** (aktives Gerät im Bestand, Seriennummer in keinem Zabbix-Host), **Ohne Bestandseintrag** (Zabbix-Host mit Seriennummer, die im Bestand fehlt), **Seriennummer fehlt** (Zabbix-Host ohne Seriennummer im Inventar).
- Geräte lassen sich als **„bewusst nicht überwacht“** markieren (mit kurzer Begründung, im Verlauf des Geräts); sie fallen aus „Nicht überwacht“ heraus. Für „Nicht überwacht“ zählen nur Geräte der Hardware-Arten, die der Admin auf der Verbindungsseite festlegt (z. B. Server, Switch, Firewall), damit Notebooks und Monitore die Liste nicht füllen.
- Hosts ohne Seriennummer lassen sich **von Hand einem Gerät zuordnen** (Suche im Bestand); die Zuordnung gilt, bis Zabbix eine Seriennummer liefert. Markieren und Zuordnen: `Monitoring.Reader` (oder Admin) mit `Bestand.Editor`, jede Aktion mit Bestätigung, im Audit und im Verlauf des Geräts. Gibt es eine Seriennummer mehrfach im Bestand, zählt das Gerät mit der kleinsten ID; „Seriennummer fehlt“ zählt nur überwachte Hosts. Tabellen `mon_zbx_unmonitored` und `mon_zbx_host_links` (Migration 0061).

#### Seiten

- **Übersicht** (`/monitoring/zabbix`, seit 0.105.0 neu aufgebaut): oben der **Gesamtstand** als farbige Karte (rot: Problem mit Hoch oder Katastrophe offen, gelb: andere Probleme oder nicht erreichbare Hosts, grün: alles in Ordnung; mit Aufzählung nach Schweregrad und dem am meisten betroffenen Standort), daneben „Hosts erreichbar“ (mit Anteil und Wartung) und „Zu erledigen“ (Summe). Darunter die offenen Probleme als **Balken nach Schweregrad** (Klick filtert), die **Standorte** als Kacheln mit einem Kästchen je überwachtem Host (Farbe = schlimmster offener Schweregrad, schwarz umrandet nicht erreichbar, grau in Wartung; höchstens 400 je Standort; Klick filtert; Hosts ohne Standort als eigene Kachel), die **aktuellen Probleme** mit den gewählten Filtern und „Filter zurücksetzen“, dann **Letzte 24 Stunden** (offene Probleme je Stunde aus `mon_zbx_problem_hours`), nicht erreichbare Hosts, laufende und kommende Wartungen und ganz unten „Zu erledigen“ (Lücken zum IT-Bestand, Probleme länger als 7 Tage offen, ablaufende Zertifikate: offene Probleme mit einem Tag, den der Admin auf der Verbindungsseite festlegt, z. B. `component: certificate`; ohne Festlegung entfällt der Punkt). Probleme abgeschalteter Trigger, Items oder Hosts zählen nirgends (`trigger.get` mit `monitored`). Ohne Einrichtung nur der Hinweis. „Stand der Daten“ immer sichtbar.
- **Hosts** (`/monitoring/zabbix/hosts`): Tabelle mit Ansicht rechts (wie die Vorgänge im IT-Bestand). Filter: Alle, Mit Problemen, Nicht erreichbar, In Wartung, Ohne Bestandseintrag, Seriennummer fehlt, Nicht überwacht, In Zabbix abgeschaltet; Suche und Standort. Spalte IT-Bestand mit dem verknüpften Gerät. Ansicht: offene Probleme, Angaben aus Zabbix (Schnittstellen, Hostgruppen, Templates, zuletzt gesehen), verknüpftes Gerät im IT-Bestand mit Link oder Zuordnung von Hand. „Nicht überwacht“ zeigt Geräte statt Hosts.
- **Wartungen** (`/monitoring/zabbix/wartungen`): laufende, kommende und abgelaufene (letzte 30 Tage) mit Zeitraum, Zeitfenstern, betroffenen Hosts und Gruppen.
- **Berichte** (`/monitoring/zabbix/berichte`, auch `Monitoring.Berichte`): Verfügbarkeit je Geschäftsjahr (Beginn und Bezeichnung aus den Einstellungen des IT-Budgets), aufgeteilt nach Standort oder Hostgruppe (ein Host in mehreren Gruppen zählt in jeder), Monatsübersicht, Zielwert 99,5 % (auf der Verbindungsseite änderbar, 90 bis 100 %), häufigste Auslöser (10), längste Ausfälle (10); Export als CSV (Semikolon, UTF-8 mit BOM, Dezimalkomma, Schutz vor Formeln) und PDF über eine Druckansicht des Browsers („Drucken oder als PDF“, ohne Menüs und Bedienelemente; keine PDF-Bibliothek). Beide Exporte stehen im Audit (`zabbix.bericht_export`). Prozentwerte werden abgeschnitten, nicht aufgerundet. Für `Monitoring.Berichte` nur Summen je Standort und Gruppe, keine Hostnamen und keine Auslöser.
- **Sprung nach Zabbix:** Knopf „In Zabbix öffnen“ an Host und Problem (öffnet in neuem Tab die Probleme des Hosts bzw. das Ereignis in der Oberfläche von Zabbix; nur für `Monitoring.Reader`, nicht in den Berichten). Die Adresse baut der Server aus der eingetragenen Adresse (oder einer eigenen, optionalen Adresse für Links, falls die Werkbank Zabbix über einen anderen Zugang erreicht als die Menschen) und den Kennungen aus Zabbix (nur Ziffern); dort meldet sich die Person mit ihrem eigenen Zabbix-Konto an.
- **Weiterleitungen:** Die Werkbank folgt Weiterleitungen von Zabbix nie (das Token bliebe sonst nicht bei Zabbix). Bei 3xx nennt die Fehlermeldung Host und Pfad des Ziels (ohne Abfrage), z. B. die Anmeldeseite eines Reverse Proxys.
- **Verwaltung › Zabbix** (`/verwaltung/zabbix`, nur `Werkbank.Admin`, bis 0.123.0 unter IT-Monitoring › Verbindung): Zustand, Zabbix-Version, Adresse, Ablauf des Tokens, je Auftrag Takt, letzter Lauf und Ergebnis, Dienstkonto, erlaubte API-Methoden der Rolle mit Warnung, Zuordnung Hostgruppe → Standort, Hardware-Arten für „Nicht überwacht“, Tag für Zertifikate, Zielwert. Keine Auswahl für die Quelle des Standorts und das Merkmal des Abgleichs: beides ist festgelegt (Hostgruppe, Seriennummer). Adresse, Token und CA pflegt der Admin in der Verwaltung; die Seite verlinkt dorthin.

#### Verfügbarkeit

- Ausfall = Zeit, in der an einem Host ein Problem mit Schweregrad Hoch oder Katastrophe eines Triggers mit dem Tag `scope: availability` offen war (so markieren die Vorlagen von Zabbix „nicht erreichbar“, z. B. ICMP-Ping und Agent). Überlappende Probleme zählen einmal.
- **Geplante Wartungen zählen nicht als Ausfall.** Die Wartungszeiten beobachtet die Werkbank selbst jede Minute aus dem Wartungsstatus der Hosts (`maintenance_status`), weil Zabbix wiederkehrende Wartungsfenster nicht als Zeiten liefert. Fällt die Werkbank aus, fehlen für diese Zeit die Wartungen (Ausfälle kommen trotzdem vollständig aus `event.get`).
- Verfügbarkeit = 1 − Ausfall / (Zeitraum − Wartung). Hosts, die im Zeitraum nicht überwacht waren, zählen nur für die überwachte Zeit: Ein Host zählt an einem Tag, wenn er beim Erzeugen des Tages in Zabbix überwacht ist.

#### Sicherheit und Datenschutz (OWASP ASVS 5.0 L2)

- **Dienstkonto** in Zabbix mit eigener Benutzerrolle: API-Zugriff an, Allow-Liste nur mit `problem.get`, `trigger.get`, `host.get`, `hostgroup.get`, `maintenance.get`, `event.get`, `role.get`, `token.get` (die letzten beiden nur, damit die Werkbank Rolle und Ablauf des eigenen Tokens prüfen kann); Leserechte nur auf die nötigen Hostgruppen; Token mit Ablaufdatum. In Zabbix 8.0 sperrt eine leere Allow-Liste jeden Zugriff, und neue Rollen haben standardmäßig keinen API-Zugriff: Die Einrichtung im Handbuch beschreibt beides für 7.x und 8.0.
- Die Werkbank **warnt** auf der Verbindungsseite und in der Glocke (`Werkbank.Admin`): 30 Tage vor Ablauf des Tokens; wenn die Rolle `*`, eine Ablehn-Liste oder mehr als die nötigen Methoden erlaubt; wenn sie Schreibmethoden erlaubt. Lassen sich Rolle oder Token nicht lesen, steht das dort als Hinweis.
- Alle Texte aus Zabbix (Trigger-, Host-, Gruppen-, Template-, Wartungsnamen, Inventarfelder, Tags) sind nicht vertrauenswürdig: nur als Text ausgegeben (React), in CSV gegen Formel-Einschleusung geschützt, Länge begrenzt beim Speichern.
- Audit: Markieren „bewusst nicht überwacht“, Zuordnung von Hand, Änderungen der Verbindungsseite, Export.

#### Stufen

1. Collector, Verbindungsseite, Übersicht, Hosts, Wartungen (nur lesen)
2. Abgleich mit dem IT-Bestand über die Seriennummer und Anzeige der Lücken
3. Berichte mit Export, Rolle `Monitoring.Berichte`
4. Monitoring-Start über alle Quellen: Zabbix und der bestehende DNS-Abgleich mit NetBox
5. Optional, später: Quittieren und Wartungen anlegen, dann mit zusätzlicher Bestätigung durch das Admin-Konto (wie bei der Gerätezuordnung) und eigener Spec-Ergänzung

### DNS-Abgleich mit NetBox (`/monitoring/dns`)

- Auftrag `monitoring.dns_netbox` alle 4 Stunden; Admins ziehen ihn mit „Jetzt prüfen“ vor.
- Liest aus NetBox (Plugin netbox-dns) Zonen und Einträge, wahlweise einer View. Ausgenommen: nicht aktive Zonen, Reverse-Zonen privater Adressen, extern verwaltete Subdomains (NS-Delegation ohne eigene Zone; nur deren NS-Einträge werden geprüft). Geprüfte Typen: A, AAAA, CNAME, MX, TXT, SPF, CAA, NS, SRV, PTR, SOA; andere werden gezählt und genannt.
- **Nur die Einträge aus NetBox:** Je Name und Typ eine Abfrage im öffentlichen DNS über einen der festen Resolver (DNS über HTTPS, wie die IT-Tools). Keine Suche nach Neuem (keine typischen Namen, kein crt.sh).
- Status je Name und Typ: in Ordnung, abweichend (andere oder zusätzliche Werte; mit TTL-Vergleich auch öffentlich größere TTL; SOA ohne Seriennummer), fehlt öffentlich, Fehler, inaktiv (nur inaktiv in NetBox und öffentlich nicht vorhanden; öffentlich vorhanden gilt als abweichend). Vergleich mit Normalisierung (relative Namen zur Zone, IPv6-Schreibweise, TXT-Teilstrings, CAA).
- Seite: Kennzahlen, Verlauf der letzten 90 Tage (je Tag der letzte Lauf), Ansichten „Probleme“, „Neu seit dem letzten Lauf“, „Alle“, Suche, Tabelle je Zone mit Werten aus NetBox und öffentlich, Hinweisen und Link in NetBox; Liste des nicht Geprüften.
- Gespeichert: Läufe 90 Tage (Zahlen), Zeilen nur der letzten beiden erfolgreichen Läufe. Schlägt das Lesen von NetBox fehl, gilt der Lauf als fehlgeschlagen; das letzte Ergebnis bleibt sichtbar.
- Glocke: neue Probleme gegenüber dem vorletzten Lauf (eine Benachrichtigung je Lauf) und ein fehlgeschlagener Lauf (`Monitoring.Reader`, der fehlgeschlagene Lauf auch `Werkbank.Admin`).
- Für den Monitoring-Start: `GET /api/monitoring/dns/summary` (eingeschaltet, Zeit und Status des letzten Laufs, Zahl der Abweichungen = alle Zeilen außer „in Ordnung“, nächster Termin). Sonst bleibt das Modul unverändert; im Seitenmenü steht es in der Gruppe „NetBox“.
- Verwaltung › Allgemein › NetBox: https-Adresse, API-Token (verschlüsselt, nie ausgegeben), optional CA-Zertifikat (PEM) für eine eigene PKI, View, Resolver, TTL-Vergleich, Ein/Aus, „Verbindung prüfen“ (Version, Plugin, Views, Zahl der Zonen). Der Server erreicht NetBox auch im internen Netz, aber nur diese eine eingetragene https-Adresse, ohne Weiterleitungen.

## 8c. Bereich IT-Projekte

Projekte der IT mit Budget, Ansprechpartnern, Links, Jour-Fixe-Protokollen und einer groben Aufgabenliste. Zugriff: `Projekte.Reader` liest, `Projekte.Editor` pflegt (serverseitig geprüft). Eigener Bereich „IT-Projekte“ in der Navigation (`/projekte`, ein Projekt unter `/projekte/{id}` mit den Reitern Übersicht, Budget, Jour Fixe, Aufgaben, Einstellungen).

- **Projekt:** Name (eindeutig), Kurzbeschreibung, Status (geplant, aktiv, pausiert, abgeschlossen), Beginn und Ende, veranschlagtes Budget (brutto) mit Freigabedatum und Notiz. Abgeschlossene Projekte bleiben lesbar; im IT-Budget lassen sich ihnen keine neuen Posten zuordnen.
- **Rollen und Ansprechpartner:** interne und externe Personen als Freitext (Name, Rolle im Projekt, Firma oder Abteilung, Kontakt). Bewusst keine Abfrage aus Entra; die Werkbank liest dafür keine Namen aus dem Verzeichnis.
- **Links:** beliebig viele (bis 30) mit Bezeichnung, nur vollständige https-Adressen ohne Zugangsdaten, Reihenfolge frei.
- **Budget:** Die Kosten kommen aus dem IT-Budget (Kapitel 7b) über das Feld „Projekt“ am Budgetposten. Je Posten und Geschäftsjahr der Laufzeit (ohne Ende: bis zum laufenden Geschäftsjahr) und je Jahr mit Rechnungen: **Ist** = gebuchte Rechnungspositionen, **geplant** = Prognose minus Ist (abgeschlossen: 0; Rechnungen „zu prüfen“ zählen damit noch als geplant); stillgelegte Posten planen nichts mehr. **Verbleibend** = veranschlagt − geplant − Ist. Der Reiter Budget zeigt die Posten und die Summen je Geschäftsjahr und weist auf eine Überschreitung hin. Die Zahlen sehen alle Rollen des Projekts, auch ohne Rolle im IT-Budget.
- **Jour Fixe:** Einträge mit Datum, Titel und Protokoll in Markdown (bis 50.000 Zeichen): Überschriften, Listen, Checklisten, Zitate, Trennlinie, fett, kursiv, Code, Links nur mit https. Die Oberfläche zerlegt den Text selbst und stellt ihn als Text dar, nie als HTML; eine Leiste setzt die Zeichen um die Auswahl, mit Vorschau. Je Eintrag bis 10 PDF-Anhänge mit je bis 20 MB (`PROJECT_DOCUMENT_MAX_MB`; geprüft wird der Dateianfang), abgelegt wie die Belege des Budgets unter zufälligem Namen (`PROJECT_DOCUMENTS_DIR`, Vorgabe `/data/belege/projekte` im Volume der Belege), Download immer als Anhang. Kein Virenscan.
- **Aufgaben:** grobe Liste zur Orientierung (Text, zuständig als Freitext, Datum, erledigt); die eigentlichen Aufgaben laufen in anderen Werkzeugen. Keine Aufgaben auf der Startseite, keine Benachrichtigungen.
- **Löschen:** Ein Projekt wird mit Ansprechpartnern, Links, Aufgaben, Jour Fixe und Anhängen gelöscht; Budgetposten bleiben und verlieren nur die Zuordnung.
- **Suche:** Projekte nach Name und Beschreibung (nur mit Projekt-Rolle).
- **Audit:** Anlegen, Ändern und Löschen von Projekten, Aufgaben, Jour-Fixe-Einträgen und Anhängen (Modul `projekte`), ohne Namen von Personen.

## 8d. Bereich IT-Bestand

Bestand der IT-Hardware. Schritte 1 bis 8 sind umgesetzt. Zugriff: `Bestand.Reader` liest, `Bestand.Editor` pflegt (serverseitig geprüft). Eigener Bereich „IT-Bestand“ in der Navigation (`/bestand/hardware`, ein Gerät unter `/bestand/hardware/{id}` mit den Reitern Übersicht, Standort, Technik und Verlauf; `/bestand/standorte` mit `/etage/{id}` und `/raum/{id}`; `/bestand/vorgaenge` und ein Vorgang unter `/bestand/vorgaenge/{id}`; `/bestand/verleih` mit `/bestand/verleih/neu` und einem Verleih unter `/bestand/verleih/{id}`; `/bestand/stellen` und eine Stelle unter `/bestand/stellen/{id}` mit den Reitern Übersicht, Arbeitsplätze, Hardware und Verlauf; `/bestand/arbeitsplaetze` und ein Arbeitsplatz unter `/bestand/arbeitsplaetze/{id}` mit den Reitern Übersicht, Ausstattung, Hardware, Standort und Verlauf; `/bestand/stammdaten`).

- **Gerät:** Bezeichnung, Art, optional Hersteller und Modell, Seriennummer, Inventurnummer, Hostname, Notiz, Herkunft (bisher nur „von Hand“). Seriennummer (ohne Groß- und Kleinschreibung) und Inventurnummer sind eindeutig, sobald eingetragen.
- **Inventurnummer:** Setzen, Ändern und Entfernen nur mit Rückfrage in der Oberfläche, auch beim Anlegen; jede Änderung steht im Verlauf und im Audit-Log.
- **Ausmustern statt Löschen:** Grund (Stammdaten), Verbleib (entsorgt, verkauft oder abgegeben, an Leasing zurück, beim Hersteller), Datum (nicht in der Zukunft; ein Tag Spielraum wegen der Zeitzone), Notiz. Bei Arten mit Datenträger ist die Bestätigung „gelöscht oder vernichtet“ Pflicht. Ein Bearbeiter allein genügt. Ausgemusterte Geräte bleiben mit Verlauf erhalten und stehen unter „Ausgemustert“; „Wieder in Betrieb nehmen“ macht das Ausmustern rückgängig. Geräte werden nicht gelöscht.
- **Verlauf:** je Gerät mit Datum und Person; die Texte erzeugt die Werkbank, dargestellt nur als Text.
- **Stammdaten:** Hardware-Arten (mit Merkmal „hat Datenträger“), Hersteller mit Modellen, Gründe fürs Ausmustern. Startwerte kommen mit der Migration. Verwendete Einträge lassen sich umbenennen, aber nicht löschen.
- **Liste:** Status (im Bestand, ausgemustert, alle), Suche über Bezeichnung, Art, Modell, Seriennummer, Inventurnummer und Hostname, Filter nach Art. Auf schmalen Bildschirmen werden die Zeilen zu Karten.
- **Suche:** Geräte nach Bezeichnung, Seriennummer, Inventurnummer und Hostname (nur mit Bestand-Rolle).
- **Standorte:** Stadt › Standort › Gebäudeabschnitt › Etage › Raum. Links der Baum (einblendbar und ausblendbar, gemerkt im Browser; Pfeil klappt jede Ebene auf und zu, der Name öffnet sie; anfangs offen nur der Weg zur Auswahl; „Alles einklappen“; zwei Ansichten, gemerkt im Browser: „Kompakt“ eine Zeile je Eintrag mit Symbol der Ebene, langer Name mit „…“ und ganz im Tooltip und für Screenreader, rechts die Zahl darunter, 32 px hoch und mit dem Finger 44 px; „Ausführlich“ (Vorgabe) ganzer Name und darunter Standorte, Etagen, Räume, freie Plätze und „ohne Grundriss“, freie Plätze aus `workplaces_free` je Etage in `GET /api/inventory/locations`; ersetzt seit 0.117.0 die drei Abstände aus 0.113.0), Suche über alle Ebenen. Rechts genau die Auswahl: Stadt, Standort und Abschnitt (`/bestand/standorte/{stadt|standort|abschnitt}/{id}`) mit den Einträgen darunter, „Neuer …“, Umbenennen und Löschen; Etage mit anklickbarem Pfad, Grundriss und Raumliste (je Raum Name, Beschreibung, belegte und freie Arbeitsplätze, Geräte; Suche über Name, Beschreibung und Personen der Stellen an den Arbeitsplätzen; Auswahl „Zeigen“ statt Filter-Chips: alle, freie Plätze, mit Geräten, ohne Geräte, je mit Anzahl; ab 13 Räumen Gruppen nach dem Anfang der Raumnummer, z. B. 200–299, 50–59 oder „2.…“, zuklappbar; die Liste scrollt mit der Seite), „Etage bearbeiten“ (Grundriss, Name, Reihenfolge, Löschen); gewählter Raum neben dem Grundriss mit Arbeitsplätzen, Name und Lage. Neue Städte unten im Baum. Schmal mit „Standort wechseln“. Löschen nur, was leer ist; Räume nur ohne Hardware (409).
- **Grundriss:** ein Bild je Etage (PNG, JPEG, WebP; Prüfung am Inhalt, 50 bis 12 000 Pixel je Seite, höchstens `INVENTORY_PLAN_MAX_MB`, Vorgabe 10 MB), in der Datenbank (`inventory_floor_plans`). `GET /api/inventory/floors/{id}/plan` mit `no-store`, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`; die URL trägt den ETag als Versionsparameter.
- **Pool-Arbeitsplatz** (seit 0.110.0): dritter Typ neben Einzel und Geteilt (`pool`). Gehört absichtlich keiner Stelle (422, wenn Stellen mitkommen), Zweck Pflicht aus den Stammdaten (`purpose_id`, Tabelle `inventory_workplace_purposes`, `/api/inventory/purposes`, Löschen nur unbenutzt), verantwortliche Abteilung freiwillig (`department_id`). Zählt nie als „frei“ (Filter `frei`, `workplaces_free` der Raumliste); Filter `pool`; Suche über Zweck und Abteilung; Typwechsel im Verlauf. Bestehende Arbeitsplätze ohne Stelle bleiben frei, bis sie jemand umstellt. Migration `0075` legt die Zwecke Desk-Sharing, Gast, Schulung und Besprechung als Vorschlag an.
- **Räume:** freiwillige Beschreibung bzw. Nutzung (`description`, höchstens 120 Zeichen, Migration `0074`; ohne Angabe beim Speichern bleibt sie stehen, leer löscht sie). `RoomOut` liefert dazu `workplaces`, `workplaces_free` und `people` (höchstens 20). Rechteck in Prozent des Grundrisses (x, y, Breite, Höhe; serverseitig auf 0 bis 100 geprüft, auf zwei Stellen gerundet). Aufziehen, Verschieben und Größe ändern mit Zeiger; für Tastatur und Bildschirmleser Zahlenfelder (WCAG 2.5.7).
- **Gerät im Raum:** optional; Anzeige als „Raum · Standort, Etage“, Reiter Standort mit hervorgehobenem Raum, Wechsel im Verlauf. Die Suche findet Räume.
- **Stellen:** Nummer aus dem Nummernkreis (Präfix plus mindestens dreistellige Zahl, Vorgabe `ST-`), Bezeichnung, Abteilung (Stammdaten), Besetzung, Notiz. Die Besetzung pflegt nur die Werkbank: Die Person wird aus Entra gewählt (`GET /api/inventory/people?q=`, nur `Bestand.Editor`, ab zwei Zeichen, höchstens 15 Treffer, nur Mitglieder; Graph `users` mit `$search`, Berechtigung `User.Read.All` der Collector-App). Gespeichert werden Objekt-ID, Name und Anmeldename zum Zeitpunkt der Auswahl. Hardware und Arbeitsplätze hängen an der Stelle, nicht an der Person. Reiter „Hardware“ der Stelle: „Direkt an der Stelle“ und getrennt davon „Über Arbeitsplätze“ (je Arbeitsplatz mit Hinweis und, bei geteilten Plätzen, Zahl der weiteren Stellen; API `workplace_hardware`). Die Zahl in der Liste der Stellen zählt nur direkte Hardware. Löschen nur ohne Hardware; Verknüpfungen zu Arbeitsplätzen entfallen.
- **Arbeitsplätze:** Nummer aus dem Nummernkreis (Vorgabe `AP-`), keine eigene Bezeichnung (Anzeige als Nummer, in Listen mit Raum), Raum (beim Anlegen Pflicht, serverseitig geprüft; bestehende Arbeitsplätze dürfen ohne Raum bleiben) mit optionalem Platz im Raum (beim Anlegen direkt im Grundriss wählbar, `spot_x`/`spot_y`) (Prozent der Raumbreite und -höhe, `PUT /api/inventory/workplaces/{id}/spot`, entfällt beim Raumwechsel), Typ einzeln (höchstens eine Stelle, serverseitig geprüft) oder geteilt (mehrere Stellen), Ausstattungsvorlage, Notiz. Löschen nur ohne Hardware. Ein Raum mit Arbeitsplätzen lässt sich nicht löschen. Liste mit Filtern (alle, einzeln, geteilt, frei, Ausstattung fehlt). Die Lage als Punkt auf dem Grundriss folgt später.
- **Ausstattungsvorlagen (Stammdaten):** Name und Zeilen mit Bezeichnung, passenden Hardware-Arten und Anzahl (1 bis 9). Am Arbeitsplatz zählt die Werkbank aktive Hardware am Arbeitsplatz und an seinen Stellen; jedes Gerät zählt höchstens einmal, die Zeilen werden in ihrer Reihenfolge bedient. Eine Art in einer Vorlage und eine Vorlage an einem Arbeitsplatz lassen sich nicht löschen.
- **Nummernkreise (Stammdaten):** Präfix je Kreis (Buchstaben, Ziffern, `. _ / -`, höchstens 10 Zeichen); ein neues Präfix gilt nur für neue Einträge, die Zahl läuft weiter.
- **Gerät an Stelle oder Arbeitsplatz:** optional und höchstens eins von beiden (Datenbank-Prüfung); Anzeige „Zugeordnet zu“ mit Link, Wechsel im Verlauf, Suche in der Liste.
- **Verlauf** auch je Stelle und Arbeitsplatz (Besetzung mit Namen, Verknüpfungen, Änderungen).
- **Suche:** zusätzlich Stellen (Nummer, Bezeichnung, Person) und Arbeitsplätze (Nummer, Bezeichnung).
- **Abgleich mit NinjaOne:** alle 30 Minuten (`bestand.ninjaone`), wenn ein Admin ihn in der Verwaltung unter „Verbindungen“ einschaltet (Region, Client-ID, Client-Secret verschlüsselt; „Verbindung prüfen“ zählt die Arbeitsplatzrechner). Anmeldung OAuth 2.0 Client Credentials mit Scope `monitoring`; Hosts nur aus einer festen Liste der Regionen. Gelesen werden nur Knoten der Klassen `WINDOWS_WORKSTATION`, `MAC` und `LINUX_WORKSTATION`. Erkennung: NinjaOne-ID, sonst Seriennummer (ohne Groß- und Kleinschreibung, nur Geräte ohne NinjaOne-ID); der Hostname ist nur ein Hinweis im Vorgang. Übernommen werden Hostname (mit Eintrag im Verlauf), fehlende Seriennummer und die Kenndaten (Typ nach Bauform, Hersteller, Modell, Betriebssystem, IP-Adressen, Arbeitsspeicher, Richtlinie, zuletzt online). Eine leere Liste trotz verknüpfter Geräte bricht den Lauf ohne Änderungen ab. Läufe 90 Tage. In der Verwaltung lassen sich Organisationen und Geräterollen (nur Rollen für Arbeitsplatzrechner) mehrfach auswählen; leer heißt alle. Die Auswahl gilt nur für neue Geräte (Vorgang „neu“); verknüpfte Geräte gleicht die Werkbank auch außerhalb der Auswahl weiter ab und meldet sie nicht als fehlend. Organisation und Geräterolle stehen in den Kenndaten.
- **Vorgänge:** Nummer aus dem Nummernkreis (`V-`), Art „neu“ oder „weg“, Status neu, in Bearbeitung, fertig; Bearbeiter, Notizen, Verlauf; sichtbar für Bestand-Rollen, bearbeitbar für `Bestand.Editor`. Neu: Stelle, Arbeitsplatz, Lager (optional Raum), „Ist dasselbe Gerät“ (das vorhandene Gerät übernimmt NinjaOne-ID, Hostname und Seriennummer; sein offener Vorgang „weg“ schließt sich als ersetzt) oder nicht aufnehmen (Liste der übergangenen Geräte). Weg: ausgemustert (nur wenn das Gerät ausgemustert ist), verloren oder gestohlen, prüfen (bleibt offen). Taucht ein Gerät wieder auf, schließt der Abgleich den Vorgang. Ein neu angelegtes Gerät bekommt Art, Hersteller und Modell; fehlende Hersteller und Modelle entstehen in den Stammdaten. Listen „Vorgänge“ und „Verleih“ seitenweise (`offset`, `limit`, Vorgabe 50, höchstens 200, Antwort mit `total`) mit Suche `q` auf dem Server (höchstens 100 Zeichen, LIKE mit maskierten Platzhaltern): Vorgänge in Nummer, Titel und Angaben, Verleihe in Nummer, Person, Anmeldename und Name, Seriennummer, Inventurnummer der Geräte. Vorgänge zusätzlich nach Art (`kind`: neu, weg, monitor, person_inaktiv, rueckgabe, ueberfaellig). Oberfläche: Suchfeld mit kurzer Verzögerung beim Tippen, „x von y“ und „Mehr anzeigen“; Liste mit fester Höhe, die für sich scrollt, Ansicht daneben; unter 1024 px erst nur die Liste, gewählt nur die Ansicht mit „Zur Liste“.
- **Auswahl mit Suche:** `GET /api/inventory/lookup?kind={position|workplace|room|hardware}&q=` (Bestand-Rollen, höchstens 20 Treffer und Gesamtzahl; Suche in Nummer, Name, Person, Anmeldename, Abteilung, Raum und Pfad, Hostname, Seriennummer, Inventurnummer; Geräte ohne ausgemusterte, mit `computers=true` nur Notebooks und PCs). Genutzt bei der Entscheidung im Vorgang (Stelle, Arbeitsplatz, Raum, vorhandenes Gerät) und beim Arbeitsplatz (Raum, Stellen).
- **Monitore aus NinjaOne:** Custom Field (mehrzeiliges Textfeld, interner Name in der Verwaltung), eine Zeile je Monitor: `Hersteller|Modell|Seriennummer|ProductCode|Baujahr-KW|Anschluss|ZuletztGesehen` (Hersteller als PNP-ID aus EDID). Gelesen über `/v2/queries/custom-fields`. Erkennung über die Seriennummer. Neuer Monitor an einem PC mit Arbeitsplatz: direkt an diesen Arbeitsplatz; sonst Vorgang „monitor“ mit Vorschlag (Arbeitsplatz des Rechners oder erster Arbeitsplatz seiner Stelle), Entscheidungen Arbeitsplatz, Stelle oder nicht übernehmen (Liste nach Seriennummer). Bekannter Monitor an anderem Rechner: nur `connected_to` und Verlauf. Kein Vorgang, wenn ein Monitor aus dem Feld verschwindet.
- **Technik:** Reiter am Gerät mit den Kenndaten aus NinjaOne (Monitor: Angeschlossen an und Werte aus dem Custom Field; Rechner: angeschlossene Monitore); bei verknüpften Geräten sind Hostname und Seriennummer nicht von Hand änderbar (422).
- **Lenovo PSREF** (seit 0.131.0 über die offizielle Schnittstelle `https://psrefapi.lenovo.com`): in der Verwaltung bei NinjaOne einschaltbar (`psref_enabled`, Vorgabe aus). Auftrag `bestand.psref` einmal am Tag für Lenovo-Modelle mit Geräten im Bestand, deren Name ein Maschinentyp-Modell ist (MTM, zehn Zeichen, wie NinjaOne es bei Lenovo-Rechnern liefert; Monitore kommen aus NinjaOne ohne MTM und werden daher nicht abgefragt), höchstens 40 je Lauf mit Pause. Abruf `GET /psref/mobile/model/ModelDetails/{MTM}` ohne Weiterleitungen, mit Zeitlimit; Antwort: `Name`, `ModelURL`, `Detail` (Name/Wert). Gespeichert am Modell (Migration `0089`): Name, Link (nur `https://psref.lenovo.com/…`, sonst die PSREF-Suche), Merkmale (ohne TopSeller, Region, EAN), Status (`ok`, `nicht_gefunden`, `fehler`), Fehlergrund, Zeitpunkt; erneut nach 30 bzw. 7 Tagen. Reiter „Technik“: unter den Werten aus NinjaOne (dort seit 0.132.0 auch Prozessor und Laufwerke) ein eingeklappter Bereich mit Name, Status, Link, Eckdaten, die NinjaOne nicht kennt (Grafik, Bildschirm, Kamera, Mikrofon, Lautsprecher, WLAN, Garantie ab Werk, Support-Ende), und allen Merkmalen; `POST /api/inventory/hardware/{id}/psref` (Bearbeiter) fragt sofort ab, Audit `bestand.psref_abgerufen` (mit Grund bei Fehlern). Das Backend gibt Meldungen der Logger `werkbank.*` ab `LOG_LEVEL` aus.
- **Verleih:** Geräte an eine Person aus Entra (Objekt-ID; Name, Anmeldename und Mailadresse liest der Server selbst über `GET /users/{id}`, deaktivierte Konten abgelehnt), Startdatum (`start_on`, leer = heute; heute bis ein Jahr) und Rückgabedatum ab heute bis ein Jahr, nicht vor dem Start, mehrere Geräte je Verleih (höchstens 20), Nummer aus dem Nummernkreis `verleih` (Vorgabe `L-`). Verleihbar: aktiv, ohne Stelle und Arbeitsplatz, nicht schon offen verliehen (Teilindex). Verliehene Geräte: keine Zuordnung und kein Ausmustern (409). Rückgabe einzeln oder ganz (`POST /api/inventory/loans/{id}/return`), je Rückgabe Vorgang `rueckgabe` (Entscheidungen `lager` mit optionalem Raum, `defekt`); Datum ändern `PUT /api/inventory/loans/{id}/due`. **Vorab geplant** (Start in der Zukunft): Status `geplant` (Filter `state=geplant`), die Geräte sind ab dem Anlegen reserviert (zählen als offen verliehen), die Nachricht zur Ausgabe merkt der Auftrag `bestand.verleih` am Startdatum vor; Rückgabe vor dem Start hebt die Reservierung auf (ohne Vorgang `rueckgabe` und ohne Nachricht, in der Oberfläche „Reservierung aufheben“ mit Bestätigung). Auftrag `bestand.verleih` alle 15 Minuten: Erinnerung zwei Tage vor dem Datum (nur wenn der Verleih vorher begann), überfällig am Tag danach und dann alle 7 Tage, Vorgang `ueberfaellig` je Rückgabedatum (Entscheidungen `verlaengert` mit neuem Datum, `geklaert`; automatisch `zurueck`, wenn alles zurück ist), danach Versand. Nachrichten an die Person je Anlass über Mail und Teams (Workflow wie in 6.7, Empfänger ist die Mailadresse aus Entra), Inhalt nur Verleihnummer, Datum und Name der Person in der Anrede; bis 5 Versuche, nach 3 Tagen verfallen; ohne SMTP, Teams oder Mailadresse Status „aus“. Tage nach Europe/Berlin.
- **Ausgabe** (0.150.0, `/bestand/ausgaben`, `modules/inventory/issues.py`, Migration 0094): Geräte **dauerhaft** an eine Person an ihrer Stelle (Verleih bleibt für Geräte auf Zeit). Anlegen nur `Bestand.Editor`: Person aus Entra (Server liest Name, Anmeldename und Mailadresse; deaktivierte Konten abgelehnt), eine Stelle, an der die Person eingetragen ist (`GET /api/inventory/issues/positions?oid=`), Anlass `neu`/`ersatz`/`zusatz`, 1–20 freie Geräte (wie beim Verleih, zusätzlich nicht in einer laufenden Ausgabe; `GET /api/inventory/issues/free-devices`) je mit gewähltem Zubehör (Namen werden gespeichert), Zustand `neuwertig`/`gebraucht`/`maengel` mit Hinweis, Nutzungsregeln anhängen ja/nein, Teams zusätzlich ja/nein, Bestätigung `unterschrift` oder `link`; Nummer aus dem Nummernkreis `ausgabe` (Vorgabe `A-`). Ab dem Anlegen sind die Geräte **reserviert** (Teilindex `active`): kein Verleih, keine andere Zuordnung, kein Ausmustern (409). Ablauf **vorbereitung → bereit → uebergeben** (oder `abgebrochen`, Geräte wieder frei, Link ungültig). **Vorbereitung:** Checkliste aus den Vorlagen der Stammdaten (erst Anlass, dann je Gerät die Punkte seiner Art), eigene Punkte bis 60, Abhaken mit Zeit und Person, Abholort und -zeitpunkt. „Vorbereitung abschließen“ (`POST …/ready`) geht nur ohne offene Punkte und merkt die Nachricht „bereit“ vor: Mail immer, Teams auf Wunsch (entschieden), Inhalt nur Nummer, Abholort, Zeitpunkt und bei `link` der Einmal-Link, keine Gerätedaten. **Bestätigung:** bei der IT mit Unterschrift (PNG bis 200 KB, am Inhalt geprüft) oder getipptem Namen (`POST …/handover`); oder über den **Einmal-Link ohne Anmeldung** (entschieden): `/bestaetigen/<token>`, 32 Byte Zufall, gespeichert nur als SHA-256, 14 Tage gültig, nach der Bestätigung ungültig, neuer Link mit `POST …/link`; die Seite zeigt nur Nummer, Name, Geräte, Zubehör und Nutzungsregeln (`GET/POST /api/public/ausgabe/{token}`, `Cache-Control: no-store`, Ratelimit wie die Anmeldung). Der Link steht nie in der Datenbank; die Nachricht verschickt der Server direkt nach dem Abschließen, scheitert der Versand, bleibt sie als „fehlgeschlagen“ stehen und es braucht einen neuen Link. Mit der Bestätigung hängen die Geräte an der Stelle, die Nutzungsregeln werden so gespeichert, wie sie bestätigt wurden; Übergabeprotokoll in der Oberfläche mit Unterschrift (`GET …/signature`), Druck über die Druckansicht. **Stammdaten › Ausgabe:** Zubehör je Hardware-Art, Vorlagen der Checkliste je Anlass oder Art, Text der Nutzungsregeln (bis 5000 Zeichen, nur Text; leer = keine). Wiederholung offener Nachrichten ohne Link im Auftrag `bestand.verleih`.
- **Rückgabe** (0.150.0, `/bestand/rueckgaben`): alle Geräte einer Person an ihren Stellen (über `person_oid`) und aus offenen Verleihen, Nummernkreis `rueckgabe` (Vorgabe `R-`), höchstens eine offene Rückgabe je Person. Entsteht **automatisch**, wenn der Abgleich mit Entra das Konto als deaktiviert oder gelöscht erkennt (`reason=austritt`, neben den Vorgängen „Person nicht mehr aktiv“), oder **von Hand** ausgehend von einer Stelle (`POST /api/inventory/returns`, entschieden: beides). Je Gerät `offen`/`zurueck`/`fehlt`, Zustand `in_ordnung`/`maengel`/`defekt`, Raum, Zubehör vollständig, Daten gelöscht (`PUT …/items/{id}`, sofort gespeichert). Abschließen (`POST …/complete`) erst ohne offene Geräte: zurückgegebene Geräte werden von der Stelle gelöst und ggf. in den Raum gesetzt, Geräte aus einem Verleih dort zurückgetragen (bei vollständiger Rückgabe Nachricht und Abschluss der Vorgänge wie beim Verleih); fehlende bleiben an der Stelle mit Verlaufseintrag. Arbeitsplatz-Geräte gehören nicht zur Person und sind nicht Teil der Rückgabe.
- **Abgleich mit Entra:** Auftrag `bestand.entra` jede Stunde (nur wenn die Verbindung zu Entra eingerichtet ist). Geprüft werden die Personen an Stellen und in offenen Verleihen über `GET /users/{id}` (höchstens 2000 je Lauf); ist Entra nicht erreichbar, ändert der Lauf nichts. Aktives Konto: Name und Anmeldename an Stelle und Verleih (dort auch die Mailadresse) werden nachgezogen, mit Verlaufseintrag an der Stelle bzw. an den verliehenen Geräten. Deaktiviertes oder gelöschtes Konto: Stand in `inventory_person_states` (`inactive_since`), je Stelle und offenem Verleih ein Vorgang `person_inaktiv` einmal je Zeitraum der Inaktivität. Entscheidungen: bei Stellen `frei`, `nachfolge` (neue Person, der Server liest sie aus Entra, nur aktive Konten), `lassen`; beim Verleih `geklaert`; automatisch `wieder_aktiv` (Konto wieder aktiv) und `zurueck` (Verleih vollständig zurück).
- **Statistik** (`/bestand/statistik`, `GET /api/inventory/statistics`, Rolle `Bestand.Reader` oder `Bestand.Editor`): Kennzahlen und Auswertungen über die aktiven Geräte. Filter `maker`, `kind`, `site`, `department` (jeweils ID, 0 = ohne; Standort über den Raum des Geräts, sonst über den Arbeitsplatz; Abteilung über die Stelle bzw. die Stellen des Arbeitsplatzes); die Auswahllisten zählen jeweils unter den übrigen Filtern. Kennzahlen: aktive Geräte (neu in diesem Monat), im Lager frei, verliehen und überfällig, Erneuerung fällig, Arbeitsplätze mit Lücke laut Vorlage, fehlende Angaben. Bereiche: **Überblick** (je Art, wo die Geräte sind inkl. „reserviert für einen Verleih“, Hersteller, Modelle mit „Andere“, Betriebssystem aus NinjaOne mit Hervorhebung ohne Herstellersupport: Windows 7, 8, 10, Server 2012), **Alter & Erneuerung** (Alter aus Anschaffungsdatum bzw. Baujahr; Erneuerungsbedarf je Geschäftsjahr des IT-Budgets für das laufende und die drei folgenden plus „überfällig“, nach **Nutzungsdauer je Art** in den Stammdaten, `PUT /api/inventory/kinds/{id}/lifetime`, 1 bis 20 Jahre, Migration 0063; überfällig nach Art), **Standorte & Arbeitsplätze** (je Standort, Ausstattung der Arbeitsplätze vollständig/Lücke/ohne Vorlage, freie Geräte im Lager je Art, Stellen besetzt/unbesetzt mit und ohne Hardware direkt oder über Arbeitsplätze), **Verleih** (neue Verleihe je Monat der letzten 12 Monate, am häufigsten verliehene Arten, Rückgabe pünktlich/bis 7 Tage/später/offen überfällig, durchschnittliche Dauer), **Ausmusterung** (je Jahr, Gründe und Verbleib im laufenden Jahr, bestätigte Löschung der Datenträger), **Datenqualität** (ohne Anschaffungsdatum, Raum, Modell, Inventurnummer, Seriennummer; seit 30 Tagen nicht online in NinjaOne; aus dem Zabbix-Abgleich nicht überwacht und ohne Bestandseintrag, wenn Zabbix eingerichtet ist). Oberfläche: Kennzahlen öffnen ihren Bereich (`?bereich=`), Bereiche als Reiter, je Auswertung Balken oder Tabelle, ein Klick auf einen Balken bei Art, Hersteller, Standort und freien Geräten setzt den Filter, „Drucken oder als PDF“ über die Druckansicht. Neues Feld **Anschaffungsdatum** am Gerät (ab 1990, nicht in der Zukunft), Änderung im Verlauf.
- **Ort auf den Detailseiten:** `GET /api/inventory/whereabouts/{stelle|arbeitsplatz|geraet}/{id}` liefert je Etage die Räume und Arbeitsplätze (Gerät: eigener Raum, sonst über Arbeitsplatz, sonst über die Arbeitsplätze der Stelle, mit `via`). Die Etage (`GET /floors/{id}`) liefert die gesetzten Plätze umgerechnet in Prozent der Etage, dazu für das Info-Fenster Typ, Stellen mit Person und die aktive Hardware am Arbeitsplatz und an seinen Stellen (höchstens 6, Rest als Zahl). Im Grundriss (Detailseiten und „Standorte“, nicht im Bearbeiten-Modus) sind die Plätze Schaltflächen (Treffer 24 px): Maus darüber oder Tastaturfokus zeigt das Info-Fenster, Klick öffnet den Arbeitsplatz; bei Berührung öffnet das erste Antippen das Info-Fenster, das zweite den Arbeitsplatz. Der Text steht auch als Name der Schaltfläche für Screenreader. Oberfläche: Ortszeile unter dem Titel, Reiter „Standort“ mit Grundriss, hervorgehobenen Räumen und markierten Plätzen; Stelle mit Wahl der Etage; beim Arbeitsplatz Platz setzen per Klick oder per Zahlen.
- **Benachrichtigungen:** `bestand.vorgang_neu` (Bestand.Editor) und `bestand.abgleich_fehlgeschlagen` (Bestand.Editor, Admin), nur Nummer und Link.
- **Audit:** alle Änderungen an Geräten, Stellen, Arbeitsplätzen, Standorten, Grundrissen und Stammdaten (Modul `bestand`), ohne Namen von Personen (bei Stellen nur „besetzt ja/nein“).

## 8e. Modul Tickets

Schlankes Ticketsystem, zuerst für die IT, später für weitere Abteilungen. Eigener Bereich „Tickets“ in der Navigation (`/tickets`). Tickets entstehen nur per E-Mail oder von Hand; kein Self-Service-Portal, keine Anbindung an Zabbix (vorerst). Stand: Phase T1 umgesetzt (`modules/tickets`, Migration 0064, `GET/POST /api/tickets`, `GET/PATCH /api/tickets/{nr}`, `PUT …/details`, `POST …/move`, `POST …/notes`, `/api/tickets/me`, `/api/tickets/settings…`; Aufträge `tickets.gruppen` stündlich und `tickets.wartung` stündlich: Schließen nach 5 Tagen, alter Zwischenspeicher, Protokoll nach 3 Jahren). In T1 sind „Erinnerung“ und „Zusammengeführt“ noch nicht wählbar. **T2 (E-Mail)** umgesetzt: `mailparse.py` (Einlesen, Antwort-Erkennung, Zitate, Filter, Dateitypen), `mailbox.py` (Graph mit App „Werkbank Tickets“; Zertifikat standardmäßig das der Collector-App), `inbound.py` (Auftrag `tickets.postfaecher` alle 5 Minuten), `outbound.py` (MIME mit Text und HTML, Logo per CID, Senden als Postfach über `sendMail`), `mail_api.py`; Migration 0065; Anzeige der Mails **nur als Text** (entschieden; HTML wird serverseitig in Text umgewandelt, Original als .eml), Anrede in Mails an den Melder „du“ (entschieden), „unbekannt“ = extern und noch kein Ticket im Bereich (entschieden), Mails in „Verarbeitet“/„Ignoriert“ werden endgültig gelöscht (entschieden). Test-Endpunkte `/api/tickets/test/mail` und `/api/tickets/test/outbox` nur mit Test-Login. Testquelle für Gruppen nur mit Test-Login (`/api/tickets/test/membership`, sonst 404). **T3 (Arbeitshilfen)** umgesetzt: `sla.py` (Arbeitsminuten je Bereich, Zeitzone `TICKETS_TIMEZONE`, Pause bei „Wartet auf Rückmeldung“), `work_api.py` (Zusammenführen, Geräte, Textbausteine; Einstellungen Kategorien, Fristen und Geräte, Textbausteine), Auftrag `tickets.erinnerungen` alle 5 Minuten (fällige Erinnerungen, Mail an den Melder bei verpasster Frist, falls eingeschaltet), Benachrichtigungen `tickets.neu`, `tickets.zugewiesen`, `tickets.antwort`, `tickets.erinnerung`, `tickets.frist_bald` (80 %), `tickets.frist_ueberschritten` (an die Bereichsverwaltung) über die vorhandenen Kanäle nur mit Nr. und Link; Migration 0066. „Erinnerung“ ist jetzt wählbar und braucht einen Zeitpunkt in der Zukunft (Vorgabe 08:00); sie gilt wie jeder Statuswechsel erst nach „Bestätigen“. Bei einer Übergabe an eine andere Person „Person benachrichtigen“ (Vorgabe an). Nach dem Zusammenführen bleibt das alte Ticket mit Hinweis und Link auf das Ziel; übernommene Einträge tragen „aus T-…“. Tickets zum Gerät stehen im IT-Bestand beim Reiter Verlauf; Tickets aus Bereichen, die die Person nicht sieht, nur als Anzahl. **T4 (Betrieb)** umgesetzt: `retention.py` (Vorgabe `ticket_retention`, Abweichung je Bereich, Ausnahmen je Ticket, Läufe `ticket_retention_runs`), `ops_api.py` (`GET /api/tickets/stats`, `GET /api/tickets/export`, `/settings/retention`, `/settings/areas/{id}/retention` mit Vorschau, `PUT/DELETE /api/tickets/{nr}/hold`, `GET /settings/audit`), Auftrag `tickets.aufbewahrung` täglich, Benachrichtigung `tickets.ausnahme` (30 Tage vor Ende an die Bereichsverwaltung); Migration 0067. Entschieden: Vorgabe der Aufbewahrung ist **aus**, bis die Ticket-Verwaltung sie einstellt; Anhänge und Originale werden **nicht** früher gelöscht als das Ticket; Export **nur für die Bereichsverwaltung** und nur aus ihren Bereichen, ohne Texte (Spalten: Nr., Betreff, Bereich, Status, Kategorie, Priorität, Zuständig, Melder, Mail des Melders, Eingang, Zeitpunkte, mit Fristen auch Frist und eingehalten); eine nicht bestätigte Ausnahme verfällt, das Ticket ist im selben Lauf dran. Der Export nutzt den eigenen Excel-Schreiber (`core/xlsx.py`, bisher im IT-Budget) statt `openpyxl`; Texte stehen als Inline-Text, nie als Formel. Zusammengeführte Tickets zählen ab ihrer letzten Änderung. Anonymisierte Tickets lassen sich nicht mehr ändern (409); eine Mail mit ihrer Nummer wird ein neues Ticket. Die Übersicht (`/tickets/uebersicht`) ist die Startseite des Bereichs; Die Rollen aller sichtbaren Bereiche und das Protokoll stehen im Reiter „Rollen“ der Einstellungen (Ticket-Verwaltung alles, Bereichsverwaltung ihre Bereiche). **Nach T4 (0.102.0):** Einstellungen in Reitern wie im Entwurf (`/tickets/einstellungen/<reiter>`, Bereich über `?bereich=`): Bereiche · Kategorien und Fristen · E-Mail-Eingang · E-Mail-Gestaltung (nur Ticket-Verwaltung) · Textbausteine · Aufbewahrung · Rollen. **Geräte ohne Schalter je Bereich** (entschieden; Migration 0068 entfernt `devices_enabled`, `device_kinds`, `device_suggest`, `device_in_inventory`): Gerät und Block „Im IT-Bestand“ sieht, wer Rechte im IT-Bestand hat (`Bestand.Reader` oder `Bestand.Editor`); verknüpfen darf, wer zusätzlich im Bereich „Bearbeiten“ hat; Suche über alle Arten, Geräte des Melders zuerst; Tickets beim Gerät immer (nur mit Rechten im IT-Bestand). **Melder im IT-Bestand:** Mailadresse des Melders = UPN der Person an einer Stelle (entschieden: ohne Abgleich über Entra); gezeigt werden Stellen mit Abteilung, Arbeitsplätzen und Geräten sowie offene Verleihe, nichts wird gespeichert. Umgekehrt auf der Seite der Stelle „Tickets der Person“ (`GET /api/tickets/by-position/{id}`), eigene Bereiche einzeln, fremde als Anzahl. **Melder aus Entra** beim Anlegen (`GET /api/tickets/people`, nur mit „Bearbeiten“ in einem Bereich): Auswahl übernimmt Name und Mailadresse, freie Eingabe bleibt möglich. **0.103.0:** Rolle „Nur lesen“ entfernt (entschieden; Migration 0070 löscht bestehende Einträge dieser Rolle), es gibt nur noch Bereichsverwaltung und Bearbeiten. „Gerät verknüpfen“ entfernt (entschieden; Migration 0069 löscht die Spalte `hardware_id`, bestehende Verknüpfungen gehen verloren, Verlaufseinträge bleiben); Geräte des Melders stehen weiter im Block „Im IT-Bestand“. **Antworten** nur an den Melder oder **an alle** (Beteiligte in Kopie, `reply_all`); automatische Mails gehen nur an den Melder; Empfänger stehen am Eintrag. **Weiterleiten** (`POST /api/tickets/{nr}/forward`) einer Nachricht oder der ursprünglichen Meldung aus dem Postfach des Bereichs, Betreff `WG: [#T-…] …`, Anhänge wählbar, interner Eintrag `forward`; Antworten darauf werden als „Antwort von extern“ gekennzeichnet, ändern den Status nicht und fügen keine Beteiligten hinzu; Antworten von Beteiligten heißen „von Beteiligten“. **0.149.0:** Einstellungen eines Bereichs in vier Reitern (`/tickets/einstellungen`, `/email`, `/arbeit`, `/pflege`, Bereich über `?bereich=`): **Allgemein** (Name, Postfach, Rollen des Bereichs) · **E-Mail** (1 Eingang, 2 Anhänge mit Dateitypen in Gruppen, 3 Mails an den Melder, 4 automatische Mails; ein Speichern-Knopf) · **Arbeit** (1 Kategorien, 2 Lösungsarten, 3 Fristen, 4 Textbausteine) · **Pflege** (1 Zu prüfen, 2 Sperrliste, 3 Letzte Eingänge, 4 Aufbewahrung des Tickets und Löschfristen des Eingangs). Alte Pfade (`kategorien`, `textbausteine`, `aufbewahrung`, `rollen`) werden umgeleitet. In „An“ und „Cc“ einer Antwort werden neben den Beteiligten auch Personen aus Entra vorgeschlagen (ab zwei Zeichen, `GET /api/tickets/people`, gleiche Rechte wie beim Melder). Ticketseite nach dem freigegebenen Entwurf: Kopf mit Status-Kennzeichen, Status, Zuständig, Mir zuweisen, Zusammenführen und Weiterleiten; Angaben als Karten Ticket · Melder · Im IT-Bestand · Aufbewahrung (PC rechts, Tablet und Handy als eingeklappter Block „Angaben“ mit Kurzfassung).

### Begriffe

- **Bereich (Ticket-Bereich):** eine Abteilung, z. B. „IT“ oder „Haustechnik“. Es gibt keine Warteschlangen; Zugriff, Zuweisung und Benachrichtigung hängen nur am Bereich. Nicht zu verwechseln mit den Bereichen der Navigation (IT-Bestand, IT-Budget usw.).
- **Farbe des Bereichs (0.142.0):** eine von acht festen Farben (`ticket_areas.color`: blau, petrol, violett, orange, gruen, rot, pink, grau; Migration 0090 verteilt sie auf vorhandene Bereiche der Reihe nach). Ein neuer Bereich bekommt die am wenigsten genutzte Farbe; ändern darf sie nur die Ticket-Verwaltung (`PUT /api/tickets/settings/areas/{id}`, Feld `color`, ohne Angabe unverändert). Die Liste zeigt sie als Streifen am Zeilenanfang und als Punkt neben dem Namen, darüber eine Legende; der Name steht immer dabei. `/api/tickets/me` liefert die eigene Kennung (`oid`) und die Farben der Bereiche, das einzelne Ticket die Farbe seines Bereichs.
- **Eigene Tickets und Schnellfilter (0.142.0):** In der Liste sind Tickets, für die die Person zuständig ist, hervorgehoben (getönte Zeile, fetter Betreff, „Du“). Die Auswahl „Offen“, „Mir zugewiesen“ und „Nicht zugewiesen“ zeigt die Anzahl (`GET /api/tickets/stats`, neu `unassigned` = offen ohne Zuständige, unabhängig vom Status).
- **Verlauf „Von → An“ (0.142.0):** Jeder Eintrag nennt Absender und Empfänger: Eingang Melder (bzw. Absender) → Bereich; Antwort Person (Bereich) → Melder, weitere Empfänger als CC; interne Notiz Person → Team des Bereichs; Weiterleitung Person → Empfänger mit „(extern)“. Eingänge links und weiß, Antworten rechts und blau, Notizen gelb („Interne Notiz · nur für das Team“), Weiterleitungen nach außen türkis mit gestricheltem Rand („Weitergeleitet nach außen · der Melder sieht das nicht“), Status- und Zuständigkeitswechsel als einfache Zeile.
- **Erfolge (0.143.0):** freiwillig je Person, Standard aus (Tickets › Meine Erfolge, `/tickets/erfolge`). Gezählt wird erst ab dem Einschalten (`ticket_achievement_events`, je Person, Kategorie und Anlass einmal; Migration 0091), Ausschalten löscht alles. Kategorien: Chronist (Lösung mit Beschreibung), Wissensquelle (eigene Textbausteine von anderen genutzt; `ticket_templates.created_by_oid`, Antwort und Notiz schicken `templates` mit), Staffelläufer (eigenes Ticket mit Übergabenotiz weitergegeben), Ordnungshüter (Zusammenführen), Langer Atem (gelöst, über 30 Tage offen), Brückenbauer (Antwort von außen auf die letzte Weiterleitung). Je 30 Stufen (6 Ränge mit je 5), Schwellen aus einer Kurve bis 6.000, je Kategorie gestreckt (Chronist 6.000, Wissensquelle 3.000, Staffelläufer 1.500, übrige 600). Kombis: Allrounder (Stufe, die in mindestens drei Kategorien erreicht ist), Meisterkranz je Rang (alle sechs Kategorien). Sieben Stile frei wählbar (Wappen, Neon, Fantasy, Pixel, Flach, Rangabzeichen, Sammelkarte), nur Darstellung. Vitrine mit bis zu drei erreichten Erfolgen; Sichtbarkeit „nur ich“ oder „Mitglieder meiner Bereiche“ (Ansicht auf der Ticketseite bei „Zuständig“, `GET /api/tickets/erfolge/personen/{oid}`, nur bei gemeinsamem Bereich, sonst 404; nur Gesamtstufe und Vitrine, keine Zahlen). Einblendung neuer Stufen (abschaltbar, `POST …/gesehen`). Kein geheimer Erfolg, keine Rangliste, keine Zeiten (entschieden).
- **Postfach:** genau ein freigegebenes Postfach je Bereich (z. B. `it@example.com`, `haustechnik@example.com`). Das Postfach allein entscheidet, in welchen Bereich ein Ticket kommt; Eingangsregeln gibt es nicht.
- **Melder:** wer das Anliegen gemeldet hat (Name, Mailadresse; auch extern möglich). **Beteiligte:** Personen in Kopie.

### Rollen

| Rolle | Gilt für | Technik | Darf |
|---|---|---|---|
| **Ticket-Nutzer** | Anmeldung | Verwaltung › Berechtigungen: Tickets „Nutzen“ (intern `Tickets.Nutzer`, seit 0.121.0; vorher Entra-App-Rolle) | Öffnet den Bereich Tickets. Gibt allein **keinen** Zugriff auf Tickets; den regeln die Rollen je Bereich. Wer sich anmelden darf, regelt die Zugangsgruppe in Entra (6.1a). |
| **Ticket-Verwaltung** | alle Bereiche | Verwaltung › Berechtigungen: Tickets „Verwalten“ (intern `Tickets.Verwaltung`, wirkt sofort) | Bereiche anlegen, Postfächer anbinden oder wechseln, Rollen vergeben, Vorgabe der Aufbewahrung. **Kein** Zugriff auf Tickets, außer sie ist im Bereich zusätzlich Bereichsverwaltung oder Mitglied. |
| **Bereichsverwaltung** | je Bereich | Werkbank-Datenbank (Gruppe und/oder Personen) | Einstellungen des Bereichs: Mitglieder, Kategorien, Fristen, Geräte, Textbausteine, Filter, Texte und Melder-Mails des eigenen Postfachs, Abweichung der Aufbewahrung, Ausnahmen. Sieht **alle** Tickets des Bereichs, darf jedes zuweisen und umverteilen, bekommt die Eskalationen. |
| **Bearbeiten** | je Bereich | wie oben | Tickets sehen, antworten, Status ändern, freies Ticket nehmen, eigene Tickets übergeben, interne Notizen. |

- Eine Rolle „Leitung“ gibt es nicht; das übernimmt die Bereichsverwaltung.
- **Bereichsrollen sind keine Stufen unter Verwaltung › Berechtigungen**, weil Bereiche in der Werkbank angelegt werden. Je Bereich und Rolle speichert die Werkbank eine oder mehrere Entra-Gruppen (**Objekt-ID**, Name nur zur Anzeige) und/oder einzelne Personen (Objekt-ID).
- **Prüfung serverseitig über Microsoft Graph:** `GET /users/{id}/transitiveMemberOf/microsoft.graph.group?$select=id` (auch verschachtelte Gruppen). Ergebnis je Person zwischengespeichert (`TICKETS_MEMBERSHIP_CACHE_MINUTES`, Vorgabe 5). Zusätzlich gleicht ein Auftrag die Mitglieder der Gruppen regelmäßig ab (`GET /groups/{id}/transitiveMembers`, stündlich), z. B. für „reihum“, Benachrichtigungen und die Liste der zuweisbaren Personen. Der Gruppen-Claim im Token wird **nicht** verwendet (ab 200 Gruppen unvollständig, „Overage“).
- Anwendungsberechtigung `GroupMember.Read.All` in der Collector-App (Begründung und Einrichtung in `entra-setup.md`). Personen für einzelne Einträge sucht die Werkbank wie im IT-Bestand mit `User.Read.All`.
- **Deny by default:** ohne passende Rolle kein Zugriff. Wer eine Gruppenmitgliedschaft verliert, verliert den Zugriff spätestens nach Ablauf des Zwischenspeichers. Ist Graph nicht erreichbar und der Zwischenspeicher abgelaufen, gilt die Person als nicht berechtigt.
- Hat eine Person mehrere Rollen im selben Bereich, gilt die stärkste (Bereichsverwaltung > Bearbeiten).
- Den Menüpunkt „Einstellungen“ sieht nur, wer Tickets „Verwalten“ hat oder in mindestens einem Bereich Bereichsverwaltung ist. Jeder Bereich muss immer mindestens eine Gruppe oder Person mit Bereichsverwaltung behalten.
- **Protokoll** (eigene Tabelle `ticket_audit`, Aufbewahrung 3 Jahre, zusätzlich Einträge im Audit-Log der Werkbank): jede Änderung an Einstellungen (wer, wann, welcher Bereich, was; ohne Inhalte von Texten), dazu Zuständigkeit, Status, Zusammenführen, Löschläufe und Ausnahmen.

### Sichtbarkeit

- Wer nicht Mitglied eines Bereichs ist (Bearbeiten oder Bereichsverwaltung), sieht dessen Tickets nicht: nicht in Listen, Suche, Kennzahlen, Export, Anhängen und nicht per Direktaufruf. Eine Ticket-Nr. aus einem fremden Bereich ergibt **404 „nicht gefunden“**, nicht 403.
- Jede Abfrage filtert serverseitig auf die Bereiche der Person; Anhänge und Originale werden nur über das Ticket ausgeliefert.

### Datenmodell (Überblick)

| Tabelle | Inhalt |
|---|---|
| `ticket_areas` | Name, Postfach, Absendername, Kopfzeilen-Titel, Signatur, Zuweisungsart (`first`, `round_robin`), Fristen an/aus mit Arbeitszeit, Geräte an/aus mit erlaubten Hardware-Arten und Optionen, Eingangsbestätigung mit Text, Schalter der automatischen Mails, Einstellungen des Postfachs (Abruf, externe Absender, Anhänge, Ordner, Löschfristen, Antwort auf geschlossene Tickets), Abweichung der Aufbewahrung |
| `ticket_area_grants` | Bereich, Rolle (`admin`, `edit`, `read`), Art (`group`, `person`), Objekt-ID, Anzeigename |
| `ticket_membership_cache` | Person, Liste der Gruppen-IDs, Zeitpunkt |
| `ticket_group_members` | Gruppe, Person (Objekt-ID, Name, Mail), Stand des Abgleichs |
| `ticket_categories` | Bereich, Name, Standard-Priorität, aktiv |
| `ticket_solution_types` | Bereich, Name, aktiv (Lösungsarten; Migration `0078`) |
| `ticket_sla` | Bereich, Priorität, erste Reaktion und Lösung (Arbeitsminuten) |
| `tickets` | Nr. (fortlaufend über alle Bereiche, Anzeige `T-1042`), Bereich, Betreff, Melder (Name, Mail), Kategorie, Priorität (`low`, `medium`, `high`), Status, zuständige Person, Eingangsweg (`mail`, `manual`, `phone`), angelegt, erste Reaktion, gelöst, geschlossen, Erinnerung (Zeitpunkt, Stichwort), Frist (Reaktion, Lösung, verbrauchte Zeit, eingehalten), Gerät (IT-Bestand), Zusammengeführt in, Aufbewahrungs-Ausnahme |
| `ticket_participants` | Ticket, Name, Mail |
| `ticket_entries` | Ticket, Art (`inbound`, `reply`, `note`, `system`), Text (bereinigt), Zitat-Teil, Person, Zeitpunkt, „aus T-…“, Message-ID |
| `ticket_attachments` | Eintrag, Dateiname, Typ, Größe, Ablage (Volume, außerhalb des Webroots), Original (.eml) ja/nein, entfernt (gesperrt) |
| `ticket_mail_seen` | Postfach, Message-ID, Ergebnis, Zeitpunkt (doppelte Verarbeitung ausschließen; Protokoll „Letzte Eingänge“) |
| `ticket_mail_review` | Mails unter „Zu prüfen“ (Absender, Betreff, Eingang, Graph-ID) |
| `ticket_sender_blocks` | Postfach, Adresse oder Domain |
| `ticket_templates` | Bereich, Name, Kürzel, Art (Antwort, Notiz), Status danach, Text |
| `ticket_retention` | Vorgabe: Frist (Monate), Art (`anonymize`, `delete`), Anhänge früher löschen (Monate) |
| `ticket_retention_runs` | Lauf mit Zahlen je Bereich |
| `ticket_audit` | Protokoll (siehe oben) |

### Ticket

- **Status:** Neu, In Arbeit, Wartet auf Rückmeldung, Erinnerung, Gelöst, Geschlossen, Zusammengeführt.
  - **Erinnerung:** Datum und Uhrzeit (Vorgabe 08:00), optionales Stichwort. Zum Zeitpunkt setzt der Worker das Ticket auf „In Arbeit“ und benachrichtigt die zuständige Person. Die Frist läuft weiter.
  - **Gelöst → Geschlossen:** automatisch nach 5 Tagen ohne Rückmeldung des Melders.
  - Antwort des Melders bei „Wartet auf Rückmeldung“ → „In Arbeit“.
- **Status und Zuständigkeit nur mit Bestätigung:** im Ticketkopf über Auswahlfelder; gelten erst nach „Bestätigen“, „Verwerfen“ nimmt sie zurück. Vorher eine Zusammenfassung („Status: In Arbeit → Gelöst · Zuständig: A → B“). Übergeben darf die zuständige Person oder die Bereichsverwaltung; ein freies Ticket nehmen darf jede Person mit „Bearbeiten“. Bei Übergabe optionale Übergabenotiz (wird interne Notiz) und „Person benachrichtigen“ (Push und Mail). Ungespeicherte Änderungen verfallen beim Wechsel des Tickets. Ausnahme: „Status danach“ am Senden-Knopf greift beim Senden.
- **Zuweisung neuer Tickets** je Bereich: „wer zuerst übernimmt“ oder „reihum“ (Person mit „Bearbeiten“ und den wenigsten offenen Tickets; bei Gleichstand wer am längsten kein neues Ticket bekam). „Abwesende überspringen“ entfällt (entschieden), weil dafür Lesezugriff auf die Postfach-Einstellungen aller Bearbeiter nötig wäre.
- **Verlauf:** Nachricht vom Melder, Antwort an Melder, interne Notiz, Systemeintrag (Status, Zuständigkeit, Erinnerung, Verschieben, Zusammenführen, Gerät).
- **Verschieben** in einen anderen Bereich (Bearbeiten oder Bereichsverwaltung im Quellbereich). Kategorie wird geleert, Zuständigkeit folgt der Zuweisungsart des Ziels. Wer den Zielbereich nicht sieht, verliert den Zugriff und bekommt einen Hinweis.
- **Zusammenführen:** Ziel ist ein offenes Ticket desselben Bereichs; Suche nach Nr., Betreff oder Melder (ohne Suchbegriff höchstens 3 Vorschläge mit ähnlichem Betreff, mit Suchbegriff höchstens 5 Treffer). Verlauf und Anhänge der Quelle werden zeitlich ins Ziel einsortiert und mit „aus T-…“ gekennzeichnet. Der Melder der Quelle wird Beteiligter im Ziel, optional mit Mail über die neue Nummer. Die Quelle bekommt „Zusammengeführt“ und verweist aufs Ziel; Antworten auf alte Mails der Quelle landen im Ziel. Kein Rückgängig.

### Kategorien, Fristen, Geräte (je Bereich)

- **Kategorien** mit Standard-Priorität.
- **Fristen (SLA), optional:** erste Reaktion und Lösung je Priorität, Arbeitszeit (Wochentage und Uhrzeiten; Feiertage nicht in Phase 3). Die Frist ruht bei „Wartet auf Rückmeldung“, läuft bei „Erinnerung“ weiter. Erste Reaktion = erste Antwort an den Melder. **Ist die Frist im Bereich aus, erscheint sie nirgends:** keine Spalte, kein Feld, keine Kennzahl, keine Warnung, keine Melder-Mail. Bei gemischten Listen ist das Feld bei Tickets ohne Frist leer. Warnung an die zuständige Person bei 80 %, Eskalation an die Bereichsverwaltung bei Überschreitung.
- **Geräte, optional:** erlaubte Hardware-Arten aus dem IT-Bestand (keine eigene Typenliste). Optionen „Geräte des Melders zuerst vorschlagen“ (über die Mailadresse: Stelle bzw. offener Verleih im IT-Bestand) und „Ticket auch beim Gerät im IT-Bestand anzeigen“ (dort nur Nr., Betreff, Status und Link – für Personen mit Zugriff auf den Bereich; sonst nur die Anzahl). Suche höchstens 5 Treffer, Gerät lässt sich lösen.

### E-Mail-Eingang (je Postfach)

- **Anbindung über Microsoft Graph** mit eigener App-Registrierung „Werkbank Tickets“, Anmeldung per Zertifikat. Anwendungsberechtigungen `Mail.ReadWrite` (lesen, verschieben, löschen in den eigenen Ordnern) und `Mail.Send` (senden als Postfach). `GroupMember.Read.All` für die Prüfung der Bereichsrollen bekommt die vorhandene Collector-App (sie hat bereits `User.Read.All` für die Personensuche). In Exchange Online auf die Ticket-Postfächer beschränkt (RBAC für Anwendungen: Verwaltungsbereich über eine Gruppe der Ticket-Postfächer, Rollen „Application Mail.ReadWrite“ und „Application Mail.Send“). Einrichtung in `entra-setup.md`.
- **Abruf alle 5 Minuten** (Auftrag `tickets.postfaecher`). Graph-Änderungsbenachrichtigungen (Webhook) entfallen (entschieden), weil sie eine aus dem Internet erreichbare Adresse bräuchten.
- **Neue Mail → neues Ticket.** Antworten über `[#T-1042]` im Betreff, zusätzlich über `In-Reply-To` und `References` (gespeicherte Message-IDs). Personen in Kopie werden Beteiligte (ohne das eigene Postfach).
- **Externe Absender** (extern = Domain nicht in `TICKETS_INTERNAL_DOMAINS`): annehmen, unbekannte erst prüfen („Zu prüfen“ mit „Als Ticket anlegen“, „Verwerfen“, „Absender sperren“) oder ablehnen.
- **Ausfiltern:** Abwesenheitsnotizen und Unzustellbarkeitsberichte (`Auto-Submitted`, `X-Auto-Response-Suppress`, `Content-Type: multipart/report`, typische Absender), Newsletter (`List-Unsubscribe`, `Precedence: bulk/list`), Schleifenschutz (höchstens 10 Mails je Absender und Stunde), Sperrliste.
- **Eingebettete Bilder** (Content-ID, z. B. in Outlook-Mails im HTML-Teil) werden wie Anhänge geprüft und abgelegt und in der Reihenfolge der Mail nummeriert (`inline_number`, Migration 0079); ihre Stelle im Text wird zu „[Bild n]“, unbekannte Verweise zu „[Bild]“. Im Verlauf stehen sie unter „Bilder in der Nachricht“, „[Bild n]“ im Text öffnet das Bild groß (blättern über alle Bilder der Nachricht).
- **Anhänge:** Größengrenze und **Positivliste** der Dateitypen je Postfach (Vorgabe: PDF, PNG, JPG, GIF, WebP, Word, Excel, PowerPoint als Office-Open-XML, TXT, CSV, EML, MSG, ZIP); Typ über den Inhalt geprüft, nicht nur über die Endung. Nicht erlaubte Anhänge werden entfernt, im Ticket steht ein Hinweis.
- **Nach der Verarbeitung:** verarbeitet → Ordner „Verarbeitet“, ignoriert → „Ignoriert“; die Werkbank löscht dort nach 30 bzw. 7 Tagen (je Postfach einstellbar). „Zu prüfen“ bleibt im Posteingang. Alles im Posteingang gilt als unverarbeitet; eine zurückgezogene Mail wird erneut verarbeitet, die gespeicherte Message-ID verhindert ein doppeltes Ticket (dann nur Ablage). Das Original (.eml) bleibt am Ticket.
- **Protokoll „Letzte Eingänge“** je Postfach: Zeitpunkt, Absender, Betreff, Ergebnis (neues Ticket, Antwort zu T-…, zu prüfen, ignoriert mit Grund, Fehler). Einträge ohne Ticket löscht der stündliche Wartungslauf nach `intake_log_days` (je Bereich, Vorgabe 90, 7 bis 3650); Einträge zu einem Ticket gehen mit dessen Aufbewahrung.
- **„Zu prüfen“:** Neue Einträge melden sich bei der Bereichsverwaltung (`tickets.pruefen`, nur Bereich und Link). Ohne Entscheidung verwirft der Abruf sie nach `review_days` (je Bereich, Vorgabe 30, 1 bis 365): erst in „Ignoriert“ verschieben, dann löschen; klappt das Verschieben nicht, bleibt der Eintrag. Protokoll `pruefen_verfallen`.
- **Antwort auf ein geschlossenes Ticket:** wieder öffnen innerhalb von X Tagen (Vorgabe 14), danach neues Ticket mit Verweis; immer wieder öffnen; immer neues Ticket.
- **Nur der neue Teil:** Beim Einlesen von Antworten übernimmt die Werkbank nur den Text oberhalb der Zeile „Bitte antworte oberhalb dieser Zeile.“ bzw. vor erkannten Zitaten (`>`, „Am … schrieb …“, „Von: … Gesendet: …“, Outlook-Trennlinie). Der Rest wird als eingeklapptes Zitat gespeichert.

### Mails an den Melder

- Absender ist immer das Postfach des Bereichs (Graph `sendMail` als Postfach). Betreff `[#{Nr}] {Betreff}`. Antworten haben seit 0.148 Felder **An** und **Cc** wie im Mailprogramm (`MailRecipients`): „Antworten“ belegt An mit dem Melder, „Antworten an alle“ zusätzlich Cc mit allen Beteiligten; danach frei änderbar (Melder darf aus An heraus, mindestens eine Adresse in An, kein Bcc, höchstens 20 je Feld, Postfächer der Ticket-Bereiche nie). Neue Adressen werden Beteiligte. Gespeichert am Eintrag: `recipients` = An, `recipients_cc` = Cc (ältere Einträge: NULL, dann Melder als An, Rest als Kopie). API: `POST …/replies` mit `to` und `cc`; ohne `to` gilt die ältere Form (Melder, mit `reply_all` Beteiligte in Kopie). Automatische Mails gehen nur an den Melder. Icons wie im Mailprogramm: Pfeil zurück (Antworten), Doppelpfeil (an alle), Pfeil nach vorn (Weiterleiten), Notizblatt mit Schloss (interne Notiz).
- **Eingangsbestätigung** optional, eigener Text je Bereich, Platzhalter {Nr}, {Betreff}, {Name}.
- **Automatische Mails** je Bereich: In Arbeit (aus), Wechsel der Zuständigkeit (aus), Wartet auf Rückmeldung (an, zusammen mit der Rückfrage), Gelöst (an), Geschlossen (aus), Frist nicht eingehalten (aus; nur sichtbar bei Bereichen mit Fristen).
- **Gestaltung:** wie alle Mails der Werkbank aus dem Branding der Plattform (`core/mail_layout.py`, Verwaltung › Allgemein): Logo (eigenes PNG für Mails, sonst das helle Logo, wenn PNG), Name, Linie in der Akzentfarbe, Fußzeile und Datenschutz-Link (beides freiwillig, Link nur https). Je Bereich Absendername, Titel der Kopfzeile und Signatur. Unter dem Text ein Kasten mit Ticketnummer, Betreff und Status in Worten für den Melder (bei einer Antwort mit „Status danach“ der neue Status) und „Bearbeitet von“ (wer antwortet, bei automatischen Mails die zuständige Person, wenn vergeben). Bei einer Antwort steht über dem Text „{Name} schreibt“ (entschieden: Variante B, der Absender bleibt das Postfach des Bereichs). Fußzeile beginnt mit „{Titel} · Fragen oder Ergänzungen? Antworte einfach auf diese Mail.“; in Mails an Melder kommt die Werkbank nicht vor, Melder melden sich nie an. Weiterleitungen gehen im selben Aussehen raus (Text, Signatur, weitergeleitete Nachricht als Kasten, Fußzeile „Antworten auf diese Mail landen direkt bei uns.“). Die frühere eigene Gestaltung der Ticket-Mails ist entfallen (Migration `0077` übernimmt Fußzeile, Datenschutz-Link und Logo ins Branding, wenn dort noch nichts steht).
- **Technik:** HTML mit Tabellenlayout und Inline-CSS, immer zusätzlich Text; Logo per CID eingebettet; keine Zählpixel, keine externen Ressourcen; lesbar im dunklen Modus. Oben „Bitte antworte oberhalb dieser Zeile.“. Platzhalter werden beim Einsetzen escaped.

### Textbausteine (je Bereich)

- Name, Kürzel (`/kürzel` im Antwortfeld), Art (Antwort, interne Notiz), Status danach (unverändert, Wartet auf Rückmeldung, Gelöst), Text. Platzhalter {Vorname}, {Name}, {Nr}, {Betreff}, {Bearbeiter}, {Datum}. Vorschau mit Signatur. Nur gemeinsame Bausteine.

### Aufbewahrung

- Vorgabe für alle Bereiche (Ticket-Verwaltung), Abweichung je Bereich (Bereichsverwaltung).
- Frist in Monaten oder Jahren ab dem Schließen; nach Wiederöffnen beginnt sie neu. Danach **anonymisieren** (entfernt Melder, Adressen, Betreff, Texte, Anhänge, Namen der Bearbeiter; erhalten bleiben Nr., Bereich, Kategorie, Priorität, Zeitpunkte und ob die Frist eingehalten wurde) oder **vollständig löschen**.
- Anhänge und Originale optional früher löschen (z. B. nach 12 Monaten). Entschieden: nicht umgesetzt, Dateien bleiben bis zur Frist des Tickets.
- Ausnahmen je Ticket durch die Bereichsverwaltung mit Begründung; jährlich zu bestätigen, sonst verfällt sie (Hinweis 30 Tage vorher).
- Täglicher Auftrag `tickets.aufbewahrung` mit Vorschau „Beim nächsten Lauf betroffen“ und Protokoll der Läufe.

### Benachrichtigungen an Mitarbeitende

Über die vorhandenen Kanäle (Glocke, Mail, Teams, Push; 6.7), ohne fachliche Inhalte (nur Nr. und Link): neues freies Ticket im Bereich (Bearbeiten), Ticket zugewiesen bzw. übergeben, Antwort des Melders auf eigenes Ticket, Erinnerung fällig, Frist bald erreicht (zuständige Person), Frist überschritten (Bereichsverwaltung).

### Oberfläche

- **Menü „Tickets“** (umgesetzt, Einstellungen als Reiter einer Seite): Übersicht (Kennzahlen, „Mir zugewiesen“, „Neu und nicht zugewiesen“, Eingang nach Kanal, offen nach Kategorie) · Alle Tickets (Suche; Filter Offen, Mir zugewiesen, Nicht zugewiesen, Wartet, Erinnerung, Gelöst und geschlossen, Alle; nach Bereich; Export als Excel, nur Bereichsverwaltung) · Neues Ticket (Bereich wählen, dann Kategorien), darunter die Gruppen **Favoriten** und **Geöffnet** (0.124.0, siehe unten) · Einstellungen (ab 0.149.0: Bereich wählen, dann Reiter Allgemein · E-Mail · Arbeit · Pflege; „Bereiche verwalten“ unter `/tickets/einstellungen/bereiche` mit neuem Bereich, allen Bereichen, Standard-Aufbewahrung, Rollenübersicht und Protokoll).
- **Leiste „Favoriten“ und „Geöffnet“** (0.124.0, entschieden): je Person gespeichert (`ticket_recent`, `ticket_nav_prefs`, Migration 0084), auf allen Geräten gleich; am Handy im Menü-Blatt. Ein geöffnetes Ticket kommt hinten dazu, die Reihenfolge bleibt (kein Nach-vorn-Holen). Stern = Favorit (eigene Gruppe oben, zählt nicht zur Höchstzahl), X nimmt aus der Liste, „Liste leeren“ (mit Bestätigung) entfernt alle ohne Stern. Höchstzahl 5, 10, 15 (Vorgabe) oder 25, darüber fällt das älteste ohne Stern heraus; Ansicht kompakt (Status als Punkt mit Legende, ausgeschrieben für Screenreader und beim Darüberfahren) oder normal (Status ausgeschrieben); beides unter Konto › Tickets. Der Server zeigt nur Tickets, die die Person gerade sehen darf (`/api/tickets/leiste`). Beide Gruppen lassen sich auf- und zuklappen (je Browser gemerkt).
- **Ticket öffnen** springt zur letzten Mitteilung im Verlauf (Systemeinträge zählen nicht), nicht bei einem Sprungziel in der Adresse.
- **Antworten per Mail**: Bilder, die einem Logo aus dem Branding entsprechen, und eingebettete Bilder, die nur im Zitat stehen, werden nicht als Anhang übernommen (bleiben in der Original-Mail).
- **Lösung bei „Gelöst“** (0.115.0): Beim Wechsel auf „Gelöst“ (`PATCH /api/tickets/{nr}` mit `solution`, oder Antwort mit `status_after: solved` und `solution`) freiwillig Lösungsart (je Bereich, `/api/tickets/settings/areas/{id}/solution-types`, Bereichsverwaltung) und Lösungstext (höchstens 2000 Zeichen) sowie `public` (Vorgabe an): ob beides in der Mail an den Melder steht (Zeilen „Lösungsart“ und „Lösung“ im Kasten). Am Ticket `solution_type_id`, `solution_text`, `solution_public`; Systemeintrag im Verlauf. Bei einem neuen Wechsel auf „Gelöst“ wird die Lösung neu gesetzt. Übersicht: „Gelöst nach Lösungsart“ (30 Tage). Beim Anonymisieren wird der Lösungstext gelöscht, die Art bleibt.
- **Ticketseite** für lange Verläufe:
  - Kompakter fester Kopf: Zurück, Nr., gekürzter Betreff, Status, Zuständig, „Mir zuweisen“, Melder, Eingangsweg, Datum, Bestätigen/Verwerfen.
  - Verlauf: ursprüngliche Meldung oben, dann „N ältere Einträge anzeigen“, dann die letzten 4 Einträge. Systemeinträge einzeilig und klein. Filter Alles · Nur Nachrichten · Nur intern. Lange Nachrichten gekürzt („Ganze Nachricht anzeigen“), Zitate eingeklappt. Markierung „vom Melder“, „an Melder gesendet“, „Intern“, „Anruf erfasst“ (Text und Symbol, nie nur Farbe).
  - Antwortfeld unten festgehalten, eingeklappt als „Antwort an … schreiben“ und „Interne Notiz schreiben“. Antwort: blau, Briefsymbol, „Geht per E-Mail an: … (Kopie an …)“, Knopf „An … senden“. Notiz: gelb, Schlosssymbol, „… sieht diesen Text nicht und bekommt keine Mail“, Knopf „Interne Notiz speichern“. Entwurf bleibt beim Einklappen.
  - Rechte Spalte, bleibt beim Scrollen stehen: Angaben ohne Überschrift (Bereich zum Verschieben, Priorität, Kategorie, Frist nur mit SLA, Beteiligte); „Gerät“ einklappbar, nur wenn im Bereich aktiviert. Auf dem Handy unter dem Kopf als einklappbarer Block.
- Rückmeldungen über `components/Feedback.tsx`, Aktionen mit Folgen über `ConfirmDialog`, Info-Symbole und Handbuchkapitel „Tickets“.

### Sicherheit (OWASP ASVS 5.0 L2)

- **Mail-Inhalte gelten als feindlich.** HTML wird serverseitig in reinen Text umgewandelt (entschieden: keine HTML-Darstellung, kein Zusatzpaket); Skripte, Formulare, Stile und externe Ressourcen fallen damit weg, Bilder werden nicht nachgeladen. Das Original gibt es nur als Download (.eml).
- **Anhänge:** Typ über den Inhalt, Größenlimit, Download mit `Content-Disposition: attachment` und `X-Content-Type-Options: nosniff`, Ablage im Volume außerhalb des Webroots, Zugriff nur über das Ticket mit Bereichsprüfung. **Vorschau (0.116.0):** Bilder (PNG, JPEG, GIF, WebP) und PDF mit `?view=true` im Browser (`inline`, `nosniff`, `no-store`), nur wenn der Dateianfang zum gespeicherten Typ passt; Bilder mit `Content-Security-Policy: default-src 'none'; sandbox`, PDF ohne Sandbox (sonst zeigt der Browser seine PDF-Ansicht nicht), aber mit `default-src 'none'`. Textdateien (TXT, CSV, EML, auch die Original-Mail) über `GET …/attachments/{id}/text` als Auszug der ersten 200 KB, dargestellt nur als Text. Office-Dateien, ZIP und MSG nur zum Herunterladen. Protokolliert werden Download, PDF und Text, nicht das Ansehen von Bildern (die Vorschaubilder laden bei jedem Öffnen des Tickets).
- **Rechte** für jeden Endpunkt und jede Aktion serverseitig (Stufe aus den Berechtigungen der Werkbank, je Anfrage gelesen; Bereichsrolle über die zwischengespeicherte Graph-Prüfung), auch für Export, Suche und Anhänge. Fremde Tickets 404. Anhänge und Einträge über zufällige IDs (UUID).
- **Kein eingehender Webhook:** Die Werkbank holt Mails selbst ab; es gibt keinen von außen erreichbaren Endpunkt für Graph.
- **Ausgehende Mails** nur über das Postfach des Bereichs; Platzhalter escaped; Kopfzeilen gegen Zeilenumbrüche geschützt.
- **Protokoll** wie oben; Exporte im Audit-Log.

### Datenschutz

Neu verarbeitet werden Melder und Beteiligte (Name, Mailadresse, auch extern), Inhalte der Mails und Anhänge, Bearbeiter. Zweckbindung: Bearbeitung von Anliegen. Löschung über die Aufbewahrung; Mails im Postfach nach 30/7 Tagen. Ergänzung in `datenschutz.md`.

### Phasen

| Phase | Inhalt |
|---|---|
| T1 Grundgerüst | Datenmodell, Bereiche, Rollen (Ticket-Verwaltung, Bereichsverwaltung, Bearbeiten, Nur lesen) mit Graph-Prüfung, Ticket von Hand anlegen, Liste, Ticketseite, Status und Zuständigkeit mit Bestätigung, Verlauf, interne Notizen |
| T2 E-Mail | Postfach-Anbindung, Eingang, Antwort-Erkennung, Filter, „Zu prüfen“, Ordner und Löschfristen, Antworten senden, Mails an den Melder |
| T3 Arbeitshilfen | Kategorien, Fristen (optional), Geräte (optional), Textbausteine, Erinnerung, Zusammenführen, Übergabe |
| T4 Betrieb | Rollen-Seite mit Protokoll, Aufbewahrung mit täglichem Lauf, Kennzahlen, Export, Handbuchkapitel |

Nach jeder Phase ein Halt mit Zusammenfassung, Testergebnis und Entwurf der Neuigkeiten.

### Tests

- **E2E:** Mail → Ticket; Antwort im selben Ticket; Mail an geschlossenes Ticket je nach Einstellung; Status und Übergabe erst nach „Bestätigen“; fremder Bereich unsichtbar, auch per Direktaufruf; ohne App-Rolle keine Einstellungen der Ticket-Verwaltung; Zugriff weg nach Entzug der Gruppenmitgliedschaft; interne Notiz erzeugt keine Mail; Zusammenführen; ohne SLA nirgends eine Frist; Aufbewahrungslauf anonymisiert bzw. löscht. Graph wird in den E2E-Tests durch einen Stub ersetzt.
- **Unit:** Antwort-Erkennung, Filter, Zitat-Erkennung, Platzhalter, Fristberechnung (Arbeitszeit, Pause bei „Wartet“).

## 8f. Modul Dokumentation

Seiten wie in Microsoft Loop: Arbeitsbereiche mit Seiten und Unterseiten, gleichzeitiges Bearbeiten, Versionen, Rechte je Seite. Eigener Bereich „Doku“ in der Bereichsleiste (`/doku`); statt der Liste aus der Navigation steht im Seitenmenü der Seitenbaum (Suche, „Neue Seite“, Arbeitsbereiche mit Seiten, Schloss bei eigenen Rechten, für die Doku-Verwaltung „Arbeitsbereiche“). Am Handy öffnet „Seiten“ den Baum als Blatt.

Umsetzung in vier Phasen mit Halt nach jeder Phase (entschieden): **D1** Arbeitsbereiche, Seitenbaum, Rechte, Bausteine, automatisches Speichern, Versionen, Sperren, Papierkorb, Verwaltung · **D2** gleichzeitiges Bearbeiten in Echtzeit (Yjs mit Tiptap im Browser, pycrdt im Server, WebSocket) mit Anwesenheit · **D3** Kommentare, Verweise auf Objekte der Werkbank, Live-Bausteine · **D4** Lese-Links für Externe (zeitlich begrenzt, Kennwort freiwillig, sonst zufällige Adresse), Export als PDF und Markdown. Stand: **D1 umgesetzt** (0.118.0, `modules/doku`, Migration 0080), **D2 umgesetzt** (0.119.0, `collab.py`, `ydoc.py`, Migration 0081), **D3 umgesetzt** (0.123.0, `d3_api.py`, `refs.py`, Migration 0083).

**Gemeinsam bearbeiten (D2)**: Jede geöffnete Seite verbindet sich über WebSocket mit `/api/doku/live/{id}` (Protokoll von `y-websocket`: Synchronisation und Anwesenheit). Im Browser Yjs mit Tiptap (`@tiptap/extension-collaboration`, Cursor anderer Personen mit Namen über `@tiptap/extension-collaboration-caret`), im Server pycrdt (MIT). Der Server hält je offener Seite ein gemeinsames Dokument im Speicher (ein Prozess), verteilt Änderungen und speichert 2 Sekunden nach der letzten Änderung und wenn die letzte Person geht: den Stand des gemeinsamen Dokuments (`doku_pages.ystate`) und daraus das JSON des Editors, geprüft mit derselben Positivliste wie beim Speichern über die API. Ist der Inhalt nicht erlaubt, speichert der Server nichts und alle laden neu (Code 4001).
- Anmeldung über das Sitzungs-Cookie; die Herkunft (`Origin`) muss die der Werkbank sein, sonst Trennen mit 4403. Rechte beim Verbinden: Wer nur lesen darf, eine gesperrte Seite oder einen archivierten Arbeitsbereich offen hat, bekommt Änderungen live mit; seine eigenen nimmt der Server nicht an. Ändern sich Sperre, Rechte, Personen oder Archiv, trennt der Server die Seiten (4001) und alle verbinden sich mit den neuen Rechten neu.
- Anwesenheit („Gerade auf der Seite“, Cursor): den Namen setzt der Server aus der Sitzung, nicht der Browser. Kein Abgleich zwischen Tabs über BroadcastChannel (Rechte prüft nur der Server).
- Grenzen: Nachricht höchstens 2 MB, höchstens 50 Verbindungen je Seite.
- Wiederherstellen einer Version und Speichern des ganzen Inhalts über die API speichern zuerst offene Live-Änderungen bzw. bauen das gemeinsame Dokument neu aus dem JSON auf; Verbundene laden neu. „Rückgängig“ nimmt nur eigene Änderungen zurück. Der Titel wird weiter über die API gespeichert.
- Versionen wie in D1: Wer seit der letzten Version live geändert hat, steht bei der nächsten Version.

**Kommentare (D3)**: an markierten Textstellen; wer die Seite lesen darf, darf kommentieren (nicht in archivierten Arbeitsbereichen). Die Stelle wird als relative Position des gemeinsamen Yjs-Dokuments gespeichert (`doku_threads.anchor`, Anfang und Ende), nicht im Inhalt der Seite; so bleibt sie beim Bearbeiten richtig und Lesende ändern die Seite nicht. Dazu ein Zitat (höchstens 300 Zeichen) für die Liste und falls die Stelle gelöscht wurde. Antworten im selben Faden, „Erledigt“ und „Wieder öffnen“ durch jede Person mit Leserecht, Löschen nur eigener Kommentare (mit Bestätigung; der letzte Kommentar löscht den Faden).
- **Erwähnungen** mit `@`: Vorschläge sind Personen, die die Seite lesen dürfen und sich schon einmal angemeldet haben (höchstens 10). Der Server prüft beim Speichern das Leserecht jeder erwähnten Person erneut.
- **Benachrichtigungen** über den Auftrag der Benachrichtigungen: `doku.erwaehnung` (erwähnt) und `doku.antwort` (Antwort in einem eigenen oder beantworteten Faden); Titel ohne Inhalt, Link auf die Seite mit `?kommentar=`. Nur solange die Person die Seite lesen darf.
- Oberfläche: Spalte „Kommentare“ rechts (Desktop), auf Tablet und Handy Knopf „Kommentare · n“ mit Blatt. Markierte Stellen gelb, Klick öffnet den Faden. Neue Kommentare anderer alle 30 Sekunden und beim Zurückkehren in den Tab.

**Verweise und Live-Bausteine (D3)**:
- **Verweis** (Inline-Baustein `werkbankRef`, „#“ in der Werkzeugleiste oder „+ Baustein“): auf Ticket, Gerät, Stelle, Arbeitsplatz, Raum, IT-Projekt oder Vertrag. Im Inhalt stehen nur Art und Nummer, nie Titel oder Status. Titel und Status löst der Server je lesender Person auf (`POST /api/doku/refs/resolve`) nach den Rechten des jeweiligen Bereichs (Tickets: Bereiche der Person; IT-Bestand, IT-Projekte, IT-Budget: deren Rollen). Ohne Recht steht „Kein Zugriff“ ohne jede Angabe zum Objekt.
- **Live-Bausteine** (Block `liveBlock`): Ticketliste (Bereich, offen oder alle, Suchbegriff), Geräteliste (Etage, Raum, Geräteart), Projektstand (Fortschritt der Aufgaben) und Vertragsfristen (Kündigungsfristen der nächsten 3, 6 oder 12 Monate). Einstellungen stehen im Inhalt, die Daten holt jede Person mit ihren Rechten (`POST /api/doku/live-bausteine/daten`, höchstens 20 Einträge), neu alle 60 Sekunden. Ohne Recht: „Du hast keine Rechte für diese Angaben.“
- **Rückverweise** „In der Dokumentation“ auf Ticket, Gerät, Stelle, Arbeitsplatz, IT-Projekt und Vertrag (`GET /api/doku/backlinks`, entschieden): nur für Personen, die die Doku nutzen dürfen, und nur Seiten, die sie lesen dürfen (Prüfung je Seite wie beim Öffnen). Gefunden über Verweise und Projekt-Live-Bausteine im Inhalt (Postgres `jsonb_path_exists`). Seiten im Papierkorb zählen nicht.

**Rollen und Rechte** (entschieden):
- Verwaltung › Berechtigungen: Dokumentation „Nutzen“ (Bereich öffnen, intern `Doku.Nutzer`) und „Verwalten“ (Verwaltung, intern `Doku.Admin`). Inhalte sieht auch „Verwalten“ nur als Mitglied eines Arbeitsbereichs; in der Verwaltung stehen nur Titel.
- **Arbeitsbereich**: Personen einzeln aus Entra (entschieden, keine Gruppen) mit **Lesen**, **Bearbeiten** oder **Verwalten** (= Bearbeiten und die Personen des Arbeitsbereichs ändern, im Dialog „Rechte und Teilen“). Betriebsrat und Geschäftsführung bekommen keinen automatischen Lesezugriff.
- **Eigene Rechte einer Seite** (Schloss im Seitenbaum): darf jede Person setzen, die die Seite bearbeiten darf. Sie gelten für die Seite und ihre Unterseiten, bis eine Unterseite eigene hat. Je Person überschreibt ein Eintrag das Recht aus dem Arbeitsbereich (Lesen, Bearbeiten, **Kein Zugriff**); Personen ohne Eintrag behalten ihr Recht aus dem Arbeitsbereich. Personen außerhalb des Arbeitsbereichs lassen sich hinzufügen und sehen dann nur diese Seiten. Gespeichert werden nur Abweichungen.
- Archivierte Arbeitsbereiche sind nur lesbar und stehen im Baum mit „Archiv“. Löschen nur leerer Arbeitsbereiche (auch ohne Seiten im Papierkorb).
- Alle Prüfungen im Server; fremde oder nicht sichtbare Seiten ergeben 404, Lesen ohne Schreibrecht 403. Ist die Seite darüber nicht sichtbar, hängt die Seite oben im Arbeitsbereich.

**Seiten und Inhalt**:
- Editor Tiptap (ProseMirror, MIT). Inhalt als JSON des Editors, **nie HTML**. Der Server nimmt nur bekannte Bausteine an (Positivliste in `content.py`): Absatz, Überschrift 1–3, Listen, Aufgabenliste, Zitat, Code, Trennlinie, Tabelle, Hinweis- und Warnkasten; Auszeichnungen fett, kursiv, unterstrichen, durchgestrichen, Code, Link (nur `https://`, `mailto:` und Pfade der Werkbank, Ziel und `rel` fest). Grenzen: 40 Ebenen, 60.000 Bausteine, 200.000 Zeichen Text; unbekannte Eigenschaften fallen weg, unbekannte Bausteine ergeben 422.
- **Codeblöcke** (seit 0.146): Sprache je Block (`codeBlock.language`), Auswahl beim Bearbeiten oben am Block: Text (Standard, einfarbig, keine automatische Erkennung), Bash/Shell, PowerShell, Python, JSON, YAML, XML/HTML, SQL, INI/Config, Dockerfile, Nginx, JavaScript, CSS, Markdown, Diff. Hervorhebung im Browser mit `@tiptap/extension-code-block-lowlight`, `lowlight` (MIT) und den Sprachdateien von `highlight.js` (BSD-3), nur die genannten Sprachen; Farben über Klassen (`hljs-*`, CSP ohne `style`), hell und dunkel mit Kontrast ≥ 4,5:1. Beim Lesen zeigt die Leiste die Sprache und „Kopieren“ (Zwischenablage; geht das nicht, Hinweis zum selbst Markieren). Unbekannte Sprachen aus älteren Inhalten gelten als Text.
- Bausteine über „+ Baustein“ oder „/“ in einer leeren Zeile; Löschen ohne Bestätigungsdialog, zurück mit „Rückgängig“ (entschieden).
- Live-Baustein, Verweis und Tabelle öffnen ein Fenster in der Mitte (am Handy Blatt von unten, `BlockDialog`), seit 0.147: Titel und Knöpfe bleiben stehen, nur der Inhalt scrollt; Live-Baustein und Verweis mit fester Höhe, die vier Arten des Live-Bausteins fest im 2×2-Raster. Esc und Klick daneben schließen, danach steht die Schreibmarke wieder an der alten Stelle. Das Bausteinmenü („/“) bleibt an der Schreibmarke.
- **Automatisch speichern**: Inhalt seit D2 über die Live-Bearbeitung; der Titel 1,2 Sekunden nach der letzten Eingabe über `PUT /api/doku/pages/{id}`. Ganzer Inhalt über die API nur mit passender `revision` (sonst 409).
- **Sperren** (`POST/DELETE …/lock`): jede Person mit Bearbeiten darf sperren und entsperren (entschieden); gesperrt lässt sich nichts ändern, verschieben oder löschen.
- Suche über Titel und Text (`GET /api/doku/search`), nur sichtbare Seiten.

**Versionen**: nach der eingestellten Bearbeitungszeit (5, 10 oder 30 Minuten, Vorgabe 10) entsteht beim Speichern eine Version; der Auftrag `doku.versionen` (alle 5 Minuten) legt sie auch an, wenn danach niemand mehr speichert. „Aktuellen Stand benennen“; benannte bleiben immer. Ansehen nur lesend, „Wiederherstellen“ mit Bestätigung und freiwilligem Grund; der Stand davor bleibt als Version. Automatische Versionen: 1 Jahr (danach bleibt je Tag die jüngste) oder immer (Auftrag `doku.aufraeumen` täglich).

**Verschieben** (0.125.0, `POST /api/doku/pages/{id}/move`): Knopf „Verschieben“ rechts unter „Seite“ (Bearbeiten, nicht gesperrt, nicht archiviert) öffnet einen Dialog mit neuem Platz im selben Arbeitsbereich (oben nur mit Bearbeiten im Arbeitsbereich, sonst unter einer Seite mit Bearbeiten; die Seite selbst und ihre Unterseiten stehen nicht zur Wahl) und der Reihenfolge („Am Ende“ oder „Vor …“). Unterseiten wandern mit. Ohne Bestätigungsdialog, weil sich jede Verschiebung zurückschieben lässt; der Dialog selbst ist die Bestätigung. Ziehen im Seitenbaum gibt es nicht (Bedienung mit Tastatur und am Handy gleich).

**Papierkorb**: Löschen (mit Bestätigung) legt die Seite mit Unterseiten in den Papierkorb; die Doku-Verwaltung stellt wieder her oder löscht endgültig (mit Bestätigung); nach 30 Tagen löscht der Auftrag `doku.aufraeumen` endgültig.

**Verwaltung** (`/doku/verwaltung`, Reiter Arbeitsbereiche · Seiten mit eigenen Rechten · Versionen · Papierkorb; Lese-Links mit D4).

**Schnittstellen**: `GET /api/doku/me`, `GET /api/doku/tree`, `GET /api/doku/search`, `POST /api/doku/pages`, `GET/PUT/DELETE /api/doku/pages/{id}`, `POST …/move`, `POST/DELETE …/lock`, `GET/POST …/versions`, `GET …/versions/{v}`, `POST …/versions/{v}/restore`, `GET/PUT …/rights`, `PUT /api/doku/spaces/{id}/members`, `GET /api/doku/people`; Verwaltung `/api/doku/admin/spaces`, `/own-rights`, `/pages/{id}/reset-rights`, `/settings`, `/trash`.

**Tabellen**: `doku_spaces`, `doku_space_members`, `doku_pages`, `doku_page_rights`, `doku_versions`; Einstellungen unter `app_settings` (`doku`). Audit (Modul `doku`): Anlegen und Löschen von Seiten, Sperren, Rechte, Wiederherstellen, Arbeitsbereiche, Einstellungen, Papierkorb.

## 9. Datenmodell (Überblick)

Kern:

| Tabelle | Wichtige Felder |
|---|---|
| `users` | id, entra_oid, anzeigename, mail, zuletzt_angemeldet, push_aktiv |
| `sessions` | id, user_id, erstellt, zuletzt_aktiv, ablauf, step_up_zeit |
| `modules` | key, name, aktiv, version |
| `tasks` | id, module, objekt_typ, objekt_id, titel, untertitel, rolle, user_id?, faellig, erledigt |
| `comments` | id, objekt_typ, objekt_id, user_id, text, zeitpunkt |
| `attachments` | id, objekt_typ, objekt_id, dateiname, mime, groesse, sha256, speicherpfad, user_id, zeitpunkt |
| `audit_log` | id, zeitpunkt, user_id, module, aktion, objekt_typ, objekt_id, ergebnis, ip_gekuerzt, details (JSONB) |
| `comment_rules` | id, module, kontext, bedingung, pflicht, muster |
| `notification_rules` | id, module, ereignis, kanal, ziel |
| `push_subscriptions` | id, user_id, endpoint, keys, erstellt |
| `jobs` | id, typ, status (geplant, laeuft, fertig, fehler), daten (JSONB), geplant, gestartet, beendet, versuche, fehler |
| `connectors` | key, typ, status, letzter_erfolg, letzter_fehler, zertifikat_ablauf |

M365-Konfiguration:

| Tabelle | Wichtige Felder |
|---|---|
| `cfg_snapshots` | id, start, ende, status, quellen_status (JSONB), anzahl_aenderungen |
| `cfg_settings` | id, pfad (unique), workload, bereich, objekt_id, objekt_name, eigenschaft, quelle, aktiv |
| `cfg_setting_versions` | id, setting_id, wert (JSONB), gueltig_ab, gueltig_bis, snapshot_id |
| `cfg_changes` | id, setting_id, art, alt (JSONB), neu (JSONB), snapshot_id, geaendert_von, audit_ref, status, bewertet_von, bewertet_am, kommentar |
| `cfg_setting_meta` | setting_id, beschreibung, beschreibung_quelle, beschreibung_geprueft, begruendung, kritikalitaet, soll_wert (JSONB), soll_quelle, verantwortlich, learn_url |
| `cfg_setting_meta_history` | id, setting_id, feld, alt, neu, user_id, zeitpunkt |

Evergreen:

| Tabelle | Wichtige Felder |
|---|---|
| `ev_entries` | id, jahr, nummer, software, titel, quelle, quelle_ref, dienste (JSONB), kategorie, major, handeln_bis, veroeffentlicht, geaendert_ms, text, status, angelegt_von, angelegt, aktualisiert, abgeschlossen |
| `ev_entries` (seit 0.83 zusätzlich) | kennzeichen (JSONB), abschnitte (JSONB: Überschrift, Text), zeitplan_vorher, zeitplan_geaendert, betroffen, standard (an, aus, entfaellt), steuerbar (ja, nein), steuerbar_womit, phasen (JSONB: Name, Beginn, Ende), phasen_vorher (JSONB), vorschlag (JSONB: Felder, die noch Vorschlag sind), kurzfassung, aenderung_mitarbeitende, schulung, mitbestimmung (ja, nein, pruefen), mitbestimmung_grund, setting_id? |
| `ev_notes` | id, entry_id, art (notiz, abgeschlossen, geoeffnet, aktualisiert, zeitplan, bewertet), text, details (JSONB, geänderte Felder), user_id?, zeitpunkt |

---

## 10. Screens

| Screen | Rollen | Inhalt |
|---|---|---|
| Login | alle | App-Name, „Mit Microsoft anmelden“, Datenschutzhinweis |
| Start / Meine Aufgaben | alle | Aufgaben aus allen Modulen, Modul-Kacheln, letzte Aktivitäten (die neuesten acht Meldungen der Glocke, gelesen oder nicht, damit nach Rolle und eigener Einstellung gefiltert; Verweis auf alle Benachrichtigungen) |
| M365 › Übersicht | Config.* | Kennzahlen, Änderungen pro Tag, letzte Änderungen, Collector-Hinweise |
| M365 › Änderungen | Config.* | Liste mit Filtern (Status, Dienst und Bereich), gegliedert nach Dienst › Bereich (Bereich mit der neuesten Änderung zuerst, „Alle auswählen“ je Bereich), Detailbereich mit Vorher/Nachher, Audit-Eintrag, Beschreibung, Bewertung mit Kommentarregeln |
| M365 › Einstellungen | Config.* | Baum Dienst › Bereich › Objekt › Eigenschaft (aufklappbar, Zähler für offene Änderungen und Abweichungen je Knoten, Eigenschaften erst beim Aufklappen eines Objekts geladen; `GET /api/m365-config/settings/tree`, `GET …/settings?area=&object_id=`), Detail: Wert, gültig seit, Kritikalität, Empfehlung, Soll-Wert/BR-Beschluss, Beschreibung, Begründung, Microsoft-Schema, Verlauf |
| M365 › Empfehlungen | Config.* (Zuordnen: Config.Reviewer) | Empfehlungen aus Microsoft Secure Score: Liste mit Stand und Punkten (offen, erfüllt, alle), Detail mit Statustext, Umsetzung laut Microsoft und zugeordneten Einstellungen |
| IT-Tools | Tools.User | Übersicht aller Tools mit Suche und Favoriten, eine Seite je Kategorie (in der Navigation), je Tool eine eigene Seite |
| M365 › Lizenzen | Tenant.Reader | Liste der Lizenzen mit gekauft, zugewiesen, frei, Stichtag und Hinweisen; Detail mit Verlauf |
| M365 › Benutzer | Tenant.Reader | Zahl der Konten (Mitglieder, Gäste, aktiv, deaktiviert, mit Lizenz) mit Verlauf |
| M365 › Zertifikate und Secrets | Tenant.Reader | Zertifikate und Secrets der Anwendungen im Tenant mit Ablaufdatum, Restlaufzeit und Einstufung; Ansicht „Handlungsbedarf“ oder alle; zweite Ansicht als Waben mit Einzelheiten nach Auswahl |
| M365 › Dienststatus | Tenant.Reader | Ampel je Dienst (Exchange Online, Teams, SharePoint Online, Entra), offene und kürzlich beendete Störungen und Hinweise mit den Mitteilungen von Microsoft, Ausfälle je Dienst und Jahr |
| M365 › Nutzung | Tenant.Reader | Aktive und inaktive Benutzer je Dienst (Exchange, OneDrive, SharePoint, Teams, Viva Engage) für 7, 30, 90 oder 180 Tage, Verlauf der aktiven Benutzer je Dienst; nur Summen |
| IT-Budget › Übersicht | Budget.* | Zu erledigen mit Sprung in die Liste (Rechnungen zu prüfen, Posten ohne Partner, Kündigungstermine, Verträge ohne AVV, Konten über dem Plan), Kennzahlen Geplant, Ist, Verfügbar und Budgetposten, Budget nach Konten (laufende Kosten und Investitionen) mit Auslastung, Kündigungstermine der nächsten 120 Tage, zuletzt gebucht |
| IT-Budget › Budgetposten | Budget.* (Ändern: Budget.Editor, Budget.Manager) | Tabelle mit Ansicht rechts: Posten eines Geschäftsjahrs mit fester Nummer, Konto, Partner, Geplant, Ist, Status und Vorjahr; sortieren nach jeder Spalte, gruppieren nach Konto oder Partner; Ansicht mit Status, Beträgen, Angaben und Rechnungen auf dem Posten; Abschließen und Wieder öffnen; hinzufügen und ändern in der Maske rechts, löschen; Filter nach Suchtext, Status, Tag und IT-Projekt |
| IT-Budget › Mehrjahresübersicht | Budget.* | Erwartete Kosten, Ist und Status je Budgetposten über fünf Geschäftsjahre, Ausblick oder Rückblick; Export als Excel-Datei |
| IT-Budget › Statistik | Budget.* (Speichern und Löschen: Budget.Editor, Budget.Manager) | Überblick eines Geschäftsjahrs mit Vergleichsjahr, Jahresvergleich der Konten über bis zu fünf Jahre, Auswertung nach Tags; gespeicherte Auswahlen |
| IT-Budget › Verträge | Budget.* (Ändern: Budget.Editor, Budget.Manager) | Kennzahlen (laufende Verträge, Soll, Ist, AVV fehlt), Tabelle mit Ansicht rechts: Verträge mit Kosten, Soll, Ist, Kündigungstermin und AVV; Filter Laufend, Kündigung bald, Gekündigt, AVV fehlt, Alle sowie Partner und Turnus; Ansicht je Vertrag mit Vertragsdaten, Fristen, Budgetposten und „Monatsposten anlegen“; anlegen und ändern in der Maske rechts (Turnus zuerst) |
| IT-Budget › Rechnungen | Budget.* (Erfassen: Budget.Editor, Budget.Manager; Buchen: Budget.Manager) | Tabelle mit Ansicht rechts: Rechnungen eines Geschäftsjahrs, Filter Zu prüfen, Gebucht, Alle sowie Rechnungssteller und Konto; Ansicht mit Positionen, Beleg und Aktionen; erfassen und ändern in der Maske rechts, prüfen und buchen, löschen |
| IT-Budget › Partner | Budget.* (Ändern: Budget.Editor, Budget.Manager) | Vertragspartner und Rechnungssteller; anlegen, ändern, stilllegen; Detail je Firma mit Verträgen, Budgetposten und Rechnungen; zusammenlegen (Budget.Manager) |
| IT-Budget › Konten | Budget.* (Ändern: Budget.Editor, Budget.Manager) | Liste der Konten; anlegen, ändern, stilllegen |
| IT-Budget › Einstellungen | Budget.Manager | Beginn und Bezeichnung des Geschäftsjahrs, Kostenstelle; Liste der Tags anlegen, umbenennen, löschen |
| M365 › Snapshots | Config.* | Abrufe mit Status; Vergleich zweier Abrufe (neu, geändert, entfernt mit Vorher/Nachher); Stand eines Abrufs als JSON und CSV nur für `Werkbank.Admin` (Server prüft, Spalte sonst ausgeblendet) |
| Microsoft 365 › Neuerungen › Nachrichtencenter | Evergreen.Reader, Evergreen.Editor | Liste nach Kategorien (8.3) mit Suche, Status (Offen, Neu, Mit Frist, Abgeschlossen), Kategorie und „Reine Info-Meldungen ausblenden“; Seite des Eintrags mit Pfad, Steckbrief, Kategorie, Rollout, Reitern Unsere Bewertung, Text von Microsoft, Notizen und Verlauf sowie Blättern in der Kategorie; Bearbeiter: Neuer Eintrag, Kategorie ändern, Bewertung speichern, Notiz anfügen, Abschließen, Wieder öffnen |
| Reports | später | Berichtsvorlagen, Download, geplanter Versand. Noch nicht gebaut; ohne Eintrag in der Navigation |
| Verwaltung (über das Kontomenü oben rechts, Seiten im Seitenmenü) | Admin (mit Step-up) | Seiten **Allgemein** (Branding mit Logo, Fußzeile und Datenschutz-Link für alle Mails, Aufbewahrung des Audit-Logs, Vorlauf für ablaufende Zertifikate und Secrets), **Rollen** (nach Rolle oder nach Person, jeweils mit den Rollen der letzten Anmeldung), **Mail & Teams** (SMTP-Server, Teams), **Verbindungen** (KI-Texte, NetBox, Abfragen ins Internet), **Datensicherung** (täglich zu einer Uhrzeit, Aufbewahrung als Anzahl, „Jetzt sichern“, Zustand von Schlüssel und Zielordner, vorhandene Sicherungen und letzte Läufe, Anleitung zum Einrichten und Zurückspielen) und **Audit-Log**. Später: Module, Kommentarregeln |
| Verwaltung › Audit-Log | Admin | Filterbare Tabelle, Export |
| Konto | alle | Name, E-Mail, Profilbild, Rollen, angemeldete Geräte (eigene Sitzungen, andere einzeln oder alle abmelden), Darstellung (hell/dunkel) und Schriftgröße im Menü (klein, normal, groß, sehr groß) und Abstände im Menü (kompakt, normal, weiträumig; mit Touch mindestens 44 px; je Browser, nur Navigation), Benachrichtigungen je Art mit Glocke, Mail, Teams und Push, Push je Gerät ein und aus mit Liste der Geräte und Testnachricht, auf iPhone/iPad Hinweis zur Installation, Version |
| Benachrichtigungen | alle | Die letzten 100 Benachrichtigungen, alle als gelesen markieren, Verweis auf die Einstellungen im Konto. Die Glocke in der Kopfzeile zeigt die Zahl der ungelesenen und die neuesten zehn |
| Neuigkeiten | alle | Änderungen je Version, die man in der Anwendung bemerkt |
| IT-Projekte › Alle Projekte | Projekte.* (Anlegen: Projekte.Editor) | Liste mit Status, veranschlagt, geplant, Ist, offenen Punkten, letztem Jour Fixe; Filter, Suche, neues Projekt |
| IT-Projekte › Projekt | Projekte.* (Einstellungen und Ändern: Projekte.Editor) | Reiter Übersicht, Budget, Jour Fixe (Markdown mit Leiste und Vorschau, PDF-Anhänge), Aufgaben, Einstellungen |
| IT-Bestand › Hardware | Bestand.* (Erfassen: Bestand.Editor) | Liste mit Status, Suche, Filter nach Art, Kartenansicht auf schmalen Bildschirmen; Gerät erfassen |
| IT-Bestand › Gerät | Bestand.* (Ändern: Bestand.Editor) | Reiter Übersicht (Bearbeiten, Inventurnummer mit Rückfrage, Ausmustern, Wieder in Betrieb nehmen) und Verlauf |
| IT-Bestand › Stammdaten | Bestand.* (Pflegen: Bestand.Editor) | Hardware-Arten, Hersteller und Modelle, Gründe fürs Ausmustern |
| DNS-Abgleich mit NetBox | Monitoring.Reader, Admin | Kennzahlen, Verlauf 90 Tage, Kacheln je Stand als Filter, Filter Probleme/Abweichend/Fehlt öffentlich/Fehler/In Ordnung/Neu/Alle mit Anzahl, Suche, Tabelle je Zone mit der Zone als Überschrift, „Jetzt prüfen“ für Admins |
| Handbuch | alle | Bereiche, Teile und je Thema eine Seite nach Rollen; eigenes Seitenmenü mit Suche (am Handy „Alle Themen“); Begriffe A–Z; Themenseite mit Rollen, Verweis, weiteren Themen und vor/zurück |
| Offline | alle | Hinweis „Keine Verbindung“, erneut versuchen |

Maßstab für das Aussehen sind `docs/design.md` und die bestehenden Seiten.

**Stand der Umsetzung (Version 0.55):** Alle Seiten der Tabelle sind gebaut, auch das Handbuch, Push und Vergleich und Export der Snapshots. Noch nicht vorhanden: Reports. (Kennzeichen „Mitbestimmung“ und PDF der BR-Vorlage entfallen mit dem Umbau von Evergreen in 0.76.)

---

## 11. PWA, Offline, Push, iOS

- **Manifest** mit Name, Icons (inkl. maskable), `display: standalone`, Themenfarbe.
- **Service Worker**:
  - cacht **nur** die App-Hülle (HTML, JS, CSS, Icons, Schriften) und die **Offline-Seite**.
  - **Niemals** API-Antworten oder Anhänge (`/api/*` = network-only).
  - Versionierte Caches, alte Caches werden beim Aktivieren gelöscht.
  - Update: neue Version wird erkannt, die Oberfläche zeigt „Neue Version verfügbar – neu laden“. Kein unbemerkter Wechsel mitten in einer Eingabe. Ein offenes Fenster fragt von selbst nach (alle 30 Minuten, beim Zurückkehren ins Fenster und wenn das Netz zurückkommt), weil der Browser sonst nur beim Laden einer Seite prüft.
  - Session- und Fachdaten liegen nie im Cache. Deshalb muss beim Abmelden nichts aus dem Cache gelöscht werden.
- **Web Push** mit VAPID. Den Schlüssel erzeugt der Server beim Einschalten in der Verwaltung und speichert ihn verschlüsselt in der Datenbank (wie die übrigen Geheimnisse aus der Verwaltung). Inhalte und Ablauf siehe 6.7. Der Service Worker zeigt die Nachricht an und öffnet beim Tippen nur Pfade der Werkbank.
- **iOS**:
  - Push nur für zum Home-Bildschirm hinzugefügte App. Die App zeigt einen Installationshinweis.
  - Safe-Area-Abstände, `dvh` statt `100vh`, Eingabefelder mit mindestens 16 px Schrift.
  - `apple-touch-icon`, Statusleisten-Farbe.
  - Entra-Login per Redirect.
  - Lokaler Speicher kann gelöscht werden, deshalb wird nichts Fachliches lokal gespeichert.
- **Lighthouse** (PWA, Performance, Accessibility, Best Practices) in der CI mit Mindestwerten (Kapitel 13).

---

## 12. Nicht-funktionale Anforderungen

### 12.1 Sicherheit – OWASP ASVS Stufe 2

- Grundlage: OWASP ASVS **5.0.0**, Stufe 2.
- Nachweis je Anforderung in `docs/security/asvs-l2.md` (umgesetzt durch / getestet durch / nicht anwendbar mit Begründung).
- Auszug der wichtigsten Maßnahmen:
  - **Rechte:** serverseitige Rechteprüfung für jede Anfrage, Objektberechtigung (kein Zugriff über geratene IDs).
  - **Header und Cookies:** strikte CSP ohne `unsafe-inline`, HSTS (über Proxy), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. CSRF-Schutz zusätzlich zu `SameSite`.
  - **Missbrauch:** Rate-Limits für Login, API und Exporte: Höchstzahl Anfragen pro Minute und Absender-IP, einstellbar über `RATE_LIMIT_*`, Antwort `429` mit `Retry-After`. Gezählt wird im Arbeitsspeicher des Web-Dienstes (ein Prozess).
  - **Eingaben:** Validierung aller Eingaben über Pydantic-Schemas. Ausgaben werden immer kodiert, keine HTML-Darstellung von Nutzertexten.
  - **Secrets:** nur als Docker-Secrets, niemals im Repo oder in Logs. Zertifikate für Konnektoren mit Ablaufüberwachung.
  - **Proxy:** Proxy-Header werden nur von der konfigurierten Proxy-IP akzeptiert (`TRUSTED_PROXY_IPS`).
  - **Abhängigkeiten:** Dependabot, wöchentlicher Audit. Container-Images mit Trivy geprüft.
  - **Fehler:** Fehlermeldungen ohne interne Details. Strukturierte Logs ohne personenbezogene Inhalte über das Nötige hinaus.

### 12.2 Datenschutz – DSGVO

- Dokumentation in `docs/datenschutz.md`:
  - verarbeitete Daten
  - Zweck
  - Rechtsgrundlage (klärt der Betreiber mit seinem Datenschutzbeauftragten)
  - Speicherfristen
  - Empfänger (Microsoft, Push-Dienste)
  - TOMs
  - Löschkonzept
- Datensparsamkeit: IP-Adressen im Audit-Log gekürzt, Push und Mail ohne Inhalte, keine Tracking- oder Analyse-Dienste.
- **Hinweis:** Die Werkbank protokolliert Handlungen von Beschäftigten (Audit-Log, Bewertungen). Sie ist daher voraussichtlich selbst mitbestimmungspflichtig; die Beteiligung des Betriebsrats klärt der Betreiber außerhalb der Werkbank.

### 12.3 Barrierefreiheit – WCAG 2.2 AA

- Automatische Prüfung mit axe-core in den E2E-Tests (alle Screens, alle Geräteprofile).
- Manuelle Checkliste `docs/a11y-wcag22.md`: Tastaturbedienung, Fokusreihenfolge und -sichtbarkeit, Screenreader (VoiceOver/NVDA), Zielgrößen (mind. 24×24 px, Bedienelemente 44 px), Kontraste, keine Information nur über Farbe, verständliche Fehlermeldungen.

### 12.4 Gebrauchstauglichkeit – ISO 9241

- Checkliste `docs/usability-iso9241.md` nach ISO 9241-110 (Aufgabenangemessenheit, Selbstbeschreibungsfähigkeit, Erwartungskonformität, Erlernbarkeit, Steuerbarkeit, Robustheit gegen Benutzungsfehler, Benutzerbindung) und ISO 9241-11.
- Prüfung bei jedem größeren Feature und vor jedem Minor-Release.

### 12.5 Einheitliche Bedienung – Designrichtlinie

`docs/design.md` legt fest:

- **Aufbau:** Kopfzeile, Navigation links (mobil als Menü), Inhaltsbereich mit Modul-Label, Titel und Untertitel.
- **Liste und Detail:** Liste links bzw. oben, Detail rechts bzw. darunter.
- **Aktionen:** Hauptaktion als gefüllter Button, Nebenaktionen umrandet, gefährliche Aktionen nie als Hauptbutton. Feste Reihenfolge der Buttons.
- **Status-Badges:** einheitliche Farben und Texte, nie nur Farbe.
- **Vokabular:** Gemeinsame Komponenten (`frontend/src/components`) und gemeinsame Gestaltung (`frontend/src/styles.css`). Neue Screens verwenden diese und bauen nichts je Seite nach.

### 12.6 Geräte

Handy (ab 360 px), Tablet, Desktop. Aktuelle Versionen von Edge, Chrome, Firefox, Safari (macOS/iOS).

### 12.7 Leistung

- Seitenaufbau unter 2 s im Firmennetz.
- API-Antworten für Listen unter 500 ms bei 10.000 Einstellungen.
- Collector-Lauf unter 10 Minuten.

---

## 13. Qualitätssicherung und CI (GitHub Actions)

| Prüfung | Wann | Werkzeug |
|---|---|---|
| Lint und Format | jeder Push/PR | ruff, mypy, eslint, prettier |
| Unit-Tests | jeder Push/PR | pytest, vitest |
| E2E-Tests (`e2e/`) | jeder PR | Playwright, Profile: Desktop, Tablet, iPhone. Test-Login statt Entra |
| Barrierefreiheit | jeder PR | axe-core in Playwright, keine Verstöße „serious/critical“ |
| Lighthouse | jeder PR | Lighthouse CI: Accessibility ≥ 95, Best Practices ≥ 95, Performance ≥ 85, PWA-Kriterien erfüllt |
| Docker-Deployment | jeder PR | Image bauen (`backend/Dockerfile`), `docker compose up`, Healthchecks, Smoke-Test; die Compose-Datei für den Betrieb wird geprüft (Image aus der Registry, kein Build) |
| Container-Scan | jeder PR, wöchentlich | Trivy: Dateisystem (Abhängigkeiten, Konfiguration, Secrets) und das gebaute Docker-Image; Abbruch bei HIGH/CRITICAL mit verfügbarem Update, begründete Ausnahmen in `.trivyignore`; Trivy auf Version und Digest festgelegt |
| Statische Analyse | jeder PR, wöchentlich | CodeQL (Python, JavaScript/TypeScript), Semgrep (inkl. XSS-Regeln) |
| Secrets | jeder Push, wöchentlich | Betterleaks |
| Abhängigkeiten | wöchentlich und jeder PR | Dependabot (wöchentlich), pip-audit und npm audit (jeder PR). Blockierend für npm sind die Pakete der ausgelieferten App (`--omit=dev`); Treffer in Entwicklungs- und Testwerkzeugen erscheinen als Warnung, weil sie nicht ausgeliefert werden und Lücken dort teils noch keine Korrektur haben (entschieden November 2026). Eine automatische Prüfung auf ungenutzte Pakete gibt es noch nicht |
| Service Worker | jeder PR | Playwright-Test: Offline-Seite, keine API-Daten im Cache. Der Test für den Wechsel von alter zu neuer Version mit Update-Hinweis fehlt noch |
| Release | Merge auf `main` | `release.yml`: Tag und GitHub Release, wenn die Version neu ist |
| Formatierung und Lockfiles | Push auf Feature-Branches | `lockfile.yml`: Prettier und Lockfiles, Korrektur als Commit |

**Regelmäßige Prüfung** (wöchentlich geplant und auf Zuruf): „Prüfe auf XSS, Secrets, unnötige Dependencies und Service-Worker-Update-Probleme.“

**Branch Protection auf `main`:**

- PR erforderlich; Freigaben: 0, solange eine Person allein arbeitet, sonst mindestens 1 (`docs/repo-setup.md`)
- alle Checks grün
- kein Force-Push
- lineare Historie

---

## 14. Repository-Struktur

```
werkbank/
├── backend/
│   ├── Dockerfile              # Build aus dem ausgecheckten Repository
│   ├── werkbank/core/          # Anmeldung, Sitzungen, Rechte, Audit, Aufgaben, Profilbild
│   ├── werkbank/modules/
│   │   ├── m365_config/
│   │   └── evergreen/
│   ├── werkbank/worker/
│   ├── migrations/
│   └── tests/
├── frontend/
│   ├── src/components/         # Layout, gemeinsame Komponenten
│   ├── src/pages/              # Start, Konto, Neuigkeiten, Audit-Log, Verwaltung
│   ├── src/modules/            # m365, evergreen
│   ├── src/fonts/              # Inter, JetBrains Mono (mit Lizenzen)
│   ├── src/release-notes.ts    # Texte der Seite „Neuigkeiten“
│   └── public/                 # Manifest, Icons, offline.html, sw.js, theme.js
├── e2e/                        # Playwright, axe-core, Lighthouse
├── deploy/
│   ├── docker-compose.yml
│   ├── Dockerfile              # Build ohne Quellcode daneben (holt ihn von GitHub)
│   ├── README.md
│   └── .env.example
├── docs/
│   ├── spec.md
│   ├── design.md
│   ├── entra-setup.md
│   ├── inbetriebnahme.md
│   ├── repo-setup.md
│   ├── datenschutz.md
│   ├── a11y-wcag22.md
│   ├── usability-iso9241.md
│   └── security/asvs-l2.md
├── .github/
│   ├── workflows/
│   ├── dependabot.yml
│   └── pull_request_template.md
├── CLAUDE.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
├── LICENSE
└── README.md
```

Ein Ordner `powershell/` kommt mit den Diensten, die PowerShell brauchen (Phase 4). Beschreibung und Topics des Repositorys stehen in [`repo-setup.md`](repo-setup.md).

---

## 15. Phasen

| Phase | Inhalt | Ergebnis | Stand |
|---|---|---|---|
| 0 | Repo-Grundgerüst, CI, Doku-Gerüst | geprüftes Projekt ohne Anwendungscode | ✅ abgeschlossen |
| 1 | Kern: Login, Rollen, Layout, Aufgaben-Gerüst, Audit-Log, Offline-Seite, Service Worker | Anmeldung und leere Module sichtbar | ✅ abgeschlossen |
| 2 | M365-Konfiguration: Collector Entra, Versionierung, Änderungen, Bewertung, Einstellungen, Verlauf | erster echter Nutzen | ✅ umgesetzt (2a bis 2e), dazu Baumansicht, KI-Texte und Empfehlungen aus Secure Score. dazu Benachrichtigung bei Abweichung vom Soll und (0.55) Snapshot-Vergleich und -Export |
| 3 | Evergreen: Nachrichtencenter, Workflow, BR-/GF-Ansicht, Soll-Werte | Freigabeprozess digital | ✅ umgesetzt (3a bis 3e); in 0.76 umgebaut: nur für die IT, Einträge mit Status und Notizen je Software (Kapitel 8) |
| – | Einheitliche Oberfläche, heller und dunkler Modus, Neuigkeiten, Konto mit Profilbild, automatische Releases | einheitliches Aussehen | ✅ umgesetzt, mit Handbuch und letzten Aktivitäten auf der Startseite |
| 4 | Ausbau: Exchange, Teams, Intune, SharePoint, Benachrichtigungen, Push | Vollumfang v1 | 🔄 weitgehend: Exchange, Teams, Intune und SharePoint (Konfiguration), Benachrichtigungen (Glocke, Mail, Teams, Push) umgesetzt |
| 5 | weitere Module nach Bedarf | – | 🔄 laufend, siehe die Zeilen darunter |
| T1–T4 | Modul Tickets (8e) | Ticketsystem für Bereiche mit eigenem Postfach | ✅ umgesetzt (T1 Grundlagen, T2 E-Mail, T3 Arbeitshilfen, T4 Betrieb); dazu Leiste „Favoriten“ und „Geöffnet“ (0.124.0) |
| – | Weitere Bereiche nach Bedarf (Phase 5) | Werkzeuge der IT in einer Oberfläche | ✅ umgesetzt: Tenant (7a), IT-Budget (7b), Gerätezuordnung (7c), IT-Tools (8a), IT-Monitoring mit NetBox und Zabbix (8b), IT-Projekte (8c), IT-Bestand mit NinjaOne (8d) |
| – | Berechtigungen in der Werkbank (6.1a) | Rechte je Bereich statt App-Rollen | ✅ umgesetzt (0.121.0); App-Rollen nur noch für die einmalige Übernahme |
| D1–D4 | Modul Dokumentation (8f) | Wissen der Abteilungen festhalten und teilen | 🔄 D1 bis D3 umgesetzt (0.118.0, 0.119.0, 0.123.0); offen: D4 (Lese-Links für Externe, Export als PDF und Markdown) |

---

## 16. Offene Punkte

| # | Thema | Frage |
|---|---|---|
| 1 | Login | Entra-Login über eigene Login-Seite der Werkbank – entschieden |
| 2 | MFA | Entschieden: eigene CA-Richtlinie „MFA für Werkbank“. Lizenzen und MFA-Registrierung regelt der Betreiber im Tenant, nicht Teil der Werkbank |
| 3 | Verwaltung | Entschieden: Step-up-Anmeldung genügt, keine zusätzliche Beschränkung auf das interne Netz |
| 4 | Audit-Log | Entschieden: Aufbewahrung 90 Tage, in der Verwaltung einstellbar (30 bis 3650 Tage) |
| 5 | Anhänge | Entschieden: kein Virenscan (6.5) |
| 6 | KI-Texte | Entschieden: Anbieter frei einstellbar (OpenAI-kompatibel oder Anthropic; Adresse, Modell und Schlüssel in der Verwaltung; der Schlüssel liegt verschlüsselt in der Datenbank). Texte entstehen automatisch und bleiben „ungeprüft“ bis zur Freigabe. Offen: AVV und Freigabe Datenschutz je nach gewähltem Anbieter |
| 7 | Benchmarks | Entschieden: Empfehlungen aus Microsoft Secure Score (eigene Seite, Zuordnung zu Einstellungen von Hand, später ergänzt um eine mitgelieferte Zuordnung); CIS-Benchmarks werden wegen der Lizenz nicht mitgeliefert |
| 8 | Datenschutz | Rechtsgrundlage, Abstimmung mit dem DSB und Beteiligung des BR klärt der Betreiber; nicht Teil der Werkbank. Die Werkbank liefert dafür `docs/datenschutz.md` |
| 9 | Hostname | Erledigt: Der öffentliche Hostname ist Konfiguration (`PUBLIC_URL`) und steht nicht im Repository |
| 14 | Anrede | Entschieden: überall „du“ (`design.md`, Kapitel 7) |
| 15 | Handbuch | Entsteht nach Abschluss der Oberfläche; ab dann bei jeder Änderung mitpflegen (`CLAUDE.md`) |
| 10 | Mail | Entschieden: Versand über einen SMTP-Server, der in der Verwaltung eingetragen wird (Absender dort). Benachrichtigungen selbst folgen in Phase 4 |
| 11 | Copyright | Entschieden: `extrempro` |
| 12 | ASVS-Version | Entschieden: OWASP ASVS 5.0.0 |
| 16 | Evergreen: BR-Vorlage | Hinfällig: Seit dem Umbau in 0.76 ist Evergreen nur noch für die IT, ohne Vorlage an Betriebsrat und Geschäftsführung |
| 17 | Evergreen: Steckbrief automatisch | Entschieden: Phasen und Steckbrief per KI (eigener Schalter in der Verwaltung), Regeln als Ersatz; Kurzfassung und Bewertung bleiben von Hand (8.4). Freigabe des Anbieters für diesen Zweck klärt der Betreiber mit dem Datenschutz |
