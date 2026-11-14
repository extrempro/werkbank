# Sicherheitsnachweis – OWASP ASVS Stufe 2

> **[OFFEN]** Zugrunde gelegte ASVS-Version festlegen (aktuelle Version prüfen) und die Kapitel unten an deren Gliederung anpassen.

Für jede Anforderung der Stufe 2 wird festgehalten:

- **umgesetzt durch**: Stelle im Code bzw. Konfiguration
- **getestet durch**: automatischer Test oder manuelle Prüfung
- **n/a**: nicht anwendbar, mit Begründung

Status: ✅ erfüllt · ⚠️ teilweise · ❌ offen · n/a

## Übersicht nach Themen

| Thema | Wesentliche Maßnahmen | Status |
|---|---|---|
| Architektur und Bedrohungsmodell | Bedrohungsmodell für Web, Worker, PowerShell, Konnektoren | ❌ |
| Authentifizierung | Entra ID, OIDC mit PKCE, MFA per Conditional Access | ❌ |
| Sitzungsverwaltung | serverseitige Session, `__Host-`-Cookie, Timeouts, Step-up für Verwaltung | ❌ |
| Zugriffskontrolle | Rollen- und Objektprüfung auf dem Server bei jeder Anfrage | ❌ |
| Eingabevalidierung und Kodierung | Pydantic-Schemas, Ausgabekodierung, keine HTML-Darstellung von Nutzertexten | ❌ |
| Kryptografie | TLS am Proxy, Zertifikate für Konnektoren, keine eigene Kryptografie | ❌ |
| Fehlerbehandlung und Protokollierung | keine internen Details nach außen, Audit-Log nur anhängend | ❌ |
| Datenschutz | Datensparsamkeit, kein Fachdaten-Cache im Browser | ❌ |
| Kommunikation | HSTS, nur vertrauenswürdige Proxy-Header | ❌ |
| Schadcode und Lieferkette | Dependabot, Semgrep, gitleaks, Trivy, festgeschriebene Versionen | ❌ |
| Geschäftslogik | Workflow nur über definierte Aktionen, Kommentarregeln serverseitig | ❌ |
| Dateien und Ressourcen | Typprüfung über Inhalt, Größenlimit, Download nur mit Berechtigung | ❌ |
| API und Webdienste | CSRF-Schutz, Rate-Limits, einheitliche Fehlerantworten | ❌ |
| Konfiguration | Security-Header, CSP ohne `unsafe-inline`, Container non-root | ❌ |

## Einzelnachweise

Werden ab Phase 1 je Anforderung ergänzt.
