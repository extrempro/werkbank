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
