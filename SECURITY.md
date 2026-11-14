# Sicherheit

## Sicherheitslücken melden

Bitte Sicherheitslücken **nicht** als öffentliches Issue melden.

- Über GitHub **„Report a vulnerability“** im Reiter „Security“ dieses Repositorys (vertrauliche Meldung)

Bitte angeben:

- betroffene Version bzw. Commit
- Beschreibung und Auswirkung
- Schritte zum Nachvollziehen
- falls vorhanden, ein Lösungsvorschlag

Wir bestätigen den Eingang innerhalb von 2 Werktagen und melden uns mit einer Einschätzung und einem Zeitplan.

## Unterstützte Versionen

| Version | Sicherheitsupdates |
|---|---|
| aktuelle Version auf `main` | ja |
| ältere Versionen | nein |

## Sicherheitsmaßnahmen im Projekt

- Anmeldung nur über Microsoft Entra ID mit MFA (Conditional Access)
- Lesender Zugriff auf den M365-Tenant, Anmeldung per Zertifikat
- Prüfung nach OWASP ASVS Stufe 2, Nachweis in [`docs/security/asvs-l2.md`](docs/security/asvs-l2.md)
- Automatische Prüfungen in der CI: CodeQL, Semgrep, gitleaks, Trivy, Dependabot, Abhängigkeits-Audit
- GitHub Secret Scanning mit Push Protection
- Branch Protection auf `main`, Änderungen nur per Pull Request mit grünen Prüfungen
