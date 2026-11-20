# Barrierefreiheit – WCAG 2.2 Stufe AA

Automatisch: axe-core in jedem E2E-Test (alle Screens, Profile Desktop/Tablet/iPhone). Ziel: keine Verstöße der Stufen „serious“ und „critical“.
Automatische Tests finden nur einen Teil der Probleme. Diese Checkliste wird bei jedem neuen Screen manuell geprüft.

> **Stand:** Version 0.5. Alle Seiten laufen im Browsertest durch axe-core, auf Desktop, Tablet und Handy; Startseite, M365-Übersicht, Änderungen, Einstellungen, Evergreen, Audit-Log und Konto zusätzlich im dunklen Modus. Die Seiten von Evergreen werden dabei mit Inhalt geprüft, die der M365-Konfiguration im leeren Zustand. ✅ heißt: durch Umsetzung und automatische Tests belegt. ⚠️ heißt: umgesetzt, aber die manuelle Prüfung (Tastatur, Zoom, Screenreader, echte Geräte) steht aus.

Status: ✅ erfüllt · ⚠️ teilweise · ❌ offen · n/a nicht anwendbar

| Bereich | Prüfpunkt | Status | Notiz |
|---|---|---|---|
| Tastatur | Alle Funktionen per Tastatur bedienbar, keine Tastaturfallen | ⚠️ | Nur native Bedienelemente (Links, Buttons, Formularfelder); scrollbare Tabellen sind fokussierbar. Manuelle Prüfung offen |
| Tastatur | Fokusreihenfolge logisch | ⚠️ | Reihenfolge folgt dem Dokument; manuelle Prüfung offen |
| Fokus | Fokus jederzeit sichtbar und nicht verdeckt (2.4.11) | ⚠️ | Einheitlicher Fokusrahmen in `styles.css`; manuelle Prüfung offen |
| Ziele | Klickziele mind. 24 × 24 px (2.5.8), Bedienelemente 44 px | ⚠️ | Buttons und Felder 44 px, Kontrollkästchen 24 px; Links in Tabellen manuell zu prüfen |
| Auswahl mit Suche | Stellen, Arbeitsplätze, Räume und Geräte im IT-Bestand | ⚠️ | Combobox mit Listbox und `aria-activedescendant`, Pfeiltasten, Enter, Escape; Trefferzahl als `role="status"`; Pflichtfeld im Label, Fehler mit `aria-invalid` und `aria-describedby`; gewählter Eintrag mit „Ändern“ (Name nennt den Eintrag). Standortbaum: Pfeil-Schaltflächen mit `aria-expanded` und Namen („… aufklappen“), gewählte Ebene mit `aria-current`. Liste und Ansicht: schmal mit „Zur Liste“. Vorgänge als Tabelle mit `aria-label`, `th scope="col"`, Titel als Verweis (gewählt `aria-current`), Zeilenklick nur zusätzlich für die Maus; „×“ mit Namen „Ansicht schließen“; Trenner als `role="separator"` mit `aria-valuenow`, per Tastatur (Pfeile, Pos1, Ende) bedienbar; Suchfeld mit verstecktem Label. axe-core in den E2E-Tests; Screenreader-Prüfung offen |
| Navigation | Bereichsleiste, Seitenmenü, Kontomenü, Schnellsuche, Menü am Handy | ⚠️ | Bereichsleiste: voller Name als `aria-label` und Tooltip, Punkt für offene Aufgaben im Namen, aktiver Bereich mit `aria-current`. Gruppen im Seitenmenü mit `aria-expanded`/`aria-controls`. Sterne als Umschalter (`aria-pressed`), sichtbar auch bei Tastaturfokus; der Stern am Seitentitel steht hinter der Überschrift und ändert ihren Namen nicht. Kontomenü nach dem Menü-Muster (`aria-haspopup`, Pfeiltasten, Pos1/Ende, Esc gibt den Fokus zurück). Schnellsuche und Menü am Handy als modale Dialoge (`aria-modal`, Fokus bleibt im Dialog, Esc schließt, Fokus kehrt zurück); Treffer als Combobox mit Listbox und `aria-activedescendant`. Tippflächen am Handy mindestens 44 px. axe-core in den E2E-Tests (Desktop, Tablet, iPhone) mit offenem Menü und Dialog; Screenreader-Prüfung offen |
| Ziehen | Keine Funktion nur per Ziehen (2.5.7) | ✅ | Es gibt keine Zieh-Bedienung |
| Kontrast | Text 4,5:1, große Schrift und Bedienelemente 3:1 | ✅ | axe-core in den E2E-Tests ohne Verstöße, im hellen und im dunklen Modus; gefüllte Seiten der M365-Konfiguration mit echten Daten nachprüfen; eigene Akzentfarbe: Kontraste rechnerisch abgesichert (`branding.test.ts`) und per axe in der Verwaltung geprüft |
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
