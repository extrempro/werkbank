/**
 * Erklärungen hinter den Info-Symbolen („i“) und die Hilfe je Seite. Jede Erklärung führt zu
 * einem Thema im Handbuch und steht dort unter „Begriffe A–Z“. Bei jeder Änderung an der
 * Anwendung prüfen, ob Erklärungen dazukommen, sich ändern oder wegfallen (CLAUDE.md).
 *
 * Regeln: höchstens zwei Sätze, einfache Sprache, „du“, nur Text (kein HTML).
 */

/** Thema im Handbuch: Bereich und Thema. */
export type TopicRef = readonly [area: string, topic: string];

export interface HelpTerm {
  /** Der Begriff, wie er in der Oberfläche steht. */
  term: string;
  text: string;
  topic: TopicRef;
}

export const HELP = {
  // Microsoft 365: Konfiguration
  "m365.ueberwacht": {
    term: "Überwachte Einstellungen",
    text: "So viele Einstellungen liest die Werkbank regelmäßig aus dem Tenant und vergleicht sie mit dem letzten Stand.",
    topic: ["m365", "uebersicht"],
  },
  "m365.objekte": {
    term: "Gelesene Objekte",
    text: "Microsoft erlaubt je Monat nur eine bestimmte Zahl gelesener Objekte. Die Zahl zeigt, wie viel davon in diesem Monat schon verbraucht ist.",
    topic: ["m365", "uebersicht"],
  },
  "m365.kritikalitaet": {
    term: "Kritikalität",
    text: "Wie wichtig eine Einstellung für uns ist: niedrig, mittel oder hoch. Bei „hoch“ braucht auch die Bewertung „gewollt“ einen Kommentar.",
    topic: ["m365", "einstellungen"],
  },
  "m365.soll-wert": {
    term: "Soll-Wert",
    text: "Der Wert, den eine Einstellung bei uns haben soll. Weicht der aktuelle Wert davon ab, zeigt die Werkbank eine Abweichung.",
    topic: ["m365", "soll-werte"],
  },
  "m365.abweichung": {
    term: "Abweichung vom Soll-Wert",
    text: "Eine Einstellung, deren aktueller Wert nicht dem eingetragenen Soll-Wert entspricht.",
    topic: ["m365", "soll-werte"],
  },
  "m365.punkte": {
    term: "Punkte (Secure Score)",
    text: "Punkte, die diese Empfehlung in Microsoft Secure Score bringt: erreicht von höchstens möglich.",
    topic: ["m365", "empfehlungen"],
  },
  "m365.auswirkung": {
    term: "Auswirkung auf Nutzer",
    text: "Wie stark Mitarbeitende die Umsetzung der Empfehlung laut Microsoft bemerken.",
    topic: ["m365", "empfehlungen"],
  },
  // Microsoft 365: Tenant und Geräte
  "tenant.frei": {
    term: "Freie Lizenzen",
    text: "Gekaufte Lizenzen minus zugewiesene. Ist die Zahl negativ, sind mehr Lizenzen vergeben als gekauft.",
    topic: ["m365", "lizenzen"],
  },
  "tenant.handlungsbedarf": {
    term: "Handlungsbedarf (Zertifikate und Secrets)",
    text: "Zertifikate und Secrets, die abgelaufen sind oder innerhalb der eingestellten Fristen ablaufen.",
    topic: ["m365", "zertifikate"],
  },
  "geraete.ziel-tenant": {
    term: "Ziel-Tenant",
    text: "Der Microsoft-365-Tenant, dem das gescannte Gerät zugeordnet wird.",
    topic: ["m365", "scannen"],
  },
  "geraete.konformitaet": {
    term: "Konformität",
    text: "Ob das Gerät die Richtlinien in Intune erfüllt. Den Wert liefert Intune, sobald das Gerät registriert ist.",
    topic: ["m365", "status"],
  },
  // Evergreen
  "evergreen.info-meldungen": {
    term: "Reine Info-Meldungen",
    text: "Meldungen, die Microsoft nur zur Information schickt und die weder Nutzer noch Admins betreffen.",
    topic: ["evergreen", "liste"],
  },
  "evergreen.betroffen": {
    term: "Betroffen",
    text: "Wer die Änderung bemerkt, zum Beispiel alle Nutzer mit einer bestimmten Lizenz.",
    topic: ["evergreen", "ansicht"],
  },
  "evergreen.standard": {
    term: "Standard (Evergreen)",
    text: "Ob die Funktion nach dem Rollout eingeschaltet ist, wenn wir nichts tun. Orange heißt: Die Funktion ist dann von selbst an.",
    topic: ["evergreen", "ansicht"],
  },
  "evergreen.steuerbar": {
    term: "Steuerbar",
    text: "Ob und womit wir die Funktion abschalten oder einschränken können, zum Beispiel über eine Richtlinie.",
    topic: ["evergreen", "ansicht"],
  },
  "evergreen.handeln-bis": {
    term: "Handeln bis",
    text: "Frist, die Microsoft für eine Handlung nennt. Ohne Frist steht hier ein Strich.",
    topic: ["evergreen", "ansicht"],
  },
  "evergreen.rollout": {
    term: "Rollout",
    text: "Zeitplan von Microsoft je Phase. Abgeschlossene Phasen sind gefüllt, kommende umrandet, ein früherer Plan ist schraffiert.",
    topic: ["evergreen", "ansicht"],
  },
  "evergreen.vorschlag": {
    term: "Vorschlag, ungeprüft",
    text: "Diesen Wert hat die Werkbank aus der Meldung gelesen. Mit dem Speichern der Bewertung gilt er als geprüft.",
    topic: ["evergreen", "bewerten"],
  },
  "evergreen.ki-vorschlag": {
    term: "KI-Vorschlag, ungeprüft",
    text: "Diesen Wert hat die KI aus dem Text von Microsoft gelesen. Prüf ihn; mit dem Speichern der Bewertung gilt er als geprüft.",
    topic: ["evergreen", "bewerten"],
  },
  "evergreen.mitbestimmung": {
    term: "Mitbestimmungsrelevant",
    text: "Eine Funktion ist mitbestimmungsrelevant, wenn sie sich zur Leistungs- oder Verhaltenskontrolle eignet oder neue personenbezogene Daten verarbeitet. Dann ist der Betriebsrat zu beteiligen.",
    topic: ["evergreen", "bewerten"],
  },
  // IT-Budget
  "budget.geplant": {
    term: "Geplant",
    text: "Was für die Spielzeit vorgesehen ist, als Bruttobetrag.",
    topic: ["it-budget", "begriffe"],
  },
  "budget.ist": {
    term: "Ist",
    text: "Summe der gebuchten Rechnungen.",
    topic: ["it-budget", "begriffe"],
  },
  "budget.verfuegbar": {
    term: "Verfügbar",
    text: "Geplant minus Ist. Ein negativer Betrag heißt: mehr ausgegeben als geplant.",
    topic: ["it-budget", "begriffe"],
  },
  "budget.avv": {
    term: "AVV (Auftragsverarbeitungsvertrag)",
    text: "Vertrag, den wir brauchen, wenn ein Partner für uns personenbezogene Daten verarbeitet. „AVV fehlt“ zählt laufende Verträge, bei denen er noch nicht vorliegt.",
    topic: ["it-budget", "vertraege"],
  },
  "budget.kuendigungstermin": {
    term: "Kündigungstermin",
    text: "Spätester Tag zum Kündigen: Laufzeitende minus Kündigungsfrist. Ist er vorbei, gilt der Termin der nächsten Laufzeit.",
    topic: ["it-budget", "vertraege"],
  },
  "budget.verlaengerung": {
    term: "Wenn nicht gekündigt",
    text: "Was passiert, wenn niemand rechtzeitig kündigt: Der Vertrag verlängert sich um die eingetragene Verlängerung.",
    topic: ["it-budget", "vertraege"],
  },
  // IT-Projekte
  "projekte.veranschlagt": {
    term: "Veranschlagt",
    text: "Das Budget, das für das Projekt freigegeben ist, als Bruttobetrag.",
    topic: ["it-projekte", "budget"],
  },
  "projekte.ist": {
    term: "Ist (Projekt)",
    text: "Summe der gebuchten Rechnungen auf den Budgetposten des Projekts.",
    topic: ["it-projekte", "budget"],
  },
  // IT-Bestand
  "bestand.inventurnummer": {
    term: "Inventurnummer",
    text: "Die Nummer des Geräts aus der Inventur. Setzen, ändern und entfernen geht nur mit Rückfrage.",
    topic: ["it-bestand", "hardware"],
  },
  "bestand.herkunft": {
    term: "Herkunft",
    text: "Woher das Gerät in der Werkbank kommt: von Hand erfasst oder aus NinjaOne übernommen.",
    topic: ["it-bestand", "hardware"],
  },
  "bestand.datentraeger": {
    term: "Datenträger",
    text: "Ob das Gerät einen Datenträger hat; das legt die Art in den Stammdaten fest. Beim Ausmustern bestätigst du dann, dass er gelöscht oder vernichtet ist.",
    topic: ["it-bestand", "ausmustern"],
  },
  "bestand.ueberfaellig": {
    term: "Überfälliger Verleih",
    text: "Ein Verleih, dessen Rückgabedatum vorbei ist, obwohl noch nicht alles zurück ist.",
    topic: ["it-bestand", "verleih"],
  },
} as const satisfies Record<string, HelpTerm>;

export type HelpKey = keyof typeof HELP;

/**
 * Hilfe je Seite: Pfad (oder Anfang eines Pfads) → Themen in absteigender Wahl. Gezeigt wird
 * das erste Thema, das die Person sehen darf.
 */
export const PAGE_HELP: Readonly<Record<string, readonly TopicRef[]>> = {
  "/": [["grundlagen", "aufgaben"]],
  "/suche": [["grundlagen", "suche"]],
  "/konto": [["grundlagen", "konto"]],
  "/neuigkeiten": [["grundlagen", "konto"]],
  "/benachrichtigungen": [["grundlagen", "benachrichtigungen"]],
  "/m365": [["m365", "uebersicht"]],
  "/m365/aenderungen": [
    ["m365", "aenderungen"],
    ["m365", "aenderungen-lesen"],
  ],
  "/m365/einstellungen": [["m365", "einstellungen"]],
  "/m365/empfehlungen": [["m365", "empfehlungen"]],
  "/m365/snapshots": [["m365", "snapshots"]],
  "/m365/lizenzen": [["m365", "lizenzen"]],
  "/m365/benutzer": [["m365", "benutzer"]],
  "/m365/zugangsdaten": [["m365", "zertifikate"]],
  "/m365/dienststatus": [["m365", "dienststatus"]],
  "/m365/nutzung": [["m365", "nutzung"]],
  "/m365/geraete/zuordnung": [["m365", "worum-es-geht"]],
  "/evergreen": [["evergreen", "liste"]],
  "/monitoring/dns": [["it-monitoring", "dns-abgleich"]],
  "/bestand/vorgaenge": [["it-bestand", "vorgaenge"]],
  "/bestand/statistik": [["it-bestand", "statistik"]],
  "/bestand/hardware": [["it-bestand", "hardware"]],
  "/bestand/stellen": [["it-bestand", "stellen"]],
  "/bestand/arbeitsplaetze": [["it-bestand", "arbeitsplaetze"]],
  "/bestand/standorte": [["it-bestand", "standorte"]],
  "/bestand/verleih": [["it-bestand", "verleih"]],
  "/bestand/stammdaten": [["it-bestand", "stammdaten"]],
  "/budget": [["it-budget", "uebersicht"]],
  "/budget/planung": [["it-budget", "auswertung"]],
  "/budget/statistik": [["it-budget", "auswertung"]],
  "/budget/posten": [["it-budget", "posten"]],
  "/budget/rechnungen": [
    ["it-budget", "buchen"],
    ["it-budget", "rechnungen"],
    ["it-budget", "begriffe"],
  ],
  "/budget/vertraege": [["it-budget", "vertraege"]],
  "/budget/partner": [["it-budget", "partner"]],
  "/budget/konten": [["it-budget", "konten"]],
  "/budget/import": [["it-budget", "import"]],
  "/budget/einstellungen": [["it-budget", "einstellungen"]],
  "/projekte": [["it-projekte", "ueberblick"]],
  "/it-tools/verlauf": [["it-tools", "verlauf"]],
  "/it-tools": [["it-tools", "ueberblick"]],
  "/verwaltung": [["verwaltung", "einstellungen"]],
  "/audit": [["verwaltung", "audit"]],
};

/** Themen zur Seite: der längste passende Eintrag (genau oder als Anfang mit „/“). */
export function pageTopics(path: string): readonly TopicRef[] {
  let best: string | null = null;
  for (const key of Object.keys(PAGE_HELP)) {
    const matches = key === path || (key !== "/" && path.startsWith(`${key}/`));
    if (matches && (best === null || key.length > best.length)) {
      best = key;
    }
  }
  return best === null ? [] : (PAGE_HELP[best] ?? []);
}
