# End-to-End-Tests

Werkzeuge: **Playwright** mit **axe-core** (Barrierefreiheit nach WCAG 2.2 AA) und **Lighthouse CI**.

| Test | Inhalt |
|---|---|
| `tests/login.spec.ts` | Login-Seite, Navigation je Rolle (Admin, Betriebsrat), Abmelden, API ohne Anmeldung gesperrt |
| `tests/pwa.spec.ts` | Manifest, Offline-Seite, keine API-Daten im Cache des Service Workers |
| `tests/mobile.spec.ts` | Menü-Button und Navigation auf dem Handy |
| `tests/verwaltung.spec.ts` | Audit-Log (Anzeige, Filter, Export-Link), Rollenübersicht, Sperre für andere Rollen |

- **Geräteprofile:** Desktop, Tablet (iPad), Handy (iPhone). Tablet und Handy laufen vorerst als Chromium-Emulation. Echte WebKit-Tests folgen, sobald die Testumgebung HTTPS hat.
- **Anmeldung:** Test-Login, nur aktiv bei `ENVIRONMENT=test` und `ENABLE_TEST_LOGIN=true`
- **Lighthouse:** Mindestwerte in `lighthouserc.json` (Barrierefreiheit und Best Practices ≥ 95, Performance ≥ 85 als Warnung)

## Lokal ausführen

```bash
# im Wurzelverzeichnis: App im Testmodus starten (siehe .github/workflows/ci.yml, Job E2E)
cd e2e
npm ci
npx playwright install chromium
npx playwright test
npx lhci autorun
```

## Abhängigkeiten

`package.json` erzwingt über `overrides` sichere Versionen von Unterpaketen, für die die Werkzeuge selbst noch keine Aktualisierung liefern:

| Paket | Grund |
|---|---|
| `basic-ftp` ≥ 6.2.6 | Lücken mit hoher Schwere (Denial of Service) in älteren Versionen, eingebunden über Lighthouse CI → proxy-agent → get-uri |

Die CI prüft die E2E-Werkzeuge mit `npm audit --audit-level=high`.
