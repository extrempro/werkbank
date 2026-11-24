import type { Area } from "./types";

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
const MONITORING_REPORTS = "Monitoring.Berichte";
const PROJECTS_READER = "Projekte.Reader";
const PROJECTS_EDITOR = "Projekte.Editor";
const INVENTORY_READER = "Bestand.Reader";
const INVENTORY_EDITOR = "Bestand.Editor";
const DEVICES = "Geraete.Zuordnung";
// Tickets: Kennzeichen aus den Rollen je Bereich (siehe navigation.ts)
const TICKETS_MEMBER = "tickets:bereich";
const TICKETS_SETTINGS = "tickets:einstellungen";

/**
 * Das Handbuch der Werkbank: Bereiche wie in der Bereichsleiste, darin Teile wie im Seitenmenü
 * und je Thema eine Seite. Bei jeder Änderung an der Anwendung prüfen, ob ein Thema angepasst
 * werden muss, und die Info-Symbole mitpflegen (CLAUDE.md). Sprache: einfach, „du“, keine
 * Begriffe aus der Entwicklung.
 */

export const AREAS: readonly Area[] = [
  {
    id: "grundlagen",
    title: "Grundlagen",
    summary: "Anmelden, sich zurechtfinden, Aufgaben, Glocke, Suche und dein Konto.",
    roles: null,
    parts: [
      {
        title: null,
        topics: [
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
                text: "Die Sitzung endet nach 30 Minuten ohne Aktivität und spätestens nach 8 Stunden. Dann zeigt die Werkbank einen Hinweis und du meldest dich neu an. Mit „Abmelden“ im Kontomenü oben rechts (dein Bild oder deine Initialen) beendest du die Sitzung sofort. Unter „Konto“ › „Angemeldete Geräte“ siehst du, wo du sonst noch angemeldet bist, etwa „Safari auf dem iPhone“. Dort meldest du ein anderes Gerät einzeln ab oder mit „Auf allen anderen Geräten abmelden“ alle außer diesem, zum Beispiel wenn du ein Gerät verloren oder weitergegeben hast.",
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
                  "Bei Aktionen mit Folgen, etwa Löschen, Buchen, Abschließen, Freigeben oder andere Geräte abmelden, fragt die Werkbank in einem eigenen Fenster nach, am Handy als Blatt von unten. Dort steht, was genau passiert. Lässt sich etwas nicht rückgängig machen, ist der Knopf rot und es steht ein Hinweis dabei. „Abbrechen“, Esc, ein Klick daneben oder am Handy Wischen nach unten brechen ab.",
                  "Meldungen nach einer Aktion, zum Beispiel „gespeichert“ oder ein Fehler, erscheinen unten in der Mitte des Bildschirms, am Handy über der Leiste unten. So siehst du sie auch auf langen Seiten. Erfolgsmeldungen verschwinden nach ein paar Sekunden von selbst, solange die Maus nicht darauf steht; Fehler bleiben stehen, bis du sie mit „×“ schließt.",
                  "Über Listen stehen Suche und Filter. Am Computer und Tablet wählst du den Status mit den Knöpfen darunter, „Filter aufheben“ setzt alles zurück. Auf dem Handy wählst du den Status aus einer Liste; die übrigen Filter öffnest du mit „Weitere Filter“, die Zahl daran zeigt, wie viele gesetzt sind. Auf dem Handy steht jeder Eintrag als eigene Karte untereinander.",
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
                  "Budgetposten findest du über ihre Nummer, z. B. BP-2026-012, über Name, Notiz und Tag.",
                ],
              },
            ],
            links: [{ to: "/suche", label: "Zur Suche" }],
          },
          {
            id: "info-und-hilfe",
            title: "Info-Symbole und Hilfe",
            blocks: [
              {
                kind: "text",
                text: "Wo du ein kleines „i“ neben einem Begriff siehst, steht eine kurze Erklärung dahinter. Klick oder tipp darauf, dann öffnet sie sich als Blase direkt daneben. „Mehr im Handbuch“ führt zum passenden Thema.",
              },
              {
                kind: "text",
                text: "Mit Esc, einem Klick daneben oder einem zweiten Klick auf das „i“ schließt du die Blase wieder. Mit der Tastatur erreichst du das „i“ wie jede andere Schaltfläche.",
              },
              {
                kind: "text",
                text: "Neben dem Titel jeder Seite steht „Hilfe“. Damit öffnest du das Thema im Handbuch, das zu der Seite passt, auf der du gerade bist.",
              },
              {
                kind: "text",
                text: "Im Handbuch stehen links die Bereiche in derselben Reihenfolge wie in der Bereichsleiste; ein Klick klappt einen Bereich auf. Jedes Thema hat eine eigene Seite. Oben im Menü suchst du in allen Themen. Am Handy öffnest du die Themen über „Alle Themen“.",
              },
              {
                kind: "hint",
                text: "Alle Erklärungen hinter den „i“ findest du gesammelt unter „Fragen und Hilfe“ › „Begriffe A–Z“.",
              },
            ],
            links: [{ to: "/handbuch/hilfe/begriffe", label: "Zu den Begriffen A–Z" }],
          },
          {
            id: "konto",
            title: "Konto, Darstellung und Neuigkeiten",
            blocks: [
              {
                kind: "text",
                text: "Das Kontomenü oben rechts (dein Bild oder deine Initialen) führt zur Seite „Konto“: deine Angaben aus Microsoft, deine Rollen mit kurzer Erklärung, die angemeldeten Geräte, die Darstellung (automatisch, hell oder dunkel) die Schriftgröße im Menü (klein, normal, groß, sehr groß) und die Abstände im Menü (kompakt, normal, weiträumig; mit dem Finger bleiben Einträge immer gut antippbar; alles gilt nur für diesen Browser), deine Benachrichtigungen (Glocke, Mail, Teams) und die Version der Werkbank.",
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
                  [
                    "Config.Reviewer",
                    "zusätzlich Änderungen bewerten, Angaben und Soll-Werte pflegen",
                  ],
                  [
                    "Tenant.Reader",
                    "Lizenzen, Benutzerzahlen, Zertifikate, Dienststatus und Nutzung ansehen",
                  ],
                  ["Evergreen.Reader", "Evergreen-Einträge mit Bewertung und Notizen ansehen"],
                  [
                    "Evergreen.Editor",
                    "Evergreen-Einträge anlegen, bewerten, Notizen anfügen, abschließen und wieder öffnen",
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
    ],
  },
  {
    id: "m365",
    title: "Microsoft 365",
    summary:
      "Einstellungen des Tenants mit Verlauf und Soll-Werten, Lizenzen und Dienststatus sowie die Gerätezuordnung.",
    roles: null,
    parts: [
      {
        title: "Konfiguration",
        roles: [CONFIG_READER, CONFIG_REVIEWER],
        topics: [
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
            roles: [CONFIG_REVIEWER, ADMIN],
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
                text: "Jeder Abruf ist ein Snapshot mit Zeitpunkt, Status und Zahl der Änderungen. Schlägt ein Abruf fehl, bekommt die Verwaltung eine Aufgabe. Fehlt dabei eine Quelle, gelten ihre Einstellungen nicht als entfernt.",
              },
              {
                kind: "text",
                text: "Die Liste zeigt zuerst die letzten 10 Abrufe; über „Weitere 10 anzeigen“ holst du ältere dazu. Bei den Quellen steht nur, wie viele vollständig gelesen wurden und wie viele einen Fehler hatten. Aufgeklappt siehst du die Fehler, zusammengefasst nach der fehlenden Berechtigung, und welche Typen betroffen sind. Abrufe ohne Änderungen löscht die Werkbank nach einiger Zeit (Vorgabe 90 Tage); Abrufe mit Änderungen und die letzten 10 bleiben immer erhalten.",
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
        title: "Tenant",
        roles: [TENANT],
        topics: [
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
        title: "Geräte",
        roles: [DEVICES],
        topics: [
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
                  "Drück am neuen Gerät in der Einrichtung (bei der Auswahl der Region) fünfmal die Windows-Taste und wähle „Scan QR code“.",
                  "Wähle in der Werkbank „QR-Code scannen“ und halte den Code ins Feld. Geht die Kamera nicht, nimm „Foto auswählen“ und fotografiere den Code.",
                  "Prüf die Gerätedaten: Hersteller, Modell, Seriennummer. Gibt es das Gerät schon, ist eine zweite Zuordnung gesperrt; „Eintrag öffnen“ zeigt den vorhandenen Eintrag.",
                  "Wähle, falls nötig, eine Richtlinie und bestätige, dass das Gerät in den angezeigten Tenant gehört.",
                  "Wähle „Jetzt freigeben“ (mit Admin-Konto) oder „Zur Freigabe senden“.",
                  "Klick nach „Vorab zugeordnet“ am Gerät auf „Weiter“. Den Rest prüft die Werkbank von selbst.",
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
                  "Freigeben: Öffne den Eintrag und wähle, mit dem Admin-Konto angemeldet, „Jetzt freigeben“. Das kann auch eine andere Person sein.",
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
    ],
  },
  {
    id: "evergreen",
    title: "Evergreen",
    summary: "Neuerungen von Software sichten, bewerten, mit Notizen festhalten und abschließen.",
    roles: [EV_READER, EV_EDITOR],
    parts: [
      {
        title: null,
        topics: [
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
                  ["Bearbeitet", "es gibt mindestens eine Notiz oder eine Bewertung"],
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
                  "Jede Meldung aus dem Nachrichtencenter von Microsoft wird automatisch ein Eintrag mit dem Status „Neu“. Ändert Microsoft die Meldung später, übernimmt die Werkbank den neuen Text und vermerkt das im Verlauf. Der Status bleibt. Verschiebt Microsoft dabei den Zeitplan, siehst du den alten Plan schraffiert im Zeitstrahl und den Hinweis „Zeitplan geändert“.",
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
                text: "Links steht die Liste, rechts die Ansicht des gewählten Eintrags. Oben in der Liste suchst du nach Nummer, Titel, Kennung der Meldung (z. B. MC123456), Dienst oder Text und wählst den Status: Offen, Neu, Mit Frist oder Abgeschlossen. Offene Einträge stehen in Gruppen: zuerst die mit einer Frist von Microsoft (die früheste oben), dann neue, dann die in Bearbeitung.",
              },
              {
                kind: "text",
                text: "„Reine Info-Meldungen ausblenden“ versteckt Meldungen, die Microsoft nur zur Information schickt und die weder Nutzer noch Admins betreffen. Der Schalter ist anfangs an; dein Browser merkt sich, wie du ihn stellst.",
              },
              {
                kind: "text",
                text: "Auf mittelgroßen Bildschirmen ist das Seitenmenü eingeklappt, damit der Eintrag Platz hat; mit „Menü ausklappen“ in der Bereichsleiste holst du es zurück. Auf schmalen Bildschirmen siehst du erst nur die Liste. Ein gewählter Eintrag füllt dann die ganze Breite, mit „Zur Liste“ geht es zurück.",
              },
            ],
          },
          {
            id: "ansicht",
            title: "Was die Ansicht zeigt",
            blocks: [
              {
                kind: "text",
                text: "Oben steht der Steckbrief: Nummer, Kennung der Meldung, Titel und Kennzeichen wie Dienst, Art (zum Beispiel „Neue Funktion“ oder „Abkündigung“), „Betrifft Nutzer“ und „Handlung nötig“. Darunter vier Kacheln: wer betroffen ist, ob die Funktion nach dem Rollout eingeschaltet ist, ob und womit wir sie steuern können und bis wann zu handeln ist. Orange hinterlegt sind Kacheln, die Handlung verlangen.",
              },
              {
                kind: "text",
                text: "Der Zeitstrahl zeigt die Phasen des Rollouts je Monat und eine Linie für heute. Abgeschlossene Phasen sind gefüllt, kommende umrandet. Dieselben Phasen stehen auch als Liste darunter.",
              },
              {
                kind: "terms",
                items: [
                  [
                    "Unsere Bewertung",
                    "Kurzfassung, was sich für Mitarbeitende ändert, Schulung, Mitbestimmung und die verknüpfte Einstellung",
                  ],
                  ["Text von Microsoft", "der Originaltext, nach Abschnitten zum Aufklappen"],
                  ["Notizen und Verlauf", "alle Notizen und Änderungen mit Person und Datum"],
                ],
              },
              { kind: "hint", text: "Die Reiter wechselst du auch mit den Pfeiltasten." },
            ],
          },
          {
            id: "bewerten",
            title: "Einen Eintrag bewerten",
            roles: [EV_EDITOR],
            blocks: [
              {
                kind: "steps",
                items: [
                  "Öffne den Eintrag. Der Reiter „Unsere Bewertung“ ist schon gewählt.",
                  "Schreib eine Kurzfassung in einfachen Worten, was sich für Mitarbeitende ändert und ob es eine Schulung oder Information braucht.",
                  "Wähle bei „Mitbestimmungsrelevant?“ Ja, Nein oder Noch prüfen und begründe kurz.",
                  "Wenn es passt, verknüpfe die Einstellung aus der M365-Konfiguration: Tipp einen Teil des Pfads ein und wähle den Treffer.",
                  "Ergänze den Steckbrief und die Rollout-Phasen und wähle „Bewertung speichern“.",
                ],
              },
              {
                kind: "hint",
                text: "Werte mit „KI-Vorschlag, ungeprüft“ (violett) hat die KI aus dem Text von Microsoft gelesen, Werte mit „Vorschlag, ungeprüft“ (grau) die Werkbank nach festen Regeln, zum Beispiel die Rollout-Phasen aus „When this will happen“. Prüf sie kurz; mit dem Speichern gelten sie als geprüft, und kein späterer Vorschlag überschreibt sie. Jede Änderung steht mit vorher und nachher im Verlauf. Ein neuer Eintrag ist nach dem Speichern „Bearbeitet“.",
              },
              {
                kind: "text",
                text: "Ist in der Verwaltung „Vorschläge für Evergreen“ eingeschaltet, liest die KI bei jeder neuen Meldung und bei jedem geänderten Zeitplan Rollout, Betroffen, Standard und Steuerbar aus dem Text von Microsoft. Mit „KI-Vorschlag holen“ oben im Eintrag fragst du sie sofort. Die Kurzfassung und die Mitbestimmung bleiben eure eigene Einschätzung.",
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
                  "Wähle den Reiter „Notizen und Verlauf“, schreib, was du herausgefunden oder erledigt hast, und wähle „Notiz anfügen“. Ein neuer Eintrag ist danach „Bearbeitet“.",
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
                text: "Mit der Rolle Evergreen.Reader siehst du alle Einträge mit Bewertung und Notizen, kannst aber nichts ändern. Den Link zur verknüpften Einstellung siehst du nur, wenn du auch die M365-Konfiguration ansehen darfst. Aufgaben und Benachrichtigungen aus Evergreen bekommst du nicht.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "it-monitoring",
    title: "IT-Monitoring",
    summary: "Überwachung der IT aus Zabbix und der DNS-Abgleich mit NetBox.",
    roles: [MONITORING, MONITORING_REPORTS],
    parts: [
      {
        title: "Zabbix",
        roles: [MONITORING],
        topics: [
          {
            id: "zabbix-uebersicht",
            title: "Übersicht, Hosts und Wartungen",
            blocks: [
              {
                kind: "text",
                text: "Die Werkbank zeigt, was Zabbix gerade meldet: offene Probleme, nicht erreichbare Hosts und Wartungen. Sie liest nur, quittieren und Wartungen anlegen geht weiter in Zabbix. Probleme von Triggern, Items oder Hosts, die du in Zabbix abgeschaltet hast, zeigt sie nicht, genau wie Zabbix selbst. Probleme fragt sie jede Minute ab, Wartungen alle 15 Minuten, Hosts mit Gruppen und Inventar stündlich. Oben auf jeder Seite steht, wann die Daten zuletzt kamen. Ist Zabbix nicht erreichbar, siehst du den letzten Stand mit Zeit und einen Hinweis.",
              },
              {
                kind: "terms",
                items: [
                  [
                    "Katastrophe, Hoch, Durchschnitt, Warnung, Information",
                    "die Schweregrade wie in Zabbix, von dunkel nach hell",
                  ],
                  [
                    "Nicht erreichbar",
                    "keine Schnittstelle des Hosts antwortet; Hosts in Wartung zählen nicht mit",
                  ],
                  ["Lange offen", "Probleme, die seit mehr als 7 Tagen offen sind"],
                  [
                    "In Wartung",
                    "der Host steckt gerade in einer Wartung; Zabbix blendet seine Probleme dann meist aus",
                  ],
                  [
                    "ohne Standort",
                    "der Host ist in keiner Hostgruppe, die einem Standort zugeordnet ist",
                  ],
                ],
              },
              {
                kind: "list",
                items: [
                  "Übersicht: oben eine farbige Karte mit dem Gesamtstand (grün: alles in Ordnung, gelb: Probleme ohne schwere, rot: schwere Probleme), daneben wie viele Hosts erreichbar sind und was zu erledigen ist. Darunter die offenen Probleme als Balken nach Schweregrad und je Standort eine Kachel mit einem Kästchen je Host: Die Farbe zeigt den schlimmsten offenen Zustand, schwarz umrandet heißt nicht erreichbar, grau in Wartung. Ein Klick auf einen Schweregrad oder eine Kachel filtert die Liste „Aktuelle Probleme“; „Filter zurücksetzen“ zeigt wieder alles. Rechts daneben stehen die offenen Probleme der letzten 24 Stunden, die nicht erreichbaren Hosts und die Wartungen, ganz unten „Zu erledigen“.",
                  "Hosts: Tabelle mit Suche nach Name, Gruppe oder Seriennummer und den Filtern Alle, Mit Problemen, Nicht erreichbar, In Wartung, Ohne Bestandseintrag, Seriennummer fehlt, Nicht überwacht und In Zabbix abgeschaltet. Die Spalte IT-Bestand zeigt das verknüpfte Gerät. Ein Klick öffnet den Host rechts daneben mit offenen Problemen, Schnittstellen, Hostgruppen, Templates und Seriennummer.",
                  "Wartungen: laufend, kommend und in den letzten 30 Tagen abgelaufen, mit Zeitraum und Zahl der Hosts.",
                  "„In Zabbix öffnen“ führt in einem neuen Tab zum Host oder zum Problem in Zabbix. Dort meldest du dich mit deinem eigenen Zabbix-Konto an.",
                ],
              },
              {
                kind: "hint",
                text: "Lässt sich Zabbix mehrmals hintereinander nicht abfragen, läuft das Token bald ab oder erlaubt die Rolle zu viel, meldet die Glocke das den Admins.",
              },
            ],
            links: [
              { to: "/monitoring/zabbix", label: "Zur Übersicht" },
              { to: "/monitoring/zabbix/hosts", label: "Zu den Hosts" },
            ],
          },
          {
            id: "zabbix-bestand",
            title: "Abgleich mit dem IT-Bestand",
            blocks: [
              {
                kind: "text",
                text: "Die Werkbank verknüpft jeden Host mit dem Gerät im IT-Bestand, das dieselbe Seriennummer hat. Leerzeichen und Groß- oder Kleinschreibung zählen nicht. Den Namen oder die Adresse vergleicht sie nicht. Berücksichtigt werden nur aktive Geräte; ausgemusterte zählen nicht.",
              },
              {
                kind: "terms",
                items: [
                  [
                    "Nicht überwacht",
                    "ein aktives Gerät einer festgelegten Hardware-Art hat in Zabbix keinen Host mit seiner Seriennummer",
                  ],
                  [
                    "Ohne Bestandseintrag",
                    "der Host hat eine Seriennummer, aber im IT-Bestand gibt es dazu kein aktives Gerät",
                  ],
                  ["Seriennummer fehlt", "im Zabbix-Inventar des Hosts steht keine Seriennummer"],
                ],
              },
              {
                kind: "list",
                items: [
                  "Welche Hardware-Arten in Zabbix einen Host haben sollten, legt ein Admin auf der Seite Verbindung fest. Solange keine Art gewählt ist, bleibt „Nicht überwacht“ leer.",
                  "Soll ein Gerät bewusst nicht überwacht werden, zum Beispiel ein Ersatzgerät im Lager, markierst du es unter Hosts › Nicht überwacht mit einer Begründung. Es steht dann unter „Bewusst nicht überwacht“ und lässt sich dort wieder zurücknehmen.",
                  "Fehlt in Zabbix die Seriennummer, ordnest du den Host in seiner Ansicht von Hand einem Gerät zu. Sobald Zabbix eine Seriennummer liefert, gilt wieder der Abgleich über die Seriennummer.",
                  "Jede dieser Aktionen steht im Verlauf des Geräts.",
                ],
              },
              {
                kind: "hint",
                text: "Markieren und Zuordnen dürfen alle, die das Monitoring sehen und zusätzlich die Rolle Bestand.Editor haben.",
              },
            ],
            links: [
              {
                to: "/monitoring/zabbix/hosts?filter=nicht-ueberwacht",
                label: "Nicht überwachte Geräte",
              },
            ],
          },
          {
            id: "zabbix-berichte",
            title: "Berichte zur Verfügbarkeit",
            roles: [MONITORING, MONITORING_REPORTS],
            blocks: [
              {
                kind: "text",
                text: "Die Berichte zeigen, wie verfügbar die überwachten Hosts in einem Geschäftsjahr waren, aufgeteilt nach Standort oder Hostgruppe und je Monat. Beginn und Bezeichnung des Geschäftsjahrs kommen aus den Einstellungen des IT-Budgets. Die Werkbank sammelt die Daten ab dem ersten Abruf von Zabbix, nicht rückwirkend. Die Daten eines Tages kommen am Folgetag dazu.",
              },
              {
                kind: "terms",
                items: [
                  [
                    "Ausfall",
                    "Zeit, in der an einem Host ein Problem mit dem Tag scope: availability ab Schweregrad Hoch offen war, zum Beispiel „nicht erreichbar“; überlappende Probleme zählen einmal",
                  ],
                  [
                    "Verfügbarkeit",
                    "überwachte Zeit ohne Ausfall, geteilt durch die überwachte Zeit; Zeiten in einer Wartung zählen weder als Ausfall noch zur überwachten Zeit",
                  ],
                  [
                    "Zielwert",
                    "so hoch soll die Verfügbarkeit mindestens sein (Vorgabe 99,5 %); ein Admin legt ihn auf der Seite Verbindung fest",
                  ],
                ],
              },
              {
                kind: "list",
                items: [
                  "Oben wählst du das Geschäftsjahr und ob nach Standort oder nach Hostgruppe aufgeteilt wird. Ein Host in mehreren Gruppen zählt in jeder.",
                  "„Als CSV exportieren“ lädt die Tabelle mit allen Monaten herunter, zum Beispiel für eine Tabellenkalkulation.",
                  "„Drucken oder als PDF“ öffnet den Druckdialog; dort kannst du auch „Als PDF speichern“ wählen. Menüs und Knöpfe erscheinen im Ausdruck nicht.",
                  "Wer das ganze IT-Monitoring sehen darf, findet darunter die häufigsten Auslöser und die längsten Ausfälle mit Host. Mit der Rolle nur für Berichte siehst du die Summen ohne Hostnamen.",
                ],
              },
            ],
            links: [{ to: "/monitoring/zabbix/berichte", label: "Zu den Berichten" }],
          },
          {
            id: "zabbix-einrichten",
            title: "Zabbix einrichten",
            roles: [ADMIN],
            blocks: [
              {
                kind: "text",
                text: "Die Werkbank braucht in Zabbix ein eigenes Dienstkonto mit einer eigenen Benutzerrolle, die nur lesen darf, und ein API-Token mit Ablaufdatum. Nur der Server der Werkbank spricht mit Zabbix; das Token sieht im Browser niemand.",
              },
              {
                kind: "steps",
                items: [
                  "Lege in Zabbix unter Benutzer › Benutzerrollen eine neue Rolle an, Typ „Benutzer“.",
                  "Schalte in der Rolle unter „API“ den Zugriff ein. In Zabbix 8.0 ist er bei neuen Rollen aus.",
                  "Wähle bei „API-Methoden“ die Allow-Liste und trage genau diese Methoden ein: problem.get, trigger.get, host.get, hostgroup.get, maintenance.get, event.get, role.get, token.get. Ab Zabbix 8.0 sperrt eine leere Allow-Liste jeden Zugriff. Keine Platzhalter wie „*“ und keine Ablehn-Liste.",
                  "Lege eine Benutzergruppe an, die nur Leserechte auf die nötigen Hostgruppen hat, und darin ein Dienstkonto mit der neuen Rolle.",
                  "Erzeuge für das Dienstkonto ein API-Token mit Ablaufdatum, zum Beispiel zum Ende des Geschäftsjahrs.",
                  "Öffne in der Werkbank Verwaltung › Verbindungen › Zabbix (IT-Monitoring). Trage die https-Adresse von Zabbix und das Token ein; stammt das Zertifikat aus einer eigenen Zertifizierungsstelle, füge deren CA-Zertifikat im PEM-Format ein.",
                  "Speichere, wähle „Verbindung prüfen“ und schalte die Abfrage ein. Die Prüfung zeigt Version, Rolle, Ablauf des Tokens und ob die Rolle mehr erlaubt als nötig.",
                  "Ordne unter IT-Monitoring › Zabbix › Verbindung die Hostgruppen den Standorten aus dem IT-Bestand zu. Hat ein Host mehrere passende Gruppen, gilt die erste in der Liste.",
                ],
              },
              {
                kind: "hint",
                text: "Nach dem Wechsel von Zabbix 7 auf 8.0 kann eine Rolle den Platzhalter „*“ enthalten. Die Verbindungsseite warnt dann; kürze die Allow-Liste wieder auf die Methoden oben. 30 Tage vor Ablauf des Tokens erinnert die Werkbank dich.",
              },
              {
                kind: "text",
                text: "Den Bereich sehen Personen mit der Rolle Monitoring.Reader und alle Admins; die Seite „Verbindung“ nur Admins. Mit der Rolle Monitoring.Berichte sieht man nur die Berichte. Die Werkbank übernimmt keine Quittierungs-Kommentare und keine Benutzernamen aus Zabbix.",
              },
              {
                kind: "list",
                items: [
                  "Zabbix leitet weiter: Die Werkbank folgt keiner Weiterleitung, damit das Token nur bei Zabbix landet. Die Meldung nennt das Ziel. Ist es die Anmeldeseite eines Reverse Proxys, braucht die Werkbank einen Zugang ohne diese Anmeldung, zum Beispiel einen eigenen Eintrag im Proxy, den nur der Server der Werkbank erreichen darf. Die Knöpfe „In Zabbix öffnen“ führen dann über das Feld „Adresse für ‚In Zabbix öffnen‘“ weiter zur gewohnten Adresse.",
                  "Abgelehnt mit HTTP 401 oder 403: Die Anfrage kommt gar nicht bei Zabbix an, ein Proxy, eine Zugriffsregel oder der Webserver davor lehnt sie ab.",
                  "Zabbix lehnt das Token ab, obwohl es gültig ist: Oft geht der Header „Authorization“ unterwegs verloren, zum Beispiel bei Apache mit PHP-FPM ohne „CGIPassAuth On“. Prüfe außerdem, ob in der Rolle der API-Zugriff eingeschaltet und das Dienstkonto aktiv ist.",
                ],
              },
            ],
            links: [{ to: "/monitoring/zabbix/verbindung", label: "Zur Verbindung" }],
          },
        ],
      },
      {
        title: "NetBox",
        roles: [MONITORING],
        topics: [
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
                  [
                    "Fehler",
                    "die öffentliche Abfrage ging nicht, z. B. keine Antwort des Resolvers",
                  ],
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
            title: "DNS-Abgleich einrichten",
            roles: [ADMIN],
            blocks: [
              {
                kind: "steps",
                items: [
                  "Lege in NetBox einen API-Token mit Leserecht an.",
                  "Öffne Verwaltung › Verbindungen › NetBox (IT-Monitoring).",
                  "Trage die https-Adresse von NetBox und den Token ein. Stammt das Zertifikat von NetBox aus einer eigenen Zertifizierungsstelle, füge deren CA-Zertifikat im PEM-Format ein.",
                  "Speichere und wähle „Verbindung prüfen“. Danach kannst du eine View wählen; sonst gelten alle Views.",
                  "Wähle den öffentlichen Resolver, lege fest, ob die TTL verglichen wird, hake „DNS-Abgleich einschalten“ an und speichere.",
                  "Auf der Seite „DNS-Abgleich“ (Gruppe NetBox) ziehst du mit „Jetzt prüfen“ den nächsten Lauf vor.",
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
    ],
  },
  {
    id: "tickets",
    title: "Tickets",
    summary:
      "Anliegen aus den Bereichen, z. B. der IT: Liste, Ticketseite mit Verlauf, Status und Zuständigkeit, interne Notizen und die Einstellungen der Bereiche.",
    roles: [TICKETS_MEMBER, TICKETS_SETTINGS],
    parts: [
      {
        title: "Arbeiten mit Tickets",
        topics: [
          {
            id: "uebersicht",
            title: "Bereiche, Rollen und die Liste",
            roles: [TICKETS_MEMBER],
            blocks: [
              {
                kind: "text",
                text: "Jedes Ticket gehört zu einem Bereich, zum Beispiel einer Abteilung. Du siehst nur die Tickets der Bereiche, in denen du Mitglied bist. Ein Ticket aus einem anderen Bereich gibt es für dich nicht, auch nicht über seine Nummer.",
              },
              {
                kind: "text",
                text: "In jedem Bereich hast du eine von zwei Rollen: Mit „Bearbeiten“ legst du Tickets an, schreibst Antworten und interne Notizen, änderst den Status, nimmst dir freie Tickets und übergibst deine eigenen. Die Bereichsverwaltung darf zusätzlich jedes Ticket zuweisen und die Einstellungen des Bereichs pflegen.",
              },
              {
                kind: "text",
                text: "Die „Übersicht“ zeigt oben Kennzahlen: offen, dir zugewiesen, neu und frei, wartet, Erinnerung und gelöst in den letzten 30 Tagen; mit Fristen auch überfällig und wie oft die Frist eingehalten wurde. Ein Klick auf eine Kennzahl öffnet die passende Liste. Darunter stehen deine Tickets, neue freie Tickets, der Eingang der letzten 30 Tage nach Weg und die offenen Tickets nach Kategorie. Mit mehreren Bereichen wählst du oben einen aus.",
              },
              {
                kind: "text",
                text: "„Alle Tickets“ zeigt zuerst die offenen Tickets, zuletzt geänderte oben. Über die Auswahl wechselst du zu „Mir zugewiesen“, „Nicht zugewiesen“, „Wartet“, „Gelöst und geschlossen“ oder „Alle“. Die Suche findet Nummer, Betreff und Melder. Ein Ticket von Hand legst du unter „Neues Ticket“ an, zum Beispiel nach einem Anruf. Beim Namen des Melders erscheinen ab zwei Buchstaben Vorschläge aus Entra; wählst du einen, trägt die Werkbank die Mailadresse mit ein. Du kannst Name und Mailadresse auch frei eintragen.",
              },
            ],
            links: [
              { to: "/tickets/uebersicht", label: "Zur Übersicht" },
              { to: "/tickets", label: "Zu allen Tickets" },
            ],
          },
          {
            id: "ticket",
            title: "Die Ticketseite",
            roles: [TICKETS_MEMBER],
            blocks: [
              {
                kind: "text",
                text: "Oben stehen Nummer, Betreff, Status, Zuständigkeit und der Melder. Status und Zuständigkeit änderst du direkt in den Auswahlfeldern. Gespeichert wird erst mit „Bestätigen“; vorher zeigt die Seite, was sich ändert. „Verwerfen“ nimmt die Änderung zurück. Wechselst du zu einem anderen Ticket, verfällt eine nicht bestätigte Änderung.",
              },
              {
                kind: "text",
                text: "Ein freies Ticket nimmst du dir mit „Mir zuweisen“. Dein eigenes Ticket kannst du an eine andere Person des Bereichs übergeben und dabei eine Übergabenotiz schreiben. Andere Tickets übergibt nur die Bereichsverwaltung. Gelöste Tickets schließt die Werkbank nach 5 Tagen von selbst.",
              },
              {
                kind: "text",
                text: "Im Verlauf steht die ursprüngliche Meldung immer oben, darunter die letzten vier Einträge. Ältere Einträge klappst du mit „ältere Einträge anzeigen“ auf. Jeder Eintrag ist gekennzeichnet, zum Beispiel „vom Melder“, „Anruf erfasst“ oder „Intern“. Änderungen an Status und Zuständigkeit stehen als kurze Zeile dazwischen.",
              },
              {
                kind: "text",
                text: "Eine interne Notiz sieht nur, wer im Bereich Mitglied ist. Der Melder sieht sie nicht und bekommt keine Mail. Rechts stehen Bereich, Priorität und Beteiligte. Über „Verschieben nach“ gibst du ein Ticket an einen anderen Bereich ab; bist du dort nicht Mitglied, siehst du es danach nicht mehr.",
              },
              {
                kind: "text",
                text: "Unten auf der Seite wählst du „Antworten“ (nur an den Melder), „Antworten an alle“ (Melder und Beteiligte in Kopie) oder „Interne Notiz“. Im offenen Antwortfeld wechselst du mit „Nur Melder“ und „An alle“, ohne dass der Text verloren geht; darüber steht, an wen die Mail geht. Mit „Status danach“ setzt du beim Senden gleich „Wartet auf Rückmeldung“ oder „Gelöst“. Ein Entwurf bleibt erhalten, wenn du das Feld einklappst. Automatische Mails wie die Eingangsbestätigung gehen nur an den Melder.",
              },
              {
                kind: "text",
                text: "Mit „Weiterleiten“ im Kopf schickst du die ursprüngliche Meldung weiter, mit „Weiterleiten“ an einer Nachricht genau diese, zum Beispiel an einen Dienstleister. Du trägst Empfänger und einen Text ein und wählst, ob die Anhänge mitgehen. Die Mail geht aus dem Postfach des Bereichs, der Melder bekommt davon nichts mit, und im Verlauf steht ein interner Eintrag. Antwortet der Empfänger, landet das im Ticket als „Antwort von extern“; der Status ändert sich dadurch nicht. Antworten von Beteiligten heißen „von Beteiligten“.",
              },
              {
                kind: "text",
                text: "Bei Mails steht im Verlauf nur der neue Text. Zitate aus früheren Mails klappst du bei Bedarf auf. Anhänge lädst du herunter; nicht erlaubte Anhänge entfernt die Werkbank und vermerkt das im Ticket. Die ganze Mail gibt es als „Original-Mail (.eml)“.",
              },
            ],
            links: [{ to: "/tickets", label: "Zu allen Tickets" }],
          },
          {
            id: "email",
            title: "E-Mail: Eingang und Mails an den Melder",
            blocks: [
              {
                kind: "text",
                text: "Jeder Bereich hat ein eigenes Postfach. Die Werkbank schaut alle 5 Minuten hinein. Eine neue Mail wird ein neues Ticket; eine Antwort auf ein Ticket landet im selben Ticket. Personen in Kopie werden Beteiligte. Erkannt werden Antworten an der Nummer im Betreff, zum Beispiel [#T-1042], und an den Angaben der Mail selbst.",
              },
              {
                kind: "text",
                text: "Abwesenheitsnotizen, Unzustellbarkeitsberichte, Newsletter und gesperrte Absender landen im Ordner „Ignoriert“. Schickt jemand mehr als 10 Mails in einer Stunde, werden weitere ignoriert. Verarbeitete Mails kommen in den Ordner „Verarbeitet“. Die Werkbank löscht sie dort nach der eingestellten Frist endgültig; das Original bleibt am Ticket.",
              },
              {
                kind: "text",
                text: "Für externe Absender stellt die Bereichsverwaltung ein: annehmen, unbekannte erst prüfen oder ablehnen. Unbekannt heißt: In diesem Bereich gibt es noch kein Ticket von ihnen. Solche Mails stehen unter „Zu prüfen“; dort legst du sie als Ticket an, verwirfst sie oder sperrst den Absender. Kommt eine neue Mail dorthin, bekommt die Bereichsverwaltung eine Benachrichtigung. Entscheidet niemand, verwirft die Werkbank die Mail nach der eingestellten Zahl von Tagen (Vorgabe 30). Was mit jeder Mail passiert ist, zeigt „Letzte Eingänge“. Einträge dort, die zu keinem Ticket gehören, löscht die Werkbank nach der eingestellten Zahl von Tagen (Vorgabe 90); Einträge zu einem Ticket gehen mit dessen Aufbewahrung.",
              },
              {
                kind: "text",
                text: "Antwortet der Melder auf ein geschlossenes Ticket, öffnet die Werkbank es je nach Einstellung wieder oder legt ein neues Ticket mit Verweis an. Auf ein Ticket mit „Wartet auf Rückmeldung“ oder „Gelöst“ geht es mit seiner Antwort wieder auf „In Arbeit“.",
              },
              {
                kind: "text",
                text: "Alle Mails an den Melder kommen aus dem Postfach des Bereichs, nie von deiner eigenen Adresse. Je Bereich lassen sich eine Eingangsbestätigung und kurze automatische Mails bei Statuswechseln einschalten, dazu Absendername, Titel und Signatur. Farbe, Logo, Fußzeile und Datenschutz-Link legt die Ticket-Verwaltung für alle fest.",
              },
            ],
            links: [{ to: "/tickets/einstellungen", label: "Zu den Einstellungen" }],
          },
          {
            id: "arbeitshilfen",
            title: "Arbeitshilfen: Kategorie, Frist, Erinnerung, IT-Bestand, Textbausteine",
            blocks: [
              {
                kind: "text",
                text: "Kategorien ordnen ein Ticket ein, zum Beispiel Drucker oder Zugang. Wählst du beim Anlegen eine Kategorie, schlägt sie eine Priorität vor. Die Bereichsverwaltung legt die Kategorien in den Einstellungen an.",
              },
              {
                kind: "text",
                text: "Hat der Bereich Fristen eingeschaltet, steht am Ticket, bis wann es gelöst sein soll. Gezählt wird nur die Arbeitszeit des Bereichs. Solange das Ticket auf eine Rückmeldung wartet, ruht die Frist. Kurz vor Ablauf und bei Überschreitung bekommt die zuständige Person eine Benachrichtigung; in der Liste steht dann „überfällig“. Ohne Fristen erscheint im Bereich nirgends eine Frist.",
              },
              {
                kind: "text",
                text: "Mit dem Status „Erinnerung“ legst du ein Ticket bis zu einem Zeitpunkt beiseite, auf Wunsch mit Stichwort. Zum Zeitpunkt wird es wieder „In Arbeit“ und die zuständige Person bekommt eine Benachrichtigung. Wie jeder Statuswechsel gilt das erst nach „Bestätigen“. Gibst du ein Ticket an jemand anderen, kannst du die Person benachrichtigen lassen.",
              },
              {
                kind: "text",
                text: "Meldet jemand dasselbe zweimal, führst du die Tickets zusammen. Der Verlauf wandert ins Ziel und ist dort mit „aus T-…“ gekennzeichnet; das alte Ticket wird geschlossen. Spätere Mails dazu landen im Ziel. Das lässt sich nicht rückgängig machen.",
              },
              {
                kind: "text",
                text: "Mit Rechten im IT-Bestand siehst du rechts außerdem „Im IT-Bestand“: die Stelle des Melders mit Abteilung, Arbeitsplatz und Geräten und seine offenen Verleihe. Die Werkbank findet die Stelle über die Mailadresse des Melders. Umgekehrt stehen auf der Seite einer Stelle im IT-Bestand die Tickets der Person; Tickets aus Bereichen, die du nicht siehst, nur als Anzahl. Ohne Rechte im IT-Bestand erscheint davon nichts.",
              },
              {
                kind: "text",
                text: "Textbausteine sind vorgefertigte Antworten und Notizen. Tippe im Antwortfeld einen Schrägstrich und das Kürzel, wähle mit den Pfeiltasten und übernimm mit der Eingabetaste. Platzhalter wie {Vorname} oder {Nr} werden ersetzt. Ein Baustein kann den Status danach vorschlagen.",
              },
            ],
            links: [{ to: "/tickets", label: "Zu den Tickets" }],
          },
        ],
      },
      {
        title: "Verwaltung",
        topics: [
          {
            id: "einstellungen",
            title: "Bereiche und Rollen einstellen",
            roles: [TICKETS_SETTINGS],
            blocks: [
              {
                kind: "text",
                text: "Die Einstellungen haben Reiter: Bereiche, Kategorien und Fristen, E-Mail-Eingang, E-Mail-Gestaltung (nur die Ticket-Verwaltung), Textbausteine, Aufbewahrung und Rollen. In den Reitern, die je Bereich gelten, wählst du oben den Bereich. Du siehst nur Bereiche, die du einstellen darfst.",
              },
              {
                kind: "text",
                text: "Die Ticket-Verwaltung legt Bereiche an, trägt das Postfach ein und vergibt die Rollen, auch die Bereichsverwaltung. Sie selbst sieht dadurch keine Tickets. Die Bereichsverwaltung vergibt in ihrem Bereich „Bearbeiten“ und legt fest, wie neue Tickets zugewiesen werden.",
              },
              {
                kind: "text",
                text: "Eine Rolle bekommt eine Gruppe aus Entra oder eine einzelne Person. Bei Gruppen zählen auch Mitglieder verschachtelter Gruppen. Wer aus einer Gruppe entfernt wird, verliert den Zugriff nach wenigen Minuten. Jeder Bereich behält mindestens einen Eintrag mit Bereichsverwaltung.",
              },
              {
                kind: "text",
                text: "Bei „Wer zuerst übernimmt“ bleiben neue Tickets frei, bis sich jemand eins nimmt. Bei „Reihum“ bekommt die Person mit „Bearbeiten“, die gerade die wenigsten offenen Tickets hat, das neue Ticket. Die Bereichsverwaltung zählt dabei nicht mit.",
              },
            ],
            links: [{ to: "/tickets/einstellungen", label: "Zu den Einstellungen" }],
          },
          {
            id: "betrieb",
            title: "Aufbewahrung, Export und Protokoll",
            roles: [TICKETS_MEMBER, TICKETS_SETTINGS],
            blocks: [
              {
                kind: "text",
                text: "Die Aufbewahrung legt fest, wie lange geschlossene Tickets bleiben. Die Ticket-Verwaltung stellt eine Vorgabe für alle Bereiche ein; ausgeschaltet bleibt alles erhalten. Die Bereichsverwaltung übernimmt die Vorgabe oder stellt für ihren Bereich eine eigene Regel ein: nach so vielen Monaten oder Jahren ab dem Schließen anonymisieren oder vollständig löschen. Wird ein Ticket wieder geöffnet, beginnt die Frist beim nächsten Schließen neu.",
              },
              {
                kind: "text",
                text: "Anonymisieren entfernt Melder, Mailadressen, Betreff, alle Texte, Anhänge und die Namen der Bearbeiter. Nummer, Bereich, Kategorie, Priorität, Zeitpunkte und ob die Frist eingehalten wurde bleiben für die Kennzahlen. Vollständig löschen entfernt das Ticket ganz. Beides passiert einmal am Tag und lässt sich nicht rückgängig machen. In den Einstellungen des Bereichs siehst du vorher, welche Tickets beim nächsten Lauf betroffen sind, und darunter die letzten Läufe.",
              },
              {
                kind: "text",
                text: "Muss ein Ticket länger bleiben, setzt die Bereichsverwaltung auf der Ticketseite eine Ausnahme mit Begründung. Sie gilt ein Jahr. 30 Tage vor dem Ende kommt eine Benachrichtigung; wer die Ausnahme dann nicht bestätigt, lässt sie verfallen, und das Ticket ist beim nächsten Lauf dran.",
              },
              {
                kind: "text",
                text: "Unter „Alle Tickets“ lädt die Bereichsverwaltung die gefilterte Liste mit „Als Excel exportieren“ herunter. Die Datei enthält Nummer, Betreff, Bereich, Status, Kategorie, Priorität, Zuständig, Melder, Eingang und die Zeitpunkte, aber keine Nachrichten. Es kommen nur Tickets aus Bereichen hinein, die du verwaltest.",
              },
              {
                kind: "text",
                text: "Der Reiter „Rollen“ zeigt die Rollen des gewählten Bereichs, darunter alle Bereiche im Überblick und das Protokoll: Änderungen an Einstellungen und Rollen, Zuständigkeit, Status, Zusammenführen, Exporte, Ausnahmen und Aufbewahrungsläufe, jeweils mit Person und Zeitpunkt, aber ohne Texte. Die Ticket-Verwaltung sieht alle Bereiche, die Bereichsverwaltung ihre eigenen. Einträge bleiben drei Jahre.",
              },
            ],
            links: [
              { to: "/tickets/einstellungen/aufbewahrung", label: "Zur Aufbewahrung" },
              { to: "/tickets/einstellungen/rollen", label: "Zu den Rollen" },
            ],
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
    parts: [
      {
        title: "Vorgänge",
        topics: [
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
                  "Wähle unter „Vorgänge“ einen Vorgang.",
                  "Tippe auf „Ich übernehme“, damit alle sehen, dass du dich kümmerst.",
                  "Wähle bei einem neuen Gerät: einer Stelle zuordnen, einem Arbeitsplatz zuordnen, ins Lager, „Ist dasselbe Gerät“ oder nicht in den Bestand aufnehmen. Such je nach Wahl Stelle, Arbeitsplatz, Raum oder das vorhandene Gerät: Tippe ein paar Buchstaben oder Ziffern (Nummer, Name der Person, Raum, Hostname oder Seriennummer) und wähle den Treffer. Mit „Ändern“ wählst du neu.",
                  "Tippe auf „Übernehmen und abschließen“. Die Werkbank legt das Gerät an oder verknüpft es.",
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
            ],
            links: [{ to: "/bestand/vorgaenge", label: "Zu den Vorgängen" }],
          },
          {
            id: "statistik",
            title: "Statistik",
            blocks: [
              {
                kind: "text",
                text: "Unter „Statistik“ stehen oben sechs Kennzahlen: aktive Geräte, freie Geräte im Lager, Verleih, fällige Erneuerung, Arbeitsplätze mit Lücke und fehlende Angaben. Ein Klick auf eine Kennzahl öffnet den passenden Bereich. Darunter sind die Auswertungen in Bereiche aufgeteilt: Überblick, Alter & Erneuerung, Standorte & Arbeitsplätze, Verleih, Ausmusterung und Datenqualität. Ausgemusterte Geräte zählen nur unter „Ausmusterung“.",
              },
              {
                kind: "steps",
                items: [
                  "Filtere oben nach Hersteller, Art, Standort oder Abteilung. Die Zahl hinter jedem Eintrag zeigt, wie viele Geräte unter den übrigen Filtern dazu passen.",
                  "Bei Art, Hersteller, Standort und freien Geräten im Lager filtert ein Klick auf einen Balken die ganze Seite; ein zweiter Klick hebt den Filter wieder auf.",
                  "Wechsle bei jeder Auswertung mit „Balken“ oder „Tabelle“ die Darstellung. Die Tabelle zeigt auch den Anteil.",
                  "„Drucken oder als PDF“ druckt den gewählten Bereich ohne Menüs.",
                ],
              },
              {
                kind: "terms",
                items: [
                  [
                    "Erneuerung fällig",
                    "Geräte, die älter sind als die Nutzungsdauer ihrer Art. Die Nutzungsdauer trägst du in den Stammdaten bei den Hardware-Arten ein; ohne sie bleibt die Auswertung leer.",
                  ],
                  [
                    "Im Lager, frei",
                    "Geräte ohne Stelle, ohne Arbeitsplatz und ohne Verleih oder Reservierung",
                  ],
                  [
                    "Hervorgehobene Balken",
                    "Werte, die du dir ansehen solltest, etwa ein Betriebssystem ohne Sicherheitsupdates; in der Tabelle steht dann „beachten“",
                  ],
                ],
              },
              {
                kind: "hint",
                text: "Das Alter rechnet die Werkbank aus dem Anschaffungsdatum am Gerät. Fehlt es, nimmt sie bei Monitoren das Baujahr aus NinjaOne, sonst zählt das Gerät als „unbekannt“. Das Anschaffungsdatum trägst du beim Gerät unter „Bearbeiten“ ein.",
              },
            ],
            links: [{ to: "/bestand/statistik", label: "Zur Statistik" }],
          },
        ],
      },
      {
        title: "Bestand",
        topics: [
          {
            id: "hardware",
            title: "Hardware im Überblick",
            blocks: [
              {
                kind: "text",
                text: "Unter „Hardware“ stehen alle Geräte mit Art, Hersteller und Modell, Seriennummer, Inventurnummer und Herkunft. Die Suche findet Geräte über Bezeichnung, Seriennummer, Inventurnummer, Hostname, Art und Modell; daneben filterst du nach Art. Vorgabe ist die Ansicht „Im Bestand“; ausgemusterte Geräte findest du unter „Ausgemustert“ oder „Alle“. Es werden zuerst 50 Geräte gezeigt, mit „Mehr anzeigen“ kommen weitere dazu; die Suche durchsucht immer den ganzen Bestand. Genauso sind die Listen „Stellen“ und „Arbeitsplätze“ aufgebaut.",
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
                  "Tippe unter „Hardware“ auf „Gerät erfassen“.",
                  "Trag Bezeichnung und Art ein, auf Wunsch Hersteller und Modell, Seriennummer, Hostname und eine Notiz.",
                  "Hat das Gerät schon einen Aufkleber mit Inventurnummer, trag sie gleich mit ein.",
                  "Den Raum und bei „Zugeordnet zu“ eine Stelle oder einen Arbeitsplatz wählst du über die Suche: Tippe Nummer, Name, Person oder Raum und wähle aus der Liste. Beides ist freiwillig.",
                  "Tippe auf „Gerät anlegen“. Mit Inventurnummer fragt die Werkbank noch einmal nach: Vergleiche die Nummer mit dem Aufkleber und bestätige.",
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
                  "Tippe im Gerät auf „Ausmustern“.",
                  "Wähle Grund, Verbleib und Datum. Verbleib ist entsorgt, verkauft oder abgegeben, an Leasing zurück oder beim Hersteller.",
                  "Bestätige bei Geräten mit Datenträger (zum Beispiel Notebook und PC), dass er gelöscht oder vernichtet ist. Ohne diesen Haken geht es nicht weiter.",
                  "Trag auf Wunsch eine Notiz ein, etwa die Nummer des Entsorgungsnachweises.",
                  "Tippe auf „Weiter“ und dann auf „Ja, ausmustern“.",
                ],
              },
              {
                kind: "hint",
                text: "Versehentlich ausgemustert? Im Gerät „Wieder in Betrieb nehmen“ tippen. Auch das steht im Verlauf.",
              },
            ],
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
                kind: "text",
                text: "Im Reiter „Hardware“ einer Stelle stehen zwei Teile: „Direkt an der Stelle“ sind Geräte, die der Stelle selbst zugeordnet sind. „Über Arbeitsplätze“ sind Geräte an den Arbeitsplätzen der Stelle, je Arbeitsplatz mit dem Hinweis „über Arbeitsplatz“ und, bei geteilten Plätzen, mit wie vielen weiteren Stellen er geteilt ist. Die Zahl in der Liste der Stellen zählt nur die direkt zugeordnete Hardware.",
              },
              {
                kind: "steps",
                items: [
                  "Tippe unter „Stellen“ auf „Stelle anlegen“.",
                  "Trag die Bezeichnung ein und wähle auf Wunsch die Abteilung.",
                  "Tippe unter „Wer besetzt die Stelle?“ mindestens zwei Buchstaben des Namens oder Anmeldenamens und wähle die Person aus der Liste. Ist die Stelle frei, lass das Feld leer.",
                  "Tippe auf „Stelle anlegen“. Die Nummer vergibt die Werkbank.",
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
                text: "Ein Arbeitsplatz steht in einem Raum. Ein Einzelarbeitsplatz gehört zu genau einer Stelle, ein geteilter Arbeitsplatz zu mehreren. Ein Pool-Arbeitsplatz gehört absichtlich keiner Stelle, etwa beim Desk-Sharing, für Gäste oder Schulungen: Er hat einen Zweck aus den Stammdaten und auf Wunsch eine verantwortliche Abteilung, und er zählt nie als „frei“. Über der Liste suchst du nach Nummer, Raum, Stelle oder Zweck; mit den Filtern findest du zum Beispiel Pool-Arbeitsplätze, freie Plätze oder Plätze, an denen Ausstattung fehlt.",
              },
              {
                kind: "steps",
                items: [
                  "Tippe unter „Arbeitsplätze“ auf „Arbeitsplatz anlegen“.",
                  "Such den Raum und wähle ihn; er ist Pflicht. Hat die Etage einen Grundriss, erscheint er gleich darunter: Ein Klick in den Raum setzt den Platz des Arbeitsplatzes. Das ist freiwillig und geht auch später.",
                  "Wähle den Typ: Einzelarbeitsplatz, geteilter Arbeitsplatz oder Pool-Arbeitsplatz. Beim Pool-Arbeitsplatz wählst du den Zweck und auf Wunsch die verantwortliche Abteilung; Stellen gibt es dort nicht. Einen Namen braucht der Arbeitsplatz nicht; er heißt nach seiner Nummer.",
                  "Wähle auf Wunsch eine Vorlage für die Ausstattung.",
                  "Such unter „Stelle hinzufügen“ nach Nummer, Stelle, Person oder Abteilung und wähle den Treffer; bei einem geteilten Arbeitsplatz auch mehrere. Bei einem Pool-Arbeitsplatz entfällt dieser Schritt.",
                  "Tippe auf „Arbeitsplatz anlegen“.",
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
                  "Öffne den Arbeitsplatz und wechsle zum Reiter „Standort“.",
                  "Tippe auf „Platz im Grundriss setzen“ und klick im hervorgehobenen Raum auf die Stelle, an der der Arbeitsplatz steht.",
                  "Ohne Maus: Öffne „Platz mit Zahlen eingeben“ und trag ein, wie weit von links und von oben im Raum der Platz liegt (in Prozent).",
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
                text: "Rechts steht immer genau das, was du gewählt hast: Bei einer Stadt, einem Standort oder Abschnitt siehst du, was darunter liegt. Bei einer Etage siehst du den Grundriss und daneben die Räume: je Raum der Name, darunter Nutzung oder Beschreibung und die belegten Arbeitsplätze (freie Plätze stehen extra da), rechts die Zahl der Geräte. Über „Raum suchen“ findest du Räume nach Name, Beschreibung oder Person, über „Zeigen“ nur Räume mit freien Plätzen, mit Geräten oder ohne Geräte. Ab 13 Räumen ordnet die Werkbank sie nach dem Anfang der Raumnummer in Gruppen, zum Beispiel „Räume 200–299“; jede Gruppe lässt sich zuklappen. Wählst du einen Raum, stehen seine Angaben und Arbeitsplätze neben dem Grundriss; „Alle Räume“ führt zurück. Der Pfad über dem Titel ist anklickbar.",
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
                  "Tippe in der Etage auf „Etage bearbeiten“ und wähle „Grundriss hochladen“ (PNG, JPEG oder WebP). Dort benennst du die Etage auch um, änderst die Reihenfolge oder löschst sie.",
                  "Tippe auf „Räume bearbeiten“ und zieh auf freier Fläche ein Rechteck auf. Trag danach den Namen des Raums ein und tippe auf „Raum anlegen“.",
                  "Räume verschiebst du durch Ziehen; der Griff unten rechts ändert die Größe. Ohne Maus wählst du den Raum und trägst die Lage in Prozent ein.",
                  "Tippe auf „Fertig“.",
                ],
              },
              {
                kind: "text",
                text: "Ein Gerät ordnest du beim Erfassen oder unter „Bearbeiten“ einem Raum zu. Im Gerät zeigt der Reiter „Standort“ den Raum auf dem Grundriss. Am gewählten Raum trägst du unter „Nutzung oder Beschreibung“ freiwillig ein, wofür er dient, zum Beispiel Besprechung oder Technik. Umbenennen und löschen kannst du Stadt, Standort und Abschnitt dort, wo du sie geöffnet hast. Löschen lässt sich nur, was leer ist: ein Raum ohne Geräte, eine Etage ohne Räume und so weiter.",
              },
            ],
            links: [{ to: "/bestand/standorte", label: "Zu den Standorten" }],
          },
        ],
      },
      {
        title: "Verleih",
        topics: [
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
                  "Tippe unter „Verleih“ auf „Neuer Verleih“.",
                  "Tippe unter „Wer leiht aus?“ mindestens zwei Buchstaben des Namens und wähle die Person aus der Liste.",
                  "Bei „Ab“ steht heute. Soll der Verleih erst später beginnen, wähle ein Datum in der Zukunft. Wähle dann das Rückgabedatum und kreuz die Geräte an. Verleihen kannst du Geräte, die keiner Stelle und keinem Arbeitsplatz zugeordnet und nicht schon verliehen sind.",
                  "Tippe auf „Verleihen“. Die Nummer vergibt die Werkbank.",
                ],
              },
              {
                kind: "text",
                text: "Ein Verleih mit Startdatum in der Zukunft ist „Geplant“: Die Geräte sind ab sofort reserviert und lassen sich nicht anders verleihen. Brauchst du sie doch nicht, wählst du beim Verleih die Geräte und „Reservierung aufheben“; dann entsteht kein Vorgang und die Person bekommt keine Nachricht. Am Startdatum wird aus „Geplant“ ein normaler Verleih.",
              },
              {
                kind: "text",
                text: "Die Person bekommt per Mail und Teams eine Nachricht: bei der Ausgabe (bei einem geplanten Verleih am Startdatum), zwei Tage vor dem Rückgabedatum, wenn der Verleih überfällig ist (am Tag danach und dann jede Woche) und wenn alles zurück ist. Darin stehen nur die Verleihnummer und das Datum, keine Gerätedaten. Welche Nachrichten verschickt wurden, steht beim Verleih.",
              },
              {
                kind: "steps",
                items: [
                  "Öffne den Verleih.",
                  "Kreuz die Geräte an, die zurück sind. Einzelne Geräte gehen auch.",
                  "Tippe auf „Rückgabe eintragen“. Für jede Rückgabe entsteht ein Vorgang „Rückgabe prüfen“.",
                  "Wähle im Vorgang „Geprüft, zurück ins Lager“ oder „Defekt oder unvollständig“.",
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
        ],
      },
      {
        title: "Verwaltung",
        topics: [
          {
            id: "stammdaten",
            title: "Stammdaten",
            blocks: [
              {
                kind: "list",
                items: [
                  "Hardware-Arten: zum Beispiel Notebook, PC, Monitor. Bei jeder Art legst du fest, ob sie einen Datenträger hat und wie lange sie genutzt wird (Nutzungsdauer in Jahren, für den Erneuerungsbedarf in der Statistik).",
                  "Hersteller und Modelle: je Hersteller beliebig viele Modelle.",
                  "Gründe fürs Ausmustern: zum Beispiel defekt, veraltet, verloren oder gestohlen, Garantietausch.",
                  "Abteilungen: Auswahl bei der Stelle und als verantwortliche Abteilung beim Pool-Arbeitsplatz.",
                  "Zwecke für Pool-Arbeitsplätze: Auswahl beim Pool-Arbeitsplatz, zum Beispiel Desk-Sharing, Gast oder Schulung.",
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
    ],
  },
  {
    id: "it-budget",
    title: "IT-Budget",
    summary:
      "Konten, Budgetposten, Verträge, Rechnungen und Partner; Plan und Ist je Geschäftsjahr.",
    roles: [BUDGET_READER, BUDGET_EDITOR, BUDGET_MANAGER],
    parts: [
      {
        title: "Überblick",
        topics: [
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
                    "ein Vorhaben unter einem Konto, z. B. eine Software, mit Betrag je Geschäftsjahr und Laufzeit",
                  ],
                  [
                    "Nummer",
                    "jeder Budgetposten hat eine feste Nummer wie BP-2026-012: das Geschäftsjahr, in dem er angelegt wurde, und eine laufende Nummer. Sie ändert sich nie.",
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
                  ["Plan", "die Beträge der Budgetposten (geplant)"],
                  ["Ist", "Summe der gebuchten Rechnungspositionen (brutto) im Geschäftsjahr"],
                  ["Verfügbar", "Plan minus Ist"],
                ],
              },
              {
                kind: "text",
                text: "Gezählt wird im Budget immer brutto. Beträge trägst du am Budgetposten, am Vertrag und an der Rechnungsposition wahlweise netto oder brutto ein, dazu den Steuersatz (Vorgabe 19 %, jeder andere lässt sich eintragen); den anderen Wert rechnet die Werkbank und zeigt ihn gleich darunter. Das auf einer Seite gewählte Geschäftsjahr gilt auch auf den anderen Seiten.",
              },
            ],
          },
          {
            id: "uebersicht",
            title: "Übersicht",
            blocks: [
              {
                kind: "text",
                text: "Oben steht, was zu erledigen ist, zum Beispiel zu prüfende Rechnungen, Posten ohne Partner, anstehende Kündigungstermine oder Verträge ohne AVV; ein Klick führt in die passende Liste. Darunter stehen die Kennzahlen Geplant, Ist, Verfügbar und die Zahl der Budgetposten, das Budget nach Konten (laufende Kosten und Investitionen) mit Auslastung, die Kündigungstermine der nächsten 120 Tage und die zuletzt gebuchten Rechnungen.",
              },
            ],
            links: [{ to: "/budget", label: "Zur Übersicht" }],
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
                text: "Die Statistik hat drei Reiter. Oben wählst du das Jahr, um das es geht, und ein früheres Jahr zum Vergleich (Vorgabe: das Vorjahr). Alle Beträge sind brutto; Ist sind gebuchte Rechnungen nach Rechnungsdatum.",
              },
              {
                kind: "text",
                text: "„Überblick“ zeigt Geplant, Ist, Verfügbar, Ausschöpfung und die Veränderung zum Vergleichsjahr im selben Zeitraum. Darunter stehen der Verlauf (Ist aufsummiert je Monat mit dem Vergleichsjahr und den erwarteten Kosten als Linie), die Ausgaben je Monat, die Konten mit der höchsten Ausschöpfung und eine Kachel zu den Verträgen mit den nächsten Kündigungsterminen. Tippst du einen Monat an, stehen seine Werte darüber; „Als Tabelle“ zeigt dieselben Zahlen.",
              },
              {
                kind: "text",
                text: "„Konten und Partner“ beginnt mit dem Jahresvergleich: je Konto (oder unter „Nach Art“ für laufende Kosten und Investitionen) ein Wert für jedes gewählte Jahr. Du wählst das oben gewählte Jahr und bis zu vier davor; jedes behält seine Farbe. Im laufenden Jahr vergleicht „Bis heute“ jedes Jahr bis zum selben Tag, „Ganzes Jahr“ nimmt für laufende und künftige Jahre die erwarteten Kosten (gestrichelt). Die Darstellung wählst du als Säulen, überlappende Balken oder Balken nebeneinander. Tippst du ein Konto an, siehst du seine Werte und rechts den Verlauf über fünf Jahre. Darunter stehen Plan und Ist je Konto und die größten Rechnungssteller.",
              },
              {
                kind: "text",
                text: "„Nach Tags“ wertet Posten mit gewählten Tags aus: je Tag eine Gruppe mit denselben Jahren wie im Jahresvergleich. Müssen alle gewählten Tags am Posten stehen, gibt es eine gemeinsame Gruppe. Darunter stehen die passenden Posten; eine Auswahl lässt sich unter einem Namen speichern. Für einen Ausblick wählst du oben ein künftiges Jahr.",
              },
            ],
            links: [
              { to: "/budget/planung", label: "Zur Mehrjahresübersicht" },
              { to: "/budget/statistik", label: "Zur Statistik" },
            ],
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
        title: "Ausgaben",
        topics: [
          {
            id: "posten",
            title: "Budgetposten",
            blocks: [
              {
                kind: "text",
                text: "Je Geschäftsjahr hat ein Posten einen Status: „offen“, „Rechnung liegt vor“ oder „abgeschlossen“. Abgeschlossen ist er, sobald du ihn mit „Abschließen“ abhakst (gilt für das oben gewählte Geschäftsjahr) oder eine gebuchte Rechnungsposition mit „schließt den Posten ab“ auf ihm liegt. „Wieder öffnen“ nimmt das Abhaken zurück; schließt eine Rechnung den Posten ab, entfernst du dafür den Haken an der Rechnungsposition. Die Tabelle zeigt je Posten Nummer, Konto, Partner, Geplant, Ist, Status und Vorjahr. Ein Klick auf eine Spaltenüberschrift sortiert, unter „Gruppieren“ wählst du nach Konto, nach Partner oder ohne Gruppen; auf dem Handy sortierst du unter „Weitere Filter“. Der Status hängt nur daran, ob eine Rechnung angelegt ist, nicht an einem PDF. Gibt es zu einer Rechnung ein PDF, steht in der Zeile ein rotes Symbol, das es direkt öffnet. Ein Klick auf einen Posten öffnet ihn rechts daneben mit Status, Beträgen, Angaben, den Rechnungen auf dem Posten und „Verknüpft“; dort findest du auch „Abschließen“, „Bearbeiten“ und „Löschen“. Ältere Posten ohne Partner tragen den Hinweis „Partner fehlt“; beim nächsten Bearbeiten wählst du ihn. Suche (auch nach Nummer und Partner), Status, Tag und IT-Projekt helfen beim Finden.",
              },
              {
                kind: "steps",
                items: [
                  "Wähle „Posten hinzufügen“. Die Maske öffnet rechts neben der Tabelle.",
                  "Abschnitt 1: Trag Bezeichnung, Konto und Partner (die Firma) ein; alle drei sind Pflicht.",
                  "Abschnitt 2: Wähle „Netto“ oder „Brutto“, trag den Betrag und den Steuersatz ein und wähle die Laufzeit: einmalig in einem Geschäftsjahr, mehrere Jahre bis zu einem Geschäftsjahr oder bis auf Weiteres. Darunter stehen der andere Wert und der Plan in Worten.",
                  "Abschnitt 3 (freiwillig): Vertrag, IT-Projekt, Tags und Notiz. Tags legt der Budgetverwalter unter Einstellungen › Tags an.",
                  "Speichere. Die Nummer bekommt der Posten beim Speichern.",
                ],
              },
              {
                kind: "text",
                text: "Nicht mehr gebrauchte Posten legst du still. Löschen geht nur, solange kein Vertrag zugeordnet ist und keine Rechnungsposition auf dem Posten liegt.",
              },
              {
                kind: "text",
                text: "Gehört ein Posten zu einem IT-Projekt, wähle das Projekt im Feld „IT-Projekt“. Seine erwarteten Kosten und Rechnungen zählen dann im Projekt unter Budget mit. Ein Posten gehört höchstens zu einem Projekt; abgeschlossene Projekte stehen nicht mehr zur Wahl. Über den Filter „IT-Projekt“ siehst du alle Posten eines Projekts.",
              },
            ],
            links: [{ to: "/budget/posten", label: "Zu den Budgetposten" }],
          },
          {
            id: "rechnungen",
            title: "Rechnungen erfassen",
            roles: [BUDGET_EDITOR, BUDGET_MANAGER],
            blocks: [
              {
                kind: "steps",
                items: [
                  "Wähle auf der Seite „Rechnungen“ „Rechnung erfassen“. Die Maske öffnet rechts neben der Tabelle.",
                  "Wähle zuerst den Rechnungssteller. Seine Budgetposten stehen danach oben in der Auswahl.",
                  "Trage Rechnungsnummer, interne Nummer und Rechnungsdatum ein. Das Datum bestimmt das Geschäftsjahr.",
                  "Lege für jeden Budgetposten eine Position an: Wähle den Budgetposten aus der Liste, dann „Netto“ oder „Brutto“, und trag Betrag und Steuersatz ein. Den anderen Wert rechnet die Werkbank. Weicht das Brutto auf der Rechnung um ein paar Cent ab, trag bei „Netto“ zusätzlich das Brutto laut Rechnung ein.",
                  "Prüfe das Kennzeichen „schließt den Posten ab“; bei Posten mit Vertrag ist es anfangs aus.",
                  "Optional: Trag den Rechnungsbetrag laut Beleg ein; er muss zur Summe passen. Häng den Beleg als PDF an (höchstens 15 MB).",
                  "Tippe auf „Rechnung speichern“.",
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
                text: "Offene Rechnungen stehen auf deiner Startseite und in der Glocke, auf der Seite „Rechnungen“ unter dem Filter „Zu prüfen“. Ein Klick auf eine Rechnung öffnet sie rechts daneben; prüfe Positionen und Beleg und wähle „Prüfen und buchen“. Rechnungen, die du selbst erfasst, sind sofort gebucht. Gebuchte Rechnungen ändern und löschen nur Personen mit Budget.Manager.",
              },
            ],
          },
          {
            id: "verknuepft",
            title: "Links und Verknüpfungen",
            blocks: [
              {
                kind: "text",
                text: "Jeder Budgetposten, jede Rechnung und jeder Vertrag hat eine eigene Adresse. Oben in der Ansicht steht sie mit „Link kopieren“; den Link kannst du jemandem schicken. Wer ihn öffnet, landet direkt in dieser Ansicht und im passenden Geschäftsjahr, braucht aber eine Rolle im IT-Budget.",
              },
              {
                kind: "list",
                items: [
                  "Budgetposten: „Verknüpft“ führt zum Vertrag und zu den Rechnungen auf dem Posten.",
                  "Rechnung: „Verknüpft“ führt zu den Budgetposten der Positionen und zu deren Verträgen.",
                  "Vertrag: „Verknüpft“ führt zu den zugeordneten Budgetposten und deren Rechnungen.",
                  "Das Link-Symbol neben einem Eintrag kopiert dessen Link, das rote Symbol öffnet das PDF der Rechnung.",
                ],
              },
            ],
          },
          {
            id: "vertraege",
            title: "Verträge",
            blocks: [
              {
                kind: "text",
                text: "Ein Vertrag hat Partner, Turnus, Betrag je Zahlung (netto oder brutto mit Steuersatz), Beginn, Laufzeit, Verlängerung, Kündigungsfrist und den Stand des Auftragsverarbeitungsvertrags (AVV). In der Maske wählst du zuerst den Turnus; das Betragsfeld heißt dann passend, zum Beispiel „Monatsbetrag“ oder „Jahresbetrag“, und darunter steht das Soll in Worten. Die Zuordnung zu Budgetposten pflegst du am Vertrag oder am Posten. Posten, die schon zu einem anderen Vertrag gehören, stehen in der Maske nicht zur Wahl; ein Hinweis nennt, wie viele es sind. Oben stehen die Kennzahlen, darunter die Tabelle mit den Filtern Laufend, Kündigung bald, Gekündigt, AVV fehlt und Alle; ein Klick öffnet den Vertrag rechts daneben.",
              },
              {
                kind: "list",
                items: [
                  "Der Kündigungstermin ergibt sich aus Laufzeitende minus Kündigungsfrist. Ist er verstrichen, gilt der Termin der nächsten Laufzeit.",
                  "Ab 60 Tagen vor dem Termin steht der Vertrag als Aufgabe auf der Startseite; die Glocke erinnert 60, 30 und 7 Tage vorher.",
                  "Kosten kommen nur über Rechnungen ins Budget. Am Vertrag siehst du je Geschäftsjahr (Auswahl oben) das Soll und das Ist.",
                  "Soll: die Zahlungen, die im Geschäftsjahr fällig werden. Bei einem jährlichen Vertrag ist das der Jahresbetrag. Bei einem monatlichen Vertrag trägst du den Monatsbetrag ein; die Liste zeigt dazu die Summe eines vollen Jahres.",
                  "Ist: die Rechnungen der zugeordneten Budgetposten, sobald ein Posten abgeschlossen ist. Bei monatlichen Verträgen legst du je Monat einen Posten an; das Ist wächst dann mit jedem abgeschlossenen Monat.",
                  "Monatsposten: Bei einem laufenden monatlichen Vertrag wählst du in der Ansicht das Konto und „Monatsposten anlegen“. Für das gewählte Geschäftsjahr entsteht je fälliger Zahlung ein Posten mit Partner und Monatsbetrag, z. B. „Mobilfunk Oktober 2026“, und wird dem Vertrag zugeordnet. Gibt es einen Monat schon, wird er übersprungen.",
                  "Gekündigt: Das Soll zählt nur die Zahlungen bis zum Kündigungstag, im folgenden Geschäftsjahr nichts mehr.",
                ],
              },
            ],
            links: [{ to: "/budget/vertraege", label: "Zu den Verträgen" }],
          },
        ],
      },
      {
        title: "Stammdaten",
        topics: [
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
        ],
      },
      {
        title: "Verwaltung",
        topics: [
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
        ],
      },
    ],
  },
  {
    id: "it-projekte",
    title: "IT-Projekte",
    summary: "Projekte mit Budget, Ansprechpartnern, Links, Jour-Fixe-Protokollen und Aufgaben.",
    roles: [PROJECTS_READER, PROJECTS_EDITOR],
    parts: [
      {
        title: null,
        topics: [
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
                  [
                    "Veranschlagt",
                    "der Rahmen, den du in den Einstellungen des Projekts einträgst",
                  ],
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
    ],
  },
  {
    id: "it-tools",
    title: "IT-Tools",
    summary: "Rechner, Generatoren, Konverter und Abfragen für den IT-Alltag.",
    roles: [TOOLS],
    parts: [
      {
        title: null,
        topics: [
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
    ],
  },
  {
    id: "verwaltung",
    title: "Verwaltung und Audit-Log",
    summary: "Einstellungen der Werkbank, Rollen und das Protokoll aller Aktionen.",
    roles: [ADMIN],
    parts: [
      {
        title: null,
        topics: [
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
                    "„Berechtigungen für den Abruf“ prüft, ob die Collector-App und der Dienstprinzipal von UTCM die Rechte für die eingetragenen Typen und eingeschalteten Funktionen haben, und nennt je fehlendem Recht die betroffenen Typen; Entra-Rollen wie „Globaler Leser“ prüft sie nicht. KI-Texte (Art der Schnittstelle: OpenAI-kompatibel oder Anthropic, Adresse, Modell, Schlüssel, Höchstzahl je Stunde; je ein Schalter für die Beschreibungen in M365 und die Vorschläge in Evergreen, Vorgabe: aus; „Verbindung testen“ zeigt bei Fehlern die Meldung des Anbieters), NetBox für den DNS-Abgleich, Abfragen der IT-Tools ins Internet (Vorgabe: erlaubt)",
                  ],
                  ["Audit-Log", "das Protokoll aller Aktionen (siehe oben)"],
                ],
              },
              {
                kind: "text",
                text: "Auf der Seite „Rollen“ steht, welche Rollen es gibt und wer sie bei der letzten Anmeldung hatte. „Nach Person“ zeigt dieselbe Information je Person: wer sich angemeldet hat und mit welchen Rollen; mit der Suche findest du Personen und Rollen, „Nur Personen ohne Rolle“ zeigt, wer sich angemeldet hat, aber nichts sieht. Wer sich noch nie angemeldet hat, steht dort nicht. Vergeben werden Rollen in Microsoft Entra, nicht in der Werkbank.",
              },
              { kind: "hint", text: "Jede Änderung in der Verwaltung steht im Audit-Log." },
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
                text: "Abrufe aus dem Tenant, das Nachrichtencenter, KI-Texte und KI-Vorschläge für Evergreen, Benachrichtigungen und das Aufräumen laufen im Hintergrund. Schlägt ein Auftrag fehl, bekommst du eine Benachrichtigung, und der Fehler steht im Audit-Log; ein fehlgeschlagener Abruf der Einstellungen erscheint zusätzlich als Aufgabe.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "hilfe",
    title: "Fragen und Hilfe",
    summary: "Häufige Fragen und alle Begriffe hinter den Info-Symbolen von A bis Z.",
    roles: null,
    parts: [
      {
        title: null,
        topics: [
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
                    "Die Zähler laden alle fünf Minuten, bei jedem Seitenwechsel und beim Zurückkehren in die Werkbank neu. Ein Wechsel der Seite hilft sofort. Am Handy: Schließ die App und öffne sie neu.",
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
                    "Nein. Die Werkbank nutzt keine Tracking- oder Analysedienste. Was an Microsoft oder an Dienste der IT-Tools geht, steht in den jeweiligen Themen.",
                  ],
                ],
              },
              { kind: "text", text: "Bei Fragen, Fehlern oder Wünschen wende dich an die IT." },
            ],
          },
          {
            id: "begriffe",
            title: "Begriffe A–Z",
            glossary: true,
            blocks: [
              {
                kind: "text",
                text: "Hier stehen alle Erklärungen, die du in der Werkbank hinter einem „i“ findest. Jeder Begriff führt zum passenden Thema im Handbuch.",
              },
            ],
          },
        ],
      },
    ],
  },
];
