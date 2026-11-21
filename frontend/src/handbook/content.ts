import type { Chapter } from "./types";

const ADMIN = "Werkbank.Admin";
const CONFIG_READER = "Config.Reader";
const CONFIG_REVIEWER = "Config.Reviewer";
const EV_READER = "Evergreen.Reader";
const EV_EDITOR = "Evergreen.Editor";
const TENANT = "Tenant.Reader";
const BUDGET_READER = "Budget.Reader";
const BUDGET_EDITOR = "Budget.Editor";
const BUDGET_MANAGER = "Budget.Manager";
const TOOLS = "Tools.User";
const MONITORING = "Monitoring.Reader";
const PROJECTS_READER = "Projekte.Reader";
const PROJECTS_EDITOR = "Projekte.Editor";
const INVENTORY_READER = "Bestand.Reader";
const INVENTORY_EDITOR = "Bestand.Editor";
const DEVICES = "Geraete.Zuordnung";

/**
 * Das Handbuch der Werkbank. Bei jeder Änderung an der Anwendung prüfen, ob ein Kapitel
 * angepasst werden muss (CLAUDE.md). Sprache: einfach, „du“, keine Begriffe aus der Entwicklung.
 */
export const CHAPTERS: readonly Chapter[] = [
  {
    id: "erste-schritte",
    title: "Erste Schritte",
    summary: "Anmelden, sich zurechtfinden, Aufgaben, Glocke, Suche und dein Konto.",
    roles: null,
    sections: [
      {
        id: "was-ist-die-werkbank",
        title: "Was ist die Werkbank?",
        blocks: [
          {
            kind: "text",
            text: "Die Werkbank ist die Plattform der IT für wiederkehrende Arbeit rund um Microsoft 365, Freigaben, das IT-Budget und kleine Werkzeuge. Jeder Bereich ist ein eigenes Modul. Was du siehst, hängt von deinen Rollen ab: Wer zum Beispiel nur Evergreen lesen darf, sieht nur die Startseite und Evergreen.",
          },
          {
            kind: "terms",
            items: [
              ["Werkbank", "Startseite und Suche"],
              [
                "Microsoft 365",
                "Einstellungen des Tenants, Lizenzen, Benutzerzahlen, Zertifikate, Dienststatus und das Zuordnen neuer Geräte",
              ],
              [
                "Evergreen",
                "Neuerungen von Software (zurzeit Microsoft 365) sichten, mit Notizen festhalten und abschließen",
              ],
              [
                "IT-Budget",
                "Konten, Budgetposten, Verträge, Rechnungen und Partner je Geschäftsjahr",
              ],
              ["IT-Tools", "Rechner, Generatoren und Konverter für den IT-Alltag"],
              ["IT-Monitoring", "regelmäßige Prüfungen, z. B. ob das DNS zu NetBox passt"],
            ],
          },
        ],
      },
      {
        id: "anmelden",
        title: "Anmelden und abmelden",
        blocks: [
          {
            kind: "steps",
            items: [
              "Öffne die Adresse der Werkbank im Browser.",
              "Wähle „Mit Microsoft anmelden“ und melde dich mit deinem Firmenkonto an. Je nach Einstellung fragt Microsoft nach einem zweiten Faktor.",
              "Nach der Anmeldung landest du auf der Startseite.",
            ],
          },
          {
            kind: "text",
            text: "Anmelden kann sich nur, wem die IT eine Rolle für die Werkbank gegeben hat. Fehlt sie, meldet die Anmeldeseite das.",
          },
          {
            kind: "text",
            text: "Die Sitzung endet nach 30 Minuten ohne Aktivität und spätestens nach 8 Stunden. Dann zeigt die Werkbank einen Hinweis und du meldest dich neu an. Mit „Abmelden“ im Kontomenü oben rechts (dein Bild oder deine Initialen) beendest du die Sitzung sofort.",
          },
          {
            kind: "hint",
            text: "Für die Verwaltung verlangt die Werkbank eine frische Anmeldung, wenn deine letzte länger als 15 Minuten zurückliegt. Microsoft fragt dann noch einmal nach deinem Kennwort.",
          },
        ],
      },
      {
        id: "aufbau",
        title: "Aufbau der Oberfläche",
        blocks: [
          {
            kind: "list",
            items: [
              "Kopfzeile: Name der Werkbank, Suchfeld, Glocke für Benachrichtigungen, „Meine Aufgaben“ und rechts dein Kontomenü.",
              "Bereichsleiste ganz links: ein Symbol je Bereich, zum Beispiel Start, M365, Evergreen, Monitoring, Bestand, Budget, Projekte und Tools. Fährst du mit der Maus darüber, steht der volle Name da. Ganz unten stehen Verwaltung (nur für Admins) und das Handbuch.",
              "Ein Punkt an einem Symbol zeigt: In diesem Bereich warten Aufgaben auf dich.",
              "Seitenmenü daneben: oben der Name des Bereichs, darunter seine Seiten in Gruppen. Eine Gruppe klappst du mit einem Klick auf ihre Überschrift auf oder zu; dein Browser merkt sich das. Zähler zeigen, wie viele Aufgaben auf einer Seite warten.",
              "„Menü einklappen“ unten im Seitenmenü lässt nur die Bereichsleiste stehen. Ein Klick auf einen Bereich öffnet das Menü wieder.",
              "Kontomenü oben rechts: Konto, Release Notes, hell, dunkel oder automatisch, „Zuletzt besucht leeren“ und „Abmelden“.",
              "Auf dem Handy steht unten eine Leiste mit Start, Suche, Aufgaben und Menü. „Menü“ zeigt erst die Seiten des aktuellen Bereichs; über „Alle Bereiche“ kommst du in jeden anderen.",
            ],
          },
          {
            kind: "hint",
            text: "Siehst du eine Seite nicht oder meldet die Werkbank „Seite nicht gefunden“, fehlt dir meist die passende Rolle. Wende dich dann an die IT.",
          },
        ],
      },
      {
        id: "aufgaben",
        title: "Startseite und „Meine Aufgaben“",
        blocks: [
          {
            kind: "text",
            text: "Die Startseite sammelt, was gerade für dich zu tun ist, aus allen Bereichen: zum Beispiel Änderungen bewerten, Vorgänge in deinem Schritt, Rechnungen buchen oder ablaufende Zertifikate. Jede Aufgabe führt mit einem Klick auf die passende Seite.",
          },
          {
            kind: "text",
            text: "Aufgaben werden nicht abgehakt. Sie verschwinden von selbst, sobald die Sache erledigt ist. Die Zähler laden bei jedem Seitenwechsel, nach jeder Änderung und alle fünf Minuten neu.",
          },
          {
            kind: "text",
            text: "„Letzte Aktivitäten“ zeigt die acht neuesten Meldungen der Glocke, gelesen oder nicht, zum Beispiel neue Änderungen, Vorgänge oder Störungen. Ein Klick öffnet die passende Seite und markiert die Meldung als gelesen. Welche Arten du bekommst, stellst du im Konto unter Benachrichtigungen ein.",
          },
        ],
        links: [{ to: "/", label: "Zur Startseite" }],
      },
      {
        id: "anheften",
        title: "Seiten anheften und „Zuletzt besucht“",
        blocks: [
          {
            kind: "text",
            text: "Seiten, die du oft brauchst, heftest du mit dem Stern an. Der Stern steht neben jeder Seite im Seitenmenü (er erscheint, wenn du mit der Maus darüber fährst oder mit der Tastatur hinkommst) und neben der Überschrift der Seite. Ein gefüllter Stern heißt: angeheftet.",
          },
          {
            kind: "list",
            items: [
              "Angeheftete Seiten stehen im Bereich Start unter „Angeheftet“ und auf der Startseite, jeweils mit dem Namen ihres Bereichs. Du kannst bis zu 20 Seiten anheften.",
              "„Zuletzt besucht“ zeigt die letzten fünf Seiten, die du geöffnet hast. Leeren kannst du die Liste im Kontomenü.",
              "Beides gilt für dein Konto, also auf jedem Gerät. Fehlt dir später eine Rolle, verschwindet die Seite aus der Liste.",
              "Am Handy siehst du angeheftete Seiten im Menü an einem kleinen Stern. Anheften geht am Computer oder Tablet.",
            ],
          },
        ],
      },
      {
        id: "benachrichtigungen",
        title: "Benachrichtigungen (Glocke)",
        blocks: [
          {
            kind: "text",
            text: "Die Glocke oben rechts meldet, was sich in deinen Bereichen getan hat, zum Beispiel eine neue Rechnung zur Prüfung, ein Vorgang, der auf dich wartet, eine Störung bei Microsoft 365 oder ein Zertifikat, das bald abläuft. Die Zahl an der Glocke zeigt die ungelesenen.",
          },
          {
            kind: "steps",
            items: [
              "Wähle die Glocke. Es öffnen sich die neuesten zehn Benachrichtigungen; ungelesene sind fett und links markiert.",
              "Ein Klick auf eine Benachrichtigung öffnet die passende Seite und markiert sie als gelesen.",
              "„Alle als gelesen“ setzt alle auf gelesen. Escape oder ein Klick daneben schließt die Liste.",
              "„Alle anzeigen“ öffnet die Seite „Benachrichtigungen“ mit den letzten 100.",
            ],
          },
          {
            kind: "text",
            text: "„Alle anzeigen“ zeigt die Benachrichtigungen der letzten 90 Tage. Die Werkbank sieht alle fünf Minuten nach Neuem.",
          },
          {
            kind: "steps",
            items: [
              "Öffne die Seite „Konto“ (Klick auf deinen Namen oben rechts).",
              "Unter „Benachrichtigungen“ steht je Art, ob du sie in der Glocke, per Mail, in Teams oder als Push bekommst.",
              "Für Push: zuerst „Push auf diesem Gerät einschalten“ und die Mitteilungen erlauben, dann je Art die Spalte „Push“ anhaken. Auf iPhone und iPad geht das nur in der Werkbank-App vom Home-Bildschirm (Safari › Teilen › „Zum Home-Bildschirm“).",
              "Hake an, was du möchtest. Jede Änderung gilt sofort.",
            ],
          },
          {
            kind: "text",
            text: "Push kommt nach wenigen Minuten auf alle deine angemeldeten Geräte und nennt nur Bereich und Anzahl, zum Beispiel „IT-Budget: 2 neue Benachrichtigungen“. Ein Tippen öffnet die Benachrichtigungen. Geräte und eine Testnachricht findest du ebenfalls im Konto. Anfangs ist alles in der Glocke an, Mail, Teams und Push sind aus. Per Mail und in Teams bekommst du höchstens alle 15 Minuten eine Sammelnachricht: wie viele Benachrichtigungen es in welchem Bereich gibt, mit einem Link in die Werkbank. Was genau passiert ist, steht nur in der Werkbank. Mitgeteilt wird nur, was nach dem Einschalten entsteht und was du noch nicht gelesen hast.",
          },
          {
            kind: "hint",
            text: "Die Glocke kennt nur Arten, die zu deinen Rollen passen. Bekommst du eine neue Rolle, meldet sie ab deiner nächsten Anmeldung auch die neuen Arten. Schaltest du eine Art in der Glocke aus, gibt es dafür auch keine Mail und kein Teams. Mail und Teams lassen sich nur wählen, wenn die Verwaltung sie eingerichtet hat.",
          },
        ],
        links: [
          { to: "/benachrichtigungen", label: "Zu den Benachrichtigungen" },
          { to: "/konto", label: "Zu den Einstellungen im Konto" },
        ],
      },
      {
        id: "suche",
        title: "Suche",
        blocks: [
          {
            kind: "text",
            text: "Das Suchfeld in der Kopfzeile öffnet die Schnellsuche, ebenso Strg+K (am Mac ⌘K). Sie findet Seiten der Werkbank nach Name, Gruppe und Bereich, zum Beispiel „Rechnungen“ oder „Budget Statistik“. Ohne Eingabe zeigt sie, was du zuletzt besucht hast. Mit den Pfeiltasten wählst du einen Treffer, Enter öffnet ihn, Escape schließt die Suche. Auf dem Handy öffnest du sie mit „Suche“ in der Leiste unten.",
          },
          {
            kind: "text",
            text: "„In allen Einträgen suchen“ unten in der Schnellsuche führt zur Seite „Suche“. Sie sucht in allem, was du sehen darfst: Einstellungen, erkannte Änderungen, Evergreen-Einträge, Budgetposten, IT-Tools und dieses Handbuch.",
          },
          {
            kind: "list",
            items: [
              "Vorgänge findest du auch über ihre Nummer, z. B. EV-2026-014.",
              "Einstellungen findest du über Name, Pfad, Beschreibung oder Begründung.",
              "Budgetposten findest du über Name, Notiz und Tag.",
            ],
          },
        ],
        links: [{ to: "/suche", label: "Zur Suche" }],
      },
      {
        id: "konto",
        title: "Konto, Darstellung und Neuigkeiten",
        blocks: [
          {
            kind: "text",
            text: "Das Kontomenü oben rechts (dein Bild oder deine Initialen) führt zur Seite „Konto“: deine Angaben aus Microsoft, deine Rollen mit kurzer Erklärung, Beginn und Ende der Sitzung, die Darstellung (automatisch, hell oder dunkel) die Schriftgröße im Menü (klein, normal, groß, sehr groß) und die Abstände im Menü (kompakt, normal, weiträumig; mit dem Finger bleiben Einträge immer gut antippbar; alles gilt nur für diesen Browser), deine Benachrichtigungen (Glocke, Mail, Teams) und die Version der Werkbank.",
          },
          {
            kind: "text",
            text: "„Release Notes“ im Kontomenü öffnet die Neuigkeiten: je Version, was sich geändert hat. Gibt es Neues, das du noch nicht gesehen hast, zeigt das Kontomenü einen Punkt. Hell, dunkel oder automatisch stellst du direkt im Kontomenü um.",
          },
          {
            kind: "text",
            text: "Gibt es eine neue Version der Werkbank, zeigt sie „Neue Version verfügbar“. Lade dann neu, sobald du mit deiner Eingabe fertig bist.",
          },
        ],
        links: [
          { to: "/konto", label: "Zum Konto" },
          { to: "/neuigkeiten", label: "Zu den Neuigkeiten" },
        ],
      },
      {
        id: "app",
        title: "Als App auf Handy oder Rechner",
        blocks: [
          {
            kind: "text",
            text: "Die Werkbank lässt sich wie eine App installieren. Auf dem iPhone: in Safari „Teilen“ und „Zum Home-Bildschirm“. Auf Android und am Rechner bietet der Browser „Installieren“ bzw. „App installieren“ an.",
          },
          {
            kind: "text",
            text: "Ohne Verbindung zeigt die Werkbank nur einen Hinweis. Fachliche Daten liegen nie auf dem Gerät.",
          },
        ],
      },
      {
        id: "rollen",
        title: "Rollen im Überblick",
        blocks: [
          {
            kind: "text",
            text: "Rollen vergibt die IT über Gruppen in Microsoft Entra. Eine Person kann mehrere Rollen haben. Welche du hast, steht auf der Seite „Konto“.",
          },
          {
            kind: "terms",
            items: [
              ["Werkbank.Admin", "Verwaltung der Werkbank und das vollständige Audit-Log"],
              ["Config.Reader", "Einstellungen, Änderungen und Snapshots des Tenants ansehen"],
              ["Config.Reviewer", "zusätzlich Änderungen bewerten, Angaben und Soll-Werte pflegen"],
              [
                "Tenant.Reader",
                "Lizenzen, Benutzerzahlen, Zertifikate, Dienststatus und Nutzung ansehen",
              ],
              ["Evergreen.Reader", "Evergreen-Einträge und ihre Notizen ansehen"],
              [
                "Evergreen.Editor",
                "Evergreen-Einträge anlegen, Notizen anfügen, abschließen und wieder öffnen",
              ],
              ["Budget.Reader", "das IT-Budget ansehen"],
              ["Budget.Editor", "Konten, Posten, Verträge, Partner und Rechnungen pflegen"],
              [
                "Budget.Manager",
                "zusätzlich Rechnungen buchen, Partner zusammenlegen, Einstellungen des Budgets",
              ],
              ["Tools.User", "den Bereich IT-Tools öffnen"],
              ["Monitoring.Reader", "den Bereich IT-Monitoring ansehen"],
              ["Projekte.Reader", "die IT-Projekte ansehen"],
              [
                "Projekte.Editor",
                "IT-Projekte anlegen und pflegen: Einstellungen, Jour Fixe und Aufgaben",
              ],
              ["Bestand.Reader", "den IT-Bestand ansehen: Hardware und Stammdaten"],
              [
                "Bestand.Editor",
                "Hardware erfassen, Inventurnummern setzen, Geräte ausmustern, Stammdaten pflegen",
              ],
              [
                "Geraete.Zuordnung",
                "neue Windows-Geräte per QR-Code scannen und dem Tenant zuordnen",
              ],
            ],
          },
        ],
      },
    ],
  },
  {
    id: "m365-konfiguration",
    title: "Microsoft 365: Konfiguration",
    summary:
      "Einstellungen des Tenants mit Verlauf, erkannte Änderungen, Soll-Werte und Empfehlungen.",
    roles: [CONFIG_READER, CONFIG_REVIEWER],
    sections: [
      {
        id: "prinzip",
        title: "So funktioniert es",
        blocks: [
          {
            kind: "text",
            text: "Die Werkbank liest einmal am Tag die Einstellungen des Microsoft-365-Tenants, zum Beispiel Richtlinien für den bedingten Zugriff in Entra oder organisationsweite Einstellungen von Exchange. Sie liest nur, sie ändert nichts im Tenant.",
          },
          {
            kind: "text",
            text: "Jeder Abruf wird mit dem letzten Stand verglichen. Was neu ist, sich geändert hat oder weggefallen ist, erscheint als Änderung zur Bewertung. Jede Einstellung hat einen Verlauf: wann sie welchen Wert hatte.",
          },
          {
            kind: "hint",
            text: "Der erste Abruf ist der Ausgangsstand. Er erscheint nicht als Änderung.",
          },
        ],
      },
      {
        id: "uebersicht",
        title: "Übersicht",
        blocks: [
          {
            kind: "text",
            text: "Die Übersicht zeigt Kennzahlen (offene Änderungen, Änderungen der letzten 7 und 30 Tage, überwachte Einstellungen, Abweichungen vom Soll-Wert, letzter Abruf, gelesene Objekte in diesem Monat), die Änderungen pro Tag als Diagramm und die letzten Änderungen.",
          },
        ],
        links: [{ to: "/m365", label: "Zur Übersicht" }],
      },
      {
        id: "einstellungen",
        title: "Einstellungen",
        blocks: [
          {
            kind: "text",
            text: "Die Seite „Einstellungen“ zeigt alle überwachten Einstellungen als Baum: Dienst (Entra, Exchange, Teams, SharePoint, je nachdem, was die Einrichtung abruft), darin die Bereiche (z. B. Bedingter Zugriff), darin die Objekte (z. B. eine Richtlinie). Erst ein aufgeklapptes Objekt zeigt seine Eigenschaften mit kurzem Wert. Neben jedem Knoten stehen offene Änderungen und Abweichungen vom Soll-Wert, so siehst du schon zugeklappt, wo etwas zu tun ist. Bei Suche oder „Nur Abweichungen“ sind Dienste und Bereiche gleich aufgeklappt. Ein Klick auf eine Eigenschaft öffnet die Einzelheiten daneben:",
          },
          {
            kind: "list",
            items: [
              "aktueller Wert und seit wann er gilt",
              "Beschreibung, „Warum bei uns so“, Kritikalität (niedrig, mittel, hoch), Soll-Wert, Verantwortlich und ein Link zu Microsoft Learn",
              "zugeordnete Empfehlungen von Microsoft",
              "Verlauf der Werte und Verlauf der Angaben (wer hat wann was geändert)",
            ],
          },
          {
            kind: "steps",
            items: [
              "Öffne die Einstellung und wähle „Angaben bearbeiten“.",
              "Trage Beschreibung, Begründung, Kritikalität, Soll-Wert, Verantwortlich oder Link ein. Der Link muss mit https:// beginnen.",
              "Speichere. Jede Änderung steht mit Person und Zeitpunkt im Verlauf der Angaben.",
            ],
          },
        ],
        links: [{ to: "/m365/einstellungen", label: "Zu den Einstellungen" }],
      },
      {
        id: "ki-texte",
        title: "Beschreibungen mit KI",
        roles: [CONFIG_REVIEWER, ADMIN],
        blocks: [
          {
            kind: "text",
            text: "Wenn die Verwaltung KI-Texte eingeschaltet hat, schlägt die Werkbank für Einstellungen ohne eigene Beschreibung einen verständlichen Text vor. Er ist als „KI-generiert, ungeprüft“ gekennzeichnet, bis du ihn übernimmst oder verwirfst. Übergeben werden nur Dienst, Bereich und Name der Eigenschaft, nie Werte oder Namen.",
          },
        ],
      },
      {
        id: "aenderungen",
        title: "Änderungen bewerten",
        blocks: [
          {
            kind: "text",
            text: "Die Seite „Änderungen“ listet erkannte Änderungen mit Art (neu, geändert, entfernt), Zeitpunkt und, wenn bekannt, wer geändert hat. Ein Klick zeigt vorher und nachher. Filter: offen, ungewollt, gewollt, alle. Die Liste ist nach Dienst und Bereich gegliedert, der Bereich mit der neuesten Änderung oben. Über „Dienst und Bereich“ zeigst du nur einen Dienst oder einen Bereich.",
          },
          {
            kind: "steps",
            items: [
              "Wähle eine oder mehrere Änderungen aus. „Alle auswählen“ an einem Bereich wählt alle geladenen Änderungen darin.",
              "Unter „Auswahl bewerten“ wählst du „gewollt“ oder „ungewollt“ und schreibst bei Bedarf einen Kommentar.",
              "Bestätige. Alle gewählten Änderungen bekommen dieselbe Bewertung und denselben Kommentar.",
            ],
          },
          {
            kind: "hint",
            text: "Ein Kommentar ist Pflicht bei „ungewollt“ und bei „gewollt“ für Einstellungen mit Kritikalität „hoch“. Er braucht mindestens 10 Zeichen oder eine Ticketnummer wie #123, CHG-123 oder INC-123. Solange er fehlt, bleibt der Knopf gesperrt.",
          },
          {
            kind: "text",
            text: "Eine Bewertung lässt sich zurücksetzen; auch das wird protokolliert. Mit der Rolle Evergreen.Editor kannst du aus einer Änderung einen Evergreen-Eintrag anlegen.",
          },
        ],
        roles: [CONFIG_REVIEWER, ADMIN],
        links: [{ to: "/m365/aenderungen", label: "Zu den Änderungen" }],
      },
      {
        id: "aenderungen-lesen",
        title: "Änderungen ansehen",
        roles: [CONFIG_READER],
        blocks: [
          {
            kind: "text",
            text: "Die Seite „Änderungen“ listet erkannte Änderungen mit Art (neu, geändert, entfernt), Zeitpunkt, wer geändert hat und der Bewertung. Ein Klick zeigt vorher und nachher. Bewerten dürfen Personen mit der Rolle Config.Reviewer.",
          },
        ],
        links: [{ to: "/m365/aenderungen", label: "Zu den Änderungen" }],
      },
      {
        id: "soll-werte",
        title: "Soll-Werte und Abweichungen",
        blocks: [
          {
            kind: "text",
            text: "Ein Soll-Wert legt fest, wie eine Einstellung sein soll, von Hand. Weicht der gelesene Wert ab, ist die Einstellung markiert, die Übersicht zählt sie, und Reviewer bekommen eine Aufgabe und eine Benachrichtigung.",
          },
        ],
      },
      {
        id: "empfehlungen",
        title: "Empfehlungen",
        blocks: [
          {
            kind: "text",
            text: "„Empfehlungen“ zeigt die Empfehlungen aus Microsoft Secure Score mit Stand und Punkten im Tenant: offen, erfüllt oder alle. Die Einzelheiten nennen den Stand, die Umsetzung laut Microsoft und die zugeordneten Einstellungen.",
          },
          {
            kind: "text",
            text: "Microsoft verbindet Empfehlungen nicht mit einzelnen Einstellungen. Reviewer ordnen sie deshalb von Hand zu; danach steht die Empfehlung auch bei der Einstellung.",
          },
        ],
        links: [{ to: "/m365/empfehlungen", label: "Zu den Empfehlungen" }],
      },
      {
        id: "snapshots",
        title: "Snapshots",
        blocks: [
          {
            kind: "text",
            text: "Jeder Abruf ist ein Snapshot mit Zeitpunkt, Status und Zahl der Änderungen. Schlägt ein Abruf fehl, zeigt die Liste den Fehler, und die Verwaltung bekommt eine Aufgabe. Fehlt dabei eine Quelle, gelten ihre Einstellungen nicht als entfernt.",
          },
          {
            kind: "text",
            text: "Unter „Zwei Abrufe vergleichen“ wählst du einen Abruf für vorher und einen für nachher. Die Liste zeigt jede Einstellung, die neu ist, sich geändert hat oder weggefallen ist, mit dem Wert vorher und nachher. Der ältere Abruf gilt immer als vorher. Fehlgeschlagene Abrufe haben keinen eigenen Stand und stehen nicht zur Auswahl.",
          },
          {
            kind: "text",
            text: "Über JSON oder CSV in der Spalte Export lädst du den Stand eines Abrufs herunter: alle Einstellungen mit dem Wert, der damals galt. Die CSV öffnet sich direkt in Excel. Jeder Export steht im Audit-Log.",
          },
        ],
        links: [{ to: "/m365/snapshots", label: "Zu den Snapshots" }],
      },
    ],
  },
  {
    id: "m365-tenant",
    title: "Microsoft 365: Tenant",
    summary: "Lizenzen, Benutzerzahlen, Zertifikate und Secrets sowie der Dienststatus.",
    roles: [TENANT],
    sections: [
      {
        id: "lizenzen",
        title: "Lizenzen",
        blocks: [
          {
            kind: "text",
            text: "Die Liste zeigt je Lizenz: gekauft, zugewiesen, frei, Einheiten in der Kulanzfrist oder gesperrt, den nächsten Stichtag des Abos und ob es ein Testabo ist. Hinweise markieren Lizenzen, die aufgebraucht oder überbucht sind oder deren Stichtag in höchstens 30 Tagen liegt.",
          },
          {
            kind: "text",
            text: "Ein Klick öffnet den Verlauf als Diagramm. Jede Linie hat ihr eigenes Feld mit eigener Achse, die eng um ihre Werte liegt; so sind auch kleine Änderungen zu sehen. Achte deshalb auf die Zahlen an der Achse. Wähle den Zeitraum über die Knöpfe darüber; die Werte eines Tages zeigt der Zeiger oder der Regler, alle Werte stehen auch in einer Tabelle. Die Werkbank speichert je Tag einen Stand und bewahrt ihn drei Jahre auf.",
          },
        ],
        links: [{ to: "/m365/lizenzen", label: "Zu den Lizenzen" }],
      },
      {
        id: "benutzer",
        title: "Benutzer",
        blocks: [
          {
            kind: "text",
            text: "„Benutzer“ zeigt nur Zahlen mit Verlauf: Konten insgesamt, Mitglieder, Gäste, aktiv, deaktiviert und mit Lizenz. Namen einzelner Personen liest die Werkbank nicht.",
          },
        ],
        links: [{ to: "/m365/benutzer", label: "Zu den Benutzern" }],
      },
      {
        id: "zertifikate",
        title: "Zertifikate und Secrets",
        blocks: [
          {
            kind: "text",
            text: "Die Seite zeigt Zertifikate und Secrets der Anwendungen im Tenant mit Ablaufdatum und Restlaufzeit. Den geheimen Wert speichert die Werkbank nie.",
          },
          {
            kind: "terms",
            items: [
              ["Hinweis", "Ablauf rückt näher, im Blick behalten"],
              ["Warnung", "läuft bald ab, Erneuerung planen"],
              ["Dringend", "läuft in Kürze ab, jetzt erneuern"],
              ["Abgelaufen", "erneuern oder in Entra entfernen, wenn nicht mehr gebraucht"],
            ],
          },
          {
            kind: "text",
            text: "Die Grenzen (Vorgabe 60, 30 und 7 Tage) legt die Verwaltung fest. Die Liste zeigt „Handlungsbedarf“ oder „Alle“. Die Ansicht „Waben“ zeigt alles auf einen Blick; ein Klick auf eine Wabe zeigt die Einzelheiten. Gibt es keinen Handlungsbedarf, öffnet die Seite gleich mit den Waben.",
          },
        ],
        links: [{ to: "/m365/zugangsdaten", label: "Zu den Zertifikaten und Secrets" }],
      },
      {
        id: "dienststatus",
        title: "Dienststatus",
        blocks: [
          {
            kind: "text",
            text: "Der Dienststatus zeigt, ob Exchange Online, Microsoft Teams, SharePoint Online und Microsoft Entra laufen. Jede Kachel sagt „Störung“, „Hinweis“ oder „In Ordnung“, je nachdem, ob gerade eine Störung oder nur ein Hinweis offen ist, und nennt darunter die offenen Meldungen. Ein Klick darauf springt zur Meldung mit den Mitteilungen von Microsoft. Klein steht dabei, was Microsoft selbst als Zustand angibt. Die Werkbank fragt alle 15 Minuten bei Microsoft nach.",
          },
          {
            kind: "list",
            items: [
              "Offene Störungen und Hinweise stehen oben, darunter die in den letzten 30 Tagen beendeten: zuerst die fünf neuesten, „Alle anzeigen“ zeigt den Rest. Jeder Eintrag nennt Art, Dienst und Stand, darunter den Titel und Kennung, Zeitraum und Dauer. Aufgeklappt zeigt er die Mitteilungen von Microsoft.",
              "Das kleine Würfel-Symbol in der Kachel eines Dienstes zeigt dessen letzte 90 Tage als Kalender (jede Spalte eine Woche, Montag oben, jedes Feld ein Tag mit Störung, Hinweis oder ohne Meldung): mit der Maus beim Darüberfahren, auf dem Handy durch Antippen.",
              "Jeder Eintrag lässt sich im Microsoft 365 Admin Center öffnen. Dafür brauchst du dort eine Anmeldung.",
              "„Meldungen der letzten 90 Tage“ listet alle Meldungen dieses Zeitraums mit Datum und Dauer.",
              "„Ausfalldauer je Dienst“ zeigt die Stunden mit Störung je Jahr (gleichzeitige Störungen zählen einmal, Fehlalarme gar nicht), „Störungen pro Monat“ die Zahl der Störungen über drei Jahre, wählbar je Dienst.",
            ],
          },
          {
            kind: "hint",
            text: "Störung heißt: Microsoft meldet einen Ausfall oder eine Einschränkung. Hinweise sind Mitteilungen ohne Ausfall. Die Glocke meldet Beginn und Ende von Störungen, nicht Hinweise.",
          },
        ],
        links: [{ to: "/m365/dienststatus", label: "Zum Dienststatus" }],
      },
      {
        id: "nutzung",
        title: "Nutzung",
        blocks: [
          {
            kind: "text",
            text: "Die Seite „Nutzung“ zeigt, wie viele Benutzer Exchange, OneDrive, SharePoint, Teams und Viva Engage im gewählten Zeitraum (7, 30, 90 oder 180 Tage) genutzt haben. Inaktiv heißt: Die Person hat eine Lizenz für den Dienst, war im Zeitraum aber nicht aktiv. Darunter steht der Verlauf der aktiven Benutzer je Tag; über die Schalter wählst du den Dienst, die Werte stehen auch als Tabelle darunter.",
          },
          {
            kind: "hint",
            text: "Die Zahlen stammen aus den Nutzungsberichten von Microsoft und hängen etwa zwei Tage hinterher. Die Werkbank liest nur Summen, nie, wer etwas genutzt hat.",
          },
        ],
        links: [{ to: "/m365/nutzung", label: "Zur Nutzung" }],
      },
    ],
  },
  {
    id: "geraetezuordnung",
    title: "Microsoft 365: Gerätezuordnung",
    summary:
      "Neue Windows-Geräte per QR-Code dem Tenant zuordnen und verfolgen, bis sie in Intune sind.",
    roles: [DEVICES],
    sections: [
      {
        id: "worum-es-geht",
        title: "Worum es geht",
        blocks: [
          {
            kind: "text",
            text: "Ein neues Windows-Gerät zeigt in der Einrichtung einen QR-Code. Du scannst ihn mit dem Handy oder am PC, die Werkbank meldet das Gerät bei Microsoft für euren Tenant an und verfolgt es, bis es in Intune registriert ist.",
          },
          {
            kind: "text",
            text: "Du arbeitest mit zwei Konten: Angemeldet bist du mit deinem Office-Konto. Das Zuordnen bei Microsoft läuft mit deinem Admin-Konto, das die Rechte in Intune hat. Dafür meldest du dich auf der Seite zusätzlich mit dem Admin-Konto an. Die Verbindung gilt höchstens eine Stunde und endet mit „Trennen“ oder beim Abmelden.",
          },
          {
            kind: "hint",
            text: "Ohne Admin-Konto kannst du scannen und das Gerät zur Freigabe senden. Freigeben kann dann jemand mit Admin-Konto, auch später am PC.",
          },
        ],
        links: [{ to: "/m365/geraete/zuordnung", label: "Zur Gerätezuordnung" }],
      },
      {
        id: "scannen",
        title: "Gerät scannen",
        blocks: [
          {
            kind: "steps",
            items: [
              "Am neuen Gerät in der Einrichtung (bei der Auswahl der Region) fünfmal die Windows-Taste drücken und „Scan QR code“ wählen.",
              "In der Werkbank „QR-Code scannen“ wählen und den Code ins Feld halten. Geht die Kamera nicht, nimm „Foto auswählen“ und fotografiere den Code.",
              "Gerätedaten prüfen: Hersteller, Modell, Seriennummer. Gibt es das Gerät schon, ist eine zweite Zuordnung gesperrt; „Eintrag öffnen“ zeigt den vorhandenen Eintrag.",
              "Richtlinie wählen, falls nötig, und bestätigen, dass das Gerät in den angezeigten Tenant gehört.",
              "„Jetzt freigeben“ (mit Admin-Konto) oder „Zur Freigabe senden“.",
              "Nach „Vorab zugeordnet“ am Gerät auf „Weiter“ klicken. Den Rest prüft die Werkbank von selbst.",
            ],
          },
        ],
      },
      {
        id: "freigabe",
        title: "Zur Freigabe senden, freigeben, verwerfen",
        blocks: [
          {
            kind: "text",
            text: "„Zur Freigabe senden“ legt das Gerät unter „Wartet auf Freigabe“ ab. Die Gerätedaten liegen verschlüsselt in der Werkbank und werden nach 24 Stunden gelöscht, wenn niemand freigibt. Das Gerät wartet so lange in der Einrichtung.",
          },
          {
            kind: "list",
            items: [
              "Freigeben: Eintrag öffnen, mit dem Admin-Konto angemeldet „Jetzt freigeben“ wählen. Das kann auch eine andere Person sein.",
              "Verwerfen: Eintrag öffnen, „Verwerfen“ und bestätigen. Eintrag und Gerätedaten sind dann gelöscht; das Gerät muss neu gescannt werden.",
              "Wartende Geräte stehen als Aufgabe auf deiner Startseite.",
            ],
          },
        ],
      },
      {
        id: "status",
        title: "Status und Verlauf",
        blocks: [
          {
            kind: "terms",
            items: [
              ["Wartet auf Freigabe", "gescannt, noch nicht an Microsoft übertragen"],
              ["Vorab zugeordnet", "Microsoft kennt das Gerät; am Gerät auf „Weiter“ klicken"],
              ["Zugeordnet", "das Gerät hat die Zuordnung abgeschlossen und richtet sich ein"],
              ["In Intune registriert", "fertig; Gerätename und Konformität stehen im Eintrag"],
              [
                "Nicht abgeschlossen",
                "7 Tage ohne Fortschritt; die Werkbank prüft nicht mehr von selbst",
              ],
            ],
          },
          {
            kind: "text",
            text: "Die Werkbank prüft offene Geräte im Hintergrund alle 5 Minuten. „Status aktualisieren“ im Eintrag oder „Alle aktualisieren“ prüft sofort. Die Glocke meldet dir, wenn ein Gerät, das du gescannt oder freigegeben hast, zugeordnet oder in Intune registriert ist.",
          },
        ],
      },
      {
        id: "fehler",
        title: "Wenn etwas nicht klappt",
        blocks: [
          {
            kind: "terms",
            items: [
              [
                "Keine Berechtigung",
                "dem Admin-Konto fehlt die Rolle in Intune; anderes Konto nehmen oder die Rolle anfragen",
              ],
              ["Daten nicht akzeptiert", "den QR-Code neu scannen"],
              ["Zu viele Anfragen", "eine Minute warten und noch einmal versuchen"],
              [
                "Microsoft konnte das Gerät nicht zuordnen",
                "ein neuer Versuch hilft nicht; die Voraussetzungen am Gerät prüfen",
              ],
            ],
          },
          {
            kind: "list",
            items: [
              "Voraussetzungen: ein echtes Gerät (keine virtuelle Maschine), Windows 11 24H2 oder 25H2 mit aktuellem Update, TPM 2.0 aktiv, Secure Boot eingeschaltet.",
              "Bei Fehlern steht die Request-ID dabei. Kopiere sie für den Support von Microsoft.",
            ],
          },
        ],
      },
    ],
  },
  {
    id: "evergreen",
    title: "Evergreen",
    summary: "Neuerungen von Software sichten, mit Notizen festhalten und abschließen.",
    roles: [EV_READER, EV_EDITOR],
    sections: [
      {
        id: "worum-es-geht",
        title: "Worum es geht",
        blocks: [
          {
            kind: "text",
            text: "Software wie Microsoft 365 ändert sich laufend. In Evergreen hält die IT fest, welche Neuerungen es gibt, was sie für uns bedeuten und was zu tun ist. Jede Neuerung ist ein Eintrag mit einer Nummer wie EV-2026-014.",
          },
          {
            kind: "text",
            text: "Je Software gibt es einen eigenen Abschnitt. Zurzeit ist das Microsoft 365; weitere können später dazukommen.",
          },
          {
            kind: "terms",
            items: [
              ["Neu", "noch niemand hat sich den Eintrag angesehen"],
              ["Bearbeitet", "es gibt mindestens eine Notiz"],
              ["Abgeschlossen", "nichts mehr zu tun; lässt sich wieder öffnen"],
            ],
          },
        ],
      },
      {
        id: "eintraege",
        title: "Woher die Einträge kommen",
        blocks: [
          {
            kind: "list",
            items: [
              "Jede Meldung aus dem Nachrichtencenter von Microsoft wird automatisch ein Eintrag mit dem Status „Neu“. Ändert Microsoft die Meldung später, übernimmt die Werkbank den neuen Text und vermerkt das im Verlauf. Der Status bleibt.",
              "Bearbeiter legen mit „Neuer Eintrag“ selbst einen an, zum Beispiel für eine Neuerung, die nicht im Nachrichtencenter steht.",
              "Aus einer erkannten Änderung in der M365-Konfiguration machst du mit „Evergreen-Eintrag anlegen“ einen Eintrag.",
            ],
          },
        ],
        links: [{ to: "/evergreen/m365", label: "Zu Microsoft 365" }],
      },
      {
        id: "liste",
        title: "Liste und Ansicht",
        blocks: [
          {
            kind: "text",
            text: "Die Einträge stehen in einer Tabelle mit Nummer, Titel, Dienst, Eingang, der Person, die zuletzt etwas eingetragen hat, und dem Status. Oben suchst du nach Nummer, Titel, Kennung der Meldung (z. B. MC123456), Dienst oder Text und wählst den Status. Ein Klick auf eine Zeile öffnet den Eintrag rechts daneben; die Breite stellst du am Trenner dazwischen ein. Auf dem Handy öffnet sich der Eintrag über die ganze Breite, mit „Zur Liste“ geht es zurück.",
          },
          {
            kind: "text",
            text: "Der Text der Meldung steht als reiner Text in der Ansicht. Darunter folgen die Notizen und der Verlauf.",
          },
        ],
      },
      {
        id: "notizen",
        title: "Notizen anfügen und abschließen",
        roles: [EV_EDITOR],
        blocks: [
          {
            kind: "steps",
            items: [
              "Öffne den Eintrag.",
              "Schreib unter „Notizen und Verlauf“, was du herausgefunden oder erledigt hast, und wähle „Notiz anfügen“. Ein neuer Eintrag ist danach „Bearbeitet“.",
              "Weitere Notizen können du und andere Bearbeiter jederzeit anfügen.",
              "Ist nichts mehr zu tun, wähle „Abschließen“. Steht etwas im Feld, wird es die letzte Notiz.",
            ],
          },
          {
            kind: "hint",
            text: "Einen abgeschlossenen Eintrag öffnest du mit „Wieder öffnen“; er ist dann wieder „Bearbeitet“. Neue Einträge zählen als Aufgabe auf deiner Startseite, und du bekommst eine Benachrichtigung, wenn neue dazukommen.",
          },
        ],
      },
      {
        id: "lesen",
        title: "Nur lesen",
        roles: [EV_READER],
        blocks: [
          {
            kind: "text",
            text: "Mit der Rolle Evergreen.Reader siehst du alle Einträge mit ihren Notizen, kannst aber nichts ändern. Aufgaben und Benachrichtigungen aus Evergreen bekommst du nicht.",
          },
        ],
      },
    ],
  },
  {
    id: "it-budget",
    title: "IT-Budget",
    summary:
      "Konten, Budgetposten, Verträge, Rechnungen und Partner; Plan, Ist und Prognose je Geschäftsjahr.",
    roles: [BUDGET_READER, BUDGET_EDITOR, BUDGET_MANAGER],
    sections: [
      {
        id: "begriffe",
        title: "Begriffe",
        blocks: [
          {
            kind: "terms",
            items: [
              [
                "Geschäftsjahr",
                "zwölf Monate ab dem in den Einstellungen festgelegten Monat, angezeigt z. B. als „2026“ oder „2026/27“",
              ],
              ["Konto", "Sachkonto mit Nummer, laufende Kosten oder Investition"],
              [
                "Budgetposten",
                "ein Vorhaben unter einem Konto, z. B. eine Software, mit erwarteten Kosten je Geschäftsjahr und Laufzeit",
              ],
              [
                "Vertrag",
                "Vertrag mit einem Partner; kann zu einem oder mehreren Budgetposten gehören",
              ],
              [
                "Partner",
                "Firma als Vertragspartner, Rechnungssteller oder Partner eines Budgetpostens",
              ],
              [
                "Rechnung",
                "Kopf mit Rechnungssteller, Nummer und Datum und eine oder mehrere Positionen, jede auf einem Budgetposten",
              ],
              ["Plan", "die erwarteten Kosten der Budgetposten"],
              ["Ist", "Summe der gebuchten Rechnungspositionen (brutto) im Geschäftsjahr"],
              ["Prognose", "bei abgeschlossenen Posten das Ist, sonst das Höhere aus Plan und Ist"],
            ],
          },
          {
            kind: "text",
            text: "Alle Beträge im Budget sind brutto. Das auf einer Seite gewählte Geschäftsjahr gilt auch auf den anderen Seiten.",
          },
        ],
      },
      {
        id: "uebersicht",
        title: "Übersicht",
        blocks: [
          {
            kind: "text",
            text: "Die Übersicht zeigt Kennzahlen des Geschäftsjahrs, das Budget nach Konten mit Plan, Ist und Prognose, Kündigungstermine der nächsten 120 Tage und Handlungsbedarf wie zu prüfende Rechnungen.",
          },
        ],
        links: [{ to: "/budget", label: "Zur Übersicht" }],
      },
      {
        id: "posten",
        title: "Budgetposten",
        blocks: [
          {
            kind: "text",
            text: "Je Geschäftsjahr hat ein Posten einen Status: „offen“, „Rechnung liegt vor“ oder „abgeschlossen“. Abgeschlossen ist er, sobald du ihn mit „Abschließen“ abhakst (gilt für das oben gewählte Geschäftsjahr) oder eine gebuchte Rechnungsposition mit „schließt den Posten ab“ auf ihm liegt. „Wieder öffnen“ nimmt das Abhaken zurück; schließt eine Rechnung den Posten ab, entfernst du dafür den Haken an der Rechnungsposition. Die Liste zeigt je Posten den Partner, die erwarteten Kosten, das Ist und das Vorjahr. Ältere Posten ohne Partner tragen den Hinweis „Partner fehlt“; beim nächsten Bearbeiten wählst du ihn. Filter nach Suchtext (auch nach dem Partner), Status und Tag helfen beim Finden.",
          },
          {
            kind: "steps",
            items: [
              "Wähle „Posten hinzufügen“.",
              "Wähle das Konto und den Partner (die Firma, Pflicht), gib eine Bezeichnung und die erwarteten Kosten je Geschäftsjahr (brutto) ein.",
              "Lege die Laufzeit fest: einmalig, mehrere Jahre bis zu einem Geschäftsjahr oder bis auf Weiteres.",
              "Optional: Vertrag, IT-Projekt und Tags wählen; unter „Weitere Angaben“ die Notiz. Tags legt der Budgetverwalter unter Einstellungen › Tags an.",
              "Speichere.",
            ],
          },
          {
            kind: "text",
            text: "Nicht mehr gebrauchte Posten legst du still. Löschen geht nur, solange kein Vertrag zugeordnet ist und keine Rechnungsposition auf dem Posten liegt.",
          },
          {
            kind: "text",
            text: "Gehört ein Posten zu einem IT-Projekt, wähle das Projekt im Feld „Projekt“. Seine erwarteten Kosten und Rechnungen zählen dann im Projekt unter Budget mit. Ein Posten gehört höchstens zu einem Projekt; abgeschlossene Projekte stehen nicht mehr zur Wahl. Über den Filter „Projekt“ siehst du alle Posten eines Projekts.",
          },
        ],
        links: [{ to: "/budget/posten", label: "Zu den Budgetposten" }],
      },
      {
        id: "vertraege",
        title: "Verträge",
        blocks: [
          {
            kind: "text",
            text: "Ein Vertrag hat Partner, Betrag je Zahlung (netto mit Steuersatz), Turnus, Beginn, Laufzeit, Verlängerung, Kündigungsfrist und den Stand des Auftragsverarbeitungsvertrags (AVV). Die Zuordnung zu Budgetposten pflegst du am Vertrag oder am Posten.",
          },
          {
            kind: "list",
            items: [
              "Der Kündigungstermin ergibt sich aus Laufzeitende minus Kündigungsfrist. Ist er verstrichen, gilt der Termin der nächsten Laufzeit.",
              "Ab 60 Tagen vor dem Termin steht der Vertrag als Aufgabe auf der Startseite; die Glocke erinnert 60, 30 und 7 Tage vorher.",
              "Kosten kommen nur über Rechnungen ins Budget. Am Vertrag siehst du je Geschäftsjahr (Auswahl oben) das Soll und das Ist.",
              "Soll: die Zahlungen, die im Geschäftsjahr fällig werden. Bei einem jährlichen Vertrag ist das der Jahresbetrag. Bei einem monatlichen Vertrag trägst du den Monatsbetrag ein; die Liste zeigt dazu die Summe eines vollen Jahres.",
              "Ist: die Rechnungen der zugeordneten Budgetposten, sobald ein Posten abgeschlossen ist. Bei monatlichen Verträgen legst du je Monat einen Posten an; das Ist wächst dann mit jedem abgeschlossenen Monat.",
              "Gekündigt: Das Soll zählt nur die Zahlungen bis zum Kündigungstag, im folgenden Geschäftsjahr nichts mehr.",
            ],
          },
        ],
        links: [{ to: "/budget/vertraege", label: "Zu den Verträgen" }],
      },
      {
        id: "rechnungen",
        title: "Rechnungen erfassen",
        roles: [BUDGET_EDITOR, BUDGET_MANAGER],
        blocks: [
          {
            kind: "steps",
            items: [
              "Wähle auf der Seite „Rechnungen“ „Rechnung erfassen“.",
              "Trage Rechnungssteller, Rechnungsnummer, interne Nummer und Rechnungsdatum ein. Das Datum bestimmt das Geschäftsjahr.",
              "Lege für jeden Budgetposten eine Position an: Budgetposten aus der Liste wählen, Netto und Steuersatz eintragen. Das Brutto rechnet die Werkbank.",
              "Prüfe das Kennzeichen „schließt den Posten ab“; bei Posten mit Vertrag ist es anfangs aus.",
              "Optional: den Rechnungsbetrag laut Beleg eintragen; er muss zur Summe passen. Den Beleg als PDF anhängen (höchstens 15 MB).",
              "„Rechnung speichern“.",
            ],
          },
          {
            kind: "text",
            text: "Erfasst eine Person mit Budget.Editor, steht die Rechnung auf „zu prüfen“. Erst gebuchte Rechnungen zählen zum Ist.",
          },
        ],
        links: [{ to: "/budget/rechnungen", label: "Zu den Rechnungen" }],
      },
      {
        id: "buchen",
        title: "Rechnungen prüfen und buchen",
        roles: [BUDGET_MANAGER],
        blocks: [
          {
            kind: "text",
            text: "Offene Rechnungen stehen auf deiner Startseite und in der Glocke. Prüfe Positionen und Beleg und buche. Rechnungen, die du selbst erfasst, sind sofort gebucht. Gebuchte Rechnungen ändern und löschen nur Personen mit Budget.Manager.",
          },
        ],
      },
      {
        id: "import",
        title: "Import aus Excel",
        roles: [BUDGET_MANAGER],
        blocks: [
          {
            kind: "text",
            text: "Unter „Import“ übernimmst du die bisherigen Budgetdateien aus Excel. Jede Datei wird ein Vorgang, und jede Zeile prüfst du einzeln. Du kannst einen Vorgang jederzeit unterbrechen; offene Vorgänge stehen als Aufgabe auf deiner Startseite.",
          },
          {
            kind: "steps",
            items: [
              "Wähle die Excel-Datei aus. Gelesen wird das erste Blatt; die Datei selbst wird nicht gespeichert.",
              "Prüfe, was erkannt wurde: Geschäftsjahr und die Konten (die Beträge in der Datei sind brutto). Für neue Konten wählst du, ob es laufende Kosten oder eine Investition sind.",
              "Wähle „Vorgang anlegen und Zeilen abarbeiten“. Fehlende Konten werden angelegt. Budgetposten entstehen erst beim Übernehmen der Zeilen; das Budget je Konto aus der Datei wird nicht übernommen.",
              "Prüfe jede Zeile: den Partner (vorhandener, ähnlicher oder neuer), Bezeichnung, Konto und Betrag. Rechnungsnummer und Datum aus der Datei stehen nur zur Information dabei.",
              "Wähle „Übernehmen und weiter“ oder „Überspringen“. Jede übernommene Zeile wird ein eigener Budgetposten mit dem gewählten Partner (Name aus der Bezeichnung, der Betrag als erwartete Kosten). Eine Rechnung legt der Import nicht an; Rechnungsnummer und Datum aus der Datei stehen in der Notiz des Postens. Gibt es den Namen im Konto schon, bekommt der neue Posten eine Nummer, z. B. „Mobilfunk (2)“. Übersprungene Zeilen kannst du mit „Zurück auf offen“ wieder öffnen.",
              "Brauchst du eine Zeile nicht, lösche sie mit „Löschen“ (offen oder übersprungen). Willst du den Rest der Datei nicht mehr übernehmen, wähle oben „Import abbrechen“: Alle offenen und übersprungenen Zeilen werden gelöscht, die übernommenen und ihre Budgetposten bleiben, und der Vorgang steht als „abgebrochen“ in der Liste.",
            ],
          },
          {
            kind: "list",
            items: [
              "Was du bei einer Firma als Partner wählst, schlägt die Werkbank für alle weiteren Zeilen dieser Firma vor.",
              "Hinweise an einer Zeile zeigen zum Beispiel ein Datum außerhalb des Geschäftsjahrs, eine fehlende Firma oder ein fehlendes Konto. Der Filter „Mit Hinweis“ zeigt nur diese Zeilen.",
              "Zeilen mit „Jährlich“ stehen nach dem Übernehmen unter „Vorschläge für die Planung“. Wählst du sie aus, läuft ihr Budgetposten im folgenden Geschäftsjahr weiter, bis auf Weiteres oder nur für dieses Jahr, mit den eingetragenen Kosten je Jahr.",
              "Die Spalten Kostenstelle und Projekte werden nicht übernommen.",
            ],
          },
          {
            kind: "hint",
            text: "Einen Vorgang zu löschen entfernt nur den Vorgang. Neue Konten, Partner und Budgetposten bleiben.",
          },
        ],
        links: [{ to: "/budget/import", label: "Zum Import" }],
      },
      {
        id: "partner",
        title: "Partner",
        blocks: [
          {
            kind: "text",
            text: "Partner sind Firmen, keine Personen. Die Detailseite zeigt Verträge, Budgetposten und Rechnungen der Firma aus allen Jahren. Nicht mehr gebrauchte Partner legst du still.",
          },
          {
            kind: "hint",
            text: "Doppelte Partner legt eine Person mit Budget.Manager zusammen: Verträge und Rechnungen wandern zum Ziel, der andere Partner wird gelöscht. Das lässt sich nicht rückgängig machen.",
          },
        ],
        links: [{ to: "/budget/partner", label: "Zu den Partnern" }],
      },
      {
        id: "konten",
        title: "Konten",
        blocks: [
          {
            kind: "text",
            text: "Konten haben eine eindeutige Nummer, eine Bezeichnung und eine Art: laufende Kosten oder Investition. Konten werden nicht gelöscht, sondern stillgelegt.",
          },
        ],
        links: [{ to: "/budget/konten", label: "Zu den Konten" }],
      },
      {
        id: "auswertung",
        title: "Mehrjahresübersicht, Statistik und Excel",
        blocks: [
          {
            kind: "text",
            text: "Die Mehrjahresübersicht zeigt Plan, Ist und Status aller Posten über fünf Geschäftsjahre, als Ausblick ab dem laufenden oder als Rückblick bis zum laufenden. Sie lässt sich als Excel-Datei herunterladen, mit einem Blatt für die Posten und einem für alle Rechnungspositionen.",
          },
          {
            kind: "text",
            text: "Die Statistik wertet Posten mit gewählten Tags über fünf Geschäftsjahre aus, als Diagramm und Tabelle. Vorgabe: Einer der Tags reicht; wahlweise müssen alle passen. Eine Auswahl lässt sich unter einem Namen speichern.",
          },
        ],
        links: [
          { to: "/budget/planung", label: "Zur Mehrjahresübersicht" },
          { to: "/budget/statistik", label: "Zur Statistik" },
        ],
      },
      {
        id: "einstellungen",
        title: "Einstellungen des Budgets",
        roles: [BUDGET_MANAGER],
        blocks: [
          {
            kind: "text",
            text: "Unter „Einstellungen“ legst du den Beginn des Geschäftsjahrs, seine Bezeichnung in der Oberfläche und die Kostenstelle fest und pflegst die Liste der Tags. Ein umbenannter Tag ändert sich an allen Posten und Statistiken; ein gelöschter verschwindet dort.",
          },
        ],
        links: [{ to: "/budget/einstellungen", label: "Zu den Einstellungen" }],
      },
      {
        id: "nur-lesen",
        title: "Nur lesen",
        roles: [BUDGET_READER],
        blocks: [
          {
            kind: "text",
            text: "Mit Budget.Reader siehst du alle Seiten des Budgets, kannst Belege herunterladen und Excel exportieren, aber nichts ändern. Die Seiten weisen darauf hin.",
          },
        ],
      },
    ],
  },
  {
    id: "it-tools",
    title: "IT-Tools",
    summary: "Rechner, Generatoren, Konverter und Abfragen für den IT-Alltag.",
    roles: [TOOLS],
    sections: [
      {
        id: "ueberblick",
        title: "Überblick",
        blocks: [
          {
            kind: "text",
            text: "„Alle Tools“ zeigt alle Werkzeuge mit Suchfeld; in der Navigation stehen die Kategorien, zum Beispiel Netzwerk, AD und M365, Rechner, Zertifikate und Kennwörter oder Generatoren. Jedes Tool hat eine eigene Seite.",
          },
          {
            kind: "text",
            text: "Mit dem Knopf „zu den Favoriten“ an einem Tool merkst du es dir; Favoriten stehen oben in der Übersicht, darüber „Zuletzt genutzt“ mit den letzten sechs Tools. Beides gilt für dein Konto, also auf jedem Gerät.",
          },
        ],
        links: [{ to: "/it-tools", label: "Zu den IT-Tools" }],
      },
      {
        id: "verlauf",
        title: "Verlauf",
        blocks: [
          {
            kind: "text",
            text: "Ändern sich die Einstellungen eines Tools und bleiben zwei Sekunden so, merkt sich die Werkbank sie in deinem Verlauf. Gespeichert wird nur, was ohnehin in der Adresszeile steht, nie Kennwörter, Schlüssel oder eingegebene Texte. Den Verlauf siehst nur du; er reicht 90 Tage zurück.",
          },
          {
            kind: "list",
            items: [
              "Auf der Seite eines Tools öffnet „Zuletzt verwendete Einstellungen“ die letzten fünf; ein Klick stellt sie wieder ein.",
              "Die Seite „Verlauf“ zeigt alles nach Tagen, mit Löschen je Eintrag und „Ganzen Verlauf löschen“.",
              "Unter „Einstellungen“ auf derselben Seite schaltest du den Verlauf aus. Favoriten und zuletzt genutzte Tools bleiben trotzdem.",
            ],
          },
        ],
        links: [{ to: "/it-tools/verlauf", label: "Zum Verlauf" }],
      },
      {
        id: "daten",
        title: "Deine Eingaben",
        blocks: [
          {
            kind: "text",
            text: "Die Tools rechnen in deinem Browser. Was du eingibst, geht nicht an den Server und wird nicht gespeichert. Dateien wie Zertifikate oder Bilder bleiben auf deinem Rechner.",
          },
          {
            kind: "text",
            text: "Viele Tools schreiben ihre Einstellungen in die Adresse, damit du einen Link teilen kannst. Kennwörter, Schlüssel, eingegebene Texte und abgefragte Namen stehen dort nie.",
          },
        ],
      },
      {
        id: "internet",
        title: "Abfragen ins Internet",
        blocks: [
          {
            kind: "text",
            text: "DNS Lookup, DNS-/Mail-Check, RDAP und „Passwort prüfen“ brauchen Dienste im Internet. Diese Abfragen stellt der Werkbank-Server für dich, nur bei festen öffentlichen Diensten und nur über https. Angefragte Namen speichert er nicht.",
          },
          {
            kind: "list",
            items: [
              "DNS über Cloudflare, Google oder Quad9",
              "RDAP bei der zuständigen Registry, Subdomains über crt.sh",
              "„Passwort prüfen“ schickt nur die ersten fünf Zeichen des Hashs an Have I Been Pwned, nie das Kennwort",
            ],
          },
          {
            kind: "hint",
            text: "Die Verwaltung kann diese Abfragen ausschalten. Die Tools zeigen dann einen Hinweis.",
          },
        ],
      },
    ],
  },
  {
    id: "it-projekte",
    title: "IT-Projekte",
    summary: "Projekte mit Budget, Ansprechpartnern, Links, Jour-Fixe-Protokollen und Aufgaben.",
    roles: [PROJECTS_READER, PROJECTS_EDITOR],
    sections: [
      {
        id: "ueberblick",
        title: "Projekte im Überblick",
        blocks: [
          {
            kind: "text",
            text: "Unter „Alle Projekte“ stehen alle IT-Projekte mit Status, veranschlagtem Budget, geplanten und tatsächlichen Kosten, offenen Punkten und dem letzten Jour Fixe. Vorgabe ist die Ansicht „Laufend und geplant“; abgeschlossene Projekte findest du unter „Abgeschlossen“ oder „Alle“.",
          },
          {
            kind: "text",
            text: "Ein Projekt hat die Reiter Übersicht, Budget, Jour Fixe, Aufgaben und Einstellungen. Die Übersicht zeigt das Budget, die offenen Punkte, die wichtigen Links, die internen und externen Ansprechpartner und den letzten Jour Fixe.",
          },
        ],
        links: [{ to: "/projekte", label: "Zu den Projekten" }],
      },
      {
        id: "budget",
        title: "Budget eines Projekts",
        blocks: [
          {
            kind: "terms",
            items: [
              ["Veranschlagt", "der Rahmen, den du in den Einstellungen des Projekts einträgst"],
              [
                "Geplant",
                "erwartete Kosten der zugeordneten Budgetposten, für die noch keine gebuchte Rechnung da ist; Rechnungen „zu prüfen“ zählen noch als geplant",
              ],
              ["Ist", "die gebuchten Rechnungen auf diesen Budgetposten"],
              ["Verbleibend", "veranschlagt minus geplant minus Ist"],
            ],
          },
          {
            kind: "text",
            text: "Die Kosten kommen aus dem IT-Budget: Dort wählst du beim Budgetposten das Projekt aus. Läuft ein Posten über mehrere Geschäftsjahre, zählt jedes Jahr der Laufzeit mit, bei „bis auf Weiteres“ bis zum laufenden Geschäftsjahr. Der Reiter Budget listet die Posten und die Summen je Geschäftsjahr. Alle Beträge sind brutto.",
          },
          {
            kind: "hint",
            text: "Liegen geplant und Ist zusammen über dem veranschlagten Budget, weist der Reiter Budget darauf hin.",
          },
        ],
      },
      {
        id: "jour-fixe",
        title: "Jour Fixe",
        blocks: [
          {
            kind: "text",
            text: "Jeder Jour Fixe ist ein Eintrag mit Datum, Titel und Protokoll. Links stehen die Einträge, der neueste oben; rechts das gewählte Protokoll mit seinen Anhängen.",
          },
        ],
      },
      {
        id: "jour-fixe-schreiben",
        title: "Jour Fixe eintragen",
        roles: [PROJECTS_EDITOR],
        blocks: [
          {
            kind: "steps",
            items: [
              "Wähle „Neuer Eintrag“.",
              "Trage Datum und Titel ein und schreibe das Protokoll.",
              "Mit „Vorschau“ siehst du, wie es aussieht; mit „Bearbeiten“ schreibst du weiter.",
              "Speichere. Danach kannst du über „Bearbeiten“ PDF-Dateien anhängen.",
            ],
          },
          {
            kind: "terms",
            items: [
              ["# Überschrift", "eine Überschrift; ## und ### für kleinere"],
              ["- Punkt", "eine Liste; 1. für eine nummerierte"],
              ["- [ ] Punkt", "ein Punkt zum Abhaken; - [x] für erledigt"],
              ["**fett** und *kursiv*", "hervorgehobener Text"],
              ["[Text](Adresse)", "ein Link; nur Adressen mit https"],
            ],
          },
          {
            kind: "text",
            text: "Die Leiste über dem Textfeld setzt diese Zeichen für dich um den markierten Text. Je Eintrag gehen bis zu 10 PDF-Dateien mit je bis zu 20 MB. Anhänge lädt man herunter, sie öffnen sich nicht im Browser.",
          },
        ],
      },
      {
        id: "aufgaben",
        title: "Aufgaben",
        blocks: [
          {
            kind: "text",
            text: "Die Aufgabenliste dient nur der groben Orientierung; die eigentlichen Aufgaben laufen meist in anderen Werkzeugen. Eine Aufgabe hat einen Text und auf Wunsch eine zuständige Person und ein Datum. Offene stehen oben, die mit dem frühesten Datum zuerst. Mit dem Haken markierst du eine Aufgabe als erledigt; „Alle“ zeigt auch die erledigten.",
          },
        ],
      },
      {
        id: "einstellungen",
        title: "Einstellungen eines Projekts",
        roles: [PROJECTS_EDITOR],
        blocks: [
          {
            kind: "list",
            items: [
              "Allgemein: Name, Kurzbeschreibung, Status (geplant, aktiv, pausiert, abgeschlossen) und Laufzeit.",
              "Veranschlagtes Budget: Betrag brutto, wann es freigegeben wurde und eine Notiz.",
              "Rollen und Ansprechpartner: interne und externe Personen mit Rolle im Projekt, Firma oder Abteilung und Kontakt. Die Werkbank fragt dafür nichts aus Microsoft Entra ab.",
              "Links: beliebig viele wichtige Seiten, zum Beispiel die Projektablage. Erlaubt sind nur Adressen mit https. Mit „Nach oben“ legst du die Reihenfolge fest.",
            ],
          },
          {
            kind: "text",
            text: "Ein neues Projekt legst du unter „Alle Projekte“ mit „Neues Projekt“ an; danach öffnen sich seine Einstellungen. Beendete Projekte setzt du auf „abgeschlossen“: Sie bleiben lesbar, im IT-Budget lassen sich ihnen keine Posten mehr zuordnen. „Projekt löschen“ entfernt das Projekt mit Jour Fixe, Anhängen und Aufgaben; die Budgetposten bleiben im IT-Budget und verlieren nur die Zuordnung.",
          },
        ],
      },
    ],
  },
  {
    id: "it-bestand",
    title: "IT-Bestand",
    summary:
      "Vorgänge aus NinjaOne, Hardware mit Inventurnummer und Verlauf, Stellen und Arbeitsplätze, Standorte mit Grundrissen, Verleih, Ausmustern und die Stammdaten dazu.",
    roles: [INVENTORY_READER, INVENTORY_EDITOR],
    sections: [
      {
        id: "hardware",
        title: "Hardware im Überblick",
        blocks: [
          {
            kind: "text",
            text: "Unter „Hardware“ stehen alle Geräte mit Art, Hersteller und Modell, Seriennummer, Inventurnummer und Herkunft. Die Suche findet Geräte über Bezeichnung, Seriennummer, Inventurnummer, Hostname, Art und Modell; daneben filterst du nach Art. Vorgabe ist die Ansicht „Im Bestand“; ausgemusterte Geräte findest du unter „Ausgemustert“ oder „Alle“.",
          },
          {
            kind: "text",
            text: "Ein Gerät hat die Reiter Übersicht und Verlauf. Im Verlauf steht jede Änderung mit Datum und Person, zum Beispiel eine neue Inventurnummer oder das Ausmustern.",
          },
          {
            kind: "hint",
            text: "Auf schmalen Bildschirmen wird die Liste zu Karten: oben das Gerät, darunter die Angaben mit ihrer Bezeichnung.",
          },
        ],
        links: [{ to: "/bestand/hardware", label: "Zur Hardware" }],
      },
      {
        id: "erfassen",
        title: "Gerät erfassen und ändern",
        roles: [INVENTORY_EDITOR],
        blocks: [
          {
            kind: "steps",
            items: [
              "Unter „Hardware“ auf „Gerät erfassen“ tippen.",
              "Bezeichnung und Art eintragen, auf Wunsch Hersteller und Modell, Seriennummer, Hostname und eine Notiz.",
              "Hat das Gerät schon einen Aufkleber mit Inventurnummer, sie gleich mit eintragen.",
              "„Gerät anlegen“ tippen. Mit Inventurnummer fragt die Werkbank noch einmal nach: Vergleiche die Nummer mit dem Aufkleber und bestätige.",
            ],
          },
          {
            kind: "text",
            text: "Eine Seriennummer und eine Inventurnummer gehören immer zu genau einem Gerät. Ist eine Nummer schon vergeben, nennt die Werkbank das Gerät, bei dem sie steht.",
          },
          {
            kind: "text",
            text: "In der Übersicht eines Geräts änderst du mit „Bearbeiten“ die Angaben. Die Inventurnummer hat einen eigenen Knopf: Nach „Weiter“ fragt die Werkbank nach, bevor sie die Nummer setzt, ändert oder – bei leerem Feld – entfernt.",
          },
        ],
      },
      {
        id: "ausmustern",
        title: "Gerät ausmustern",
        roles: [INVENTORY_EDITOR],
        blocks: [
          {
            kind: "text",
            text: "Geräte werden nicht gelöscht, sondern ausgemustert. So bleiben Inventurnummer, Seriennummer und Verlauf für Inventur und Nachweise erhalten.",
          },
          {
            kind: "steps",
            items: [
              "Im Gerät auf „Ausmustern“ tippen.",
              "Grund, Verbleib und Datum wählen. Verbleib ist entsorgt, verkauft oder abgegeben, an Leasing zurück oder beim Hersteller.",
              "Bei Geräten mit Datenträger (zum Beispiel Notebook und PC) bestätigen, dass er gelöscht oder vernichtet ist. Ohne diesen Haken geht es nicht weiter.",
              "Auf Wunsch eine Notiz eintragen, etwa die Nummer des Entsorgungsnachweises.",
              "„Weiter“ und dann „Ja, ausmustern“ tippen.",
            ],
          },
          {
            kind: "hint",
            text: "Versehentlich ausgemustert? Im Gerät „Wieder in Betrieb nehmen“ tippen. Auch das steht im Verlauf.",
          },
        ],
      },
      {
        id: "vorgaenge",
        title: "Vorgänge und NinjaOne",
        blocks: [
          {
            kind: "text",
            text: "PCs und Notebooks gleicht die Werkbank alle 30 Minuten mit NinjaOne ab. Ein Gerät erkennt sie an seiner Kennung in NinjaOne, sonst an der Seriennummer. Welche Organisationen und Geräterollen dabei berücksichtigt werden, legt ein Admin in der Verwaltung fest. Hostname und technische Daten kommen aus NinjaOne; du siehst sie beim Gerät im Reiter „Technik“.",
          },
          {
            kind: "text",
            text: "Unter „Vorgänge“ landet, was eine Entscheidung braucht: ein neues Gerät in NinjaOne, ein Gerät, das dort nicht mehr auftaucht, eine Rückgabe aus dem Verleih oder ein überfälliger Verleih. Neben der Überschrift siehst du, wann zuletzt abgeglichen wurde. In der Zeile darunter suchst du nach Nummer, Titel, Gerät oder Seriennummer und wählst den Status und die Art, zum Beispiel nur Rückgaben. Die Vorgänge stehen in einer Tabelle mit Nummer, Titel, Art, Eingang, Bearbeiter und Status. Ein Klick auf eine Zeile öffnet den Vorgang rechts daneben; die Tabelle zeigt dann nur Nummer, Titel und Status, mit „×“ schließt du die Ansicht. Die Breite verschiebst du am Trenner zwischen Tabelle und Ansicht (ziehen oder mit den Pfeiltasten, Doppelklick stellt sie zurück); dein Browser merkt sie sich. Ist die Tabelle breit genug, zeigt sie wieder alle Spalten. Bei der Entscheidung erklärt das kleine „i“ neben jeder Möglichkeit, was sie bewirkt. Es werden zuerst 50 Vorgänge gezeigt, mit „Mehr anzeigen“ kommen weitere dazu. Auf dem Handy und dem Tablet im Hochformat steht je Vorgang eine kurze Zeile, ein Vorgang öffnet sich über die ganze Breite, mit „Zur Liste“ geht es zurück. Beim Verleih stehen Liste und Ansicht nebeneinander, schmal gilt dasselbe wie bei den Vorgängen. Wenn du den Bestand pflegst, stehen offene Vorgänge als Aufgabe auf deiner Startseite, und das Symbol „Bestand“ in der Bereichsleiste bekommt einen Punkt.",
          },
          {
            kind: "steps",
            items: [
              "Unter „Vorgänge“ einen Vorgang wählen.",
              "Auf „Ich übernehme“ tippen, damit alle sehen, dass du dich kümmerst.",
              "Bei einem neuen Gerät wählen: einer Stelle zuordnen, einem Arbeitsplatz zuordnen, ins Lager, „Ist dasselbe Gerät“ oder nicht in den Bestand aufnehmen. Je nach Wahl Stelle, Arbeitsplatz, Raum oder das vorhandene Gerät suchen: ein paar Buchstaben oder Ziffern tippen (Nummer, Name der Person, Raum, Hostname oder Seriennummer) und den Treffer wählen. Mit „Ändern“ wählst du neu.",
              "„Übernehmen und abschließen“ tippen. Die Werkbank legt das Gerät an oder verknüpft es.",
            ],
          },
          {
            kind: "hint",
            text: "Steht oben „Möglicherweise dasselbe Gerät“, gehört der Hostname schon zu einem Gerät im Bestand. Das passiert zum Beispiel nach einem Mainboardtausch. Dann ist „Ist dasselbe Gerät“ meist richtig.",
          },
          {
            kind: "text",
            text: "Neue Monitore liest die Werkbank aus NinjaOne mit. Hängt ein neuer Monitor an einem PC mit Arbeitsplatz, kommt er direkt an diesen Arbeitsplatz. Hängt er an einem Notebook, entsteht ein Vorgang „Neuer Monitor“: Der Arbeitsplatz ist schon vorgeschlagen, du bestätigst ihn, ordnest den Monitor der Stelle zu oder übernimmst ihn nicht. Wechselt ein bekannter Monitor den Rechner, steht das nur im Verlauf. Fehlt ein Gerät in NinjaOne, wählst du: ausgemustert (vorher das Gerät ausmustern), verloren oder gestohlen, oder prüfen. Taucht das Gerät wieder auf, schließt die Werkbank den Vorgang selbst. Entscheiden dürfen nur Bearbeiterinnen und Bearbeiter des IT-Bestands.",
          },
          {
            kind: "text",
            text: "Für Lenovo-Rechner und Lenovo-Monitore holt die Werkbank einmal am Tag die technischen Daten von der Lenovo-Seite PSREF, wenn ein Admin das in der Verwaltung bei NinjaOne eingeschaltet hat. Im Reiter „Technik“ stehen dann Kamera, Mikrofon und Lautsprecher (soweit Lenovo sie nennt), die wichtigsten Eckdaten, alle Merkmale zum Aufklappen und ein Link zur Lenovo-Seite. Mit „Bei PSREF abrufen“ holst du die Daten sofort neu. Bei Rechnern muss als Modell der Maschinentyp stehen, zum Beispiel 10T7004BGE.",
          },
        ],
        links: [{ to: "/bestand/vorgaenge", label: "Zu den Vorgängen" }],
      },
      {
        id: "statistik",
        title: "Statistik",
        blocks: [
          {
            kind: "text",
            text: "Unter „Statistik“ siehst du Zahlen zum aktiven Bestand: Geräte je Art, je Modell, nach Alter, je Standort, wo die Geräte gerade sind, Betriebssysteme, den Verleih und die Ausmusterungen je Jahr. Ausgemusterte Geräte zählen nur bei den Ausmusterungen.",
          },
          {
            kind: "steps",
            items: [
              "Oben unter „Hersteller“ einen Hersteller wählen, um nur seine Geräte zu sehen.",
              "Bei jeder Auswertung mit „Balken“ oder „Kreis“ die Darstellung wechseln.",
              "Unter „Als Tabelle“ stehen dieselben Zahlen mit Anteil zum Nachlesen.",
            ],
          },
          {
            kind: "hint",
            text: "Das Alter rechnet die Werkbank aus dem Anschaffungsdatum am Gerät. Fehlt es, nimmt sie bei Monitoren das Baujahr aus NinjaOne, sonst zählt das Gerät als „unbekannt“. Das Anschaffungsdatum trägst du beim Gerät unter „Bearbeiten“ ein.",
          },
        ],
        links: [{ to: "/bestand/statistik", label: "Zur Statistik" }],
      },
      {
        id: "verleih",
        title: "Verleih",
        blocks: [
          {
            kind: "text",
            text: "Unter „Verleih“ siehst du, welche Geräte gerade ausgeliehen sind, welche überfällig sind und was zurück ist. Ein Verleih hat eine eigene Nummer (z. B. L-001) und kann mehrere Geräte umfassen.",
          },
          {
            kind: "steps",
            items: [
              "Unter „Verleih“ auf „Neuer Verleih“ tippen.",
              "Unter „Wer leiht aus?“ mindestens zwei Buchstaben des Namens tippen und die Person aus der Liste wählen.",
              "Das Rückgabedatum wählen und die Geräte ankreuzen. Verleihen kannst du Geräte, die keiner Stelle und keinem Arbeitsplatz zugeordnet und nicht schon verliehen sind.",
              "„Verleihen“ tippen. Die Nummer vergibt die Werkbank.",
            ],
          },
          {
            kind: "text",
            text: "Die Person bekommt per Mail und Teams eine Nachricht: bei der Ausgabe, zwei Tage vor dem Rückgabedatum, wenn der Verleih überfällig ist (am Tag danach und dann jede Woche) und wenn alles zurück ist. Darin stehen nur die Verleihnummer und das Datum, keine Gerätedaten. Welche Nachrichten verschickt wurden, steht beim Verleih.",
          },
          {
            kind: "steps",
            items: [
              "Den Verleih öffnen.",
              "Die Geräte ankreuzen, die zurück sind. Einzelne Geräte gehen auch.",
              "„Rückgabe eintragen“ tippen. Für jede Rückgabe entsteht ein Vorgang „Rückgabe prüfen“.",
              "Im Vorgang „Geprüft, zurück ins Lager“ oder „Defekt oder unvollständig“ wählen.",
            ],
          },
          {
            kind: "hint",
            text: "Ist ein Verleih überfällig, entsteht der Vorgang „Verleih überfällig“. Dort verlängerst du die Rückgabe oder schließt ihn als geklärt. Sind alle Geräte zurück, schließt er sich selbst. Das Rückgabedatum kannst du auch direkt beim Verleih ändern.",
          },
          {
            kind: "text",
            text: "Ein verliehenes Gerät kannst du nicht einer Stelle oder einem Arbeitsplatz zuordnen und nicht ausmustern, bis die Rückgabe eingetragen ist. Verleihen und Rückgaben eintragen dürfen nur Bearbeiterinnen und Bearbeiter des IT-Bestands.",
          },
        ],
        links: [{ to: "/bestand/verleih", label: "Zum Verleih" }],
      },
      {
        id: "stellen",
        title: "Stellen",
        blocks: [
          {
            kind: "text",
            text: "Einmal in der Stunde prüft die Werkbank alle Personen an Stellen und in offenen Verleihen gegen Entra. Ändert sich dort der Name oder der Anmeldename, übernimmt sie das und schreibt es in den Verlauf. Ist ein Konto deaktiviert oder gelöscht, entsteht je Stelle und je Verleih ein Vorgang „Person nicht mehr aktiv“.",
          },
          {
            kind: "hint",
            text: "Im Vorgang zu einer Stelle wählst du „Stelle frei machen“, „Neue Person eintragen“ oder „Erst mal so lassen“ (zum Beispiel in der Elternzeit). Beim Verleih trägst du die Rückgabe wie gewohnt ein; dann schließt sich der Vorgang selbst. Wird das Konto wieder aktiv, schließen sich offene Vorgänge ebenfalls von selbst.",
          },
          {
            kind: "text",
            text: "Unter „Stellen“ steht jede Stelle mit Nummer, Abteilung und der Person, die sie besetzt. Hardware und Arbeitsplätze hängen an der Stelle, nicht an der Person: Wechselt die Person, bleibt alles an der Stelle.",
          },
          {
            kind: "steps",
            items: [
              "Unter „Stellen“ auf „Stelle anlegen“ tippen.",
              "Bezeichnung eintragen und auf Wunsch die Abteilung wählen.",
              "Unter „Wer besetzt die Stelle?“ mindestens zwei Buchstaben des Namens oder Anmeldenamens tippen und die Person aus der Liste wählen. Ist die Stelle frei, das Feld leer lassen.",
              "„Stelle anlegen“ tippen. Die Nummer vergibt die Werkbank.",
            ],
          },
          {
            kind: "text",
            text: "Anlegen und ändern dürfen nur Bearbeiterinnen und Bearbeiter des IT-Bestands. Die Personen kommen aus Entra; eine neue Besetzung steht im Verlauf der Stelle. Eine Stelle lässt sich nur löschen, wenn keine Hardware mehr an ihr hängt.",
          },
        ],
        links: [{ to: "/bestand/stellen", label: "Zu den Stellen" }],
      },
      {
        id: "arbeitsplaetze",
        title: "Arbeitsplätze und Ausstattung",
        blocks: [
          {
            kind: "text",
            text: "Ein Arbeitsplatz steht in einem Raum. Ein Einzelarbeitsplatz gehört zu genau einer Stelle, ein geteilter Arbeitsplatz zu mehreren. Mit den Filtern über der Liste findest du zum Beispiel freie Plätze oder Plätze, an denen Ausstattung fehlt.",
          },
          {
            kind: "steps",
            items: [
              "Unter „Arbeitsplätze“ auf „Arbeitsplatz anlegen“ tippen.",
              "Den Raum suchen und wählen; er ist Pflicht. Hat die Etage einen Grundriss, erscheint er gleich darunter: Ein Klick in den Raum setzt den Platz des Arbeitsplatzes. Das ist freiwillig und geht auch später.",
              "Den Typ wählen: Einzelarbeitsplatz oder geteilter Arbeitsplatz. Einen Namen braucht der Arbeitsplatz nicht; er heißt nach seiner Nummer.",
              "Auf Wunsch eine Vorlage für die Ausstattung wählen.",
              "Unter „Stelle hinzufügen“ nach Nummer, Stelle, Person oder Abteilung suchen und den Treffer wählen; bei einem geteilten Arbeitsplatz auch mehrere.",
              "„Arbeitsplatz anlegen“ tippen.",
            ],
          },
          {
            kind: "text",
            text: "Im Reiter „Ausstattung“ vergleicht die Werkbank die Vorlage mit der Hardware am Arbeitsplatz und an seinen Stellen. Jedes Gerät zählt nur einmal. Ein Gerät ordnest du beim Gerät unter „Bearbeiten“ bei „Zugeordnet zu“ einer Stelle oder einem Arbeitsplatz zu.",
          },
          {
            kind: "text",
            text: "Unter dem Titel von Stelle, Arbeitsplatz und Gerät steht, wo sie sich befinden. Im Reiter „Standort“ siehst du den Grundriss: Der Raum ist hervorgehoben, der Platz des Arbeitsplatzes als Punkt markiert. Bei einer Stelle sind es die Räume ihrer Arbeitsplätze; liegen sie auf mehreren Etagen, wählst du die Etage oben. Hat ein Gerät keinen eigenen Raum, zeigt die Werkbank den Ort über seinen Arbeitsplatz oder seine Stelle.",
          },
          {
            kind: "steps",
            items: [
              "Den Arbeitsplatz öffnen und zum Reiter „Standort“ wechseln.",
              "„Platz im Grundriss setzen“ tippen und im hervorgehobenen Raum auf die Stelle klicken, an der der Arbeitsplatz steht.",
              "Ohne Maus: „Platz mit Zahlen eingeben“ öffnen und eintragen, wie weit von links und von oben im Raum der Platz liegt (in Prozent).",
            ],
          },
          {
            kind: "hint",
            text: "Fährst du mit der Maus über einen Platz, siehst du Stellen, Personen und Hardware des Arbeitsplatzes; ein Klick öffnet ihn. Auf Tablet und Handy öffnet das erste Antippen das Info-Fenster, das zweite den Arbeitsplatz. Die Plätze siehst du auch unter „Standorte“. Wechselt der Arbeitsplatz den Raum, entfällt der Platz und du setzt ihn neu. Den Platz setzen dürfen nur Bearbeiterinnen und Bearbeiter des IT-Bestands.",
          },
        ],
        links: [{ to: "/bestand/arbeitsplaetze", label: "Zu den Arbeitsplätzen" }],
      },
      {
        id: "standorte",
        title: "Standorte und Räume",
        blocks: [
          {
            kind: "text",
            text: "Unter „Standorte“ steht links der Baum Stadt › Standort › Gebäudeabschnitt › Etage. Der Pfeil klappt eine Ebene auf oder zu, ein Klick auf den Namen öffnet sie. Offen ist anfangs nur der Weg zur Auswahl. Über das Suchfeld findest du Räume, Etagen und Standorte direkt. Mit dem Knopf oben im Baum blendest du ihn aus, damit der Grundriss mehr Platz hat; „Standortbaum einblenden“ holt ihn zurück.",
          },
          {
            kind: "text",
            text: "Rechts steht immer genau das, was du gewählt hast: Bei einer Stadt, einem Standort oder Abschnitt siehst du, was darunter liegt. Bei einer Etage siehst du den Grundriss und daneben die Räume mit der Zahl der Geräte. Wählst du einen Raum, stehen seine Angaben und Arbeitsplätze neben dem Grundriss; „Alle Räume“ führt zurück. Der Pfad über dem Titel ist anklickbar.",
          },
          {
            kind: "hint",
            text: "Auf schmalen Bildschirmen ist der Baum ausgeblendet. Mit „Standort wechseln“ öffnest du ihn.",
          },
          {
            kind: "text",
            text: "Anlegen und ändern dürfen nur Bearbeiterinnen und Bearbeiter des IT-Bestands:",
          },
          {
            kind: "steps",
            items: [
              "Eine neue Stadt legst du unten im Baum unter „Neue Stadt“ an. Den Standort legst du in der Stadt an, den Gebäudeabschnitt im Standort und die Etage im Abschnitt, jeweils rechts unter „Neuer …“.",
              "In der Etage „Etage bearbeiten“ tippen und „Grundriss hochladen“ wählen (PNG, JPEG oder WebP). Dort benennst du die Etage auch um, änderst die Reihenfolge oder löschst sie.",
              "„Räume bearbeiten“ tippen und auf freier Fläche ein Rechteck aufziehen. Danach den Namen des Raums eintragen und „Raum anlegen“ tippen.",
              "Räume verschiebst du durch Ziehen; der Griff unten rechts ändert die Größe. Ohne Maus wählst du den Raum und trägst die Lage in Prozent ein.",
              "„Fertig“ tippen.",
            ],
          },
          {
            kind: "text",
            text: "Ein Gerät ordnest du beim Erfassen oder unter „Bearbeiten“ einem Raum zu. Im Gerät zeigt der Reiter „Standort“ den Raum auf dem Grundriss. Umbenennen und löschen kannst du Stadt, Standort und Abschnitt dort, wo du sie geöffnet hast. Löschen lässt sich nur, was leer ist: ein Raum ohne Geräte, eine Etage ohne Räume und so weiter.",
          },
        ],
        links: [{ to: "/bestand/standorte", label: "Zu den Standorten" }],
      },
      {
        id: "stammdaten",
        title: "Stammdaten",
        blocks: [
          {
            kind: "list",
            items: [
              "Hardware-Arten: zum Beispiel Notebook, PC, Monitor. Bei jeder Art legst du fest, ob sie einen Datenträger hat.",
              "Hersteller und Modelle: je Hersteller beliebig viele Modelle.",
              "Gründe fürs Ausmustern: zum Beispiel defekt, veraltet, verloren oder gestohlen, Garantietausch.",
              "Abteilungen: Auswahl bei der Stelle.",
              "Ausstattung Arbeitsplatz: Vorlagen mit Zeilen, zum Beispiel „1 Rechner (Notebook oder PC)“ und „2 Monitore“.",
              "Nummernkreise: Präfix für die Nummern von Stellen und Arbeitsplätzen. Ein neues Präfix gilt nur für neue Einträge.",
            ],
          },
          {
            kind: "text",
            text: "Einträge, die noch von Geräten verwendet werden, lassen sich umbenennen, aber nicht löschen. Pflegen dürfen sie nur Bearbeiterinnen und Bearbeiter des IT-Bestands.",
          },
        ],
        links: [{ to: "/bestand/stammdaten", label: "Zu den Stammdaten" }],
      },
    ],
  },
  {
    id: "it-monitoring",
    title: "IT-Monitoring",
    summary: "Regelmäßige Prüfungen der IT, zum Beispiel der DNS-Abgleich mit NetBox.",
    roles: [MONITORING],
    sections: [
      {
        id: "dns-abgleich",
        title: "DNS-Abgleich mit NetBox",
        blocks: [
          {
            kind: "text",
            text: "In NetBox sind die DNS-Einträge dokumentiert. Alle 4 Stunden prüft die Werkbank, ob jeder aktive Eintrag aus NetBox öffentlich genau so im DNS steht. Gesucht wird nichts Neues: Was im DNS steht, aber nicht in NetBox, fällt nur auf, wenn es denselben Namen und Typ betrifft.",
          },
          {
            kind: "terms",
            items: [
              ["in Ordnung", "öffentlich steht genau, was in NetBox steht"],
              [
                "abweichend",
                "öffentlich steht etwas anderes oder zusätzlich etwas; bei eingeschaltetem TTL-Vergleich auch eine größere TTL",
              ],
              ["fehlt öffentlich", "den Eintrag gibt es im öffentlichen DNS nicht"],
              ["Fehler", "die öffentliche Abfrage ging nicht, z. B. keine Antwort des Resolvers"],
              ["inaktiv", "in NetBox nicht aktiv; öffentlich wie erwartet nicht vorhanden"],
            ],
          },
          {
            kind: "list",
            items: [
              "Die Filter über der Liste: „Probleme“ zeigt abweichende, fehlende und fehlerhafte Einträge, „Abweichend“, „Fehlt öffentlich“, „Fehler“ und „In Ordnung“ je einen Stand, „Neu“ nur die, die beim letzten Lauf dazukamen, „Alle“ alles. Ein Klick auf eine Kachel oben filtert genauso. Das Suchfeld filtert nach Name, Zone, Typ und Wert.",
              "Abweichende Werte sind in den Spalten NetBox und Öffentlich markiert. „In NetBox öffnen“ führt zum Eintrag in NetBox.",
              "Das Diagramm zeigt für die letzten 90 Tage je Tag den letzten Lauf.",
              "Nicht geprüft werden Reverse-Zonen privater Adressen, nicht aktive Zonen und extern verwaltete Subdomains (in NetBox als NS-Delegation erfasst; nur deren NS-Einträge werden geprüft).",
            ],
          },
          {
            kind: "hint",
            text: "Kommen beim Abgleich neue Probleme dazu oder schlägt er fehl, meldet die Glocke das. Ob du das auch per Mail oder in Teams bekommst, stellst du im Konto ein.",
          },
        ],
        links: [{ to: "/monitoring/dns", label: "Zum DNS-Abgleich" }],
      },
      {
        id: "einrichten",
        title: "Einrichten",
        roles: [ADMIN],
        blocks: [
          {
            kind: "steps",
            items: [
              "Lege in NetBox einen API-Token mit Leserecht an.",
              "Öffne Verwaltung › Einstellungen › Allgemein › NetBox (IT-Monitoring).",
              "Trage die https-Adresse von NetBox und den Token ein. Stammt das Zertifikat von NetBox aus einer eigenen Zertifizierungsstelle, füge deren CA-Zertifikat im PEM-Format ein.",
              "Speichere und wähle „Verbindung prüfen“. Danach kannst du eine View wählen; sonst gelten alle Views.",
              "Wähle den öffentlichen Resolver, lege fest, ob die TTL verglichen wird, hake „DNS-Abgleich einschalten“ an und speichere.",
              "Auf der Seite „DNS-Abgleich mit NetBox“ ziehst du mit „Jetzt prüfen“ den nächsten Lauf vor.",
            ],
          },
          {
            kind: "text",
            text: "Den Bereich sehen Personen mit der Rolle Monitoring.Reader und alle Admins. Der Token liegt verschlüsselt in der Datenbank und wird nie angezeigt.",
          },
        ],
      },
    ],
  },
  {
    id: "verwaltung",
    title: "Verwaltung und Audit-Log",
    summary: "Einstellungen der Werkbank, Rollen und das Protokoll aller Aktionen.",
    roles: [ADMIN],
    sections: [
      {
        id: "audit",
        title: "Audit-Log",
        blocks: [
          {
            kind: "text",
            text: "Das Audit-Log hält fest, wer wann was getan hat: Anmeldungen, Bewertungen, Workflow-Aktionen, Änderungen an Angaben, Budget und Einstellungen. Filtere nach Modul, Aktion und Zeitraum (von, bis). Einträge lassen sich nicht ändern oder löschen.",
          },
          {
            kind: "text",
            text: "Nach der Aufbewahrungsfrist (Vorgabe 90 Tage) löscht die Werkbank alte Einträge von selbst und vermerkt das im Log. Einträge unter 30 Tagen werden nie gelöscht.",
          },
        ],
        links: [{ to: "/audit", label: "Zum Audit-Log" }],
      },
      {
        id: "einstellungen",
        title: "Einstellungen der Werkbank",
        roles: [ADMIN],
        blocks: [
          {
            kind: "text",
            text: "Die Verwaltung ist ein eigener Bereich in der Navigation, nur für Admins. Sie verlangt eine frische Anmeldung (siehe „Anmelden und abmelden“). Die Einstellungen verteilen sich auf diese Seiten:",
          },
          {
            kind: "terms",
            items: [
              [
                "Allgemein",
                "Branding (Name, Farbe, Logos, Favicon), Aufbewahrung des Audit-Logs (30 bis 3650 Tage), ab wie vielen Tagen Zertifikate und Secrets als Hinweis, Warnung und dringend gelten",
              ],
              ["Rollen", "welche Rollen es gibt und wer sie hat (siehe unten)"],
              [
                "Mail & Teams",
                "SMTP-Server und Absender mit Testmail an dich selbst; Benachrichtigungen in Teams über einen Workflow aus Power Automate mit Testnachricht; Push aufs Handy ein- und ausschalten",
              ],
              [
                "Verbindungen",
                "KI-Texte (Art der Schnittstelle: OpenAI-kompatibel oder Anthropic, Adresse, Modell, Schlüssel, Höchstzahl je Stunde; Vorgabe: aus; „Verbindung testen“ zeigt bei Fehlern die Meldung des Anbieters), NetBox für den DNS-Abgleich, Abfragen der IT-Tools ins Internet (Vorgabe: erlaubt)",
              ],
              ["Audit-Log", "das Protokoll aller Aktionen (siehe oben)"],
            ],
          },
          {
            kind: "text",
            text: "Auf der Seite „Rollen“ steht, welche Rollen es gibt und wer sie bei der letzten Anmeldung hatte. „Nach Person“ zeigt dieselbe Information je Person: wer sich angemeldet hat und mit welchen Rollen; mit der Suche findest du Personen und Rollen, „Nur Personen ohne Rolle“ zeigt, wer sich angemeldet hat, aber nichts sieht. Wer sich noch nie angemeldet hat, steht dort nicht. Vergeben werden Rollen in Microsoft Entra, nicht in der Werkbank.",
          },
          {
            kind: "hint",
            text: "Jede Änderung in der Verwaltung steht im Audit-Log.",
          },
        ],
        links: [{ to: "/verwaltung", label: "Zur Verwaltung" }],
      },
      {
        id: "auftraege",
        title: "Hintergrundaufträge",
        roles: [ADMIN],
        blocks: [
          {
            kind: "text",
            text: "Abrufe aus dem Tenant, das Nachrichtencenter, KI-Texte, Benachrichtigungen und das Aufräumen laufen im Hintergrund. Schlägt ein Auftrag fehl, bekommst du eine Benachrichtigung, und der Fehler steht im Audit-Log; ein fehlgeschlagener Abruf der Einstellungen erscheint zusätzlich als Aufgabe.",
          },
        ],
      },
    ],
  },
  {
    id: "hilfe",
    title: "Fragen und Hilfe",
    summary: "Häufige Fragen und an wen du dich wendest.",
    roles: null,
    sections: [
      {
        id: "faq",
        title: "Häufige Fragen",
        blocks: [
          {
            kind: "terms",
            items: [
              [
                "Ich sehe einen Bereich nicht.",
                "Dir fehlt die Rolle dafür. Die IT vergibt sie über Microsoft Entra; danach einmal ab- und wieder anmelden.",
              ],
              [
                "„Deine Sitzung ist abgelaufen“",
                "Nach 30 Minuten ohne Aktivität oder 8 Stunden endet die Sitzung. Melde dich neu an.",
              ],
              [
                "Ein Zähler stimmt nicht.",
                "Die Zähler laden alle fünf Minuten, bei jedem Seitenwechsel und beim Zurückkehren in die Werkbank neu. Ein Wechsel der Seite hilft sofort. Am Handy: App schließen und neu öffnen.",
              ],
              [
                "Die Glocke bleibt leer.",
                "Die Werkbank meldet nur Neues ab dem Zeitpunkt, an dem sie die Art zum ersten Mal beobachtet. Prüfe außerdem im Konto, ob die Art eingeschaltet ist.",
              ],
              [
                "Push kommt nicht an.",
                "Prüfe im Konto, ob Push auf dem Gerät eingeschaltet ist und die Art die Spalte „Push“ hat, und schicke eine Testnachricht. Auf dem Handy muss die Werkbank Mitteilungen senden dürfen (Einstellungen des Geräts); auf dem iPhone geht Push nur in der App vom Home-Bildschirm.",
              ],
              [
                "Ich bekomme keine Mail oder keine Teams-Nachricht.",
                "Prüfe im Konto, ob die Art per Mail bzw. Teams eingeschaltet ist. Mitgeteilt wird nur, was nach dem Einschalten entsteht, gesammelt höchstens alle 15 Minuten, und nur, solange du es nicht schon in der Werkbank gelesen hast.",
              ],
              [
                "Eine Aktion wurde abgewiesen.",
                "Meist hat jemand den Vorgang inzwischen bearbeitet. Lade die Seite neu.",
              ],
              [
                "Werden meine Daten an Dritte gegeben?",
                "Nein. Die Werkbank nutzt keine Tracking- oder Analysedienste. Was an Microsoft oder an Dienste der IT-Tools geht, steht in den jeweiligen Kapiteln.",
              ],
            ],
          },
          {
            kind: "text",
            text: "Bei Fragen, Fehlern oder Wünschen wende dich an die IT.",
          },
        ],
      },
    ],
  },
];
