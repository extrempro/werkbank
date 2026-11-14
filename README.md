# Werkbank

Open-Source-Plattform für IT-Abteilungen mit gemeinsamer Anmeldung (Microsoft Entra ID), Rollen, Aufgabenliste, Workflows, Audit-Log und Berichten.

**Module (Version 1)**

- **M365-Konfiguration**: erfasst die Einstellungen des Microsoft-365-Tenants, erkennt Änderungen und führt einen Verlauf je Einstellung.
- **Evergreen**: neue Microsoft-Funktionen bewerten, dem Betriebsrat vorlegen, von der Geschäftsführung abnehmen lassen und die Umsetzung im Tenant überwachen.

> Status: **Phase 2 umgesetzt**: Kern (Anmeldung über Entra ID, Rollen, Audit-Log, Oberfläche als PWA) und Modul M365-Konfiguration (Abruf, Verlauf, Bewertung von Änderungen, Soll/Ist). Eine erste Installation läuft; Anmeldung und Abruf aus dem Tenant sind dort bestätigt. Siehe [`docs/spec.md`](docs/spec.md), Kapitel 15.

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [`docs/spec.md`](docs/spec.md) | Funktionen, Datenmodell, Screens, Rahmenbedingungen |
| [`docs/design.md`](docs/design.md) | Designrichtlinie und einheitliche Bedienung |
| [`docs/datenschutz.md`](docs/datenschutz.md) | Datenschutz (DSGVO) |
| [`docs/a11y-wcag22.md`](docs/a11y-wcag22.md) | Barrierefreiheit nach WCAG 2.2 AA |
| [`docs/usability-iso9241.md`](docs/usability-iso9241.md) | Gebrauchstauglichkeit nach ISO 9241 |
| [`docs/security/asvs-l2.md`](docs/security/asvs-l2.md) | Sicherheitsnachweis nach OWASP ASVS Stufe 2 |
| [`docs/repo-setup.md`](docs/repo-setup.md) | Einrichtung des GitHub-Repositorys |
| [`docs/entra-setup.md`](docs/entra-setup.md) | Einrichtung in Microsoft Entra ID (App-Registrierungen, Rollen, MFA) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Mitarbeit: Branches, Commits, Pull Requests |
| [`SECURITY.md`](SECURITY.md) | Sicherheitslücken melden |
| [`CLAUDE.md`](CLAUDE.md) | Arbeitsregeln für Claude |

## Technik (geplant)

Python/FastAPI · PostgreSQL · React/Vite/TypeScript (PWA) · PowerShell 7 · Docker Compose · GitHub Actions

## Betrieb (geplant)

- Docker Compose (`deploy/docker-compose.yml`), Konfiguration über `deploy/.env` (Vorlage: `deploy/.env.example`)
- Veröffentlichung hinter dem NetBird Reverse Proxy
- Automatisches Deployment über Arcane Git-Sync ab Branch `main`

## Mitmachen

Beiträge sind willkommen, siehe [`CONTRIBUTING.md`](CONTRIBUTING.md) und [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
Sicherheitslücken bitte **nicht** als Issue melden, sondern wie in [`SECURITY.md`](SECURITY.md) beschrieben.

## Lizenz

[MIT](LICENSE)
