# Werkbank – Spezifikation

| | |
|---|---|
| Status | Entwurf v0.2 – zur Abstimmung |
| Stand | 14.11.2026 |
| Verantwortlich | IT-Leitung |
| Lizenz | MIT (Open Source) |

> Dieses Dokument beschreibt **was** die Werkbank kann (Funktionen, Datenmodell, Screens) und **unter welchen Bedingungen** sie betrieben wird. Wie einzelne Teile programmiert werden, steht im Code und in den Architektur-Notizen unter `docs/`.
> Offene Entscheidungen sind mit **[OFFEN]** markiert und in Kapitel 16 gesammelt.

---

## 1. Zweck

Die Werkbank ist eine Open-Source-Web-App (installierbar als PWA) für IT-Abteilungen. Sie wird selbst betrieben (self-hosted). Sie bündelt wiederkehrende Verwaltungs- und Freigabeaufgaben in einer Oberfläche mit gemeinsamer Anmeldung, Rollen, Aufgabenliste, Protokollierung und Berichten.

Erste Module:

1. **M365-Konfiguration** – erfasst die Einstellungen des Microsoft-365-Tenants, erkennt Änderungen und führt einen Verlauf je Einstellung.
2. **Evergreen** – neue Microsoft-Funktionen bewerten, dem Betriebsrat vorlegen, von der Geschäftsführung abnehmen lassen und die Umsetzung im Tenant überwachen.

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
| Vorgang | Ein Evergreen-Fall, der den Freigabe-Workflow durchläuft. |
| Workflow | Beschriebene Abfolge von Schritten mit Rollen, Aktionen und Regeln. |
| Konnektor | Zugang zu einem externen System (Graph, Exchange Online PowerShell, …). |

---

## 3. Rahmenbedingungen

### 3.1 Betrieb

| Punkt | Festlegung |
|---|---|
| Laufzeit | Docker / Docker Compose |
| Veröffentlichung | Hinter dem **NetBird Reverse Proxy**, **öffentlich erreichbar**. TLS endet am Proxy. |
| Deployment | **Arcane Git-Sync** zieht `deploy/docker-compose.yml` aus dem Repo. Ein Merge auf `main` führt zum Deployment. |
| Netzwerkbindung | `BIND_IP` und `BIND_PORT` über `.env`. `BIND_IP` ist die Adresse, über die der NetBird Reverse Proxy den Docker-Host erreicht (NetBird-IP des Hosts oder `127.0.0.1`), **nicht** die öffentliche IP. Details: `deploy/README.md`. |
| Konfiguration | Ausschließlich über Umgebungsvariablen bzw. Docker-Secrets. `.env.example` im Repo, `.env` niemals. |
| Zeitzone | Speicherung in UTC, Anzeige in `Europe/Berlin`. |
| Sprache | Oberfläche Deutsch. Texte zentral abgelegt, damit später weitere Sprachen möglich sind. |

### 3.2 Code und Repository

| Punkt | Festlegung |
|---|---|
| Hosting | GitHub, **öffentliches** Repository [`extrempro/werkbank`](https://github.com/extrempro/werkbank). |
| Lizenz | MIT |
| Öffentlichkeit | Keine internen Informationen im Repo: keine Firmen-, Personen-, Host- oder Tenant-Namen, nur neutrale Beispieldaten. Firmenspezifisches nur über Konfiguration. |
| Branches | Arbeit nur auf Feature-Branches (`feature/…`, `fix/…`, `docs/…`). `main` ist geschützt. |
| Merge | Nur per Pull Request mit grünen Checks. PRs erstellt Claude **nur auf ausdrückliche Aufforderung**. |
| Commits | Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `security:` …) |
| Versionen | SemVer, Git-Tags `vX.Y.Z`, GitHub Releases mit Release Notes, `CHANGELOG.md` |
| Abhängigkeiten | Dependabot (pip, npm, Docker, GitHub Actions) |
| Statische Analyse | CodeQL (GitHub Code Scanning) und Semgrep |
| Secret Scanning | GitHub Secret Scanning mit Push Protection, zusätzlich gitleaks |

---

## 4. Rollen und Berechtigungen

Rollen sind **Entra-App-Rollen** der Werkbank-App-Registrierung. Zuweisung über Entra-Gruppen. Eine Person kann mehrere Rollen haben. Jede Prüfung erfolgt **serverseitig**. Das Ausblenden in der Oberfläche ist nur Komfort.

| App-Rolle | Modul | Darf |
|---|---|---|
| `Werkbank.Admin` | Kern | Verwaltung: Module, Konnektoren, Kommentarregeln, Benachrichtigungsregeln, Audit-Log vollständig |
| `Werkbank.Auditor` | Kern | Audit-Log und Reports lesen |
| `Config.Reader` | M365-Konfiguration | Einstellungen, Verlauf, Änderungen, Snapshots ansehen und exportieren |
| `Config.Reviewer` | M365-Konfiguration | zusätzlich Änderungen bewerten, Beschreibungen und Begründungen pflegen, Soll-Werte setzen |
| `Evergreen.IT` | Evergreen | technische Bewertung (Schritt 1), Umsetzung (Schritt 6), Schritte 2–3 vertretungsweise, BR-Beschluss im Auftrag erfassen |
| `Evergreen.Team` | Evergreen | Rückmeldungen der Fachabteilungen (Schritt 2), BR-Vorlage (Schritt 3), BR-Beschluss im Auftrag erfassen |
| `Evergreen.Betriebsrat` | Evergreen | vorgelegte Vorgänge sehen, Stellung nehmen (Schritt 4) |
| `Evergreen.GF` | Evergreen | Vorgänge nach BR-Zustimmung sehen, abnehmen oder zurückgeben (Schritt 5) |

Sichtbarkeit:

- Personen ohne IT-Rolle (`Evergreen.Team`, `.Betriebsrat`, `.GF`) sehen nur **Start** und **Evergreen**.
- `Evergreen.Betriebsrat` sieht nur Vorgänge ab Schritt 4, die ihm nicht übersprungen wurden. `Evergreen.GF` nur Vorgänge ab Schritt 5.
- Technische Details (Pfade, Links zu Einstellungen) sind für Nicht-IT-Rollen ausgeblendet.

---

## 5. Architektur

```
             Internet
                │  HTTPS
       ┌────────▼────────┐
       │ NetBird Reverse │
       │      Proxy      │
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
| Backend | Python 3.12+, FastAPI, SQLAlchemy 2, Alembic (Migrationen je Modul), Pydantic |
| Frontend | React + Vite + TypeScript, als PWA mit Service Worker |
| Worker | gleicher Code wie Backend, eigener Container, Job-Tabelle in PostgreSQL (keine zusätzliche Queue in v1) |
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
- **Erneute Anmeldung (Step-up)** beim Öffnen der Verwaltung, wenn die letzte Anmeldung länger als 15 Minuten zurückliegt.
- **Entra Conditional Access** mit einer eigenen Richtlinie nur für die Werkbank, da MFA im Tenant noch nicht allgemein erzwungen wird:
  - **Benutzer:** alle Gruppen mit Werkbank-Rollen (bzw. alle Benutzer)
  - **Zielressource:** Enterprise-App „Werkbank“
  - **Gewähren:** MFA erforderlich (Authentifizierungsstärke „Multifaktor-Authentifizierung“)
  - **Einführung:** zuerst „Nur Bericht“, dann „Ein“
  - Die Collector-App (Zertifikat, keine Benutzeranmeldung) ist davon nicht betroffen.
  - Voraussetzung: Entra ID P1 für alle Werkbank-Nutzer.
- Login-Seite: Name der App, Button „Mit Microsoft anmelden“, Hinweis auf Datenschutz. Ohne Anmeldung ist außer Login-Seite, Offline-Seite und statischen Dateien nichts erreichbar.
- Auf iOS als installierte PWA: Redirect statt Popup.
- **[OFFEN]** Rückfrage „Login bauen“ – siehe Kapitel 16.

### 6.2 Aufgabenliste („Meine Aufgaben“)

- Startseite für alle Rollen.
- Module melden Aufgaben über eine gemeinsame Schnittstelle: Titel, Untertitel, Modul, Fälligkeit, Ziel-Link, zuständige Rolle bzw. Person.
- Beispiele: offene Änderung prüfen (Config.Reviewer), Evergreen-Schritt (zuständige Rolle), Konnektor-Fehler (Admin).
- Zähler in der Kopfzeile und in der Navigation.

### 6.3 Workflow-Engine

Workflows werden je Modul in YAML beschrieben:

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
| Evergreen | nicht mitbestimmungspflichtig | Pflicht |
| Evergreen | BR: mit Auflagen / ablehnen | Pflicht |
| Evergreen | GF: zurückgeben | Pflicht |
| Evergreen | übrige Aktionen | optional |

### 6.5 Anhänge

- Erlaubt: PDF, PNG, JPG. Max. 10 MB je Datei. Die Prüfung erfolgt über den tatsächlichen Dateiinhalt, nicht nur über die Endung.
- Speicherung in einem eigenen Docker-Volume, Metadaten in der Datenbank. Download nur mit Berechtigung auf das zugehörige Objekt.
- **[OFFEN]** Virenscan (z. B. ClamAV-Container)?

### 6.6 Audit-Log

- Nur Anhängen erlaubt, keine Änderung, kein Löschen über die App.
- Protokolliert: Anmeldung und Abmeldung, Rollennutzung, alle Workflow-Aktionen, Bewertungen, Änderungen an Beschreibungen, Soll-Werten und Regeln, Verwaltungsaktionen, Exporte, Zugriffe auf Anhänge.
- Felder: Zeitpunkt, Person (Entra-Objekt-ID und Anzeigename), Modul, Aktion, Objekt, Ergebnis, IP (gekürzt, siehe Datenschutz).
- Aufbewahrung: **[OFFEN]** Vorschlag 2 Jahre, danach automatische Löschung bzw. Pseudonymisierung.

### 6.7 Benachrichtigungen

| Kanal | Inhalt |
|---|---|
| Mail (über Graph `sendMail`) | kurzer Hinweis mit Link, **ohne** fachliche Inhalte |
| Teams-Kanal (IT) | kritische Änderungen und Konnektor-Fehler |
| Web Push | nur „Neue Aufgabe in der Werkbank“ bzw. „Frist in X Tagen“, **keine Inhalte** |

- Push ist pro Person per Opt-in zu aktivieren und jederzeit abschaltbar.
- Erinnerungen bei Evergreen-Fristen: 14, 7 und 3 Tage vor Rollout, sofern der Vorgang noch offen ist.
- Regeln je Modul in der Verwaltung, z. B. „Änderung an Kritikalität Hoch → sofort Teams“.

### 6.8 Reports

- Erzeugung als PDF und CSV im Worker.
- Geplanter Versand per Mail mit Link, kein Anhang mit Inhalten. Abruf nach Anmeldung.
- Vorlagen liefern die Module (Kapitel 7.7, 8.7).

### 6.9 Beschreibungstexte mit KI (optional)

- Vorschläge für verständliche Beschreibungen von Einstellungen und Evergreen-Vorgängen.
- Übergeben werden nur technische Metadaten (Name, Schema-Text, Wert, Microsoft-Ankündigung), **keine personenbezogenen Daten**.
- Ergebnis gekennzeichnet als „KI-generiert, ungeprüft“, bis eine berechtigte Person es übernimmt.
- Abschaltbar in der Verwaltung. **[OFFEN]** Anbieter, Vertrag (AVV) und Freigabe durch Datenschutz.

### 6.10 Suche

Globale Suche über Einstellungen (Pfad, Name, Wert, Beschreibung, Begründung) und Vorgänge (ID, Titel, Zusammenfassung). Ergebnisse gefiltert nach Berechtigung.

---

## 7. Modul M365-Konfiguration

### 7.1 Datenquellen

| Quelle | Inhalt |
|---|---|
| UTCM (Graph beta: Snapshots, Monitore, Drifts) | breite Abdeckung über Entra, Exchange, Intune, Teams, Security & Compliance |
| Microsoft Graph (v1.0/beta) | Ergänzung für nicht abgedeckte Bereiche, Entra-Audit-Logs („wer hat geändert“) |
| Exchange Online PowerShell | Org-, Transport-, Anti-Spam-Konfiguration u. a. |
| Teams PowerShell | Richtlinien, die nicht über Graph verfügbar sind |

- Zugriff ausschließlich **lesend**, Anmeldung per **Zertifikat** (separate App-Registrierung „Werkbank Collector“).
- Abruf alle 6 Stunden (konfigurierbar), zusätzlich manuell durch Admin.

### 7.2 Normalisierung

- Jede Quelle wird in einzelne Einstellungen zerlegt: `pfad`, `wert` (JSON), `quelle`, `workload`.
- Pfadschema: `<workload>/<bereich>/<objekt>/<eigenschaft>`. Objekte werden über ihre stabile ID adressiert, der Anzeigename wird separat gespeichert.
- Konfigurierbare Liste **ignorierter Felder** (z. B. `lastModifiedDateTime`, `whenChanged`).

### 7.3 Versionierung und Änderungserkennung

- Tabelle `setting_versions` mit `gueltig_ab` und `gueltig_bis`. Eine neue Zeile nur bei geändertem Wert.
- Art der Änderung: **neu** (Pfad unbekannt), **geändert**, **entfernt** (Pfad fehlt im vollständigen Snapshot).
- Ein Snapshot mit Fehlern in einer Quelle markiert Pfade dieser Quelle **nicht** als entfernt.
- „Geändert von“: Abgleich mit Entra-Audit-Log bzw. Unified Audit Log im Zeitfenster, sonst „unbekannt“.

### 7.4 Bewertung von Änderungen

- Status: **offen**, **gewollt**, **ungewollt**.
- Bewertung durch `Config.Reviewer` mit Kommentarregeln (6.4). Sammelbewertung mehrerer Änderungen mit einem Kommentar.
- Rücksetzen einer Bewertung möglich (protokolliert).

### 7.5 Metadaten je Einstellung

| Feld | Herkunft |
|---|---|
| Beschreibung | Microsoft-Schema, KI-Vorschlag oder manuell |
| Begründung „Warum bei uns so“ | manuell |
| Kritikalität (Niedrig/Mittel/Hoch) | manuell, Vorschlag je Bereich |
| Soll-Wert | manuell oder aus Evergreen-Beschluss |
| Empfehlung/Benchmark | **[OFFEN]** Quelle (CIS-Benchmark: Lizenz klären; Microsoft-Empfehlungen) |
| Verantwortlich | Person oder Abteilung |
| Link Microsoft Learn | je Bereich hinterlegt |

Alle Metadaten haben einen eigenen Verlauf.

### 7.6 Soll/Ist

- Weicht der Ist-Wert vom Soll-Wert ab, wird die Einstellung markiert und eine Aufgabe erzeugt.
- Abweichung von einem **BR-Beschluss** löst eine sofortige Benachrichtigung aus.

### 7.7 Reports

Wochenbericht, Monatsbericht, Änderungen im Zeitraum, Abweichungen von Soll-Werten.

---

## 8. Modul Evergreen

### 8.1 Quellen für Vorgänge

1. **Nachrichtencenter** (Graph `admin/serviceAnnouncement/messages`), gefiltert nach Diensten und Kategorien. Felder: ID, Titel, Dienst, Kategorie, „Major Change“, Rollout-Datum, „Action required by“, Text.
2. **Neue Einstellung** aus dem Modul M365-Konfiguration.
3. **Manuell** angelegt (z. B. Hinweise aus Fachpresse).

Doppelte Vorgänge (gleiche Nachrichten-ID) werden verhindert. Aktualisierungen einer Meldung werden am Vorgang vermerkt.

### 8.2 Workflow

| # | Schritt | Zuständig | Aktionen | Weiter zu |
|---|---|---|---|---|
| 0 | Erkannt | automatisch | – | 1 |
| 1 | IT-Bewertung | Evergreen.IT | mitbestimmungspflichtig / nicht pflichtig* | 2 / Abgeschlossen |
| 2 | Fachabteilungen | Evergreen.Team (IT vertretungsweise) | Rückmeldungen liegen vor | 3 |
| 3 | Vorlage BR | Evergreen.Team (IT vertretungsweise) | an BR übergeben | 4 |
| 4 | Betriebsrat | Evergreen.Betriebsrat (Team/IT im Auftrag) | zustimmen / mit Auflagen* / ablehnen* | 5 / 5 / Abgelehnt |
| 5 | Geschäftsführung | Evergreen.GF | abnehmen / zurückgeben* | 6 / 3 |
| 6 | Umsetzung | Evergreen.IT | automatisch bei Soll = Ist | Abgeschlossen |

\* Kommentar Pflicht.

Endzustände: **Abgeschlossen**, **Ohne Vorlage abgeschlossen**, **Abgelehnt**.

### 8.3 Inhalte eines Vorgangs

ID (`EV-JJJJ-NNN`), Titel, Dienst, Quelle mit Referenz, Major Change, Rollout-Datum, Zusammenfassung (verständlich, ggf. KI-Vorschlag), Einschätzung Mitbestimmung mit Begründung, Rückmeldungen der Fachabteilungen, geplante Umsetzung (Liste von Soll-Werten), Kennzeichen „nicht steuerbar“, Protokoll, Anhänge (z. B. BR-Sitzungsprotokoll).

### 8.4 Fristen

- Anzeige „Rollout in X Tagen“. Rot ab 21 Tagen oder weniger.
- Erinnerungen siehe 6.7.
- Hinweis zur **vorläufigen Sperre**, wenn bis zum Rollout kein Beschluss vorliegt und die Funktion steuerbar ist. Die vorläufige Sperre wird als Soll-Wert „vorläufig bis Beschluss“ erfasst.

### 8.5 Umsetzung und Überwachung

- Für jeden Soll-Wert zeigt die Werkbank, wo bzw. mit welchem Befehl die IT ihn setzt (Anleitungstext je Einstellung).
- Schritt 6 schließt automatisch, sobald der Collector für alle Soll-Werte Übereinstimmung meldet. Manuelles Schließen ist nicht möglich.
- Danach gilt der Soll-Wert dauerhaft (7.6).

### 8.6 BR-Beschluss im Auftrag

- `Evergreen.Team` und `Evergreen.IT` können in Schritt 4 den Beschluss aus einem Sitzungsprotokoll erfassen.
- Pflicht: Sitzungsdatum und Inhalt des Beschlusses. Optional: Protokoll als Anhang.
- Protokolleintrag: „<Person> – im Auftrag des BR“.

### 8.7 Reports

Offene Vorgänge je Schritt (Tagesordnungsvorlage BR), Beschlüsse im Zeitraum, „Beschlossen vs. eingestellt“.

---

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
| `jobs` | id, typ, status, geplant, gestartet, beendet, fehler |
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
| `ev_items` | id, nummer, titel, dienst, quelle, quelle_ref, major, rollout, zusammenfassung, zusammenfassung_ki, mb_status, mb_begruendung, fachabteilungen, nicht_steuerbar, workflow_instance_id |
| `ev_plan` | id, item_id, setting_id?, bezeichnung, soll_wert, anleitung, vorlaeufig |
| `ev_br_decisions` | id, item_id, sitzung_datum, entscheidung, inhalt, erfasst_von, im_auftrag |

---

## 10. Screens

| Screen | Rollen | Inhalt |
|---|---|---|
| Login | alle | App-Name, „Mit Microsoft anmelden“, Datenschutzhinweis |
| Start / Meine Aufgaben | alle | Aufgaben aus allen Modulen, Modul-Kacheln, letzte Aktivitäten (gefiltert nach Rolle) |
| M365 › Übersicht | Config.* | Kennzahlen, Änderungen pro Tag, letzte Änderungen, Collector-Hinweise |
| M365 › Änderungen | Config.* | Liste mit Filtern, Detailbereich mit Vorher/Nachher, Audit-Eintrag, Beschreibung, Bewertung mit Kommentarregeln |
| M365 › Einstellungen | Config.* | Baum nach Workload, Detail: Wert, gültig seit, Kritikalität, Empfehlung, Soll-Wert/BR-Beschluss, Beschreibung, Begründung, Microsoft-Schema, Verlauf |
| M365 › Snapshots | Config.* | Abrufe mit Status, Vergleich zweier Snapshots, JSON-Export |
| Evergreen › Vorgänge | Evergreen.* | Liste mit Filtern (Offen, Wartet auf mich, Abgeschlossen, Alle), Detail: Frist, Schrittleiste, Zusammenfassung, Mitbestimmung, Fachabteilungen, geplante Umsetzung (Soll/Ist), Aktionen, Protokoll |
| Reports | IT-Rollen, Auditor | Berichtsvorlagen, Download, geplanter Versand |
| Audit-Log | Admin, Auditor | Filterbare Tabelle, Export |
| Verwaltung | Admin (mit Step-up) | Reiter Module, Rollen, Konnektoren, Kommentarregeln, Benachrichtigungen |
| Einstellungen (persönlich) | alle | Push an/aus, Benachrichtigungen, Hinweis zur Installation |
| Offline | alle | Hinweis „Keine Verbindung“, erneut versuchen |

Der klickbare Entwurf („Werkbank – Oberfläche“) ist die visuelle Referenz.

---

## 11. PWA, Offline, Push, iOS

- **Manifest** mit Name, Icons (inkl. maskable), `display: standalone`, Themenfarbe.
- **Service Worker**:
  - cacht **nur** die App-Hülle (HTML, JS, CSS, Icons, Schriften) und die **Offline-Seite**.
  - **Niemals** API-Antworten oder Anhänge (`/api/*` = network-only).
  - Versionierte Caches, alte Caches werden beim Aktivieren gelöscht.
  - Update: neue Version wird erkannt, die Oberfläche zeigt „Neue Version verfügbar – neu laden“. Kein unbemerkter Wechsel mitten in einer Eingabe.
  - Session- und Fachdaten liegen nie im Cache. Deshalb muss beim Abmelden nichts aus dem Cache gelöscht werden.
- **Web Push** mit VAPID. Schlüssel als Docker-Secret. Inhalte siehe 6.7.
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

- Nachweis je Anforderung in `docs/security/asvs-l2.md` (umgesetzt durch / getestet durch / nicht anwendbar mit Begründung).
- Auszug der wichtigsten Maßnahmen:
  - **Rechte:** serverseitige Rechteprüfung für jede Anfrage, Objektberechtigung (kein Zugriff über geratene IDs).
  - **Header und Cookies:** strikte CSP ohne `unsafe-inline`, HSTS (über Proxy), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. CSRF-Schutz zusätzlich zu `SameSite`.
  - **Missbrauch:** Rate-Limits für Login, API und Exporte.
  - **Eingaben:** Validierung aller Eingaben über Pydantic-Schemas. Ausgaben werden immer kodiert, keine HTML-Darstellung von Nutzertexten.
  - **Secrets:** nur als Docker-Secrets, niemals im Repo oder in Logs. Zertifikate für Konnektoren mit Ablaufüberwachung.
  - **Proxy:** Proxy-Header werden nur von der konfigurierten Proxy-IP akzeptiert (`TRUSTED_PROXY_IPS`).
  - **Abhängigkeiten:** Dependabot, wöchentlicher Audit. Container-Images mit Trivy geprüft.
  - **Fehler:** Fehlermeldungen ohne interne Details. Strukturierte Logs ohne personenbezogene Inhalte über das Nötige hinaus.

### 12.2 Datenschutz – DSGVO

- Dokumentation in `docs/datenschutz.md`:
  - verarbeitete Daten
  - Zweck
  - Rechtsgrundlage (**[OFFEN]** mit Datenschutzbeauftragtem)
  - Speicherfristen
  - Empfänger (Microsoft, Push-Dienste)
  - TOMs
  - Löschkonzept
- Datensparsamkeit: IP-Adressen im Audit-Log gekürzt, Push und Mail ohne Inhalte, keine Tracking- oder Analyse-Dienste.
- **Hinweis:** Die Werkbank protokolliert Handlungen von Beschäftigten (Audit-Log, Bewertungen). Sie ist daher voraussichtlich selbst mitbestimmungspflichtig und sollte als erster Evergreen-Vorgang behandelt werden. **[OFFEN]**

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
- **Vokabular:** Komponentenbibliothek im Frontend (`src/core/components`). Neue Screens verwenden nur diese Komponenten.

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
| Docker-Deployment | jeder PR | Images bauen, `docker compose up`, Healthchecks, Smoke-Test |
| Container-Scan | jeder PR, wöchentlich | Trivy |
| Statische Analyse | jeder PR, wöchentlich | CodeQL (Python, JavaScript/TypeScript), Semgrep (inkl. XSS-Regeln) |
| Secrets | jeder Push, wöchentlich | gitleaks |
| Abhängigkeiten | wöchentlich | Dependabot, pip-audit, npm audit, Prüfung auf ungenutzte Pakete |
| Service-Worker-Update | jeder PR | Playwright-Test: alte Version, neue Version, Update-Hinweis, keine API-Daten im Cache |

**Regelmäßige Prüfung** (wöchentlich geplant und auf Zuruf): „Prüfe auf XSS, Secrets, unnötige Dependencies und Service-Worker-Update-Probleme.“

**Branch Protection auf `main`:**

- PR erforderlich, mindestens eine Freigabe
- alle Checks grün
- kein Force-Push
- lineare Historie

---

## 14. Repository-Struktur

```
werkbank/
├── backend/
│   ├── werkbank/core/          # Auth, Rollen, Workflow, Audit, Kommentare, Aufgaben, Reports, Push
│   ├── werkbank/modules/
│   │   ├── m365_config/
│   │   └── evergreen/          # inkl. workflow.yaml
│   ├── werkbank/worker/
│   ├── migrations/
│   └── tests/
├── frontend/
│   ├── src/core/               # Layout, Komponenten, Aufgaben, Workflow-Leiste
│   ├── src/modules/
│   └── public/                 # Manifest, Icons, offline.html
├── powershell/
├── e2e/
├── deploy/
│   ├── docker-compose.yml
│   └── .env.example
├── docs/
│   ├── spec.md
│   ├── design.md
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

GitHub-Projektbeschreibung (Vorschlag): „Werkbank – interne IT-Plattform: M365-Konfigurationsüberwachung und Evergreen-Freigaben.“
Topics (Vorschlag): `internal-tool`, `microsoft-365`, `entra-id`, `evergreen`, `configuration-management`, `fastapi`, `react`, `pwa`, `docker`.

---

## 15. Phasen

| Phase | Inhalt | Ergebnis |
|---|---|---|
| 0 | Repo-Grundgerüst, CI, Doku-Gerüst | geprüftes Projekt ohne Anwendungscode; Arcane-Anbindung erst ab Phase 1 |
| 1 | Kern: Login, Rollen, Layout, Aufgaben-Gerüst, Audit-Log, Offline-Seite, Service Worker | Anmeldung und leere Module sichtbar |
| 2 | M365-Konfiguration: Collector Entra, Versionierung, Änderungen, Bewertung, Einstellungen, Verlauf | erster echter Nutzen |
| 3 | Evergreen: Nachrichtencenter, Workflow, BR-/GF-Ansicht, Soll-Werte | Freigabeprozess digital |
| 4 | Ausbau: Exchange, Teams, Intune, SharePoint, Reports, Benachrichtigungen, Push | Vollumfang v1 |
| 5 | weitere Module nach Bedarf | – |

---

## 16. Offene Punkte

| # | Thema | Frage |
|---|---|---|
| 1 | Login | Entra-Login über eigene Login-Seite der Werkbank – entschieden |
| 2 | MFA | Entschieden: eigene CA-Richtlinie „MFA für Werkbank“. Offen: Lizenz P1 für alle Nutzer prüfen, MFA-Registrierung für BR/GF vorbereiten |
| 3 | Verwaltung | Nur Step-up-Anmeldung oder zusätzlich nur über NetBird erreichbar? |
| 4 | Audit-Log | Aufbewahrungsdauer (Vorschlag 2 Jahre) |
| 5 | Anhänge | Virenscan ja/nein |
| 6 | KI-Texte | Anbieter, AVV, Freigabe Datenschutz – oder in v1 weglassen |
| 7 | Benchmarks | CIS-Benchmark nutzbar (Lizenz) oder nur Microsoft-Empfehlungen |
| 8 | Datenschutz | Rechtsgrundlage, Abstimmung mit DSB, BR-Beteiligung für die Werkbank selbst |
| 9 | Hostname | Öffentlicher Hostname der Werkbank (für Entra-Redirect-URI) |
| 10 | Mail | Absenderadresse für Benachrichtigungen |
| 11 | Copyright | Entschieden: `extrempro` |
