# Designrichtlinie

Ziel: Jeder Screen sieht gleich aufgebaut aus und wird gleich bedient. Visuelle Referenz ist der klickbare Entwurf „Werkbank – Oberfläche“.

## 1. Seitenaufbau

```
┌──────────────────────────────────────────────────────┐
│ Kopfzeile: Logo · Suche · Aufgaben · Person/Rolle    │
├────────────┬─────────────────────────────────────────┤
│ Navigation │ Modul-Label (klein, Großbuchstaben)     │
│ (gruppiert │ Titel (H1)                              │
│ nach Modul)│ Untertitel (ein Satz)                   │
│            │ Filter / Reiter                         │
│            │ Inhalt                                  │
└────────────┴─────────────────────────────────────────┘
```

- Navigation links. Unter 768 px als Menü über einen Button in der Kopfzeile.
- Gruppen: Start · M365-Konfiguration · Evergreen · Allgemein · Verwaltung. Nur Gruppen mit Berechtigung werden angezeigt.
- Maximale Inhaltsbreite 1200 px, Abstand zum Rand 24 px (mobil 16 px).

## 2. Liste und Detail

- Desktop: Liste links (oder Tabelle oben), Detail rechts.
- Tablet und Handy: Liste, Detail als eigene Ansicht mit „Zurück“.
- Ausgewähltes Element sichtbar markiert (Rahmen bzw. Hintergrund **und** `aria-current`).

## 3. Buttons und Aktionen

| Art | Aussehen | Verwendung |
|---|---|---|
| Hauptaktion | gefüllt, Primärfarbe | genau eine pro Bereich |
| Nebenaktion | weiß, Rahmen | weitere Aktionen |
| Gefährliche Aktion | weiß, Rahmen, roter Text | ablehnen, zurückweisen, löschen. Nie als Hauptaktion |
| Textlink-Button | ohne Rahmen | Navigation innerhalb der Seite |

- Reihenfolge: Hauptaktion zuerst (links bzw. oben), dann Nebenaktionen, gefährliche Aktionen zuletzt.
- Deaktivierte Buttons zeigen darunter, **warum** sie deaktiviert sind.
- Mindestgröße 44 × 44 px.

## 4. Status-Badges

Einheitlich für die ganze App, immer mit Text (nie nur Farbe):

| Bedeutung | Beispiel | Farbe |
|---|---|---|
| Handlung nötig | Offen, Wartet auf mich | Orange |
| Erledigt / positiv | Gewollt, Abgeschlossen, Zustimmung | Grün |
| Negativ / Abweichung | Ungewollt, Abgelehnt, weicht ab | Rot |
| Information / Wartend | Beim Betriebsrat, Geplant | Blau |
| Neutral | Nicht pflichtig, Idee | Grau |
| KI-Vorschlag | KI-generiert, ungeprüft | Violett |

## 5. Wiederkehrende Elemente

Diese Elemente gibt es genau einmal als Komponente in `frontend/src/core/components` und überall gleich:
Kopfzeile, Navigation, Seitentitel, Filter-Chips, Tabelle, Listeneintrag, Detailbereich, Status-Badge, Schrittleiste (Workflow), Protokoll, Kommentarfeld mit Regelhinweis, Vorher/Nachher-Ansicht, Kachel, Hinweisbox (Info/Warnung/Fehler), leerer Zustand, Ladezustand, Fehlerseite.

## 6. Farben und Schrift

- Schrift: Inter (Text), JetBrains Mono (Pfade, Werte, Befehle). Beide liegen in `frontend/src/fonts/` und werden von der Werkbank selbst ausgeliefert.
- Kopfzeile dunkel (`#14213D`), Akzent Orange (`#F2A33A`), Primärfarbe Blau (`#1F57C3`), Hintergrund `#F5F6F8`.
- Kontraste mindestens 4,5:1 für Text, 3:1 für Bedienelemente und große Schrift.
- Endgültige Werte als Design-Tokens in `frontend/src/core/tokens`.

## 7. Texte

- Deutsch. Gegenüber Nutzern: „du“ in IT-Bereichen, „Sie“ in Ansichten für Betriebsrat und Geschäftsführung. **[OFFEN]** einheitlich festlegen.
- Buttons beschreiben die Handlung („Als gewollt markieren“, nicht „OK“).
- Fehlermeldungen sagen, was passiert ist und was man tun kann.
