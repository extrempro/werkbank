# Werkbank

Open-Source-Plattform für IT-Abteilungen mit gemeinsamer Anmeldung (Microsoft Entra ID), Rechten je Bereich, Aufgabenliste, Benachrichtigungen, Audit-Log und Handbuch.

**Bereiche**

- **M365-Einstellungen**: erfasst die Einstellungen des Microsoft-365-Tenants, erkennt Änderungen, führt einen Verlauf je Einstellung und vergleicht mit Soll-Werten; dazu Tenant-Übersicht (Lizenzen, Nutzung, Dienststatus).
- **Evergreen**: Neuerungen der eingesetzten Software sichten, bewerten und mit Notizen nachhalten.
- **Tickets**: Ticketsystem für Bereiche mit eigenem Postfach (E-Mail-Eingang, Antworten, Fristen, Textbausteine, Aufbewahrung).
- **Dokumentation**: Seiten in Arbeitsbereichen mit gemeinsamer Bearbeitung in Echtzeit, Kommentaren, Verweisen und Live-Bausteinen.
- **IT-Bestand**: Hardware, Stellen, Arbeitsplätze, Standorte, Verleih und Vorgänge; Abgleich mit NinjaOne.
- **IT-Projekte**: Projekte mit Budget, Jour Fixe und Aufgaben.
- **IT-Budget**: Konten, Budgetposten, Verträge mit Fristen, Partner und Rechnungen.
- **IT-Monitoring**: DNS-Abgleich mit NetBox und Übersicht aus Zabbix mit Berichten.
- **Gerätezuordnung**: neue Windows-Geräte per QR-Code erfassen und freigeben.
- **IT-Tools**: Rechner, Generatoren und Konverter für den IT-Alltag.

> Stand und offene Punkte: [`docs/spec.md`](docs/spec.md), Kapitel 15 und 16. Änderungen je Version: [`CHANGELOG.md`](CHANGELOG.md) und [Releases](https://github.com/extrempro/werkbank/releases).

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
| [`deploy/README.md`](deploy/README.md) | Deployment mit Docker Compose, Secrets, Git-Sync, Updates |
| [`docs/inbetriebnahme.md`](docs/inbetriebnahme.md) | Erste Inbetriebnahme Schritt für Schritt mit Prüfschritten |
| [`CHANGELOG.md`](CHANGELOG.md) | Änderungsprotokoll je Version |
| [`docs/entra-setup.md`](docs/entra-setup.md) | Einrichtung in Microsoft Entra ID (App-Registrierungen, Gruppen, MFA) |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Mitarbeit: Branches, Commits, Pull Requests |
| [`SECURITY.md`](SECURITY.md) | Sicherheitslücken melden |
| [`CLAUDE.md`](CLAUDE.md) | Arbeitsregeln für Claude |

## Technik

Python/FastAPI · PostgreSQL · React/Vite/TypeScript (PWA) · Docker Compose · GitHub Actions. Geplant für weitere Dienste: PowerShell 7.

## Betrieb

- Docker Compose (`deploy/docker-compose.yml`), Konfiguration über `deploy/.env` (Vorlage: `deploy/.env.example`), Secrets als Dateien auf dem Host
- Veröffentlichung hinter einem Reverse Proxy, an dem TLS endet
- Für den Betrieb genügt der Ordner `deploy/` (z. B. per Git-Sync eines Docker-Verwaltungswerkzeugs ab Branch `main`). Eine neue Version läuft erst nach einem neuen Build des Images, siehe [`deploy/README.md`](deploy/README.md)
- Welche Version läuft, steht in der Werkbank auf der Seite „Konto“

## Mitmachen

Beiträge sind willkommen, siehe [`CONTRIBUTING.md`](CONTRIBUTING.md) und [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
Sicherheitslücken bitte **nicht** als Issue melden, sondern wie in [`SECURITY.md`](SECURITY.md) beschrieben.

## Lizenz

[MIT](LICENSE)
