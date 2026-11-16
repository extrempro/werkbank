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
