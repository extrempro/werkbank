# Barrierefreiheit – WCAG 2.2 Stufe AA

Automatisch: axe-core in jedem E2E-Test (alle Screens, Profile Desktop/Tablet/iPhone). Ziel: keine Verstöße der Stufen „serious“ und „critical“.
Automatische Tests finden nur einen Teil der Probleme. Diese Checkliste wird bei jedem neuen Screen manuell geprüft.

> **Stand:** Ende Phase 3. Die Seiten von Evergreen (Liste, Vorgang mit Entscheidung, geplante Umsetzung) laufen im Browsertest mit Inhalt durch axe-core, auf Desktop, Tablet und Handy. ✅ heißt: durch Umsetzung und automatische Tests belegt. ⚠️ heißt: umgesetzt, aber die manuelle Prüfung (Tastatur, Zoom, Screenreader, echte Geräte) steht noch aus. Sie ist mit der ersten Inbetriebnahme vorgesehen.

Status: ✅ erfüllt · ⚠️ teilweise · ❌ offen · n/a nicht anwendbar

| Bereich | Prüfpunkt | Status | Notiz |
|---|---|---|---|
| Tastatur | Alle Funktionen per Tastatur bedienbar, keine Tastaturfallen | ⚠️ | Nur native Bedienelemente (Links, Buttons, Formularfelder); scrollbare Tabellen sind fokussierbar. Manuelle Prüfung offen |
| Tastatur | Fokusreihenfolge logisch | ⚠️ | Reihenfolge folgt dem Dokument; manuelle Prüfung offen |
| Fokus | Fokus jederzeit sichtbar und nicht verdeckt (2.4.11) | ⚠️ | Einheitlicher Fokusrahmen in `styles.css`; manuelle Prüfung offen |
| Ziele | Klickziele mind. 24 × 24 px (2.5.8), Bedienelemente 44 px | ⚠️ | Buttons und Felder 44 px, Kontrollkästchen 24 px; Links in Tabellen manuell zu prüfen |
| Ziehen | Keine Funktion nur per Ziehen (2.5.7) | ✅ | Es gibt keine Zieh-Bedienung |
| Kontrast | Text 4,5:1, große Schrift und Bedienelemente 3:1 | ✅ | axe-core in den E2E-Tests ohne Verstöße (leere Zustände); gefüllte Tabellen mit echten Daten nachprüfen |
| Farbe | Keine Information nur über Farbe | ✅ | Zustände stehen als Text (Bewertung, „Entfernt“, „Weicht vom Soll-Wert ab“) |
| Struktur | Überschriften-Hierarchie, Landmarks (header, nav, main) | ✅ | axe-core; Sprunglink zum Inhalt |
| Formulare | Sichtbare Labels, Fehlermeldungen mit Hinweis zur Behebung | ✅ | Alle Felder mit Label; Fehlermeldungen als `role="alert"` mit Hinweis |
| Formulare | Keine erneute Eingabe bereits gemachter Angaben (3.3.7) | ✅ | Formulare sind mit den gespeicherten Werten vorbelegt |
| Anmeldung | Barrierefreie Authentifizierung (3.3.8), über Entra | ✅ | Anmeldung ausschließlich über Entra |
| Hilfe | Hilfe an gleicher Stelle auf allen Seiten (3.2.6) | ❌ | |
| Zoom | Bedienbar bei 200 % Zoom und 320 px Breite (Reflow) | ❌ | |
| Bewegung | Keine automatisch bewegten Inhalte, `prefers-reduced-motion` beachtet | ✅ | Keine Animationen von Inhalten; `prefers-reduced-motion` in `styles.css` |
| Screenreader | Getestet mit VoiceOver (iOS/macOS) und NVDA (Windows) | ❌ | |
| Status | Statusmeldungen werden angesagt (`aria-live`) | ⚠️ | `role="status"` und `role="alert"` gesetzt; mit Screenreader noch nicht geprüft |
| Sprache | `lang="de"` gesetzt | ✅ | `index.html` |
