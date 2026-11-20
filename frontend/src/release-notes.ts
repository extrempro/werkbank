/**
 * Neuigkeiten für die Menschen, die mit der Werkbank arbeiten (Seite „Neuigkeiten“).
 *
 * Hier steht nur, was man in der Anwendung bemerkt: neue Funktionen, geänderte Bedienung,
 * behobene Fehler. Technische Änderungen am Repository (CI, Abhängigkeiten, Dokumentation,
 * Tests) gehören ausschließlich in CHANGELOG.md.
 *
 * Neueste Version zuerst. Die oberste Version muss zu `version` in package.json passen.
 */

export interface ReleaseSection {
  /** Bereich der Anwendung, z. B. „Evergreen“. */
  area: string;
  entries: string[];
}

export interface Release {
  version: string;
  /** Datum der Veröffentlichung, JJJJ-MM-TT. */
  date: string;
  summary: string;
  sections: ReleaseSection[];
}

export const RELEASES: readonly Release[] = [
  {
    version: "0.73.0",
    date: "2026-11-20",
    summary: "IT-Bestand: Auswahl mit Suche, Standorte neu aufgebaut, übersichtlichere Listen.",
    sections: [
      {
        area: "IT-Bestand",
        entries: [
          "Stelle, Arbeitsplatz, Raum oder Gerät wählst du jetzt über ein Suchfeld: ein paar Buchstaben oder Ziffern tippen und den Treffer antippen. Das gilt zum Beispiel, wenn du im Vorgang einen neuen PC einer Stelle zuordnest.",
          "Beim Anlegen eines Arbeitsplatzes ist der Raum Pflicht. Hat die Etage einen Grundriss, erscheint er gleich darunter, und ein Klick setzt den Platz.",
          "„Standorte“ ist neu aufgebaut: Links klappst du jede Ebene auf und zu und blendest den Baum bei Bedarf aus. Rechts steht immer genau das, was du gewählt hast, und dort legst du auch Neues an.",
          "Wählst du einen Raum, stehen seine Angaben und Arbeitsplätze neben dem Grundriss.",
          "Bei Vorgängen und Verleih scrollt die Liste für sich, und die Ansicht bleibt stehen. Bei den Vorgängen kannst du nach der Art filtern, zum Beispiel nur Rückgaben.",
          "Auf dem Handy und dem Tablet im Hochformat siehst du erst die Liste und öffnest einen Eintrag über die ganze Breite.",
        ],
      },
      {
        area: "Navigation",
        entries: [
          "„Verwaltung“ hat ein neues Symbol, damit es nicht mehr wie der Schalter für die helle Darstellung aussieht.",
        ],
      },
    ],
  },
  {
    version: "0.72.0",
    date: "2026-11-20",
    summary: "Neue Navigation: Bereichsleiste, Seitenmenü, Anheften und Schnellsuche.",
    sections: [
      {
        area: "Navigation",
        entries: [
          "Ganz links steht jetzt eine schmale Leiste mit einem Symbol für jeden Bereich. Daneben siehst du die Seiten des Bereichs, in Gruppen, die du auf- und zuklappen kannst.",
          "Ein Punkt an einem Symbol zeigt dir, dass in diesem Bereich Aufgaben auf dich warten.",
          "Mit dem Stern heftest du Seiten an, die du oft brauchst. Du findest sie im Bereich Start und auf der Startseite, zusammen mit den Seiten, die du zuletzt besucht hast.",
          "Mit Strg+K (am Mac ⌘K) oder dem Suchfeld oben findest du jede Seite schnell nach ihrem Namen.",
          "Konto, Release Notes, hell oder dunkel und Abmelden findest du jetzt oben rechts in deinem Kontomenü.",
          "Auf dem Handy hast du unten eine Leiste mit Start, Suche, Aufgaben und Menü.",
        ],
      },
      {
        area: "IT-Bestand",
        entries: [
          "Wenn du den Bestand pflegst, stehen offene Vorgänge jetzt als Aufgabe auf deiner Startseite.",
        ],
      },
    ],
  },
  {
    version: "0.71.0",
    date: "2026-11-20",
    summary: "IT-Bestand: Info-Fenster an den Plätzen im Grundriss.",
    sections: [
      {
        area: "IT-Bestand",
        entries: [
          "Fährst du im Grundriss mit der Maus über einen Platz, siehst du die Stellen, Personen und Hardware des Arbeitsplatzes. Ein Klick öffnet ihn.",
          "Auf Tablet und Handy öffnet das erste Antippen das Info-Fenster, das zweite den Arbeitsplatz.",
          "Die Plätze siehst du jetzt auch unter „Standorte“.",
        ],
      },
    ],
  },
  {
    version: "0.70.0",
    date: "2026-11-20",
    summary: "IT-Bestand: Ort und Platz im Grundriss.",
    sections: [
      {
        area: "IT-Bestand",
        entries: [
          "Bei Stelle, Arbeitsplatz und Gerät steht jetzt unter dem Titel, wo sie sich befinden.",
          "Im Reiter „Standort“ siehst du den Grundriss mit dem Raum und dem Platz des Arbeitsplatzes. Bei einer Stelle sind es alle Räume ihrer Arbeitsplätze.",
          "Den Platz eines Arbeitsplatzes setzt du mit einem Klick in den Grundriss.",
          "Arbeitsplätze brauchen keinen Namen mehr. Sie heißen nach ihrer Nummer, in Listen steht der Raum dabei.",
        ],
      },
    ],
  },
  {
    version: "0.69.0",
    date: "2026-11-20",
    summary: "IT-Bestand: Statistik und Anschaffungsdatum.",
    sections: [
      {
        area: "IT-Bestand",
        entries: [
          "Neu unter „Statistik“: Geräte je Art, Modell, Alter, Standort und Betriebssystem, wo die Geräte gerade sind, der Verleih und die Ausmusterungen je Jahr. Du kannst nach Hersteller filtern und zwischen Balken und Kreis wechseln.",
          "Am Gerät kannst du jetzt das Anschaffungsdatum eintragen. Daraus berechnet die Statistik das Alter.",
          "Die Suchfelder bei „Vorgänge“, „Verleih“ und „Standorte“ sehen jetzt aus wie die anderen Eingabefelder.",
        ],
      },
    ],
  },
  {
    version: "0.68.0",
    date: "2026-11-20",
    summary: "IT-Bestand: Abgleich der Personen mit Entra.",
    sections: [
      {
        area: "IT-Bestand",
        entries: [
          "Einmal in der Stunde prüft die Werkbank die Personen an Stellen und in Verleihen gegen Entra. Neue Namen und Anmeldenamen übernimmt sie selbst.",
          "Ist ein Konto deaktiviert oder gelöscht, entsteht ein Vorgang „Person nicht mehr aktiv“. Bei einer Stelle kannst du sie frei machen, eine neue Person eintragen oder alles so lassen.",
          "Wird das Konto wieder aktiv oder ist der Verleih zurück, schließt sich der Vorgang selbst.",
        ],
      },
    ],
  },
  {
    version: "0.67.1",
    date: "2026-11-20",
    summary: "IT-Bestand: Personensuche funktioniert wieder.",
    sections: [
      {
        area: "IT-Bestand",
        entries: [
          "Die Suche nach Personen beim Besetzen einer Stelle und beim Verleih meldete, dass die Anmeldedaten für Entra nicht lesbar seien. Das ist behoben.",
        ],
      },
    ],
  },
  {
    version: "0.67.0",
    date: "2026-11-20",
    summary: "IT-Bestand: Suche und „Mehr anzeigen“ bei Vorgängen und Verleih.",
    sections: [
      {
        area: "IT-Bestand",
        entries: [
          "Über den Listen „Vorgänge“ und „Verleih“ gibt es eine Suche. Die Treffer erscheinen schon beim Tippen.",
          "Lange Listen zeigen zuerst 50 Einträge. Mit „Mehr anzeigen“ kommen weitere dazu.",
        ],
      },
    ],
  },
  {
    version: "0.66.0",
    date: "2026-11-20",
    summary: "IT-Bestand: Verleih.",
    sections: [
      {
        area: "IT-Bestand",
        entries: [
          "Neu unter „Verleih“: Du verleihst ein oder mehrere Geräte an eine Person, mit Rückgabedatum und eigener Verleihnummer.",
          "Die Person bekommt per Mail und Teams eine Nachricht bei der Ausgabe, eine Erinnerung zwei Tage vorher, eine Mahnung bei Verspätung und eine Bestätigung, wenn alles zurück ist. Darin stehen nur Verleihnummer und Datum.",
          "Rückgaben trägst du beim Verleih ein, auch einzeln. Danach erinnert dich ein Vorgang daran, die Geräte zu prüfen. Ist ein Verleih überfällig, entsteht ebenfalls ein Vorgang.",
          "Beim Gerät siehst du, an wen es gerade verliehen ist.",
        ],
      },
    ],
  },
  {
    version: "0.65.0",
    date: "2026-11-20",
    summary: "IT-Bestand: Monitore aus NinjaOne und technische Daten von Lenovo.",
    sections: [
      {
        area: "IT-Bestand",
        entries: [
          "Monitore, die ein Skript in NinjaOne einträgt, kommen jetzt in den Bestand. Hängt ein neuer Monitor an einem PC mit Arbeitsplatz, landet er direkt an diesem Arbeitsplatz.",
          "Hängt ein neuer Monitor an einem Notebook, entsteht ein Vorgang „Neuer Monitor“ mit einem Vorschlag für den Arbeitsplatz.",
          "Im Reiter „Technik“ siehst du beim Monitor, an welchem Rechner er hängt, und beim Rechner seine Monitore.",
          "Für Lenovo-Rechner und Lenovo-Monitore holt die Werkbank auf Wunsch die technischen Daten von der Lenovo-Seite PSREF. Im Reiter „Technik“ stehen dann zum Beispiel Kamera, Mikrofon und Lautsprecher und ein Link zur Lenovo-Seite.",
        ],
      },
    ],
  },
  {
    version: "0.64.0",
    date: "2026-11-20",
    summary: "IT-Bestand: Abgleich mit NinjaOne und Vorgänge.",
    sections: [
      {
        area: "IT-Bestand",
        entries: [
          "Die Werkbank gleicht PCs und Notebooks alle 30 Minuten mit NinjaOne ab. Hostname und technische Daten kommen von dort und stehen beim Gerät im neuen Reiter „Technik“.",
          "Neu unter „Vorgänge“: Taucht in NinjaOne ein neues Gerät auf oder fehlt ein Gerät dort, entsteht ein Vorgang. Du entscheidest, ob das Gerät an eine Stelle, an einen Arbeitsplatz oder ins Lager kommt, ob es dasselbe ist wie ein Gerät im Bestand oder ob es nicht in den Bestand soll.",
          "Mit „Ich übernehme“ und Notizen siehst du, wer sich gerade um einen Vorgang kümmert.",
          "Über neue Vorgänge informiert dich die Glocke, wenn du das in deinem Konto eingeschaltet hast.",
          "In der Verwaltung lässt sich festlegen, aus welchen Organisationen und mit welchen Geräterollen neue Geräte aus NinjaOne in die Vorgänge kommen.",
          "Standorte: Die Liste der Standorte ist aufgeräumter, Namen werden nicht mehr mitten im Wort umgebrochen.",
        ],
      },
    ],
  },
  {
    version: "0.63.0",
    date: "2026-11-20",
    summary: "IT-Bestand: Stellen, Arbeitsplätze und Vorlagen für die Ausstattung.",
    sections: [
      {
        area: "IT-Bestand",
        entries: [
          "Neu unter „Stellen“: Jede Stelle hat eine Nummer, eine Abteilung und wird von einer Person besetzt, die du aus Entra auswählst. Hardware und Arbeitsplätze hängen an der Stelle, nicht an der Person.",
          "Neu unter „Arbeitsplätze“: einzelne oder geteilte Arbeitsplätze in einem Raum, mit den Stellen, die sie nutzen.",
          "Unter „Stammdaten“ legst du Vorlagen für die Ausstattung an, zum Beispiel ein Rechner und zwei Monitore. Am Arbeitsplatz siehst du dann, was noch fehlt.",
          "Ein Gerät ordnest du unter „Bearbeiten“ einer Stelle oder einem Arbeitsplatz zu.",
          "Stellen und Arbeitsplätze bekommen fortlaufende Nummern und haben einen Verlauf.",
        ],
      },
    ],
  },
  {
    version: "0.62.0",
    date: "2026-11-20",
    summary: "IT-Bestand: Standorte mit Grundrissen und Räumen.",
    sections: [
      {
        area: "IT-Bestand",
        entries: [
          "Neu unter „Standorte“: Städte, Standorte, Gebäudeabschnitte und Etagen als aufklappbarer Baum mit Suche.",
          "Je Etage lädst du einen Grundriss als Bild hoch und zeichnest die Räume darauf ein. Ohne Maus trägst du die Lage eines Raums als Zahlen ein.",
          "Geräte lassen sich einem Raum zuordnen. Der Reiter „Standort“ im Gerät zeigt den Raum auf dem Grundriss.",
          "Die Geräteliste hat eine Spalte „Standort“, und die Suche findet Geräte und Räume auch über den Standort.",
        ],
      },
    ],
  },
  {
    version: "0.61.0",
    date: "2026-11-20",
    summary: "Neu: Bereich IT-Bestand mit Hardware, Inventurnummer und Ausmustern.",
    sections: [
      {
        area: "IT-Bestand",
        entries: [
          "Neuer Bereich IT-Bestand: Unter „Hardware“ stehen alle Geräte mit Art, Hersteller und Modell, Seriennummer und Inventurnummer. Die Suche findet Geräte über alle Nummern.",
          "Geräte erfasst du von Hand. Vor dem Setzen oder Ändern einer Inventurnummer fragt die Werkbank noch einmal nach.",
          "Geräte werden ausgemustert statt gelöscht: mit Grund, Verbleib und Datum, bei Notebooks und PCs mit Bestätigung, dass der Datenträger gelöscht oder vernichtet ist. Ausgemusterte Geräte bleiben mit ihrem Verlauf erhalten.",
          "Jedes Gerät hat einen Verlauf mit allen Änderungen.",
          "Unter „Stammdaten“ pflegst du Hardware-Arten, Hersteller und Modelle sowie die Gründe fürs Ausmustern.",
          "Auf kleinen Bildschirmen wird die Geräteliste zu übersichtlichen Karten.",
        ],
      },
      {
        area: "Werkbank",
        entries: ["Die Suche oben findet jetzt auch Geräte aus dem IT-Bestand."],
      },
    ],
  },
  {
    version: "0.60.0",
    date: "2026-11-18",
    summary: "Neu: Abstände im Menü einstellbar.",
    sections: [
      {
        area: "Werkbank",
        entries: [
          "Im Konto unter Darstellung stellst du das Menü auf kompakt, normal oder weiträumig. Das gilt für diesen Browser.",
        ],
      },
    ],
  },
  {
    version: "0.59.1",
    date: "2026-11-18",
    summary: "Korrektur: KI-Texte mit Anthropic funktionieren mit neueren Claude-Modellen.",
    sections: [
      {
        area: "Werkbank",
        entries: [
          "KI-Texte: Der Verbindungstest mit Anthropic scheiterte bei neueren Claude-Modellen. Das ist behoben.",
        ],
      },
    ],
  },
  {
    version: "0.59.0",
    date: "2026-11-18",
    summary: "KI-Texte: Anthropic lässt sich direkt anbinden.",
    sections: [
      {
        area: "Werkbank",
        entries: [
          "Verwaltung › KI-Texte: Als Art der Schnittstelle lässt sich jetzt „Anthropic (Claude)“ wählen.",
          "Schlägt der Verbindungstest fehl, steht die Meldung des Anbieters mit dabei.",
        ],
      },
    ],
  },
  {
    version: "0.58.0",
    date: "2026-11-18",
    summary: "Neu: Schriftgröße im Menü einstellbar.",
    sections: [
      {
        area: "Werkbank",
        entries: [
          "Im Konto unter Darstellung wählst du die Schriftgröße im Menü: klein, normal, groß oder sehr groß. Sie gilt für diesen Browser.",
        ],
      },
    ],
  },
  {
    version: "0.57.1",
    date: "2026-11-18",
    summary: "Korrektur: Die Nutzung der Dienste wird wieder abgerufen.",
    sections: [
      {
        area: "Microsoft 365",
        entries: [
          "Nutzung: Der Abruf scheiterte, wenn Microsoft die Berichte von einem regionalen Server liefert. Das ist behoben.",
        ],
      },
    ],
  },
  {
    version: "0.57.0",
    date: "2026-11-18",
    summary: "Diagramme zeigen jetzt auch kleine Änderungen.",
    sections: [
      {
        area: "Werkbank",
        entries: [
          "Verläufe bei Lizenzen, Benutzern, Nutzung und DNS-Abgleich: Jede Linie hat ihr eigenes Feld mit eigener Achse. Kleine Änderungen sind damit zu sehen statt einer geraden Linie.",
        ],
      },
    ],
  },
  {
    version: "0.56.0",
    date: "2026-11-17",
    summary: "Neu: Nutzung der Microsoft-365-Dienste.",
    sections: [
      {
        area: "Microsoft 365",
        entries: [
          "Nutzung: Unter Tenant siehst du, wie viele Benutzer Exchange, OneDrive, SharePoint, Teams und Viva Engage in den letzten 7, 30, 90 oder 180 Tagen genutzt haben, und den Verlauf je Dienst.",
          "Die Werkbank liest dafür nur Summen, nie, wer etwas genutzt hat.",
        ],
      },
    ],
  },
  {
    version: "0.55.0",
    date: "2026-11-17",
    summary: "Neu: Snapshots vergleichen und als JSON oder CSV exportieren.",
    sections: [
      {
        area: "Microsoft 365",
        entries: [
          "Snapshots: Wähle zwei Abrufe und sieh, welche Einstellungen neu sind, sich geändert haben oder weggefallen sind, jeweils mit Wert vorher und nachher.",
          "Den Stand eines Abrufs lädst du als JSON oder CSV herunter.",
        ],
      },
      {
        area: "Werkbank",
        entries: ["Die Rolle Werkbank.Auditor gibt es nicht mehr. Das Audit-Log sehen nur Admins."],
      },
    ],
  },
  {
    version: "0.54.0",
    date: "2026-11-17",
    summary: "Neu: Push aufs Handy für deine Benachrichtigungen.",
    sections: [
      {
        area: "Werkbank",
        entries: [
          "Push: Im Konto schaltest du Push je Gerät ein und wählst je Art, wofür. Die Nachricht nennt nur Bereich und Anzahl; ein Tippen öffnet die Benachrichtigungen.",
          "Auf iPhone und iPad geht Push nur, wenn die Werkbank als App auf dem Home-Bildschirm liegt.",
          "Für Admins: Push wird unter Verwaltung › Mail & Teams eingeschaltet.",
        ],
      },
    ],
  },
  {
    version: "0.53.0",
    date: "2026-11-17",
    summary: "Microsoft 365: Intune-Richtlinien lassen sich jetzt mit überwachen.",
    sections: [
      {
        area: "Microsoft 365",
        entries: [
          "Intune: Compliance-Richtlinien, Konfigurationsprofile, Endpunktsicherheit, App-Schutz und Registrierung erscheinen mit verständlichen Namen unter Einstellungen › Intune, sobald die Verwaltung sie im Abruf einträgt.",
        ],
      },
    ],
  },
  {
    version: "0.52.0",
    date: "2026-11-17",
    summary:
      "Microsoft 365: Einstellungen von Teams und SharePoint lassen sich jetzt mit überwachen.",
    sections: [
      {
        area: "Microsoft 365",
        entries: [
          "SharePoint und OneDrive: Die Mandanteneinstellungen, etwa die Freigabe nach außen, stehen unter Einstellungen › SharePoint, sobald die Verwaltung den Abruf einschaltet.",
          "Teams: Die organisationsweiten Richtlinien für Besprechungen, Chat, Gäste, externen Zugriff und Apps erscheinen mit verständlichen Namen, sobald sie im Abruf eingetragen sind.",
        ],
      },
    ],
  },
  {
    version: "0.51.0",
    date: "2026-11-17",
    summary: "Dienststatus: Der 90-Tage-Kalender steht nur noch im Würfel der Kachel.",
    sections: [
      {
        area: "Microsoft 365",
        entries: [
          "Dienststatus: Die Punkte-Übersicht der letzten 90 Tage unten ist weg; den Kalender zeigt der Würfel in jeder Kachel, jetzt mit Legende. Unten bleibt die Liste der Meldungen.",
        ],
      },
    ],
  },
  {
    version: "0.50.0",
    date: "2026-11-17",
    summary: "DNS-Abgleich: Filter je Stand und ein aufgeräumtes Layout.",
    sections: [
      {
        area: "IT-Monitoring",
        entries: [
          "DNS-Abgleich: Ein Klick auf eine Kachel oben, etwa „Abweichend“, zeigt nur diese Einträge.",
          "Über der Liste gibt es Filter für jeden Stand mit Anzahl.",
          "Suchfeld, Zonen und Werte sind übersichtlicher angeordnet; abweichende Werte sind markiert.",
        ],
      },
    ],
  },
  {
    version: "0.49.0",
    date: "2026-11-17",
    summary: "Dienststatus mit 90-Tage-Würfel in jeder Kachel und klarer gegliederten Meldungen.",
    sections: [
      {
        area: "Microsoft 365",
        entries: [
          "Dienststatus: Das Würfel-Symbol in jeder Kachel zeigt die letzten 90 Tage des Dienstes, mit der Maus beim Darüberfahren, auf dem Handy durch Antippen.",
          "Die Meldungen sind klarer gegliedert: Art, Dienst und Stand oben, darunter Titel, Zeitraum und Dauer.",
          "Von den beendeten Meldungen stehen zuerst die fünf neuesten; „Alle anzeigen“ zeigt den Rest.",
          "Zertifikate und Secrets: Gibt es keinen Handlungsbedarf, öffnet die Seite gleich mit den Waben.",
        ],
      },
    ],
  },
  {
    version: "0.48.0",
    date: "2026-11-17",
    summary:
      "Die Verwaltung ist ein eigener Bereich; auf der Startseite stehen die letzten Aktivitäten.",
    sections: [
      {
        area: "Werkbank",
        entries: [
          "Neu für Admins: der Bereich „Verwaltung“ mit den Seiten Allgemein, Rollen, Mail & Teams, Verbindungen und Audit-Log statt einer langen Seite.",
          "Die Startseite zeigt unter „Letzte Aktivitäten“ die neuesten Meldungen der Glocke.",
          "Der leere Eintrag „Reports“ ist aus der Navigation verschwunden.",
          "Auf dem Handy steht „Abmelden“ jetzt unten im Menü. So bleibt oben Platz für das Logo, das zuletzt unter Glocke und Aufgaben gerutscht war.",
        ],
      },
      {
        area: "IT-Budget",
        entries: [
          "Wenn du im Budgetposten schon etwas eingetragen hast, fragt „Tags verwalten“ jetzt nach, bevor die Eingaben verloren gehen.",
        ],
      },
    ],
  },
  {
    version: "0.47.0",
    date: "2026-11-17",
    summary:
      "Microsoft 365: Einstellungen als Baum nach Dienst, Bereich und Objekt; Änderungen nach Bereich gegliedert.",
    sections: [
      {
        area: "Microsoft 365",
        entries: [
          "Einstellungen: Statt einer langen Liste aller Eigenschaften gibt es einen Baum. Dienst, Bereich und Objekt klappst du auf; erst im Objekt stehen die Eigenschaften mit ihrem Wert.",
          "An jedem Dienst, Bereich und Objekt siehst du, wie viele Änderungen offen sind und wie viele Werte vom Soll-Wert abweichen.",
          "Änderungen: Die Liste ist nach Dienst und Bereich gegliedert. Über „Dienst und Bereich“ zeigst du nur einen davon, mit „Alle auswählen“ bewertest du einen Bereich auf einmal.",
        ],
      },
    ],
  },
  {
    version: "0.46.0",
    date: "2026-11-17",
    summary:
      "Dienststatus: der Grund steht in der Kachel, die letzten 90 Tage als lesbarer Kalender. Tags am Budgetposten sind sichtbar.",
    sections: [
      {
        area: "Microsoft 365",
        entries: [
          "Dienststatus: Jede Kachel nennt die offenen Störungen und Hinweise. Ein Klick springt zur Meldung mit den Mitteilungen von Microsoft.",
          "Die Kachel richtet sich jetzt nach den offenen Meldungen. Bereits behobene Meldungen machen einen Dienst nicht mehr gelb.",
          "„Letzte 90 Tage“ ist ein Kalender mit größeren Feldern, darunter alle Meldungen des Zeitraums mit Dauer.",
          "Behoben: Die Stunden mit Störung waren zu hoch, weil gleichzeitige Störungen doppelt und Fehlalarme mitzählten.",
          "Behoben: Unter „Änderungen“ ließ sich die Detailansicht auf großen Bildschirmen nicht bis zum Ende scrollen.",
        ],
      },
      {
        area: "IT-Budget",
        entries: [
          "Die Tags stehen im Formular des Budgetpostens jetzt sichtbar. Als Budgetverwalter findest du dort den Weg zu Einstellungen › Tags.",
        ],
      },
      {
        area: "Werkbank",
        entries: [
          "Behoben: Auf dem Handy passte „Abmelden“ bei offenem Menü nicht ganz auf den Bildschirm.",
        ],
      },
    ],
  },
  {
    version: "0.45.0",
    date: "2026-11-17",
    summary:
      "IT-Budget: alte Budgetdateien aus Excel Zeile für Zeile übernehmen. Dazu ein neues Symbol.",
    sections: [
      {
        area: "IT-Budget",
        entries: [
          "Neu für den Budgetverwalter: der Import aus Excel. Jede Datei wird ein Vorgang, jede Zeile prüfst du einzeln: Partner, Datum, Nummern, Konto, Betrag und Steuersatz. Danach übernimmst du sie als gebuchte Rechnung oder überspringst sie.",
          "Fehlende Konten legt der Import an, dazu je Konto einen Posten „Allgemein“ mit dem Budget aus der Datei.",
          "Zeilen mit „Jährlich“ werden auf Wunsch Budgetposten für das folgende Geschäftsjahr.",
          "Offene Vorgänge stehen als Aufgabe auf deiner Startseite.",
        ],
      },
      {
        area: "Werkbank",
        entries: [
          "Neues Symbol im Browser-Tab, auf dem Startbildschirm und links oben in der Kopfzeile: eine Werkbank mit Schraubenschlüssel und Hammer. Auf dem Handy erscheint es, wenn du die App neu hinzufügst.",
          "Behoben: Breite Tabellen machten Seiten auf Handy und Tablet manchmal breiter als den Bildschirm.",
        ],
      },
    ],
  },
  {
    version: "0.44.0",
    date: "2026-11-17",
    summary: "Neu: der Bereich IT-Projekte mit Budget, Jour Fixe und Aufgaben.",
    sections: [
      {
        area: "IT-Projekte",
        entries: [
          "Neu: der Bereich IT-Projekte. Jedes Projekt hat eine Übersicht mit Budget, offenen Punkten, internen und externen Ansprechpartnern, wichtigen Links und dem letzten Jour Fixe.",
          "Budget: Du trägst das veranschlagte Budget im Projekt ein. Geplante Kosten und Rechnungen kommen aus dem IT-Budget, sobald dort beim Budgetposten das Projekt ausgewählt ist.",
          "Jour Fixe: Einträge mit Datum und Protokoll, mit einer Leiste für Überschriften, Listen, Punkte zum Abhaken und Links, mit Vorschau und PDF-Anhängen.",
          "Aufgaben: eine einfache Liste zur groben Orientierung, mit zuständiger Person und Datum.",
        ],
      },
      {
        area: "IT-Budget",
        entries: [
          "Beim Budgetposten wählst du jetzt das IT-Projekt, zu dem er gehört. In der Liste der Budgetposten filterst du nach Projekt.",
        ],
      },
      {
        area: "Verwaltung",
        entries: [
          "Unter „Rollen“ zeigt die neue Ansicht „Nach Person“, wer sich angemeldet hat und mit welchen Rollen, mit Suche und dem Filter „Nur Personen ohne Rolle“.",
        ],
      },
    ],
  },
  {
    version: "0.43.0",
    date: "2026-11-16",
    summary: "IT-Tools: Favoriten auf jedem Gerät, zuletzt genutzte Tools und ein Verlauf.",
    sections: [
      {
        area: "IT-Tools",
        entries: [
          "Deine Favoriten gelten jetzt für dein Konto, also auf jedem Gerät. Darüber zeigt die Übersicht die Tools, die du zuletzt genutzt hast.",
          "Neu: der Verlauf. Die Werkbank merkt sich die Einstellungen deiner Tools und öffnet sie mit einem Klick wieder, auf der Seite des Tools oder unter „Verlauf“. Kennwörter und eingegebene Texte werden nie gespeichert. Den Verlauf kannst du löschen oder ausschalten.",
        ],
      },
    ],
  },
  {
    version: "0.42.0",
    date: "2026-11-16",
    summary: "Neu: der Bereich IT-Monitoring mit dem DNS-Abgleich mit NetBox.",
    sections: [
      {
        area: "IT-Monitoring",
        entries: [
          "Neu: der Bereich IT-Monitoring. Alle 4 Stunden prüft die Werkbank, ob die DNS-Einträge aus NetBox öffentlich genau so im DNS stehen, und zeigt Abweichungen, fehlende Einträge und den Verlauf der letzten 90 Tage.",
          "Kommen neue Abweichungen dazu, meldet die Glocke das.",
        ],
      },
      {
        area: "Verwaltung",
        entries: ["Neu: Unter „Allgemein“ lässt sich NetBox anbinden und die Verbindung prüfen."],
      },
    ],
  },
  {
    version: "0.41.0",
    date: "2026-11-16",
    summary: "Benachrichtigungen jetzt auch per Mail und in Teams.",
    sections: [
      {
        area: "Benachrichtigungen",
        entries: [
          "Neu: Benachrichtigungen auch per Mail und in Teams. Im Konto stellst du je Art ein, ob du sie in der Glocke, per Mail oder in Teams bekommst. Mail und Teams sind anfangs aus.",
          "Per Mail und in Teams kommt höchstens alle 15 Minuten eine kurze Sammelnachricht mit einem Link in die Werkbank.",
          "Die Einstellungen zu den Benachrichtigungen findest du jetzt im Konto.",
        ],
      },
      {
        area: "Verwaltung",
        entries: [
          "Neu: Unter „Allgemein“ lässt sich ein Workflow für Teams eintragen und mit einer Testnachricht prüfen.",
        ],
      },
    ],
  },
  {
    version: "0.40.1",
    date: "2026-11-16",
    summary: "Zähler in der Navigation bleiben auch in der App am Handy aktuell.",
    sections: [
      {
        area: "Navigation",
        entries: [
          "Behoben: Die Zahlen an der Navigation konnten einen alten Stand zeigen, obwohl die Aufgabe schon erledigt war. Sie werden jetzt auch neu geladen, wenn du die App am Handy wieder öffnest.",
        ],
      },
    ],
  },
  {
    version: "0.40.0",
    date: "2026-11-16",
    summary: "Neu: das Handbuch.",
    sections: [
      {
        area: "Handbuch",
        entries: [
          "Neu: das Handbuch. Es erklärt Schritt für Schritt, wie du mit der Werkbank arbeitest, und zeigt dir die Kapitel, die zu deinen Rollen passen. Du findest es unten in der Navigation und auf der Seite „Konto“.",
          "Die Suche findet jetzt auch passende Abschnitte im Handbuch.",
        ],
      },
    ],
  },
  {
    version: "0.39.0",
    date: "2026-11-16",
    summary:
      "Neu: Benachrichtigungen mit Glocke. Der Dienststatus zeigt Diagramme und führt ins Admin Center.",
    sections: [
      {
        area: "Benachrichtigungen",
        entries: [
          "Neu: die Glocke oben rechts. Sie meldet, was sich in deinen Bereichen getan hat, zum Beispiel eine neue Rechnung zur Prüfung, ein Vorgang, der auf dich wartet, eine Störung bei Microsoft 365 oder ein Zertifikat, das bald abläuft. Die Zahl an der Glocke zeigt, wie viele du noch nicht gelesen hast.",
          "Unter „Alle anzeigen“ findest du alle Benachrichtigungen der letzten 90 Tage. Dort kannst du auch einstellen, welche Benachrichtigungen du bekommen möchtest.",
        ],
      },
      {
        area: "Microsoft 365",
        entries: [
          "Dienststatus: neue Diagramme mit den letzten 90 Tagen je Dienst, der Ausfalldauer je Dienst und den Störungen pro Monat.",
          "Jede Störung und jeder Hinweis lässt sich direkt im Microsoft 365 Admin Center öffnen.",
        ],
      },
    ],
  },
  {
    version: "0.38.0",
    date: "2026-11-16",
    summary: "Microsoft 365: Dienststatus. Zähler in der Navigation bleiben aktuell.",
    sections: [
      {
        area: "Microsoft 365",
        entries: [
          "Neu: Dienststatus. Zeigt, ob Exchange Online, Teams, SharePoint und Entra laufen, mit Störungen, Hinweisen und den Mitteilungen von Microsoft. Dazu eine Übersicht der Ausfälle je Dienst und Jahr.",
        ],
      },
      {
        area: "Navigation",
        entries: [
          "Die Zähler an der Navigation verschwinden jetzt, sobald eine Aufgabe erledigt ist, und nicht erst beim nächsten Seitenwechsel.",
        ],
      },
    ],
  },
  {
    version: "0.37.0",
    date: "2026-11-16",
    summary: "IT-Tools: DNS, Mail-Check, RDAP und Passwort prüfen; Tools in der Suche.",
    sections: [
      {
        area: "IT-Tools",
        entries: [
          "Neu: DNS Lookup. Fragt Einträge bei Cloudflare, Google oder Quad9 ab, vergleicht die Antworten und findet Subdomains.",
          "Neu: DNS-/Mail-Check. Prüft MX, SPF, DMARC, DKIM, MTA-STS, DNSSEC und CAA einer Domain und erklärt, was fehlt.",
          "Neu: RDAP (WHOIS). Zeigt, wem eine Domain, ein Netz oder eine AS-Nummer gehört, mit Ablaufdatum und Abuse-Kontakt.",
          "Neu: Passwort prüfen. Schätzt die Stärke und prüft auf Knopfdruck, ob das Kennwort in Datenlecks vorkommt. Das Kennwort selbst verlässt deinen Browser nie.",
          "Diese Abfragen stellt die Werkbank für dich. Ein Admin kann sie in der Verwaltung ausschalten.",
        ],
      },
      {
        area: "Suche",
        entries: ["Die Suche zeigt passende IT-Tools sofort an."],
      },
    ],
  },
  {
    version: "0.36.0",
    date: "2026-11-16",
    summary: "IT-Budget: Den Vertrag wählst du am Budgetposten.",
    sections: [
      {
        area: "IT-Budget",
        entries: [
          "Rechnungspositionen buchst du nur noch auf einen Budgetposten. Den Vertrag gibt der Posten vor; er steht an der Position zur Information.",
          "Am Budgetposten wählst du jetzt den Vertrag. Ein Posten hat höchstens einen Vertrag; am Vertrag kannst du die Posten weiterhin zuordnen.",
          "Einen Vertrag kannst du auch ohne Budgetposten anlegen.",
          "Die Kündigungsfrist wählst du am Vertrag aus einer Liste bis 12 Monate.",
          "Hat der Posten einen Vertrag, ist „Schließt den Budgetposten ab“ an der Position zuerst aus.",
        ],
      },
    ],
  },
  {
    version: "0.35.0",
    date: "2026-11-16",
    summary: "IT-Tools: QR-Code, Bild-Konverter und Zertifikate.",
    sections: [
      {
        area: "IT-Tools",
        entries: [
          "Neu: QR-Code-Generator für Links, Texte, WLAN-Zugang, Kontakte, E-Mail, Telefon und SMS. Auf Wunsch mit Kürzel oder Logo in der Mitte, als SVG oder PNG.",
          "Neu: Bild-Konverter. Wandelt Bilder in PNG, JPEG, WebP, ICO oder ein Favicon-Paket um und verkleinert sie, auch viele auf einmal.",
          "Neue Kategorie Zertifikate: Zertifikate, Ketten, Schlüssel und PFX-Dateien ansehen und umwandeln, und eine Zertifikatsanforderung (CSR) samt Schlüssel erstellen.",
          "Alles bleibt in deinem Browser. Inhalte, Bilder, Schlüssel und Kennwörter stehen nie in der Adresszeile.",
        ],
      },
    ],
  },
  {
    version: "0.34.0",
    date: "2026-11-16",
    summary: "IT-Tools: Planungs-Tools und E-Mail-Header.",
    sections: [
      {
        area: "IT-Tools",
        entries: [
          "Neue Kategorie Planung mit Amortisation, Backup-Planer, Netzplan (kritischer Pfad) und Nutzwertanalyse.",
          "Neu: E-Mail-Header und Rückläufer. Zeigt Zustellweg, Verzögerungen, SPF, DKIM und DMARC und erklärt Rückläufer. Du kannst auch .eml- und Outlook-.msg-Dateien öffnen; alles bleibt in deinem Browser.",
        ],
      },
    ],
  },
  {
    version: "0.33.0",
    date: "2026-11-16",
    summary:
      "IT-Budget: Budgetposten als Vorgang mit Status, Verträge für mehrere Posten, Tag-Liste, Mehrjahresübersicht und Excel-Export.",
    sections: [
      {
        area: "IT-Budget",
        entries: [
          "Ein Budgetposten wird jetzt in einem Schritt hinzugefügt: Konto, Bezeichnung, erwartete Kosten und Laufzeit. Die erwarteten Kosten sind der Plan und gelten in jedem Jahr der Laufzeit.",
          "Plan bearbeiten und die Freigabe des Plans gibt es nicht mehr. Auch der Partner am Budgetposten entfällt; er steht an der Rechnung.",
          "Jeder Budgetposten hat je Jahr einen Status: offen, Rechnung liegt vor oder abgeschlossen. Abgeschlossen ist er, sobald eine gebuchte Rechnungsposition mit dem Haken „Schließt den Budgetposten ab“ auf ihm liegt.",
          "Bei Positionen mit Vertrag ist der Haken aus, sonst an. Für Abschlagsrechnungen nimmst du ihn heraus.",
          "Statt „Frei“ steht jetzt die Abweichung der Prognose von den erwarteten Kosten. Bei abgeschlossenen Posten zählt nur noch das Ist.",
          "Ein Vertrag lässt sich mehreren Budgetposten zuordnen. Verträge binden kein Budget mehr; ihre Kosten kommen über die Rechnungen ins Budget.",
          "Tags pflegt der Budgetverwalter jetzt unter Einstellungen. Am Budgetposten wählst du sie aus dieser Liste aus.",
          "In der Rechnung findest du den Budgetposten über ein Suchfeld; die Auswahl ist nach Status sortiert.",
          "Die Mehrjahresplanung heißt jetzt Mehrjahresübersicht: erwartete Kosten, Ist und Status über fünf Jahre, als Ausblick oder Rückblick. Sie lässt sich als Excel-Datei herunterladen.",
          "Die Masken für Budgetposten, Rechnung und Vertrag sind in Abschnitte gegliedert; Seltenes steht unter „Weitere Angaben“.",
          "Deine bisherigen Pläne werden übernommen. Wo Beträge je Jahr verschieden waren, steht der alte Plan in der Notiz des Postens.",
        ],
      },
    ],
  },
  {
    version: "0.32.0",
    date: "2026-11-16",
    summary: "IT-Budget: Eine Rechnung kann auf mehrere Budgetposten verteilt werden.",
    sections: [
      {
        area: "IT-Budget",
        entries: [
          "Rechnungen haben jetzt Positionen. Jede Position gehört zu einem Budgetposten, so lässt sich eine Rechnung auf mehrere Posten verteilen.",
          "Jede Position hat ihren eigenen Steuersatz. Rechnungen mit 19 % und 7 % lassen sich damit in einem Stück erfassen.",
          "Trägst du den Rechnungsbetrag vom Beleg ein, zeigt die Werkbank, wie viel noch nicht verteilt ist.",
          "Deine bisherigen Rechnungen bleiben erhalten; jede hat jetzt genau eine Position.",
        ],
      },
    ],
  },
  {
    version: "0.31.0",
    date: "2026-11-16",
    summary: "IT-Budget: Tags am Budgetposten und eine Statistik nach Tags.",
    sections: [
      {
        area: "IT-Budget",
        entries: [
          "Budgetposten können Tags bekommen, zum Beispiel „Cloud“ oder „Lizenzen“. Schon vergebene Tags werden beim Eintragen vorgeschlagen.",
          "Die Seite Budgetposten lässt sich durchsuchen und nach Tag filtern. Ein Klick auf einen Tag in der Liste filtert ebenfalls.",
          "Die Suche oben findet jetzt auch Budgetposten, über ihren Namen und ihre Tags.",
          "Neue Seite „Statistik“: Du wählst einen oder mehrere Tags und siehst Plan und Ist der passenden Posten über fünf Jahre, als Rückblick oder Ausblick.",
          "Eine Auswahl von Tags lässt sich unter einem Namen speichern. Gespeicherte Statistiken sehen alle, die das Budget sehen dürfen.",
        ],
      },
    ],
  },
  {
    version: "0.30.1",
    date: "2026-11-16",
    summary: "M365: keine Schein-Änderungen mehr bei umsortierten Listen.",
    sections: [
      {
        area: "Microsoft 365",
        entries: [
          "Behoben: Einstellungen, deren Werte nur in anderer Reihenfolge geliefert wurden, erscheinen nicht mehr als Änderung.",
          "Die Snapshot-Liste zeigt jetzt den Fehlertext, wenn ein Bereich nicht gelesen werden konnte.",
          "Behoben: Das Diagramm „Änderungen je Tag“ und die Verlaufsdiagramme bei Lizenzen und Benutzern werden wieder richtig dargestellt.",
        ],
      },
    ],
  },
  {
    version: "0.30.0",
    date: "2026-11-16",
    summary: "IT-Budget: Belege als PDF an der Rechnung.",
    sections: [
      {
        area: "IT-Budget",
        entries: [
          "Neu: An jede Rechnung lässt sich der Beleg als PDF hängen und von allen mit Budget-Rolle herunterladen.",
          "Ein Beleg lässt sich ersetzen und wieder entfernen; bei gebuchten Rechnungen nur durch den Budgetverwalter.",
        ],
      },
    ],
  },
  {
    version: "0.29.0",
    date: "2026-11-16",
    summary: "IT-Budget: mehrere Jahre im Voraus planen, mit Entwurf und Freigabe.",
    sections: [
      {
        area: "IT-Budget",
        entries: [
          "Neu: Die Seite „Mehrjahresplanung“ zeigt den Plan aller Budgetposten für sechs Jahre. Leere Felder lassen sich aus den Verträgen füllen.",
          "Der Plan eines Jahrs ist Entwurf oder freigegeben. Im Entwurf planen IT und Budgetverwalter, nach der Freigabe ist der Plan gesperrt.",
          "Beim Anlegen eines Budgetpostens lassen sich Plan und üblicher Partner gleich mit eintragen.",
        ],
      },
    ],
  },
  {
    version: "0.28.0",
    date: "2026-11-16",
    summary: "IT-Budget mit Rechnungen, Ist und Prognose.",
    sections: [
      {
        area: "IT-Budget",
        entries: [
          "Neu: Rechnungen erfassen, prüfen und buchen. Erst gebuchte Rechnungen zählen zum Ist.",
          "Übersicht und Budgetposten zeigen jetzt Ist und Prognose; „Frei“ ist der Plan abzüglich der Prognose.",
          "Ein Klick auf einen Partner zeigt seine Verträge, Budgetposten und Rechnungen. Doppelt angelegte Partner lassen sich zusammenlegen.",
        ],
      },
    ],
  },
  {
    version: "0.27.0",
    date: "2026-11-15",
    summary: "IT-Budget: aufgeräumte Seiten und Detailansicht für Verträge.",
    sections: [
      {
        area: "IT-Budget",
        entries: [
          "Neu: Ein Klick auf einen Vertrag zeigt seine Daten, Fristen und die Zuordnung zum Budget.",
          "Formulare erscheinen erst über „… anlegen“ oder „Bearbeiten“ und stehen dann über der Tabelle.",
          "Alle Seiten zeigen oben Kostenstelle und laufendes Geschäftsjahr; das gewählte Jahr gilt für alle Seiten.",
        ],
      },
    ],
  },
  {
    version: "0.26.0",
    date: "2026-11-15",
    summary: "IT-Budget mit Budgetposten und Netto am Vertrag.",
    sections: [
      {
        area: "IT-Budget",
        entries: [
          "Neu: Budgetposten unter den Konten. Geplant wird je Posten auf der neuen Seite „Budgetposten“, das Konto zeigt die Summe.",
          "Verträge laufen jetzt auf einen Budgetposten und werden mit Nettobetrag und Steuersatz erfasst; das Brutto rechnet die Werkbank.",
          "Bisherige Pläne und Verträge stehen im Posten „Allgemein“ ihres Kontos. Bei vorhandenen Verträgen bitte Netto und Steuersatz nachtragen.",
        ],
      },
    ],
  },
  {
    version: "0.25.0",
    date: "2026-11-15",
    summary: "IT-Budget mit Partnern, Verträgen und neuer Übersicht.",
    sections: [
      {
        area: "IT-Budget",
        entries: [
          "Neu: Partner und Verträge. Zu jedem Vertrag stehen Jahreskosten, der nächste Kündigungstermin und der Stand des AVV.",
          "Die Übersicht zeigt jetzt, wie viel vom Plan durch Verträge gebunden und wie viel noch frei ist, als Karten und als Balken je Konto.",
          "Kündigungstermine der nächsten 120 Tage und Handlungsbedarf stehen direkt in der Übersicht; kurz vor dem Termin erscheint eine Aufgabe auf der Startseite.",
        ],
      },
    ],
  },
  {
    version: "0.24.0",
    date: "2026-11-15",
    summary: "Neuer Bereich IT-Budget mit Konten und Plan je Geschäftsjahr.",
    sections: [
      {
        area: "IT-Budget",
        entries: [
          "Neu: Der Bereich „IT-Budget“ zeigt das geplante Budget je Konto für ein Geschäftsjahr, mit dem Vorjahr zum Vergleich.",
          "Konten lassen sich anlegen, ändern und stilllegen, getrennt nach laufenden Kosten und Investitionen.",
          "Der Budgetverwalter trägt den Plan direkt in der Übersicht ein und legt Beginn und Bezeichnung des Geschäftsjahrs fest.",
        ],
      },
    ],
  },
  {
    version: "0.23.0",
    date: "2026-11-15",
    summary: "Zertifikate und Secrets als Waben auf einen Blick.",
    sections: [
      {
        area: "Microsoft 365",
        entries: [
          "Neu: Die Seite „Zertifikate & Secrets“ hat eine Wabenansicht. Jede Wabe zeigt Anwendung, Restlaufzeit und Ablaufdatum, das Dringendste zuerst.",
          "Ein Klick auf eine Wabe zeigt die Einzelheiten. Lange Namen werden umbrochen oder gekürzt, der volle Name steht in den Einzelheiten.",
        ],
      },
    ],
  },
  {
    version: "0.22.0",
    date: "2026-11-15",
    summary: "Ablaufende Zertifikate und Secrets im Tenant im Blick.",
    sections: [
      {
        area: "Microsoft 365",
        entries: [
          "Neu: Die Seite „Zertifikate & Secrets“ zeigt, wann Zertifikate und Secrets der Anwendungen im Tenant ablaufen, das Dringendste zuerst.",
          "Was bald abläuft oder schon abgelaufen ist, steht als Aufgabe auf der Startseite.",
          "Wie früh die Werkbank hinweist, lässt sich in der Verwaltung unter „Allgemein“ einstellen (Standard: 60, 30 und 7 Tage).",
        ],
      },
    ],
  },
  {
    version: "0.21.0",
    date: "2026-11-15",
    summary: "IT-Tools: Werkzeuge für Active Directory und Microsoft 365, weitere Generatoren.",
    sections: [
      {
        area: "IT-Tools",
        entries: [
          "Neue Kategorie „AD und M365“: AD-Zeitstempel, DN-Zerleger, ImmutableID ↔ objectGUID, LDAP-Escaper und userAccountControl.",
          "Neue Generatoren: Passphrasen aus einer deutschen Wortliste, Passwort-Hashes für htpasswd und /etc/shadow, Prüfsummen für Text und Dateien, HMAC und Lorem ipsum.",
          "Kennwörter, Schlüssel und Dateien bleiben im Browser und stehen nie in der Adresszeile.",
        ],
      },
    ],
  },
  {
    version: "0.20.0",
    date: "2026-11-15",
    summary: "IT-Tools: Rechner für Speicher, Strom, USV, Verfügbarkeit und mehr.",
    sections: [
      {
        area: "IT-Tools",
        entries: [
          "Neue Kategorie „Rechner“: RAID, Speichereinheiten, Speicherbedarf, Übertragungsdauer, Verfügbarkeit, Stromkosten, USV und VoIP-Bandbreite.",
          "Neu unter „Linux und Server“: Cron-Ausdruck erklären, mit den nächsten Ausführungen.",
          "Die Zahlen eines Rechners stehen in der Adresszeile; so lässt sich eine Rechnung als Link teilen.",
        ],
      },
      {
        area: "Microsoft 365",
        entries: [
          "Die Diagramme bei Lizenzen und Benutzern sind größer und besser lesbar, auch auf schmalen Bildschirmen.",
        ],
      },
    ],
  },
  {
    version: "0.19.0",
    date: "2026-11-15",
    summary: "Lizenzen und Benutzerzahlen des Tenants, Kategorien der IT-Tools in der Navigation.",
    sections: [
      {
        area: "Microsoft 365",
        entries: [
          "Neu: Lizenzen des Tenants mit gekauft, zugewiesen, frei und Stichtag. Ein Klick auf eine Lizenz zeigt den Verlauf als Diagramm.",
          "Neu: Benutzerzahlen (Mitglieder, Gäste, aktiv, deaktiviert, mit Lizenz) mit Verlauf. Es werden nur Summen gespeichert, keine Namen.",
          "Beide Seiten brauchen die neue Rolle „Tenant Leser“ und stehen im Bereich Microsoft 365 unter „Tenant“.",
        ],
      },
      {
        area: "IT-Tools",
        entries: [
          "Die Kategorien stehen jetzt in der Navigation, jede mit eigener Seite.",
          "Die Suche in der Kopfzeile findet auch IT-Tools.",
        ],
      },
      {
        area: "Allgemein",
        entries: [
          "Behoben: Auf langen Seiten bleibt die Kopfzeile stehen, und die Navigation reicht bis zum unteren Rand.",
        ],
      },
    ],
  },
  {
    version: "0.18.0",
    date: "2026-11-15",
    summary: "IT-Tools: Konverter und Werkzeuge für Text.",
    sections: [
      {
        area: "IT-Tools",
        entries: [
          "Neue Kategorie „Konverter“: CSV ↔ JSON, JSON ↔ YAML ↔ TOML, Zahlensysteme, Unix-Zeitstempel und Zeitzonen-Umrechner.",
          "Neue Kategorie „Text“: Schreibweise ändern, Listen bereinigen und vergleichen, Regex-Tester, Zeichen zählen und Text-Diff.",
          "SQL: Abfragen formatieren und JOINs an Beispieltabellen ausprobieren.",
          "Eingegebene Texte bleiben im Browser und stehen nie in der Adresszeile.",
        ],
      },
    ],
  },
  {
    version: "0.17.1",
    date: "2026-11-15",
    summary: "Updates der Werkbank lassen sich einfacher einspielen.",
    sections: [
      {
        area: "Allgemein",
        entries: [
          "Für die Arbeit mit der Werkbank ändert sich nichts. Neue Versionen kommen jetzt als fertiges Paket auf den Server.",
        ],
      },
    ],
  },
  {
    version: "0.17.0",
    date: "2026-11-15",
    summary: "IT-Tools: Encoding und Formatter.",
    sections: [
      {
        area: "IT-Tools",
        entries: [
          "URL-Encoder: Text für Adressen kodieren und dekodieren, eine URL in ihre Bestandteile zerlegen.",
          "HTML-Entities: Sonderzeichen umwandeln und zurück.",
          "JWT-Decoder: Token lesen, Ablauf sehen und die Signatur prüfen.",
          "SAML-Decoder: Anmeldenachrichten lesen, mit Attributen, Gültigkeit und Zertifikat.",
          "Neue Kategorie „Formatter“: JSON, YAML und XML prüfen und sauber formatieren.",
          "Token, Schlüssel und eingegebene Texte bleiben im Browser und stehen nie in der Adresszeile.",
        ],
      },
      {
        area: "Allgemein",
        entries: [
          "Behoben: Ein offenes Fenster bemerkt eine neue Version jetzt von selbst und zeigt den Hinweis „Neu laden“. Bisher kam er erst nach einem Neuladen der Seite.",
        ],
      },
    ],
  },
  {
    version: "0.16.0",
    date: "2026-11-15",
    summary: "IT-Tools: fünf weitere Werkzeuge fürs Netzwerk.",
    sections: [
      {
        area: "IT-Tools",
        entries: [
          "Neu: Subnetting-Bits, Netze zusammenfassen, Firewall-Regeln prüfen, MAC-Adressen und das Port-Nachschlagewerk.",
          "MAC-Adressen: Der Hersteller wird aus einer eingebauten Liste nachgeschlagen. Es geht keine Anfrage nach außen.",
          "Regelwerke, Listen von Netzen und MAC-Adressen bleiben auf der Seite und stehen nie im Link.",
        ],
      },
    ],
  },
  {
    version: "0.15.0",
    date: "2026-11-15",
    summary: "Neuer Bereich IT-Tools mit den ersten fünf Werkzeugen.",
    sections: [
      {
        area: "IT-Tools",
        entries: [
          "In der Navigation gibt es den neuen Bereich „IT-Tools“ mit Suche und Favoriten. Du siehst ihn, wenn dir die Rolle dafür zugewiesen ist.",
          "Zum Start dabei: Subnetz-Rechner, chmod-Rechner, Base64, UUID-Generator und Passwort-Generator. Weitere Tools folgen.",
          "Alle Tools rechnen in deinem Browser. Deine Eingaben werden nicht übertragen.",
          "Die Einstellungen eines Tools stehen in der Adresszeile; so kannst du einen Link teilen. Kennwörter und eingegebene Texte stehen dort nie.",
        ],
      },
    ],
  },
  {
    version: "0.14.0",
    date: "2026-11-15",
    summary: "Exchange Online kann dazukommen, und Bereiche haben verständliche Namen.",
    sections: [
      {
        area: "Microsoft 365",
        entries: [
          "Die Werkbank kann jetzt auch Einstellungen von Exchange Online zeigen, zum Beispiel Transportregeln und die Richtlinien gegen Spam und Phishing. Sie erscheinen, sobald Exchange für eure Installation eingerichtet ist.",
          "Bereiche heißen jetzt so, wie man sie kennt: „Bedingter Zugriff“ statt „conditionalaccesspolicy“.",
        ],
      },
    ],
  },
  {
    version: "0.13.0",
    date: "2026-11-15",
    summary: "Microsoft 365 und Evergreen haben jetzt je einen eigenen Bereich in der Navigation.",
    sections: [
      {
        area: "Allgemein",
        entries: [
          "Oben in der Navigation wechselst du zwischen „Werkbank“ (Start, Suche und Allgemeines), „Microsoft 365“ und „Evergreen“. Links stehen immer nur die Seiten des gewählten Bereichs.",
          "Gibt es in einem anderen Bereich offene Aufgaben, steht die Zahl am Umschalter.",
        ],
      },
    ],
  },
  {
    version: "0.12.0",
    date: "2026-11-15",
    summary: "Empfehlungen von Microsoft: was offen ist und was schon erfüllt.",
    sections: [
      {
        area: "M365-Konfiguration",
        entries: [
          "Neue Seite „Empfehlungen“: Sie zeigt die Empfehlungen aus Microsoft Secure Score mit dem Stand in deinem Tenant. Du siehst, was offen ist, was Microsoft zur Umsetzung rät und wie viele Punkte es bringt. Die Texte kommen von Microsoft und sind auf Englisch.",
          "Mit der Rolle Reviewer ordnest du einer Empfehlung die passenden Einstellungen zu. Die Empfehlung steht dann auch direkt bei der Einstellung.",
          "Die Seite füllt sich erst, wenn der Abruf für eure Installation eingeschaltet ist.",
        ],
      },
    ],
  },
  {
    version: "0.11.0",
    date: "2026-11-15",
    summary:
      "Logos passen sich beim Hochladen selbst an, und die Werkbank sagt klar, wenn du dich neu anmelden musst.",
    sections: [
      {
        area: "Verwaltung",
        entries: [
          "Branding: Zu große Bilder verkleinert die Werkbank jetzt selbst. Ein Favicon muss nicht mehr quadratisch sein, und JPEG-Dateien gehen auch. Wer das nicht möchte, wählt „Original behalten“.",
          "Braucht eine Änderung eine frische Anmeldung, erscheint oben ein deutlicher Hinweis mit dem Knopf „Erneut anmelden“. Danach landest du wieder auf derselben Seite.",
        ],
      },
      {
        area: "Allgemein",
        entries: [
          "Ist deine Sitzung abgelaufen, zeigt die Werkbank gleich die Anmeldeseite und bringt dich nach der Anmeldung zurück auf die Seite, auf der du warst.",
        ],
      },
    ],
  },
  {
    version: "0.10.0",
    date: "2026-11-15",
    summary: "Beschreibungen per KI: als Vorschlag, klar gekennzeichnet.",
    sections: [
      {
        area: "M365-Konfiguration",
        entries: [
          "Einstellungen ohne eigene Beschreibung bekommen einen kurzen Text von einer KI, wenn das in der Verwaltung eingeschaltet ist. Er ist als „KI-generiert, ungeprüft“ gekennzeichnet, bis ihn jemand freigibt.",
          "Mit der Rolle Reviewer kannst du einen KI-Text freigeben oder verwerfen. Das gilt für alle Einstellungen derselben Art. Eine eigene Beschreibung hat immer Vorrang.",
          "Im Baum zeigt das Kennzeichen „KI“, wo noch ein ungeprüfter Text steht.",
        ],
      },
      {
        area: "Verwaltung",
        entries: [
          "Unter „Allgemein“ gibt es den Bereich „KI-Texte“: Dort trägst du den Anbieter ein, schaltest die Texte ein oder aus und prüfst die Verbindung. An den Anbieter gehen nur technische Namen, keine Werte aus dem Tenant.",
        ],
      },
    ],
  },
  {
    version: "0.9.0",
    date: "2026-11-15",
    summary: "Eigenes Logo, eigener Name, eigene Farbe – und eine Werkbank als Zeichen.",
    sections: [
      {
        area: "Verwaltung",
        entries: [
          "Unter „Allgemein“ gibt es den neuen Bereich „Branding“: Dort legst du den Namen der Anwendung, eine Akzentfarbe, Logos für hellen und dunklen Hintergrund und ein eigenes Favicon fest.",
          "Die Akzentfarbe wird automatisch so angepasst, dass alles gut lesbar bleibt, in der hellen und in der dunklen Darstellung.",
        ],
      },
      {
        area: "Allgemein",
        entries: [
          "Das Zeichen im Browser-Tab, auf dem Startbildschirm und oben links zeigt jetzt eine Werkbank.",
        ],
      },
    ],
  },
  {
    version: "0.8.0",
    date: "2026-11-15",
    summary: "Einstellungen als Baum: links auswählen, rechts lesen.",
    sections: [
      {
        area: "M365-Konfiguration",
        entries: [
          "Einstellungen: Links steht der Baum nach Workload, rechts die gewählte Einstellung mit Wert, Beschreibung und Verlauf. So wechselst du schnell zwischen Einstellungen.",
          "Kennzeichen im Baum zeigen auf einen Blick, wo es offene Änderungen gibt, wo ein Wert vom Soll-Wert abweicht und was durch einen Beschluss geregelt ist (BR).",
        ],
      },
      {
        area: "Allgemein",
        entries: [
          "Solange du in einer Liste noch nichts gewählt hast, zeigt der Bereich daneben eine schraffierte Fläche mit einem Hinweis. Das gilt für Einstellungen, Änderungen und Vorgänge.",
        ],
      },
    ],
  },
  {
    version: "0.7.0",
    date: "2026-11-15",
    summary: "Die Navigation hat Symbole und lässt sich einklappen.",
    sections: [
      {
        area: "Allgemein",
        entries: [
          "Jeder Menüpunkt hat ein Symbol. Mit dem Doppelpfeil unten in der Navigation klappst du die Leiste ein; dann siehst du nur noch die Symbole und hast mehr Platz.",
          "Unten in der Navigation findest du zwei Schnellzugriffe: die Neuigkeiten und einen Umschalter zwischen heller und dunkler Darstellung. Ein Punkt am Symbol zeigt, dass es eine neue Version gibt.",
          "Der Menüpunkt „Neuigkeiten“ ist dafür entfallen.",
          "Auf langen Seiten erscheint unten rechts ein Knopf, der dich zurück nach oben bringt.",
        ],
      },
    ],
  },
  {
    version: "0.6.0",
    date: "2026-11-15",
    summary: "Verwaltung: Mailversand einrichten und Aufbewahrung des Audit-Logs festlegen.",
    sections: [
      {
        area: "Verwaltung",
        entries: [
          "Neuer Bereich „Allgemein“ für Einstellungen der Werkbank.",
          "Mailversand: Admins tragen dort den SMTP-Server ein und können sich eine Testmail schicken. Das Passwort wird verschlüsselt gespeichert und nie angezeigt. Benachrichtigungen per Mail folgen mit einer späteren Version.",
          "Audit-Log: Einträge werden nach 90 Tagen gelöscht. Die Frist lässt sich in der Verwaltung ändern.",
        ],
      },
    ],
  },
  {
    version: "0.5.0",
    date: "2026-11-15",
    summary: "Neu: Suche über Einstellungen, Änderungen und Vorgänge.",
    sections: [
      {
        area: "Allgemein",
        entries: [
          "Suche: Oben in der Kopfzeile kannst du nach Einstellungen, Änderungen und Evergreen-Vorgängen suchen. Auf dem Handy findest du die Suche in der Navigation.",
          "Du findest nur, was du auch sonst sehen darfst. Vorgänge erscheinen für Betriebsrat und Geschäftsführung erst, wenn sie vorgelegt wurden.",
          "Vorgänge findest du auch über ihre Nummer, zum Beispiel EV-2026-014.",
        ],
      },
    ],
  },
  {
    version: "0.4.0",
    date: "2026-11-15",
    summary: "Evergreen hat ein neues Aussehen.",
    sections: [
      {
        area: "Evergreen",
        entries: [
          "Vorgänge erscheinen als Karten. Die Filter zeigen, wie viele Vorgänge offen sind, auf dich warten oder abgeschlossen sind.",
          "Auf großen Bildschirmen steht der geöffnete Vorgang neben der Liste, sodass du schnell zwischen Vorgängen wechseln kannst.",
          "Im Vorgang siehst du oben Status und Frist, darunter eine Schrittleiste mit dem Stand im Ablauf. Die Entscheidung steht in einem hervorgehobenen Bereich, das Protokoll als übersichtliche Liste.",
        ],
      },
    ],
  },
  {
    version: "0.3.0",
    date: "2026-11-14",
    summary: "Neue Seite „Konto“ und Profilbilder.",
    sections: [
      {
        area: "Allgemein",
        entries: [
          "Neue Seite „Konto“: Ein Klick auf deinen Namen oben rechts zeigt deine Angaben, deine Rollen und was sie erlauben, deine Sitzung und die Version der Werkbank.",
          "Die Auswahl für den hellen und dunklen Modus findest du jetzt auf der Seite „Konto“.",
          "Profilbild: Ist die Funktion eingeschaltet, zeigt die Werkbank dein Bild aus Microsoft Entra ID. Es wird bei jeder Anmeldung aktualisiert und ist für alle Angemeldeten sichtbar. Ohne Bild erscheinen deine Initialen.",
        ],
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-11-14",
    summary: "Die M365-Konfiguration hat ein neues Aussehen und zeigt mehr auf einen Blick.",
    sections: [
      {
        area: "M365-Konfiguration",
        entries: [
          "Übersicht mit Kennzahlen: offene Änderungen und wie viele davon kritisch sind, Änderungen der letzten 7 und 30 Tage, ein Diagramm der Änderungen pro Tag und die letzten Änderungen.",
          "Änderungen: Filter mit Anzahl je Bewertung. Ein Klick auf eine Änderung zeigt daneben Vorher und Nachher, die Beschreibung der Einstellung und die Bewertung mit Vorschlägen für den Kommentar.",
          "Einstellungen sind nach Workload gruppiert.",
          "Die Seite einer Einstellung zeigt Wert, Gültigkeit, Kritikalität und Soll-Wert auf einen Blick, den Verlauf als Zeitleiste und einen Hinweis, wenn der Soll-Wert aus einem Evergreen-Vorgang stammt.",
        ],
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-11-14",
    summary: "Erste Version der Werkbank mit den Modulen M365-Konfiguration und Evergreen.",
    sections: [
      {
        area: "Allgemein",
        entries: [
          "Anmeldung mit dem Firmenkonto. Was du siehst und tun darfst, richtet sich nach deinen Rollen.",
          "Startseite mit deinen Aufgaben aus allen Modulen und einer Kachel je Modul.",
          "Heller und dunkler Modus. „Automatisch“ folgt der Einstellung deines Geräts; die Auswahl findest du unten in der Navigation.",
          "Die Werkbank lässt sich auf Handy, Tablet und Rechner wie eine App installieren. Gibt es eine neue Version, erscheint ein Hinweis „Neu laden“.",
          "Audit-Log mit Filtern und CSV-Export sowie eine Übersicht der Rollen in der Verwaltung.",
        ],
      },
      {
        area: "M365-Konfiguration",
        entries: [
          "Die Werkbank liest einmal täglich die überwachten Einstellungen aus dem Tenant und erkennt, was neu ist, geändert oder entfernt wurde – wenn möglich mit der Angabe, wer es geändert hat.",
          "Änderungen lassen sich einzeln oder gesammelt als gewollt oder ungewollt bewerten.",
          "Zu jeder Einstellung gibt es den Verlauf sowie Beschreibung, Begründung, Kritikalität, Verantwortliche und einen Soll-Wert. Weicht der gelesene Wert vom Soll-Wert ab, erscheint eine Aufgabe.",
        ],
      },
      {
        area: "Evergreen",
        entries: [
          "Vorgänge führen neue Funktionen von Microsoft von der IT-Bewertung über Fachabteilungen, Betriebsrat und Geschäftsführung bis zur Umsetzung.",
          "Meldungen aus dem Nachrichtencenter von Microsoft landen im Eingang. Größere Änderungen und Meldungen mit Frist werden automatisch zu Vorgängen.",
          "Beschlüsse des Betriebsrats und der Geschäftsführung können im Auftrag erfasst werden, mit Sitzungsdatum und Inhalt.",
          "Geplante Umsetzung mit Soll-Werten: Die Werkbank prüft am Tenant, ob umgesetzt wurde, und schließt den Vorgang dann von selbst.",
        ],
      },
    ],
  },
];

export const CURRENT_VERSION = RELEASES[0]?.version ?? "";

const SEEN_KEY = "werkbank-neuigkeiten-gesehen";

/** true, wenn die Person die Neuigkeiten der aktuellen Version noch nicht geöffnet hat. */
export function hasUnseenRelease(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) !== CURRENT_VERSION;
  } catch {
    return false;
  }
}

export function markReleaseSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, CURRENT_VERSION);
  } catch {
    // Speicher gesperrt: Der Hinweis „neu“ bleibt dann stehen.
  }
}
