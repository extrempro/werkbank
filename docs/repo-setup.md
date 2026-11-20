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
| 4 | Beschreibung und Topics | ✅ erledigt |
| 5 | Actions-Berechtigungen | ✅ erledigt |
| 6 | Branch Protection (Ruleset) für `main` | ✅ erledigt |
| 7 | Private vulnerability reporting | ✅ erledigt |
| 8 | Dependabot alerts und security updates | ✅ erledigt |
| 9 | Platzhalter ersetzen (Copyright-Inhaber, Kontakt) | ✅ erledigt |

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
- `Frontend (Lint, Typen, Tests, Build)`
- `E2E, Barrierefreiheit, Lighthouse`
- `CodeQL (javascript-typescript)`

Die letzten drei gibt es seit Phase 1. Ob sie im Ruleset schon als Pflicht eingetragen sind, bitte in den Einstellungen nachsehen.

## 7. Private vulnerability reporting

Settings → **Code security** (bzw. „Advanced Security“) → **Private vulnerability reporting** → Enable.
Damit funktioniert der Link „Sicherheitslücke melden“ aus den Issue-Vorlagen und aus `SECURITY.md`.

## 8. Dependabot

Settings → **Code security**:

- **Dependabot alerts**: Enable
- **Dependabot security updates**: Enable
- Versions-Updates laufen bereits über `.github/dependabot.yml`

**Code scanning:** Hier **kein** „Default setup“ für CodeQL aktivieren. `.github/workflows/codeql.yml` ist das „Advanced setup“, beides zusammen führt zu Konflikten.

## Python-Abhängigkeiten

Die Python-Pakete des Backends stehen mit festen Versionen und Hashes in `backend/uv.lock`. Docker-Image und CI installieren nur von dort (`uv export … | pip install --require-hashes`); `uv lock --check` in der CI meldet, wenn `pyproject.toml` und Lockfile nicht zusammenpassen. Dependabot (`package-ecosystem: "uv"`) hält das Lockfile aktuell, mit 7 Tagen Wartezeit.

Nach einer Änderung an `pyproject.toml` das Lockfile von Hand neu erzeugen, mit derselben uv-Version wie in Dockerfile und CI und nur mit Versionen, die mindestens 7 Tage alt sind:

```
cd backend
uvx uv@0.13.8 lock --exclude-newer "$(date -u -d '7 days ago' +%Y-%m-%dT00:00:00Z)"
```

## Releases

Keine Einrichtung nötig. Sobald ein PR mit einer neuen Version in `main` gemergt ist, legt `.github/workflows/release.yml` den Tag `vX.Y.Z` und das Release mit dem Abschnitt aus `CHANGELOG.md` an. Ein von Hand gepushter Tag erzeugt ebenfalls ein Release. Der Workflow braucht dafür Schreibrechte auf Inhalte; er fordert sie selbst an (`contents: write`).

## Deployment

Siehe [`deploy/README.md`](../deploy/README.md). Für ein öffentliches Repository braucht ein Git-Sync keinen Zugangstoken.
