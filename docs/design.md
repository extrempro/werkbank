# Designrichtlinie

Ziel: Jeder Screen sieht gleich aufgebaut aus und wird gleich bedient. Maßstab sind die Regeln in diesem Dokument und die bestehenden Seiten.

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
- **Tabelle mit Ansicht rechts** (Vorgänge im IT-Bestand, im IT-Budget Budgetposten, Rechnungen und Verträge; Trenner als gemeinsame Komponente `components/SplitHandle.tsx`): kompakter Kopf in einer Zeile, Suche und Filter in einer Zeile darüber, Tabelle über die ganze Breite; die ganze Zeile ist anklickbar, der Titel ist der Verweis. Gewählt: Tabelle und Ansicht nebeneinander (Start 54 %), Breite am Trenner einstellbar (30–75 %, im Browser gemerkt), schmale Tabelle nur Nr., Titel und Status, Ansicht mit „×“. Masken zum Anlegen und Bearbeiten stehen in derselben Ansicht. Unter 1024 px eine Karte je Eintrag (Nummer, Art, Datum klein über dem Titel, rechts Status und Betrag), gewählt nur die Ansicht mit „‹ Zur Liste“.
- **Filter über Listen** (gemeinsame Komponente `components/FilterBar.tsx`): Am Computer und Tablet Suche und weitere Filter in einer Zeile, jedes Feld mit sichtbarer Beschriftung, darunter der Status als Chips mit Anzahl („Offen · 3“), dazu „Filter aufheben“. Am Handy (bis 760 px) die Suche über die ganze Breite, darunter der Status als Auswahl und „Weitere Filter“ (mit Zahl der gesetzten Filter); die weiteren Filter öffnen in einem Blatt von unten mit „Zurücksetzen“ und „Fertig“. Umschalter zwischen Ansichten (z. B. Liste und Waben) sind keine Filter und bleiben Chips.
- **Filter-Chips nie seitlich scrollen:** Eine Reihe aus Filter- oder Status-Chips muss ohne waagerechtes Scrollen ganz sichtbar sein. Passt sie nicht in eine Zeile, etwa in einer schmalen Spalte neben dem Grundriss, in einer Liste mit fester Breite oder am Handy, wird der Filter zur Auswahl (`<select>` mit sichtbarer Beschriftung, z. B. „Zeigen“), jede Option mit Anzahl („Freie Plätze (6)“), neben oder unter der Suche. Chips, die in die nächste Zeile umbrechen, sind nur bei höchstens zwei Zeilen erlaubt. In der gemeinsamen Filterzeile schaltet `statusSelect` an `FilterBar` den Status auf die Auswahl unter der Suche (z. B. Evergreen).
- **Listen am Handy als Karten:** Jeder Eintrag ist eine eigene Karte mit deutlichem Rahmen und Abstand. Tabellen bekommen dafür `table-cards` in einem `card-wrap` (jede Zelle mit `data-label`, die Zeilenüberschrift ist der Kartentitel), Tabellen mit Ansicht rechts (`case-table`) und Listen mit Ansicht (`case-item`) werden unter 1024 px von selbst zu Karten. Auswertungen und Matrizen (Statistik, Mehrjahresübersicht, Diagramme) bleiben Tabellen zum Wischen.
- **Masken in Abschnitten:** nummerierte Abschnitte (`FormStep`, z. B. „1 Was und bei wem“, „2 Kosten und Laufzeit“), darunter eine Zusammenfassung in Worten. Felder, Auswahl und Knöpfe nach Abschnitt 8 „Masken und Suche“.
- **Liste und Ansicht** (Verleih, Einträge in Evergreen): Suche, Status und weitere Filter oben in der Liste; die Liste steht in voller Länge und scrollt mit der Seite (kein eigener Scrollbalken, Spaltenköpfe und Gruppenüberschriften haften unter der Kopfzeile); die Ansicht daneben hat ebenfalls keinen eigenen Scrollbalken: Sie läuft mit der Seite mit und bleibt stehen, sobald ihr Ende sichtbar ist; nach oben ebenso, bis ihr Anfang wieder unter der Kopfzeile steht; passt sie ganz ins Fenster, bleibt sie oben stehen (`components/stickyPanes.ts`, gilt für alle Seiten mit Liste und Ansicht, M365-Seiten mit Detail und die Angaben im Ticket). Trefferfenster von Suche und Auswahl schweben über dem Inhalt (Abschnitt 8). Unter 1200 px ist das Seitenmenü eingeklappt wie mit „Menü einklappen“ (die Bereichsleiste bleibt; „Menü ausklappen“ öffnet es für diese Seite wieder, ohne es im Browser zu merken), unter 1100 px erst nur die Liste, gewählt nur die Ansicht mit „‹ Zur Liste“.
  - Evergreen: Liste mit fester Breite (280–360 px); Status als Auswahl unter der Suche (siehe „Filter-Chips nie seitlich scrollen“); Einträge in Gruppen mit Zähler, deren Überschriften beim Scrollen oben haften. Listeneintrag: Nummer und Status-Badge in einer Zeile, Titel höchstens zwei Zeilen, darunter Dienst · Art und Frist in Orange; der ganze Eintrag ist ein Link, gewählt mit Hintergrund, Balken links und `aria-current`. Am Handy wie oben.
- **Steckbrief** (oberste Karte einer Ansicht, zuerst in Evergreen): Kopfzeile klein mit Nummern, Datum und Status-Badge rechts, Titel (H2), Badges, darunter Kacheln mit Kurzangaben (Beschriftung klein in Großbuchstaben, Wert, Zusatz), die umbrechen. Eine Kachel, die Handlung verlangt, ist orange hinterlegt (Farbe der Hinweisbox „Warnung“).
- **Zeitstrahl:** Monate als Spalten, ein Balken je Phase, senkrechte Markierung „heute“ in Orange. Erledigt gefüllt (Primärfarbe), kommend umrandet, ein früherer Plan schraffiert mit gestricheltem Rand. Die Grafik ist `aria-hidden`; dieselben Angaben stehen als Liste darunter.
- **Reiter in einer Ansicht:** `role="tablist"`/`tab`/`tabpanel`, Pfeiltasten wechseln, Pos1/Ende springen, nur der gewählte Reiter ist in der Tab-Reihenfolge; gewählt mit Linie unten (3 px, Primärfarbe), mindestens 44 px hoch.
- **Info-Symbol „i“** (`components/InfoTip.tsx`, Texte in `help/terms.ts`): neben Fachbegriffen, berechneten Werten (Ist, Verfügbar, Auslastung) und Feldern mit Folgen (Soll-Wert, Kritikalität, Mitbestimmung, AVV), nicht neben Selbsterklärendem. Sichtbar ein Kreis von 16 px mit kursivem „i“, Tippfläche 24 px; geöffnet blau gefüllt. Die Erklärung geht als Blase mit Spitze zum „i“ auf (höchstens 280 px breit), legt sich über den Inhalt und öffnet nach links, wenn rechts kein Platz ist. Farben passend zur Darstellung: hell weiß mit Rahmen, dunkel etwas heller als die Fläche (`--farbe-blase…`). Inhalt: höchstens zwei Sätze, darunter „Mehr im Handbuch ›“. Bedienung per Klick, Enter oder Leertaste; Esc, Klick daneben oder zweiter Klick schließt; kein reiner Hover. Das „i“ steht in einem `dt` oder neben einer Beschriftung (`field-info`), nie in `label`, `legend`, `th` oder einer Überschrift, damit deren Name gleich bleibt.
- **Hilfe am Seitentitel:** hinter dem Titel (neben dem Stern) „Hilfe“ mit Fragezeichen-Symbol, führt zum passenden Thema im Handbuch.
- **Handbuch:** eigenes Seitenmenü mit Suche, „Übersicht“ und den Bereichen zum Aufklappen (Titel in normaler Schrift mit Zahl der Themen), darin die Teile als kleine Überschriften in Großbuchstaben und die Themen; am Handy „Alle Themen“ als Blatt von unten.
- **Auswahl mit Suche** statt langer Auswahllisten (Stellen, Arbeitsplätze, Räume, Geräte): siehe Abschnitt 8 „Masken und Suche“ (`components/ComboField.tsx`).
- Symbole nur aus `components/Icon.tsx` (24 × 24, Linie, Strichstärke 2), nie direkt im Markup.

## 2. Liste und Detail

- Desktop: Liste links (oder Tabelle oben), Detail rechts.
- Tablet und Handy: Das Detail steht unter der Liste bzw. auf einer eigenen Seite mit „Zurück“.
- Solange nichts gewählt ist, zeigt der Detailbereich auf breiten Bildschirmen einen schraffierten Platzhalter mit Hinweis (`components/Placeholder`).
- Ausgewähltes Element sichtbar markiert (Rahmen bzw. Hintergrund **und** `aria-current`).
- Gruppieren und Sortieren über eine Auswahl gibt es nur bei den Budgetposten (nach Konto, Partner oder nicht gruppiert; am Handy sortieren über eine Auswahl, weil die Spaltenköpfe fehlen).
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

### Bestätigen

Jede Aktion mit Folgen fragt vorher in einem **Bestätigungsdialog** nach (`components/ConfirmDialog.tsx`: `ConfirmButton` für einen Knopf, `useConfirm` z. B. für das Absenden einer Maske). Keine Rückfragen mehr direkt in der Seite („Wirklich löschen?“, „Ja, …“).

- **Wann:** Löschen, Verwerfen, Entfernen von Gespeichertem, Buchen, Abschließen und Wieder öffnen, Freigeben und Zur Freigabe senden, Zusammenlegen, Abbrechen eines Vorgangs, Abmelden anderer Geräte, Trennen von Konten und alles, was andere sehen oder was sich nicht einfach zurücknehmen lässt.
- **Nicht:** Speichern einer Maske, Filter, Ansicht wechseln, Entfernen in einer Maske vor dem Speichern, Dinge nur im eigenen Browser (z. B. Bild in einem IT-Tool), „Alle als gelesen“, Abmelden auf diesem Gerät.
- **Inhalt:** Überschrift als Frage mit dem Gegenstand („Rechnung buchen?“), ein bis zwei Sätze, was genau passiert, und der Knopf mit dem Verb der Aktion („Buchen“, „Löschen“), nie „OK“ oder „Ja“. Lässt sich die Aktion nicht zurücknehmen: `danger` (roter Knopf, Warnsymbol, Hinweis „Das lässt sich nicht rückgängig machen.“); lässt sie sich zurücknehmen, steht im Text wie.
- **Gerät:** PC und Tablet ein Fenster in der Mitte, Handy ein Blatt von unten mit großen Knöpfen untereinander (Aktion oben).
- **Bedienung:** Der Fokus startet auf „Abbrechen“; Esc, Klick daneben und am Handy Wischen nach unten brechen ab. Während die Aktion läuft, bleibt der Dialog offen und gesperrt; Fehler zeigt die Seite danach an.

### Rückmeldungen

Gilt auf PC, Tablet und Handy.

- Jede Rückmeldung nach einer Aktion (gespeichert, gelöscht, gesendet, Fehler) erscheint **immer im sichtbaren Bereich**, unabhängig davon, wie lang die Seite ist und wo gerade gescrollt ist. Eine Meldung nur an der Stelle im Formular reicht nicht, wenn sie außerhalb des Bildschirms liegen kann.
- Ort: fest am Bildschirmrand, nicht über der Kopfzeile und nicht unter der Leiste unten auf dem Handy; sie verdeckt keine Knöpfe dauerhaft.
- Erfolg: `role="status"`, verschwindet nach einigen Sekunden von selbst und lässt sich vorher schließen.
- Fehler: `role="alert"`, bleibt stehen, bis man sie schließt oder die Aktion wiederholt; sagt, was passiert ist und was man tun kann.
- Feldfehler bleiben zusätzlich am Feld (mit `aria-describedby`), damit man weiß, was zu korrigieren ist.
- Kontrast, Fokus und Tastaturbedienung wie überall (WCAG 2.2 AA); die Meldung nimmt nicht den Fokus weg.
- Umsetzung: `components/Feedback.tsx` (`<Feedback message={message} onClose={() => setMessage(null)} />`, Meldung als `{ kind: "status" | "alert", text }`). Nicht je Seite nachbauen. Erfolg verschwindet nach 6 Sekunden. Rückmeldungen innerhalb eines offenen Dialogs bleiben im Dialog, weil er ohnehin sichtbar ist.

## 4. Status-Badges

Einheitlich für die ganze App, immer mit Text (nie nur Farbe):

| Bedeutung | Beispiel | Farbe |
|---|---|---|
| Handlung nötig | Offen, Wartet auf mich, zu prüfen, Partner fehlt | Orange |
| Erledigt / positiv | Gewollt, Abgeschlossen, Zustimmung | Grün |
| Negativ / Abweichung | Ungewollt, Abgelehnt, weicht ab | Rot |
| Information / Wartend | Neu, Geplant, Rechnung liegt vor, Neue Funktion | Blau (mit feinem Rahmen, damit es auf einer gewählten, blau hinterlegten Zeile sichtbar bleibt) |
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

## 8. Masken und Suche

Gilt für jede Suche, jeden Filter und jede Eingabemaske auf PC, Tablet und Handy. Gemeinsame Komponenten: `components/Field.tsx` (`Field`, `Segmented`, `ChoiceCards`, `ErrorSummary`, `RequiredNote`, `problemFor`), `components/ListChoice.tsx` (Auswahl aus einer Liste, die wachsen kann: bis zehn als Karten, darüber als Suchfeld), `components/ComboField.tsx`, `components/SearchField.tsx`, `components/FilterBar.tsx`, `components/FormStep.tsx`; Lage der schwebenden Fenster in `components/floating.ts`. Nie je Seite nachbauen.

### Suche und Filter

1. **Suchfeld zuerst:** sichtbare Beschriftung „Suchen“, Lupe, ein Platzhalter, der sagt, wonach gesucht wird (z. B. „Name, Seriennummer, Inventurnummer“). Ist etwas eingegeben, erscheint „✕“ zum Leeren.
2. **Echtzeit mit schwebendem Fenster:** Gesucht wird beim Tippen, ohne Knopf. Ab dem ersten Zeichen öffnet sich unter dem Feld ein schwebendes Fenster mit höchstens 5 Treffern (Titel, eine Zeile Zusatz, Nummer). Ein Klick öffnet den Eintrag; ↑↓ wählt, Enter öffnet, Esc schließt; unten „Alle n in der Liste“. Die Liste darunter filtert gleichzeitig mit. (`FilterBar` mit `search.hits`; ohne `hits` nur Suchfeld ohne Fenster, z. B. auf Seiten ohne Einträge zum Öffnen.)
3. **Weitere Filter** in derselben Zeile rechts daneben, jeder mit Beschriftung über dem Feld; die erste Option heißt „Alle …“.
4. **Status** als Chips mit Anzahl („Aktiv · 2“). Passen sie nicht in eine Zeile, wird daraus eine Auswahl. Ist ein Filter gesetzt, steht rechts „Filter aufheben“.
5. **Trefferzahl** unter den Filtern (`role="status"`). Ohne Treffer: „Nichts gefunden für …“ mit „Filter aufheben“.
6. **Handy:** Suche über die ganze Breite (Fenster ebenfalls schwebend, volle Breite, unten „In der Liste zeigen“); darunter Status als Auswahl und „Weitere Filter · n“, die in einem Blatt von unten öffnen, mit „Zurücksetzen“ und „Fertig“.

### Eingabemasken

1. **Beschriftung** immer über dem Feld, nie nur ein Platzhalter. Pflichtfelder mit „*“ (`aria-required`), oben einmal „Felder mit * sind Pflicht.“ (`RequiredNote`).
2. **Gleiches Aussehen:** Eingabe, Auswahl, Datum und Textfeld sehen gleich aus (`field-control`): 44 px hoch, Rahmen in der Kontrastfarbe, Radius 8 px, normale Schrift. Keine Standard-Auswahl des Browsers.
3. **Hinweis und Fehler:** Ein Hinweis steht klein unter dem Feld. Ein Fehler ersetzt ihn: roter Rahmen, Symbol und ein Satz, was zu tun ist (`aria-invalid`, `aria-describedby`).
4. **Beim Absenden:** oben ein Kasten „n Angaben fehlen noch“ mit Links zu den Feldern (`ErrorSummary`), zusätzlich zur Meldung am Feld. Geprüft wird beim Absenden, danach live; nicht schon beim ersten Tippen.
5. **Auswahl nach Anzahl der Möglichkeiten:**
   - 2–4 feste, die nicht mehr werden (Ja/Nein, Netto/Brutto): Knopfleiste (`Segmented`, `aria-pressed`).
   - 5–10, oder die Liste kann wachsen: Auswahlkarten (`ChoiceCards`, Radio) mit Name und kurzer Erklärung in einem Raster, das umbricht (PC drei Spalten, Handy eine). Gewählt: blauer Rahmen, leicht hinterlegt.
   - Daten, deren Anzahl sich ändert (Konten, Partner, Bereiche, Kategorien): `ListChoice` wählt selbst – bis 10 Karten (mit `none` eine Karte „Kein …“), darüber das Suchfeld.
   - Ab etwa 10: Feld mit Echtzeitsuche (`ComboField`). Schon beim Antippen öffnet ein schwebendes Fenster über dem Inhalt mit der Zahl der Einträge („31 Räume · tippe zum Eingrenzen“); jedes Zeichen grenzt sofort ein („3 Treffer“), höchstens 20 sichtbar, mit Hinweis bei mehr. Je Treffer Name und eine Zeile Zusatz. ↑↓ wählt, Enter übernimmt, Esc schließt. Gewählt steht der Eintrag mit „Ändern“ im Feld. Bei mehr als einigen hundert Einträgen sucht der Server.
6. **Aufbau:** längere Masken in nummerierten Abschnitten (`FormStep`); am PC zwei Spalten, am Handy eine.
7. **Knöpfe** unten, beim Scrollen am unteren Rand haftend (`form-actions`). Die Hauptaktion zuerst und mit Verb („Gerät anlegen“, nicht „Speichern“ oder „OK“), dann „Abbrechen“. Am Handy beide gleich breit nebeneinander.
8. **Rückmeldung** nach dem Speichern über `Feedback` (siehe „Rückmeldungen“).

### Schwebende Fenster (Suche und Auswahl)

1. Das Fenster liegt über dem Inhalt und verschiebt nichts (`position: fixed`, damit kein Kasten es abschneidet). Ist unten kein Platz, klappt es nach oben auf; es bleibt unter der Kopfzeile und über der Leiste unten am Handy.
2. Es schließt immer, wenn der Fokus das Feld verlässt (Klick daneben, Tab, Esc), und nach einer Auswahl. Ein Treffer lässt sich mit einem Klick wählen, ohne dass das Fenster vorher zugeht.
3. Technisch: Feld mit `role="combobox"`, `aria-expanded` und `aria-controls`; Treffer als `listbox` mit `option`; Trefferzahl als `role="status"`.
4. Mindestens 44 px je Treffer; nur die Trefferliste scrollt im Fenster, nie das Fenster und die Liste zusammen.
