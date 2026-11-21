# Arbeitsregeln für Claude

Diese Datei gilt für jede Arbeit von Claude (Claude Code, Claude im Chat) an diesem Repository.
Das Repository ist **öffentlich**. Diese Datei und alles andere im Repo enthält daher nur Informationen,
die jeder lesen darf: keine Hostnamen, IP-Adressen, Tenant-IDs, Zugangsdaten, Firmen- oder Personennamen.

## Immer gültige Regeln

1. **Pull Requests nur auf ausdrückliche Aufforderung.** Ohne klare Anweisung („erstelle einen PR“) wird kein Pull Request erstellt. Das gilt immer.
2. **Bei Unsicherheit fragen, nicht handeln.** Wenn etwas unklar ist, Informationen fehlen oder eine Entscheidung mehrere sinnvolle Möglichkeiten hat: nachfragen, statt eine Annahme zu treffen.
3. **Nie direkt auf `main` arbeiten.** Jede Änderung auf einem eigenen Branch (`feature/…`, `fix/…`, `docs/…`, `chore/…`, `security/…`).
4. **Keine Tags und Releases von Hand.** Tag und GitHub Release legt der Workflow `release.yml` an, sobald ein PR mit einer neuen Version in `main` gemergt wird. Das Mergen durch den Menschen ist die Freigabe.
5. **Keine Secrets und keine internen Informationen.** Niemals Zugangsdaten, Zertifikate, Tokens, echte Hostnamen, Domains, Tenant-IDs, Firmen- oder Personennamen in Code, Tests, Beispieldaten, Doku, Commits oder Issues. Beispiele nur mit `example.com` und erfundenen, neutralen Daten. Konfiguration nur über Umgebungsvariablen bzw. Docker-Secrets.
6. **Nichts Destruktives ohne Rückfrage.** Kein `git push --force`, kein Löschen von Branches, Daten oder Migrationen ohne ausdrückliche Zustimmung.

## Grundlagen

- Fachliche Grundlage ist [`docs/spec.md`](docs/spec.md). Weicht eine Anforderung davon ab oder fehlt etwas: fragen und die Spec mit anpassen.
- Oberfläche und Texte auf Deutsch.
- Designrichtlinie: [`docs/design.md`](docs/design.md). Gemeinsame Komponenten liegen in `frontend/src/components`, gemeinsame Gestaltung in `frontend/src/styles.css`; dort wiederverwenden oder neu anlegen, nicht je Seite nachbauen.

## Konventionen

- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `security:`), Beschreibung auf Deutsch.
- **Versionen:** SemVer. **Jeder PR, der die Anwendung ändert, hebt die Version an** und wird damit nach dem Mergen automatisch als Release veröffentlicht: neue Funktion oder geänderte Bedienung → Minor (`0.2.0` → `0.3.0`), nur Fehlerbehebung oder Sicherheitskorrektur → Patch (`0.2.0` → `0.2.1`). Major nur auf Anweisung. PRs, die nur das Repository betreffen (CI, Abhängigkeiten der Werkzeuge, Tests, Doku), heben die Version nicht an; ihre Einträge stehen unter „Unveröffentlicht“ und wandern in die nächste Version. Liegt `main` inzwischen auf derselben oder einer höheren Version, vor dem PR die nächste freie Version nehmen.
- **Bei jeder neuen Version:** Version in `frontend/package.json`, `e2e/package.json` (samt Lockfiles), `backend/pyproject.toml` und `backend/werkbank/__init__.py` anheben, danach `backend/uv.lock` neu erzeugen (`cd backend && uvx uv@0.13.8 lock`, sonst schlägt `uv lock --check` in der CI fehl); im `CHANGELOG.md` einen Abschnitt `## [X.Y.Z] – JJJJ-MM-TT` mit den Einträgen des PRs und allem aus „Unveröffentlicht“ anlegen; Eintrag in `frontend/src/release-notes.ts`.
- **Neuigkeiten in der App:** `frontend/src/release-notes.ts` ist die Quelle der Seite „Neuigkeiten“. Dort steht nur, was man in der Anwendung bemerkt (neue Funktionen, geänderte Bedienung, behobene Fehler), in einfacher Sprache und ohne Fachbegriffe aus der Entwicklung. Änderungen nur am Repository (CI, Abhängigkeiten, Tests, Doku) kommen ausschließlich in `CHANGELOG.md`.
- **Anrede:** In der Oberfläche, in den Neuigkeiten und im Handbuch immer „du“, auch für Betriebsrat und Geschäftsführung.
- **Backend:** Python 3.14+, FastAPI, SQLAlchemy 2, Alembic, Pydantic. ruff und mypy müssen fehlerfrei sein.
- **Frontend:** React, Vite, TypeScript (strict). eslint und prettier müssen fehlerfrei sein.
- **Frameworks und Pakete aktuell halten, wenn möglich:**
  - Neue Abhängigkeiten in der aktuellen stabilen Version einbinden (keine Alpha-, Beta- oder RC-Versionen). Wie bei Dependabot: Eine Version muss mindestens 7 Tage alt sein (Schutz vor kompromittierten Releases).
  - Vorher prüfen: Wird das Paket gepflegt? Passt die Lizenz zu MIT? Gibt es offene Sicherheitsmeldungen? Geht es auch ohne neues Paket? Wenige Abhängigkeiten sind besser als viele.
  - In Code die aktuellen Schnittstellen und Muster der Frameworks nutzen, keine als veraltet (deprecated) markierten, zum Beispiel SQLAlchemy 2.0-Stil, Pydantic v2, `Annotated` in FastAPI und aktuelle React-APIs.
  - Fällt bei der Arbeit an einem Bereich auf, dass ein genutztes Paket veraltet ist, das im PR nennen. Das Update kommt in einen eigenen PR (`chore/…`), nicht nebenbei in eine Funktion.
  - Major-Updates nur nach Rückfrage, mit Hinweis auf die Breaking Changes und was angepasst werden muss.
  - Spricht etwas gegen die aktuelle Version (Kompatibilität, bekannter Fehler, Sicherheit), die ältere Version behalten und den Grund im PR und als Kommentar an der Abhängigkeit festhalten.
- **Tests:** Jede Funktion mit Unit-Tests. Jeder Screen mit E2E-Test in `e2e/` (Playwright, Profile Desktop/Tablet/iPhone, axe-core).

## Pflichten bei jeder Änderung

- Rechte serverseitig prüfen (Rolle und Objekt), nicht nur in der Oberfläche ausblenden.
- Eingaben validieren, Ausgaben kodieren, keine HTML-Darstellung von Nutzertexten.
- Service Worker: niemals API-Antworten oder Anhänge cachen.
- Push- und Mail-Benachrichtigungen ohne fachliche Inhalte.
- Barrierefreiheit (WCAG 2.2 AA) und Designrichtlinie einhalten.
- Prüfen, ob die Änderung in der Anwendung zu bemerken ist. Wenn ja: Version anheben und Eintrag für die Seite „Neuigkeiten“ schreiben (siehe Konventionen).
- **Bestätigen:** Jede Aktion mit Folgen (löschen, verwerfen, buchen, abschließen, freigeben, abmelden anderer Geräte usw.) bekommt den Bestätigungsdialog (`components/ConfirmDialog.tsx`, Regeln in `docs/design.md`, Abschnitt „Bestätigen“), auch jede neue. Keine Rückfragen direkt in der Seite.
- **Info-Symbole:** Fachbegriffe, berechnete Werte (z. B. Ist, Verfügbar, Auslastung) und Felder mit Folgen (z. B. Soll-Wert, Kritikalität, Mitbestimmung, AVV) bekommen ein Info-Symbol „i“ mit einer kurzen Erklärung (höchstens zwei Sätze, einfache Sprache, „du“), die zum passenden Thema im Handbuch führt (Komponente `components/InfoTip.tsx`, Texte in `frontend/src/help/terms.ts`, dort auch die Hilfe je Seite). Nicht neben Selbsterklärendem. Bei jeder Änderung an der Anwendung prüfen, ob Info-Symbole neu dazukommen, angepasst oder entfernt werden müssen, und sie im selben Branch mitpflegen. Das Ergebnis der Prüfung in der Rückmeldung nennen („Info-Symbole angepasst“ oder „keine Anpassung nötig“).
- **Handbuch:** Das Handbuch steht in der Anwendung unter „Handbuch“; die Inhalte liegen in `frontend/src/handbook/content.ts` (Bereiche, Teile und je Thema eine Seite, je Rolle, nur Text). Bei jeder Änderung an der Anwendung prüfen, ob das Handbuch angepasst werden muss, und es im selben Branch mit anpassen. Das Ergebnis der Prüfung in der Rückmeldung nennen („Handbuch angepasst“ oder „keine Anpassung nötig“). Sprache wie in den Neuigkeiten: einfach, „du“, keine Begriffe aus der Entwicklung, keine internen Namen.
- Betroffene Nachweise in `docs/` aktualisieren (ASVS, WCAG, Datenschutz), wenn sich etwas ändert.

## Regelmäßige Prüfung

Auf Zuruf: „Prüfe auf XSS, Secrets, unnötige Dependencies und Service-Worker-Update-Probleme.“
Ergebnis als Liste mit Fundstelle, Bewertung und Vorschlag. Behebung erst nach Rückmeldung.
