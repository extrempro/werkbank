# Änderungsprotokoll

Alle nennenswerten Änderungen an der Werkbank. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionen nach [SemVer](https://semver.org/lang/de/).

## [Unveröffentlicht]

### Sicherheit

- GitHub Actions auf feste Commit-Hashes gepinnt und auf aktuelle Hauptversionen gehoben
- Dependabot mit 7 Tagen Wartezeit für neue Versionen

### Hinzugefügt

- Anmeldung über Microsoft Entra ID (OIDC, Authorization Code Flow mit PKCE, Backend-for-Frontend): Zertifikat oder Secret, Mandantenprüfung, nur bekannte App-Rollen
- Serverseitige Sitzungen: zufälliges Token im `__Host-`-Cookie, in der Datenbank nur als Hash; 30 Minuten Leerlauf, höchstens 8 Stunden
- Rollenprüfung serverseitig (`require_roles`), `/api/me` für die Oberfläche
- CSRF-Schutz: verändernde Anfragen nur von der eigenen Origin
- Schutz vor offenen Weiterleitungen nach der Anmeldung
- Audit-Einträge für Anmeldung, Ablehnung und Abmeldung
- Test-Login für automatische Tests, in Produktion technisch ausgeschlossen
- PostgreSQL als Datenbank (Docker-Dienst `db`, nur internes Netz, Passwort als Docker-Secret)
- Migrationen mit Alembic, automatisch beim Start
- Kern-Tabellen `users` und `audit_log`. Das Audit-Log ist per Datenbank-Trigger nur anhängend (kein UPDATE, DELETE, TRUNCATE), IP-Adressen werden gekürzt gespeichert
- Bereitschaftsprüfung `/health/ready` (Datenbank erreichbar)
- Backend-Grundgerüst (FastAPI) mit Healthcheck `/health`, Sicherheits-Headern und abgeschalteter API-Dokumentation
- Dockerfile (non-root, Healthcheck) und `deploy/docker-compose.yml` mit Web-Dienst
- Grundgerüst des Repositorys: Spezifikation, Dokumentationsvorlagen, CI-Workflows (inkl. CodeQL), Dependabot, MIT-Lizenz, Verhaltenskodex, Issue-Vorlagen, Arbeitsregeln
