import type { Chapter } from "./types";

const ADMIN = "Werkbank.Admin";
const AUDITOR = "Werkbank.Auditor";
const CONFIG_READER = "Config.Reader";
const CONFIG_REVIEWER = "Config.Reviewer";
const EV_IT = "Evergreen.IT";
const EV_TEAM = "Evergreen.Team";
const EV_BR = "Evergreen.Betriebsrat";
const EV_GF = "Evergreen.GF";
const TENANT = "Tenant.Reader";
const BUDGET_READER = "Budget.Reader";
const BUDGET_EDITOR = "Budget.Editor";
const BUDGET_MANAGER = "Budget.Manager";
const TOOLS = "Tools.User";
const MONITORING = "Monitoring.Reader";

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
            text: "Die Werkbank ist die Plattform der IT für wiederkehrende Arbeit rund um Microsoft 365, Freigaben, das IT-Budget und kleine Werkzeuge. Jeder Bereich ist ein eigenes Modul. Was du siehst, hängt von deinen Rollen ab: Wer zum Beispiel nur für den Betriebsrat Stellung nimmt, sieht nur die Startseite und Evergreen.",
          },
          {
            kind: "terms",
            items: [
              ["Werkbank", "Startseite, Suche, Reports, Audit-Log und Verwaltung"],
              [
                "Microsoft 365",
                "Einstellungen des Tenants, Lizenzen, Benutzerzahlen, Zertifikate und Dienststatus",
              ],
              [
                "Evergreen",
                "Neuerungen von Microsoft bewerten und mit Betriebsrat und Geschäftsführung freigeben",
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
            text: "Die Sitzung endet nach 30 Minuten ohne Aktivität und spätestens nach 8 Stunden. Dann zeigt die Werkbank einen Hinweis und du meldest dich neu an. Mit „Abmelden“ oben rechts beendest du die Sitzung sofort.",
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
              "Kopfzeile: Name der Werkbank, Suchfeld, Glocke für Benachrichtigungen, „Meine Aufgaben“, dein Konto und „Abmelden“.",
              "Bereiche: Oben in der Navigation wechselst du zwischen Werkbank, Microsoft 365, Evergreen, IT-Budget und IT-Tools. Darunter stehen nur die Seiten des gewählten Bereichs.",
              "Zähler an der Navigation zeigen, wie viele Aufgaben auf einer Seite oder in einem Bereich warten.",
              "Unten in der Navigation stehen vier Knöpfe: Handbuch, Neuigkeiten, hell oder dunkel und „Navigation einklappen“. Eingeklappt bleiben nur die Symbole; die Wahl merkt sich dein Browser.",
              "Auf dem Handy öffnet der Knopf „Menü“ oben links die Navigation.",
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
        ],
        links: [{ to: "/", label: "Zur Startseite" }],
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
              "Unter „Benachrichtigungen“ steht je Art, ob du sie in der Glocke, per Mail oder in Teams bekommst.",
              "Hake an, was du möchtest. Jede Änderung gilt sofort.",
            ],
          },
          {
            kind: "text",
            text: "Anfangs ist alles in der Glocke an, Mail und Teams sind aus. Per Mail und in Teams bekommst du höchstens alle 15 Minuten eine Sammelnachricht: wie viele Benachrichtigungen es in welchem Bereich gibt, mit einem Link in die Werkbank. Was genau passiert ist, steht nur in der Werkbank. Mitgeteilt wird nur, was nach dem Einschalten entsteht und was du noch nicht gelesen hast.",
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
            text: "Das Suchfeld in der Kopfzeile sucht in allem, was du sehen darfst: Einstellungen, erkannte Änderungen, Evergreen-Vorgänge, Budgetposten, IT-Tools und dieses Handbuch. Gib mindestens zwei Zeichen ein und drücke Enter. Auf schmalen Bildschirmen steht die Suche in der Navigation.",
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
            text: "Ein Klick auf deinen Namen oben rechts öffnet die Seite „Konto“: deine Angaben aus Microsoft, deine Rollen mit kurzer Erklärung, Beginn und Ende der Sitzung, die Darstellung (automatisch, hell oder dunkel), deine Benachrichtigungen (Glocke, Mail, Teams) und die Version der Werkbank.",
          },
          {
            kind: "text",
            text: "„Neuigkeiten“ beschreibt je Version, was sich geändert hat. Gibt es Neues, das du noch nicht gesehen hast, weist die Werkbank darauf hin.",
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
              ["Werkbank.Auditor", "Audit-Log und Reports lesen"],
              ["Config.Reader", "Einstellungen, Änderungen und Snapshots des Tenants ansehen"],
              ["Config.Reviewer", "zusätzlich Änderungen bewerten, Angaben und Soll-Werte pflegen"],
              ["Tenant.Reader", "Lizenzen, Benutzerzahlen, Zertifikate und Dienststatus ansehen"],
              ["Evergreen.IT", "Vorgänge bewerten und umsetzen, andere Schritte vertreten"],
              [
                "Evergreen.Team",
                "Rückmeldungen der Fachabteilungen und Vorlage für den Betriebsrat",
              ],
              ["Evergreen.Betriebsrat", "zu vorgelegten Vorgängen Stellung nehmen"],
              ["Evergreen.GF", "Vorgänge nach dem Betriebsrat abnehmen oder zurückgeben"],
              ["Budget.Reader", "das IT-Budget ansehen"],
              ["Budget.Editor", "Konten, Posten, Verträge, Partner und Rechnungen pflegen"],
              [
                "Budget.Manager",
                "zusätzlich Rechnungen buchen, Partner zusammenlegen, Einstellungen des Budgets",
              ],
              ["Tools.User", "den Bereich IT-Tools öffnen"],
              ["Monitoring.Reader", "den Bereich IT-Monitoring ansehen"],
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
            text: "Die Seite „Einstellungen“ zeigt alle überwachten Einstellungen als Baum nach Dienst und Bereich. Ein Filter zeigt nur Abweichungen vom Soll-Wert. Ein Klick öffnet die Einzelheiten daneben:",
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
            text: "Die Seite „Änderungen“ listet erkannte Änderungen mit Art (neu, geändert, entfernt), Zeitpunkt und, wenn bekannt, wer geändert hat. Ein Klick zeigt vorher und nachher. Filter: offen, ungewollt, gewollt, alle.",
          },
          {
            kind: "steps",
            items: [
              "Wähle eine oder mehrere Änderungen aus.",
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
            text: "Eine Bewertung lässt sich zurücksetzen; auch das wird protokolliert. Mit der Rolle Evergreen.IT kannst du aus einer Änderung einen Evergreen-Vorgang anlegen.",
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
            text: "Ein Soll-Wert legt fest, wie eine Einstellung sein soll, von Hand oder aus einem Evergreen-Beschluss. Weicht der gelesene Wert ab, ist die Einstellung markiert, die Übersicht zählt sie, und Reviewer bekommen eine Aufgabe und eine Benachrichtigung.",
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
            text: "Ein Klick öffnet den Verlauf als Diagramm. Wähle den Zeitraum über die Knöpfe darüber; die Werte eines Tages zeigt der Zeiger oder der Regler, alle Werte stehen auch in einer Tabelle. Die Werkbank speichert je Tag einen Stand und bewahrt ihn drei Jahre auf.",
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
            text: "Die Grenzen (Vorgabe 60, 30 und 7 Tage) legt die Verwaltung fest. Die Liste zeigt „Handlungsbedarf“ oder „Alle“. Die Ansicht „Waben“ zeigt alles auf einen Blick; ein Klick auf eine Wabe zeigt die Einzelheiten.",
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
            text: "Der Dienststatus zeigt, ob Exchange Online, Microsoft Teams, SharePoint Online und Microsoft Entra laufen: in Ordnung, eingeschränkt oder unterbrochen. Die Werkbank fragt alle 15 Minuten bei Microsoft nach.",
          },
          {
            kind: "list",
            items: [
              "Offene Störungen und Hinweise stehen oben, darunter die in den letzten 30 Tagen beendeten. Aufgeklappt zeigt jeder Eintrag die Mitteilungen von Microsoft.",
              "Jeder Eintrag lässt sich im Microsoft 365 Admin Center öffnen. Dafür brauchst du dort eine Anmeldung.",
              "Die Zeitleiste zeigt die letzten 90 Tage je Dienst: Tage mit Störung, mit Hinweis oder ohne Meldung.",
              "„Ausfalldauer je Dienst“ zeigt die Stunden mit Störung je Jahr, „Störungen pro Monat“ die Zahl der Störungen über drei Jahre, wählbar je Dienst.",
            ],
          },
          {
            kind: "hint",
            text: "Störung heißt: Microsoft meldet einen Ausfall oder eine Einschränkung. Hinweise sind Mitteilungen ohne Ausfall. Die Glocke meldet Beginn und Ende von Störungen, nicht Hinweise.",
          },
        ],
        links: [{ to: "/m365/dienststatus", label: "Zum Dienststatus" }],
      },
    ],
  },
  {
    id: "evergreen",
    title: "Evergreen",
    summary:
      "Neuerungen von Microsoft bewerten und mit Betriebsrat und Geschäftsführung freigeben.",
    roles: [EV_IT, EV_TEAM, EV_BR, EV_GF],
    sections: [
      {
        id: "worum-es-geht",
        title: "Worum es geht",
        blocks: [
          {
            kind: "text",
            text: "Microsoft ändert Microsoft 365 laufend. Evergreen sorgt dafür, dass jede Neuerung, die die Mitbestimmung berührt, bewertet, dem Betriebsrat vorgelegt, von der Geschäftsführung abgenommen und danach wie beschlossen eingestellt wird. Ein solcher Fall heißt Vorgang und hat eine Nummer wie EV-2026-014.",
          },
        ],
      },
      {
        id: "ablauf",
        title: "Der Ablauf",
        blocks: [
          {
            kind: "terms",
            items: [
              [
                "1. IT-Bewertung",
                "IT: mitbestimmungspflichtig oder nicht (dann mit Begründung abgeschlossen)",
              ],
              ["2. Fachabteilungen", "Team: Rückmeldungen der Fachabteilungen liegen vor"],
              ["3. Vorlage BR", "Team: an den Betriebsrat übergeben"],
              ["4. Betriebsrat", "zustimmen, mit Auflagen zustimmen oder ablehnen"],
              ["5. Geschäftsführung", "abnehmen oder zurückgeben (zurück zur Vorlage BR)"],
              [
                "6. Umsetzung",
                "IT stellt die Soll-Werte ein; schließt von selbst, wenn alles stimmt",
              ],
            ],
          },
          {
            kind: "text",
            text: "Ein Vorgang kommt nur über diese Aktionen weiter. Jede Aktion steht mit Person, Zeitpunkt, Entscheidung und Kommentar im Protokoll des Vorgangs; das Protokoll lässt sich nicht ändern. Endzustände: abgeschlossen, ohne Vorlage abgeschlossen, abgelehnt.",
          },
          {
            kind: "hint",
            text: "Kommentar Pflicht bei: nicht mitbestimmungspflichtig, mit Auflagen zustimmen, ablehnen und zurückgeben.",
          },
        ],
      },
      {
        id: "liste",
        title: "Vorgänge finden",
        blocks: [
          {
            kind: "text",
            text: "Die Seite „Vorgänge“ hat die Ansichten „Offen“, „Wartet auf mich“, „Abgeschlossen“ und „Alle“. „Wartet auf mich“ zeigt die Vorgänge in deinem Schritt. Die Detailseite zeigt Frist, Schrittleiste, Angaben, Entscheidung, geplante Umsetzung und das Protokoll.",
          },
          {
            kind: "text",
            text: "„Rollout in X Tagen“ zeigt, wann Microsoft die Neuerung ausrollt. Ab 21 Tagen oder weniger ist die Frist rot markiert.",
          },
        ],
        links: [{ to: "/evergreen", label: "Zu den Vorgängen" }],
      },
      {
        id: "sichtbarkeit",
        title: "Was Betriebsrat und Geschäftsführung sehen",
        roles: [EV_BR, EV_GF, EV_IT, EV_TEAM],
        blocks: [
          {
            kind: "text",
            text: "Der Betriebsrat sieht einen Vorgang, sobald er ihm vorgelegt wurde; die Geschäftsführung, sobald er bei ihr ankommt. Vorher gibt es den Vorgang für sie nicht. Technische Einzelheiten wie Pfade und Ist-Werte sind für beide ausgeblendet.",
          },
        ],
      },
      {
        id: "anlegen",
        title: "Vorgang anlegen",
        roles: [EV_IT, EV_TEAM],
        blocks: [
          {
            kind: "steps",
            items: [
              "Wähle auf der Seite „Vorgänge“ den Knopf „Vorgang anlegen“.",
              "Trage Titel (mindestens 3 Zeichen), Dienst, Rollout-Datum und eine verständliche Zusammenfassung ein.",
              "Speichere. Der Vorgang bekommt eine Nummer und steht in der IT-Bewertung.",
            ],
          },
          {
            kind: "text",
            text: "Vorgänge entstehen auch aus dem Eingang (Meldungen von Microsoft) und, für die IT, aus einer erkannten Änderung einer Einstellung.",
          },
        ],
      },
      {
        id: "eingang",
        title: "Eingang: Meldungen von Microsoft",
        roles: [EV_IT, EV_TEAM],
        blocks: [
          {
            kind: "text",
            text: "Die Werkbank liest alle sechs Stunden das Nachrichtencenter von Microsoft 365. Alle Meldungen landen im Eingang. Größere Änderungen und Meldungen mit Handlungsfrist werden automatisch zu Vorgängen; die Frist wird zum Rollout-Datum.",
          },
          {
            kind: "steps",
            items: [
              "Öffne „Eingang“ und lies die Meldung.",
              "Wähle „Als Vorgang übernehmen“, wenn sie bewertet werden muss, oder „Beiseitelegen“, wenn nicht.",
              "Beiseitegelegte Meldungen findest du unter „Beiseitegelegt“ und kannst sie zurückholen.",
            ],
          },
          {
            kind: "text",
            text: "Ändert Microsoft eine Meldung später, zeigt der Vorgang einen Hinweis. Titel und Zusammenfassung bleiben, wie ihr sie geschrieben habt.",
          },
        ],
        links: [{ to: "/evergreen/eingang", label: "Zum Eingang" }],
      },
      {
        id: "entscheiden",
        title: "Im eigenen Schritt entscheiden",
        blocks: [
          {
            kind: "steps",
            items: [
              "Öffne den Vorgang, z. B. über „Wartet auf mich“ oder die Glocke.",
              "Lies Zusammenfassung, Rückmeldungen und bisherige Entscheidungen im Protokoll.",
              "Wähle die Aktion deines Schritts und schreibe einen Kommentar, wo er Pflicht ist.",
              "Bestätige. Der Vorgang geht an den nächsten Schritt, und die Zuständigen werden benachrichtigt.",
            ],
          },
          {
            kind: "hint",
            text: "Hat jemand anderes den Vorgang inzwischen weitergegeben, weist die Werkbank deine Aktion ab. Lade dann neu.",
          },
        ],
      },
      {
        id: "im-auftrag",
        title: "Beschluss des Betriebsrats im Auftrag erfassen",
        roles: [EV_IT, EV_TEAM],
        blocks: [
          {
            kind: "text",
            text: "Hat der Betriebsrat in einer Sitzung beschlossen, kann das Team oder die IT den Beschluss im Schritt „Betriebsrat“ erfassen.",
          },
          {
            kind: "steps",
            items: [
              "Wähle „Beschluss im Auftrag erfassen“.",
              "Trage das Datum der Sitzung (nicht in der Zukunft) und den Inhalt des Beschlusses ein und wähle die Entscheidung.",
              "Bestätige. Im Protokoll steht dein Name mit dem Zusatz „im Auftrag des BR“.",
            ],
          },
        ],
      },
      {
        id: "umsetzung",
        title: "Umsetzung und Soll-Werte",
        roles: [EV_IT],
        blocks: [
          {
            kind: "text",
            text: "Unter „Geplante Umsetzung“ trägt die IT ein, wie die Neuerung eingestellt wird: Bezeichnung, Soll-Wert, Anleitung, Kennzeichen „vorläufig“ und, wenn möglich, die überwachte Einstellung aus Microsoft 365.",
          },
          {
            kind: "list",
            items: [
              "Mit überwachter Einstellung gilt ein Eintrag als umgesetzt, sobald der Abruf den Soll-Wert im Tenant findet.",
              "Ohne überwachte Einstellung bestätigst du die Umsetzung je Eintrag selbst; Person und Zeitpunkt werden festgehalten.",
              "Sind alle Einträge umgesetzt, schließt der Schritt „Umsetzung“ von selbst. Von Hand schließen geht nicht.",
              "Ist die Neuerung nicht steuerbar, kennzeichne den Vorgang als „nicht steuerbar“; dann schließt er ohne Einträge.",
              "Beim Abschluss werden die Soll-Werte bei den Einstellungen hinterlegt; Abweichungen fallen danach auf.",
            ],
          },
          {
            kind: "hint",
            text: "Rollt Microsoft in höchstens 21 Tagen aus und gibt es noch keinen Beschluss, schlägt die Werkbank eine vorläufige Sperre vor: ein Soll-Wert mit Kennzeichen „vorläufig“, der sofort gilt.",
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
              ["Partner", "Firma als Vertragspartner, Rechnungssteller oder beides"],
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
            text: "Je Geschäftsjahr hat ein Posten einen Status: „offen“, „Rechnung liegt vor“ oder „abgeschlossen“. Abgeschlossen ist er, sobald eine gebuchte Rechnungsposition mit „schließt den Posten ab“ auf ihm liegt. Filter nach Suchtext, Status und Tag helfen beim Finden.",
          },
          {
            kind: "steps",
            items: [
              "Wähle „Posten hinzufügen“.",
              "Wähle das Konto, gib eine Bezeichnung und die erwarteten Kosten je Geschäftsjahr (brutto) ein.",
              "Lege die Laufzeit fest: einmalig, mehrere Jahre bis zu einem Geschäftsjahr oder bis auf Weiteres.",
              "Optional: Vertrag wählen; unter „Weitere Angaben“ Tags und Notiz.",
              "Speichere.",
            ],
          },
          {
            kind: "text",
            text: "Nicht mehr gebrauchte Posten legst du still. Löschen geht nur, solange kein Vertrag zugeordnet ist und keine Rechnungsposition auf dem Posten liegt.",
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
              "Kosten kommen nur über Rechnungen ins Budget. Die Zahlungen im Geschäftsjahr am Vertrag sind eine Information.",
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
              "Die Ansicht „Probleme“ zeigt abweichende, fehlende und fehlerhafte Einträge, „Neu seit dem letzten Lauf“ nur die, die beim letzten Lauf dazukamen, „Alle“ alles. Das Suchfeld filtert nach Name, Zone, Typ und Wert.",
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
    roles: [ADMIN, AUDITOR],
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
            text: "„Einstellungen“ unter Verwaltung verlangt eine frische Anmeldung (siehe „Anmelden und abmelden“). Unter „Allgemein“ stehen:",
          },
          {
            kind: "terms",
            items: [
              ["Branding", "Name, Farbe, Logos und Favicon der Werkbank"],
              [
                "Mailversand (SMTP)",
                "Server und Absender, mit Testmail an dich selbst; darüber gehen auch die Benachrichtigungen per Mail",
              ],
              [
                "Benachrichtigungen in Teams",
                "Adresse des Workflows aus Power Automate, ein- und ausschalten, Testnachricht an dich selbst",
              ],
              ["Audit-Log", "Aufbewahrung zwischen 30 und 3650 Tagen"],
              [
                "Zertifikate und Secrets",
                "ab wie vielen Tagen Hinweis, Warnung und dringend gelten",
              ],
              ["KI-Texte", "Anbieter, Modell und Höchstzahl je Stunde; Vorgabe: aus"],
              ["IT-Tools: Abfragen ins Internet", "erlaubt oder ausgeschaltet; Vorgabe: erlaubt"],
            ],
          },
          {
            kind: "text",
            text: "Unter „Rollen“ steht, welche Rollen es gibt und wer sie bei der letzten Anmeldung hatte. Vergeben werden Rollen in Microsoft Entra, nicht in der Werkbank.",
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
