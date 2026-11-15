# Änderungsprotokoll

Alle nennenswerten Änderungen an der Werkbank. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionen nach [SemVer](https://semver.org/lang/de/).

## [Unveröffentlicht]

## [0.11.0] – 2026-11-15

Empfehlungen aus Microsoft Secure Score.

### M365-Konfiguration

- **Neue Seite „Empfehlungen“:** Empfehlungen („Controls“) aus Microsoft Secure Score mit Stand und Punkten im Tenant, gefiltert nach offen, erfüllt und alle. Das Detail zeigt Microsofts Statustext, die Hinweise zur Umsetzung und einen Link zur Stelle im Admin-Portal. Titel und Texte kommen von Microsoft und sind auf Englisch
- **Zuordnung zu Einstellungen:** Microsoft liefert keinen Bezug zu einzelnen Einstellungen. Reviewer ordnen einer Empfehlung deshalb von Hand Einstellungen zu; die Empfehlung erscheint dann auch in der Einstellung
- **Abruf:** einmal täglich, standardmäßig aus. Einschalten mit `SECURE_SCORE_ENABLED=true`, nachdem die Collector-App die Berechtigung `SecurityEvents.Read.All` bekommen hat (`docs/entra-setup.md`)

### Behoben

- Im Baum der Einstellungen ist die gewählte Einstellung jetzt auch für Screenreader als aktuelle Seite gekennzeichnet

### Technik

- Neue Tabellen `cfg_recommendations` und `cfg_recommendation_links` (Migration 0016), neuer Auftrag `m365_config.secure_score`
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
