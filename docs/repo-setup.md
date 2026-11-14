# Einrichtung des GitHub-Repositorys

Einmalige Schritte für den Start. Reihenfolge einhalten.

## 0. Vor der Veröffentlichung

- **Freigabe einholen:** Die Veröffentlichung als Open Source (MIT) muss vom Rechteinhaber freigegeben sein (Arbeitgeber/Geschäftsführung). Danach den Copyright-Inhaber in `LICENSE` eintragen.
- **Platzhalter ersetzen:** `[NAME BZW. FIRMA]` in `LICENSE`, Mail-Adressen in `SECURITY.md` und `CODE_OF_CONDUCT.md`, (`OWNER` im Issue-Template ist bereits auf `extrempro` gesetzt).
- **Vorgehen:** Repository zunächst **privat** anlegen und einrichten. Erst nach der Freigabe und einer Prüfung der Historie (Schritt 7) auf **öffentlich** stellen.

## 1. Repository anlegen

1. GitHub → **New repository**
2. Name: `werkbank`, Sichtbarkeit: **Private** (vorerst)
3. **Kein** README, keine `.gitignore`, keine Lizenz anlegen lassen (ist alles im Grundgerüst)
4. **Create repository**

## 2. Grundgerüst hochladen

Mit Git (empfohlen, damit auch versteckte Ordner wie `.github` sicher mitkommen):

```bash
cd werkbank                      # entpackter Ordner aus dem ZIP
git init -b main
git add .
git commit -m "chore: Grundgerüst des Repositorys"
git remote add origin https://github.com/extrempro/werkbank.git
git push -u origin main
```

Dieser erste Push auf `main` ist der einzige direkte.

## 3. Beschreibung und Topics

Repository-Startseite → Zahnrad bei **About**:

- Beschreibung: `Werkbank – Open-Source-Plattform für IT-Abteilungen: M365-Konfigurationsüberwachung und Evergreen-Freigaben`
- Topics: `microsoft-365`, `entra-id`, `evergreen`, `configuration-management`, `drift-detection`, `fastapi`, `react`, `pwa`, `docker`, `self-hosted`

## 4. Actions-Berechtigungen

Settings → Actions → General:

- Actions erlauben (alle oder auf GitHub- und verifizierte Actions beschränken)
- Workflow permissions: **Read repository contents** (Workflows fordern Schreibrechte einzeln an)
- „Require approval for all outside collaborators“ für Workflows aus Forks aktivieren

## 5. Branch Protection für `main`

Settings → **Rules** → Rulesets → **New branch ruleset**:

| Einstellung | Wert |
|---|---|
| Name | `main schützen` |
| Enforcement status | Active |
| Target branches | Default branch |
| Restrict deletions | an |
| Block force pushes | an |
| Require linear history | an |
| Require a pull request before merging | an |
| Required approvals | siehe Hinweis |
| Require status checks to pass | an, Checks siehe unten |

> Branch Protection für **private** Repositories gibt es erst ab GitHub Pro/Team. Mit GitHub Free die Regeln anlegen, sobald das Repository öffentlich ist.

**Hinweis Freigaben:** GitHub erlaubt nicht, den eigenen Pull Request freizugeben. Arbeitest du allein, setze „Required approvals“ auf **0**. Der PR bleibt Pflicht, und die Checks müssen grün sein. Sobald eine zweite Person mitarbeitet: **1**.

**Status-Checks:** GitHub bietet sie erst zur Auswahl an, nachdem sie einmal gelaufen sind. Nach dem ersten Feature-Branch mit PR eintragen:

- `Dokumentation vorhanden`
- `Semgrep (statische Analyse, XSS)`
- `gitleaks (Secrets)`
- `Trivy (Abhängigkeiten, Konfiguration, Secrets)`
- ab Phase 1 zusätzlich: CodeQL je Sprache, Backend, Frontend, Docker-Deployment, E2E

## 6. Sicherheitsfunktionen (nach dem Umstellen auf öffentlich)

Settings → **Code security** (bzw. „Advanced Security“):

| Funktion | Einstellung |
|---|---|
| Private vulnerability reporting | Enable |
| Dependabot alerts | Enable |
| Dependabot security updates | Enable |
| Secret scanning | Enable |
| Push protection | Enable |
| Code scanning – CodeQL | **kein** „Default setup“ aktivieren: `.github/workflows/codeql.yml` ist das „Advanced setup“ |

Versions-Updates laufen automatisch über `.github/dependabot.yml`.

## 7. Auf öffentlich umstellen

1. Freigabe liegt vor (Schritt 0).
2. Historie auf Secrets und interne Informationen prüfen. Der Workflow „Sicherheit“ (gitleaks) muss grün sein. Zusätzlich die Commits kurz manuell durchsehen.
3. Settings → General → Danger Zone → **Change repository visibility** → Public.
4. Schritte 5 und 6 ausführen bzw. prüfen.

## 8. Releases

Keine Einrichtung nötig. Ein gepushter Tag `vX.Y.Z` erzeugt über `.github/workflows/release.yml` ein Release mit den Notizen aus `CHANGELOG.md`.

## 9. Arcane

Erst ab Phase 1, siehe [`deploy/README.md`](../deploy/README.md). Arcane benötigt für ein öffentliches Repository keinen Zugangstoken.
