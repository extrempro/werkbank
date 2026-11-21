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
| Kern | Funktionen, die alle Module nutzen (Anmeldung, Rollen, Aufgaben, Workflows, Kommentare, Audit-Log, Benachrichtigungen, Reports). |
| Modul | Fachlicher Bereich mit eigenen Daten, Seiten, Rollen, Workflows und Jobs. |
| Einstellung | Ein einzelner Konfigurationswert im Tenant, eindeutig über einen **Pfad** adressiert, z. B. `entra/conditionalAccess/<Richtlinie>/state`. |
| Snapshot | Ein vollständiger Abruf der Tenant-Konfiguration zu einem Zeitpunkt. |
| Änderung | Ein Unterschied einer Einstellung zwischen zwei Snapshots (neu, geändert, entfernt). |
| Soll-Wert | Der beschlossene oder gewünschte Wert einer Einstellung. |
| Eintrag (Evergreen) | Eine Neuerung einer Software mit Status neu, bearbeitet oder abgeschlossen und Notizen. |
| Workflow | Beschriebene Abfolge von Schritten mit Rollen, Aktionen und Regeln. |
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
| Secret Scanning | GitHub Secret Scanning mit Push Protection, zusätzlich gitleaks |

---

## 4. Rollen und Berechtigungen

Rollen sind **Entra-App-Rollen** der Werkbank-App-Registrierung. Zuweisung über Entra-Gruppen. Eine Person kann mehrere Rollen haben. Jede Prüfung erfolgt **serverseitig**. Das Ausblenden in der Oberfläche ist nur Komfort.

| App-Rolle | Modul | Darf |
|---|---|---|
| `Werkbank.Admin` | Kern | Verwaltung: Module, Konnektoren, Kommentarregeln, Benachrichtigungsregeln, Audit-Log vollständig |
| `Config.Reader` | M365-Konfiguration | Einstellungen, Verlauf, Änderungen, Snapshots ansehen und exportieren |
| `Config.Reviewer` | M365-Konfiguration | zusätzlich Änderungen bewerten, Beschreibungen und Begründungen pflegen, Soll-Werte setzen |
| `Evergreen.Reader` | Evergreen | Einträge mit Notizen ansehen; keine Aufgaben und Benachrichtigungen |
| `Evergreen.Editor` | Evergreen | Einträge anlegen, Notizen anfügen, abschließen und wieder öffnen; Aufgabe und Benachrichtigung bei neuen Einträgen |
| `Tools.User` | IT-Tools | Bereich IT-Tools öffnen. Die Tools rechnen vollständig im Browser und haben keine Daten auf dem Server; die Rolle steuert deshalb nur, wer den Bereich sieht |
| `Tenant.Reader` | Tenant | Lizenzen, Benutzerzahlen und Nutzung der Dienste mit Verlauf, Zertifikate und Secrets, Dienststatus ansehen |
| `Budget.Editor` | IT-Budget | Budget ansehen; Konten, Budgetposten, Verträge, Partner und Rechnungen pflegen |
| `Budget.Manager` | IT-Budget | wie `Budget.Editor`, dazu Rechnungen buchen, Partner zusammenlegen und die Einstellungen des Budgets festlegen |
| `Budget.Reader` | IT-Budget | Budget ansehen (z. B. Geschäftsführung, Controlling) |
| `Monitoring.Reader` | IT-Monitoring | Bereich IT-Monitoring ansehen |
| `Projekte.Reader` | IT-Projekte | Projekte ansehen: Übersicht, Budget, Jour Fixe mit Anhängen, Aufgaben |
| `Projekte.Editor` | IT-Projekte | Projekte anlegen, ändern und löschen; Jour Fixe, Anhänge und Aufgaben pflegen |
| `Bestand.Reader` | IT-Bestand | Hardware mit Verlauf und Stammdaten ansehen |
| `Bestand.Editor` | IT-Bestand | Hardware erfassen und ändern, Inventurnummern setzen, ausmustern und wieder in Betrieb nehmen, Stammdaten pflegen |
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
- App-Rollen und Rechte
- Workflow-Beschreibungen (`workflow.yaml`)
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
- Unternehmensanwendung mit „Zuweisung erforderlich“: Nur Personen bzw. Gruppen mit zugewiesener App-Rolle können sich anmelden.
- **Backend-for-Frontend**: Tokens bleiben im Backend. Der Browser erhält nur ein Session-Cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, `__Host-`-Präfix).
- Session: Leerlauf-Timeout 30 Minuten, absolute Dauer 8 Stunden. Abmelden beendet die Session serverseitig.
- **Erneute Anmeldung (Step-up)** beim Öffnen der Verwaltung, wenn die letzte Anmeldung länger als 15 Minuten zurückliegt (`STEP_UP_MINUTES`). Die Werkbank schickt die Person dann mit `prompt=login` zu Entra. Liefert Entra den Zeitpunkt der letzten echten Anmeldung mit (`auth_time`), zählt dieser; eine stille Anmeldung über eine bestehende Entra-Sitzung gilt dann nicht als frisch.
- Jede Anmeldung beendet die vorherige Sitzung desselben Browsers (neues Token).
- **Profilbild (optional, `ENTRA_PROFILE_PHOTO`):** Bei der Anmeldung liest die Werkbank mit der delegierten Berechtigung `User.Read` das eigene Bild der Person, speichert es und zeigt es allen angemeldeten Personen. Das Zugriffstoken wird danach verworfen. Ein Fehler beim Abruf verhindert die Anmeldung nicht.
- **Seite „Konto“:** eigene Angaben, Rollen, Sitzung, Darstellung, Schriftgröße und Abstände im Menü (je Browser), Version.
- **Entra Conditional Access** mit einer eigenen Richtlinie nur für die Werkbank, da MFA im Tenant noch nicht allgemein erzwungen wird:
  - **Benutzer:** alle Gruppen mit Werkbank-Rollen (bzw. alle Benutzer)
  - **Zielressource:** Enterprise-App „Werkbank“
  - **Gewähren:** MFA erforderlich (Authentifizierungsstärke „Multifaktor-Authentifizierung“)
  - **Einführung:** zuerst „Nur Bericht“, dann „Ein“
  - Die Collector-App (Zertifikat, keine Benutzeranmeldung) ist davon nicht betroffen.
  - Voraussetzung: Entra ID P1 für alle Werkbank-Nutzer.
- Login-Seite: Name der App, Button „Mit Microsoft anmelden“, Hinweis auf Datenschutz. Ohne Anmeldung ist außer Login-Seite, Offline-Seite und statischen Dateien nichts erreichbar.
- Auf iOS als installierte PWA: Redirect statt Popup.

### 6.2 Aufgabenliste („Meine Aufgaben“)

- Startseite für alle Rollen.
- Module melden Aufgaben über eine gemeinsame Schnittstelle: Titel, Untertitel, Modul, Fälligkeit, Ziel-Link, zuständige Rolle bzw. Person.
- Beispiele: offene Änderung prüfen (Config.Reviewer), Evergreen-Schritt (zuständige Rolle), Konnektor-Fehler (Admin).
- Zähler in der Kopfzeile und in der Navigation.
- Stand: Die Aufgaben werden bei jeder Abfrage aus dem Stand der Module ermittelt (`/api/tasks`) und nicht gespeichert; der Zähler steht in der Navigation beim Eintrag „Start“. M365-Konfiguration meldet offene Änderungen und Abweichungen vom Soll-Wert (`Config.Reviewer`) sowie einen fehlgeschlagenen Abruf (`Werkbank.Admin`). Der Zähler steht auch in der Kopfzeile. Die Zähler laden die Aufgaben bei jedem Seitenwechsel, nach jeder Änderung, wenn das Fenster wieder in den Vordergrund kommt, und alle fünf Minuten neu. Evergreen meldet Bearbeitern je Software die Zahl neuer Einträge. Eine Tabelle `tasks` für einzeln zugewiesene Aufgaben ist bisher nicht nötig und nicht umgesetzt.

### 6.3 Workflow-Engine

Workflows werden je Modul in YAML beschrieben. Stand: Die Engine ist im Kern vorhanden, wird aber derzeit von keinem Bereich genutzt (Evergreen kommt seit 0.76 ohne Ablauf aus); die Tests nutzen einen Beispiel-Ablauf (`backend/tests/fixtures/workflow_beispiel.yaml`). Beispiel:

```yaml
workflow: evergreen
schritte:
  - id: it_bewertung
    rolle: Evergreen.IT
    aktionen:
      - { id: pflichtig, ziel: fachabteilungen }
      - { id: nicht_pflichtig, ziel: abgeschlossen, kommentar: pflicht,
          ueberspringt: [fachabteilungen, vorlage, betriebsrat, gf, umsetzung] }
  - id: betriebsrat
    rolle: Evergreen.Betriebsrat
    erfassen_im_auftrag: [Evergreen.Team, Evergreen.IT]
    aktionen:
      - { id: zustimmen, ziel: gf }
      - { id: auflagen,  ziel: gf, kommentar: pflicht }
      - { id: ablehnen,  ziel: abgelehnt, kommentar: pflicht }
  # …
```

Regeln:

- Der Status eines Vorgangs ist der aktuelle Schritt. Er ändert sich **nur** über definierte Aktionen der zuständigen Rolle oder über automatische Bedingungen (z. B. Soll/Ist-Abgleich).
- Jede Aktion erzeugt einen unveränderlichen Protokolleintrag: Person, Zeitpunkt, Schritt, Aktion, Entscheidung, Kommentar und gegebenenfalls „im Auftrag von“.
- Keine Aktion zum direkten Setzen eines Status.
- Stand: Die Engine ist umgesetzt (`core/workflow.py`). Die Beschreibung wird beim Start geprüft (unbekannte Ziele oder Rollen, Sackgassen). Das Protokoll (`workflow_events`) ist per Datenbank-Trigger nur anhängend; jede Aktion steht zusätzlich im Audit-Log. Eine Aktion kann den erwarteten Schritt mitgeben und wird abgewiesen, wenn der Vorgang inzwischen weiterbearbeitet wurde. Das Überspringen von Schritten ergibt sich aus dem Ziel der Aktion; ein eigenes Feld `ueberspringt` gibt es nicht.

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
- Protokolliert: Anmeldung und Abmeldung, Rollennutzung, alle Workflow-Aktionen, Bewertungen, Änderungen an Beschreibungen, Soll-Werten und Regeln, Verwaltungsaktionen, Exporte, Zugriffe auf Anhänge.
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

- **Mail:** über den SMTP-Server aus der Verwaltung, als Text und HTML mit Farbe und Logo (PNG, eingebettet, keine externe Adresse) aus dem Branding.
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
- Stand: umgesetzt für Einstellungen der M365-Konfiguration. Anbieter (Art der Schnittstelle: OpenAI-kompatibel über `/chat/completions` oder Anthropic über `/messages` mit adaptivem Mitdenken bei geringem Aufwand (`output_config.effort: low`, `max_tokens` 4000), ohne `temperature`; Adresse, Modell, Schlüssel) und Höchstzahl je Stunde stehen in der Verwaltung; bei Fehlern zeigt die Werkbank die Meldung des Anbieters gekürzt (höchstens 200 Zeichen, einzeilig, nie der Schlüssel), Standard ist ausgeschaltet. Abweichung zum Schutz der Daten: Übergeben werden nur Dienst, Bereich und Name der Eigenschaft, **nicht** der Wert und nicht der Name des Objekts (beides kann Personen- oder Firmennamen enthalten). Ein Text gilt deshalb für alle Einstellungen derselben Art (`cfg_ai_texts`). Der Worker erzeugt die Texte stündlich für Einstellungen ohne eigene Beschreibung; Reviewer geben frei oder verwerfen.

### 6.10 Suche

Globale Suche über Einstellungen (Pfad, Name, Wert, Beschreibung, Begründung) und Vorgänge (ID, Titel, Zusammenfassung). Ergebnisse gefiltert nach Berechtigung.

- Stand: umgesetzt als `GET /api/search` mit einem Anbieter je Modul (`core/search.py`), Suchfeld in der Kopfzeile und Seite „Suche“. Gesucht wird in Einstellungen (Pfad, Name, Beschreibung, Begründung), erkannten Änderungen (geändert von, Kommentar) und Vorgängen (Nummer, Titel, Dienst, Zusammenfassung). Jeder Anbieter wendet dieselben Rechte an wie die Seiten seines Moduls. Abweichung: Im Wert einer Einstellung wird noch nicht gesucht. Die IT-Tools liegen im Browser; die Seite „Suche“ ergänzt passende Tools selbst, wenn die Person die Rolle `Tools.User` hat, und passende Abschnitte des Handbuchs (6.11). Diese Treffer stehen sofort da, auch während der Server noch sucht oder wenn seine Suche fehlschlägt.
- Schnellsuche (Strg+K / ⌘K, Suchfeld in der Kopfzeile, am Handy „Suche“ unten): findet Seiten der Navigation nach Name, Gruppe und Bereich, nur mit Recht, ganz im Browser; ohne Eingabe „Zuletzt besucht“. „In allen Einträgen suchen“ führt zur Seite „Suche“ mit dem Suchbegriff.

### 6.10a Navigation, Anheften und „Zuletzt besucht“

- Bereichsleiste (ein Symbol je Bereich), Seitenmenü mit Gruppen und Kontomenü; am Handy eine Leiste unten mit Menü als Blatt (Gestaltung: `docs/design.md`, Kapitel 1). Bereiche, Gruppen und Seiten nach Rollen in `areasFor` (`frontend/src/navigation.ts`).
- Anheften und „Zuletzt besucht“ werden je Person auf dem Server gespeichert (Tabelle `nav_entries`, Migration 0051): `GET /api/navigation`, `PUT /api/navigation/pins` (höchstens 20, Reihenfolge wie übergeben), `POST /api/navigation/recent` (die letzten 10 bleiben), `DELETE /api/navigation/recent`. Nur eigene Einträge; nur Pfade aus der Liste erlaubter Seiten in `core/navigation.py`, die dieselbe Rollenlogik spiegelt; beim Ausgeben wird erneut nach Rollen gefiltert. Ohne Netz zeigt die Oberfläche den zuletzt geladenen Stand; der Service Worker speichert nichts davon.
- Aufgabe für `Bestand.Editor`: „Offene Vorgänge bearbeiten“ (neue und angefangene Vorgänge im IT-Bestand, `modules/inventory/tasks.py`).

### 6.11 Handbuch

- Seite „Handbuch“ (`/handbuch`) für alle, erreichbar über die Bereichsleiste (unten; am Handy im Menü unter „Alle Bereiche“), die Seite „Konto“ und die Suche. Kapitel je Bereich (`/handbuch/<kapitel>`, Abschnitte als Sprungziel `#<abschnitt>`), mit Inhaltsverzeichnis, Anleitungen in Schritten, Begriffen, Hinweisen und Verweisen auf die Seiten der Werkbank.
- Jede Person sieht die allgemeinen Kapitel und die ihrer Rollen; einzelne Abschnitte können auf Rollen beschränkt sein. `Werkbank.Admin` sieht alles. Ein Kapitel ohne passende Rolle gilt als nicht vorhanden.
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
- **Ablauf mit UTCM:** Der Worker lässt UTCM einen Snapshot der eingetragenen Ressourcentypen (`COLLECTOR_RESOURCES`) erstellen, wartet auf das Ergebnis, lädt es herunter und vergleicht es selbst mit dem Bestand (7.3). Den Verlauf hält die Werkbank; UTCM bewahrt Snapshots höchstens 7 Tage auf. Die UTCM-Monitore werden nicht genutzt.
- **Grenzen von UTCM:** höchstens 20.000 gelesene Objekte pro Tenant und Monat, höchstens 12 sichtbare Snapshot-Aufträge. Die Werkbank zählt die gelesenen Objekte je Abruf, warnt ab 80 % und ruft bei ausgeschöpftem Kontingent nicht mehr ab. Eigene, abgeschlossene Snapshot-Aufträge entfernt sie wieder.
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

Evergreen ist nur für die IT (seit 0.76; vorher Freigabe-Ablauf mit Betriebsrat und Geschäftsführung, dessen Daten beim Update gelöscht wurden). Je Software gibt es einen Unterabschnitt; zurzeit **Microsoft 365** (`/evergreen/m365`), weitere können folgen (`software` am Eintrag).

### 8.1 Quellen für Einträge

1. **Nachrichtencenter** (Graph `admin/serviceAnnouncement/messages`): Der Worker liest alle 6 Stunden (`MESSAGE_CENTER_INTERVAL_HOURS`) die seit dem letzten Abruf geänderten Meldungen, beim ersten Mal die der letzten 30 Tage. Aktiv, sobald der Collector eingerichtet ist; die Collector-App braucht `ServiceMessage.Read.All`. **Jede** Meldung wird ein Eintrag mit Status „neu“. Übernommen werden Titel, Dienste, Kategorie, „Major Change“, „Action required by“, Veröffentlichung, letzte Änderung und der Text ohne HTML. Ändert Microsoft eine Meldung, werden die Angaben überschrieben und im Verlauf vermerkt („Meldung aktualisiert“); der Status bleibt.
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

### 8.3 Liste und Ansicht

- Nummer `EV-JJJJ-NNN`. Tabelle wie die Vorgänge im IT-Bestand: Nr., Titel (mit Kennzeichen „Größere Änderung“), Dienst, Eingang, Bearbeitet von (wer zuletzt etwas eingetragen hat), Status; Filter Offen, Neu, Bearbeitet, Abgeschlossen, Alle; Suche in Nummer, Titel, Kennung der Meldung, Diensten und Text; 50 je Seite.
- Ansicht rechts daneben mit einstellbarer Breite (`werkbank-evergreen-breite` im Browser), schmal über die ganze Breite mit „Zur Liste“.
- Aufgabe auf der Startseite und Benachrichtigung „Neue Einträge“ nur für `Evergreen.Editor`.

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
- **Budgetposten:** Ein Budgetposten ist ein Vorhaben unter einem Konto, z. B. ein Projekt oder eine Software. Er wird als ein Vorgang angelegt („Posten hinzufügen“): Konto, Bezeichnung (je Konto eindeutig), erwartete Kosten je Geschäftsjahr (brutto) und Laufzeit (einmalig, mehrere Jahre bis zu einem Geschäftsjahr oder bis auf Weiteres, ab einem Geschäftsjahr). Die erwarteten Kosten gelten in jedem Jahr der Laufzeit; sie sind der Plan. Optional ein Vertrag; ein Posten hat höchstens einen. Optional ein IT-Projekt (Kapitel 8c); ein Posten gehört höchstens zu einem, abgeschlossene Projekte sind nur wählbar, wenn der Posten schon dazugehört. Tags, Notiz und Stilllegen stehen unter „Weitere Angaben“. Einen Partner hat der Posten nicht; der Partner steht an der Rechnung.
- **Status je Geschäftsjahr:** Ein Posten ist in jedem Jahr seiner Laufzeit „offen“; sobald eine Rechnungsposition auf ihm liegt „Rechnung liegt vor“; „abgeschlossen“, sobald eine gebuchte Position mit dem Kennzeichen „schließt den Posten ab“ auf ihm liegt oder jemand mit `Budget.Editor` oder `Budget.Manager` den Posten unter „Budgetposten“ für das gewählte Geschäftsjahr abhakt („Abschließen“; gespeichert je Posten und Jahr in `budget_item_closures`, Audit `budget.posten_abgeschlossen`). „Wieder öffnen“ nimmt nur das Abhaken zurück (`budget.posten_wieder_geoeffnet`); schließt eine Rechnungsposition ab, bleibt der Posten zu, bis das Kennzeichen an der Position entfernt wird. Das Geschäftsjahr einer Position bestimmt das Rechnungsdatum. Der Status aus Rechnungen wird nicht gespeichert, sondern aus den Positionen gerechnet.
- **Mehrjahresübersicht:** Erwartete Kosten, Ist und Status aller Budgetposten über fünf Geschäftsjahre, als Ausblick (ab dem laufenden) oder Rückblick (bis zum laufenden). Eingegeben wird hier nichts; die Zahlen ergeben sich aus Laufzeit und Rechnungen.
- **Excel-Export:** Die Mehrjahresübersicht lässt sich als Excel-Datei herunterladen: ein Blatt mit erwarteten Kosten, Ist und Status je Posten und Jahr, ein Blatt mit allen Rechnungspositionen des Zeitraums. Texte stehen als Text in den Zellen, nie als Formel. Die Datei schreibt die Werkbank ohne Zusatzpaket.
- **Tags:** Die Tags stehen in einer Liste, die nur `Budget.Manager` unter Einstellungen pflegt: anlegen, umbenennen, löschen (je höchstens 30 Zeichen, ohne Komma, eindeutig ohne Rücksicht auf Groß- und Kleinschreibung). Ein Budgetposten wählt bis zu zehn Tags aus dieser Liste; andere nimmt der Server nicht an. Umbenennen ändert den Tag auch an allen Posten und gespeicherten Statistiken, Löschen entfernt ihn dort; eine Statistik ohne verbleibenden Tag wird gelöscht. Bei der Einführung kamen alle bis dahin vergebenen Tags in die Liste. Die Seite Budgetposten filtert nach Tag, Status und Suchtext, die Suche über alle Module findet Budgetposten über Name, Notiz und Tag (nur mit einer Rolle des Budgets).
- **Statistik:** Wertet alle Budgetposten mit gewählten Tags über fünf Geschäftsjahre aus: erwartete Kosten und Ist (gebuchte Rechnungspositionen, brutto) je Jahr als Diagramm und Tabelle, dazu die passenden Posten. Vorgabe: einer der Tags reicht; wahlweise müssen alle gewählten Tags am Posten stehen. Zeitraum: Rückblick (die fünf Jahre bis zum laufenden) oder Ausblick (das laufende und die vier folgenden). Eine Auswahl lässt sich unter einem Namen speichern; gespeicherte Statistiken sehen alle Rollen des Budgets, anlegen und löschen dürfen Budget.Editor und Budget.Manager.
- **Audit:** Jede Änderung an Einstellungen, Konten, Budgetposten (mit erwarteten Kosten und Laufzeit vorher und nachher), Verträgen, Partnern, Rechnungen und gespeicherten Statistiken steht im Audit-Log (Modul `budget`).
- **Partner:** Firmen als Vertragspartner, Rechnungssteller oder beides, mit eigener Kundennummer. Keine Personen. Partner werden stillgelegt, nicht gelöscht.
- **Verträge:** Bezeichnung, Vertragspartner, abweichender Rechnungssteller, keiner, einer oder mehrere zugeordnete Budgetposten (ein Posten gehört höchstens zu einem Vertrag; die Zuordnung lässt sich am Vertrag und am Posten pflegen, ein Posten mit anderem Vertrag ist am Vertrag nicht wählbar), Betrag je Zahlung netto mit Steuersatz (das Brutto rechnet der Server, kaufmännisch gerundet; fürs Budget zählt das Brutto), Turnus (monatlich, vierteljährlich, halbjährlich, jährlich, einmalig), Beginn, Ende der Laufzeit, Verlängerung, Kündigungsfrist, Kündigungstag und Stand des Auftragsverarbeitungsvertrags (AVV). Die Zuordnung zeigt nur, zu welchen Posten der Vertrag gehört; die Kosten des Vertrags gehen allein über die Rechnungspositionen ins Budget, nichts wird aufgeteilt oder gebunden. **Soll und Ist je Geschäftsjahr** (Auswahl oben, Vorgabe das laufende): Soll = Summe der Zahlungen, die im Geschäftsjahr fällig werden (erste am Vertragsbeginn, dann im Abstand des Turnus; nach einer Kündigung nur bis zum Kündigungstag, danach nichts mehr). Ist = gebuchte Rechnungspositionen der zugeordneten Posten, die im Geschäftsjahr abgeschlossen sind; bei monatlichen Verträgen mit einem Posten je Monat wächst das Ist mit jedem abgeschlossenen Monat. Die Liste zeigt den Betrag je Zahlung mit Turnus, bei monatlichen, vierteljährlichen und halbjährlichen Verträgen dazu die Summe eines vollen Jahres, Soll und Ist sowie wie viele der zugeordneten Posten abgeschlossen sind.
- **Zahlungen im Geschäftsjahr:** Summe der Zahlungen eines Vertrags, die im Geschäftsjahr fällig werden, nur zur Information an Vertrag und Vertragsliste. Die erste Zahlung zählt zum Beginn, die weiteren im Turnus. Ein Vertrag mit Verlängerung läuft weiter, bis er gekündigt ist.
- **Kündigungstermin:** Ende der Laufzeit abzüglich der Kündigungsfrist; ist er für die laufende Laufzeit verstrichen, gilt der Termin der nächsten. Die Übersicht listet Termine der nächsten 120 Tage; ab 60 Tagen vorher steht der Vertrag als Aufgabe auf der Startseite (für `Budget.Editor` und `Budget.Manager`).
- **Rechnungen:** Eine Rechnung hat einen Kopf (Rechnungssteller, Rechnungsnummer, interne Nummer, Rechnungsdatum) und eine bis 50 Positionen. Jede Position gehört zu genau einem Budgetposten und hat Netto, Steuersatz, Brutto, Bezeichnung und die Kennzeichen „Projekt“ und „jährlich“. So lässt sich eine Rechnung auf mehrere Budgetposten verteilen und kann mehrere Steuersätze enthalten. Das Brutto je Position rechnet der Server aus Netto und Steuersatz; ein von Hand eingetragenes Brutto darf höchstens 1 Euro abweichen. Die Rechnung trägt die Summen ihrer Positionen. Wird der Rechnungsbetrag laut Beleg angegeben, muss er der Summe der Positionen entsprechen. Das Rechnungsdatum entscheidet über das Geschäftsjahr; das Ist zählt je Position beim Budgetposten der Position. Jede Position hat zusätzlich das Kennzeichen „schließt den Posten ab“; ohne Angabe ist es gesetzt, außer der Budgetposten hat einen Vertrag (laufende Zahlungen). Einen eigenen Vertrag hat die Position nicht; angezeigt wird der Vertrag ihres Budgetpostens. In der Maske wählt jede Position ihren Budgetposten aus einer nach Status im Geschäftsjahr des Rechnungsdatums gruppierten Liste, die sich über ein Suchfeld eingrenzen lässt.
- **Prüfung:** `Budget.Editor` erfasst mit dem Stand „zu prüfen“. `Budget.Manager` prüft und bucht; erfasst er selbst, ist die Rechnung sofort gebucht. Nur gebuchte Rechnungen zählen zum Ist. Gebuchte Rechnungen ändert und löscht nur der Budgetverwalter. Offene Rechnungen stehen ihm als Aufgabe auf der Startseite.
- **Beleg:** An jede Rechnung lässt sich ein PDF hängen (höchstens 15 MB, geprüft wird der Dateianfang, nicht die Endung). Die Datei liegt außerhalb der Datenbank in einem eigenen Volume unter einem zufälligen Namen; der Dateiname zur Anzeige steht in der Datenbank. Herunterladen dürfen alle mit Budget-Rolle, immer als Download. Hochladen, ersetzen und entfernen darf, wer die Rechnung ändern darf. Mit der Rechnung wird auch der Beleg gelöscht. Einen Virenscan gibt es nicht.
- **Ist und Prognose:** Ist = Summe der gebuchten Rechnungspositionen (brutto) im Geschäftsjahr. Prognose = bei einem abgeschlossenen Posten das Ist, sonst das Höhere aus erwarteten Kosten und Ist. Abweichung = Prognose minus erwartete Kosten. Ein Budget je Konto gibt es nicht; das Konto zeigt die Summen seiner Posten.
- **Partner im Detail:** Verträge der Firma (als Vertragspartner oder Rechnungssteller), die Budgetposten, denen diese Verträge zugeordnet sind oder auf denen ihre Rechnungspositionen liegen, und ihre Rechnungen aus allen Jahren. `Budget.Manager` kann einen Partner mit einem anderen zusammenlegen: Verträge und Rechnungen wandern zum Ziel, der Quellpartner wird gelöscht (nicht umkehrbar, steht im Audit-Log).
- **Löschen:** Verträge, Budgetposten, Rechnungen und Partner lassen sich nach Bestätigung löschen (`Budget.Editor`, `Budget.Manager`; gebuchte Rechnungen nur `Budget.Manager`). Ein Vertrag jederzeit, seine Budgetposten bleiben dann ohne Vertrag; ein Partner nur ohne Verträge und Rechnungen; ein Budgetposten nur, solange ihm kein Vertrag zugeordnet ist und keine Rechnungsposition auf ihm liegt. Mit einem Vertrag wird auch seine Zuordnung zu Posten gelöscht. Konten werden weiter nur stillgelegt. Jedes Löschen steht im Audit-Log.
- **Oberfläche:** Alle Seiten haben denselben Kopf mit Kostenstelle und laufendem Geschäftsjahr. Das auf einer Seite gewählte Geschäftsjahr gilt für die anderen mit, bis die Werkbank neu lädt. Formulare öffnen sich über den Knopf „… anlegen“ oder „Bearbeiten“ oberhalb der Tabelle. Wer nur lesen darf, sieht einen Hinweis.
- **Stand:** Einstellungen, Konten, Budgetposten mit Status, Partner, Verträge, Rechnungen mit Positionen, Übersicht, Mehrjahresübersicht mit Excel-Export, Tags, Statistik und der Import aus Excel sind umgesetzt.
- **Import aus Excel** (`/budget/import`, nur `Budget.Manager`): Je Datei ein Vorgang, je Zeile eine Entscheidung. Hochladen (.xlsx bis 10 MB, eigenes Lesen ohne Zusatzpaket: erstes sichtbares Blatt, Archiv- und Größengrenzen, XML mit DOCTYPE oder ENTITY wird abgelehnt; die Datei wird nicht gespeichert) legt einen Entwurf an. Erkannt werden: Geschäftsjahr aus der Überschrift („… 2026 / 2027“), Kopfzeile mit Rech.Nr. (interne Nummer), Firma, Kosten (brutto), Datum, RE (Rechnungsnummer), Bezeichnung, die Kontospalten (Kontonummer in der Zeile darüber; das Konto einer Zeile ist die Spalte, in der ihr Betrag steht) und „Jährlich“; darunter je Konto Nummer, Budget und Bezeichnung. Die erste Spalte (Kostenstelle) und „Projekte“ werden nicht übernommen. Beim Start wählt man Geschäftsjahr, Steuersatz als Vorgabe (19 %, 7 %, 0 %) und die Art neuer Konten; fehlende Konten werden angelegt; das Budget je Konto aus der Datei wird nicht als Posten übernommen. Jede Zeile wird geprüft (Partner: gleicher Name, ähnlicher Name ohne Rechtsform, schon für die Firma entschieden oder neu; Datum, Nummern, Bezeichnung, Konto, Betrag, Steuersatz, Jährlich) und übernommen oder übersprungen (wieder zu öffnen). Übernehmen legt je Zeile einen eigenen Budgetposten an (Name aus der Bezeichnung, sonst der Partner; im Konto schon vorhanden: mit Nummer, z. B. „Mobilfunk (2)“; erwartete Kosten = Betrag, nur im Geschäftsjahr des Imports) und eine gebuchte Rechnung mit einer Position, die den Posten abschließt (Netto aus Brutto gerechnet; dieselbe Rechnungsnummer beim selben Partner wird abgelehnt). Hinweise: Datum außerhalb des Geschäftsjahrs, keine Rechnungsnummer (interne Nummer wird vorgeschlagen), kein oder mehrere Konten, keine Firma. Übernommene Zeilen mit „Jährlich“ lassen sich in die Planung übernehmen: Ihr Posten läuft im folgenden Geschäftsjahr weiter (bis auf Weiteres oder nur dieses Jahr), mit den eingetragenen erwarteten Kosten je Jahr; es entsteht kein zweiter Posten. Offene Vorgänge stehen als Aufgabe auf der Startseite. Löschen eines Vorgangs lässt Rechnungen, Konten, Partner und Posten stehen. Alles im Audit-Log (`budget.import_…`).

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
- **Stand:** Subnetz-Rechner, Subnetting-Bits, Netze zusammenfassen, Firewall-Regeln prüfen, MAC-Adressen (Herstellerliste der IEEE eingebaut), Port-Nachschlagewerk, chmod-Rechner, Base64, URL-Encoder, HTML-Entities, JWT-Decoder, SAML-Decoder, JSON-, YAML- und XML-Formatter, SQL (Formatter und JOINs), CSV ↔ JSON, JSON ↔ YAML ↔ TOML, Zahlensysteme, Unix-Zeitstempel, Zeitzonen-Umrechner, Schreibweise ändern, Listen bereinigen, Regex-Tester, Zeichen zählen, Text-Diff, Cron-Ausdruck erklären, die Rechner (RAID, Speichereinheiten, Speicherbedarf, Übertragungsdauer, Verfügbarkeit, Stromkosten, USV, VoIP-Bandbreite), die Tools für AD und M365 (AD-Zeitstempel, DN-Zerleger, ImmutableID ↔ objectGUID, LDAP-Escaper, userAccountControl, E-Mail-Header und Rückläufer mit .eml und .msg), die Planungs-Tools (Amortisation, Backup-Planer, Netzplan mit kritischem Pfad, Nutzwertanalyse), Bild-Konverter, die Zertifikats-Tools (Zertifikate anzeigen und umwandeln mit PEM, DER, P7B, PFX und .p15 für APC-Netzwerkkarten; CSR erstellen), die Abfrage-Tools (DNS Lookup mit Subdomain-Suche, DNS-/Mail-Check, RDAP, Passwort prüfen) und die Generatoren (UUID, Passwort, Passphrase, Passwort-Hash, Prüfsummen, HMAC, QR-Code, Lorem ipsum).
- **Was nie im Link steht:** Kennwörter, eingegebene Texte, Listen von Netzen, Regelwerke, MAC-Adressen, E-Mail-Header, die Tabellen von Netzplan und Nutzwertanalyse, die Inhalte von QR-Codes, Bilder, Zertifikate, Schlüssel und die Angaben eines CSR (Namen und SANs), abgefragte Domains, Namen und Adressen. Ein Verweis aus einem anderen Tool darf eine Domain mitgeben; das Tool übernimmt sie und nimmt sie sofort aus der Adresszeile. Der OpenSSL-Befehl im CSR-Tool setzt die Namen in einfache Anführungszeichen.
- **Dateien aus den Tools:** Downloads entstehen im Browser über eine kurzlebige `blob:`-Adresse. Vorschaubilder werden als `data:`-Adresse angezeigt, weil die Sicherheitsrichtlinie (`img-src 'self' data:`) keine `blob:`-Bilder erlaubt. Texte, die aus einem Link in einen Befehl zum Kopieren gelangen (Port-Nachschlagewerk), werden auf harmlose Zeichen beschränkt.

## 8b. Bereich IT-Monitoring

Regelmäßige Prüfungen der IT. Zugriff: Rolle `Monitoring.Reader` und `Werkbank.Admin` (serverseitig geprüft).

### DNS-Abgleich mit NetBox (`/monitoring/dns`)

- Auftrag `monitoring.dns_netbox` alle 4 Stunden; Admins ziehen ihn mit „Jetzt prüfen“ vor.
- Liest aus NetBox (Plugin netbox-dns) Zonen und Einträge, wahlweise einer View. Ausgenommen: nicht aktive Zonen, Reverse-Zonen privater Adressen, extern verwaltete Subdomains (NS-Delegation ohne eigene Zone; nur deren NS-Einträge werden geprüft). Geprüfte Typen: A, AAAA, CNAME, MX, TXT, SPF, CAA, NS, SRV, PTR, SOA; andere werden gezählt und genannt.
- **Nur die Einträge aus NetBox:** Je Name und Typ eine Abfrage im öffentlichen DNS über einen der festen Resolver (DNS über HTTPS, wie die IT-Tools). Keine Suche nach Neuem (keine typischen Namen, kein crt.sh).
- Status je Name und Typ: in Ordnung, abweichend (andere oder zusätzliche Werte; mit TTL-Vergleich auch öffentlich größere TTL; SOA ohne Seriennummer), fehlt öffentlich, Fehler, inaktiv (nur inaktiv in NetBox und öffentlich nicht vorhanden; öffentlich vorhanden gilt als abweichend). Vergleich mit Normalisierung (relative Namen zur Zone, IPv6-Schreibweise, TXT-Teilstrings, CAA).
- Seite: Kennzahlen, Verlauf der letzten 90 Tage (je Tag der letzte Lauf), Ansichten „Probleme“, „Neu seit dem letzten Lauf“, „Alle“, Suche, Tabelle je Zone mit Werten aus NetBox und öffentlich, Hinweisen und Link in NetBox; Liste des nicht Geprüften.
- Gespeichert: Läufe 90 Tage (Zahlen), Zeilen nur der letzten beiden erfolgreichen Läufe. Schlägt das Lesen von NetBox fehl, gilt der Lauf als fehlgeschlagen; das letzte Ergebnis bleibt sichtbar.
- Glocke: neue Probleme gegenüber dem vorletzten Lauf (eine Benachrichtigung je Lauf) und ein fehlgeschlagener Lauf (`Monitoring.Reader`, `Werkbank.Admin`).
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
- **Standorte:** Stadt › Standort › Gebäudeabschnitt › Etage › Raum. Links der Baum (einblendbar und ausblendbar, gemerkt im Browser; Pfeil klappt jede Ebene auf und zu, der Name öffnet sie; anfangs offen nur der Weg zur Auswahl), Suche über alle Ebenen. Rechts genau die Auswahl: Stadt, Standort und Abschnitt (`/bestand/standorte/{stadt|standort|abschnitt}/{id}`) mit den Einträgen darunter, „Neuer …“, Umbenennen und Löschen; Etage mit anklickbarem Pfad, Grundriss und Raumliste, „Etage bearbeiten“ (Grundriss, Name, Reihenfolge, Löschen); gewählter Raum neben dem Grundriss mit Arbeitsplätzen, Name und Lage. Neue Städte unten im Baum. Schmal mit „Standort wechseln“. Löschen nur, was leer ist; Räume nur ohne Hardware (409).
- **Grundriss:** ein Bild je Etage (PNG, JPEG, WebP; Prüfung am Inhalt, 50 bis 12 000 Pixel je Seite, höchstens `INVENTORY_PLAN_MAX_MB`, Vorgabe 10 MB), in der Datenbank (`inventory_floor_plans`). `GET /api/inventory/floors/{id}/plan` mit `no-store`, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`; die URL trägt den ETag als Versionsparameter.
- **Räume:** Rechteck in Prozent des Grundrisses (x, y, Breite, Höhe; serverseitig auf 0 bis 100 geprüft, auf zwei Stellen gerundet). Aufziehen, Verschieben und Größe ändern mit Zeiger; für Tastatur und Bildschirmleser Zahlenfelder (WCAG 2.5.7).
- **Gerät im Raum:** optional; Anzeige als „Raum · Standort, Etage“, Reiter Standort mit hervorgehobenem Raum, Wechsel im Verlauf. Die Suche findet Räume.
- **Stellen:** Nummer aus dem Nummernkreis (Präfix plus mindestens dreistellige Zahl, Vorgabe `ST-`), Bezeichnung, Abteilung (Stammdaten), Besetzung, Notiz. Die Besetzung pflegt nur die Werkbank: Die Person wird aus Entra gewählt (`GET /api/inventory/people?q=`, nur `Bestand.Editor`, ab zwei Zeichen, höchstens 15 Treffer, nur Mitglieder; Graph `users` mit `$search`, Berechtigung `User.Read.All` der Collector-App). Gespeichert werden Objekt-ID, Name und Anmeldename zum Zeitpunkt der Auswahl. Hardware und Arbeitsplätze hängen an der Stelle, nicht an der Person. Löschen nur ohne Hardware; Verknüpfungen zu Arbeitsplätzen entfallen.
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
- **Lenovo PSREF:** in der Verwaltung bei NinjaOne einschaltbar (`psref_enabled`, Vorgabe aus). Auftrag `bestand.psref` einmal am Tag für Lenovo-Modelle mit Geräten im Bestand, höchstens 40 je Lauf mit Pause. Rechner: Modellname ist der Maschinentyp (10 Zeichen) → `/api/model/Info/SpecData?model_code=`; Monitor (Art „Monitor“): Produktschlüssel aus dem Modellnamen → `/api/product/Compare/LoadSpecData?ProductKey=`. Gespeichert am Modell: Schlüssel, Name, Link, Merkmale (Gruppe, Name, Wert), Status (`ok`, `nicht_gefunden`, `fehler`), Zeitpunkt; erneut nach 30 bzw. 7 Tagen. Reiter „Technik“: Link, Kamera/Mikrofon/Lautsprecher, Eckdaten, alle Merkmale; `POST /api/inventory/hardware/{id}/psref` (Bearbeiter) fragt sofort ab. Die Schnittstellen sind nicht offiziell dokumentiert.
- **Verleih:** Geräte an eine Person aus Entra (Objekt-ID; Name, Anmeldename und Mailadresse liest der Server selbst über `GET /users/{id}`, deaktivierte Konten abgelehnt), Rückgabedatum ab heute bis ein Jahr, mehrere Geräte je Verleih (höchstens 20), Nummer aus dem Nummernkreis `verleih` (Vorgabe `L-`). Verleihbar: aktiv, ohne Stelle und Arbeitsplatz, nicht schon offen verliehen (Teilindex). Verliehene Geräte: keine Zuordnung und kein Ausmustern (409). Rückgabe einzeln oder ganz (`POST /api/inventory/loans/{id}/return`), je Rückgabe Vorgang `rueckgabe` (Entscheidungen `lager` mit optionalem Raum, `defekt`); Datum ändern `PUT /api/inventory/loans/{id}/due`. Auftrag `bestand.verleih` alle 15 Minuten: Erinnerung zwei Tage vor dem Datum (nur wenn der Verleih vorher begann), überfällig am Tag danach und dann alle 7 Tage, Vorgang `ueberfaellig` je Rückgabedatum (Entscheidungen `verlaengert` mit neuem Datum, `geklaert`; automatisch `zurueck`, wenn alles zurück ist), danach Versand. Nachrichten an die Person je Anlass über Mail und Teams (Workflow wie in 6.7, Empfänger ist die Mailadresse aus Entra), Inhalt nur Verleihnummer, Datum und Name der Person in der Anrede; bis 5 Versuche, nach 3 Tagen verfallen; ohne SMTP, Teams oder Mailadresse Status „aus“. Tage nach Europe/Berlin.
- **Abgleich mit Entra:** Auftrag `bestand.entra` jede Stunde (nur wenn die Verbindung zu Entra eingerichtet ist). Geprüft werden die Personen an Stellen und in offenen Verleihen über `GET /users/{id}` (höchstens 2000 je Lauf); ist Entra nicht erreichbar, ändert der Lauf nichts. Aktives Konto: Name und Anmeldename an Stelle und Verleih (dort auch die Mailadresse) werden nachgezogen, mit Verlaufseintrag an der Stelle bzw. an den verliehenen Geräten. Deaktiviertes oder gelöschtes Konto: Stand in `inventory_person_states` (`inactive_since`), je Stelle und offenem Verleih ein Vorgang `person_inaktiv` einmal je Zeitraum der Inaktivität. Entscheidungen: bei Stellen `frei`, `nachfolge` (neue Person, der Server liest sie aus Entra, nur aktive Konten), `lassen`; beim Verleih `geklaert`; automatisch `wieder_aktiv` (Konto wieder aktiv) und `zurueck` (Verleih vollständig zurück).
- **Statistik** (`/bestand/statistik`, `GET /api/inventory/statistics`, Rolle `Bestand.Reader` oder `Bestand.Editor`): Zählungen über die aktiven Geräte, Filter `maker` (Hersteller-ID, 0 = ohne Hersteller). Auswertungen: je Art, je Modell (12 größte, Rest „Andere“), Alter (Anschaffungsdatum, ersatzweise Baujahr aus dem Custom Field; Gruppen in ganzen Jahren bis „6 Jahre und älter“, sonst „unbekannt“), je Standort (über den Raum), wo die Geräte sind (verliehen, an Stelle, am Arbeitsplatz, im Lager), Betriebssystem aus NinjaOne (10 größte, Rest „Andere“), Verleih (offen, überfällig, neue Verleihe je Monat der letzten 12 Monate; mit Filter nur Verleihe mit Geräten des Herstellers), Ausmusterungen je Jahr mit Gründen. Oberfläche: je Auswertung Umschalter Balken/Kreis (Kreis mit höchstens 8 Stücken, Rest „Andere“), Tabelle mit Anteil. Neues Feld **Anschaffungsdatum** am Gerät (ab 1990, nicht in der Zukunft), Änderung im Verlauf.
- **Ort auf den Detailseiten:** `GET /api/inventory/whereabouts/{stelle|arbeitsplatz|geraet}/{id}` liefert je Etage die Räume und Arbeitsplätze (Gerät: eigener Raum, sonst über Arbeitsplatz, sonst über die Arbeitsplätze der Stelle, mit `via`). Die Etage (`GET /floors/{id}`) liefert die gesetzten Plätze umgerechnet in Prozent der Etage, dazu für das Info-Fenster Typ, Stellen mit Person und die aktive Hardware am Arbeitsplatz und an seinen Stellen (höchstens 6, Rest als Zahl). Im Grundriss (Detailseiten und „Standorte“, nicht im Bearbeiten-Modus) sind die Plätze Schaltflächen (Treffer 24 px): Maus darüber oder Tastaturfokus zeigt das Info-Fenster, Klick öffnet den Arbeitsplatz; bei Berührung öffnet das erste Antippen das Info-Fenster, das zweite den Arbeitsplatz. Der Text steht auch als Name der Schaltfläche für Screenreader. Oberfläche: Ortszeile unter dem Titel, Reiter „Standort“ mit Grundriss, hervorgehobenen Räumen und markierten Plätzen; Stelle mit Wahl der Etage; beim Arbeitsplatz Platz setzen per Klick oder per Zahlen.
- **Benachrichtigungen:** `bestand.vorgang_neu` (Bestand.Editor) und `bestand.abgleich_fehlgeschlagen` (Bestand.Editor, Admin), nur Nummer und Link.
- **Audit:** alle Änderungen an Geräten, Stellen, Arbeitsplätzen, Standorten, Grundrissen und Stammdaten (Modul `bestand`), ohne Namen von Personen (bei Stellen nur „besetzt ja/nein“).

## 9. Datenmodell (Überblick)

Kern:

| Tabelle | Wichtige Felder |
|---|---|
| `users` | id, entra_oid, anzeigename, mail, zuletzt_angemeldet, push_aktiv |
| `sessions` | id, user_id, erstellt, zuletzt_aktiv, ablauf, step_up_zeit |
| `modules` | key, name, aktiv, version |
| `tasks` | id, module, objekt_typ, objekt_id, titel, untertitel, rolle, user_id?, faellig, erledigt |
| `workflow_instances` | id, workflow, objekt_typ, objekt_id, schritt, endzustand |
| `workflow_events` | id, instance_id, schritt, aktion, entscheidung, kommentar, user_id, im_auftrag_von?, zeitpunkt |
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
| `ev_notes` | id, entry_id, art (notiz, abgeschlossen, geoeffnet, aktualisiert), text, user_id?, zeitpunkt |

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
| IT-Budget › Übersicht | Budget.* | Kennzahlen, Budget nach Konten als Balken, Kündigungstermine der nächsten 120 Tage, Handlungsbedarf |
| IT-Budget › Budgetposten | Budget.* (Ändern: Budget.Editor, Budget.Manager) | Posten eines Geschäftsjahrs mit Status, erwarteten Kosten, gebunden, Ist, Prognose, Abweichung und Vorjahr; Posten hinzufügen, ändern, stilllegen, löschen; Filter nach Suchtext, Status und Tag |
| IT-Budget › Mehrjahresübersicht | Budget.* | Erwartete Kosten, Ist und Status je Budgetposten über fünf Geschäftsjahre, Ausblick oder Rückblick; Export als Excel-Datei |
| IT-Budget › Statistik | Budget.* (Speichern und Löschen: Budget.Editor, Budget.Manager) | Erwartete Kosten und Ist der Budgetposten mit gewählten Tags über fünf Geschäftsjahre; gespeicherte Auswahlen |
| IT-Budget › Verträge | Budget.* (Ändern: Budget.Editor, Budget.Manager) | Verträge mit Partnern, Jahreskosten, nächstem Kündigungstermin und AVV; anlegen, ändern, kündigen; Detail je Vertrag mit Vertragsdaten, Fristen und Zuordnung zum Budget |
| IT-Budget › Rechnungen | Budget.* (Erfassen: Budget.Editor, Budget.Manager; Buchen: Budget.Manager) | Rechnungen eines Geschäftsjahrs; erfassen, ändern, prüfen und buchen, löschen |
| IT-Budget › Partner | Budget.* (Ändern: Budget.Editor, Budget.Manager) | Vertragspartner und Rechnungssteller; anlegen, ändern, stilllegen; Detail je Firma mit Verträgen, Budgetposten und Rechnungen; zusammenlegen (Budget.Manager) |
| IT-Budget › Konten | Budget.* (Ändern: Budget.Editor, Budget.Manager) | Liste der Konten; anlegen, ändern, stilllegen |
| IT-Budget › Einstellungen | Budget.Manager | Beginn und Bezeichnung des Geschäftsjahrs, Kostenstelle; Liste der Tags anlegen, umbenennen, löschen |
| M365 › Snapshots | Config.* | Abrufe mit Status; Vergleich zweier Abrufe (neu, geändert, entfernt mit Vorher/Nachher); Stand eines Abrufs als JSON und CSV |
| Evergreen › Microsoft 365 | Evergreen.Reader, Evergreen.Editor | Tabelle mit Filtern (Offen, Neu, Bearbeitet, Abgeschlossen, Alle) und Suche, Ansicht rechts: Angaben, Text der Meldung, Notizen und Verlauf; Bearbeiter: Neuer Eintrag, Notiz anfügen, Abschließen, Wieder öffnen |
| Reports | später | Berichtsvorlagen, Download, geplanter Versand. Noch nicht gebaut; ohne Eintrag in der Navigation |
| Verwaltung (eigener Bereich in der Navigation) | Admin (mit Step-up) | Seiten **Allgemein** (Branding, Aufbewahrung des Audit-Logs, Vorlauf für ablaufende Zertifikate und Secrets), **Rollen** (nach Rolle oder nach Person, jeweils mit den Rollen der letzten Anmeldung), **Mail & Teams** (SMTP-Server, Teams), **Verbindungen** (KI-Texte, NetBox, Abfragen ins Internet) und **Audit-Log**. Später: Module, Kommentarregeln |
| Verwaltung › Audit-Log | Admin | Filterbare Tabelle, Export |
| Konto | alle | Name, E-Mail, Profilbild, Rollen, Sitzung, Darstellung (hell/dunkel) und Schriftgröße im Menü (klein, normal, groß, sehr groß) und Abstände im Menü (kompakt, normal, weiträumig; mit Touch mindestens 44 px; je Browser, nur Navigation), Benachrichtigungen je Art mit Glocke, Mail, Teams und Push, Push je Gerät ein und aus mit Liste der Geräte und Testnachricht, auf iPhone/iPad Hinweis zur Installation, Version |
| Benachrichtigungen | alle | Die letzten 100 Benachrichtigungen, alle als gelesen markieren, Verweis auf die Einstellungen im Konto. Die Glocke in der Kopfzeile zeigt die Zahl der ungelesenen und die neuesten zehn |
| Neuigkeiten | alle | Änderungen je Version, die man in der Anwendung bemerkt |
| IT-Projekte › Alle Projekte | Projekte.* (Anlegen: Projekte.Editor) | Liste mit Status, veranschlagt, geplant, Ist, offenen Punkten, letztem Jour Fixe; Filter, Suche, neues Projekt |
| IT-Projekte › Projekt | Projekte.* (Einstellungen und Ändern: Projekte.Editor) | Reiter Übersicht, Budget, Jour Fixe (Markdown mit Leiste und Vorschau, PDF-Anhänge), Aufgaben, Einstellungen |
| IT-Bestand › Hardware | Bestand.* (Erfassen: Bestand.Editor) | Liste mit Status, Suche, Filter nach Art, Kartenansicht auf schmalen Bildschirmen; Gerät erfassen |
| IT-Bestand › Gerät | Bestand.* (Ändern: Bestand.Editor) | Reiter Übersicht (Bearbeiten, Inventurnummer mit Rückfrage, Ausmustern, Wieder in Betrieb nehmen) und Verlauf |
| IT-Bestand › Stammdaten | Bestand.* (Pflegen: Bestand.Editor) | Hardware-Arten, Hersteller und Modelle, Gründe fürs Ausmustern |
| DNS-Abgleich mit NetBox | Monitoring.Reader, Admin | Kennzahlen, Verlauf 90 Tage, Kacheln je Stand als Filter, Filter Probleme/Abweichend/Fehlt öffentlich/Fehler/In Ordnung/Neu/Alle mit Anzahl, Suche, Tabelle je Zone mit der Zone als Überschrift, „Jetzt prüfen“ für Admins |
| Handbuch | alle | Kapitel je Bereich nach Rollen, Suche im Handbuch, je Kapitel Inhaltsverzeichnis und Abschnitte mit Verweisen |
| Offline | alle | Hinweis „Keine Verbindung“, erneut versuchen |

Der klickbare Entwurf („Werkbank – Oberfläche“) ist die visuelle Referenz.

**Stand der Umsetzung (Version 0.55):** Alle Seiten der Tabelle sind nach dem Entwurf gebaut, auch das Handbuch, Push und Vergleich und Export der Snapshots. Noch nicht vorhanden: Reports. (Kennzeichen „Mitbestimmung“ und PDF der BR-Vorlage entfallen mit dem Umbau von Evergreen in 0.76.)

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
| Container-Scan | jeder PR, wöchentlich | Trivy |
| Statische Analyse | jeder PR, wöchentlich | CodeQL (Python, JavaScript/TypeScript), Semgrep (inkl. XSS-Regeln) |
| Secrets | jeder Push, wöchentlich | gitleaks |
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
│   ├── werkbank/core/          # Anmeldung, Sitzungen, Rollen, Workflow, Audit, Aufgaben, Profilbild
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
| – | Oberfläche nach dem Entwurf, heller und dunkler Modus, Neuigkeiten, Konto mit Profilbild, automatische Releases | einheitliches Aussehen | ✅ umgesetzt, mit Handbuch und letzten Aktivitäten auf der Startseite |
| 4 | Ausbau: Exchange, Teams, Intune, SharePoint, Benachrichtigungen, Push | Vollumfang v1 | 🔄 weitgehend: Exchange, Teams, Intune und SharePoint (Konfiguration), Benachrichtigungen (Glocke, Mail, Teams, Push) umgesetzt |
| 5 | weitere Module nach Bedarf | – | offen |

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
