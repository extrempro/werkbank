# Designrichtlinie

Ziel: Jeder Screen sieht gleich aufgebaut aus und wird gleich bedient. Visuelle Referenz ist der klickbare Entwurf „Werkbank – Oberfläche“.

## 1. Seitenaufbau

```
┌───────────────────────────────────────────────────────────────┐
│ Kopfzeile: Logo · Suchfeld (Strg+K) · Glocke · Aufgaben · Konto│
├──────┬──────────────┬─────────────────────────────────────────┤
│ Be-  │ Seitenmenü   │ Modul-Label (klein, Großbuchstaben)     │
│ reich│ Bereichsname │ Titel (H1) ☆                            │
│ (Sym-│ ▾ Gruppe     │ Untertitel (ein Satz)                   │
│ bole)│   Seite   ☆  │ Filter / Reiter                         │
│      │ Menü einkl.  │ Inhalt                                  │
└──────┴──────────────┴─────────────────────────────────────────┘
```

- **Bereichsleiste** (76 px, ganz links): je Bereich ein Symbol mit Kurznamen; voller Name als Tooltip und Name für Screenreader. Abschnitte durch Linien getrennt: Start | Microsoft 365, Evergreen | IT-Monitoring, IT-Bestand | IT-Budget, IT-Projekte | IT-Tools; am Fuß Verwaltung (nur Admin) und Handbuch. Ein Punkt am Symbol zeigt offene Aufgaben im Bereich (aus den Zählern von „Meine Aufgaben“). Der aktive Bereich ist hinterlegt und hat `aria-current`.
- **Seitenmenü** (256 px, wächst mit der Schriftgröße im Menü): oben der Name des Bereichs, darunter die Seiten in Gruppen. Gruppen mit Überschrift klappen auf und zu (Pfeil, `aria-expanded`); der Zustand gilt je Browser. Eine Gruppe kann anfangs eingeklappt sein (z. B. „Verwaltung“ im IT-Budget und IT-Bestand). Jede Seite hat ein Symbol aus `components/Icon.tsx`. Abstände (kompakt/normal/weiträumig) und Schriftgröße aus dem Konto gelten hier.
- „Menü einklappen“ unten im Seitenmenü lässt nur die Bereichsleiste stehen (`werkbank-navigation` im Browser). Ein Klick auf einen Bereich öffnet das Menü wieder.
- **Anheften:** Stern neben jeder Seite im Seitenmenü (sichtbar bei Hover und Tastaturfokus, angeheftet immer) und hinter dem Seitentitel. Der Start-Bereich zeigt „Angeheftet“ (mit Chip des Bereichs) und „Zuletzt besucht“ (letzte fünf), die Startseite dieselben Listen.
- **Kontomenü** oben rechts (Initialen oder Bild): Konto, Release Notes, Hell/Dunkel/Automatisch, „Zuletzt besucht leeren“, Abmelden. Menü-Muster mit Pfeiltasten, Pos1/Ende; Esc schließt und gibt den Fokus zurück.
- **Schnellsuche:** Das Suchfeld in der Kopfzeile und Strg+K/⌘K öffnen einen modalen Dialog, der Seiten nach Name, Gruppe und Bereich findet (nur mit Recht). Ohne Eingabe: „Zuletzt besucht“. Pfeiltasten wählen, Enter öffnet, Esc schließt; Fokus bleibt im Dialog und kehrt danach zurück. „In allen Einträgen suchen“ führt zur Seite „Suche“.
- **Handy (bis 760 px):** Bereichsleiste und Seitenmenü entfallen. Unten eine feste Leiste mit Start, Suche, Aufgaben und Menü (`safe-area-inset-bottom`). „Menü“ öffnet ein Blatt von unten (bis 86 % Höhe): erst die Seiten des aktuellen Bereichs, über „‹ Alle Bereiche“ alle Bereiche mit Symbol, vollem Namen und Punkt. Keine Sterne zum Anklicken, angeheftete Seiten nur mit kleinem Stern markiert. Die Schnellsuche füllt den Bildschirm und hat „Abbrechen“. Die Kopfzeile ist schmaler (56 px) und haftet oben; alle Tippflächen mindestens 44 px.
- Ein neuer Bereich braucht nur einen Eintrag in `areasFor` (`frontend/src/navigation.ts`): Symbol, Kurzname, Abschnitt der Leiste, Gruppen. Die erlaubten Pfade für Anheften und „Zuletzt besucht“ stehen zusätzlich auf dem Server (`backend/werkbank/core/navigation.py`).
- Unten rechts erscheint nach etwas Scrollen der Knopf „Nach oben“.
- Maximale Inhaltsbreite 1180 px (Seiten mit Liste und Detail nebeneinander bis 1400 px), Abstand zum Rand 24 px (mobil 16 px).
- **Tabelle mit Ansicht rechts** (Vorgänge im IT-Bestand, Einträge in Evergreen; Trenner als gemeinsame Komponente `components/SplitHandle.tsx`): kompakter Kopf in einer Zeile, Suche und Filter in einer Zeile darüber, Tabelle über die ganze Breite; die ganze Zeile ist anklickbar, der Titel ist der Verweis. Gewählt: Tabelle und Ansicht nebeneinander (Start 54 %), Breite am Trenner einstellbar (30–75 %, im Browser gemerkt), schmale Tabelle nur Nr., Titel und Status, Ansicht mit „×“. Unter 1024 px eine Zeile je Eintrag (Nummer, Art, Datum klein über dem Titel), Status-Chips zum Wischen, gewählt nur die Ansicht mit „‹ Zur Liste“.
- **Liste und Ansicht** (z. B. Verleih): Suche, Status und weitere Filter oben in der Liste; die Liste hat eine feste Höhe bis zum unteren Rand und scrollt für sich, die Ansicht daneben bleibt stehen. Unter 1024 px erst nur die Liste, gewählt nur die Ansicht mit „‹ Zur Liste“.
- **Auswahl mit Suche** statt langer Auswahllisten (Stellen, Arbeitsplätze, Räume, Geräte): Combobox, die auf dem Server sucht (höchstens 20 Treffer, Hinweis bei mehr), Pfeiltasten und Enter; gewählt steht der Eintrag mit „Ändern“.
- Symbole nur aus `components/Icon.tsx` (24 × 24, Linie, Strichstärke 2), nie direkt im Markup.

## 2. Liste und Detail

- Desktop: Liste links (oder Tabelle oben), Detail rechts.
- Tablet und Handy: Das Detail steht unter der Liste bzw. auf einer eigenen Seite mit „Zurück“.
- Solange nichts gewählt ist, zeigt der Detailbereich auf breiten Bildschirmen einen schraffierten Platzhalter mit Hinweis (`components/Placeholder`).
- Ausgewähltes Element sichtbar markiert (Rahmen bzw. Hintergrund **und** `aria-current`).
- Ausnahme Gerätezuordnung: Das Detail öffnet als modale Seitenleiste von rechts (am Handy volle Breite), der Scan als Dialog in drei Schritten (am Handy bildschirmfüllend), weil beide Abläufe vor allem am Handy neben dem Gerät laufen. Am Handy Karten statt Tabelle; der Fortschritt steht als vier Striche neben dem Status-Badge.

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
| Information / Wartend | Neu, Geplant | Blau |
| Neutral | Nicht pflichtig, Idee | Grau |
| KI-Vorschlag | KI-generiert, ungeprüft | Violett |

## 5. Wiederkehrende Elemente

Diese Elemente gibt es genau einmal und überall gleich. Gemeinsame Komponenten liegen in `frontend/src/components`, gemeinsame Bausteine der Gestaltung als Klassen in `frontend/src/styles.css` (z. B. `panel`, `rows`, `pill`, `chip`, `hint-box`, `split`):
Kopfzeile, Navigation, Seitentitel, Filter-Chips, Tabelle, Listeneintrag, Detailbereich, Status-Badge, Schrittleiste (Workflow), Protokoll, Kommentarfeld mit Regelhinweis, Vorher/Nachher-Ansicht, Kachel, Hinweisbox (Info/Warnung/Fehler), leerer Zustand, Ladezustand, Fehlerseite.

## 6. Farben und Schrift

- Schrift: Inter (Text), JetBrains Mono (Pfade, Werte, Befehle). Beide liegen in `frontend/src/fonts/` und werden von der Werkbank selbst ausgeliefert.
- Kopfzeile dunkel (`#14213D`), Akzent Orange (`#F2A33A`), Primärfarbe Blau (`#1F57C3`), Hintergrund `#F5F6F8`.
- Heller und dunkler Modus: Farben stehen ausschließlich als Variablen in `frontend/src/styles.css` (`:root` und `:root[data-theme="dunkel"]`). Neue Farben immer in beiden Blöcken anlegen, nie direkt in einer Regel.
- Kontraste mindestens 4,5:1 für Text, 3:1 für Bedienelemente und große Schrift.
- **Branding:** In der Verwaltung lassen sich Name, Akzentfarbe, Logos (für hellen und dunklen Hintergrund) und Favicon festlegen. Die Kopfzeile ist in beiden Darstellungen dunkel und zeigt deshalb das Logo für dunklen Hintergrund. Aus der Akzentfarbe leitet `frontend/src/branding.ts` Primärfarbe, Links und Auswahl ab und passt sie je Darstellung an, bis die Kontraste oben eingehalten sind. Text in der Kopfzeile nutzt `--farbe-auf-kopf`, Text auf der Primärfarbe `--farbe-auf-primaer`.
- Die Werte stehen als CSS-Variablen am Anfang von `frontend/src/styles.css`.

## 7. Texte

- Deutsch. Anrede überall „du“, auch in den Ansichten für Betriebsrat und Geschäftsführung (entschieden).
- Buttons beschreiben die Handlung („Als gewollt markieren“, nicht „OK“).
- Fehlermeldungen sagen, was passiert ist und was man tun kann.
