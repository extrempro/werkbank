# Mitarbeit an der Werkbank

Beiträge sind willkommen: Fehlermeldungen, Ideen, Dokumentation und Code. Bitte beachte den [Verhaltenskodex](CODE_OF_CONDUCT.md).

- **Fehler und Ideen:** als Issue mit der passenden Vorlage
- **Sicherheitslücken:** nie als Issue, siehe [`SECURITY.md`](SECURITY.md)
- **Größere Änderungen:** bitte zuerst ein Issue öffnen und abstimmen, bevor du Zeit investierst
- **Lizenz:** Mit deinem Beitrag stimmst du zu, dass er unter der [MIT-Lizenz](LICENSE) dieses Projekts veröffentlicht wird.
- **Keine internen Daten:** keine echten Hostnamen, Tenant-IDs, Firmen- oder Personennamen in Code, Tests oder Screenshots

## Ablauf

Für externe Beiträge: Repository forken und den PR aus deinem Fork stellen. Für Mitglieder des Projekts:

1. Aktuellen Stand holen: `git switch main && git pull`
2. Branch anlegen: `git switch -c feature/kurze-beschreibung`
3. Änderungen machen, Tests lokal ausführen
4. Commits nach Conventional Commits
5. Branch pushen: `git push -u origin feature/kurze-beschreibung`
6. Pull Request gegen `main` öffnen (Vorlage ausfüllen)
7. Merge erst nach Freigabe und grünen Prüfungen

Direkte Pushes auf `main` sind gesperrt.

## Branch-Namen

| Präfix | Wofür |
|---|---|
| `feature/` | neue Funktion |
| `fix/` | Fehlerbehebung |
| `security/` | Sicherheitskorrektur |
| `docs/` | nur Dokumentation |
| `chore/` | Wartung, Abhängigkeiten, CI |

## Commit-Nachrichten

[Conventional Commits](https://www.conventionalcommits.org/de/), Beschreibung auf Deutsch:

```
feat(evergreen): BR-Beschluss im Auftrag erfassen
fix(m365): entfernte Einstellungen bei Teilabruf nicht melden
docs: Datenschutzkonzept ergänzt
```

## Versionen und Release Notes

- SemVer: `MAJOR.MINOR.PATCH`
- Jede Änderung mit Auswirkung für Nutzer kommt in `CHANGELOG.md` unter „Unveröffentlicht“.
- Für ein Release wird der Abschnitt in eine Versionsnummer umbenannt, der Tag `vX.Y.Z` gesetzt und gepusht. Der Workflow `release.yml` erstellt daraus das GitHub Release.

## Pull Requests

- Eine Sache pro PR, möglichst klein.
- Alle Prüfungen grün: Lint, Tests, E2E, Barrierefreiheit, Lighthouse, Docker, Semgrep, gitleaks, Trivy.
- Bei neuen Screens: Designrichtlinie, WCAG-Checkliste und ISO-9241-Checkliste durchgehen.
- Bei sicherheitsrelevanten Änderungen: ASVS-Nachweis aktualisieren.
- Bei neuen personenbezogenen Daten: Datenschutzdokument aktualisieren.

## Lokale Entwicklung

Wird mit Phase 1 ergänzt (Docker Compose für Entwicklung, Test-Login statt Entra).

## Regeln für Claude

Siehe [`CLAUDE.md`](CLAUDE.md).
