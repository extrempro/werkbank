# Arbeitsregeln für Claude

Diese Datei gilt für jede Arbeit von Claude (Claude Code, Claude im Chat) an diesem Repository.
Das Repository ist **öffentlich**. Diese Datei und alles andere im Repo enthält daher nur Informationen,
die jeder lesen darf: keine Hostnamen, IP-Adressen, Tenant-IDs, Zugangsdaten, Firmen- oder Personennamen.

## Immer gültige Regeln

1. **Pull Requests nur auf ausdrückliche Aufforderung.** Ohne klare Anweisung („erstelle einen PR“) wird kein Pull Request erstellt. Das gilt immer.
2. **Bei Unsicherheit fragen, nicht handeln.** Wenn etwas unklar ist, Informationen fehlen oder eine Entscheidung mehrere sinnvolle Möglichkeiten hat: nachfragen, statt eine Annahme zu treffen.
3. **Nie direkt auf `main` arbeiten.** Jede Änderung auf einem eigenen Branch (`feature/…`, `fix/…`, `docs/…`, `chore/…`, `security/…`).
4. **Keine Tags und Releases von Hand.** Tag und GitHub Release legt der Workflow `release.yml` an, sobald ein PR mit einer neuen Version in `main` gemergt wird. Das Mergen durch den Menschen ist die Freigabe. Eine neue Version (Versionsnummer anheben, Abschnitt im `CHANGELOG.md`, Eintrag in den Neuigkeiten) nur auf Anweisung vorbereiten.
5. **Keine Secrets und keine internen Informationen.** Niemals Zugangsdaten, Zertifikate, Tokens, echte Hostnamen, Domains, Tenant-IDs, Firmen- oder Personennamen in Code, Tests, Beispieldaten, Doku, Commits oder Issues. Beispiele nur mit `example.com` und erfundenen, neutralen Daten. Konfiguration nur über Umgebungsvariablen bzw. Docker-Secrets.
6. **Nichts Destruktives ohne Rückfrage.** Kein `git push --force`, kein Löschen von Branches, Daten oder Migrationen ohne ausdrückliche Zustimmung.

## Grundlagen

- Fachliche Grundlage ist [`docs/spec.md`](docs/spec.md). Weicht eine Anforderung davon ab oder fehlt etwas: fragen und die Spec mit anpassen.
- Oberfläche und Texte auf Deutsch.
- Designrichtlinie: [`docs/design.md`](docs/design.md). Nur Komponenten aus `frontend/src/core/components` verwenden oder dort neu anlegen.

## Konventionen

- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `security:`), Beschreibung auf Deutsch.
- **Versionen:** SemVer, Einträge in `CHANGELOG.md` unter „Unveröffentlicht“ pflegen.
- **Neuigkeiten in der App:** `frontend/src/release-notes.ts` ist die Quelle der Seite „Neuigkeiten“. Dort steht nur, was man in der Anwendung bemerkt (neue Funktionen, geänderte Bedienung, behobene Fehler), in einfacher Sprache und ohne Fachbegriffe aus der Entwicklung. Änderungen nur am Repository (CI, Abhängigkeiten, Tests, Doku) kommen ausschließlich in `CHANGELOG.md`. Bei einer neuen Version: Version in `frontend/package.json`, `e2e/package.json`, `backend/pyproject.toml` und `backend/werkbank/__init__.py` anheben, den Abschnitt „Unveröffentlicht“ im `CHANGELOG.md` in die Versionsnummer mit Datum umbenennen und einen Eintrag in `release-notes.ts` anlegen.
- **Backend:** Python 3.12+, FastAPI, SQLAlchemy 2, Alembic, Pydantic. ruff und mypy müssen fehlerfrei sein.
- **Frontend:** React, Vite, TypeScript (strict). eslint und prettier müssen fehlerfrei sein.
- **Tests:** Jede Funktion mit Unit-Tests. Jeder Screen mit E2E-Test in `e2e/` (Playwright, Profile Desktop/Tablet/iPhone, axe-core).

## Pflichten bei jeder Änderung

- Rechte serverseitig prüfen (Rolle und Objekt), nicht nur in der Oberfläche ausblenden.
- Eingaben validieren, Ausgaben kodieren, keine HTML-Darstellung von Nutzertexten.
- Service Worker: niemals API-Antworten oder Anhänge cachen.
- Push- und Mail-Benachrichtigungen ohne fachliche Inhalte.
- Barrierefreiheit (WCAG 2.2 AA) und Designrichtlinie einhalten.
- Prüfen, ob die Änderung in der Anwendung zu bemerken ist. Wenn ja: Eintrag für die Seite „Neuigkeiten“ vorbereiten (siehe Konventionen).
- **Handbuch:** Bei jeder Änderung an der Anwendung prüfen, ob das Handbuch angepasst werden muss, und es im selben Branch mit anpassen. Das Ergebnis der Prüfung in der Rückmeldung nennen („Handbuch angepasst“ oder „keine Anpassung nötig“). Das Handbuch entsteht zu einem späteren Zeitpunkt; bis dahin entfällt die Anpassung, die Regel gilt ab dem ersten Stand des Handbuchs.
- Betroffene Nachweise in `docs/` aktualisieren (ASVS, WCAG, Datenschutz), wenn sich etwas ändert.

## Regelmäßige Prüfung

Auf Zuruf: „Prüfe auf XSS, Secrets, unnötige Dependencies und Service-Worker-Update-Probleme.“
Ergebnis als Liste mit Fundstelle, Bewertung und Vorschlag. Behebung erst nach Rückmeldung.
