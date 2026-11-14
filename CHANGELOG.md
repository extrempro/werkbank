# Änderungsprotokoll

Alle nennenswerten Änderungen an der Werkbank. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionen nach [SemVer](https://semver.org/lang/de/).

## [Unveröffentlicht]

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

- **Evergreen, Nachrichtencenter:** Der Worker liest die Meldungen von Microsoft in einen Eingang. Größere Änderungen und Meldungen mit Frist werden automatisch zu Vorgängen, alle anderen lassen sich übernehmen oder beiseitelegen. Hinweis am Vorgang, wenn Microsoft die Meldung nachträglich ändert. Braucht `ServiceMessage.Read.All` für die Collector-App
- **Evergreen, Vorgänge:** Vorgänge anlegen, Liste mit Ansichten (Offen, Wartet auf mich, Abgeschlossen, Alle), Detailseite mit Schrittleiste, Angaben, Entscheidung je Rolle und Protokoll; Beschluss des Betriebsrats im Auftrag erfassen (mit Sitzungsdatum); Frist bis zum Rollout; Aufgaben je Rolle auf der Startseite. Betriebsrat und Geschäftsführung sehen Vorgänge erst nach Vorlage
- **Workflow-Engine:** Abläufe in YAML (Schritte, Rollen, Aktionen, Kommentarpflicht, Erfassen im Auftrag, automatische Aktionen), unveränderliches Protokoll je Aktion. Erster Ablauf: Evergreen von der IT-Bewertung bis zur Umsetzung (noch ohne Oberfläche)
- **Audit-Log:** Spalte „Herkunft“ mit der gekürzten IP-Adresse, auch im CSV-Export
- **Deployment:** Compose baut das Image standardmäßig aus `main` auf GitHub (passend zu Arcane Git-Sync), bindet die Zertifikate für Anmeldung und Abruf als Docker-Secrets ein und nimmt den Secrets-Ordner aus `WERKBANK_SECRETS_DIR`. Anleitung für die erste Inbetriebnahme (`docs/inbetriebnahme.md`)
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
