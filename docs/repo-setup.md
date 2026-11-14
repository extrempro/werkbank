# Einrichtung des GitHub-Repositorys

Das Repository [`extrempro/werkbank`](https://github.com/extrempro/werkbank) ist **öffentlich**.
Diese Seite listet, was bereits eingerichtet ist und was noch von Hand in den GitHub-Einstellungen zu tun ist.
Repository-Einstellungen können nur Personen mit Admin-Rechten ändern, Claude kann sie nicht setzen.

## Stand

| # | Schritt | Status |
|---|---|---|
| 1 | Repository angelegt (öffentlich) | ✅ erledigt |
| 2 | Grundgerüst als erster Commit auf `main` | ✅ erledigt |
| 3 | Secret Scanning und Push Protection | ✅ aktiv (Standard bei öffentlichen Repos) |
| 4 | Beschreibung und Topics | ⬜ offen |
| 5 | Actions-Berechtigungen | ⬜ offen |
| 6 | Branch Protection (Ruleset) für `main` | ✅ erledigt |
| 7 | Private vulnerability reporting | ✅ erledigt |
| 8 | Dependabot alerts und security updates | ✅ erledigt |
| 9 | Platzhalter ersetzen (Copyright-Inhaber, Mail-Adressen) | ⬜ offen |

## 4. Beschreibung und Topics

Repository-Startseite → Zahnrad bei **About**:

- Beschreibung: `Werkbank – Open-Source-Plattform für IT-Abteilungen: M365-Konfigurationsüberwachung und Evergreen-Freigaben`
- Topics: `microsoft-365`, `entra-id`, `evergreen`, `configuration-management`, `drift-detection`, `fastapi`, `react`, `pwa`, `docker`, `self-hosted`

## 5. Actions-Berechtigungen

Settings → Actions → General:

- **Actions permissions:** Actions erlauben (alle oder auf GitHub- und verifizierte Actions beschränken)
- **Workflow permissions:** „Read repository contents and packages permissions“ (Workflows fordern Schreibrechte einzeln an)
- **Fork pull request workflows from outside collaborators:** „Require approval for all external contributors“. Wichtig bei einem öffentlichen Repo, damit fremde PRs nicht ungeprüft Workflows starten.

## 6. Branch Protection für `main`

Settings → **Rules** → Rulesets → **New branch ruleset**:

| Einstellung | Wert |
|---|---|
| Name | `main schützen` |
| Enforcement status | Active |
| Target branches | Include default branch |
| Restrict deletions | an |
| Block force pushes | an |
| Require linear history | an |
| Require a pull request before merging | an |
| Required approvals | siehe Hinweis |
| Require status checks to pass | an, Checks siehe unten |

**Hinweis zu Freigaben:** GitHub erlaubt nicht, den eigenen Pull Request freizugeben. Wenn du allein arbeitest, setze „Required approvals“ auf **0**. Der PR bleibt Pflicht, und die Checks müssen grün sein. Sobald eine zweite Person mitarbeitet: **1**.

**Status-Checks:** GitHub bietet sie erst zur Auswahl an, nachdem sie einmal gelaufen sind. Eintragen:

- `Dokumentation vorhanden`
- `Backend (Lint, Typen, Tests)`
- `Docker-Deployment (Build, Start, Smoke-Test)`
- `Semgrep (statische Analyse, XSS)`
- `gitleaks (Secrets)`
- `Trivy (Abhängigkeiten, Konfiguration, Secrets)`
- `CodeQL (python)`
- später zusätzlich: `Frontend (Lint, Typen, Tests, Build)`, `E2E, Barrierefreiheit, Lighthouse`, `CodeQL (javascript-typescript)`

## 7. Private vulnerability reporting

Settings → **Code security** (bzw. „Advanced Security“) → **Private vulnerability reporting** → Enable.
Damit funktioniert der Link „Sicherheitslücke melden“ aus den Issue-Vorlagen und aus `SECURITY.md`.

## 8. Dependabot

Settings → **Code security**:

- **Dependabot alerts**: Enable
- **Dependabot security updates**: Enable
- Versions-Updates laufen bereits über `.github/dependabot.yml`

**Code scanning:** Hier **kein** „Default setup“ für CodeQL aktivieren. `.github/workflows/codeql.yml` ist das „Advanced setup“, beides zusammen führt zu Konflikten.

## 9. Platzhalter

- `LICENSE`: `[NAME BZW. FIRMA]` durch den Copyright-Inhaber ersetzen
- `SECURITY.md` und `CODE_OF_CONDUCT.md`: `[E-MAIL-ADRESSE EINTRAGEN]` ersetzen

Die Änderung über einen Branch und Pull Request einbringen, nicht direkt auf `main`.

## Releases

Keine Einrichtung nötig. Ein gepushter Tag `vX.Y.Z` erzeugt über `.github/workflows/release.yml` ein Release mit den Notizen aus `CHANGELOG.md`.

## Arcane

Siehe [`deploy/README.md`](../deploy/README.md). Für ein öffentliches Repository braucht Arcane keinen Zugangstoken.
