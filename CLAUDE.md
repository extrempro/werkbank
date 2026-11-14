# Arbeitsregeln für Claude

Diese Datei gilt für jede Arbeit von Claude (Claude Code, Claude im Chat) an diesem Repository.
Das Repository ist **öffentlich**. Diese Datei und alles andere im Repo enthält daher nur Informationen,
die jeder lesen darf: keine Hostnamen, IP-Adressen, Tenant-IDs, Zugangsdaten, Firmen- oder Personennamen.

## Immer gültige Regeln

1. **Pull Requests nur auf ausdrückliche Aufforderung.** Ohne klare Anweisung („erstelle einen PR“) wird kein Pull Request erstellt. Das gilt immer.
2. **Bei Unsicherheit fragen, nicht handeln.** Wenn etwas unklar ist, Informationen fehlen oder eine Entscheidung mehrere sinnvolle Möglichkeiten hat: nachfragen, statt eine Annahme zu treffen.
3. **Nie direkt auf `main` arbeiten.** Jede Änderung auf einem eigenen Branch (`feature/…`, `fix/…`, `docs/…`, `chore/…`, `security/…`).
4. **Keine Tags und Releases ohne Aufforderung.** Release Notes vorbereiten ist erlaubt, Tags setzen nur auf Anweisung.
5. **Keine Secrets und keine internen Informationen.** Niemals Zugangsdaten, Zertifikate, Tokens, echte Hostnamen, Domains, Tenant-IDs, Firmen- oder Personennamen in Code, Tests, Beispieldaten, Doku, Commits oder Issues. Beispiele nur mit `example.com` und erfundenen, neutralen Daten. Konfiguration nur über Umgebungsvariablen bzw. Docker-Secrets.
6. **Nichts Destruktives ohne Rückfrage.** Kein `git push --force`, kein Löschen von Branches, Daten oder Migrationen ohne ausdrückliche Zustimmung.

## Grundlagen

- Fachliche Grundlage ist [`docs/spec.md`](docs/spec.md). Weicht eine Anforderung davon ab oder fehlt etwas: fragen und die Spec mit anpassen.
- Oberfläche und Texte auf Deutsch.
- Designrichtlinie: [`docs/design.md`](docs/design.md). Nur Komponenten aus `frontend/src/core/components` verwenden oder dort neu anlegen.

## Konventionen

- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `security:`), Beschreibung auf Deutsch.
- **Versionen:** SemVer, Einträge in `CHANGELOG.md` unter „Unveröffentlicht“ pflegen.
- **Backend:** Python 3.12+, FastAPI, SQLAlchemy 2, Alembic, Pydantic. ruff und mypy müssen fehlerfrei sein.
- **Frontend:** React, Vite, TypeScript (strict). eslint und prettier müssen fehlerfrei sein.
- **Tests:** Jede Funktion mit Unit-Tests. Jeder Screen mit E2E-Test in `e2e/` (Playwright, Profile Desktop/Tablet/iPhone, axe-core).

## Pflichten bei jeder Änderung

- Rechte serverseitig prüfen (Rolle und Objekt), nicht nur in der Oberfläche ausblenden.
- Eingaben validieren, Ausgaben kodieren, keine HTML-Darstellung von Nutzertexten.
- Service Worker: niemals API-Antworten oder Anhänge cachen.
- Push- und Mail-Benachrichtigungen ohne fachliche Inhalte.
- Barrierefreiheit (WCAG 2.2 AA) und Designrichtlinie einhalten.
- Betroffene Nachweise in `docs/` aktualisieren (ASVS, WCAG, Datenschutz), wenn sich etwas ändert.

## Regelmäßige Prüfung

Auf Zuruf: „Prüfe auf XSS, Secrets, unnötige Dependencies und Service-Worker-Update-Probleme.“
Ergebnis als Liste mit Fundstelle, Bewertung und Vorschlag. Behebung erst nach Rückmeldung.
