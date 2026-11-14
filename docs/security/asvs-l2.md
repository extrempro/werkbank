# Sicherheitsnachweis – OWASP ASVS Stufe 2

> **Stand:** Ende Phase 1 (Kern: Anmeldung, Sitzungen, Rollen, Audit-Log, Oberfläche, PWA).
> **Grundlage:** OWASP ASVS, Stufe 2. **[OFFEN]** Die Version (aktuell vermutlich 5.0) ist noch zu bestätigen. Danach wird die Übersicht unten Anforderung für Anforderung nach der Gliederung dieser Version aufgeschlüsselt.

Status: ✅ umgesetzt und getestet · ⚠️ teilweise · ❌ offen · n/a nicht anwendbar

## Übersicht nach Themen

| Thema | Maßnahmen (umgesetzt durch) | Nachweis (getestet durch) | Status |
|---|---|---|---|
| **Authentifizierung** | Nur Microsoft Entra ID, OIDC Authorization Code Flow mit PKCE über MSAL, vertraulicher Client mit Zertifikat (bevorzugt) oder Secret aus Docker-Secrets; Prüfung von Mandant (`tid`), Objekt-ID und App-Rollen; „Zuweisung erforderlich“ in Entra; MFA über Conditional Access (`backend/werkbank/core/auth.py`, `docs/entra-setup.md`) | `tests/test_auth.py`: Entra-Ablauf, falscher Mandant, ohne Rolle, Fehlerantwort, fehlender Anmeldevorgang | ✅ (MFA: Entra-Konfiguration) |
| **Kein eigener Passwortspeicher** | Keine lokalen Konten, keine Passwörter in der Werkbank | – | ✅ |
| **Test-Zugang** | Test-Login nur bei `ENVIRONMENT=test/development`, sonst Startabbruch; in Produktion 404 (`config.py`, `auth.py`) | `test_test_login_not_allowed_in_production`, `test_test_login_hidden_when_disabled` | ✅ |
| **Sitzungen** | Serverseitig; Zufallstoken (256 Bit) im Cookie `__Host-werkbank` (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`); in der Datenbank nur SHA-256-Hash; Leerlauf 30 min, höchstens 8 h; Abmelden löscht serverseitig (`core/sessions.py`) | `test_session_token_not_stored_in_plain_text`, `test_idle_timeout`, `test_logout_ends_session` | ✅ |
| **Erneute Anmeldung für Verwaltung (Step-up)** | Vorgesehen (`STEP_UP_MINUTES`), noch nicht erzwungen | – | ❌ Phase 2 |
| **Zugriffskontrolle** | Rollenprüfung serverseitig bei jeder Anfrage (`require_roles`), Navigation nur Komfort; Audit-Log nur Admin/Auditor, Rollenübersicht nur Admin (`core/deps.py`, `core/audit_api.py`) | `test_role_check`, `test_audit_forbidden_for_other_roles`, E2E `verwaltung.spec.ts` | ✅ |
| **Objektberechtigung** | Noch keine fachlichen Objekte; gilt ab Phase 2 für jede Abfrage | – | n/a (Phase 1) |
| **CSRF** | Verändernde Anfragen nur mit eigener Origin bzw. eigenem Referer (`core/csrf.py`), zusätzlich `SameSite=Lax` | `test_post_without_origin_is_rejected`, `test_post_with_foreign_origin_is_rejected` | ✅ |
| **Weiterleitungen** | Nach der Anmeldung nur relative Pfade innerhalb der Werkbank (`_safe_return_to`) | `test_open_redirect_is_prevented` | ✅ |
| **Eingabevalidierung** | Pydantic-Modelle und Query-Grenzen (Längen, Wertebereiche) für alle Parameter | Tests der Endpunkte | ✅ |
| **Ausgabekodierung / XSS** | React kodiert Ausgaben, keine HTML-Darstellung von Nutzertexten, kein `dangerouslySetInnerHTML`; CSP ohne `unsafe-inline` | Semgrep (XSS-Regeln), CodeQL | ✅ |
| **CSV-Export** | Schutz vor Formel-Injektion (`safe_cell`), Export wird protokolliert, `Cache-Control: no-store` | `test_safe_cell`, `test_audit_export_is_csv_and_logged` | ✅ |
| **Sicherheits-Header** | CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'` u. a.), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP (`security.py`); HSTS am Reverse Proxy | `test_security_headers_present`, `test_security_headers_on_frontend` | ✅ (HSTS: Proxy-Konfiguration) |
| **API-Dokumentation** | OpenAPI/Swagger in Produktion abgeschaltet | `test_api_docs_disabled` | ✅ |
| **Kommunikation** | TLS am NetBird Reverse Proxy; Container nur an `BIND_IP` gebunden; Proxy-Header nur von `TRUSTED_PROXY_IPS` | Docker-Smoke-Test | ⚠️ HTTPS-Tests folgen |
| **Datenbank** | Nur internes Docker-Netz, Passwort als Docker-Secret, ORM ohne zusammengesetzte SQL-Strings | Backend-Tests gegen PostgreSQL | ✅ |
| **Protokollierung** | Audit-Log nur anhängend (Datenbank-Trigger gegen UPDATE/DELETE/TRUNCATE); Anmeldung, Ablehnung mit Grund, Abmeldung, Export; IP gekürzt (`core/audit.py`, Migration 0001) | `test_audit_update_is_rejected`, `…delete…`, `…truncate…`, `test_audit_entry_is_written` | ✅ |
| **Fehlerbehandlung** | Keine Stacktraces nach außen, Health-Endpunkte ohne Details | `test_health_ok`, `test_ready_with_database` | ✅ |
| **Rate-Limits** | Noch nicht umgesetzt (Login, API, Exporte) | – | ❌ Phase 2 |
| **Dateien und Anhänge** | Noch keine Uploads | – | n/a (Phase 1) |
| **Browser-Speicher / PWA** | Service Worker cacht nur die App-Hülle, `/api` und `/auth` nie; keine Fachdaten im lokalen Speicher | E2E `pwa.spec.ts` (Cache-Inhalt), Offline-Seite | ✅ |
| **Konfiguration und Container** | Container ohne Root, schreibgeschütztes Dateisystem, keine Capabilities, `no-new-privileges`; Secrets nur als Docker-Secrets | Trivy (Konfiguration), Docker-Smoke-Test | ✅ |
| **Lieferkette** | Actions per Commit-Hash gepinnt, Dependabot mit 7 Tagen Wartezeit, Lockfiles, `npm audit`/`pip-audit`, Semgrep, CodeQL, gitleaks, Trivy | CI-Workflows `ci.yml`, `security.yml`, `codeql.yml` | ✅ |
| **Secrets im Repository** | gitleaks, GitHub Secret Scanning mit Push Protection, `.gitignore` für Schlüssel und `.env` | `security.yml` | ✅ |

## Offene Punkte für Phase 2

1. Step-up-Anmeldung für die Verwaltung erzwingen
2. Rate-Limits für Login, API und Exporte
3. Objektberechtigungen für die fachlichen Daten der Module
4. E2E-Tests über HTTPS (auch WebKit), HSTS prüfen
5. Einzelnachweis je ASVS-Anforderung nach Festlegung der Version
