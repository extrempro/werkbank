# Gebrauchstauglichkeit – ISO 9241

Prüfung bei jedem größeren Feature und vor jedem Minor-Release. Grundlage: ISO 9241-110 (Interaktionsprinzipien) und ISO 9241-11 (Effektivität, Effizienz, Zufriedenstellung).

Status: ✅ erfüllt · ⚠️ teilweise · ❌ offen

## ISO 9241-110 – Interaktionsprinzipien

| Prinzip | Prüffrage | Status | Notiz |
|---|---|---|---|
| Aufgabenangemessenheit | Kann jede Rolle ihre Aufgabe ohne unnötige Schritte erledigen? Führt „Meine Aufgaben“ direkt zum Ziel? | ❌ | |
| Selbstbeschreibungsfähigkeit | Ist jederzeit klar, wo man ist, was der Status bedeutet und was als Nächstes passiert? | ❌ | |
| Erwartungskonformität | Sehen gleiche Dinge gleich aus und verhalten sich gleich (siehe `design.md`)? | ❌ | |
| Erlernbarkeit | Kommen BR und GF ohne Schulung zurecht? Gibt es Hinweise beim ersten Mal? | ❌ | |
| Steuerbarkeit | Kann man abbrechen, zurückgehen, Bewertungen zurücksetzen? | ❌ | |
| Robustheit gegen Benutzungsfehler | Werden Fehler verhindert (deaktivierte Buttons mit Begründung, Bestätigung bei Tragweite)? Sind Fehlermeldungen hilfreich? | ❌ | |
| Benutzerbindung | Ist die Oberfläche ruhig, klar und angenehm? Werden Rückmeldungen gegeben? | ❌ | |

## ISO 9241-11 – Messung (vor Version 1.0)

| Kennzahl | Ziel | Ergebnis |
|---|---|---|
| Effektivität: BR erfasst eine Stellungnahme ohne Hilfe | 100 % von 3 Testpersonen | |
| Effizienz: Änderung bewerten (vom Öffnen bis gespeichert) | unter 60 Sekunden | |
| Zufriedenstellung: kurzer Fragebogen (z. B. SUS) | Wert ≥ 75 | |
