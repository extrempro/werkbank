# End-to-End-Tests

Ab Phase 1. Werkzeug: **Playwright** mit **axe-core** und **Lighthouse CI**.

Geplant:

- **Geräteprofile:** Desktop (1440 px), Tablet (iPad), Handy (iPhone)
- **Rollen:** Ein Test-Login je Rolle (Admin, Config.Reviewer, Config.Reader, Evergreen.Team, Evergreen.Betriebsrat, Evergreen.GF). Er ist nur in der Testumgebung aktiv und in Produktion technisch ausgeschlossen.
- **Barrierefreiheit:** axe-core-Prüfung auf jedem Screen
- **Service Worker:**
  - Offline-Seite erscheint ohne Netz
  - keine API-Antworten im Cache
  - Update-Hinweis bei neuer Version
- **Lighthouse:** Mindestwerte siehe `docs/spec.md`, Kapitel 13
