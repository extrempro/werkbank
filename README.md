# Werkbank

Open-Source-Plattform für IT-Abteilungen mit gemeinsamer Anmeldung (Microsoft Entra ID), Rollen, Aufgabenliste, Workflows, Audit-Log und Berichten.

**Module (Version 1)**

- **M365-Konfiguration**: erfasst die Einstellungen des Microsoft-365-Tenants, erkennt Änderungen und führt einen Verlauf je Einstellung.
- **Evergreen**: neue Microsoft-Funktionen bewerten, dem Betriebsrat vorlegen, von der Geschäftsführung abnehmen lassen und die Umsetzung im Tenant überwachen.

> Status: **Version 0.3** (Phase 3 umgesetzt): Kern (Anmeldung über Entra ID, Rollen, Aufgaben, Audit-Log, Konto, Neuigkeiten, heller und dunkler Modus, Oberfläche als PWA), Modul M365-Konfiguration (Abruf, Verlauf, Bewertung von Änderungen, Soll/Ist) und Modul Evergreen (Nachrichtencenter, Vorgänge mit Ablauf über Betriebsrat und Geschäftsführung, Umsetzung). Eine erste Installation läuft. Als Nächstes: Oberfläche weiter an den Entwurf angleichen, danach Phase 4 (weitere Dienste, Reports, Benachrichtigungen). Stand und offene Punkte: [`docs/spec.md`](docs/spec.md), Kapitel 15 und 16. Änderungen je Version: [`CHANGELOG.md`](CHANGELOG.md) und [Releases](https://github.com/extrempro/werkbank/releases).

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
| [`deploy/README.md`](deploy/README.md) | Deployment mit Docker Compose, Secrets, Arcane, Updates |
| [`docs/inbetriebnahme.md`](docs/inbetriebnahme.md) | Erste Inbetriebnahme Schritt für Schritt mit Prüfschritten |
| [`CHANGELOG.md`](CHANGELOG.md) | Änderungsprotokoll je Version |
| [`docs/entra-setup.md`](docs/entra-setup.md) | Einrichtung in Microsoft Entra ID (App-Registrierungen, Rollen, MFA) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Mitarbeit: Branches, Commits, Pull Requests |
| [`SECURITY.md`](SECURITY.md) | Sicherheitslücken melden |
| [`CLAUDE.md`](CLAUDE.md) | Arbeitsregeln für Claude |

## Technik

Python/FastAPI · PostgreSQL · React/Vite/TypeScript (PWA) · Docker Compose · GitHub Actions. Geplant für weitere Dienste: PowerShell 7.

## Betrieb

- Docker Compose (`deploy/docker-compose.yml`), Konfiguration über `deploy/.env` (Vorlage: `deploy/.env.example`), Secrets als Dateien auf dem Host
- Veröffentlichung hinter dem NetBird Reverse Proxy
- Arcane Git-Sync holt den Ordner `deploy/` ab Branch `main`. Eine neue Version läuft erst nach einem neuen Build des Images, siehe [`deploy/README.md`](deploy/README.md)
- Welche Version läuft, steht in der Werkbank auf der Seite „Konto“

## Mitmachen

Beiträge sind willkommen, siehe [`CONTRIBUTING.md`](CONTRIBUTING.md) und [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
Sicherheitslücken bitte **nicht** als Issue melden, sondern wie in [`SECURITY.md`](SECURITY.md) beschrieben.

## Lizenz

[MIT](LICENSE)
