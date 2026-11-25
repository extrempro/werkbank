# Änderungsprotokoll

Alle nennenswerten Änderungen an der Werkbank. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionen nach [SemVer](https://semver.org/lang/de/).

## [Unveröffentlicht]

## [0.128.1] – 2026-11-25

### Behoben

- **Dokumentation, Baustein-Menü:** Die Seite springt beim Öffnen nicht mehr. Das Menü steht unter der Zeile, wenn dort Platz ist, sonst darüber (nie unter der Kopfzeile); reicht der Platz nirgends, scrollt es innen.
- **Baustein-Menü schließt nicht mehr ungewollt:** Es schließt nur noch, wenn der Fokus innerhalb der Seite woanders hingeht (Klick daneben, Tab), nicht mehr beim Wechsel in ein anderes Fenster oder eine andere App.
- **IT-Bestand:** Die Auswahl „Ausrichtung des Grundrisses“ sieht aus wie die übrigen Formularfelder (vorher kleine Standard-Auswahl des Browsers).

## [0.128.0] – 2026-11-25

### Neu

- **IT-Bestand, Grundriss drehen:** In den Einstellungen der Etage lässt sich die Ausrichtung des Grundrisses in Vierteldrehungen wählen (wie hochgeladen, 90° rechts, 180°, 90° links). Gedreht wird nur beim Anzeigen: Bild, Räume und Plätze bleiben ungedreht gespeichert, Namen bleiben waagerecht; Ziehen, Platzieren und die Lage in Zahlen gelten so, wie man den Grundriss sieht. Ein neues Bild behält die Drehung. `PUT /api/inventory/floors/{id}/plan/rotation`, Migration `0087` (Spalte `rotation` mit Prüfung auf 0/90/180/270), im Audit-Log `grundriss_gedreht`.

### Behoben

- **Bereichsleiste:** Kurznamen wie „Evergreen“, „Monitoring“ oder „Verwaltung“ wurden abgeschnitten, sobald die Leiste scrollte, weil der Scrollbalken Platz nahm. Die Leiste scrollt jetzt ohne sichtbaren Balken und ist etwas breiter.

## [0.127.0] – 2026-11-25

### Geändert

- **Handbuch und Verwaltung im Kontomenü:** Beide stehen nicht mehr in der Bereichsleiste links (bzw. am Handy unter „Alle Bereiche“), sondern im Kontomenü oben rechts; die Verwaltung nur für Admins. Innerhalb der Verwaltung und des Handbuchs bleiben die Seiten im Menü links. Handbuch, Spezifikation und E2E-Tests angepasst.

## [0.126.1] – 2026-11-25

### Behoben

- **Dokumentation, Baustein-Menü:** Das Menü (und die Formulare für Verweis und Live-Baustein) erscheint jetzt direkt unter der Schreibmarke statt oben über dem Text. Bisher sprang die Seite beim Einfügen weiter unten ganz nach oben. Die Seite rückt nur so weit, dass das Menü ganz zu sehen ist.
- **Baustein-Liste:** Die Einträge überlappten sich (Name und Beschreibung liefen ineinander, die Markierung deckte nur die erste Zeile). Jetzt hat jeder Eintrag seine eigene Zeile mit Abstand.

## [0.126.0] – 2026-11-25

> **Vor dem Update:** Neues Docker-Secret `backup_key` anlegen (`deploy/README.md`, Secrets anlegen, Schritt 2b). Ohne die Datei startet Compose nicht.

### Neu

- **Datensicherung (Verwaltung › Datensicherung):** Die Werkbank sichert Datenbank und alle Dateien (Belege, Ticket-Anhänge, Projektdokumente) täglich zur eingestellten Uhrzeit und auf Knopfdruck. Aufbewahrung als Anzahl (Vorgabe 14), Zustand von Schlüssel und Zielordner, vorhandene Sicherungen und letzte Läufe; fehlgeschlagene Läufe melden sich als Benachrichtigung. Auf der Seite steht die Anleitung zum Einrichten, Zurückspielen und Öffnen im Notfall.
- Verschlüsselung mit GnuPG (OpenPGP, AES-256), Passphrase im neuen Docker-Secret `backup_key`. Je Sicherung ein Ordner mit `datenbank.dump.gpg`, `dateien.tar.gpg` und `info.json` (Version, Revision, Prüfsummen).
- Kommando im Container: `python -m werkbank.backup liste | sichern | pruefen NAME | wiederherstellen NAME`. Zurückspielen nur bei angehaltener Werkbank, die Datenbank in einer Transaktion, mit Prüfung von Prüfsummen, Schlüssel und Version vorher.
- Zielordner: Docker-Volume `backups` oder ein Ordner auf dem Host über `WERKBANK_BACKUP_DIR` (z. B. ein NAS-Mount).

### Betrieb

- Image: `gnupg` und `postgresql-client-16` aus der offiziellen Paketquelle von PostgreSQL (Signaturschlüssel aus dem Debian-Paket `postgresql-common`), passend zur Datenbank 16.
- Migration `0086`: Tabelle `backup_runs`.
- CI: Der Docker-Test sichert im gebauten Image, prüft die Sicherung und spielt sie zurück.

## [0.125.1] – 2026-11-24

### Sicherheit

Sicherheitsprüfung nach OWASP ASVS 5.0 Stufe 2 mit unabhängigem Prüfer (Bericht in `docs/security/asvs-l2.md`).

- **Doku-Links mit Backslash abgelehnt (E1/P1):** Ein Link wie `/\example.com` sah intern aus, führte im Browser aber auf eine fremde Seite. Server und Editor lassen in Pfaden keinen Backslash mehr zu, ebenso die Ziele von Benachrichtigungen.
- **Rechte vergeben nur mit frischer Anmeldung (E2):** Rollen in Ticket-Bereichen vergeben und entziehen (auch beim Anlegen eines Bereichs), Personen eines Doku-Arbeitsbereichs ändern und Seitenrechte zurücksetzen verlangen jetzt wie die Verwaltung eine Anmeldung der letzten 15 Minuten. Bisher konnte sich die Ticket- bzw. Doku-Verwaltung ohne erneute Anmeldung selbst Zugriff verschaffen.
- **Abmelden nur per POST (P2):** `GET /auth/logout` meldet niemanden mehr ab; ein fremder Link oder eine Weiterleitung kann so keine Abmeldung erzwingen. Die Oberfläche nutzte schon immer POST.
- **Test-Pfade der Tickets nur in Testumgebungen (E3):** `/api/tickets/test/*` wird in Produktion gar nicht mehr eingebunden (bisher eingebunden, aber mit 404).

## [0.125.0] – 2026-11-24

### Dokumentation

- **Seiten verschieben:** Knopf „Verschieben“ rechts unter „Seite“ mit Dialog für den neuen Platz im selben Arbeitsbereich und die Reihenfolge; Unterseiten wandern mit. Die Schnittstelle gab es schon, die Oberfläche fehlte.

### Sicherheit

- Live-Bearbeitung: Bei einer fehlerhaften Nachricht steht im Log nur noch die Art des Fehlers, nicht dessen Text (CodeQL „Log Injection“, `doku/collab.py`).

## [0.124.2] – 2026-11-24

### Aufräumen

- **Workflow-Engine entfernt** (seit dem Umbau von Evergreen in 0.76 ungenutzt): `core/workflow.py`, Tabellen `workflow_instances` und `workflow_events` (Migration 0085), Abhängigkeit `pyyaml`.
- **Dokumentation:** Die Größengrenze einer Seite (1 Mio. Zeichen im JSON) war festgelegt, wurde aber nicht geprüft; jetzt weist der Server größere Seiten ab.
- Ungenutzte Konstanten und Funktionen entfernt (Backend und Frontend), ebenso die doppelte Einstellung `trusted_proxy_ips` (`TRUSTED_PROXY_IPS` wirkt weiter über das Dockerfile).
- Veraltete Schnittstellen ersetzt: `Result.tuples()` (SQLAlchemy 2.1), `HTTP_422_UNPROCESSABLE_ENTITY` und `HTTP_413_REQUEST_ENTITY_TOO_LARGE` (Starlette); `path_separator` in `alembic.ini`.
- CI: **Betterleaks** statt gitleaks (gitleaks wird nicht mehr weiterentwickelt; gleiches Konfigurationsformat, jetzt `.betterleaks.toml`), Image auf Version 1.10.1 festgelegt statt `latest`.
- `.gitignore`: `*.tsbuildinfo`.

### Abhängigkeiten

- fastapi 0.163.2, SQLAlchemy 2.1.9 (beide mindestens 7 Tage alt).
- TypeScript bleibt bei 6.0: typescript-eslint unterstützt TypeScript 7 noch nicht (`typescript <6.1`). Tiptap 3.35, vitest 5.1.1, jest-dom 8.0 und weitere sind jünger als 7 Tage und kommen mit Dependabot.

## [0.124.1] – 2026-11-24

### Konto, Handbuch und Dokumentation

- **Konto › Meine Rechte** zeigt je Bereich die Stufe aus Verwaltung › Berechtigungen (z. B. „IT-Budget · Verwalten“) statt der internen Rollennamen und des Hinweises auf Entra; die Admin-Gruppe steht als „Verwaltung“ darüber.
- Handbuch: „Für:“ und die Texte nennen Bereich und Stufe statt interner Rollennamen.
- Spec: Rechte von Tickets und Dokumentation nach der Umstellung (0.121.0), Phasen mit allen Bereichen, offener Punkt 16 (Evergreen: BR-Vorlage) hinfällig. README: Bereiche und Stand aktualisiert.

## [0.124.0] – 2026-11-24

### Tickets

- **Favoriten und Geöffnet** unter „Neues Ticket“ (PC, Tablet, im Menü am Handy): zuletzt geöffnete Tickets in fester Reihenfolge, Stern für Favoriten (eigene Gruppe, zählt nicht mit), X zum Entfernen, „Liste leeren“ mit Bestätigung, beide Gruppen aufklappbar. Je Person gespeichert und auf allen Geräten gleich; nur Tickets, die die Person sehen darf (`/api/tickets/leiste`, Migration 0084).
- **Konto › Tickets:** Höchstzahl (5, 10, 15, 25) und Ansicht (kompakt mit Status-Punkt und Legende, normal mit Status) je Konto.
- Ein Ticket öffnet direkt bei der letzten Mitteilung im Verlauf.
- Antworten per Mail: Das Logo aus dem Branding und eingebettete Bilder, die nur im Zitat früherer Mails stehen, kommen nicht mehr als Anhang ins Ticket (sie bleiben in der Original-Mail).

## [0.123.1] – 2026-11-24

### IT-Monitoring

- Die **Admin-Gruppe** allein sieht das IT-Monitoring nicht mehr (Seiten, API, Berichte, Sprung nach Zabbix, Benachrichtigung über DNS-Abweichungen); dafür braucht es die Berechtigung IT-Monitoring „Lesen“ (intern `Monitoring.Reader`).
- Die Einrichtung von Zabbix (bisher IT-Monitoring › Verbindung) steht jetzt unter **Verwaltung › Zabbix** (`/verwaltung/zabbix`).
- „Jetzt prüfen“ beim DNS-Abgleich nur für die Admin-Gruppe mit „Lesen“. Fehler von Zabbix und des DNS-Abgleichs melden sich weiter bei der Admin-Gruppe.

## [0.123.0] – 2026-11-24

### Dokumentation

- **Kommentare an Textstellen** (Phase D3): Text markieren, „Kommentieren“; Antworten, „Erledigt“ und „Wieder öffnen“, eigene Kommentare löschen (mit Bestätigung). Wer lesen darf, darf kommentieren. Die Stelle wird als relative Yjs-Position gespeichert, nicht im Inhalt (`doku_threads`, `doku_comments`, Migration 0083).
- **Erwähnungen** mit `@` (nur Personen mit Leserecht); Benachrichtigungen `doku.erwaehnung` und `doku.antwort` ohne Inhalt.
- **Verweise** auf Tickets, Geräte, Stellen, Arbeitsplätze, Räume, IT-Projekte und Verträge („#“ in der Werkzeugleiste); Titel und Status je lesender Person nach ihren Rechten, sonst „Kein Zugriff“.
- **Live-Bausteine** Ticketliste, Geräteliste, Projektstand und Vertragsfristen mit den Rechten der lesenden Person, neu alle 60 Sekunden.
- **Rückverweise** „In der Dokumentation“ bei Ticket, Gerät, Stelle, Arbeitsplatz, IT-Projekt und Vertrag, nur für Doku-Nutzende und nur lesbare Seiten.
- Info-Symbole `doku.kommentare`, `doku.verweise`; Handbuch: „Kommentare und Erwähnungen“, „Verweise und Live-Bausteine“.

## [0.122.1] – 2026-11-24

### IT-Tools

- **HTML-Editor** startet leer; die Vorlage „Mail-Signatur“ entfällt (Vorlagen: Leer, Tabelle).

## [0.122.0] – 2026-11-24

### IT-Tools

- **HTML-Editor** (Formatter): HTML eingeben, Vorschau daneben (ab Tablet darunter, am Handy umschaltbar), Breiten PC/Tablet/Handy, Vorlagen (Leer, Mail-Signatur, Tabelle), Formatieren, Kopieren, Herunterladen als .html, Leeren mit Bestätigung.
- Vorschau als eigene Seite `GET /api/tools/html-vorschau` mit eigener Sicherheitsrichtlinie (Sandbox ohne gleichen Ursprung, Skript per Hash, CSS inline, Bilder `data:` und mit „Abfragen ins Internet“ auch `https:`); Inhalt per `postMessage`, nie auf dem Server.

### Dokumentation

- spec.md (8a), asvs-l2.md, Handbuch (IT-Tools › Deine Eingaben)

### Tests

- `test_tools_html.py`, `html.test.ts`, E2E `it-tools.spec.ts`

## [0.121.0] – 2026-11-24

### Berechtigungen

- **Rechte in der Werkbank statt App-Rollen in Entra**: Verwaltung › Berechtigungen (ersetzt „Rollen“) mit Stufen je Bereich und Person (Tickets, Dokumentation, IT-Bestand, Gerätezuordnung, IT-Projekte, IT-Budget, IT-Monitoring, M365-Einstellungen, Evergreen, IT-Tools). Tabelle mit Ansicht rechts, unter 1024 px Karten; Ansicht „Nach Bereich“; „Alle Rechte entziehen“ mit Bestätigung; „Person hinzufügen“ sucht in Entra (Collector-App).
- Rechte gelten bei jeder Anfrage aus der Datenbank (`load_session`), Änderungen wirken sofort; Audit `berechtigungen.geaendert` mit vorher/nachher.
- **Einlass über zwei Gruppen**: `ENTRA_ADMIN_GROUP_ID` (Anmeldung und Verwaltung, keine Bereichsrechte) und `ENTRA_ACCESS_GROUP_ID` (Anmeldung), geprüft bei der Anmeldung über `POST /me/checkMemberGroups` (delegiert `User.Read`, transitiv). Ohne eingetragene Gruppen wie bisher über App-Rollen.
- **Einmalige Übernahme** der App-Rollen bei der ersten Anmeldung nach der Umstellung als ganze Stufen; `Werkbank.Admin` wird nicht übernommen. Gespeicherte Rechte der Verwaltung haben Vorrang.
- `GET /api/admin/roles` und `/api/admin/people` entfallen, neu `/api/admin/permissions` (Übersicht, Stufen setzen, Suche in Entra, Person aufnehmen).
- Migration `0082` (`users.permissions`, `is_admin`, `permissions_since`, `permissions_origin`); Info-Symbol „Berechtigungen“.

### Dokumentation

- entra-setup.md (1.4–1.8: Gruppen statt App-Rollen, User.Read, Übergang), spec.md (Kapitel 4, 6.1, 6.1a), inbetriebnahme.md, asvs-l2.md, datenschutz.md, `.env.example`, Handbuch (Rechte im Überblick, Verwaltung › Berechtigungen, Häufige Fragen)

### Tests

- `test_permissions.py` (Stufen, Übernahme, Gruppenregeln, sofortige Wirkung, Verwaltung, Aufnahme aus Entra), `AdminPage.test.tsx`, E2E `verwaltung.spec.ts`

## [0.120.0] – 2026-11-24

### Tickets

- **Wer antwortet, steht in der Mail** (Variante B aus dem Entwurf): Über dem Text einer Antwort „{Name} schreibt“, im Kasten die Zeile „Bearbeitet von“ (bei automatischen Mails die zuständige Person, wenn vergeben). Auch im Textteil der Mail. Absender bleibt das Postfach des Bereichs.

### Tests

- `test_tickets_mail.py` (Name über dem Text und im Kasten, ohne Zuständige keine Zeile)

## [0.119.0] – 2026-11-24

### Dokumentation (Phase D2)

- **Gemeinsam schreiben in Echtzeit**: WebSocket `/api/doku/live/{id}` (Protokoll von y-websocket), im Browser Yjs mit Tiptap (`@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-caret`, `@tiptap/y-tiptap`, `y-websocket`, `y-protocols`), im Server pycrdt (`modules/doku/collab.py`, Umwandlung in `ydoc.py`).
- Server hält je offener Seite ein gemeinsames Dokument, speichert 2 Sekunden nach der letzten Änderung (Stand in `doku_pages.ystate`, Inhalt geprüft mit der Positivliste), verwirft Änderungen von Personen mit Lesen, setzt Namen der Anwesenheit selbst, trennt bei geänderten Rechten, Sperre oder beim Wiederherstellen (Neuladen).
- Anwesenheit („Gerade auf der Seite“) und Cursor anderer mit Namen; Zustand der Verbindung oben rechts. Cursor-Farben ohne style-Attribute (CSP).
- Titel weiter über die API; ganzer Inhalt über die API nur noch mit Revision.
- Dev-Server leitet WebSockets an das Backend weiter (`vite.config.ts`).
- Migration `0081`; Info-Symbol „Live-Bearbeitung“.

### Dokumentation

- spec.md (8f, D2), inbetriebnahme.md (WebSockets am Reverse Proxy, ein Prozess), asvs-l2.md, datenschutz.md, THIRD_PARTY_NOTICES.md, Handbuch

### Tests

- `test_doku_live.py` (echter Server: Abgleich, Rechte, Speichern, Sperre, Positivliste, Wiederherstellen), `doku.test.tsx`, E2E `doku.spec.ts` (zwei Personen gleichzeitig, Lesen live)

## [0.118.0] – 2026-11-24

### Dokumentation (neu, Phase D1)

- **Neuer Bereich „Doku“** (`/doku`) mit App-Rollen `Doku.Nutzer` und `Doku.Admin` (in Entra anzulegen, siehe `docs/entra-setup.md`).
- **Arbeitsbereiche** mit Personen aus Entra (Lesen, Bearbeiten, Verwalten); archivieren; im Seitenmenü der Seitenbaum mit Suche und „Neue Seite“, am Handy als Blatt.
- **Seiten** mit Editor (Tiptap 3.34.0, MIT): Text, Überschriften, Listen, Aufgaben, Hinweis- und Warnkasten, Tabellen, Code, Zitate, Trennlinie, Links; Bausteine über „+ Baustein“ oder „/“. Automatisch gespeichert; Inhalt als JSON mit Positivliste im Server, nie HTML.
- **Eigene Rechte** je Seite (Schloss), gelten auch für Unterseiten; Personen außerhalb des Arbeitsbereichs möglich; Lesen, Bearbeiten, Kein Zugriff.
- **Sperren** und Entsperren durch alle mit Bearbeiten.
- **Versionen**: automatisch nach 5, 10 oder 30 Minuten Bearbeitung (Auftrag `doku.versionen`), benennen, ansehen, wiederherstellen.
- **Papierkorb** 30 Tage (Auftrag `doku.aufraeumen`, löscht auch alte automatische Versionen).
- **Verwaltung** `/doku/verwaltung`: Arbeitsbereiche, Seiten mit eigenen Rechten, Versionen, Papierkorb.
- Migration `0080`; Handbuch „Dokumentation“, Info-Symbole Arbeitsbereich, Eigene Rechte, Gesperrte Seite, Version.

### Dokumentation

- spec.md (8f, Rollen), entra-setup.md (Rollen), asvs-l2.md, datenschutz.md, THIRD_PARTY_NOTICES.md (Tiptap, ProseMirror)

### Tests

- `test_doku.py`, `doku.test.tsx`, E2E `doku.spec.ts`

## [0.117.1] – 2026-11-24

### Tickets

- **Behoben:** Ticket-Mails (Antworten, Status-Mails, Weiterleitungen) kamen in Outlook mit kaputtem Text an („dies=r Zeile“, „=tatus“) und ohne Logo. Ursache: Das MIME für Graph `sendMail` hatte nur LF statt CRLF als Zeilenende, Exchange dekodierte quoted-printable dann nicht. Neu: `mime_bytes()` in `modules/tickets/mailbox.py`.

### Tests

- `test_tickets_mail.py`: MIME für Graph nur mit CRLF, HTML mit Umlauten und Logo lässt sich wieder sauber lesen

## [0.117.0] – 2026-11-24

### IT-Bestand

- **Standortbaum mit zwei Ansichten** statt drei Abständen (0.113.0): „Kompakt“ (eine Zeile, langer Name mit „…“, ganz im Tooltip und für Screenreader, rechts die Zahl darunter, 32 px bzw. 44 px mit dem Finger) und „Ausführlich“ (Vorgabe; ganzer Name, darunter Standorte, Etagen, Räume, freie Plätze, „ohne Grundriss“). Umschalter oben im Baum, gemerkt im Browser; die alte Einstellung wird aufgeräumt.
- Symbole je Ebene (Stadt, Standort, Gebäudeabschnitt, Etage) und „Alles einklappen“.
- `workplaces_free` je Etage in `GET /api/inventory/locations`

### Dokumentation

- spec.md, Handbuch (Standorte)

### Tests

- `test_inventory_staff.py` (freie Plätze im Baum), `locations.test.tsx`, E2E `bestand.spec.ts`

## [0.116.0] – 2026-11-24

### Tickets

- **Bilder in der Nachricht:** In Mails eingebettete Bilder (Content-ID, z. B. aus Outlook im HTML-Teil) werden jetzt wie Anhänge geprüft und abgelegt und in der Reihenfolge der Mail nummeriert; im Text steht an ihrer Stelle „[Bild n]“ als Knopf. Bisher fielen sie weg, und im Text blieben Marken wie „[cid:image001.png@…]“ stehen.
- **Vorschau von Anhängen:** Karten mit Vorschaubild oder Dateityp, „Ansehen“ und „Herunterladen“. Bilder öffnen groß mit Blättern (Knöpfe und Pfeiltasten), PDF im neuen Tab, Textdateien (TXT, CSV, EML) als Auszug der ersten 200 KB; Office-Dateien, ZIP und MSG nur als Download.
  - `GET /api/tickets/{nr}/attachments/{id}?view=true` für Bilder und PDF (inline, nur wenn der Dateianfang passt; Bilder mit Sandbox), `GET …/attachments/{id}/text`
  - `inline_number` und `preview` am Anhang; Migration `0079`

### Dokumentation

- spec.md, datenschutz.md (eingebettete Bilder), asvs-l2.md (Dateien und Anhänge), Handbuch (Verlauf)

### Tests

- `test_tickets_mail.py` (eingebettete Bilder, Vorschau, Rechte), `test_tickets_preview.py`, `tickets.test.tsx`, E2E `tickets.spec.ts`

## [0.115.0] – 2026-11-24

### Tickets

- **Lösung bei „Gelöst“:** Beim Wechsel auf „Gelöst“ (Kopf oder „Status danach“ bei einer Antwort) freiwillig Lösungsart und Lösungstext; wählbar, ob beides in der Mail an den Melder steht oder intern bleibt. Die Lösung steht bei den Angaben zum Ticket und als Eintrag im Verlauf.
  - Lösungsarten je Bereich (Einstellungen › Kategorien, Lösungen und Fristen; `/api/tickets/settings/areas/{id}/solution-types`)
  - Übersicht: „Gelöst nach Lösungsart“ (30 Tage), `solved_by_type` in `GET /api/tickets/stats`
  - Migration `0078`: Tabelle `ticket_solution_types`, Spalten `solution_type_id`, `solution_text`, `solution_public` an `tickets`; beim Anonymisieren wird der Lösungstext gelöscht

### Dokumentation

- spec.md, datenschutz.md (Lösungstext), Handbuch (Arbeitshilfen, Übersicht, Einstellungen), Info-Symbol „Lösung“

### Tests

- `test_tickets_work.py` (Lösungsarten, Gelöst mit Lösung, Mail, Statistik), `test_tickets_mail.py` (Antwort mit Lösung), `tickets.test.tsx`, E2E `tickets.spec.ts` (Gelöst mit Lösung, Lösungsart anlegen)

## [0.114.0] – 2026-11-24

### Mails

- **Ein Aussehen für alle Mails** (`core/mail_layout.py`): Logo und Name, Linie in der Akzentfarbe, Text, Fußzeile mit Text und Datenschutz-Link. Gilt für Ticket-Mails an Melder, Weiterleitungen, Benachrichtigungen und Verleih-Mails.
- **Branding der Plattform** (Verwaltung › Allgemein) bekommt ein **Logo für Mails** (nur PNG; ohne eigenes gilt das helle Logo, wenn es ein PNG ist), eine **Fußzeile** und einen **Datenschutz-Link** (beides freiwillig, Link nur https).
- **Tickets:** Die eigene „E-Mail-Gestaltung“ entfällt. Mails an Melder zeigen unter dem Text einen Kasten mit Ticketnummer, Betreff und Status in Worten (bei einer Antwort mit „Status danach“ der neue Status); die Fußzeile nennt den Bereich, nicht die Werkbank. Weiterleitungen gehen im selben Aussehen raus.
  - Migration `0077`: übernimmt Fußzeile, Datenschutz-Link und Logo der bisherigen Gestaltung ins Branding (nur, wenn dort noch nichts steht) und entfernt die Tabelle `ticket_mail_design`. Die eigene Akzentfarbe der Ticket-Mails entfällt.
  - Entfallen: `GET/PUT /api/tickets/einstellungen/design`, `PUT/DELETE …/design/logo`

### Dokumentation

- spec.md (Tickets, Benachrichtigungen, Verwaltung), security/asvs-l2.md (Branding), Handbuch (Tickets, Verwaltung)

### Tests

- `test_branding.py` (Mail-Logo nur PNG, Fußzeile, Datenschutz-Link), `test_tickets_mail.py` (neues Aussehen, Status, ohne „Werkbank“), `test_notify_channels.py`, `tickets.test.tsx`

## [0.113.0] – 2026-11-24

### IT-Bestand

- **Standortbaum:** Abstände einstellbar (kompakt, normal, weiträumig), direkt oben im Baum; der Browser merkt sich die Wahl (`werkbank-standortbaum-abstand`). Mit dem Finger bleiben Einträge auch kompakt mindestens 44 px hoch.

### Behoben

- **Standortbaum:** Seit 0.109.0 fehlten drei Regeln des Baums (Zeile mit Name und Anzahl, Hover, Hervorhebung der Auswahl); die gewählte Etage bekam dazu das Raster der Raumliste, und ihr Name brach seltsam um. Die Regeln sind wiederhergestellt.

### Dokumentation

- Handbuch: Standorte (Abstände im Baum)

### Tests

- `locations.test.tsx`: Abstände im Baum

## [0.112.0] – 2026-11-24

### Evergreen

- Status in der Liste als Auswahl unter der Suche statt seitlich scrollender Chips (`FilterBar` mit `statusSelect`, Regel „Filter-Chips nie seitlich scrollen“ in design.md)

### Tests

- E2E-Helfer `chooseStatus`/`expectStatus` erkennen die Auswahl auch am Computer

## [0.111.0] – 2026-11-24

### IT-Bestand

- **Lenovo PSREF entfernt**, solange es keinen Zugang zur offiziellen Schnittstelle gibt: kein täglicher Abruf mehr, kein Block im Reiter „Technik“, keine Einstellungen dazu in der Verwaltung bei NinjaOne.
  - Gelöscht: `psref.py`, `psref_sync.py`, Auftrag `bestand.psref`, Endpunkt `POST /api/inventory/hardware/{id}/psref`
  - Migration `0076`: entfernt die Spalten `psref_*` an `inventory_models`, offene Aufträge `bestand.psref` und die Schlüssel `psref_enabled` und `psref_user_agent` aus den NinjaOne-Einstellungen. Die gespeicherten technischen Daten gehen dabei verloren.

### Dokumentation

- spec.md, datenschutz.md (Lenovo PSREF als Empfänger entfernt), security/asvs-l2.md und Handbuch angepasst

### Tests

- `test_inventory_psref.py` und die PSREF-Tests im Frontend entfernt

## [0.110.1] – 2026-11-24

### Behoben

- **Raumliste:** „Raum suchen“ und „Zeigen“ hatten nicht das Aussehen der übrigen Such- und Auswahlfelder (im Dunkelmodus deutlich zu sehen). Sie nutzen jetzt die Felder der Filterleiste.

## [0.110.0] – 2026-11-23

### IT-Bestand

- **Pool-Arbeitsplatz** als dritter Typ neben Einzel und Geteilt: gehört absichtlich keiner Stelle (z. B. Desk-Sharing, Gast, Schulung), mit **Zweck** (Pflicht, Stammdaten) und freiwilliger **verantwortlicher Abteilung**. Zählt nie als „frei“ (Filter „Frei“, Raumliste). Neuer Filter „Pool“, Suche über Zweck und Abteilung.
  - Migration `0075`: Tabelle `inventory_workplace_purposes` mit Vorschlägen (Desk-Sharing, Gast, Schulung, Besprechung), Spalten `pool`, `purpose_id`, `department_id` an `inventory_workplaces`
  - Stammdaten: neuer Bereich „Zwecke für Pool-Arbeitsplätze“ (`/api/inventory/purposes`). Abteilungen zählen und sperren das Löschen auch bei Pool-Arbeitsplätzen.
  - Bestehende Arbeitsplätze ohne Stelle bleiben „frei“ und werden von Hand umgestellt.

### Dokumentation

- spec.md und Handbuch (Arbeitsplätze, Stammdaten), Info-Symbol „Pool-Arbeitsplatz“

### Tests

- `test_inventory_staff.py` (Pool: Prüfungen, Filter, Raumliste, Stammdaten, Rückstufung), `staff.test.tsx` (Maske Pool)

## [0.109.0] – 2026-11-23

### IT-Bestand

- **Neue Raumliste neben dem Grundriss** (`modules/inventory/RoomList.tsx`): Je Raum stehen Name, Beschreibung, belegte und freie Arbeitsplätze und Geräte. Gesucht wird über Name, Beschreibung und Personen. Statt Filter-Chips gibt es die Auswahl „Zeigen“ mit Anzahl. Ab 13 Räumen bildet die Liste zuklappbare Gruppen nach dem Anfang der Raumnummer. Die Liste hat keinen eigenen Scrollbalken mehr und ist breiter (22 rem).
- **Beschreibung am Raum** (`description`, Migration `0074`), freiwillig, im Raum zu bearbeiten. Beim Verschieben im Grundriss bleibt sie erhalten.
- `RoomOut` mit `workplaces`, `workplaces_free` und `people`

### Dokumentation

- design.md: Regel „Filter-Chips nie seitlich scrollen“ (passt eine Reihe nicht in eine Zeile, wird der Filter zur Auswahl mit Anzahl)
- spec.md und Handbuch (Standorte)

### Tests

- `test_inventory_staff.py` (Beschreibung, Belegung je Raum), `roomlist.test.tsx` (Raumnummer, Gruppen, Suche, Auswahl), `locations.test.tsx`

## [0.108.0] – 2026-11-23

### IT-Bestand

- **Lenovo PSREF wieder abrufbar:** Lenovo lehnt Abrufe ohne Browser-Kennung mit 403 und der Seite „PSREF page not found“ ab; die offizielle Schnittstelle `psrefapi.lenovo.com` verlangt eine Anmeldung. Neu ist die Einstellung „Absenderkennung für PSREF“ in der Verwaltung bei NinjaOne (`psref_user_agent`, leer: Kennung der Werkbank). Die Kennung steht nicht im Code.
- **Grund eines Fehlers sichtbar:** am Modell gespeichert (`psref_error`, Migration `0073`), im Reiter „Technik“ angezeigt, im Protokoll (`grund`) und als Warnung im Log; bei der Ablehnung durch Lenovo mit Hinweis auf die Absenderkennung

### Betrieb

- Das Backend gibt Meldungen der Werkbank (`werkbank.*`) ab `LOG_LEVEL` im Container-Log aus; bisher gingen Hinweise und Warnungen aus Anfragen verloren

### Dokumentation

- spec.md, datenschutz.md, Handbuch (IT-Bestand, PSREF)

### Tests

- `test_inventory_psref.py` (Absenderkennung, Erkennen der Ablehnung, Fehlergrund in Ansicht und Protokoll, Einstellung), `inventory.test.tsx`, `cases.test.tsx`

## [0.107.0] – 2026-11-23

### Oberfläche

- **Ansicht rechts ohne eigenen Scrollbalken:** Seiten mit Liste und Ansicht (IT-Budget, IT-Bestand, Verleih, Evergreen, Zabbix), M365-Seiten mit Detail und die Angaben im Ticket laufen mit der Seite mit und bleiben stehen, sobald ihr Ende sichtbar ist (`components/stickyPanes.ts`; CSS ohne `max-height`/`overflow` an `.case-main`, `.split-detail`, `.ticket-side`)

### IT-Budget

- Betragseingabe ohne Schnellwahl der Steuersätze; das Feld steht weiter mit 19 % vor

### Behoben

- **Auswahl mit Suche** (z. B. Stelle oder Arbeitsplatz am Gerät): Die Trefferliste wurde vom umgebenden Kasten abgeschnitten und schloss sich beim Klick auf ihre Scrollleiste. Sie steht jetzt im Fluss unter dem Feld und bleibt beim Scrollen offen.

### Dokumentation

- design.md (Liste und Ansicht), Handbuch (Steuersatz)

### Tests

- `stickyPanes.test.ts`, `budget.test.tsx` angepasst

## [0.106.0] – 2026-11-23

### IT-Budget

- **Beträge einheitlich netto oder brutto:** Budgetposten, Vertrag und Rechnungsposition haben dieselbe Eingabe (`AmountFields`): Umschalter „Ich trage ein: Netto | Brutto“, freier Steuersatz mit Schnellwahl 19/7/0 %, der andere Wert steht sofort darunter
  - Budgetposten speichern Netto und Steuersatz (`net_cents`, `tax_rate_bp`, Migration `0072`; bestehende Posten: 19 %, Netto aus dem Brutto gerechnet); Netto, Steuersatz und Brutto müssen auf 1 Cent passen
  - Vertrag nimmt wahlweise `gross_cents`; das Netto rechnet der Server
  - `net_from_gross` liegt jetzt in `contracts.py` und wird auch vom Import genutzt
- **Vertragsmaske:** Posten mit einem anderen Vertrag stehen nicht mehr zur Wahl; ein Hinweis nennt die Zahl
- **PDF-Symbol** an Budgetposten (Liste, Ansicht), Rechnungen (Liste) und Rechnungspositionen; Posten und die Posten eines Vertrags liefern dafür `invoices` mit
- **Eigene Adressen** `/budget/posten/{id}` und `/budget/rechnungen/{id}` (mit `?jahr=`); die Ansicht folgt der Adresse
- **„Link kopieren“** in den Ansichten von Posten, Rechnung und Vertrag und **„Verknüpft“** mit Sprüngen: Posten → Vertrag, Rechnungen; Rechnung → Posten, deren Verträge; Vertrag → Posten, deren Rechnungen; je Eintrag Link kopieren und PDF

### Dokumentation

- spec.md (Budgetposten netto, Verträge, Rechnungen, Links und Verknüpfungen, Beleg), Handbuch (Begriffe, Budgetposten, Rechnungen, Verträge, neues Thema „Links und Verknüpfungen“), Info-Symbol „Netto oder Brutto“

### Tests

- `test_budget.py` (Netto/Brutto mit freiem Steuersatz an Posten und Vertrag, `invoices` am Posten), `budget.test.tsx` (Betragseingabe, Vertragsmaske, Links, PDF, Link kopieren), E2E `budget.spec.ts` angepasst

## [0.105.0] – 2026-11-23

### IT-Monitoring

- **Zabbix-Übersicht neu aufgebaut** nach dem freigegebenen Entwurf:
  - Gesamtstand als farbige Karte (grün, gelb, rot) mit Aufzählung und dem am meisten betroffenen Standort, daneben „Hosts erreichbar“ und „Zu erledigen“
  - offene Probleme als Balken nach Schweregrad; ein Klick filtert die Liste
  - Standorte als Kacheln mit einem Kästchen je Host (Farbe = schlimmster offener Zustand, nicht erreichbar umrandet, Wartung grau); ein Klick filtert
  - „Letzte 24 Stunden“: offene Probleme je Stunde (neue Tabelle `mon_zbx_problem_hours`, Migration `0071`, 48 Stunden)
  - ohne Einrichtung nur der Hinweis
- API: Übersicht liefert zusätzlich `site_health` und `history`

### Dokumentation

- spec.md (Übersicht, neue Tabelle), Handbuch (Übersicht), Info-Symbole „Gesamtstand“ und „Letzte 24 Stunden“

### Tests

- `test_monitoring_zabbix.py` (Standorte, Verlauf, Aufbewahrung), `zabbix.test.tsx`, E2E `monitoring.spec.ts` mit nachgebildeter Übersicht (axe auf allen Profilen)

## [0.104.2] – 2026-11-23

### Behoben

- **Zabbix:** Probleme von abgeschalteten Triggern, Items oder Hosts erschienen weiter in Übersicht, Hosts und Zählern. `problem.get` liefert sie, solange das Problem in Zabbix offen ist; die Werkbank fragt die Trigger jetzt mit `monitored` ab und lässt Probleme ohne überwachten Trigger weg, wie die Problemansicht in Zabbix.

### Tests

- `test_monitoring_zabbix.py`: Problem eines abgeschalteten Triggers wird nicht übernommen, `trigger.get` mit `monitored`

## [0.104.1] – 2026-11-23

### Behoben

- **Anrede durchgehend per du:** Begrüßung auf der Startseite mit Vornamen („Guten Morgen“, „Hallo“, „Guten Abend“ statt „Guten Tag“ mit vollem Namen); Hinweise und Fehlermeldungen in Oberfläche und Backend von der Grundform („Bitte einen Namen eintragen.“) auf du („Bitte trag einen Namen ein.“); Schritte im Handbuch auf du
- **Ticket-Mails:** Die Zeile über der Antwort heißt jetzt „Bitte antworte oberhalb dieser Zeile.“; Antworten auf ältere Mails mit der früheren Zeile werden weiter richtig abgeschnitten

### Tests

- `user.test.ts` (Vorname), `test_tickets_mail.py` (frühere Zeile), angepasste Texte in Unit- und E2E-Tests

## [0.104.0] – 2026-11-23

### Listen

- **IT-Bestand: Hardware, Stellen und Arbeitsplätze seitenweise:** Suche und Filter im Backend, je Abruf 50 Einträge mit „Mehr anzeigen“; die stille Obergrenze von 5000 Einträgen entfällt. Arbeitsplätze bekommen eine Suche. `GET /api/inventory/hardware|positions|workplaces` liefern `{items, total}` (Hardware dazu `kinds`), Löschen von Stelle und Arbeitsplatz liefert nur noch `{id}`
- **Auswahl mit Suche statt langer Auswahllisten:** am Gerät Raum und „Zugeordnet zu“ (Stelle oder Arbeitsplatz), im Budget Vertragspartner, Rechnungssteller, Vertrag am Posten und Partner beim Import (neue Komponente `ListPicker`); die Gerätemaske lädt nicht mehr alle Standorte, Stellen und Arbeitsplätze
- **Tabellen ohne eigenen Scrollbalken:** Listen mit Ansicht daneben (Vorgänge, Verleih, Evergreen, Zabbix-Hosts, Budgetposten, Rechnungen, Verträge) stehen in voller Länge und scrollen mit der Seite; Spaltenköpfe haften unter der Kopfzeile, die Ansicht daneben bleibt stehen
- **Gerätezuordnung:** Hinweis, wenn nur die neuesten 500 von mehr Geräten angezeigt werden (`total` in der Liste)
- **Weitere anzeigen** (neue Komponente `ShowMore`): Rollen je Person (50), Budget-Importe (20), Subdomains im DNS-Werkzeug (200, dazu „Alle anzeigen“; Kopieren und CSV weiter mit allen)

### Dokumentation

- design.md und spec.md (Liste scrollt mit der Seite), Handbuch (Hardware, Gerät erfassen, Arbeitsplätze)

### Tests

- `test_inventory.py`, `test_inventory_staff.py`, `test_devices_api.py`, `inventory.test.tsx`, `staff.test.tsx`, `budget.test.tsx`, `devices.test.tsx`, `ShowMore.test.tsx`

## [0.103.0] – 2026-11-22

### Tickets

- **Ticketseite nach neuem Entwurf:** Kopf mit Status-Kennzeichen und den Aktionen Mir zuweisen, Zusammenführen (jetzt eigener Knopf) und Weiterleiten; Angaben als Karten Ticket · Melder · Im IT-Bestand · Aufbewahrung, am PC rechts, auf Tablet und Handy als eingeklappter Block „Angaben“ mit Kurzfassung
- **Antworten** nur an den Melder oder **an alle** (Beteiligte in Kopie); Wechsel im offenen Antwortfeld; Empfänger stehen am Eintrag; automatische Mails gehen nur an den Melder
- **Weiterleiten** einer Nachricht oder der ursprünglichen Meldung aus dem Postfach des Bereichs, mit Text und wählbaren Anhängen; interner Eintrag im Verlauf; Antworten darauf als „Antwort von extern“ (Status bleibt, keine neuen Beteiligten); Antworten von Beteiligten als „von Beteiligten“
- Rolle **„Nur lesen“ entfernt**; bestehende Einträge dieser Rolle werden gelöscht (Migration `0070`)
- **„Gerät verknüpfen“ entfernt**; die Verknüpfung wird aus der Datenbank gelöscht (Migration `0069`), Geräte des Melders stehen weiter unter „Im IT-Bestand“
- Am Handy kurze Beschriftungen der Knöpfe unten („Antworten“, „An alle“, „Notiz“)

### Dokumentation

- spec.md, datenschutz.md, Handbuch (Ticketseite, Rollen), Info-Symbole

### Tests

- `test_tickets_mail.py` (an alle, Weiterleiten, Antworten von außen), `tickets.test.tsx`, E2E `tickets.spec.ts`

## [0.102.0] – 2026-11-22

### Tickets

- **Einstellungen in Reitern** wie im Entwurf: Bereiche · Kategorien und Fristen · E-Mail-Eingang · E-Mail-Gestaltung (nur Ticket-Verwaltung) · Textbausteine · Aufbewahrung · Rollen; eigene Adressen je Reiter (`/tickets/einstellungen/<reiter>?bereich=`); Bereichsauswahl statt langer Seite; „Rollen und Protokoll“ ist jetzt der Reiter „Rollen“ (Menüpunkt entfällt)
- **Melder im IT-Bestand:** Block „Im IT-Bestand“ am Ticket mit Stelle, Abteilung, Arbeitsplätzen, Geräten und offenen Verleihen (Zuordnung Mailadresse = UPN), nur mit Rechten im IT-Bestand
- **Tickets der Person** auf der Seite einer Stelle im IT-Bestand (`GET /api/tickets/by-position/{id}`), fremde Bereiche nur als Anzahl
- **Geräte ohne Schalter je Bereich:** sichtbar mit Rechten im IT-Bestand, verknüpfen zusätzlich mit „Bearbeiten“; Optionen „Nur diese Arten“, „Geräte des Melders vorschlagen“, „Tickets beim Gerät zeigen“ entfallen; Migration `0068`
- **Melder aus Entra** beim Anlegen (`GET /api/tickets/people`): Vorschläge ab zwei Buchstaben, Auswahl übernimmt die Mailadresse; freie Eingabe bleibt
- Link der Benachrichtigung „Neue Mail zu prüfen“ führt direkt zum Reiter E-Mail-Eingang des Bereichs

### Dokumentation

- spec.md, datenschutz.md, Handbuch (Einstellungen, Arbeitshilfen, Liste), Info-Symbole

### Tests

- `test_tickets_inventory.py`, `tickets.test.tsx`, E2E `tickets.spec.ts` (Reiter, Melder im IT-Bestand)

## [0.101.0] – 2026-11-22

### Tickets (Phase 4: Betrieb)

- **Übersicht** (`/tickets/uebersicht`, Startseite des Bereichs) mit Kennzahlen (offen, mir zugewiesen, neu und frei, wartet, Erinnerung, gelöst in 30 Tagen; mit Fristen überfällig und eingehalten), Listen „Mir zugewiesen“ und „Neu und nicht zugewiesen“, Eingang nach Weg und offen nach Kategorie; `GET /api/tickets/stats`
- **Export als Excel** der gefilterten Liste, nur für die Bereichsverwaltung und nur aus ihren Bereichen, ohne Texte; jeder Export im Protokoll; `GET /api/tickets/export`
- **Aufbewahrung:** Vorgabe der Ticket-Verwaltung (Standard aus), Abweichung je Bereich, anonymisieren oder vollständig löschen nach Monaten oder Jahren ab dem Schließen; Vorschau „Beim nächsten Lauf betroffen“ vor dem Speichern; täglicher Auftrag `tickets.aufbewahrung` mit Protokoll der Läufe
- **Ausnahmen** je Ticket mit Begründung durch die Bereichsverwaltung, ein Jahr gültig, Benachrichtigung 30 Tage vor Ende (`tickets.ausnahme`), ohne Bestätigung verfallen
- Anonymisierte Tickets lassen sich nicht mehr ändern; eine Mail mit ihrer Nummer wird ein neues Ticket
- **Rollen und Protokoll** (`/tickets/protokoll`): Rollen je Bereich und Protokoll des Moduls
- **Fristen je Bereich** für „Letzte Eingänge“ ohne Ticket (Vorgabe 90 Tage, Wartungslauf) und „Zu prüfen“ ohne Entscheidung (Vorgabe 30 Tage, beim Abruf in „Ignoriert“ verschoben)
- Benachrichtigung `tickets.pruefen` an die Bereichsverwaltung bei neuen Mails unter „Zu prüfen“ (nur Bereich und Link)
- Migration `0067`

### Intern

- Excel-Schreiber von `modules/budget/xlsx.py` nach `core/xlsx.py` verschoben (gemeinsam für IT-Budget und Tickets); kein neues Paket

### Dokumentation

- spec.md (Stand T4, Entscheidungen), datenschutz.md, Handbuch (Übersicht; Aufbewahrung, Export und Protokoll), Info-Symbole

### Tests

- `test_tickets_ops.py`, `tickets.test.tsx`, E2E `tickets.spec.ts` (Übersicht, Aufbewahrung mit Ausnahme, Export, Protokoll)

## [0.100.0] – 2026-11-22

### Tickets (Phase 3: Arbeitshilfen)

- **Kategorien** je Bereich mit vorgeschlagener Priorität; Auswahl beim Anlegen und am Ticket; Endpunkt für Mitglieder `GET /api/tickets/areas/{id}/categories`
- **Fristen (optional)** je Bereich und Priorität für erste Reaktion und Lösung, in Arbeitszeit (Wochentage, Uhrzeiten, `TICKETS_TIMEZONE`); Pause bei „Wartet auf Rückmeldung“; Benachrichtigung bei 80 % an die zuständige Person, bei Überschreitung an die Bereichsverwaltung; auf Wunsch Mail an den Melder bei verpasster Frist; ohne Fristen erscheint nirgends eine Frist
- **Erinnerung** als Status mit Zeitpunkt (Vorgabe 08:00) und Stichwort, erst nach „Bestätigen“; Auftrag `tickets.erinnerungen` alle 5 Minuten
- **Übergabe:** „Person benachrichtigen“ beim Zuweisen an andere; Benachrichtigungen `tickets.neu`, `zugewiesen`, `antwort`, `erinnerung`, `frist_bald`, `frist_ueberschritten` über Glocke, Mail, Teams und Push, nur mit Nr. und Link
- **Zusammenführen** mit Vorschlägen und Suche, Bestätigung, optional Mail an den Melder; Einträge mit „aus T-…“; spätere Mails landen im Ziel
- **Geräte (optional):** Ticket mit Hardware aus dem IT-Bestand verknüpfen (Suche, Geräte des Melders zuerst); Tickets zum Gerät im IT-Bestand
- **Textbausteine** für Antworten und Notizen mit Platzhaltern und „Status danach“; Einfügen im Antwortfeld über `/kürzel`; Vorschau samt Signatur in den Einstellungen
- Liste mit Spalten Kategorie und Frist (nur wenn vorhanden) und Hinweis „überfällig“
- Migration `0066`

### Dokumentation

- spec.md (Stand T3), datenschutz.md, Handbuch (Arbeitshilfen), Info-Symbole, `deploy/.env.example` (`TICKETS_TIMEZONE`)

### Tests

- `test_tickets_work.py`, `tickets.test.tsx`, E2E `tickets.spec.ts` (Zusammenführen, Textbaustein, ohne Fristen keine Frist, Einstellungen)

## [0.99.0] – 2026-11-22

### Tickets (Phase 2: E-Mail)

- **E-Mail-Eingang** je Bereich über Microsoft Graph (App „Werkbank Tickets“, per RBAC auf die Ticket-Postfächer beschränkt), Abruf alle 5 Minuten (`tickets.postfaecher`): neue Mail → neues Ticket, Antworten über `[#T-…]` im Betreff oder `In-Reply-To`/`References`, Personen in Kopie werden Beteiligte
- Nur der neue Teil einer Antwort; Zitate eingeklappt; HTML wird in Text umgewandelt; Original als .eml am Ticket
- Filter: Abwesenheit, Unzustellbar, Newsletter, Sperrliste, Schleifenschutz (10 je Absender und Stunde); externe Absender annehmen, unbekannte prüfen („Zu prüfen“) oder ablehnen
- Anhänge: Positivliste je Bereich, Prüfung am Inhalt, Größengrenze; entfernte Anhänge mit Hinweis; Download nur als Anhang
- Ordner „Verarbeitet“ und „Ignoriert“, endgültiges Löschen nach 30 bzw. 7 Tagen; Message-ID gegen doppelte Verarbeitung
- Antwort auf geschlossene Tickets: wieder öffnen innerhalb von X Tagen, immer, oder neues Ticket mit Bezug
- **Antworten an den Melder** aus dem Postfach des Bereichs mit „Status danach“; Eingangsbestätigung und automatische Mails je Bereich; HTML und Text, Logo eingebettet, „Bitte oberhalb dieser Zeile antworten.“
- **E-Mail-Gestaltung** (Ticket-Verwaltung): Akzentfarbe, Logo, Fußzeile, Datenschutz-Link; je Bereich Absendername, Titel, Signatur
- Protokoll „Letzte Eingänge“; Migration `0065`
- Worker bindet das Volume der Belege ein (Anhänge)

### Dokumentation

- entra-setup.md (4b: App „Werkbank Tickets“, RBAC für Anwendungen), spec.md, datenschutz.md, Handbuch (E-Mail), Info-Symbole, `.env.example`, `docker-compose.yml`

### Tests

- `test_tickets_mail.py`, `tickets.test.tsx`, E2E `tickets.spec.ts` (Mail → Ticket, Antwort, geschlossenes Ticket, Notiz ohne Mail, Einstellungen)

## [0.98.0] – 2026-11-22

### Verwaltung

- **Berechtigungen für den Abruf prüfen** (Verwaltung › Verbindungen, `POST /api/admin/collector/check`): Rechte der Collector-App aus ihrem Token und die Anwendungsberechtigungen des Dienstprinzipals von UTCM je Typ aus `COLLECTOR_RESOURCES`; fehlende Rechte mit den betroffenen Typen. Entra-Rollen werden nicht geprüft (Hinweis). Audit `rechte_geprueft`

### Dokumentation

- spec.md (7.1), entra-setup.md (`Application.Read.All`), Handbuch (Verwaltung), Info-Symbol

### Tests

- `test_m365_permissions.py`, `CollectorCheck.test.tsx`, E2E in `verwaltung.spec.ts`

## [0.97.0] – 2026-11-22

### Tickets (neu, Phase 1)

- Neues Modul **Tickets** (spec.md 8e): Bereiche (z. B. Abteilungen) mit Rollen je Bereich: Bereichsverwaltung, Bearbeiten, Nur lesen; vergeben an Entra-Gruppen (Objekt-ID) oder einzelne Personen
- Gruppenmitgliedschaft serverseitig über Microsoft Graph (`transitiveMemberOf`, Zwischenspeicher `TICKETS_MEMBERSHIP_CACHE_MINUTES`, Vorgabe 5); stündlicher Abgleich der Gruppenmitglieder (`tickets.gruppen`); kein Gruppen-Claim
- Neue App-Rollen `Tickets.Nutzer` (nur Anmeldung) und `Tickets.Verwaltung` (Bereiche, Postfächer, Rollen; kein Zugriff auf Tickets)
- Tickets von Hand erfassen (Anruf, von Hand), Liste mit Suche und Auswahl, Ticketseite mit festem Kopf, Verlauf (Meldung oben, letzte vier Einträge), interne Notizen, Priorität, Beteiligte, Verschieben in einen anderen Bereich
- Status und Zuständigkeit gelten erst nach „Bestätigen“ (Zusammenfassung, „Verwerfen“, Übergabenotiz); Schutz vor gleichzeitigen Änderungen (409)
- Zuweisung neuer Tickets „wer zuerst übernimmt“ oder „reihum“; Gelöst → Geschlossen nach 5 Tagen (`tickets.wartung`)
- Fremde Tickets ergeben 404; Protokoll des Moduls (`ticket_audit`, 3 Jahre) und Audit-Log
- Migration `0064`

### Dokumentation

- spec.md (8e, Rollen, Phasen), entra-setup.md (App-Rollen, `GroupMember.Read.All`), datenschutz.md, Handbuch „Tickets“, Info-Symbole, `.env.example`

### Tests

- `test_tickets.py`, `tickets.test.tsx`, E2E `tickets.spec.ts`

## [0.96.0] – 2026-11-22

### M365-Konfiguration

- **Snapshots kürzer:** Die Seite zeigt zuerst die letzten 10 Abrufe, „Weitere 10 anzeigen“ lädt nach (`GET /api/m365-config/snapshots?limit=&offset=`)
- Quellen je Abruf als Zusammenfassung (vollständig, mit Fehler); die Fehler sind aufklappbar und nach fehlender Berechtigung des Dienstprinzipals von UTCM gruppiert
- **Aufbewahrung der Abrufe:** Abrufe ohne Änderungen werden nach `COLLECTOR_SNAPSHOT_KEEP_DAYS` Tagen gelöscht (Vorgabe 90, 0 = nie); Abrufe mit Verlauf und die letzten 10 bleiben. Audit `snapshots_bereinigt`

### Dokumentation

- spec.md (7.1), Handbuch (Snapshots), `.env.example`

### Tests

- `test_m365_versioning.py` (Aufbewahrung), `test_m365_api.py` (seitenweise), `SnapshotsPage.test.tsx`, `snapshotSources.test.ts`

## [0.95.0] – 2026-11-22

### IT-Bestand

- **Statistik neu aufgebaut** (nach dem klickbaren Entwurf): sechs Kennzahlen, die ihren Bereich öffnen; Bereiche Überblick, Alter & Erneuerung, Standorte & Arbeitsplätze, Verleih, Ausmusterung und Datenqualität; Filter nach Hersteller, Art, Standort und Abteilung; Klick auf einen Balken filtert die Seite; je Auswertung Balken oder Tabelle statt Kreis; Druckansicht
- Neue Auswertungen: Hersteller, Erneuerungsbedarf je Geschäftsjahr und überfällig nach Art, Ausstattung der Arbeitsplätze, freie Geräte im Lager, Stellen mit und ohne Hardware, am häufigsten verliehene Arten, Pünktlichkeit der Rückgabe und Dauer, Verbleib und Datenträger-Löschung bei der Ausmusterung, fehlende Angaben, nicht online in NinjaOne, Lücken aus dem Zabbix-Abgleich; Betriebssysteme ohne Herstellersupport hervorgehoben
- **Nutzungsdauer je Hardware-Art** in den Stammdaten (`PUT /api/inventory/kinds/{id}/lifetime`, Migration `0063`)
- API `GET /api/inventory/statistics` liefert jetzt Kennzahlen und Bereiche (`kpis`, `sections`) statt der bisherigen Felder `charts`, `loans`, `retired`

### Dokumentation

- spec.md (Statistik), Handbuch (Statistik, Stammdaten), Info-Symbole

### Tests

- `test_inventory_statistics.py` (Filter, Nutzungsdauer, Verleih), `statistics.test.tsx`, `inventory.test.tsx`, E2E in `bestand.spec.ts`

## [0.94.0] – 2026-11-22

### IT-Bestand

- **Stelle › Hardware:** zeigt neben der Hardware direkt an der Stelle auch die Hardware an den Arbeitsplätzen der Stelle, deutlich getrennt („Direkt an der Stelle“, „Über Arbeitsplätze“ je Arbeitsplatz mit Hinweis „über Arbeitsplatz“ und Zahl der weiteren Stellen bei geteilten Plätzen); API `workplace_hardware`
- **Verleih mit Startdatum:** neues Feld „Ab“ (`start_on`). Liegt es in der Zukunft, ist der Verleih „Geplant“: Geräte sofort reserviert, Nachricht zur Ausgabe am Startdatum (Auftrag `bestand.verleih`), Filter „Geplant“, „Reservierung aufheben“ mit Bestätigung ohne Vorgang und ohne Nachricht; Rückgabedatum nie vor dem Start
- **Standortbaum:** Namen stehen in voller Breite, die Zahl darunter; dadurch kein Umbruch mehr mitten im Namen neben der Zahl

### Dokumentation

- spec.md (Stellen, Verleih), Handbuch (Stellen, Verleih), Info-Symbole

### Tests

- `test_inventory_staff.py`, `test_inventory_loans.py` (geplanter Verleih, Reservierung aufheben), `staff.test.tsx`, `loans.test.tsx`, E2E in `bestand.spec.ts`

## [0.93.0] – 2026-11-22

### Oberfläche

- **Rückmeldungen immer sichtbar:** neue gemeinsame Komponente `components/Feedback.tsx`. Meldungen nach einer Aktion erscheinen unten mittig fest am Bildschirmrand (auf dem Handy über der Leiste unten), auch auf langen Seiten. Erfolg (`role="status"`) verschwindet nach 6 Sekunden, pausiert bei Maus oder Fokus; Fehler (`role="alert"`) bleiben bis zum Schließen
- Umgestellt: Verwaltung (KI, Branding, Ablaufwarnungen, NetBox, NinjaOne, Push, Teams, Internet für IT-Tools, Zabbix), Konto (Sitzungen, Geräte für Push, Benachrichtigungen), M365 (Übersicht, Änderungen), Gerätezuordnung, Evergreen-Steckbrief, IT-Budget (Konten, Partner, Verträge, Budgetposten, Rechnungen, Statistik, Einstellungen, Import), IT-Projekte (Einstellungen, Aufgaben, Jour Fixe), IT-Bestand (Vorgänge, Verleih, Arbeitsplätze, Standorte), IT-Monitoring (DNS-Abgleich, Zabbix), Verlauf der IT-Tools
- Meldungen, die zu einem einzelnen Feld gehören, bleiben am Feld

### Dokumentation

- Neue Regel: Rückmeldungen nach einer Aktion stehen auf PC, Tablet und Handy immer im sichtbaren Bereich (`CLAUDE.md`, `docs/design.md` › Rückmeldungen); WCAG-Nachweis ergänzt

### Tests

- `Feedback.test.tsx`; E2E in `budget.spec.ts` prüft, dass die Meldung im sichtbaren Bereich steht und sich schließen lässt

## [0.92.0] – 2026-11-22

### IT-Monitoring

- **Quelle Zabbix, Stufe 3: Berichte** (spec.md 8b): Seite `/monitoring/zabbix/berichte` mit Verfügbarkeit je Geschäftsjahr (aus den Budget-Einstellungen), aufgeteilt nach Standort oder Hostgruppe, Monatsübersicht, Zielwert (Vorgabe 99,5 %, auf der Verbindungsseite änderbar), häufigsten Auslösern und längsten Ausfällen; Export als CSV und über die Druckansicht als PDF, beides im Audit
- Neue App-Rolle `Monitoring.Berichte`: nur die Berichte, nur Summen ohne Hostnamen und Auslöser (serverseitig)
- Collector-Aufgabe „berichte“ (`zabbix/reports.py`): je abgeschlossenem Tag `event.get` für Ausfälle (Tag `scope: availability` ab Hoch) und alle Probleme, verdichtet zu Ausfallzeiten je Host und Tag, Auslösern je Monat und Ausfällen; Wartungszeiten beobachtet die Werkbank jede Minute selbst. Nicht rückwirkend, ab dem ersten Lauf
- Tabellen `mon_zbx_downtime`, `mon_zbx_trigger_stats`, `mon_zbx_outages`, `mon_zbx_report_days`, `mon_zbx_maint_log`, Spalte `mon_zbx_status.reports_since` (Migration `0062`)
- Verbindung zu Zabbix: Bei einer Weiterleitung nennt die Meldung das Ziel (ohne Abfrage); HTTP 401/403 von einem Proxy davor wird nicht mehr als ungültiges Token gemeldet
- Zabbix-Seiten lassen sich anheften (Navigation)
- Verwaltung › Zabbix: optionale eigene Adresse für „In Zabbix öffnen“, wenn die Werkbank Zabbix über einen anderen Zugang erreicht als die Menschen

### Oberfläche

- Filterleiste auf dem Handy: Das Feld „Zustand“ bekommt seine nötige Breite, „Weitere Filter“ rutscht bei Bedarf in die nächste Zeile; lange Einträge werden nicht mehr abgeschnitten
- Druckansicht ohne Kopfzeile, Menüs, Info-Symbole und Bedienelemente

### Dokumentation

- spec.md 8b, ASVS- und Datenschutz-Nachweis, Entra-Einrichtung (Rolle und Gruppe), Handbuch „Berichte zur Verfügbarkeit“ und Hinweise zur Fehlersuche bei „Zabbix einrichten“, Info-Symbole für Verfügbarkeit, Zielwert und Ausfall

### Tests

- `test_monitoring_zabbix.py` (Berichtsdaten, Rechte, CSV, Weiterleitung, 403), `test_navigation.py`, `reports.test.tsx`, `zabbix.test.tsx`, `navigation.test.ts`, E2E in `monitoring.spec.ts`

## [0.91.0] – 2026-11-22

### IT-Monitoring

- **Quelle Zabbix, Stufe 2: Abgleich mit dem IT-Bestand** (spec.md 8b): `zabbix/inventory.py` verknüpft Hosts und aktive Geräte nur über die Seriennummer (ohne Leerzeichen, Groß- und Kleinschreibung egal; bei doppelter Seriennummer zählt das Gerät mit der kleinsten ID). Lücken: „Nicht überwacht“ (nur Geräte der Hardware-Arten, die der Admin auf der Verbindungsseite wählt), „Ohne Bestandseintrag“, „Seriennummer fehlt“ (nur überwachte Hosts)
- Tabellen `mon_zbx_unmonitored` (bewusst nicht überwacht, mit Begründung) und `mon_zbx_host_links` (Zuordnung von Hand für Hosts ohne Seriennummer) (Migration `0061`)
- Neue Endpunkte `GET /api/monitoring/zabbix/unmonitored`, `PUT`/`DELETE /devices/{id}/unmonitored`, `POST`/`DELETE /hosts/{id}/link`; nur mit `Bestand.Editor` zusätzlich, jede Aktion im Audit und im Verlauf des Geräts
- Übersicht: drei neue Zeilen unter „Zu erledigen“ mit Sprung in die Hosts. Hosts: Filter für die Lücken, Spalte IT-Bestand, Ansicht „Nicht überwacht“ mit Geräten, Begründung und Bestätigung; Host-Ansicht mit dem Gerät im IT-Bestand, Zuordnen und Lösen. Verbindung: Auswahl der Hardware-Arten. Der Filter für abgeschaltete Hosts heißt in der Adresse jetzt `abgeschaltet`

### Dokumentation

- spec.md 8b, ASVS-Nachweis, Handbuch „Abgleich mit dem IT-Bestand“, Info-Symbole für die drei Lücken

### Tests

- `test_monitoring_zabbix.py` (Abgleich, Rechte, Aktionen), `zabbix.test.tsx`, E2E in `monitoring.spec.ts`

## [0.90.0] – 2026-11-22

### IT-Monitoring

- **Quelle Zabbix, Stufe 1 (nur lesen)** (spec.md 8b): neues Modul `backend/werkbank/modules/monitoring/zabbix/` mit API-Client für Zabbix 7.x und 8.0 (`client.py`: nur API-Token im Header `Authorization: Bearer`, `apiinfo.version` ohne Token, keine `hostinterface.*`-Methoden, Zustand der Wartungen selbst errechnet, weil 8.0 „Approaching“ in „Upcoming“ umbenennt und die API ihn nicht liefert), Collector im Worker (Auftrag `monitoring.zabbix` jede Minute: Probleme und Zustand jede Minute, Wartungen alle 15 Minuten, Hosts mit Gruppen, Templates und Inventar sowie Prüfung des Dienstkontos stündlich; ein Ausfall von Zabbix lässt den Auftrag nie scheitern, der letzte Stand bleibt sichtbar)
- Tabellen `mon_zbx_hosts`, `mon_zbx_problems`, `mon_zbx_maintenances`, `mon_zbx_group_sites`, `mon_zbx_runs`, `mon_zbx_status` (Migration `0060`); keine Werte von Items, keine Quittierungs-Kommentare, keine Benutzernamen, aus dem Inventar nur Seriennummer, Modell und Typ
- Seiten `/monitoring/zabbix` (Übersicht mit „Zu erledigen“, Kennzahlen, Problemen mit Filter nach Standort und Mindest-Schweregrad, nicht erreichbaren Hosts und Wartungen), `/monitoring/zabbix/hosts` (Tabelle mit Ansicht rechts), `/monitoring/zabbix/wartungen` und `/monitoring/zabbix/verbindung` (nur Admins: Zustand, Version, Ablauf des Tokens, Abfragen, Rolle des Dienstkontos mit Warnungen, Zuordnung Hostgruppe → Standort des IT-Bestands, Tag für Zertifikate); „In Zabbix öffnen“ an Host und Problem
- Verwaltung › Verbindungen › Zabbix: Adresse, API-Token (verschlüsselt), CA-Zertifikat, Ein/Aus, „Verbindung prüfen“
- Glocke für Admins: Zabbix dreimal hintereinander nicht abfragbar, Token läuft in 30 Tagen ab, Rolle erlaubt zu viel
- Seitenmenü von IT-Monitoring mit den Gruppen „Zabbix“ und „NetBox“; der Bereich öffnet mit der Zabbix-Übersicht. Für die spätere Startseite liefert der DNS-Abgleich `GET /api/monitoring/dns/summary`
- Schweregrade mit Farben, die sich auch in der Helligkeit unterscheiden, immer mit Text

### Dokumentation

- spec.md 8b (Quellen als Module, Monitoring-Start, Zabbix), Rolle `Monitoring.Berichte` in Abschnitt 4 (kommt mit den Berichten), ASVS- und Datenschutz-Nachweis, Handbuch „Übersicht, Hosts und Wartungen“ und „Zabbix einrichten“ (Dienstkonto in Zabbix 7 und 8.0)

### Tests

- `test_monitoring_zabbix.py` mit nachgebildeten Antworten für Zabbix 7.0 und 8.0 (`tests/fixtures/zabbix/`), `zabbix.test.tsx`, E2E in `monitoring.spec.ts`

## [0.89.0] – 2026-11-22

### IT-Tools

- **Bild-Konverter mit PDF in beide Richtungen** (`tools/image-convert/`): neues Zielformat „PDF“ – alle Bilder und PDF-Seiten der Liste ergeben eine PDF, je Seite ein Bild als JPEG (eigener Schreiber `pdf.ts`, ohne Zusatzpaket); wahlweise je Datei eine eigene PDF. Seitengröße A4 (hoch oder quer nach dem Bild, 1 cm Rand, kleine Bilder nicht vergrößert) oder so groß wie das Bild (96 dpi, höchstens 200 Zoll); Qualität und Hintergrund für Transparenz wie bei JPEG
- **PDF als Eingabe:** PDFs lassen sich wie Bilder hinzufügen (Erkennung an `%PDF-`, Vorschau der ersten Seite). Jede gewählte Seite wird ein Bild in jedem Zielformat, mehrere Seiten kommen als ZIP (`name-seite-01.png` …), eine einzelne Seite direkt; Auflösung 72, 150 oder 300 dpi (höchstens 10 000 px je Seite und 40 Megapixel), Seitenangabe wie „1-3, 5“ für alle PDFs der Liste; ICO und Favicon-Paket aus der ersten gewählten Seite. Höchstens 500 Seiten je PDF; kennwortgeschützte PDFs werden mit Hinweis abgelehnt
- **pdf.js** (`pdfjs-dist` 6.5.438, Apache-2.0) zeichnet die Seiten im Browser, wird erst beim Öffnen einer PDF geladen (`pdfread.ts`). Schriften, CMaps und WebAssembly-Dekoder liefert die Werkbank unter `/pdfjs/` selbst aus (Vite-Plugin `pdfjsAssets` in `vite.config.ts`, ohne QuickJS); die Sicherheitsrichtlinie bleibt unverändert. Optionale Abhängigkeit `@napi-rs/canvas` per `overrides` auf 1.1.1 festgelegt, weil 1.2.0 jünger als 7 Tage ist. Lizenzhinweise in `THIRD_PARTY_NOTICES.md`

### Dokumentation

- Regel 6 in `CLAUDE.md` und `CONTRIBUTING.md`: nichts ins Repo, was Rückschlüsse auf Betreiber, Personen oder Orte erlaubt; Testdaten und Verweise auf den externen Entwurf neutralisiert (#163)

### Tests

- `pdf.test.ts` (Seitenlage, Aufbau und Querverweise der PDF, Seitenangaben, Grenzen beim Zeichnen), Erkennung von PDF; E2E Bild-Konverter mit Bild und PDF zu einer PDF und einer PDF-Seite als PNG (`fixtures/drei-seiten.pdf`)

## [0.88.1] – 2026-11-22

### Behoben

- **Info-Blasen** (`components/InfoTip.tsx`): Die Blase liegt jetzt fest im Fenster (`position: fixed`), misst ihren Platz und bleibt mit 8 px Abstand im sichtbaren Bereich; ist unten kein Platz, öffnet sie nach oben, der Pfeil zeigt weiter auf das „i“. Vorher wurde sie in Karten mit `overflow` abgeschnitten, z. B. im IT-Budget auf der Übersicht. Text „Geplant“ in `help/terms.ts` an die Übersicht angepasst
- **IT-Bestand › Statistik**: Die Seite war seit 0.86.0 kaputt, weil die Budget-Statistik die Klassen `.stat-grid`, `.stat-bar` und `.stat-legend` neu belegt hatte (Karten lagen übereinander und über dem Kopf). Die Klassen der Budget-Statistik heißen jetzt `.stat-gridline`, `.stat-yearbar` und `.stat-keys`
- **Verwaltung › Allgemein**: Die drei Bildfelder für Logos und Favicon liefen aus der Karte und übereinander (`fieldset` mit `min-width: min-content`); jetzt `fieldset { min-width: 0 }` und `input[type="file"] { max-width: 100% }`. Auswahl „Größe beim Hochladen“ breit genug für ihren Text
- **IT-Tools**: Das Suchfeld „Tool suchen“ war nur eine dünne Linie; jetzt wie die anderen Eingabefelder
- **Kartenköpfe** (`.panel-head`): Titel und Knöpfe brechen bei wenig Platz um, die Knöpfe stehen dann gemeinsam in einer Zeile unter dem Titel statt übereinander (z. B. Arbeitsplatz, Stelle, Jour Fixe, Rollen und Ansprechpartner)
- **Listen mit Knöpfen** im IT-Budget (Tags, Partner): „Umbenennen/Bearbeiten“ und „Löschen“ stehen nebeneinander
- **Standorte**: Lange Raumnamen brechen im Grundriss um, die Raum-Seite neben dem Grundriss bleibt in ihrer Karte
- **Handbuch › Begriffe A–Z**: Begriffe, Erklärungen und Links laufen nicht mehr aus der Seite (Handy, Tablet und PC)
- **Audit-Log** in der Kartenansicht (Handy, Tablet): Aktion und Details brechen um
- Kurzname „Verwaltung“ in der Bereichsleiste nicht mehr abgeschnitten; lange Wörter in Hinweisen der Verwaltung brechen um

## [0.88.0] – 2026-11-21

### Bedienung

- **Bestätigungsdialog** (spec.md 6.10b, design.md „Bestätigen“): neue Komponente `components/ConfirmDialog.tsx` mit `ConfirmButton` und `useConfirm`. PC und Tablet ein Fenster in der Mitte, Handy ein Blatt von unten (Griff, Wischen nach unten bricht ab), Rolle `alertdialog`, Fokus zuerst auf „Abbrechen“, Esc und Klick daneben brechen ab, offen und gesperrt, solange die Aktion läuft; bei Unumkehrbarem roter Knopf (`--farbe-gefahr`, hell und dunkel), Warnsymbol und Hinweis
- Alle bisherigen Rückfragen direkt in der Seite („Wirklich löschen“, „Ja, …“, „Doch nicht“) auf den Dialog umgestellt: Löschen im IT-Budget (`DeleteButton`), Rechnung löschen, Partner zusammenlegen, Import abbrechen, Projekt, Jour Fixe, Stelle, Arbeitsplatz, Standorte, Räume und Stammdaten löschen, Inventurnummer, Gerät anlegen mit Inventurnummer, Ausmustern, Tool-Verlauf löschen
- Neu mit Rückfrage: Rechnung buchen, Budgetposten abschließen und wieder öffnen, Import-Datei verwerfen, Evergreen-Eintrag abschließen und wieder öffnen, Jour-Fixe-Anhang entfernen, Aufgabe löschen, Grundriss entfernen, Gerätezuordnung (Jetzt freigeben, Zur Freigabe senden, Verwerfen, Admin-Konto trennen), anderes Gerät bzw. alle anderen Geräte abmelden, Push-Gerät entfernen, Branding-Bild entfernen
- `useModal` kennt jetzt mehrere offene Fenster: Tasten gelten nur dem obersten (Esc in der Rückfrage schließt nicht die Geräte-Ansicht dahinter)

### Dokumentation

- Regel „Bestätigen“ in `docs/design.md` und `CLAUDE.md`, `docs/spec.md` 6.10b, Handbuch „Aufbau der Oberfläche“

### Tests

- `ConfirmDialog.test.tsx`, Hilfen `test/confirm.ts` und `confirmDialog` in den E2E-Hilfen; betroffene Unit- und E2E-Tests auf den Dialog umgestellt

## [0.87.0] – 2026-11-21

### Konto

- **Angemeldete Geräte** (spec.md 6.1): Das Konto listet alle eigenen gültigen Sitzungen, dieses Gerät zuerst und markiert, mit Gerät, angemeldet seit und zuletzt aktiv. Andere Geräte lassen sich einzeln oder mit „Auf allen anderen Geräten abmelden“ alle auf einmal abmelden; dieses Gerät weiter über „Abmelden“. Ersetzt den bisherigen Abschnitt „Sitzung“
- Neue Endpunkte `GET /api/account/sessions`, `DELETE /api/account/sessions/{id}` (nur eigene, nicht die laufende) und `POST /api/account/sessions/logout-others` (`core/account_sessions.py`); Audit `sitzung.beendet`, `sitzungen.andere_beendet`
- Gerät als Kurzbeschreibung aus der Browserkennung aus festen Wörtern („Edge unter Windows“, `core/user_agent.py`), neue Spalte `user_sessions.device` (Migration `0059`); ältere Sitzungen erscheinen als „Unbekanntes Gerät“

### Dokumentation

- `docs/spec.md` 6.1 und Seitenübersicht, `docs/datenschutz.md` (Sitzungen), `docs/security/asvs-l2.md` (Sitzungen verwalten)

## [0.86.1] – 2026-11-21

### Sicherheit

- **Image-Scan in der CI:** neuer Job „Trivy (Docker-Image)“ im Workflow „Sicherheit“ (jeder PR, Push auf `main`, wöchentlich). Er baut das Image aus `backend/Dockerfile`, speichert es als Datei und prüft es mit Trivy ohne Zugriff auf den Docker-Socket; Abbruch bei HIGH und CRITICAL, für die es ein Update gibt (`--ignore-unfixed`). Begründete Ausnahmen in `.trivyignore`, die auch der Dateisystem-Scan liest
- **Trivy festgelegt:** `aquasec/trivy:0.76.1` mit Digest statt `latest` (Angriff auf die Trivy-Lieferkette im März 2026, CVE-2026-33634)
- **Laufzeit-Image gehärtet:** Debian-Sicherheitsupdates beim Bauen (behebt u. a. CVE-2026-85091 in zlib); pip und ensurepip werden nach der Installation entfernt, mit ihnen die von pip mitgebrachten Bibliotheken (msgpack, urllib3, setuptools)

### Dokumentation

- `docs/spec.md` (Container-Scan), `docs/repo-setup.md` (neuer Pflicht-Check „Trivy (Docker-Image)“)

## [0.86.0] – 2026-11-21

### IT-Budget

- **Statistik neu** (spec.md, IT-Budget › Statistik): drei Reiter „Überblick“, „Konten und Partner“ und „Nach Tags“; oben Geschäftsjahr und Vergleichsjahr als Auswahlliste
- Neuer Endpunkt `GET /api/budget/statistics/summary`: Plan, Ist, Ist je Monat, je Konto und je Rechnungssteller eines Jahres, Ist des Vergleichsjahrs bis zum selben Tag und im ganzen Jahr, Verträge (Jahreskosten, Kündigungstermine in 90 Tagen, die nächsten drei)
- Neuer Endpunkt `GET /api/budget/statistics/compare`: Plan, Ist und Ist bis zum Stichtag je Konto für das gewählte Jahr und die vier davor (`modules/budget/statistics.py`)
- `POST /api/budget/statistics/query` liefert zusätzlich je Tag die Jahre (`per_tag`) und das Ist bis zum selben Tag (`actual_to_date_cents`)
- Jahresvergleich mit Mehrfachauswahl der Jahre, „Nach Konto“/„Nach Art“, „Bis heute“/„Ganzes Jahr“ und den Darstellungen Säulen (knapp überlappend), überlappende Balken und Balken nebeneinander; Farben aus der Diagrammpalette (`--chart-1` bis `--chart-5`), erwartete Kosten gestrichelt, jede Grafik auch als Tabelle (`StatisticsCharts.tsx`)
- Rückblick/Ausblick der Tag-Statistik entfällt; den Zeitraum bestimmt das oben gewählte Jahr
- Info-Symbole „Ausschöpfung“, „Vergleich mit einem früheren Jahr“ und „Jahresvergleich“; Handbuch-Thema „Mehrjahresübersicht, Statistik und Excel“ überarbeitet

### Tests

- `tests/test_budget_statistics.py` (Stichtage, Überblick, Jahresvergleich, Tags je Jahr, Rechte); E2E der Statistik mit Überblick und Jahresvergleich; Zeitlimit des langen Budget-Durchlaufs auf 90 Sekunden

## [0.85.0] – 2026-11-21

### Evergreen

- **KI-Vorschläge für Rollout und Steckbrief** (spec.md 8.4, 6.9): Der KI-Anbieter aus der Verwaltung liest Rollout-Phasen, Betroffen, Standard und Steuerbar aus dem Text der Meldung von Microsoft (`modules/evergreen/ai_suggest.py`). Übergeben werden nur Titel, Dienste und die Abschnitte „When this will happen“, „How this affects your organization“ und „What you need to do to prepare“. Die Antwort muss ein festes JSON-Format haben (Pydantic-Prüfung, höchstens 6 Phasen, Monate `JJJJ-MM`), sonst wird sie verworfen. Vorschläge füllen nur ungeprüfte Felder und sind violett als „KI-Vorschlag, ungeprüft“ markiert (`ai_suggested`); die Regeln bleiben Ersatz und überschreiben KI-Vorschläge nicht
- Gefragt wird bei neuen Meldungen und geändertem Zeitplan (stündlicher Auftrag `evergreen.ki_vorschlaege`, `ai_pending`), einmalig für alle offenen Meldungen (Migration `0058`) und über „KI-Vorschlag holen“ (`POST /api/evergreen/entries/{id}/ai-suggestion`, nur `Evergreen.Editor`, höchstens alle 10 Minuten je Eintrag). Die Höchstzahl je Stunde gilt für Evergreen gesamt. Verlauf „KI-Vorschlag“, Audit `eintrag.ki_vorschlag` bzw. `ki.vorschlaege` bei Fehlern
- **Eigener Schalter** „Vorschläge für Evergreen einschalten“ in Verwaltung › KI-Texte (`evergreen` in den KI-Einstellungen), unabhängig von den Beschreibungen in M365
- Neues Badge `pill-ki` (violett, Variablen `--farbe-ki-…` hell und dunkel) und Info-Symbol „KI-Vorschlag, ungeprüft“

### Tests

- Audit-Abfragen in `test_evergreen_api.py` sortiert und auf den Testlauf begrenzt (liefen je nach Reihenfolge anderer Tests unterschiedlich)

### Dokumentation

- `docs/spec.md` 6.9, 8.4 und offener Punkt 17, `docs/datenschutz.md` (was an den KI-Anbieter geht)

## [0.84.0] – 2026-11-21

### Handbuch

- **Neu geordnet** (spec.md 6.11): Bereiche in der Reihenfolge der Bereichsleiste, darin Teile wie im Seitenmenü und je Thema eine eigene Seite (`/handbuch/<bereich>/<thema>`); die Texte sind unverändert übernommen, nur neu sortiert. Neue Typen `Area`, `Part`, `Topic` (`handbook/types.ts`), Hilfen `areasFor`, `topicsFor`, `findTopic`, `topicPath`, `parseHandbookPath`. Alte Adressen werden nicht weitergeleitet
- **Eigenes Seitenmenü** (`components/nav/HandbookMenu.tsx`): Suche, „Übersicht“, Bereiche zum Aufklappen mit Zahl der Themen (Zustand je Browser), Teile als Überschriften; am Handy „Alle Themen“ als Blatt von unten
- **Themenseite** mit Pfad, Rollen, Verweis in die Werkbank, „Weitere Themen in …“ und vor/zurück; Bereichsseite mit allen Themen
- **Neue Themen** „Info-Symbole und Hilfe“ (Grundlagen) und „Begriffe A–Z“ (Fragen und Hilfe)

### Alle Bereiche

- **Info-Symbole „i“** (`components/InfoTip.tsx`, Texte in `help/terms.ts`): kurze Erklärung als Blase mit „Mehr im Handbuch“, passend zur hellen und dunklen Darstellung (neue Variablen `--farbe-blase…`), bedienbar per Klick, Tastatur und Esc. Eingebaut an Kennzahlen und Begriffen in M365 (Überwachte Einstellungen, Abweichungen, Gelesene Objekte, Kritikalität, Soll-Wert, Punkte, Auswirkung auf Nutzer), Tenant (Frei, Handlungsbedarf), Gerätezuordnung (Ziel-Tenant, Konformität), Evergreen (Steckbrief, Rollout, Vorschlag, Mitbestimmung, Info-Meldungen), IT-Budget (Geplant, Ist, Verfügbar, AVV, Kündigungstermin, Wenn nicht gekündigt), IT-Projekte (Veranschlagt, Ist) und IT-Bestand (Inventurnummer, Herkunft, Datenträger, überfällig)
- **„Hilfe“ am Seitentitel** neben dem Stern, führt zum passenden Thema im Handbuch (Zuordnung `PAGE_HELP` in `help/terms.ts`)
- Auf Handbuch-Seiten ist in der Bereichsleiste nur noch „Handbuch“ markiert

### Dokumentation

- `CLAUDE.md`: Info-Symbole bei jeder Änderung mitpflegen und das Ergebnis nennen; `docs/spec.md` 6.11 und Screens, `docs/design.md` (Info-Symbol, Hilfe am Seitentitel, Handbuch-Menü), `docs/a11y-wcag22.md`

## [0.83.0] – 2026-11-21

### Evergreen

- **Liste und Ansicht statt Tabelle** (spec.md 8.3): Liste mit fester Breite (280–360 px) und eigener Scrollleiste; Suche, Status-Chips Offen, Neu, Mit Frist, Abgeschlossen (mit Zahl, seitlich scrollbar), Schalter „Reine Info-Meldungen ausblenden“ (Kategorie `stayInformed` ohne „User impact“/„Admin impact“, Standard an, `werkbank-evergreen-info` im Browser). Offene Einträge in Gruppen Mit Frist (nach Frist), Neu, In Bearbeitung mit haftenden Überschriften; der ganze Listeneintrag ist ein Link mit `aria-current`. `GET /api/evergreen/entries` liefert bis zu 500 Einträge ohne Seiten (`limit`), neuer Status `frist`, `hide_info`, Zähler `due` und `done`, je Eintrag `kind` (Art) und `info_only`. Filter „Bearbeitet“ und „Alle“ entfallen in der Oberfläche
- **Steckbrief:** Kopfzeile mit EV- und MC-Nummer, Veröffentlichung und Status; Badges Dienst, Art (aus den Kennzeichen), Betrifft Nutzer/Admins, Größere Änderung, Handlung nötig; Kacheln Betroffen, Standard, Steuerbar, Handeln bis (orange bei Frist oder „eingeschaltet“)
- **Rollout als Zeitstrahl** (neue Komponente `components/Timeline.tsx`): Monate als Spalten, Balken je Phase, Linie „heute“, früherer Plan schraffiert; dieselben Angaben als Liste für Screenreader
- **Drei Reiter** (neue Komponente `components/Tabs.tsx`, Pfeiltasten, Pos1/Ende): Unsere Bewertung (Kurzfassung, Änderung für Mitarbeitende, Schulung, Mitbestimmung Ja/Nein/Noch prüfen mit Begründung, verknüpfte Einstellung, Steckbrief und bis zu 6 Phasen), Text von Microsoft (Abschnitte zum Aufklappen, `lang="en"`), Notizen und Verlauf
- **Bewertung speichern:** `PUT /api/evergreen/entries/{id}/assessment` (nur `Evergreen.Editor`, auch an abgeschlossenen Einträgen); geänderte Felder mit vorher/nachher im Verlauf („Bewertung geändert“, `ev_notes.details`) und im Audit-Log (`eintrag.bewertet`); ein neuer Eintrag wird „bearbeitet“. Einstellungen zum Verknüpfen sucht `GET /api/evergreen/settings` (höchstens 20); den Link zur Einstellung sieht nur, wer die M365-Konfiguration lesen darf. `LookupPicker` nimmt dafür eine eigene Suche an
- **Nachrichtencenter:** Kennzeichen (`tags`) werden übernommen; der Text wird an den Überschriften in Abschnitte zerlegt (`modules/evergreen/rules.py`). Aus „When this will happen“ entstehen per Regeln (ohne KI) Vorschläge für Rollout-Phasen, aus den Kennzeichen für „Betroffen“, markiert als „Vorschlag, ungeprüft“ bis zum Speichern der Bewertung. Ändert Microsoft den Zeitplan, bleiben der alte Text und die alten Phasen als „vorher“ erhalten (Verlauf „Zeitplan geändert“). Bestehende Meldungen ergänzt der nächste Abruf
- Migration `0057`: neue Spalten an `ev_entries` (Kennzeichen, Abschnitte, Zeitplan vorher, Steckbrief, Phasen, Bewertung, `setting_id`) und `ev_notes.details`
- Rollenbeschreibungen von `Evergreen.Reader` und `Evergreen.Editor` nennen die Bewertung

### Alle Bereiche

- **Liste und Ansicht** (Verleih, Evergreen): unter 1200 px ist das Seitenmenü eingeklappt wie mit „Menü einklappen“ (Bereichsleiste bleibt, „Menü ausklappen“ öffnet es für die Seite wieder; `listViewPage` in `Layout.tsx`), unter 1100 px statt 1024 px erst nur die Liste; Liste höchstens 360 px breit
- Blaue Status-Badges haben einen feinen Rahmen (neue Farbe `--farbe-info-rand` in hell und dunkel), damit sie auf einer gewählten Zeile sichtbar bleiben

### Dokumentation

- `docs/spec.md` Kapitel 8 (8.1, 8.3, neu 8.4), Datenmodell, Screens, offene Punkte 16 (BR-Vorlage) und 17 (Vorschläge per Regeln); `docs/design.md` mit den Mustern Steckbrief, Zeitstrahl und Reiter

## [0.82.0] – 2026-11-21

### IT-Budget

- **Neuer Aufbau nach dem klickbaren Entwurf:** Budgetposten, Rechnungen und Verträge als Tabelle mit Ansicht rechts (wie die Vorgänge im IT-Bestand, Trenner 30–75 %, im Browser gemerkt); Anlegen und Bearbeiten in derselben Ansicht, Masken in nummerierten Abschnitten mit Pflichtfeldern und Zusammenfassung in Worten
- **Feste Nummer je Budgetposten** `BP-<Jahr>-<laufende Nummer>` (z. B. BP-2026-012): Jahr = erstes Geschäftsjahr beim Anlegen, laufende Nummer je Jahr, ändert sich nie. Spalten `number_year`, `number_seq` mit eindeutiger Kombination, Migration `0056` nummeriert bestehende Posten je Jahr in der Reihenfolge der Anlage. Vergabe unter einer Datenbanksperre (`modules/budget/numbers.py`), auch beim Import. `number` in `ItemOut`, `item_number` an Rechnungspositionen, `number` an den Posten eines Vertrags. Die Suche über alle Module findet Posten über die Nummer und öffnet ihn
- **Budgetposten:** Spalten Nr., Budgetposten, Konto, Partner, Geplant, Ist, Status, Vorjahr; sortieren über die Spaltenköpfe (`aria-sort`), gruppieren nach Konto, Partner oder gar nicht; Status-Filter mit „Ohne Partner“; Ansicht mit Schrittfolge des Status, Geplant/Ist/Verfügbar, Angaben und den Rechnungen auf dem Posten; Feld „Betrag (Brutto)“, bei einmaligen Posten heißt das Jahr „<Geschäftsjahr>“ statt „Ab <Geschäftsjahr>“
- **Farben nach der Designrichtlinie:** „offen“ orange, „Rechnung liegt vor“ blau, „abgeschlossen“ grün
- **Rechnungen:** Suche, Filter Zu prüfen/Gebucht/Alle, Rechnungssteller und Konto; Ansicht mit Positionen, Beleg und Aktionen; in der Maske zuerst der Rechnungssteller, seine Posten stehen oben in der Auswahl
- **Verträge:** Kennzahlen (laufend, Soll, Ist, AVV fehlt), Filter Laufend, Kündigung bald, Gekündigt, AVV fehlt, Alle sowie Partner und Turnus; Maske mit Turnus zuerst und passend benanntem Betragsfeld. **Monatsposten anlegen:** `POST /api/budget/contracts/{id}/monthly-items` legt für einen monatlichen Vertrag je fälliger Zahlung im Geschäftsjahr einen Posten an (Partner und Bruttobetrag aus dem Vertrag, dem Vertrag zugeordnet, vorhandene Monate übersprungen), Audit `budget.monatsposten_angelegt`. Neue Rechenhilfe `due_dates` (Fälligkeiten im Zeitraum), `expected_cents` nutzt sie
- **Übersicht:** „Zu erledigen“ mit Sprung in die Liste, Kennzahlen Geplant, Ist, Verfügbar, Budgetposten; Budget nach Konten getrennt nach laufenden Kosten und Investitionen mit Auslastung; Kündigungstermine und „Zuletzt gebucht“. Prognose entfällt in der Übersicht

### Alle Bereiche

- **Filter über Listen als gemeinsame Komponente** `components/FilterBar.tsx`: am Computer und Tablet Suche, beschriftete Filter und Status-Chips mit Anzahl („Offen · 3“) in einer Zeile, „Filter aufheben“; am Handy Status als Auswahl und „Weitere Filter“ in einem Blatt von unten (modal, „Zurücksetzen“, „Fertig“). Umgestellt: Vorgänge, Verleih, Hardware, Arbeitsplätze, Evergreen, IT-Projekte, M365-Änderungen und -Empfehlungen, Zertifikate und Secrets, DNS-Abgleich, Gerätezuordnung, Import-Vorgänge und Import-Zeilen. `ListSearch` entfällt
- **Listen am Handy als Karten:** `table-cards` deutlicher (Rahmen, Abstand, Schatten, Gruppen und Summen), dazu Partner, Konten, Import-Vorgänge, Projekte, Lizenzen, Zertifikate, DNS-Einträge, Snapshots, Audit-Log, Rollen und Personen; Tabellen mit Ansicht rechts (`case-table`) und Listen mit Ansicht (`case-item`) unter 1024 px als Karten
- Gemeinsame Bausteine `FormStep` (Masken in Abschnitten) und `segmented` (Knopfleiste mit `aria-pressed`), sortierbare Spaltenköpfe `th-sort`
- `docs/design.md`: Filterzeile, Karten am Handy, Masken in Abschnitten, Tabelle mit Ansicht rechts auch im IT-Budget, Statusfarben; `docs/spec.md`, `docs/a11y-wcag22.md`, `docs/security/asvs-l2.md` und Handbuch angepasst

## [0.81.0] – 2026-11-21

### IT-Budget

- **Import abbrechen:** Knopf „Import abbrechen“ im Vorgang (mit Rückfrage). Offene und übersprungene Zeilen werden gelöscht, übernommene Zeilen und ihre Budgetposten bleiben; der Vorgang steht als „abgebrochen“ in der Liste (Filter „Abgeschlossen“) und ist keine Aufgabe mehr. `POST /api/budget/imports/{id}/cancel`, Audit `budget.import_abgebrochen`
- **Zeilen löschen:** offene oder übersprungene Zeilen einzeln löschen (mit Rückfrage), übernommene bleiben. `DELETE /api/budget/imports/{id}/rows/{row}`, Audit `budget.import_zeile_geloescht`

## [0.80.0] – 2026-11-21

### IT-Budget

- **Partner am Budgetposten (Pflicht):** neues Feld beim Anlegen und Ändern (`partner_id`, Migration `0055`). Ältere Posten ohne Partner zeigen „Partner fehlt“ und brauchen ihn beim nächsten Speichern. Die Liste zeigt den Partner, die Suche findet ihn. Partner zusammenlegen nimmt Posten mit, ein Partner mit Posten lässt sich nicht löschen, die Partnerseite zeigt seine Posten. Rechnungen behalten ihren eigenen Rechnungssteller
- **Budgetposten:** Spalten „Prognose“ und „Abweichung“ entfernt (Übersicht unverändert)
- **Import aus Excel legt keine Rechnung mehr an:** „Übernehmen“ legt nur den Budgetposten mit dem gewählten Partner an; Rechnungsnummer, interne Nummer und Datum aus der Datei stehen in der Notiz des Postens. Rechnungsfelder und Steuersatz entfallen in der Zeile und beim Start, ebenso die Hinweise zu fehlender Rechnungsnummer und fehlendem Datum. Die Zeile merkt sich ihren Posten (`budget_import_rows.item_id`, für frühere Übernahmen aus der Rechnung nachgetragen). API `take`: nur noch `description`, `account_id`, `gross_cents`, `yearly`, Partner

## [0.79.0] – 2026-11-21

### IT-Budget

- **Budgetposten abhaken:** Unter „Budgetposten“ gibt es „Abschließen“ und „Wieder öffnen“ für das gewählte Geschäftsjahr (`Budget.Editor`, `Budget.Manager`). Neue Endpunkte `POST /api/budget/items/{id}/close` und `…/reopen`, gespeichert je Posten und Jahr (Tabelle `budget_item_closures`, Migration `0054`), Audit `budget.posten_abgeschlossen` und `budget.posten_wieder_geoeffnet`. Der Haken „schließt den Posten ab“ an der Rechnungsposition bleibt; was eine Rechnung abschließt, öffnet „Wieder öffnen“ nicht
- **Verträge mit Soll und Ist je Geschäftsjahr** (Auswahl oben, `GET /api/budget/contracts?year=`): Soll = im Jahr fällige Zahlungen (nach Kündigung nur bis zum Kündigungstag), Ist = gebuchte Rechnungen der zugeordneten Posten, die im Jahr abgeschlossen sind, dazu „x von y Posten abgeschlossen“. Neue Felder `year_actual_cents`, `closed_items`, `year`, `years`
- Liste der Verträge: Betrag je Zahlung mit Turnus, bei monatlich, vierteljährlich und halbjährlich dazu die Summe eines vollen Jahres; Spalten Soll und Ist; Summen Soll und Ist oben. Die Vertragsmaske zeigt die Jahressumme schon bei der Eingabe

## [0.78.0] – 2026-11-21

### IT-Budget

- **Import aus Excel: je Zeile ein eigener Budgetposten.** Das Pflichtfeld „Budgetposten“ beim Übernehmen entfällt. Übernehmen legt den Posten aus der Zeile an (Name aus der Bezeichnung, sonst der Partner, im Konto doppelt: mit Nummer wie „Mobilfunk (2)“; erwartete Kosten = Betrag, im Geschäftsjahr des Imports) und eine gebuchte Rechnung, die ihn abschließt. Gewählt wird nur noch das Konto
- Der Start eines Imports legt keinen Posten „Allgemein <Geschäftsjahr>“ mit dem Konto-Budget mehr an, nur noch fehlende Konten. Bereits angelegte „Allgemein“-Posten bleiben unverändert
- „Vorschläge für die Planung“ (Zeilen mit „Jährlich“) verlängert den Posten der Zeile ins folgende Geschäftsjahr (bis auf Weiteres oder nur dieses Jahr) mit änderbaren Kosten je Jahr, statt einen zweiten Posten anzulegen
- API: `take` erwartet `account_id` statt `item_id`; `plan` ohne `name`, Antwort `extended` statt `created`/`existing`; Zeilen liefern den angelegten Posten (`item_id`, `item_name`)

## [0.77.0] – 2026-11-21

### Gerätezuordnung (neu)

- **Neue Seite** Microsoft 365 › Geräte › „Gerätezuordnung“ (`/m365/geraete/zuordnung`) mit eigener Rolle `Geraete.Zuordnung` (**in Entra anlegen und zuweisen**, siehe `docs/entra-setup.md`, Kapitel 4a). Vorlage: AutopilotQR (MIT, Hinweis in `THIRD_PARTY_NOTICES.md`)
- **QR-Code aus der Windows-Einrichtung scannen** (Device Preparation): Kamera mit laufender Erkennung oder Foto; Erkennung mit `zxing-wasm` 3.1.6 (MIT, enthält ZXing-C++ unter Apache 2.0), WASM selbst gehostet, erst beim ersten Scan geladen. Der Server prüft den Code und baut die Gerätedaten für Microsoft
- **Zwei Abläufe:** sofort freigeben (Ziel-Tenant bestätigen, Richtlinie wählen) oder „Zur Freigabe senden“; freigeben kann dieselbe oder eine andere Person, „Verwerfen“ löscht den Eintrag. Gerätedaten verschlüsselt, höchstens 24 Stunden, danach gelöscht
- **Admin-Konto:** zweite Anmeldung über den Server (Autorisierungscode mit PKCE, Rückweg `/auth/geraete/callback`) mit delegierten Berechtigungen der Werkbank-App; nur das Zugriffstoken, verschlüsselt und an die Sitzung gebunden, höchstens 60 Minuten. Keine Anwendungsberechtigung mit Schreibrecht
- **Microsoft Graph (beta):** Device-Preparation-Richtlinien, Duplikatsperre über die Seriennummer, `importTenantAssociatedDevice` mit Bestätigung (alle 3 s bis 30 s); 429 mit `Retry-After` höchstens dreimal, 5xx ohne neuen Versuch mit den Voraussetzungen am Gerät, Request-ID immer sichtbar
- **Status** Wartet auf Freigabe › Vorab zugeordnet › Zugeordnet › In Intune registriert, nach 7 Tagen ohne Fortschritt „Nicht abgeschlossen“. Auftrag `geraete.status` alle 5 Minuten: löscht abgelaufene Gerätedaten und Tokens, prüft offene Einträge nur lesend mit der Collector-App, wenn `DEVICES_MONITOR_ENABLED=true` (Berechtigungen `DeviceManagementServiceConfig.Read.All`, `DeviceManagementManagedDevices.Read.All`)
- Aufgabe „Geräte warten auf Freigabe“; Benachrichtigungen `geraete.zugeordnet` und `geraete.registriert`; Audit je Gerät
- Datenbank: Migration `0053_geraetezuordnung` (Tabellen `dev_associations`, `dev_admin_sessions`)

### Sicherheit

- CSP `script-src 'self' 'wasm-unsafe-eval'` für die QR-Erkennung, `Permissions-Policy` `camera=(self)`
- IT-Tools › CSR: Der angezeigte OpenSSL-Befehl maskiert im Betreff jetzt auch Backslash und Plus, nicht nur den Schrägstrich (CodeQL-Meldung „Incomplete string escaping“)
- IT-Budget › Excel-Export: In XML verbotene Zeichen U+FFFE und U+FFFF stehen im regulären Ausdruck jetzt als Escape statt unsichtbar im Quelltext (CodeQL-Meldung „Overly permissive regular expression range“, Wirkung unverändert)

### Dokumentation

- `docs/spec.md` Kapitel 7c, `docs/entra-setup.md` Kapitel 4a (Umleitungs-URI, delegierte Berechtigungen, Zustimmung, Intune-Rolle, Collector), Datenschutz, ASVS, WCAG, Design, `deploy/.env.example`, Handbuch-Kapitel „Microsoft 365: Gerätezuordnung“; neu `THIRD_PARTY_NOTICES.md`

### Tests

- Lesen des QR-Codes mit erfundenen Daten und optionalem Golden-Test aus `backend/tests/fixtures-private/` (per `.gitignore` ausgeschlossen), Rollen, Freigabe durch eine andere Person, Verwerfen, Löschen nach 24 Stunden, Graph mit nachgestellten Antworten, Oberfläche (Vitest) und E2E `geraete.spec.ts` mit nachgestelltem Graph

## [0.76.0] – 2026-11-21

### Evergreen

- **Nur noch für die IT:** Der Freigabe-Ablauf mit Fachabteilungen, Betriebsrat und Geschäftsführung, die geplante Umsetzung (Soll-Werte mit Prüfung) und der Eingang entfallen. Rollen jetzt `Evergreen.Reader` und `Evergreen.Editor` statt `Evergreen.IT`, `.Team`, `.Betriebsrat` und `.GF` (**in Entra anlegen und zuweisen**, siehe `docs/entra-setup.md`)
- **Unterabschnitt je Software:** zunächst „Microsoft 365“ (`/evergreen/m365`); weitere Software lässt sich später ergänzen (`software` am Eintrag). `/evergreen` führt zu Microsoft 365
- **Einträge statt Eingang und Vorgänge:** Jede Meldung aus dem Nachrichtencenter wird ein Eintrag mit Status „neu“; dazu Einträge von Hand und aus erkannten Änderungen der M365-Konfiguration. Aktualisiert Microsoft eine Meldung, werden die Angaben übernommen und im Verlauf vermerkt; der Status bleibt
- **Status neu → bearbeitet → abgeschlossen:** Bearbeiter fügen Notizen an (mehrfach, auch verschiedene Personen); die erste Notiz setzt „bearbeitet“. Abschließen und wieder öffnen jeweils mit optionaler Notiz
- **Liste und Ansicht** wie die Vorgänge im IT-Bestand: Tabelle mit Nr., Titel, Dienst, Eingang, Bearbeitet von, Status; Filter, Suche (auch nach `MC…`), Ansicht rechts mit einstellbarer Breite
- **Aufgaben und Benachrichtigungen nur für Bearbeiter:** Aufgabe „Microsoft 365: neue Einträge sichten“; eine Benachrichtigung „Neue Einträge“ je Software mit Anzahl (statt einer je Meldung). Leser haben keine Aufgaben aus Evergreen
- Startseite: Kachel zeigt offene und neue Einträge. M365-Konfiguration: „Evergreen-Eintrag anlegen“ bei einer Änderung (nur `Evergreen.Editor`); der Hinweis „Geregelt durch Evergreen-Vorgang“ entfällt, gesetzte Soll-Werte bleiben

### Anmeldung

- Abstand zwischen dem Hinweis „Sitzung abgelaufen“ und dem Knopf „Mit Microsoft anmelden“ (der Hinweis klebte am Knopf)

### Daten (Migration 0052)

- **Löscht alle bisherigen Evergreen-Daten** (Vorgänge, Meldungen, geplante Umsetzung, Protokoll des Ablaufs), wie beschlossen. Vor dem Update ein Backup ziehen. Der nächste Abruf holt die Meldungen der letzten 30 Tage neu
- Neue Tabellen `ev_entries` und `ev_notes`. Entfernt werden auch Benachrichtigungen, Stummschaltungen und Kanäle der alten Arten, offene Aufträge `evergreen.umsetzung_pruefen` und angeheftete oder besuchte Seiten unter `/evergreen`
- Die Ablauf-Engine (`core/workflow.py`) bleibt im Kern, wird aber von keinem Bereich mehr genutzt; ihre Tests laufen mit einem Beispiel-Ablauf

### Technik

- Breit scrollt die Ansicht rechts für sich wie die Tabelle (IT-Bestand und Evergreen); die Seite bleibt stehen, das „×“ rutscht nicht mehr unter die Kopfzeile
- Trenner zwischen Tabelle und Ansicht als gemeinsame Komponente (`components/SplitHandle.tsx`), genutzt von IT-Bestand › Vorgänge und Evergreen

### Repository

- `CLAUDE.md`: beim Versionssprung `backend/uv.lock` neu erzeugen

### Tests und Dokumentation

- Backend-Tests für Einträge, Statuswechsel, Rechte, Nachrichtencenter, Aufgaben, Benachrichtigungen und Suche neu; Frontend-Tests für die Seite; E2E `evergreen.spec.ts` neu, übrige E2E auf die neuen Rollen umgestellt
- `docs/spec.md` (Kapitel 8 neu, Rollen, Benachrichtigungen, Datenmodell), `entra-setup.md`, `datenschutz.md`, `security/asvs-l2.md`, `a11y-wcag22.md`, `design.md`, `inbetriebnahme.md` und Handbuch angepasst

## [0.75.0] – 2026-11-21

### IT-Bestand

- **Vorgänge ohne Auswahl über die ganze Breite:** In 0.74.0 stand die Tabelle erst nach dem Klick auf einen Vorgang richtig; die Regel für die Tabelle verlor gegen die allgemeine für Liste und Ansicht
- **Feld „Art“** mit Rahmen und Höhe wie das Suchfeld; schmal stehen Suche und Art in einer Zeile („Art“ nur für Screenreader)
- **Breite von Tabelle und Ansicht einstellbar:** Trenner zum Ziehen, mit Pfeiltasten, Pos1/Ende, Doppelklick setzt zurück (30–75 %), gemerkt im Browser (`werkbank-vorgaenge-breite`). Ist die Tabelle breit genug, zeigt sie alle Spalten (Container-Query); „×“ bleibt oben rechts
- **Entscheidung kompakter:** Möglichkeiten als Chips statt Kacheln; die Erklärung steht hinter „i“ (Knopf mit `aria-expanded`) und zur gewählten Möglichkeit unter den Chips. Bei „Neu in NinjaOne“ und „Neuer Monitor“ gruppiert: Zuordnen, Ohne Zuordnung, Nicht neu anlegen

### Tests und Dokumentation

- Frontend-Tests für Trenner (Tastatur, gespeicherte Breite) und die Erklärung per „i“
- `docs/design.md`, `docs/a11y-wcag22.md` und Handbuch angepasst

## [0.74.0] – 2026-11-20

### IT-Bestand

- **Vorgänge kompakter:** Kopf in einer Zeile (Titel, Zahl offener Vorgänge, Stand des Abgleichs mit NinjaOne, „Jetzt abgleichen“), Beschreibungstext entfällt (steht im Handbuch). Suche, Status und Art in einer Zeile über der Liste
- **Vorgänge als Tabelle:** Spalten Nr., Titel, Art, Eingang, Bearbeitet von, Status über die ganze Breite; die ganze Zeile ist anklickbar, der Titel ist der Verweis. Ein gewählter Vorgang öffnet rechts daneben (54/46), die Tabelle zeigt dann nur Nr., Titel und Status; „×“ schließt die Ansicht
- **Vorgänge auf dem Handy:** unter 1024 px eine Zeile je Vorgang (Nummer, Art und Eingang klein über dem Titel, Status rechts), Status-Chips in einer Zeile zum Wischen, gewählt nur die Ansicht mit „‹ Zur Liste“
- Verleih bleibt bei Liste und Ansicht

### Tests und Dokumentation

- Frontend-Tests für Tabelle, Klick auf die Zeile und Schließen der Ansicht; E2E `bestand.spec.ts` angepasst
- `docs/design.md`, `docs/a11y-wcag22.md` und Handbuch angepasst

## [0.73.1] – 2026-11-20

### Technik

- **Python 3.14:** Docker-Image (`python:3.14-slim`) und CI laufen mit Python 3.14 statt 3.12; `requires-python`, ruff und mypy entsprechend. ruff-Anpassungen für 3.14 (Rückgabetypen ohne Anführungszeichen, `except` ohne Klammern nach PEP 758)
- **Lockfile für das Backend:** `backend/uv.lock` mit festen Versionen und Hashes (erzeugt mit uv 0.13.8; `[tool.uv] exclude-newer = "7 days"` nimmt nur Versionen, die mindestens 7 Tage alt sind). Docker und CI installieren nur von dort (`--require-hashes`), die CI prüft mit `uv lock --check`, ob Lockfile und `pyproject.toml` zusammenpassen. Dependabot betreut jetzt `uv` statt `pip`; Hauptversionen kommen als eigener PR
- Anleitung zum Neuerzeugen des Lockfiles in `docs/repo-setup.md`

### Repository

- **Node 26:** Frontend-Build im Docker-Image (`node:26-alpine`), CI und Lockfile-Workflow mit Node 26 (LTS bis April 2029) statt 22 (Wartung bis April 2027); `@types/node` passend auf 26. Node dient nur zum Bauen und Testen, die Anwendung selbst läuft mit Python
- `CLAUDE.md`: Regel, aktuelle stabile Versionen von Frameworks und Paketen und ihre aktuellen Schnittstellen zu nutzen, wenn möglich (Prüfung vor neuen Abhängigkeiten, Updates in eigenem PR, Major-Updates nach Rückfrage)

## [0.73.0] – 2026-11-20

### IT-Bestand

- **Auswahl mit Suche:** Neuer Endpunkt `GET /api/inventory/lookup` (Stellen, Arbeitsplätze, Räume, Geräte; höchstens 20 Treffer mit Gesamtzahl, Geräte ohne ausgemusterte, `computers=true` nur Notebooks und PCs). Neue Combobox `LookupPicker` statt langer Auswahllisten bei der Entscheidung im Vorgang (Stelle, Arbeitsplatz, Raum, vorhandenes Gerät) und beim Arbeitsplatz (Raum, Stellen)
- **Arbeitsplatz anlegen:** Raum ist Pflicht (Oberfläche und Server, nur beim Anlegen); der Grundriss der Etage erscheint gleich darunter, ein Klick in den Raum setzt den Platz (freiwillig, `spot_x`/`spot_y` beim Anlegen)
- **Standorte neu aufgebaut:** Baum links ein- und ausblendbar (gemerkt im Browser), jede Ebene mit eigenem Pfeil zum Auf- und Zuklappen, der Name öffnet die Ebene. Rechts genau die Auswahl: Stadt, Standort und Abschnitt mit eigener Seite (`/bestand/standorte/{stadt|standort|abschnitt}/{id}`), „Neuer …“, Umbenennen und Löschen dort; Etage mit anklickbarem Pfad und „Etage bearbeiten“ (Grundriss, Name, Reihenfolge, Löschen); gewählter Raum mit Arbeitsplätzen neben dem Grundriss statt darunter. Der Block „Standorte pflegen“ entfällt
- **Navigation:** Neues Symbol für „Verwaltung“ (Person mit Schild); das alte Zahnrad sah aus wie die Sonne für „hell“
- **Vorgänge und Verleih:** Suche und Filter oben in der Liste, neuer Filter „Art“ bei den Vorgängen (`kind`), Liste mit fester Höhe und eigenem Scrollen, Ansicht daneben bleibt stehen; unter 1024 px erst nur die Liste, gewählt nur die Ansicht mit „Zur Liste“

### Tests und Dokumentation

- Backend `test_inventory_lookup.py` (Treffer, Grenzen, Rechte, Pflicht-Raum, Platz beim Anlegen), Filter nach Art; bestehende Tests legen Arbeitsplätze mit Raum an (`tests/inventory_rooms.py`)
- Frontend-Tests für Auswahl mit Suche, Arbeitsplatz anlegen, Standorte (Raum neben dem Grundriss, Baum auf und zu, Abschnitt mit neuer Etage) und Liste der Vorgänge; E2E `bestand.spec.ts` angepasst
- `docs/spec.md`, `docs/design.md`, `docs/security/asvs-l2.md`, `docs/a11y-wcag22.md` und Handbuch angepasst

## [0.72.0] – 2026-11-20

### Navigation

- **Bereichsleiste** (76 px) ganz links: Symbol mit Kurznamen je Bereich, voller Name als Tooltip und `aria-label`, Abschnitte Start | M365, Evergreen | Monitoring, Bestand | Budget, Projekte | Tools; am Fuß Verwaltung (nur Admin) und Handbuch. Punkt am Symbol bei offenen Aufgaben im Bereich
- **Seitenmenü** (256 px): Name des Bereichs, Seiten in Gruppen zum Auf- und Zuklappen (`aria-expanded`, Zustand je Browser); neue Gruppen im IT-Budget (Überblick, Ausgaben, Stammdaten, Verwaltung anfangs eingeklappt) und im IT-Bestand (Bestand, Verleih, Verwaltung anfangs eingeklappt); „Menü einklappen“ lässt nur die Bereichsleiste stehen. Der Menüpunkt bleibt auch auf Detailseiten hervorgehoben
- **Kontomenü** oben rechts (Initialen oder Bild) mit Konto, Release Notes, Hell/Dunkel/Automatisch, „Zuletzt besucht leeren“ und Abmelden; Menü-Muster mit Tastatur. Die alten Knöpfe am Fuß der Navigation, „Abmelden“ und die Person in der Kopfzeile entfallen
- **Anheften und „Zuletzt besucht“:** Stern neben jeder Seite im Seitenmenü und hinter dem Seitentitel; Gruppen „Angeheftet“ und „Zuletzt besucht“ im Start-Bereich und auf der Startseite. Gespeichert je Person auf dem Server: Tabelle `nav_entries` (Migration 0051), `GET/PUT/POST/DELETE /api/navigation`, nur eigene Einträge, nur Pfade aus einer Liste erlaubter Seiten mit derselben Rollenlogik (`core/navigation.py`), höchstens 20 bzw. 10 Einträge, Filter nach Rollen auch bei der Ausgabe
- **Schnellsuche** (Strg+K / ⌘K, Suchfeld in der Kopfzeile): findet Seiten nach Name, Gruppe und Bereich, nur mit Recht; ohne Eingabe „Zuletzt besucht“; modaler Dialog mit Combobox, Fokusfalle und Rückgabe des Fokus; „In allen Einträgen suchen“ führt zur Seite „Suche“
- **Handy** (bis 760 px): feste Leiste unten mit Start, Suche, Aufgaben und Menü (`safe-area-inset-bottom`); „Menü“ öffnet ein Blatt von unten mit den Seiten des Bereichs und „‹ Alle Bereiche“; Schnellsuche im Vollbild mit „Abbrechen“; schmalere, haftende Kopfzeile
- Neue Symbole in `Icon.tsx` (Stern, Pfeile, Menü, Schließen, Konto, Abmelden, Automatisch, Aufgaben, Glocke, Löschen, Evergreen, Gerät); keine Symbole mehr direkt im Markup von Kopfzeile und Glocke

### IT-Bestand

- Neue Aufgabe „Offene Vorgänge bearbeiten“ für `Bestand.Editor` (`modules/inventory/tasks.py`); damit bekommt „Bestand“ in der Bereichsleiste einen Punkt

### Tests und Dokumentation

- Backend: `test_navigation.py` (Rechte, nur eigene Einträge, Grenzen, Filter nach Entzug der Rolle, Aufgabe für offene Vorgänge); Frontend: `navigation.test.ts`, `nav.test.tsx`, Startseite; E2E für Desktop, Tablet und iPhone mit axe (`navigation.spec.ts`, `mobile.spec.ts`), bestehende E2E-Tests auf die neue Navigation umgestellt
- `docs/design.md`, `docs/spec.md`, `docs/datenschutz.md` („Zuletzt besucht“ als Nutzungsspur), `docs/security/asvs-l2.md`, `docs/a11y-wcag22.md` und Handbuch angepasst

## [0.71.0] – 2026-11-20

### IT-Bestand

- **Info-Fenster an den Plätzen im Grundriss:** Maus darüber oder Tastaturfokus zeigt Nummer, Raum, Typ, die Stellen mit Person und die Hardware am Arbeitsplatz und an seinen Stellen (höchstens 6, Rest als „und n weitere“); Klick öffnet den Arbeitsplatz. Bei Berührung öffnet das erste Antippen das Info-Fenster, das zweite den Arbeitsplatz. Treffer mindestens 24 px, Text auch für Screenreader
- Die Plätze erscheinen jetzt auch bei „Standorte“ (nicht im Bearbeiten-Modus)
- `GET /floors/{id}` liefert je Platz zusätzlich `shared`, `positions`, `hardware` und `hardware_more`
- Spec, Datenschutz und Handbuch angepasst

## [0.70.0] – 2026-11-20

### IT-Bestand

- **Ort sichtbar:** Unter dem Titel von Stelle, Arbeitsplatz und Gerät steht eine Ortszeile (Raum · Etage · Abschnitt · Standort · Stadt) mit Link zu „Standorte“. Der Reiter „Standort“ zeigt den Grundriss mit hervorgehobenen Räumen und den Plätzen der Arbeitsplätze; neu auch bei der Stelle (alle Räume ihrer Arbeitsplätze, Wahl der Etage). Geräte ohne eigenen Raum zeigen den Ort über ihren Arbeitsplatz oder ihre Stelle. API `GET /api/inventory/whereabouts/{art}/{id}`
- **Platz im Raum:** Bearbeiter setzen den Platz eines Arbeitsplatzes per Klick in den Grundriss oder per Zahlen (Prozent im Raum); `PUT /api/inventory/workplaces/{id}/spot`, Eintrag im Verlauf und im Audit-Log. Beim Raumwechsel entfällt der Platz. Die Etage liefert die Plätze mit (`workplaces`). Migration 0050
- **Arbeitsplätze ohne Bezeichnung:** Das Feld entfällt; Arbeitsplätze heißen nach ihrer Nummer, in Listen mit Raum (z. B. „AP-012 · Raum 2.14“). Vorhandene Bezeichnungen bleiben in der Datenbank, werden aber nicht mehr angezeigt

## [0.69.0] – 2026-11-20

IT-Bestand, Schritt 8: Statistik.

### IT-Bestand

- **Statistik** (`/bestand/statistik`): Geräte je Art, je Modell, nach Alter, je Standort, wo die Geräte sind, Betriebssystem, Verleih (offen, überfällig, neue Verleihe je Monat) und Ausmusterungen je Jahr mit Gründen. Filter nach Hersteller; je Auswertung Umschalter Balken/Kreis und Tabelle mit Anteil. Gezählt werden aktive Geräte, ausgemusterte nur bei den Ausmusterungen. API `GET /api/inventory/statistics?maker=`
- **Anschaffungsdatum** am Gerät (Anlegen, Bearbeiten, Übersicht, Verlauf); Grundlage für das Alter, bei Monitoren ersatzweise das Baujahr aus dem Custom Field. Migration 0049
- Diagrammfarben 4 bis 8 und „Andere“ als CSS-Variablen (Farbfolge der Diagramme, hell und dunkel)
- Neuer Menüpunkt „Statistik“ im IT-Bestand

### Behoben

- Die Suchfelder über den Listen „Vorgänge“ und „Verleih“ und im Standortbaum sehen jetzt aus wie die übrigen Eingabefelder (Höhe 44 px, Rand, Abstand innen)

## [0.68.0] – 2026-11-20

IT-Bestand, Schritt 7: Abgleich mit Entra.

### IT-Bestand

- Auftrag `bestand.entra` jede Stunde: prüft die Personen an Stellen und in offenen Verleihen über `GET /users/{id}`. Ist Entra nicht erreichbar oder nicht eingerichtet, ändert der Lauf nichts
- Name und Anmeldename (beim Verleih auch die Mailadresse) werden aus Entra nachgezogen, mit Eintrag im Verlauf der Stelle bzw. der verliehenen Geräte
- Neuer Vorgang **„Person nicht mehr aktiv“**, wenn ein Konto deaktiviert oder gelöscht ist: je Stelle und je offenem Verleih, einmal je Zeitraum der Inaktivität. Entscheidungen bei Stellen: Stelle frei machen, neue Person eintragen (der Server liest sie aus Entra), erst mal so lassen; beim Verleih: geklärt. Schließt sich selbst, wenn das Konto wieder aktiv ist oder der Verleih vollständig zurück ist
- Migration 0048 (`inventory_person_states`); Spec, Datenschutz, ASVS, Entra-Einrichtung und Handbuch angepasst

## [0.67.1] – 2026-11-20

### Behoben

- **Personensuche im IT-Bestand** (Stelle besetzen, neuer Verleih): meldete „Die Anmeldedaten für Entra sind nicht lesbar“, weil das Zertifikat der Collector-App nur im Container `worker` eingebunden war, die Suche aber im Container `web` läuft. `deploy/docker-compose.yml` bindet `collector_client_key.pem` und `collector_client_cert.pem` jetzt auch in `web` ein; `deploy/README.md` angepasst. **Beim Update die neue `docker-compose.yml` übernehmen.**

## [0.67.0] – 2026-11-20

### IT-Bestand

- **Vorgänge und Verleih:** Sofortsuche über der Liste (auf dem Server, kurze Verzögerung beim Tippen). Vorgänge werden in Nummer, Titel und Angaben durchsucht, Verleihe in Nummer, Person und den Geräten (Name, Seriennummer, Inventurnummer)
- Beide Listen laden seitenweise (50 Einträge) mit „x von y“ und „Mehr anzeigen“; die API hat dafür `q`, `offset`, `limit` (höchstens 200) und liefert `total`. Nach einer Änderung lädt die Liste so viele Einträge neu, wie zu sehen waren

## [0.66.0] – 2026-11-20

IT-Bestand, Schritt 6: Verleih.

### IT-Bestand

- **Verleih** (`/bestand/verleih`): Geräte an eine Person aus Entra verleihen, mit Rückgabedatum (höchstens ein Jahr) und optionaler Notiz. Ein Verleih hat eine Nummer aus dem neuen Nummernkreis „Verleih“ (Vorgabe `L-`) und kann mehrere Geräte umfassen. Verleihbar sind aktive Geräte ohne Stelle und Arbeitsplatz, die nicht schon verliehen sind (Datenbank-Index: ein Gerät höchstens einmal offen). Liste mit Ausgeliehen, Überfällig, Zurück und Alle
- Rückgabe einzeln oder vollständig; je Rückgabe ein Vorgang „Rückgabe prüfen“ (Entscheidungen: geprüft und zurück ins Lager mit optionalem Raum, defekt oder unvollständig). Rückgabedatum beim Verleih änderbar
- **Nachrichten an die Person** per Mail und Teams (über den vorhandenen SMTP-Server und Teams-Workflow): bei Ausgabe, zwei Tage vor dem Rückgabedatum, bei Überfälligkeit am Tag danach und dann wöchentlich, bei vollständiger Rückgabe. Inhalt nur Verleihnummer und Datum. Auftrag `bestand.verleih` alle 15 Minuten; bis zu fünf Versuche, nach drei Tagen verfallen; Stand je Nachricht beim Verleih sichtbar
- Die Mailadresse liest der Server über die Objekt-ID selbst aus Entra (`GET /users/{id}`); deaktivierte Konten werden abgelehnt. Die Personensuche liefert dafür zusätzlich `mail`
- Vorgang **„Verleih überfällig“** am Tag nach dem Rückgabedatum (Entscheidungen: verlängern, geklärt); schließt sich, wenn alles zurück ist. Nach „geklärt“ kommt erst nach einem neuen Rückgabedatum wieder einer
- **Gerät:** Hinweis „Verliehen an …“ mit Link; verliehene Geräte lassen sich nicht einer Stelle oder einem Arbeitsplatz zuordnen und nicht ausmustern
- Neues Icon „Verleih“; Migration 0047, Spec, Datenschutz, ASVS und Handbuch angepasst

## [0.65.0] – 2026-11-20

IT-Bestand, Schritt 5: Monitore aus dem Custom Field in NinjaOne und technische Daten aus Lenovo PSREF.

### IT-Bestand

- **Monitore aus NinjaOne:** Ist in der Verwaltung der interne Name des Custom Fields eingetragen, liest der Abgleich es für alle Geräte über `/v2/queries/custom-fields` (seitenweise). Eine Zeile je Monitor, Felder mit `|` getrennt (Hersteller-Kennung aus EDID, Modell, Seriennummer, ProductCode, Baujahr-KW, Anschluss, zuletzt gesehen); Kopfzeile und Zeilen ohne Seriennummer fallen weg, bekannte Hersteller-Kennungen (LEN, DEL, HWP, SAM …) werden zu Namen
- Erkannt wird ein Monitor an der Seriennummer. Neu an einem **PC mit Arbeitsplatz**: direkt an diesen Arbeitsplatz. Neu an einem **Notebook** oder PC ohne Arbeitsplatz: Vorgang „Neuer Monitor“ mit vorgeschlagenem Arbeitsplatz (der des Rechners oder der erste seiner Stelle); Entscheidungen: am Arbeitsplatz anlegen, der Stelle zuordnen, nicht übernehmen (wird nicht wieder gemeldet)
- Hängt ein bekannter Monitor an einem anderen Rechner, ändert sich nur „Angeschlossen an“ mit Eintrag im Verlauf; Arbeitsplatz oder Stelle bleiben
- **Technik:** beim Monitor „Angeschlossen an“ mit Link und die Werte aus dem Custom Field; beim Rechner die angeschlossenen Monitore
- „Verbindung prüfen“ zählt auch die Monitore im Custom Field
- **Lenovo PSREF** (in der Verwaltung bei NinjaOne einschaltbar, Vorgabe aus): Auftrag `bestand.psref` einmal am Tag für Lenovo-Modelle, die im Bestand vorkommen. Rechner über den Maschinentyp als Modellname (z. B. `10T7004BGE`, `/api/model/Info/SpecData`), Monitore über den Produktschlüssel aus dem Modellnamen (`/api/product/Compare/LoadSpecData`, Schreibweisen `ThinkVision_<Modell>_Monitor` und `ThinkVision_<Modell>`). Gespeichert je Modell: Name, Link, Merkmale, Status, Zeitpunkt; erneut nach 30 Tagen (gefunden) oder 7 Tagen (nicht gefunden, Fehler), höchstens 40 Modelle je Lauf mit Pause dazwischen. Gesendet wird nur die Modellbezeichnung
- **Technik:** Abschnitt „Lenovo PSREF“ mit Link, Kamera, Mikrofon und Lautsprecher (soweit genannt), Eckdaten und allen Merkmalen zum Aufklappen; Bearbeiter können mit „Bei PSREF abrufen“ sofort neu abfragen (`POST /api/inventory/hardware/{id}/psref`)
- Die PSREF-Schnittstellen sind nicht offiziell dokumentiert; ändert Lenovo sie, steht beim Modell „Abruf fehlgeschlagen“ oder „nicht gefunden“, der Bestand bleibt unberührt
- Migrationen 0045 und 0046, Spec, Datenschutz, ASVS und Handbuch angepasst

## [0.64.0] – 2026-11-20

IT-Bestand, Schritt 4: Abgleich mit NinjaOne und Vorgänge.

### IT-Bestand

- **Abgleich mit NinjaOne** alle 30 Minuten (Auftrag `bestand.ninjaone`): Anmeldung als API-App mit Client-ID und Secret (OAuth 2.0 Client Credentials, Scope „monitoring“), gelesen werden nur Arbeitsplatzrechner (Windows, macOS, Linux) über `/v2/devices-detailed` und `/v2/policies`. Erkennung erst über die NinjaOne-ID, dann über die Seriennummer; der Hostname ist nur ein Hinweis. Hostname, Kenndaten (Betriebssystem, IP-Adressen, Arbeitsspeicher, Richtlinie, zuletzt online) werden übernommen und stehen im Verlauf. Liefert NinjaOne keine Geräte, obwohl welche verknüpft sind, bricht der Lauf ohne Änderungen ab
- **Vorgänge** (`/bestand/vorgaenge`): Eingang für neue Geräte aus NinjaOne und Geräte, die dort fehlen; Nummer aus dem Nummernkreis (Vorgabe `V-`), Status neu, in Bearbeitung, fertig; „Ich übernehme“, Notizen, Verlauf. Entscheidungen für neue Geräte: Stelle, Arbeitsplatz, Lager (mit Raum), „Ist dasselbe Gerät“ (vorhandenes Gerät übernimmt den Eintrag), nicht aufnehmen (wird nicht wieder gemeldet). Für fehlende Geräte: ausgemustert (erst nach dem Ausmustern), verloren oder gestohlen, prüfen; taucht ein Gerät wieder auf, schließt sich der Vorgang
- Neue Geräte aus NinjaOne bekommen Art (Notebook oder PC nach Bauform), Hersteller und Modell; fehlen Hersteller oder Modell in den Stammdaten, legt die Werkbank sie an
- **Gerät:** neuer Reiter „Technik“ mit den Kenndaten aus NinjaOne; Hostname und Seriennummer verknüpfter Geräte lassen sich nicht von Hand ändern
- **Verwaltung › Verbindungen:** NinjaOne mit Region, Client-ID und Secret (verschlüsselt gespeichert), „Verbindung prüfen“; Stand und „Jetzt abgleichen“ auf der Seite Vorgänge
- **Auswahl nach Organisation und Geräterolle** (je mehrfach, leer heißt alle): Listen aus NinjaOne (`/v2/organizations`, `/v2/roles`, nur Rollen für Arbeitsplatzrechner) über `POST /api/admin/settings/ninjaone/options`. Die Auswahl legt fest, welche neuen Geräte einen Vorgang bekommen; verknüpfte Geräte gleicht die Werkbank weiter ab, damit eine geänderte Auswahl keine Vorgänge „fehlt“ auslöst. Organisation und Geräterolle stehen im Reiter „Technik“
- **Standorte:** gleichmäßigere Abstände im Baum, in der Raumliste und in den Formularen; Namen im Baum brechen nur noch an Leerzeichen um, die Anzahl rutscht bei Platzmangel in die nächste Zeile
- **Benachrichtigungen:** neuer Vorgang (Bearbeiter des IT-Bestands) und fehlgeschlagener Abgleich, nur mit Nummer und Link
- Migration 0044, Spec, Datenschutz, ASVS und Handbuch angepasst

## [0.63.0] – 2026-11-20

IT-Bestand, Schritt 3: Stellen, Arbeitsplätze und Ausstattungsvorlagen.

### IT-Bestand

- **Stellen:** neue Seiten `/bestand/stellen` (Liste mit Suche) und je Stelle mit den Reitern Übersicht, Arbeitsplätze, Hardware und Verlauf; Nummer aus dem Nummernkreis, Abteilung, Besetzung durch eine Person aus Entra (Suche über Microsoft Graph mit `User.Read.All`, nur für `Bestand.Editor`); Löschen nur ohne Hardware
- **Arbeitsplätze:** neue Seiten `/bestand/arbeitsplaetze` (Liste mit Filtern einzeln, geteilt, frei, Ausstattung fehlt) und je Arbeitsplatz mit den Reitern Übersicht, Ausstattung, Hardware, Standort und Verlauf; Einzelarbeitsplatz höchstens eine Stelle, geteilter mehrere
- **Ausstattungsvorlagen** in den Stammdaten: Zeilen mit passenden Hardware-Arten und Anzahl; am Arbeitsplatz zeigt die Werkbank, was fehlt (Hardware am Platz und an seinen Stellen, jedes Gerät zählt einmal)
- **Stammdaten:** neu Abteilungen, Ausstattung Arbeitsplatz und Nummernkreise (Präfix je Kreis, Vorgabe `ST-` und `AP-`)
- **Gerät:** „Zugeordnet zu“ Stelle oder Arbeitsplatz (höchstens eins), mit Link in der Übersicht und im Verlauf; die Liste findet Geräte auch darüber
- **Suche** der Werkbank findet Stellen und Arbeitsplätze
- **Verlauf** je Stelle und Arbeitsplatz; Audit-Log ohne Namen von Personen
- Räume mit Arbeitsplätzen und Hardware-Arten in einer Vorlage lassen sich nicht löschen
- Migration 0043, Spec, Entra-Einrichtung, Datenschutz, ASVS und Handbuch angepasst

## [0.62.0] – 2026-11-20

IT-Bestand, Schritt 2: Standorte mit Grundrissen und Räumen.

### IT-Bestand

- **Standorte:** neue Seite `/bestand/standorte` mit Baum Stadt › Standort › Gebäudeabschnitt › Etage (zugeklappt, offen ist der Weg zur gewählten Etage), Suche über alle Ebenen und Räume, Raumliste neben dem Grundriss; auf schmalen Bildschirmen „Etage wechseln“ statt des Baums
- **Grundriss** je Etage als PNG, JPEG oder WebP (Prüfung am Inhalt, 50 bis 12 000 Pixel je Seite, höchstens `INVENTORY_PLAN_MAX_MB`, Vorgabe 10 MB), gespeichert in der Datenbank; Auslieferung mit `Cache-Control: no-store`, `nosniff` und `Content-Security-Policy: default-src 'none'; sandbox`
- **Räume** als Rechtecke auf dem Grundriss: aufziehen, verschieben, Größe ändern; ohne Maus über Zahlenfelder (Lage in Prozent). Lage wird serverseitig geprüft
- **Pflege der Struktur** für `Bestand.Editor`: anlegen, umbenennen, löschen (nur, was leer ist; Räume nur ohne Hardware)
- **Gerät:** Raum zuordnen (beim Erfassen und Bearbeiten), Angabe „Standort“ in der Übersicht, neuer Reiter „Standort“ mit hervorgehobenem Raum, Spalte „Standort“ in der Liste und in der Suche; Raumwechsel steht im Verlauf
- **Suche** der Werkbank findet auch Räume
- Migration 0042, Spec, Datenschutz, ASVS und Handbuch angepasst

## [0.61.0] – 2026-11-20

Neuer Bereich IT-Bestand, Schritt 1: Hardware von Hand, Inventurnummer, Ausmustern, Stammdaten.

### IT-Bestand

- **Rollen** `Bestand.Reader` (ansehen) und `Bestand.Editor` (pflegen); neuer Bereich „IT-Bestand“ in der Navigation mit „Hardware“ und „Stammdaten“
- **Hardware:** Liste mit Status-Filter (im Bestand, ausgemustert, alle), Suche über Bezeichnung, Art, Modell, Seriennummer, Inventurnummer und Hostname, Filter nach Art; Gerät mit Reitern Übersicht und Verlauf
- **Erfassen und Bearbeiten** von Hand; Seriennummer (ohne Groß-/Kleinschreibung) und Inventurnummer sind eindeutig, bei einer Doppelung nennt die Antwort das andere Gerät
- **Inventurnummer** mit eigenem Endpunkt (`PUT /api/inventory/hardware/{id}/inventory-no`) und Rückfrage in der Oberfläche, auch beim Anlegen
- **Ausmustern** statt Löschen: Grund aus den Stammdaten, Verbleib (entsorgt, verkauft oder abgegeben, an Leasing zurück, beim Hersteller), Datum (höchstens ein Tag in der Zukunft wegen Zeitzone), Notiz; bei Arten mit Datenträger ist die Bestätigung „gelöscht oder vernichtet“ Pflicht. „Wieder in Betrieb nehmen“ macht es rückgängig
- **Verlauf** je Gerät; Texte erzeugt die Werkbank selbst, Darstellung nur als Text
- **Stammdaten:** Hardware-Arten mit Merkmal „hat Datenträger“, Hersteller mit Modellen, Gründe fürs Ausmustern; Startwerte über die Migration; verwendete Einträge lassen sich nicht löschen
- **Suche** der Werkbank liefert Geräte (LIKE-Platzhalter werden als Text behandelt)
- **Audit-Log** für alle Änderungen (Modul `bestand`), ohne Personendaten
- **Tabellen als Karten:** neue gemeinsame Klasse `table-cards` mit `data-label` je Zelle; unter 760 px Breite des Bereichs werden Zeilen zu Karten
- Migration 0041, Spec, Entra-Einrichtung, Datenschutz, ASVS und Handbuch angepasst

## [0.60.0] – 2026-11-18

Abstände im Menü einstellbar.

### Werkbank

- **Konto › Darstellung › Abstände im Menü:** Kompakt, Normal oder Weiträumig. Ändert die Höhe der Einträge (34, 44 oder 52 px), die Luft zwischen Einträgen und zwischen Gruppen; wirkt zusammen mit der Schriftgröße. Bei Bedienung mit dem Finger bleiben Einträge auch kompakt mindestens 44 px hoch. Gespeichert je Browser, beim Laden ohne Springen gesetzt
- Spec und Handbuch angepasst

## [0.59.1] – 2026-11-18

KI-Texte mit Anthropic: Verbindungstest schlug fehl.

### Werkbank

- **Anthropic:** Neuere Modelle lassen das Mitdenken nicht abschalten (400: „thinking.type.disabled is not supported for this model“). Die Werkbank schickt jetzt adaptives Mitdenken mit geringem Aufwand (`thinking: adaptive`, `output_config.effort: low`) und erlaubt 4.000 Tokens, damit Denken und der kurze Text Platz haben; der Text bleibt auf 1.500 Zeichen begrenzt
- Spec und Hinweis in der Verwaltung angepasst

## [0.59.0] – 2026-11-18

KI-Texte: Anthropic direkt anbinden.

### Werkbank

- **KI-Texte, Art der Schnittstelle:** neben „OpenAI-kompatibel“ jetzt „Anthropic (Claude)“ über die eigene Schnittstelle von Anthropic (`/messages`, Kopfzeilen `x-api-key` und `anthropic-version`). Mitdenken ist ausgeschaltet und `temperature` wird nicht geschickt; über die Kompatibilitätsschicht lehnten Claude-5-Modelle die Anfrage mit 400 ab. Bei Wahl von Anthropic und leerer Adresse setzt die Oberfläche `https://api.anthropic.com/v1`
- Bestehende Einstellungen bleiben OpenAI-kompatibel
- **Fehlermeldung des Anbieters:** Verbindungstest und Auftrag nennen sie jetzt mit (gekürzt auf 200 Zeichen, einzeilig, nie der Schlüssel)
- Spec und Handbuch angepasst

## [0.58.0] – 2026-11-18

Schriftgröße im Menü einstellbar.

### Werkbank

- **Konto › Darstellung › Schriftgröße im Menü:** Klein, Normal, Groß oder Sehr groß (90, 100, 115 oder 130 %). Gilt für die Navigation links und das aufgeklappte Menü auf dem Handy, nicht für die Seiten; Symbole und Menübreite wachsen mit, Einträge bleiben mindestens 44 px hoch. Gespeichert je Browser wie die Darstellung, beim Laden ohne Springen gesetzt (`public/theme.js`), andere Tabs übernehmen die Auswahl
- Auf der Kontoseite stehen die Überschriften beider Auswahlen jetzt sichtbar
- Handbuch angepasst

## [0.57.1] – 2026-11-18

Microsoft 365: Abruf der Nutzung schlug fehl.

### Microsoft 365

- **Nutzung:** Microsoft liefert die Berichte je nach Tenant von einem regionalen Host statt von `reports.office.com`; die Werkbank lehnte diese Adresse ab („Unerwartete Download-Adresse des Berichts“). Erlaubt sind jetzt alle Hosts `reports*.office.com` (auch mit Unterdomänen), weiterhin nur HTTPS, ohne eigenen Port und ohne Token
- Die Fehlermeldung nennt den abgelehnten Host (nie den Pfad mit dem Download-Schlüssel)
- Doku: Spec, Entra-Einrichtung, Inbetriebnahme, Datenschutz

## [0.57.0] – 2026-11-18

Diagramme: kleine Änderungen werden sichtbar.

### Werkbank

- **Liniendiagramme** (Lizenzen, Benutzer, Nutzung, DNS-Abgleich): Jede Reihe steht in einem eigenen Feld mit eigener Achse, eng um ihre Werte statt einer gemeinsamen Achse ab dem kleinsten Wert aller Reihen. Vorher verschwanden kleine Änderungen (wenige Stück bei Hunderten) als gerade Linie, besonders neben einer Reihe mit ganz anderer Größe. Mindestens vier Einheiten Bereich, damit eine Änderung um 1 nicht das ganze Feld füllt; bei positiven Werten nie unter null
- Spec und Handbuch angepasst

## [0.56.0] – 2026-11-17

Microsoft 365: Nutzung der Dienste.

### Microsoft 365

- **Nutzung (neue Seite unter Tenant):** aktive und inaktive Benutzer je Dienst (Exchange, OneDrive, SharePoint, Teams, Viva Engage) für 7, 30, 90 oder 180 Tage, Verlauf der aktiven Benutzer je Tag und Dienst (auch als Tabelle); Rolle `Tenant.Reader`
- Abruf über die Collector-App alle 12 Stunden (`TENANT_USAGE_ENABLED`, Berechtigung `Reports.Read.All`): nur die Berichte mit Summen (`getOffice365ServicesUserCounts`, `getOffice365ActiveUserCounts`), nie Berichte je Person; Download von `reports.office.com` ohne Token, andere Adressen werden abgelehnt; Tageswerte bleiben drei Jahre
- API: `GET /api/tenant/usage?days=7|30|90|180`
- Migration 0040: Tabellen `tenant_usage_periods` und `tenant_usage_days`

### Doku

- Spec 4 und 7a, Seitenübersicht; Entra-Einrichtung 4.1 (`Reports.Read.All`), Inbetriebnahme (ausgehend `reports.office.com`), Datenschutz, `.env.example`, Handbuch (Nutzung, Rollen)

## [0.55.0] – 2026-11-17

Microsoft 365: Snapshots vergleichen und exportieren; Rolle Werkbank.Auditor entfällt.

### Microsoft 365

- **Snapshots vergleichen:** zwei Abrufe wählen (Vorgabe: vorletzter und letzter), Liste aller neuen, geänderten und entfernten Einstellungen mit Wert vorher und nachher; der ältere Abruf ist immer „vorher“, fehlgeschlagene Abrufe sind nicht wählbar; höchstens 2.000 Zeilen, der Rest steht im Export
- **Snapshots exportieren:** Stand eines Abrufs als JSON oder CSV (Semikolon, UTF-8 mit BOM, Schutz vor Formel-Injektion); Download ohne Cache, jeder Export im Audit-Log (`snapshot.export`)
- API: `GET /api/m365-config/snapshots/compare?from=&to=`, `GET /api/m365-config/snapshots/{id}/export.json`, `GET …/export.csv` (Config.Reader oder Config.Reviewer)

### Werkbank

- **Rolle `Werkbank.Auditor` entfällt:** Audit-Log und Rollenübersicht sehen nur noch Admins; wer die Rolle in Entra noch hat, verliert den Zugriff aufs Audit-Log

### Doku

- Spec: offene Punkte bereinigt (MFA und Datenschutz regelt der Betreiber außerhalb der Werkbank), Snapshots, Stand der Umsetzung; Entra-Einrichtung und ASVS ohne Auditor-Rolle; Handbuch (Snapshots, Rollen)

## [0.54.0] – 2026-11-17

Push aufs Handy.

### Werkbank

- **Push:** Die Verwaltung schaltet Push unter Verwaltung › Mail & Teams ein; dabei entsteht ein VAPID-Schlüsselpaar, der private Teil liegt verschlüsselt in der Datenbank
- Konto: „Push auf diesem Gerät einschalten“ (Erlaubnis des Browsers), Liste der Geräte mit Entfernen, Testnachricht; je Art die neue Spalte „Push“ (Vorgabe: aus); auf iPhone/iPad Hinweis, dass Push nur in der App vom Home-Bildschirm geht
- Versand alle 2 Minuten als Sammelnachricht je Person an alle ihre Geräte: Name, Bereich und Anzahl, nie fachliche Inhalte; Tippen öffnet „Benachrichtigungen“; verschlüsselt nach RFC 8291 und signiert nach RFC 8292, ohne Zusatzpaket; nur an bekannte Push-Dienste, abgelaufene Abos werden gelöscht
- API: `GET /api/notifications/push`, `POST …/push/subscriptions`, `POST …/push/subscriptions/remove`, `DELETE …/push/subscriptions/{id}`, `POST …/push/test`, `PUT /api/admin/settings/push`; Einstellungen je Art mit `push`
- Migration 0039: Tabelle `push_subscriptions`, Spalte `notifications.pushed_at`

### Doku

- Spec 6.7 und 11, Datenschutz, Betrieb (ausgehende Verbindungen), Handbuch (Konto, Verwaltung, Hilfe)

## [0.53.0] – 2026-11-17

Microsoft 365: Intune in der Konfiguration.

### Microsoft 365

- **Intune:** Anleitung und Auswahl der Typen für UTCM (`COLLECTOR_RESOURCES`) in fünf Gruppen: Compliance, Konfigurationsprofile, Endpunktsicherheit, App-Schutz und App-Konfiguration, Registrierung (inkl. Autopilot); verständliche Namen dieser Bereiche im Baum

### Doku

- Einrichtung (`docs/entra-setup.md` 4.6 Intune, Grenzen jetzt 4.7), `.env.example`, Spec 7.1, Datenschutz

## [0.52.0] – 2026-11-17

Microsoft 365: Teams und SharePoint in der Konfiguration.

### Microsoft 365

- **SharePoint und OneDrive:** Der Abruf liest mit `COLLECTOR_SHAREPOINT_ENABLED=true` zusätzlich die Mandanteneinstellungen über Microsoft Graph (`/admin/sharepoint/settings`, Berechtigung `SharePointTenantSettings.Read.All`); Quelle `graph:sharepoint`, ein Objekt „SharePoint und OneDrive“ unter SharePoint › Mandanteneinstellungen; zählt nicht gegen das Kontingent von UTCM; schlägt es fehl, ist der Abruf teilweise erfolgreich und nichts gilt als entfernt
- **Teams:** Anleitung und Auswahl der organisationsweiten Richtlinien für UTCM (`COLLECTOR_RESOURCES`), verständliche Namen der Teams-Bereiche im Baum
- Snapshots: Die Quelle SharePoint heißt „SharePoint und OneDrive (Graph)“

### Doku

- Einrichtung (`docs/entra-setup.md` 4.4 Teams, 4.5 SharePoint und OneDrive, 4.6 Grenzen), `.env.example`, Spec 7.1, Datenschutz, Handbuch

## [0.51.0] – 2026-11-17

Dienststatus ohne doppelten Kalender.

### Microsoft 365

- Dienststatus: Der Kalender je Dienst steht nur noch im Würfel der Kachel (jetzt mit Legende); der Abschnitt unten heißt „Meldungen der letzten 90 Tage“ und enthält nur noch die Liste

### CI

- `npm audit` blockiert nur noch bei Lücken in Paketen der ausgelieferten App (`--omit=dev`); Treffer in Entwicklungs- und Testwerkzeugen erscheinen als Warnung. Anlass: eine neue Lücke in `picomatch` (nur in Vite, Vitest und ESLint) ohne korrigierte Version

### Doku

- Spec, ASVS, Handbuch (Dienststatus)

## [0.50.0] – 2026-11-17

DNS-Abgleich mit Filtern je Stand und aufgeräumtem Layout.

### IT-Monitoring

- DNS-Abgleich: Die Kacheln oben (Geprüft, In Ordnung, Abweichend, Fehlt öffentlich, Fehler bei der Abfrage, Neu) filtern per Klick die Einträge
- Filter über der Liste: Probleme, Abweichend, Fehlt öffentlich, Fehler, In Ordnung, Neu, Alle, jeweils mit Anzahl; auch über die Adresse (`?ansicht=abweichend` usw.)
- Layout: Suchfeld wie im Rest der Werkbank, je Zone eine Überschrift mit Anzahl statt einer Tabellenüberschrift in der Mitte, Werte ohne Aufzählungspunkte, abweichende Werte markiert, Spalten oben ausgerichtet

### Doku

- Spec (Seitenübersicht), Handbuch (DNS-Abgleich)

## [0.49.0] – 2026-11-17

Dienststatus übersichtlicher; Zertifikate ohne Handlungsbedarf gleich als Waben.

### Microsoft 365

- Dienststatus: Jede Kachel hat ein Würfel-Symbol, das den Kalender der letzten 90 Tage dieses Dienstes zeigt (Maus: beim Darüberfahren; Tastatur und Handy: Antippen, Escape schließt)
- Dienststatus: Meldungen gegliedert in Art, Dienst und Stand, darunter Titel, dann Kennung, Zeitraum ohne Sekunden und Dauer
- Dienststatus: Von den in den letzten 30 Tagen beendeten Meldungen stehen zuerst die fünf neuesten, „Alle anzeigen“ zeigt den Rest; eine Meldung aus einem Link bleibt sichtbar
- Zertifikate und Secrets: Ohne Handlungsbedarf öffnet die Seite mit der Wabenansicht

### Doku

- Handbuch (Dienststatus, Zertifikate und Secrets)

## [0.48.0] – 2026-11-17

Verwaltung als eigener Bereich; letzte Aktivitäten auf der Startseite.

### Werkbank

- **Verwaltung** ist ein eigener Bereich in der Navigation (nur `Werkbank.Admin`) mit den Seiten Allgemein (`/verwaltung`: Branding, Aufbewahrung des Audit-Logs, Vorlauf für Zertifikate und Secrets), Rollen (`/verwaltung/rollen`), Mail & Teams (`/verwaltung/mail-teams`), Verbindungen (`/verwaltung/verbindungen`: KI-Texte, NetBox, Abfragen ins Internet) und Audit-Log (`/audit`); nach der erneuten Anmeldung geht es zurück auf dieselbe Seite
- Der Bereich „Werkbank“ enthält nur noch Start und Suche; der leere Platzhalter „Reports“ ist entfernt
- `Werkbank.Auditor` sieht das Audit-Log nicht mehr in der Oberfläche, die Schnittstelle `/api/audit` bleibt für die Rolle lesbar
- Handy: „Abmelden“ steht unten im Menü statt in der Kopfzeile; das Logo wurde dort seit 0.46.0 zusammengedrückt und rutschte unter Glocke und Aufgaben
- Startseite: „Letzte Aktivitäten“ mit den acht neuesten Meldungen der Glocke, gelesen oder nicht; ein Klick öffnet die Seite und markiert die Meldung als gelesen

### IT-Budget

- Budgetposten: Ist im Formular schon etwas eingetragen, fragt „Tags verwalten“ vor dem Wechsel nach, statt die Eingaben stillschweigend zu verwerfen

### Doku

- Spec: Reports für die M365-Konfiguration entfallen, kein Virenscan, Domains aus der Planung genommen, Verwaltung ohne Beschränkung auf das interne Netz (Step-up genügt), Seitenübersicht und Stand der Umsetzung aktualisiert
- Handbuch: Überblick, Startseite, Verwaltung und Audit-Log

## [0.47.0] – 2026-11-17

Einstellungen und Änderungen in Microsoft 365 übersichtlicher gegliedert.

### Microsoft 365

- Einstellungen als aufklappbarer Baum Dienst › Bereich › Objekt › Eigenschaft statt einer Zeile je Eigenschaft; je Knoten Zähler für offene Änderungen und Abweichungen, je Objekt die Zahl der Eigenschaften und „entfernt“; Eigenschaften mit kurzem Wert, erst beim Aufklappen geladen; bei Suche oder „Nur Abweichungen“ sind Dienste und Bereiche offen; eine direkt geöffnete Einstellung klappt ihren Weg auf
- Änderungen nach Dienst › Bereich gegliedert (Bereich mit der neuesten Änderung zuerst), Auswahl „Dienst und Bereich“ mit Anzahl, „Alle auswählen“ je Bereich; die Zähler der Status-Filter gelten für den gewählten Dienst und Bereich
- API: `GET /api/m365-config/settings/tree`; `GET …/settings` mit `area` und `object_id`; `GET …/changes` mit `workload` und `area`, Antwort mit `groups`, Änderungen mit `area`

### Doku

- Spec (Seitenübersicht M365), Handbuch (Einstellungen, Änderungen bewerten)

## [0.46.0] – 2026-11-17

Dienststatus mit Gründen und lesbarem Kalender; Tags am Budgetposten sichtbar.

### Microsoft 365

- Dienststatus: Die Kachel richtet sich nach den offenen Meldungen (Störung, Hinweis, in Ordnung) statt nach dem Übersichtsstatus von Microsoft und nennt sie als Grund mit Sprung zur Meldung; der Status laut Microsoft steht klein dabei
- Offen ist eine Meldung, solange ihr Status nicht behoben, beendet, Fehlalarm oder ausgesetzt ist; unbekannte Status gelten nicht mehr als Einschränkung
- „Letzte 90 Tage“ als Kalender mit größeren Feldern (Wochen als Spalten, Montag oben, Monatsnamen) und darunter die Liste der Meldungen des Zeitraums mit Dauer
- API: `services[].level`, `services[].reasons`, `timeline_issues`

### IT-Budget

- Tags stehen im Formular des Budgetpostens sichtbar statt unter „Weitere Angaben“; der Budgetverwalter sieht den Weg zu Einstellungen › Tags

### Behoben

- Ausfalldauer: Gleichzeitige Störungen eines Dienstes zählen nur einmal, Fehlalarme gar nicht mehr (auch nicht in Zahlen, Kalender und Monaten); Störungen über den Jahreswechsel werden auf beide Jahre verteilt
- Microsoft 365 › Änderungen: Die Detailansicht neben der Liste lässt sich auf großen Bildschirmen bis zum Ende scrollen
- Handy: Mit offenem Menü passte „Abmelden“ oben rechts nicht ganz auf den Bildschirm; der Name in der Kopfzeile kürzt sich bei Platzmangel, das Menü macht die Seite nicht mehr breiter

### Doku

- Spec (Dienststatus), Handbuch (Dienststatus, Budgetposten)

## [0.45.0] – 2026-11-17

Import aus Excel im IT-Budget; neues Symbol der Werkbank.

### IT-Budget

- Neuer Unterbereich **Import** (`/budget/import`, nur `Budget.Manager`): je Excel-Datei ein Vorgang (Entwurf → in Arbeit → abgeschlossen), Zeilen einzeln übernehmen oder überspringen
- Lesen von .xlsx ohne Zusatzpaket (`xlsx_read.py`): erstes sichtbares Blatt, geteilte und eingebettete Texte, Zahlen, Datumsformate, gespeicherte Werte von Formeln; Grenzen für Archiv, Größe, Zeilen und Spalten; XML mit DOCTYPE/ENTITY wird abgelehnt
- Erkennung des bisherigen Aufbaus (`excel_import.py`): Geschäftsjahr aus der Überschrift, Kopfzeile, Kontospalten mit Nummer darüber, „Jährlich“, Konten mit Budget unter der Tabelle; Kostenstelle und „Projekte“ werden ignoriert; Hinweise je Zeile
- Start: Geschäftsjahr, Steuersatz als Vorgabe, Art neuer Konten; fehlende Konten und je Konto ein einmaliger Posten „Allgemein <Geschäftsjahr>“ mit dem Budget aus der Datei
- Zeile übernehmen: Partner (gleich, ähnlich ohne Rechtsform, je Firma entschieden, neu oder frei gewählt), gebuchte Rechnung mit einer Position, Netto aus Brutto, schließt den Posten nicht ab; doppelte Rechnungsnummer je Partner wird abgelehnt
- Vorschläge für die Planung: übernommene Zeilen mit „Jährlich“ als Budgetposten ab dem folgenden Geschäftsjahr
- Aufgabe auf der Startseite für offene Vorgänge; Audit-Log `budget.import_…`
- API: `GET`/`POST /api/budget/imports`, `GET`/`DELETE /api/budget/imports/{id}`, `POST …/{id}/start`, `POST …/{id}/rows/{row}/take|skip|reopen`, `POST …/{id}/plan`
- Migration 0038: Tabellen `budget_imports`, `budget_import_rows`

### Werkbank

- Neues Standard-Favicon und neue App-Icons (Werkbank von vorn mit Schraubenschlüssel und Hammer) und dasselbe Zeichen links oben in der Kopfzeile, solange kein eigenes Logo hinterlegt ist; ein eigenes Favicon oder Logo aus dem Branding hat weiter Vorrang

### Behoben

- Breite Tabellen machten die Seite auf Handy und Tablet breiter als den Bildschirm, wenn Text nur für Screenreader am rechten Rand der Tabelle stand; Tabellen halten ihn jetzt in ihrem Scrollbereich

### Doku

- Spec 7b, ASVS, Handbuch (IT-Budget › Import aus Excel)

## [0.44.0] – 2026-11-17

Neuer Bereich IT-Projekte; Rollen je Person in der Verwaltung.

### IT-Projekte

- Neuer Bereich **IT-Projekte** (`/projekte`) mit den Rollen `Projekte.Reader` (lesen) und `Projekte.Editor` (anlegen und pflegen)
- Projektliste mit Status, veranschlagt, geplant, Ist, offenen Punkten und letztem Jour Fixe; Filter nach Status, Suche
- Projekt mit den Reitern Übersicht, Budget, Jour Fixe, Aufgaben und Einstellungen (`/projekte/{id}/…`)
- Budget: veranschlagtes Budget (brutto) im Projekt; geplant und Ist aus den Budgetposten des IT-Budgets mit diesem Projekt (geplant = Prognose minus gebuchtes Ist je Geschäftsjahr der Laufzeit, Posten ohne Ende bis zum laufenden Geschäftsjahr, stillgelegte Posten planen nichts mehr); Summen je Geschäftsjahr; Hinweis bei Überschreitung
- Jour Fixe: Einträge mit Datum, Titel und Protokoll in Markdown (Überschriften, Listen, Checklisten, Zitate, fett, kursiv, Code, nur https-Links); Darstellung ohne HTML, eigener kleiner Parser ohne neue Abhängigkeit; Leiste zum Formatieren und Vorschau; bis 10 PDF-Anhänge je Eintrag mit je bis 20 MB (Prüfung auf echtes PDF, Ablage unter zufälligem Namen, Download nur als Anhang)
- Aufgaben: grobe Liste mit Text, zuständig (Freitext) und Datum, abhaken, löschen
- Einstellungen: Name, Beschreibung, Status, Laufzeit, veranschlagtes Budget mit Freigabedatum und Notiz, interne und externe Ansprechpartner als Freitext (keine Abfrage aus Entra), Links (nur https) mit Reihenfolge; Projekt löschen (Budgetposten bleiben und verlieren nur die Zuordnung)
- Suche findet Projekte nach Name und Beschreibung
- API: `GET`/`POST /api/projects`, `GET /api/projects/choices`, `GET`/`PUT`/`DELETE /api/projects/{id}`, `GET /api/projects/{id}/budget`, Aufgaben unter `/api/projects/{id}/tasks`, Jour Fixe unter `/api/projects/{id}/meetings` mit Anhängen unter `…/files`
- Neue Einstellungen `PROJECT_DOCUMENTS_DIR` (Vorgabe `/data/belege/projekte`, im vorhandenen Volume der Belege) und `PROJECT_DOCUMENT_MAX_MB` (Vorgabe 20)
- Migration 0037: Tabellen `projects`, `project_people`, `project_links`, `project_tasks`, `project_meetings`, `project_meeting_files`; Spalte `budget_items.project_id`

### IT-Budget

- Budgetposten haben das Feld **Projekt** (höchstens eins; abgeschlossene Projekte nur, wenn der Posten schon dazugehört); Filter „Projekt“ in der Liste der Budgetposten, Link zum Projekt für Personen mit Projekt-Rolle

### Verwaltung

- Rollen: neue Ansicht **Nach Person** mit allen Rollen der letzten Anmeldung je Person, Suche und Filter „Nur Personen ohne Rolle“; API `GET /api/admin/people` (nur Admin)

### Doku

- Spec, Entra-Einrichtung (neue App-Rollen), Datenschutz, ASVS, Betrieb, Handbuch

## [0.43.0] – 2026-11-16

IT-Tools je Konto: Favoriten, zuletzt genutzte Tools und Verlauf der Einstellungen.

### IT-Tools

- Favoriten gelten fürs Konto statt nur im Browser; bisherige Favoriten aus dem Browser wandern beim ersten Laden mit
- „Zuletzt genutzt“ oben in der Übersicht (die letzten sechs geöffneten Tools)
- Verlauf: Einstellungen eines Tools (nur, was in der Adresszeile steht) werden nach zwei Sekunden ohne Änderung gespeichert; auf der Seite eines Tools „Zuletzt verwendete Einstellungen“, neue Seite **Verlauf** (`/it-tools/verlauf`) nach Tagen, Löschen je Eintrag oder alles, Schalter „Verlauf speichern“; höchstens 200 Einträge und 90 Tage je Person
- API: `GET`/`PUT /api/tools/prefs`, `POST /api/tools/recent`, `GET`/`POST`/`DELETE /api/tools/history`, `DELETE /api/tools/history/{id}`
- Migration 0036: Tabellen `tool_prefs`, `tool_history`

### Kern

- Verändernde Anfragen können „leise“ sein (`{ quiet: true }`) und laden dann Aufgaben und Glocke nicht neu

### Doku

- Spec 8a, Datenschutz, ASVS, Handbuch

## [0.42.0] – 2026-11-16

Neuer Bereich IT-Monitoring mit dem DNS-Abgleich mit NetBox.

### IT-Monitoring

- Neuer Bereich **IT-Monitoring** mit der Rolle `Monitoring.Reader` (Admins sehen ihn immer)
- **DNS-Abgleich mit NetBox** (`/monitoring/dns`): Auftrag `monitoring.dns_netbox` alle 4 Stunden; prüft jeden aktiven Eintrag aus NetBox (Plugin netbox-dns) im öffentlichen DNS über einen festen Resolver (DNS über HTTPS); Status in Ordnung, abweichend, fehlt öffentlich, Fehler, inaktiv; Normalisierung wie im IT-Tool (relative Namen, IPv6, TXT, CAA, SOA ohne Seriennummer, TTL optional); ausgenommen nicht aktive Zonen, Reverse-Zonen privater Adressen, extern delegierte Subdomains
- Seite mit Kennzahlen, Verlauf der letzten 90 Tage, Ansichten Probleme / Neu seit dem letzten Lauf / Alle, Suche, Tabelle je Zone mit Link nach NetBox; „Jetzt prüfen“ für Admins
- Glocke: neue Probleme gegenüber dem vorletzten Lauf und fehlgeschlagene Läufe
- Verwaltung › Allgemein › NetBox: Adresse, API-Token (verschlüsselt), optional CA-Zertifikat (PEM), View, Resolver, TTL-Vergleich, Ein/Aus, „Verbindung prüfen“
- DNS-Antworten liest jetzt auch der Server (Wire-Format nach RFC 1035)
- Migration 0035: Tabellen `mon_dns_runs`, `mon_dns_rows`

### Doku

- Spec 8b und Screens, Entra-Einrichtung (Rolle und Gruppe), Datenschutz, ASVS, Handbuch

## [0.41.0] – 2026-11-16

Benachrichtigungen zusätzlich per Mail und Teams, einstellbar im Konto.

### Benachrichtigungen

- Mail und Teams: Auftrag `kern.benachrichtigungen_versand` alle 15 Minuten, je Person und Kanal höchstens eine Sammelnachricht mit der Zahl der neuen, ungelesenen Benachrichtigungen je Bereich und Link, ohne fachliche Inhalte; Name, Farbe und Logo (PNG, eingebettet) aus dem Branding, Anrede mit „du“
- Teams über einen Workflow in Power Automate, der die Adaptive Card als Flow-Bot in den Chat der Person stellt; Adresse in Verwaltung › Allgemein (verschlüsselt, nie ausgegeben, nur Adressen von Power Automate bzw. Logic Apps), mit Testnachricht; Anleitung `docs/teams-workflow.md`
- Konto: neue Tabelle je Art mit Glocke, Mail und Teams (Mail und Teams anfangs aus); die Einstellungen sind von der Seite „Benachrichtigungen“ ins Konto gewandert
- API: `GET`/`PUT /api/notifications/settings` mit `mail`, `teams` und `channels`; `PUT /api/admin/settings/teams`, `POST /api/admin/settings/teams/test`
- Migration 0034: Tabelle `notification_channels`, Spalten `mailed_at` und `teams_at`

### Verwaltung

- SMTP: Hinweistext angepasst; der Versand nutzt jetzt auch eine HTML-Mail mit Textteil

### Doku

- Spec 6.7 und Screens, Datenschutz (Empfänger SMTP und Power Automate), Anleitung zum Teams-Workflow, Handbuch

## [0.40.1] – 2026-11-16

Zähler in der Navigation bleiben auch in der App am Handy aktuell.

### Behoben

- Antworten unter `/api`, `/auth` und `/health` tragen `Cache-Control: no-store`; Browser und Proxys dürfen sie nicht zwischenspeichern (Profilbilder und Branding behalten ihre eigene Regel). Vorher konnte ein Zähler einen alten Stand zeigen
- Zähler und Glocke laden zusätzlich neu, wenn das Fenster den Fokus zurückbekommt oder die installierte App aus dem Hintergrund zurückkommt (`focus`, `pageshow`)

### Doku

- ASVS-Nachweis ergänzt

## [0.40.0] – 2026-11-16

Handbuch in der Werkbank.

### Handbuch

- Neue Seite **Handbuch** (`/handbuch`) mit sieben Kapiteln: Erste Schritte, Microsoft 365 (Konfiguration und Tenant), Evergreen, IT-Budget, IT-Tools, Verwaltung und Audit-Log, Fragen und Hilfe
- Kapitel und Abschnitte je Rolle; Admins sehen alles; Kapitel ohne passende Rolle gelten als nicht vorhanden
- Je Kapitel Inhaltsverzeichnis, Anleitungen in Schritten, Begriffe, Hinweise und Verweise auf die Seiten; Sprung zu Abschnitten über `#abschnitt`
- Suche im Handbuch; die Seite „Suche“ zeigt passende Abschnitte mit (im Browser gesucht)
- Erreichbar über die Navigation (unten), die Seite „Konto“ und die Suche
- Inhalte als Daten in `frontend/src/handbook/content.ts`, nur als Text dargestellt

### Doku

- Spec 6.11 und Screens ergänzt; CLAUDE.md: Regel zum Handbuch gilt ab jetzt, mit Ort der Inhalte

## [0.39.0] – 2026-11-16

Benachrichtigungen mit Glocke in der Kopfzeile. Dienststatus mit Diagrammen und Links ins Admin Center.

### Benachrichtigungen

- Glocke in der Kopfzeile mit der Zahl der ungelesenen Benachrichtigungen und den neuesten zehn zum Aufklappen (Escape und Klick außerhalb schließen); neue Seite **Benachrichtigungen** mit den letzten 100 und den Einstellungen je Person (alle Arten an, einzeln abschaltbar); Link dazu auf der Seite „Konto“
- 15 Arten aus M365-Konfiguration, Tenant (nur Störungen, nicht Hinweise), Evergreen, IT-Budget und Kern (siehe Spec 6.7); Empfänger nach Rollen der letzten Anmeldung, die API filtert zusätzlich nach den Rollen der Sitzung
- Auftrag `kern.benachrichtigungen` alle fünf Minuten; jedes Ereignis wird einmal gemeldet, beim ersten Lauf einer Art gilt der Bestand als gemeldet; Aufbewahrung 90 Tage
- API: `GET /api/notifications`, `POST /api/notifications/{id}/read`, `POST /api/notifications/read-all`, `GET`/`PUT /api/notifications/settings`
- Migration 0033: Tabellen `notifications`, `notification_marks`, `notification_kinds`, `notification_mutes`

### Microsoft 365 › Tenant

- Dienststatus: Zeitleiste der letzten 90 Tage je Dienst, Ausfalldauer je Dienst und Jahr, Störungen pro Monat über drei Jahre (wählbar je Dienst); jede Meldung mit Link ins Microsoft 365 Admin Center; ein Link aus einer Benachrichtigung öffnet die Meldung direkt

### Doku

- Spec (6.7, 7a, Screens) und Datenschutz ergänzt

## [0.38.0] – 2026-11-16

Microsoft 365: Dienststatus. Zähler in der Navigation bleiben aktuell.

### Microsoft 365 › Tenant

- Neue Seite **Dienststatus**: Ampel für Exchange Online, Microsoft Teams, SharePoint Online und Microsoft Entra, offene und in den letzten 30 Tagen beendete Störungen und Hinweise mit den Mitteilungen von Microsoft, „Ausfälle je Dienst“ je Jahr
- Abruf über die Collector-App alle 15 Minuten (`TENANT_HEALTH_ENABLED`, `TENANT_HEALTH_INTERVAL_MINUTES`, Berechtigung `ServiceHealth.Read.All`); Mitteilungen als Text ohne HTML; Aufbewahrung drei Jahre
- Migration 0032: Tabellen `tenant_service_health` und `tenant_service_issues`

### Navigation

- Die Zähler in Navigation und Kopfzeile laden die Aufgaben nach jeder Änderung, beim Zurückkehren ins Fenster und alle fünf Minuten neu; vorher blieben erledigte Aufgaben bis zum nächsten Seitenwechsel stehen

### Doku

- Spec, Einrichtung (Entra, `.env.example`) und Datenschutz ergänzt

## [0.37.0] – 2026-11-16

IT-Tools: Abfragen ins Internet über den Werkbank-Server, vier weitere Tools, Tools in der Suche.

### IT-Tools

- **DNS Lookup:** mehrere Typen und Resolver (Cloudflare, Google, Quad9) im Vergleich, zusammengefasst oder nebeneinander, Export als Text, CSV und JSON, Subdomains finden (Zertifikats-Logs über crt.sh und typische Namen)
- **DNS-/Mail-Check:** MX, SPF mit der Grenze von 10 Lookups und include-Baum, DMARC, DKIM, MTA-STS, Nameserver, DNSSEC, CAA mit Ampel und Erklärung
- **RDAP (WHOIS):** Domain, IP-Adresse oder Netz, AS-Nummer bei der zuständigen Registry; Registrar, Ablauf, Status, Nameserver, Kontakte
- **Passwort prüfen:** Stärke im Browser, auf Knopfdruck Abgleich mit Have I Been Pwned (k-Anonymität, nur fünf Zeichen des Hashs)
- Die Abfragen stellt der Server (`/api/tools/net/…`, Rolle `Tools.User`): feste Ziele, nur https, keine internen Adressen, Zeitlimit und Höchstgröße, eigenes Rate-Limit (300 je Minute, `RATE_LIMIT_TOOLS_NET_PER_MINUTE`); DNS-Abfragen gehen gebündelt (bis 20 je Anfrage)
- Abweichungen zur Toolbox: keine eigenen Resolver; abgefragte Namen stehen nicht in der Adresszeile (ein Verweis aus dem E-Mail-Header-Tool gibt die Domain mit, das Tool nimmt sie gleich wieder heraus)
- Kategorie „Zertifikate“ heißt jetzt „Zertifikate und Kennwörter“

### Verwaltung

- Unter Allgemein lassen sich die Abfragen der IT-Tools ins Internet ausschalten (Vorgabe: an, mit Audit-Eintrag)

### Suche

- Die Seite „Suche“ zeigt passende IT-Tools sofort, auch während der Server noch sucht oder wenn seine Suche fehlschlägt

### Doku

- Spec 8a und Datenschutz (Empfänger) ergänzt
- gitleaks nimmt den Test des DNS-/Mail-Checks aus: Er enthält nur öffentliche DKIM-Schlüssel

## [0.36.0] – 2026-11-16

IT-Budget: Den Vertrag gibt der Budgetposten vor, nicht die Rechnungsposition.

### IT-Budget

- Rechnungspositionen hängen nur noch am Budgetposten; die Vertragsauswahl an der Position entfällt. Angezeigt wird der Vertrag des Postens
- Ein Budgetposten hat höchstens einen Vertrag. Er lässt sich am Posten wählen und weiterhin am Vertrag zuordnen; ein Posten mit anderem Vertrag ist am Vertrag nicht wählbar (Server: 409)
- Verträge lassen sich ohne Budgetposten anlegen
- „Schließt den Budgetposten ab“ ist vorbelegt aus, wenn der Posten einen Vertrag hat
- Ein Vertrag lässt sich löschen, auch wenn Rechnungen auf seinen Posten liegen; die Posten bleiben ohne Vertrag
- Kündigungsfrist am Vertrag als Auswahl: keine oder 0 bis 12 Monate (ein älterer, längerer Wert bleibt wählbar)
- Migration 0031: Spalte `contract_id` der Rechnungspositionen entfällt (die bisherigen Einträge gehen verloren); je Posten bleibt höchstens die Zuordnung zum zuerst angelegten Vertrag, eindeutiger Schlüssel auf `budget_contract_items.item_id`

### Behoben

- Lint-Fehler in der SVG-Erkennung des Bild-Konverters (überflüssige Zuweisung)

## [0.35.0] – 2026-11-16

IT-Tools: QR-Code, Bild-Konverter und Zertifikats-Tools aus der IT-Toolbox.

### IT-Tools

- **QR-Code-Generator:** Text, Link, WLAN, Kontakt (vCard), E-Mail, Telefon und SMS; Fehlerkorrektur, Rand, Farben, Kürzel oder Logo in der Mitte; Download als SVG oder PNG
- **Bild-Konverter:** PNG, JPEG, WebP, GIF, BMP, SVG, ICO und AVIF in PNG, JPEG, WebP, AVIF, ICO, SVG oder ein Favicon-Paket; Größe ändern, Qualität, mehrere Dateien, ZIP, Einfügen aus der Zwischenablage
- **Zertifikate anzeigen und umwandeln:** Zertifikate, Ketten, CSRs, Schlüssel und PFX lesen; Kette prüfen, Schlüssel zuordnen; Export als PEM, DER, Fullchain, P7B, PFX (modern oder kompatibel), Webserver-Paket und .p15 für APC-Netzwerkkarten
- **CSR erstellen:** RSA oder ECDSA mit SANs, Schlüssel auf Wunsch verschlüsselt, passender OpenSSL-Befehl
- Neue Kategorie „Zertifikate“
- Anders als in der Toolbox stehen Inhalte des QR-Codes, das Kürzel und die Angaben des CSR nicht in der Adresszeile; die „zuletzt verwendeten Angaben“ des CSR-Tools (im Browser gespeichert) wurden nicht übernommen
- Der OpenSSL-Befehl setzt die Namen in einfache Anführungszeichen, damit die Shell beim Einfügen nichts daraus ausführt
- Vorschaubilder als `data:`-Adresse statt `blob:`, passend zur Sicherheitsrichtlinie

### Tests

- Testzertifikate neu erzeugt, mit `example.com` und Adressen aus dem Dokumentationsbereich
- Browser-Test für QR-Code, Bild-Konverter, CSR und Zertifikate

### Sicherheit

- Erkennung von SVG ohne regulären Ausdruck über Kommentare (CodeQL: mögliches exponentielles Backtracking)
- gitleaks und Trivy nehmen nur die zwei Dateien mit privaten Testschlüsseln der Zertifikats-Tools aus (`.gitleaks.toml`, `trivy-secret.yaml`), mit Begründung

## [0.34.0] – 2026-11-16

IT-Tools: fünf weitere Tools aus der IT-Toolbox.

### IT-Tools

- **Amortisation:** Amortisationsdauer statisch und mit Kalkulationszins, Kapitalwert, Rendite und Verlauf je Jahr
- **Backup-Planer:** Vollsicherung, inkrementell oder differenziell; Wochenplan mit Speicherbedarf, Sicherungsdauer und der Kette für eine Wiederherstellung
- **Netzplan:** Vorgänge mit Dauer und Vorgängern, Vorwärts- und Rückwärtsrechnung, Puffer, kritischer Pfad als Diagramm und Tabelle; Zeilen aus Excel einfügbar
- **Nutzwertanalyse:** Kriterien gewichten, Alternativen bewerten, Rangfolge mit Balken und Bewertungsmatrix
- **E-Mail-Header und Rückläufer:** Zustellweg mit Verzögerungen, SPF/DKIM/DMARC, Spamfilter, Rückläufer mit Erklärung der Fehlercodes; auch .eml- und Outlook-.msg-Dateien. Alles bleibt im Browser
- Neue Kategorie „Planung“
- Tabellen von Netzplan und Nutzwertanalyse stehen anders als in der Toolbox nicht in der Adresszeile

## [0.33.0] – 2026-11-16

IT-Budget: Budgetposten als Vorgang mit erwarteten Kosten, Laufzeit und Status; Verträge mehreren Posten zuordnen; Tag-Liste in den Einstellungen; Mehrjahresübersicht mit Excel-Export; Masken gegliedert.

### IT-Budget

- **Posten hinzufügen als Vorgang:** Konto, Bezeichnung, erwartete Kosten je Geschäftsjahr und Laufzeit (einmalig, mehrere Jahre, bis auf Weiteres). Die erwarteten Kosten sind der Plan und gelten in jedem Jahr der Laufzeit. Tags, Notiz und Stilllegen stehen unter „Weitere Angaben“
- **Entfallen:** Plan je Posten und Jahr, Freigabe des Plans (Entwurf/freigegeben), „Plan bearbeiten“, Vorschläge aus Verträgen und der Partner am Budgetposten. Der Partner steht an der Rechnung
- **Status je Posten und Geschäftsjahr:** offen, Rechnung liegt vor, abgeschlossen. Er ergibt sich aus den Rechnungspositionen; abgeschlossen ist ein Posten, sobald eine gebuchte Position mit dem neuen Kennzeichen „Schließt den Budgetposten ab“ auf ihm liegt. Das Kennzeichen ist vorbelegt, außer die Position gehört zu einem Vertrag
- **Prognose:** abgeschlossen das Ist, sonst das Höhere aus erwarteten Kosten und Ist. Statt „Frei“ zeigen Budgetposten und Übersicht die Abweichung von der Erwartung
- **Verträge mehreren Budgetposten zuordnen:** Die Zuordnung ist nur eine Verknüpfung. Verträge binden kein Budget mehr; „Durch Verträge gebunden“ entfällt in Übersicht und Budgetposten. Ins Budget gehen Vertragskosten allein über die Rechnungspositionen. Am Vertrag stehen die Zahlungen im Geschäftsjahr nur zur Information
- **Tag-Liste:** Tags pflegt der Budgetverwalter unter Einstellungen (anlegen, umbenennen, löschen); Umbenennen und Löschen wirken auf alle Posten und gespeicherten Statistiken. Am Budgetposten werden Tags aus der Liste gewählt, nicht mehr frei eingetippt
- Übersicht: Kennzahl „Offene Budgetposten“ statt „Durch Verträge gebunden“
- **Budgetposten:** Spalte Status, Filter nach Status, Laufzeit unter dem Namen
- **Rechnungsposition:** Budgetposten mit Suchfeld und nach Status im Geschäftsjahr des Rechnungsdatums gruppiert, mit erwarteten Kosten
- **Mehrjahresübersicht** (vorher Mehrjahresplanung): erwartete Kosten, Ist und Status je Posten über fünf Jahre, Ausblick oder Rückblick, nur lesend
- **Excel-Export** der Mehrjahresübersicht mit einem zweiten Blatt aller Rechnungspositionen des Zeitraums. Die Datei schreibt die Werkbank selbst, ohne neue Abhängigkeit; Texte stehen nie als Formel in den Zellen
- **Vertragsmaske** in Abschnitte gegliedert (Vertrag und Partner, Kosten, Laufzeit); AVV, Kündigung und Notiz unter „Weitere Angaben“
- Rollentexte von Budget Bearbeiter und Budgetverwalter an die tatsächlichen Rechte angepasst
- Migration 0029: Tabelle `budget_tags`, gefüllt mit allen bis dahin vergebenen Tags. Migration 0030: Tabelle `budget_contract_items`; jeder Vertrag behält seinen bisherigen Posten als Zuordnung, die Spalte `budget_contracts.item_id` entfällt
- Migration 0028: Posten mit Plan bekommen die Laufzeit vom ersten bis zum letzten geplanten Jahr und die erwarteten Kosten des ersten Jahrs; weichen Beträge ab oder fehlen Jahre, steht der bisherige Plan in der Notiz, ebenso ein bisheriger Partner. Posten ohne Plan laufen im laufenden Geschäftsjahr mit 0 Euro. Positionen ohne Vertrag schließen ab, Positionen mit Vertrag nicht. Die Tabellen `budget_plans` und `budget_years` entfallen

## [0.32.0] – 2026-11-16

IT-Budget: Rechnungen mit Positionen für mehrere Budgetposten.

### IT-Budget

- **Rechnung mit Positionen:** Eine Rechnung besteht aus Kopf (Rechnungssteller, Nummern, Datum) und einer bis 50 Positionen. Jede Position hat ihren Budgetposten, optional einen Vertrag, Netto, Steuersatz, Bezeichnung und die Kennzeichen „Projekt“ und „jährlich“. Eine Rechnung lässt sich damit auf mehrere Budgetposten verteilen und kann mehrere Steuersätze enthalten
- **Abgleich mit dem Beleg:** Wer den Rechnungsbetrag laut Beleg einträgt, sieht, wie viel noch nicht verteilt ist; gespeichert wird erst, wenn die Positionen den Betrag ergeben. Der Server prüft dasselbe
- Das Formular ist in die Abschnitte Kopf, Positionen und Summe gegliedert. Die Liste zeigt je Rechnung ihre Positionen
- Ist, Gebundenes, Statistik, Partner-Detail und die Sperren beim Löschen rechnen je Position
- Migration 0027: Jede bestehende Rechnung bekommt genau eine Position mit ihren bisherigen Angaben; Posten, Vertrag und Steuersatz stehen danach an der Position

## [0.31.0] – 2026-11-16

IT-Budget: Tags am Budgetposten und Statistik nach Tags.

### IT-Budget

- **Tags:** Jeder Budgetposten kann bis zu zehn Tags tragen. Im Formular werden schon vergebene Tags vorgeschlagen; ein vorhandener Tag behält seine Schreibweise
- **Filtern und Suchen:** Die Seite Budgetposten hat einen Suchtext (Name, Konto, Partner, Tag) und einen Filter nach Tag; ein Klick auf einen Tag in der Liste filtert ebenfalls. Die Summe zeigt dann nur die gezeigten Posten. Die Suche oben findet Budgetposten über Name, Notiz und Tag
- **Neue Seite „Statistik“:** Plan und Ist aller Budgetposten mit den gewählten Tags über fünf Geschäftsjahre, als Diagramm und Tabelle, im Rückblick oder im Ausblick. Vorgabe: einer der Tags reicht; mit einem Haken müssen alle Tags passen
- **Gespeicherte Statistiken:** IT und Budgetverwalter speichern eine Auswahl unter einem Namen und löschen sie wieder; sichtbar sind sie für alle Rollen des Budgets. Speichern und Löschen stehen im Audit-Log
- Migration 0026 (Spalte `budget_items.tags`, Tabelle `budget_statistics`)

## [0.30.1] – 2026-11-16

M365-Konfiguration: keine Schein-Änderungen bei umsortierten Listen; Fehlertext je Quelle am Snapshot; Diagramme repariert.

### M365-Konfiguration

- **Behoben:** Eine Liste einfacher Werte (Texte, Zahlen), die die Quelle nur in anderer Reihenfolge liefert, galt als Änderung. Solche Listen werden jetzt wie Mengen behandelt: sortiert gespeichert und unabhängig von der Reihenfolge verglichen. Auch gegen früher unsortiert gespeicherte Stände entsteht keine Änderung mehr. Listen mit Objekten behalten ihre Reihenfolge
- **Snapshots zeigen den Grund:** Meldet die Quelle für einen Ressourcentyp einen Fehler, steht ihr Fehlertext jetzt in der Snapshot-Liste unter „Fehler“. Für ältere Snapshots gibt es keinen Text
- **Behoben: Diagramme.** Das Balkendiagramm „Änderungen je Tag“ in der Übersicht und die Verlaufsdiagramme bei Lizenzen und Benutzern teilten sich seit 0.19.0 eine CSS-Klasse und verstellten sich gegenseitig: Die Balken standen untereinander statt nebeneinander, die Verlaufsdiagramme ragten über ihren Rahmen. Beide haben jetzt eigene Klassen
- Migration 0025 (eine neue Spalte)

## [0.30.0] – 2026-11-16

IT-Budget: PDF-Beleg an der Rechnung.

### IT-Budget

- **Beleg hochladen:** An jede Rechnung lässt sich ein PDF hängen (höchstens 15 MB), ersetzen und wieder entfernen. Alle mit Budget-Rolle können den Beleg herunterladen
- Gebuchte Rechnungen: Den Beleg ändert nur der Budgetverwalter
- Die Dateien liegen in einem eigenen Volume unter zufälligen Namen, nicht in der Datenbank. Geprüft wird der Inhalt der Datei, nicht nur die Endung
- Migration 0024 (drei neue Spalten)

### Betrieb

- **Neues Volume `belege`** in `deploy/docker-compose.yml`. Es entsteht beim nächsten Start von selbst und **gehört zusammen mit `db-data` in die Sicherung** (`deploy/README.md`)
- Einen Virenscan der hochgeladenen Dateien gibt es nicht

## [0.29.0] – 2026-11-16

IT-Budget: Planung über mehrere Jahre mit Entwurf und Freigabe.

### IT-Budget

- **Mehrjahresplanung:** neue Seite mit dem Plan aller Budgetposten für das laufende und die fünf folgenden Geschäftsjahre. Unter jedem Feld steht, was aus Verträgen zu erwarten ist; leere Felder lassen sich daraus füllen
- **Entwurf und Freigabe:** Der Plan eines Geschäftsjahrs ist „Entwurf“ oder „freigegeben“. Freigeben und die Freigabe aufheben darf der Budgetverwalter. Ein freigegebener Plan lässt sich nicht ändern
- **Die IT plant mit:** Im Entwurf tragen IT und Budgetverwalter den Plan ein. Bisher durfte das nur der Budgetverwalter
- **Vorhaben anmelden:** Beim Anlegen eines Budgetpostens lassen sich gleich der Plan für das gewählte Jahr und ein üblicher Partner eintragen. Der Partner ist beim Erfassen einer Rechnung auf diesem Posten vorausgewählt
- Die Jahreswahl reicht fünf Jahre voraus
- Ein Partner, der an einem Budgetposten hängt, lässt sich nicht löschen; beim Zusammenlegen wandert die Zuordnung mit
- Migration 0023 (eine neue Tabelle, eine neue Spalte). Vorhandene Jahre gelten als Entwurf

## [0.28.0] – 2026-11-16

IT-Budget: Rechnungen mit Prüfung, Ist und Prognose; Partner im Detail und zusammenlegen.

### IT-Budget

- **Rechnungen:** neue Seite. Erfasst werden Rechnungssteller, Rechnungsnummer, interne Nummer, Datum, Budgetposten, optional Vertrag, Netto und Steuersatz, dazu die Kennzeichen „Projekt“ und „jährlich“. Das Brutto rechnet die Werkbank; weicht die Rechnung um Cent ab, lässt sich ihr Brutto eintragen
- **Prüfen und buchen:** Die IT erfasst, der Budgetverwalter prüft und bucht. Erfasst er selbst, ist die Rechnung sofort gebucht. Nur Gebuchtes zählt zum Ist. Offene Rechnungen stehen dem Budgetverwalter als Aufgabe auf der Startseite
- **Ist und Prognose:** Übersicht und Budgetposten zeigen Ist (gebuchte Rechnungen) und Prognose (Ist plus noch gebunden). „Gebunden“ ist jetzt der Rest der Vertragskosten, der noch nicht gebucht ist. „Frei“ ist der Plan abzüglich der Prognose. Die Balken zeigen Ist und Prognose
- **Partner im Detail:** Klick auf einen Partner zeigt seine Verträge, die betroffenen Budgetposten und seine Rechnungen
- **Partner zusammenlegen:** Der Budgetverwalter kann einen doppelt angelegten Partner mit einem anderen zusammenlegen, z. B. nach einem Schreibfehler. Verträge und Rechnungen wandern zum Ziel, der andere Partner wird gelöscht
- **Löschen mit Bestätigung:** Verträge, Budgetposten, Rechnungen und Partner lassen sich löschen. Ein Vertrag nur ohne Rechnungen, ein Partner nur ohne Verträge und Rechnungen, ein Budgetposten nur ohne Verträge und Rechnungen (seine Pläne werden mitgelöscht). Sonst nennt die Werkbank, was noch dranhängt
- Migration 0022 (eine neue Tabelle)
- Noch nicht enthalten: Beleg als PDF, Auswertung über fünf Jahre, Export und Import

## [0.27.0] – 2026-11-15

IT-Budget: Oberfläche näher am Entwurf.

### IT-Budget

- **Gemeinsamer Kopf** auf allen Seiten mit Kostenstelle und laufendem Geschäftsjahr
- **Gewähltes Geschäftsjahr gilt für alle Seiten**, bis die Werkbank neu lädt
- **Formulare klappen auf:** „Konto anlegen“, „Budgetposten anlegen“, „Partner anlegen“ und „Vertrag anlegen“ stehen als Knopf über der Tabelle; das Formular erscheint erst nach dem Klick oder über „Bearbeiten“ und schließt nach dem Speichern
- **Vertragsdetail:** Klick auf einen Vertrag zeigt Vertragsdaten, Fristen und die Zuordnung zum Budget
- **Hinweis „Nur Lesezugriff“** für Personen ohne Schreibrecht
- Die Navigation des Bereichs bleibt, wie sie ist (keine Reiter)
- Nur Oberfläche: keine Änderung an Daten, API oder Rechten

## [0.26.0] – 2026-11-15

IT-Budget: Budgetposten unter den Konten, Verträge mit Netto und Steuersatz.

### IT-Budget

- **Budgetposten:** Unter jedem Konto stehen jetzt Posten (wofür das Geld gedacht ist). Geplant wird je Posten, das Konto zeigt die Summe. Neue Seite „Budgetposten“ mit Plan, gebunden, frei und Vorjahr; dort wird der Plan bearbeitet
- **Verträge laufen auf einen Budgetposten** statt direkt auf ein Konto
- **Netto und Steuersatz am Vertrag:** Erfasst wird der Nettobetrag mit Steuersatz (Standard 19 %), das Brutto rechnet die Werkbank. Fürs Budget zählt weiter das Brutto
- Die Übersicht zeigt Kennzahlen, Balken, Termine und Handlungsbedarf; die Plantabelle steht jetzt bei den Budgetposten
- **Umstellung vorhandener Daten (Migration 0021):** Jedes Konto mit Plan oder Vertrag bekommt einen Posten „Allgemein“, der beides übernimmt. Vorhandene Verträge behalten ihr Brutto; ihr Netto wird gleichgesetzt und der Steuersatz steht auf 0 %. Bitte danach Posten umbenennen und bei den Verträgen Netto und Steuersatz nachtragen

## [0.25.0] – 2026-11-15

IT-Budget: Partner, Verträge und „gebunden“; Übersicht nach dem Entwurf.

### IT-Budget

- **Partner:** Firmen als Vertragspartner, Rechnungssteller oder beides anlegen, ändern und stilllegen
- **Verträge:** mit Vertragspartner, abweichendem Rechnungssteller, Konto, Betrag und Turnus, Laufzeit, Verlängerung, Kündigungsfrist und Stand des AVV. Die Liste zeigt Jahreskosten und den nächsten Kündigungstermin
- **Gebunden:** Die erwarteten Kosten aus Verträgen zählen je Konto und Geschäftsjahr; die Übersicht zeigt Plan, gebunden und frei
- **Übersicht neu aufgebaut** nach dem Entwurf: Kennzahlen als Karten, Budget nach Konten als Balken, Kündigungstermine der nächsten 120 Tage und Handlungsbedarf (mehr gebunden als geplant, Kosten ohne Plan, AVV fehlt). Farben und Dunkelmodus bleiben die der Werkbank
- **Aufgabe auf der Startseite:** Verträge, deren Kündigungstermin in höchstens 60 Tagen ansteht
- Migration 0020 (zwei neue Tabellen)
- Noch nicht enthalten: Rechnungen mit Beleg (damit auch Ist und Prognose), Budgetposten unterhalb der Konten, Vertragsdetail mit Dokumenten, Auswertung, Export und Import

## [0.24.0] – 2026-11-15

Neuer Bereich IT-Budget: Konten und Plan je Geschäftsjahr.

### IT-Budget

- **Neuer Bereich „IT-Budget“** mit drei Rollen: `Budget.Reader` (lesen), `Budget.Editor` (zusätzlich Konten pflegen) und `Budget.Manager` (zusätzlich Plan und Einstellungen)
- **Einstellungen:** Beginn des Geschäftsjahrs (erster Tag eines Monats), Bezeichnung des Geschäftsjahrs und Kostenstelle
- **Konten:** anlegen, ändern und stilllegen, je Konto mit Art „laufende Kosten“ oder „Investition“
- **Übersicht:** Plan je Konto für ein Geschäftsjahr mit Vorjahr und den Summen für laufende Kosten, Investitionen und gesamt. Der Budgetverwalter bearbeitet den Plan direkt in der Tabelle
- Alle Beträge sind brutto. Jede Änderung steht im Audit-Log
- Migration 0019 (zwei neue Tabellen)
- Die drei Rollen müssen in Entra angelegt und zugewiesen werden (`docs/entra-setup.md` 1.6)
- Noch nicht enthalten: Partner, Verträge, Rechnungen mit Beleg, Auswertung über fünf Jahre, Export und Import

## [0.23.0] – 2026-11-15

Tenant: Zertifikate und Secrets als Waben.

### Tenant

- **Wabenansicht:** Die Seite „Zertifikate & Secrets“ hat neben der Liste eine zweite Ansicht. Jede Wabe steht für ein Zertifikat oder Secret und zeigt Anwendung, Restlaufzeit und Ablaufdatum, das Dringendste zuerst. Die Farbe folgt der Einstufung, abgelaufene Einträge haben zusätzlich einen kräftigen Rand
- Lange Namen werden an Leerzeichen oder Bindestrich auf zwei Zeilen umbrochen und sonst mit „…“ gekürzt. Der volle Name steht im Tooltip und in den Einzelheiten
- Klick oder Eingabetaste auf eine Wabe zeigt darunter Art, Bezeichnung, Ablauf, Stand und App-ID
- Die Zahl der Waben je Zeile richtet sich nach der Breite des Fensters

## [0.22.0] – 2026-11-15

Tenant: Zertifikate und Secrets mit Ablaufdatum und Aufgaben.

### Tenant

- **Zertifikate und Secrets:** Neue Seite im Bereich Microsoft 365 unter „Tenant“. Sie zeigt die Zertifikate und Secrets der App-Registrierungen und die Signaturzertifikate der Unternehmensanwendungen mit SAML, sortiert nach Ablauf, mit Restlaufzeit und Einstufung (im Blick behalten, läuft bald ab, dringend, abgelaufen). Zuerst steht der Handlungsbedarf, auf Wunsch alle Einträge
- **Aufgaben:** Ablaufende und abgelaufene Einträge stehen für Personen mit `Tenant.Reader` auf der Startseite und als Zähler in der Navigation
- **Vorlauf einstellbar:** Verwaltung › Allgemein, Standard 60, 30 und 7 Tage
- Gelesen und gespeichert werden nur Anwendung, Art, Bezeichnung und Daten, nie der geheime Wert eines Secrets
- Der Abruf ist freiwillig: `TENANT_CREDENTIALS_ENABLED=true` in der `.env`, vorher der Collector-App `Application.Read.All` geben (`docs/entra-setup.md` 4.1). Er läuft im selben Abstand wie Lizenzen und Benutzerzahlen
- Migration 0018 (eine neue Tabelle)
- Noch nicht enthalten: Benachrichtigung per Mail

## [0.21.0] – 2026-11-15

IT-Tools: AD und M365, weitere Generatoren.

### IT-Tools

- **Neue Kategorie „AD und M365“:** AD-Zeitstempel (FILETIME und Generalized Time), DN-Zerleger, ImmutableID ↔ objectGUID, LDAP-Escaper, userAccountControl
- **Weitere Generatoren:** Passphrase-Generator (deutsche Wortliste mit 7776 Wörtern, gemeinfrei), Passwort-Hash für htpasswd und /etc/shadow (erzeugen und prüfen), Prüfsummen für Text und Dateien, HMAC, Lorem ipsum
- Kennwörter, Schlüssel, Nachrichten, Dateien, Namen aus dem Verzeichnis und Kennungen von Konten bleiben im Browser und stehen nicht in der Adresszeile. Abweichung von der IT-Toolbox: Dort standen die GUID und der Benutzername für htpasswd in der Adresszeile
- Die Wortliste der Passphrasen (etwa 70 KB) liegt in der Werkbank und wird erst beim Öffnen des Tools geladen

## [0.20.0] – 2026-11-15

IT-Tools: Rechner und Cron.

### IT-Tools

- **Neue Kategorie „Rechner“:** RAID-Rechner (Kapazität, Plattenbedarf, Ausfall simulieren), Speichereinheiten (GB ↔ GiB), Speicherbedarf mit Komprimierung, Übertragungsdauer, Verfügbarkeit, Stromkosten, USV (Leistung und Laufzeit), VoIP-Bandbreite
- **Cron-Ausdruck erklären** in der Kategorie „Linux und Server“: Klartext und die nächsten zehn Ausführungen
- Die Zahlen der Rechner stehen in der Adresszeile, damit sich ein Link teilen lässt. Die Liste der Komponenten im Verfügbarkeits-Rechner und die ausgefallenen Platten im RAID-Rechner stehen dort nicht
- Abweichung von der IT-Toolbox: Im Stromkosten-Rechner fehlt der Verweis auf die Amortisationsrechnung, weil es dieses Tool in der Werkbank noch nicht gibt

### Geändert

- **Diagramme größer und besser lesbar** (Lizenzen, Benutzer): Das Diagramm wird jetzt in echten Pixeln gezeichnet und passt seine Breite dem Platz an, statt als Ganzes verkleinert zu werden. Schrift und Linien bleiben dadurch auf jedem Gerät gleich groß; dazu größere Achsenschrift, kräftigere Linien, mehr Höhe und Abstand zum Rand. Gibt es erst einen Tag, erklärt ein Hinweis, dass die Linie mit den nächsten Abrufen entsteht

## [0.19.0] – 2026-11-15

Neues Modul Tenant mit Lizenzen und Benutzerzahlen; Kategorien der IT-Tools in der Navigation; Tools in der Suche; Kopfzeile bleibt stehen.

### Tenant (neu)

- **Lizenzen:** Liste aller Lizenzen mit gekauft, zugewiesen, frei, nächstem Stichtag der Abos und Hinweisen (aufgebraucht, überbucht, Einheiten in Kulanzfrist oder gesperrt, Stichtag in höchstens 30 Tagen, Testabo). Ein Klick zeigt den Verlauf als Diagramm (30 Tage bis 3 Jahre)
- **Benutzer:** Zahl der Konten (gesamt, Mitglieder, Gäste, aktiv, deaktiviert, mit Lizenz) mit Verlauf. Gelesen und gespeichert werden nur Summen, keine Namen
- Der Stand wird täglich festgehalten und drei Jahre aufbewahrt
- Neue App-Rolle `Tenant.Reader` (in Entra anlegen und zuweisen, `docs/entra-setup.md` 1.6 und 1.8). Die Seiten stehen im Bereich Microsoft 365 unter „Tenant“
- Der Abruf ist freiwillig: `TENANT_MONITOR_ENABLED=true` in der `.env`, vorher der Collector-App `Organization.Read.All` und `User.Read.All` geben (`docs/entra-setup.md` 4.1)
- Neues Liniendiagramm als eigene Komponente (ohne fremde Bibliothek): eine Achse, feste Farbfolge für hell und dunkel, Werte per Zeiger oder Regler, immer mit Tabelle

### IT-Tools

- **Kategorien in der Navigation:** Neben „Alle Tools“ steht jede Kategorie als eigener Eintrag mit eigener Seite. Auf der Seite eines Tools ist seine Kategorie hervorgehoben
- **Suche:** Die Seite „Suche“ findet auch IT-Tools, wenn die Person die Rolle `Tools.User` hat

### Behoben

- **Kopfzeile und Navigation auf langen Seiten:** Die Kopfzeile scrollte mit dem Inhalt weg, und die Navigation endete danach oberhalb des unteren Rands. Ab Tablet-Breite bleibt die Kopfzeile jetzt stehen, die Navigation haftet darunter und füllt die Höhe. Auf dem Handy bleibt es beim bisherigen Verhalten

## [0.18.0] – 2026-11-15

IT-Tools: Konverter und Text.

### IT-Tools

- **Neue Kategorie „Konverter“:** CSV ↔ JSON, JSON ↔ YAML ↔ TOML, Zahlensysteme (mit Zweierkomplement), Unix-Zeitstempel, Zeitzonen-Umrechner
- **Neue Kategorie „Text“:** Schreibweise ändern, Listen bereinigen (auch zwei Listen vergleichen), Regex-Tester, Zeichen zählen (findet unsichtbare Zeichen), Text-Diff
- **SQL: Formatter und JOINs** in der Kategorie „Formatter“: Abfragen einrücken oder kürzen, JOINs an zwei Beispieltabellen ausprobieren, mit Mengendiagramm
- Eingegebene Texte, Listen, Tabellen und Abfragen bleiben im Browser und stehen nicht in der Adresszeile. Dort stehen Optionen, die Zahl, der Zeitstempel und der reguläre Ausdruck
- Der Zeitzonen-Umrechner merkt sich die Liste der Zeitzonen im Browser
- Abweichung von der IT-Toolbox: CSV ↔ JSON hat keinen Knopf zum Herunterladen als Datei, das Ergebnis lässt sich kopieren. Im SQL-Tool stehen die Beispieltabellen nicht in der Adresszeile

## [0.17.1] – 2026-11-15

Fertiges Image aus der GitHub-Registry statt Build auf dem Server.

### Deployment

- **Image aus der Registry:** Der Release-Workflow baut zu jedem Release das Image und veröffentlicht es als `ghcr.io/extrempro/werkbank:X.Y.Z` und `latest` (`linux/amd64`). `deploy/docker-compose.yml` verwendet dieses Image und baut nicht mehr. Ein Update ist damit `docker compose pull` und `docker compose up -d`; Verwaltungswerkzeuge erkennen neue Images. Bisher musste das Image auf dem Server gebaut werden, was manche Werkzeuge bei einem Neu-Bereitstellen nicht tun
- Feste Version über `WERKBANK_IMAGE`. Die Variablen `WERKBANK_REF`, `WERKBANK_BUILD_CONTEXT` und `WERKBANK_DOCKERFILE` entfallen
- **Umstieg:** Compose-Datei aktualisieren, Images holen, neu bereitstellen (`deploy/README.md`, Abschnitt „Image“). Daten und Secrets bleiben unberührt
- Selbst bauen (Entwicklung, CI) mit dem Zusatz `deploy/docker-compose.build.yml`
- Entfernt: `deploy/Dockerfile` und `deploy/.dockerignore` (das Dockerfile, das den Quellcode beim Bauen von GitHub holte)

## [0.17.0] – 2026-11-15

IT-Tools: Encoding und Formatter.

### IT-Tools

- **URL-Encoder:** kodieren (Parameterwert, Formular, ganze URL), dekodieren und eine URL in Bestandteile und Parameter zerlegen. Ein Kennwort in der URL wird nicht angezeigt
- **HTML-Entities:** Sonderzeichen in Entities und zurück, Umfang wählbar
- **JWT-Decoder:** Header, Claims mit Erklärung, Gültigkeit; Signatur mit Secret, öffentlichem Schlüssel (PEM) oder JWKS prüfen
- **SAML-Decoder:** SAMLRequest und SAMLResponse lesen (XML, Base64, Deflate, ganze URL), mit NameID, Attributen, Gültigkeit, Signatur und Zertifikat als PEM
- **Neue Kategorie „Formatter“:** JSON, YAML und XML prüfen und einheitlich formatieren, mit Fehlermeldung samt Zeile bei YAML und XML
- Token, Schlüssel, SAML-Nachrichten und alle eingegebenen Texte bleiben im Browser und stehen nicht in der Adresszeile

### Behoben

- **Neue Version wurde nicht bemerkt:** Ein offenes Fenster fragte nie von selbst nach einer neuen Version, weil der Browser das nur beim Laden einer Seite tut und die Werkbank ihre Seiten ohne Neuladen wechselt. Jetzt fragt sie alle 30 Minuten nach, außerdem wenn das Fenster wieder sichtbar wird oder das Netz zurückkommt (höchstens alle 5 Minuten). Der Hinweis „Neue Version verfügbar“ erscheint dann wie bisher

### Tests

- Die Tests für JWT und SAML laufen in der Node-Umgebung, weil sie Web Crypto und `DecompressionStream` brauchen

## [0.16.0] – 2026-11-15

IT-Tools: fünf weitere Netzwerk-Tools.

### IT-Tools

- **Subnetting-Bits:** geborgte Bits, neue Maske, Schrittweite, Rechenweg und die entstehenden Subnetze
- **Netze zusammenfassen:** Liste von Netzen, Adressen und Bereichen zur kleinsten CIDR-Liste (IPv4 und IPv6)
- **Firewall-Regeln prüfen:** Regelwerk mit Testpaket (First Match), findet Regeln, die nie erreicht werden
- **MAC-Adressen:** Umformatieren, Art erkennen, EUI-64 und IPv6-Link-Local, Hersteller aus der Liste der IEEE. Die Liste (rund 1,8 MB) liegt in der Werkbank und wird erst geladen, wenn eine Adresse eingegeben ist; es gibt keine Abfrage nach außen
- **Port-Nachschlagewerk:** über 150 gebräuchliche Ports, dazu Firewall-Befehle für Windows und Linux. Der Name der Regel im Befehl enthält nur harmlose Zeichen, auch wenn der Suchbegriff aus einem geteilten Link stammt
- Listen von Netzen, Regelwerke und MAC-Adressen stehen nicht in der Adresszeile; dort stehen nur Optionen

## [0.15.0] – 2026-11-15

Neuer Bereich IT-Tools (Pilot).

### IT-Tools

- **Neuer Bereich „IT-Tools“** in der Navigation, mit Übersicht, Suche und Favoriten. Sichtbar mit der neuen App-Rolle `Tools.User` (in Entra anlegen und zuweisen, `docs/entra-setup.md` 1.6 und 1.8)
- **Fünf Tools zum Start:** Subnetz-Rechner (IPv4 und IPv6, Aufteilen, Adresse prüfen, Bereich als CIDR-Blöcke), chmod-Rechner, Base64, UUID-Generator und Passwort-Generator. Rechenlogik und Tests stammen aus der eigenständigen IT-Toolbox, die Oberfläche ist im Aussehen der Werkbank neu gebaut
- Alle Tools rechnen vollständig im Browser; es gibt keine Abfragen an den Server oder an fremde Dienste
- Einstellungen eines Tools stehen in der Adresszeile, damit sich ein Link teilen lässt. Kennwörter und eingegebene Texte stehen dort nie
- Startseite: Kachel „IT-Tools“ für Personen mit der Rolle

## [0.14.0] – 2026-11-15

Exchange Online als weiterer Dienst.

### M365-Konfiguration

- **Exchange Online:** Der Abruf über UTCM verarbeitet jetzt auch Exchange-Einstellungen. Exchange-Objekte werden über ihre Kennung (`Identity`) adressiert; zwei Objekte desselben Typs teilen sich nie einen Pfad. Eingeschaltet wird Exchange je Installation: Rechte für den Dienstprinzipal von UTCM vergeben und die Typen in `COLLECTOR_RESOURCES` eintragen (`docs/entra-setup.md`, Abschnitt 4.3). Die Voreinstellung bleibt bei Entra
- **Verständliche Bereichsnamen:** In der Einstellung und im Baum steht statt des technischen Typs ein Name, z. B. „Bedingter Zugriff“ oder „Transportregeln“
- Angaben zur Anmeldung des Abrufs (z. B. `TenantId`) werden nicht mehr als Einstellung gespeichert, falls ein Snapshot sie enthält

### Aufräumen

- `.gitleaksignore` entfernt: Der dort ausgenommene Commit ist nicht Teil von `main`

## [0.13.0] – 2026-11-15

Eigene Bereiche für Microsoft 365 und Evergreen in der Navigation.

### Oberfläche

- **Bereiche in der Navigation:** Oben in der Navigation lässt sich zwischen „Werkbank“ (Start, Suche, Reports, Audit-Log, Verwaltung), „Microsoft 365“ (Übersicht, Änderungen, Einstellungen, Empfehlungen, Snapshots) und „Evergreen“ (Vorgänge, Eingang) umschalten. Die Navigation zeigt immer nur die Seiten des gewählten Bereichs; wer eine Seite direkt aufruft, landet automatisch im passenden Bereich. Weitere Tools bekommen künftig je einen eigenen Bereich
- Der Umschalter erscheint nur, wenn die Person Zugriff auf mehr als einen Bereich hat. Offene Aufgaben eines anderen Bereichs stehen als Zahl am Umschalter

## [0.12.0] – 2026-11-15

Empfehlungen aus Microsoft Secure Score.

### M365-Konfiguration

- **Neue Seite „Empfehlungen“:** Empfehlungen („Controls“) aus Microsoft Secure Score mit Stand und Punkten im Tenant, gefiltert nach offen, erfüllt und alle. Das Detail zeigt Microsofts Statustext, die Hinweise zur Umsetzung und einen Link zur Stelle im Admin-Portal. Titel und Texte kommen von Microsoft und sind auf Englisch
- **Zuordnung zu Einstellungen:** Microsoft liefert keinen Bezug zu einzelnen Einstellungen. Reviewer ordnen einer Empfehlung deshalb von Hand Einstellungen zu; die Empfehlung erscheint dann auch in der Einstellung
- **Abruf:** einmal täglich, standardmäßig aus. Einschalten mit `SECURE_SCORE_ENABLED=true`, nachdem die Collector-App die Berechtigung `SecurityEvents.Read.All` bekommen hat (`docs/entra-setup.md`)

### Behoben

- Im Baum der Einstellungen ist die gewählte Einstellung jetzt auch für Screenreader als aktuelle Seite gekennzeichnet

### Technik

- Neue Tabellen `cfg_recommendations` und `cfg_recommendation_links` (Migration 0016), neuer Auftrag `m365_config.secure_score`

## [0.11.0] – 2026-11-15

Bilder passen sich beim Hochladen an, klare Hinweise zur Anmeldung.

### Verwaltung

- **Branding: Bilder werden beim Hochladen angepasst.** Zu große Logos verkleinert die Werkbank im Browser (längste Kante höchstens 800 Pixel), Favicons setzt sie auf 256 Pixel im Quadrat, ein nicht quadratisches Bild mittig mit durchsichtigem Rand. JPEG-Dateien werden angenommen und in PNG umgewandelt. Vergrößert wird nie; die Meldung nennt die Größe vorher und nachher
- **Wahl „Größe beim Hochladen“:** „Automatisch anpassen“ (Standard) oder „Original behalten“. Im Original muss das Bild die Grenzen selbst einhalten
- **Erneute Anmeldung:** Scheitert eine Änderung in der Verwaltung, weil die Anmeldung zu alt ist, erscheint oben ein deutlicher Hinweis mit dem Knopf „Erneut anmelden“, der danach zur selben Seite zurückführt

### Oberfläche

- **Abgelaufene Sitzung:** Läuft die Sitzung ab, während die Werkbank offen ist, erscheint sofort die Anmeldeseite mit Hinweis, statt dass einzelne Seiten nur „konnte nicht geladen werden“ melden. Geprüft wird bei jeder Abfrage und wenn der Tab wieder nach vorn kommt. Nach der Anmeldung geht es auf derselben Seite weiter

### Behoben

- Beim Speichern in der Verwaltung wurde eine zu alte Anmeldung nicht als solche erkannt; es erschien nur die knappe Meldung des Servers

## [0.10.0] – 2026-11-15

KI-Texte mit frei einstellbarem Anbieter.

### Verwaltung

- **KI-Texte unter Verwaltung › Allgemein:** Adresse einer OpenAI-kompatiblen Schnittstelle, Modell, Schlüssel und Höchstzahl neuer Texte je Stunde, dazu „Verbindung testen“. Der Schlüssel liegt verschlüsselt in der Datenbank (Secret `settings_key`) und wird nie ausgegeben. Mit Schlüssel muss die Adresse mit `https://` beginnen; ohne Schlüssel ist auch ein eigener Dienst im internen Netz möglich. Standard: ausgeschaltet

### M365-Konfiguration

- **Beschreibungen per KI:** Für Einstellungen ohne eigene Beschreibung erzeugt der Worker stündlich einen kurzen Text. An den Anbieter gehen nur Dienst, Bereich und Name der Eigenschaft, nie Werte, Namen von Objekten oder andere Daten aus dem Tenant. Deshalb gilt ein Text für alle Einstellungen derselben Art
- **Kennzeichnung:** Der Text steht in der Einstellung mit „KI-generiert, ungeprüft“, im Baum mit dem Kennzeichen „KI“. Reviewer geben ihn frei („KI-generiert, geprüft“) oder verwerfen ihn; verworfene Texte werden nicht neu erzeugt. Eine von Hand gepflegte Beschreibung hat immer Vorrang
- Kennt das Modell eine Einstellung nicht, entsteht kein Text

### Technik

- Neue Tabelle `cfg_ai_texts` (Migration 0015), neuer Auftrag `m365_config.ki_texte`

## [0.9.0] – 2026-11-15

Branding in der Verwaltung, Werkbank als Zeichen.

### Verwaltung

- **Branding unter Verwaltung › Allgemein:** Name der Anwendung, eigene Akzentfarbe, Logo für hellen und für dunklen Hintergrund sowie ein eigenes Favicon. Nur für Admins kurz nach einer Anmeldung; jede Änderung steht im Audit-Log
- **Akzentfarbe mit geprüftem Kontrast:** Aus der gewählten Farbe leitet die Oberfläche die Farben für Knöpfe, Links und Hervorhebungen ab und passt sie getrennt für hell und dunkel so an, dass die Kontraste nach WCAG 2.2 AA eingehalten bleiben
- **Bilder:** nur PNG und WebP (Favicon nur PNG, quadratisch), höchstens 256 KB; geprüft wird der Inhalt der Datei. SVG wird nicht angenommen
- Name, Farbe und Bilder erscheinen auch auf der Anmeldeseite und sind deshalb ohne Anmeldung abrufbar (`GET /api/branding`)

### Oberfläche

- **Neues Zeichen:** Favicon, App-Symbole und das Zeichen in der Kopfzeile zeigen jetzt eine Werkbank

### Technik

- Neue Tabelle `branding_assets` (Migration 0014)

### Deployment

- `deploy/.dockerignore` lässt das Dockerfile ausdrücklich im Build-Kontext. Werkzeuge, die den Kontext selbst packen und sich wörtlich an die Ignore-Liste halten, schickten sonst einen leeren Kontext und scheiterten mit „dockerfile parse error on line 1“

## [0.8.0] – 2026-11-15

Einstellungen als Baum mit Detail daneben.

### Oberfläche

- **M365-Konfiguration › Einstellungen nach dem Entwurf:** links der Baum nach Workload mit Name, Eigenschaft und Kennzeichen (offen, weicht ab, BR für durch Beschluss geregelt, entfernt), rechts die gewählte Einstellung mit Wert, Beschreibung und Verlauf. Suche und Filter stehen über dem Baum. Auf schmalen Bildschirmen erscheint nur die Einstellung, mit „Zurück zu den Einstellungen“
- **Schraffierter Platzhalter** im Detailbereich, solange nichts gewählt ist: bei Einstellungen, Änderungen und Evergreen-Vorgängen (nur wo Liste und Detail nebeneinander stehen)
- API: Einstellungen liefern zusätzlich die Anzahl offener Änderungen und ob der Soll-Wert aus einem Evergreen-Vorgang stammt

## [0.7.0] – 2026-11-15

Navigation mit Symbolen, einklappbar, mit Schnellzugriffen.

### Oberfläche

- **Navigation mit Symbolen:** Jeder Menüpunkt hat ein Symbol. Die Leiste lässt sich auf breiten Bildschirmen einklappen; dann bleiben nur die Symbole sichtbar (Namen weiter für Screenreader und als Tooltip). Die Wahl gilt für den jeweiligen Browser
- **Schnellzugriffe am Fuß der Navigation:** Neuigkeiten (mit Punkt, solange die aktuelle Version noch nicht geöffnet wurde) und ein Umschalter zwischen heller und dunkler Darstellung
- **Menüpunkt „Neuigkeiten“ entfällt;** die Seite ist über den Schnellzugriff und die Seite „Konto“ erreichbar
- **Knopf „Nach oben“** unten rechts, sobald man ein Stück nach unten gescrollt hat
- Die Navigation bleibt beim Scrollen stehen

## [0.6.0] – 2026-11-15

Verwaltung: allgemeine Einstellungen mit Mailversand und Aufbewahrungsfrist.

> **Vor dem Update:** Im Secrets-Ordner auf dem Server muss die neue Datei `settings_key` liegen, sonst startet Compose nicht. Anlegen mit `openssl rand -base64 48 | sudo tee settings_key > /dev/null` und `sudo chmod 444 settings_key` (siehe `deploy/README.md`, Schritt 2a).

### Hinzugefügt

- **Verwaltung › Allgemein:** neuer Bereich für Einstellungen der Werkbank, nur für Admins kurz nach einer Anmeldung
- **Mailversand (SMTP):** Server, Port, Verschlüsselung (STARTTLS, TLS, keine), Absender, Benutzername und Passwort in der Oberfläche einstellbar; „Testmail an mich senden“. Das Passwort liegt verschlüsselt in der Datenbank (Schlüssel als Secret-Datei `settings_key`), wird nie ausgegeben und nur über eine verschlüsselte Verbindung verwendet
- **Aufbewahrung des Audit-Logs:** Einträge werden nach 90 Tagen gelöscht (einstellbar von 30 bis 3650 Tagen). Der Worker löscht stündlich und protokolliert die Bereinigung. Der Datenbank-Trigger lässt das Löschen nur für diesen Auftrag zu und nie für Einträge, die jünger als 30 Tage sind
- API: `GET /api/admin/settings`, `PUT /api/admin/settings/smtp`, `POST /api/admin/settings/smtp/test`, `PUT /api/admin/settings/audit-retention`

### Dokumentation

- Dokumentation produktneutral formuliert: Reverse Proxy und Git-Sync ohne Produktnamen, keine Angaben mehr zu einzelnen Installationen

## [0.5.0] – 2026-11-15

Suche über alle Module.

### Hinzugefügt

- **Suche:** Suchfeld in der Kopfzeile (auf schmalen Bildschirmen über „Suche“ in der Navigation) und Ergebnisseite `/suche`. Gesucht wird in Einstellungen (Pfad, Name, Beschreibung, Begründung), erkannten Änderungen (geändert von, Kommentar) und Evergreen-Vorgängen (Nummer, Titel, Dienst, Zusammenfassung)
- API: `GET /api/search?q=…`. Jedes Modul liefert nur Treffer, die die Person auch auf den Seiten des Moduls sehen darf; Vorgänge erscheinen für Betriebsrat und Geschäftsführung erst nach der Vorlage

### Geändert

- Anrede in der Oberfläche einheitlich „du“ festgelegt (`docs/design.md`, `CLAUDE.md`)

## [0.4.0] – 2026-11-15

Evergreen im neuen Aussehen.

### Oberfläche

- **Evergreen nach dem Entwurf:** Vorgänge als Karten mit Filter-Chips samt Anzahl; auf breiten Bildschirmen steht der geöffnete Vorgang neben der Liste. Im Vorgang: Kopf mit Nummer, Dienst und Quelle, Status-Kennzeichen, Hinweis zur Frist, Schrittleiste, Entscheidung in einem hervorgehobenen Bereich, Protokoll als Liste
- API: `GET /api/evergreen/items` liefert zusätzlich die Anzahl je Ansicht (nur sichtbare Vorgänge)

### Dokumentation

- Alle Dokumente auf den Stand von Version 0.3 gebracht: README (Status, Technik, Betrieb), Spezifikation (Deployment, Versionen, Screens mit Stand der Umsetzung, CI, Repository-Struktur, Phasen, offene Punkte), Designrichtlinie und `CLAUDE.md` (tatsächliche Ordner), Repository-Einrichtung (Status-Checks, Releases), Inbetriebnahme (Update, Konto, Profilbild), ASVS-Nachweis, Barrierefreiheit, Mitarbeit (lokale Entwicklung), PR-Vorlage

### Geändert

- **Deployment:** Neues `deploy/Dockerfile`, das den Quellcode beim Bauen selbst von GitHub holt. Compose baut standardmäßig damit, sodass der Ordner `deploy/` zum Bauen genügt (z. B. bei einem Git-Sync). Stand wählbar über `WERKBANK_REF`; Bauen aus einem ausgecheckten Repository über `WERKBANK_BUILD_CONTEXT=..` und `WERKBANK_DOCKERFILE=backend/Dockerfile`

## [0.3.0] – 2026-11-14

Seite „Konto“ und Profilbild aus Entra.

### Hinzugefügt

- **Konto:** Eigene Seite mit Name, E-Mail, Profilbild, Rollen samt Beschreibung, Sitzung (angemeldet seit, läuft ab, Abmelden), Darstellung und Version der Werkbank. Erreichbar über den Namen in der Kopfzeile
- **Profilbild aus Entra ID:** Wird bei der Anmeldung im Namen der Person geholt (delegierte Berechtigung `User.Read`), in der Datenbank gespeichert und allen angemeldeten Personen angezeigt (Kopfzeile, Konto, Rollen in der Verwaltung). Abschaltbar, Standard aus: `ENTRA_PROFILE_PHOTO=true`. Ohne Bild erscheinen die Initialen
- API: `GET /api/users/{id}/avatar`; `/api/me` liefert zusätzlich Kennung, Ablauf der Sitzung, Adresse des Profilbilds und Version

### Geändert

- Die Auswahl der Darstellung (hell/dunkel) steht nur noch auf der Seite „Konto“
- Anleitung für Updates: Ein Neu-Bereitstellen kann das alte Image behalten; die Befehle zum Neubauen stehen in `deploy/README.md`

## [0.2.0] – 2026-11-14

M365-Konfiguration im neuen Aussehen.

### Oberfläche

- **M365-Konfiguration, Einstellung im Detail nach dem Entwurf:** Kopf mit Pfad, Leiste mit aktuellem Wert, Gültigkeit, Kritikalität und Soll-Wert, Hinweis bei Regelung durch einen Evergreen-Vorgang, Verlauf als Zeitleiste mit Vorher/Nachher und Bewertung
- **M365-Konfiguration nach dem Entwurf:** Übersicht mit Kennzahlen (offen und davon kritisch, letzte 7 und 30 Tage, beschriebene Einstellungen), Diagramm „Änderungen pro Tag“ und letzten Änderungen; Änderungen mit Filter-Chips samt Anzahl, Liste und Detailbereich mit Vorher/Nachher, Beschreibung, Vorschlägen für den Kommentar und Regelhinweis; Einstellungen nach Workload gruppiert
- API: `GET /api/m365-config/overview` liefert zusätzlich die neuen Kennzahlen und die Änderungen je Tag (Parameter `tz` für die Zeitzone), `GET /api/m365-config/changes` die Anzahl je Bewertung sowie Workload, Kritikalität und Beschreibung je Änderung

### Geändert

- **Releases automatisch:** Wird ein PR mit neuer Version in `main` gemergt, legt der Workflow `release.yml` Tag und GitHub Release an. Er prüft vorher, dass die Version an allen Stellen gleich ist
- Jeder PR mit einer Änderung an der Anwendung hebt die Version an und bringt die Einträge für Änderungsprotokoll und Neuigkeiten mit

## [0.1.0] – 2026-11-14

Erste Version mit den Modulen M365-Konfiguration und Evergreen.

### Oberfläche

- **Neuigkeiten:** Seite mit den Änderungen je Version, die man in der Anwendung bemerkt (Quelle: `frontend/src/release-notes.ts`); Hinweis „neu“ in der Navigation, bis die aktuelle Version geöffnet wurde
- **Kopfzeile, Navigation und Startseite nach dem Entwurf:** Logo mit Untertitel, Aufgaben-Symbol mit Zähler, Person mit Initialen und Rolle; Zähler an den Menüpunkten; Startseite mit Begrüßung, Datum, Aufgaben mit Modul-Kennzeichen und Kacheln je Modul
- **Heller und dunkler Modus:** „Automatisch“ folgt der Einstellung des Geräts; die Auswahl unten in der Navigation gilt für den jeweiligen Browser
- Schriften Inter und JetBrains Mono werden mit der Anwendung ausgeliefert (kein Abruf von fremden Servern), Lizenzen in `frontend/src/fonts/`

### Sicherheit

- **Erneute Anmeldung für die Verwaltung (Step-up):** Die Verwaltung öffnet sich nur, wenn die Anmeldung höchstens 15 Minuten alt ist; sonst bietet die Oberfläche die erneute Anmeldung an
- **Begrenzung der Anfragerate** für Anmeldung, API und Exporte (Antwort 429 mit `Retry-After`), einstellbar über `RATE_LIMIT_*`
- Jede Anmeldung beendet die vorherige Sitzung des Browsers
- Service Worker nimmt Nachrichten nur von der eigenen Herkunft an (CodeQL `js/missing-origin-check`)
- Frontend: `minimatch` für typescript-eslint auf 11.0.8 angehoben (GHSA-g3hv-75wg-m249, nur Entwicklungswerkzeug)
- E2E-Werkzeuge: Abhängigkeits-Audit in der CI, `basic-ftp` per `overrides` auf eine sichere Version gezwungen (9 Lücken mit hoher Schwere über Lighthouse CI)
- GitHub Actions auf feste Commit-Hashes gepinnt und auf aktuelle Hauptversionen gehoben
- Dependabot mit 7 Tagen Wartezeit für neue Versionen
- Sicherheitsnachweis bezieht sich verbindlich auf OWASP ASVS 5.0.0, Stufe 2

### Hinzugefügt

- **Evergreen, Abschluss:** Aus einer erkannten Änderung in M365-Konfiguration lässt sich ein Vorgang anlegen; Zähler der offenen Aufgaben in der Kopfzeile
- **Evergreen, Umsetzung:** Geplante Umsetzung mit Soll-Werten je Vorgang, optional verknüpft mit einer überwachten Einstellung. Der Schritt „Umsetzung“ schließt automatisch, sobald alle Soll-Werte umgesetzt sind (vom Abruf gemeldet oder von der IT bestätigt). Soll-Werte gelten danach dauerhaft an der Einstellung; vorläufige Sperre bis zum Beschluss mit Hinweis bei nahem Rollout
- **Evergreen, Nachrichtencenter:** Der Worker liest die Meldungen von Microsoft in einen Eingang. Größere Änderungen und Meldungen mit Frist werden automatisch zu Vorgängen, alle anderen lassen sich übernehmen oder beiseitelegen. Hinweis am Vorgang, wenn Microsoft die Meldung nachträglich ändert. Braucht `ServiceMessage.Read.All` für die Collector-App
- **Evergreen, Vorgänge:** Vorgänge anlegen, Liste mit Ansichten (Offen, Wartet auf mich, Abgeschlossen, Alle), Detailseite mit Schrittleiste, Angaben, Entscheidung je Rolle und Protokoll; Beschluss des Betriebsrats im Auftrag erfassen (mit Sitzungsdatum); Frist bis zum Rollout; Aufgaben je Rolle auf der Startseite. Betriebsrat und Geschäftsführung sehen Vorgänge erst nach Vorlage
- **Workflow-Engine:** Abläufe in YAML (Schritte, Rollen, Aktionen, Kommentarpflicht, Erfassen im Auftrag, automatische Aktionen), unveränderliches Protokoll je Aktion. Erster Ablauf: Evergreen von der IT-Bewertung bis zur Umsetzung (noch ohne Oberfläche)
- **Audit-Log:** Spalte „Herkunft“ mit der gekürzten IP-Adresse, auch im CSV-Export
- **Deployment:** Compose baut das Image standardmäßig aus `main` auf GitHub (passend zu einem Git-Sync, der nur `deploy/` holt), bindet die Zertifikate für Anmeldung und Abruf als Docker-Secrets ein und nimmt den Secrets-Ordner aus `WERKBANK_SECRETS_DIR`. Anleitung für die erste Inbetriebnahme (`docs/inbetriebnahme.md`)
- **Meine Aufgaben:** Die Startseite zeigt, was zu tun ist (offene Änderungen bewerten, Abweichungen vom Soll-Wert prüfen, fehlgeschlagener Abruf für Admins); Zähler in der Navigation
- **M365-Konfiguration, Angaben je Einstellung:** Beschreibung, Begründung „Warum bei uns so“, Kritikalität, Verantwortliche, Link zu Microsoft Learn und Soll-Wert, jeweils mit eigenem Verlauf. Abweichungen vom Soll-Wert werden markiert, lassen sich filtern und stehen in der Übersicht. Bei Kritikalität „Hoch“ braucht auch „gewollt“ einen Kommentar
- **M365-Konfiguration, Oberfläche:** Übersicht (offene Änderungen, letzter Abruf, Monatskontingent), Einstellungen mit Suche und Verlauf je Einstellung, Änderungen einzeln oder gesammelt als gewollt/ungewollt bewerten (Kommentar bei „ungewollt“ Pflicht, Zurücksetzen möglich), Snapshots, Abruf außer der Reihe für Admins
- **M365-Konfiguration, Abruf aus dem Tenant:** Der Worker holt einmal täglich einen UTCM-Snapshot (Entra: Conditional Access, benannte Standorte, Autorisierungsrichtlinie), vergleicht ihn mit dem Bestand und trägt „Geändert von“ aus dem Entra-Audit-Log nach. Zählt das Monatskontingent von UTCM mit. Aktiv erst, wenn `COLLECTOR_CLIENT_ID` gesetzt ist
- **M365-Konfiguration, Versionierung:** Tabellen für Abrufe, Einstellungen, Versionen und Änderungen; Erkennung von neu, geändert und entfernt; ignorierte Felder; erster Abruf einer Quelle als Ausgangsstand (noch ohne Abruf aus dem Tenant und ohne Oberfläche)
- **Worker** für Hintergrundaufträge (eigener Container, Auftragsliste in PostgreSQL). Erster Auftrag: stündliches Aufräumen abgelaufener Sitzungen und Anmeldevorgänge
- Seite **Audit-Log** für Admin und Auditor: Filter nach Modul, Aktion und Zeitraum, seitenweises Laden, CSV-Export (geschützt vor Formel-Injektion, Export wird protokolliert)
- **Verwaltung → Rollen**: App-Rollen mit Beschreibung und den Personen, die sie bei der letzten Anmeldung hatten (nur Anzeige, maßgeblich ist Entra)
- Sicherheitsnachweis nach OWASP ASVS Stufe 2 für Phase 1 (`docs/security/asvs-l2.md`)
- Frontend-Grundgerüst (React, Vite, TypeScript): Login-Seite, Layout mit Kopfzeile und Navigation nach Rollen, Startseite, Platzhalter für die Module, mobiles Menü
- PWA: Manifest, Icons, Offline-Seite, Service Worker (nur App-Hülle im Cache, nie API-Daten; Update-Hinweis statt stillem Wechsel)
- Backend liefert die Oberfläche aus (inkl. Fallback für Seitenpfade, ohne API-Pfade zu überdecken); statische Dateien komprimiert und dauerhaft cachebar
- Docker-Image baut Frontend und Backend gemeinsam
- E2E-Tests mit Playwright (Desktop, Tablet, Handy), axe-core und Lighthouse CI
- Workflow „Lockfile und Formatierung“ für Feature-Branches
- Anmeldung über Microsoft Entra ID (OIDC, Authorization Code Flow mit PKCE, Backend-for-Frontend): Zertifikat oder Secret, Mandantenprüfung, nur bekannte App-Rollen
- Serverseitige Sitzungen: zufälliges Token im `__Host-`-Cookie, in der Datenbank nur als Hash; 30 Minuten Leerlauf, höchstens 8 Stunden
- Rollenprüfung serverseitig (`require_roles`), `/api/me` für die Oberfläche
- CSRF-Schutz: verändernde Anfragen nur von der eigenen Origin
- Schutz vor offenen Weiterleitungen nach der Anmeldung
- Audit-Einträge für Anmeldung, Ablehnung und Abmeldung
- Test-Login für automatische Tests, in Produktion technisch ausgeschlossen
- Anleitung zur Einrichtung in Microsoft Entra ID (`docs/entra-setup.md`): App-Registrierung, App-Rollen, Gruppen, Conditional Access für MFA
- PostgreSQL als Datenbank (Docker-Dienst `db`, nur internes Netz, Passwort als Docker-Secret)
- Migrationen mit Alembic, automatisch beim Start
- Kern-Tabellen `users` und `audit_log`. Das Audit-Log ist per Datenbank-Trigger nur anhängend (kein UPDATE, DELETE, TRUNCATE), IP-Adressen werden gekürzt gespeichert
- Bereitschaftsprüfung `/health/ready` (Datenbank erreichbar)
- Backend-Grundgerüst (FastAPI) mit Healthcheck `/health`, Sicherheits-Headern und abgeschalteter API-Dokumentation
- Dockerfile (non-root, Healthcheck) und `deploy/docker-compose.yml` mit Web-Dienst
- Grundgerüst des Repositorys: Spezifikation, Dokumentationsvorlagen, CI-Workflows (inkl. CodeQL), Dependabot, MIT-Lizenz, Verhaltenskodex, Issue-Vorlagen, Arbeitsregeln
