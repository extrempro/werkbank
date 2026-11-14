# Barrierefreiheit – WCAG 2.2 Stufe AA

Automatisch: axe-core in jedem E2E-Test (alle Screens, Profile Desktop/Tablet/iPhone). Ziel: keine Verstöße der Stufen „serious“ und „critical“.
Automatische Tests finden nur einen Teil der Probleme. Diese Checkliste wird bei jedem neuen Screen manuell geprüft.

Status: ✅ erfüllt · ⚠️ teilweise · ❌ offen · n/a nicht anwendbar

| Bereich | Prüfpunkt | Status | Notiz |
|---|---|---|---|
| Tastatur | Alle Funktionen per Tastatur bedienbar, keine Tastaturfallen | ❌ | |
| Tastatur | Fokusreihenfolge logisch | ❌ | |
| Fokus | Fokus jederzeit sichtbar und nicht verdeckt (2.4.11) | ❌ | |
| Ziele | Klickziele mind. 24 × 24 px (2.5.8), Bedienelemente 44 px | ❌ | |
| Ziehen | Keine Funktion nur per Ziehen (2.5.7) | ❌ | |
| Kontrast | Text 4,5:1, große Schrift und Bedienelemente 3:1 | ❌ | |
| Farbe | Keine Information nur über Farbe | ❌ | |
| Struktur | Überschriften-Hierarchie, Landmarks (header, nav, main) | ❌ | |
| Formulare | Sichtbare Labels, Fehlermeldungen mit Hinweis zur Behebung | ❌ | |
| Formulare | Keine erneute Eingabe bereits gemachter Angaben (3.3.7) | ❌ | |
| Anmeldung | Barrierefreie Authentifizierung (3.3.8), über Entra | ❌ | |
| Hilfe | Hilfe an gleicher Stelle auf allen Seiten (3.2.6) | ❌ | |
| Zoom | Bedienbar bei 200 % Zoom und 320 px Breite (Reflow) | ❌ | |
| Bewegung | Keine automatisch bewegten Inhalte, `prefers-reduced-motion` beachtet | ❌ | |
| Screenreader | Getestet mit VoiceOver (iOS/macOS) und NVDA (Windows) | ❌ | |
| Status | Statusmeldungen werden angesagt (`aria-live`) | ❌ | |
| Sprache | `lang="de"` gesetzt | ❌ | |
