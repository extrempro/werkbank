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
  "m365.abruf-ergebnis": {
    term: "Ergebnis eines Abrufs",
    text: "„Teilweise“ heißt: Ein Teil der Typen konnte nicht gelesen werden. Deren Einstellungen bleiben unverändert stehen und gelten nicht als entfernt.",
    topic: ["m365", "snapshots"],
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
  "evergreen.kategorie": {
    term: "Kategorie (Neuerungen)",
    text: "Ordnet die Meldung einem Thema wie „Teams“ zu, automatisch aus dem Dienst. Passt sie nicht, wählst du eine andere; deine Wahl bleibt auch bei neuen Texten von Microsoft.",
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
  // IT-Monitoring
  "zabbix.nicht-erreichbar": {
    term: "Nicht erreichbar",
    text: "Keine Schnittstelle des Hosts antwortet Zabbix. Hosts in Wartung zählen hier nicht mit.",
    topic: ["it-monitoring", "zabbix-uebersicht"],
  },
  "zabbix.gesamtstand": {
    term: "Gesamtstand",
    text: "Rot, sobald ein Problem mit Hoch oder Katastrophe offen ist, gelb bei anderen Problemen oder nicht erreichbaren Hosts, sonst grün. Unterdrückte Probleme zählen nicht mit.",
    topic: ["it-monitoring", "zabbix-uebersicht"],
  },
  "zabbix.verlauf": {
    term: "Letzte 24 Stunden",
    text: "Wie viele Probleme je Stunde offen waren, gemessen beim letzten Abruf der Stunde. Die Werkbank sammelt das selbst, erst ab dem Update.",
    topic: ["it-monitoring", "zabbix-uebersicht"],
  },
  "zabbix.lange-offen": {
    term: "Lange offen",
    text: "Probleme, die seit mehr als 7 Tagen offen sind. Hier hilft meist eine Entscheidung mehr als Warten.",
    topic: ["it-monitoring", "zabbix-uebersicht"],
  },
  "zabbix.nicht-ueberwacht": {
    term: "Nicht überwacht",
    text: "Aktive Geräte der festgelegten Hardware-Arten aus dem IT-Bestand, zu deren Seriennummer es in Zabbix keinen Host gibt. Geräte, die bewusst nicht überwacht werden, zählen nicht mit.",
    topic: ["it-monitoring", "zabbix-bestand"],
  },
  "zabbix.ohne-bestand": {
    term: "Ohne Bestandseintrag",
    text: "Hosts in Zabbix mit Seriennummer, zu der es im IT-Bestand kein aktives Gerät gibt.",
    topic: ["it-monitoring", "zabbix-bestand"],
  },
  "zabbix.seriennummer-fehlt": {
    term: "Seriennummer fehlt",
    text: "Hosts, in deren Zabbix-Inventar keine Seriennummer steht. In der Host-Ansicht lässt sich so ein Host von Hand einem Gerät zuordnen.",
    topic: ["it-monitoring", "zabbix-bestand"],
  },
  "zabbix.verfuegbarkeit": {
    term: "Verfügbarkeit",
    text: "Anteil der überwachten Zeit, in der kein Ausfall offen war. Geplante Wartungen zählen nicht mit.",
    topic: ["it-monitoring", "zabbix-berichte"],
  },
  "zabbix.zielwert": {
    term: "Zielwert",
    text: "So hoch soll die Verfügbarkeit mindestens sein. Ein Admin legt ihn auf der Seite Verbindung fest.",
    topic: ["it-monitoring", "zabbix-berichte"],
  },
  "zabbix.ausfall": {
    term: "Ausfall",
    text: "Zeit, in der ein Problem mit dem Tag scope: availability ab Schweregrad Hoch offen war, zum Beispiel „nicht erreichbar“. Überlappende Probleme zählen einmal.",
    topic: ["it-monitoring", "zabbix-berichte"],
  },
  "zabbix.wartung": {
    term: "In Wartung",
    text: "Der Host steckt gerade in einer Wartung aus Zabbix. Seine Probleme blendet Zabbix dann meist aus.",
    topic: ["it-monitoring", "zabbix-uebersicht"],
  },
  // IT-Monitoring: FortiGate
  "fortigate.aenderungen": {
    term: "Änderungen",
    text: "So viele neue Konfigurationsstände gab es in den letzten 24 Stunden über alle Geräte. Ein Stand entsteht nur, wenn sich an einem Gerät etwas geändert hat.",
    topic: ["it-monitoring", "fortigate-uebersicht"],
  },
  "fortigate.position": {
    term: "Position",
    text: "Platz der Policy in der Reihenfolge des Geräts. Die FortiGate prüft von oben nach unten, die erste passende Policy greift.",
    topic: ["it-monitoring", "fortigate-policies"],
  },
  "fortigate.treffer": {
    term: "Treffer",
    text: "So oft hat die Policy gegriffen, seit der Zähler zuletzt zurückgesetzt wurde. Nach einem Neustart des Geräts beginnt er neu.",
    topic: ["it-monitoring", "fortigate-policies"],
  },
  "fortigate.fabric-objekt": {
    term: "Fabric-Objekt",
    text: "Ein Objekt, das die Security Fabric vom Root an die anderen Geräte verteilt. „ja (2/3)“ heißt: auf zwei von drei Geräten als Fabric-Objekt vorhanden.",
    topic: ["it-monitoring", "fortigate-objekte"],
  },
  "fortigate.fabric-sync": {
    term: "Fabric-Sync",
    text: "Ob die Security Fabric ein Objekt an alle Geräte verteilt (synchronisiert) oder ob es nur auf einem Gerät angelegt ist (lokal). „Sync abweichend“ heißt: Inhalt oder Vorhandensein passt nicht über alle Geräte.",
    topic: ["it-monitoring", "fortigate-objekte"],
  },
  "fortigate.unbenutzt-seit": {
    term: "Unbenutzt seit",
    text: "Seit wann die Werkbank das Objekt als unbenutzt sieht. Gezählt wird erst ab dem Einbau dieser Funktion, nicht rückwirkend.",
    topic: ["it-monitoring", "fortigate-unbenutzt"],
  },
  "fortigate.befund-stufe": {
    term: "Stufe eines Befunds",
    text: "Hoch heißt: Die Policy öffnet viel mehr als nötig. Mittel und Hinweis zeigen Dinge, die du prüfen und aufräumen solltest.",
    topic: ["it-monitoring", "fortigate-befunde"],
  },
  "fortigate.ausnahme": {
    term: "Ausnahme",
    text: "Ein Befund, den du bewusst hinnimmst, mit Begründung und Frist. Ändert sich die Policy oder das Objekt, gilt die Ausnahme nicht mehr.",
    topic: ["it-monitoring", "fortigate-befunde"],
  },
  "fortigate.schuetzenswert": {
    term: "Schützenswerte Zone",
    text: "Interfaces oder Zonen, in denen jede erlaubte Verbindung protokolliert werden soll. Fehlt das Protokoll, gibt es einen Befund der Stufe hoch.",
    topic: ["it-monitoring", "fortigate-einrichten"],
  },
  "fortigate.policy-lookup": {
    term: "Policy-Lookup",
    text: "Fragt jedes Gerät auf dem Weg live, welche Policy es für diese Verbindung wählen würde. Nur lesend; weicht das Ergebnis ab, steht es am Gerät.",
    topic: ["it-monitoring", "fortigate-pfad"],
  },
  "fortigate.internet-ausgang": {
    term: "Internet-Ausgang",
    text: "Über welche Firewall, welche Policies und mit welchem NAT ein internes Netz ins Internet kommt. Berechnet wie die Pfad-Analyse.",
    topic: ["it-monitoring", "fortigate-pfad"],
  },
  "fortigate.abruf-vergleich": {
    term: "Abrufe vergleichen",
    text: "Zeigt alle Unterschiede zwischen zwei gespeicherten Konfigurationsständen eines Geräts. Ältere Stände fallen nach der Aufbewahrung weg.",
    topic: ["it-monitoring", "fortigate-aenderungen"],
  },
  "netbird.verbunden": {
    term: "Peers verbunden",
    text: "So viele Geräte sind gerade mit dem NetBird-Management verbunden. Routing-Peers verbinden ganze Netze; ist einer offline, fehlt womöglich der Weg in ein Netz.",
    topic: ["it-monitoring", "netbird-uebersicht"],
  },
  "netbird.hinweis": {
    term: "Hinweise",
    text: "Kritisch heißt: Etwas funktioniert nicht oder ist gefährlich offen. Warnungen und Infos zeigen, was du bald prüfen solltest; erledigte Hinweise verschwinden von selbst.",
    topic: ["it-monitoring", "netbird-uebersicht"],
  },
  "netbird.version": {
    term: "Client-Versionen",
    text: "Vergleich mit dem neuesten Release, das der NetBird-Server meldet. Ab zwei Releases Rückstand gibt es eine Warnung.",
    topic: ["it-monitoring", "netbird-uebersicht"],
  },
  "netbird.verlauf": {
    term: "Verbundene Peers",
    text: "Höchstzahl gleichzeitig verbundener Geräte je Tag, aus den Abrufen alle fünf Minuten. Die Werkbank hebt die Werte 90 Tage auf.",
    topic: ["it-monitoring", "netbird-uebersicht"],
  },
  "netbird.komponenten": {
    term: "Server-Komponenten",
    text: "Management prüft die Werkbank über die API, Signal und Relay per TCP-Verbindung zu den Adressen aus der Verwaltung. Der Reverse Proxy zeigt die Zahl der Dienste.",
    topic: ["it-monitoring", "netbird-netze"],
  },
  "netbird.erreichbar": {
    term: "Erreichbar",
    text: "Ohne Ping heißt erreichbar: Mindestens ein Routing-Peer des Netzes ist verbunden. Mit Ping muss zusätzlich das Testziel im Netz antworten.",
    topic: ["it-monitoring", "netbird-netze"],
  },
  "netbird.pruefung": {
    term: "Prüfung der Richtlinien",
    text: "Die Werkbank sucht in den Richtlinien nach zu weiten Freigaben, leeren Gruppen und lange ausgeschalteten Regeln. Kritisch ist „All“ zu „All“ auf allen Ports.",
    topic: ["it-monitoring", "netbird-richtlinien"],
  },
  "netbird.setupkey": {
    term: "Setup-Key",
    text: "Schlüssel, mit dem sich ein Gerät ohne Benutzer bei NetBird anmeldet. Läuft er ab, lassen sich damit keine neuen Geräte mehr anmelden.",
    topic: ["it-monitoring", "netbird-richtlinien"],
  },
  "netbird.posture": {
    term: "Posture Check",
    text: "Bedingung, die ein Gerät erfüllen muss, bevor eine Richtlinie greift. Beispiel: eine Mindestversion des Clients.",
    topic: ["it-monitoring", "netbird-richtlinien"],
  },
  "netbird.geaendert": {
    term: "Geändert",
    text: "Letzte Änderung laut Ereignisprotokoll oder, falls dort nichts steht, laut Abgleich der Werkbank. Ältere Änderungen kennt die Werkbank nicht.",
    topic: ["it-monitoring", "netbird-richtlinien"],
  },
  "netbird.ereignisse": {
    term: "Ereignisprotokoll",
    text: "Was in NetBird geändert wurde, wann und von wem. Die Werkbank behält die Einträge 90 Tage; „System“ heißt, NetBird nennt keine Person.",
    topic: ["it-monitoring", "netbird-richtlinien"],
  },
  "netbird.ziele": {
    term: "Erreichbare Ziele",
    text: "Gruppen, Netze und Peers, die dieses Gerät laut den eingeschalteten Richtlinien erreichen darf, mit Protokoll und Ports.",
    topic: ["it-monitoring", "netbird-peers"],
  },
  "netbird.servergruppen": {
    term: "Server-Gruppen",
    text: "Gruppen in NetBird, in denen Server stehen. Greift eine Richtlinie ohne Posture Check auf sie zu, zeigt die Prüfung eine Warnung.",
    topic: ["it-monitoring", "netbird-einrichten"],
  },
  "netbird.crowdsec": {
    term: "CrowdSec",
    text: "Weist Anfragen von bekannten Angreifern am Reverse Proxy ab. „Beobachten“ lässt sie durch und vermerkt nur, dass sie abgewiesen worden wären.",
    topic: ["it-monitoring", "netbird-netze"],
  },
  "netbird.abgewiesen": {
    term: "Abgewiesen 24 h",
    text: "Anfragen der letzten 24 Stunden, die CrowdSec bei diesem Dienst abgewiesen hat, laut Zugriffsprotokoll von NetBird. „wären“ zählt die im Modus „beobachten“.",
    topic: ["it-monitoring", "netbird-netze"],
  },
  "netbird.ohne_crowdsec": {
    term: "Bewusst ohne CrowdSec",
    text: "Öffentliche Dienste ohne CrowdSec bekommen eine Warnung. Trag hier die ein, bei denen das gewollt ist, etwa die Anmeldeseite.",
    topic: ["it-monitoring", "netbird-einrichten"],
  },
  "netbird.ueberwacht": {
    term: "Überwacht",
    text: "Gruppen und Policies, deren Name mit einem eingetragenen Präfix beginnt. Nur ihre Änderungen erkennt, meldet und protokolliert die Werkbank.",
    topic: ["it-monitoring", "netbird-gruppen"],
  },
  "netbird.fremde_gruppe": {
    term: "Fremde Gruppe",
    text: "Eine überwachte Policy nutzt eine Gruppe ohne Präfix oder „All“. Das kann Zugriff für Geräte öffnen, die nicht dazugehören.",
    topic: ["it-monitoring", "netbird-gruppen"],
  },
  "netbird.von_hand": {
    term: "Von Hand",
    text: "Die Gruppe hat das Präfix, kommt aber nicht über SCIM aus Entra. Mitglieder pflegt hier jemand direkt in NetBird.",
    topic: ["it-monitoring", "netbird-gruppen"],
  },
  "netbird.ausfallweg": {
    term: "Ausfallweg",
    text: "Wie viele Routing-Peers des Netzes verbunden sind. Ist es nur einer, fehlt der Ausfallweg.",
    topic: ["it-monitoring", "netbird-netze"],
  },
  "netbird.http": {
    term: "HTTP-Antwort",
    text: "Antwort auf den HTTPS-Abruf der Werkbank. Weiterleitungen zur Anmeldung zählen als Antwort, Fehler ab 500 oder keine Antwort nicht.",
    topic: ["it-monitoring", "netbird-netze"],
  },
  "netbird.verfuegbarkeit": {
    term: "Verfügbarkeit der Dienste",
    text: "Anteil der HTTPS-Abrufe der letzten 30 Tage mit Antwort. Gezählt wird erst ab Einrichtung der Prüfung.",
    topic: ["it-monitoring", "netbird-netze"],
  },
  "netbird.anmeldung": {
    term: "Anmeldung bis",
    text: "Geräte mit Benutzerkonto müssen sich nach der eingestellten Zeit neu anmelden. Sieben Tage vorher gibt es eine Warnung.",
    topic: ["it-monitoring", "netbird-peers"],
  },
  "netbird.bestand": {
    term: "IT-Bestand",
    text: "Gerät im IT-Bestand mit gleichem Hostnamen. Das ist nur ein Hinweis, keine feste Zuordnung.",
    topic: ["it-monitoring", "netbird-peers"],
  },
  "netbird.token": {
    term: "API-Token",
    text: "Token eines Dienstkontos in NetBird mit Leserecht. Die Werkbank speichert es verschlüsselt und zeigt es nie wieder an.",
    topic: ["it-monitoring", "netbird-einrichten"],
  },
  "netbird.ping": {
    term: "Ping in die Netze",
    text: "Prüft echte Erreichbarkeit der Netze über ein Testziel. Dafür braucht der Server der Werkbank selbst einen NetBird-Peer.",
    topic: ["it-monitoring", "netbird-einrichten"],
  },
  "fortigate.verwendet": {
    term: "Verwendet",
    text: "So oft steht das Objekt direkt in Policies und Gruppen, über alle Geräte. Policies, die es über eine Gruppe nutzen, stehen in der Detailansicht.",
    topic: ["it-monitoring", "fortigate-objekte"],
  },
  "fortigate.aufbewahrung": {
    term: "Aufbewahrung der FortiGate-Daten",
    text: "So lange bleiben Abrufe und Konfigurationsstände gespeichert, danach löscht die Werkbank sie. Der jüngste Stand je Gerät bleibt immer.",
    topic: ["it-monitoring", "fortigate-einrichten"],
  },
  // IT-Budget
  "budget.geplant": {
    term: "Geplant",
    text: "Was für das gewählte Jahr vorgesehen ist, als Bruttobetrag.",
    topic: ["it-budget", "begriffe"],
  },
  "bestand.grundriss_ausrichtung": {
    term: "Ausrichtung des Grundrisses",
    text: "Dreht den Grundriss beim Anzeigen in Vierteldrehungen, etwa wenn er hochkant eingescannt ist. Räume und Plätze drehen mit, das Bild bleibt unverändert.",
    topic: ["it-bestand", "standorte"],
  },
  "bestand.pool": {
    term: "Pool-Arbeitsplatz",
    text: "Ein Arbeitsplatz, der absichtlich keiner Stelle gehört, etwa beim Desk-Sharing oder für Gäste. Er hat einen Zweck aus den Stammdaten und zählt nicht als frei.",
    topic: ["it-bestand", "arbeitsplaetze"],
  },
  "budget.betrag": {
    term: "Netto oder Brutto",
    text: "Trag den Betrag so ein, wie er dir vorliegt; den anderen Wert rechnet die Werkbank aus dem Steuersatz. Fürs Budget zählt immer das Brutto.",
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
  "budget.ausschoepfung": {
    term: "Ausschöpfung",
    text: "Wie viel vom Geplanten schon ausgegeben ist: Ist geteilt durch Geplant. Vergleich sie mit den vergangenen Monaten des Jahres.",
    topic: ["it-budget", "auswertung"],
  },
  "budget.vergleich": {
    term: "Vergleich mit einem früheren Jahr",
    text: "Ist dieses Jahres gegen das Ist des Vergleichsjahres im selben Zeitraum, also bis zum selben Tag. So zählen nur gleich lange Abschnitte.",
    topic: ["it-budget", "auswertung"],
  },
  "budget.jahresvergleich": {
    term: "Jahresvergleich",
    text: "Je Konto oder Art ein Wert pro gewähltem Jahr. Vergangene Jahre zeigen das Ist, laufende und künftige die erwarteten Kosten, außer du wählst „Bis heute“.",
    topic: ["it-budget", "auswertung"],
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
  "bestand.hardware-direkt": {
    term: "Direkt an der Stelle",
    text: "Geräte, die beim Gerät unter „Zugeordnet zu“ genau dieser Stelle zugeordnet sind, zum Beispiel ein Notebook.",
    topic: ["it-bestand", "stellen"],
  },
  "bestand.hardware-arbeitsplatz": {
    term: "Über Arbeitsplätze",
    text: "Geräte, die an einem Arbeitsplatz der Stelle hängen, zum Beispiel Monitor oder Dockingstation. Bei einem geteilten Arbeitsplatz nutzen auch andere Stellen diese Geräte.",
    topic: ["it-bestand", "stellen"],
  },
  "bestand.verleih-start": {
    term: "Ab (Startdatum)",
    text: "Liegt das Datum in der Zukunft, ist der Verleih vorab geplant: Die Geräte sind ab sofort reserviert, die Nachricht an die Person geht am Startdatum raus.",
    topic: ["it-bestand", "verleih"],
  },
  // Verwaltung
  "verwaltung.rechtepruefung": {
    term: "Berechtigungen für den Abruf",
    text: "Vergleicht die vergebenen Rechte mit dem, was die eingetragenen Typen laut Microsoft brauchen. So siehst du vor dem nächsten Abruf, was fehlt.",
    topic: ["verwaltung", "einstellungen"],
  },
  "verwaltung.sicherung": {
    term: "Datensicherung",
    text: "Die Werkbank sichert Datenbank und Dateien verschlüsselt in einen Ordner auf dem Server. Ohne den Schlüssel „backup_key“ lässt sich keine Sicherung öffnen, bewahre ihn getrennt davon auf.",
    topic: ["verwaltung", "datensicherung"],
  },
  "verwaltung.sicherung_aufbewahren": {
    term: "Aufbewahren",
    text: "So viele Sicherungen bleiben liegen, die ältesten löscht die Werkbank nach jeder neuen Sicherung. Bei täglicher Sicherung heißt 14: zwei Wochen zurück.",
    topic: ["verwaltung", "datensicherung"],
  },
  "verwaltung.berechtigungen": {
    term: "Berechtigungen",
    text: "Je Bereich legst du eine Stufe fest, etwa Lesen oder Bearbeiten. Anmelden darf sich nur, wer in der Zugangs-Gruppe ist; in die Verwaltung kommt nur die Admin-Gruppe.",
    topic: ["verwaltung", "berechtigungen"],
  },
  // Dokumentation
  "doku.eigene-rechte": {
    term: "Eigene Rechte",
    text: "Gelten für diese Seite und ihre Unterseiten statt der Rechte des Arbeitsbereichs. Im Seitenbaum steht dann ein Schloss.",
    topic: ["doku", "rechte"],
  },
  "doku.sperren": {
    term: "Gesperrte Seite",
    text: "Niemand kann den Inhalt ändern, bis jemand mit Bearbeiten die Seite entsperrt.",
    topic: ["doku", "rechte"],
  },
  "doku.version": {
    term: "Version",
    text: "Ein gespeicherter Stand der Seite. Er entsteht nach einer Weile Bearbeitung von selbst oder wenn du ihn benennst.",
    topic: ["doku", "versionen"],
  },
  "doku.live": {
    term: "Live-Bearbeitung",
    text: "Alle, die die Seite offen haben, sehen Änderungen sofort und können gleichzeitig schreiben. Gespeichert wird automatisch.",
    topic: ["doku", "seiten"],
  },
  "doku.kommentare": {
    term: "Kommentare",
    text: "Markiere Text und kommentiere ihn; mit @ erwähnst du jemanden, der die Seite lesen darf. Kommentieren darf jede Person, die die Seite lesen darf.",
    topic: ["doku", "kommentare"],
  },
  "doku.verweise": {
    term: "Verweise und Live-Bausteine",
    text: "Verweise und Live-Bausteine zeigen Tickets, Geräte, Projekte oder Verträge mit ihrem aktuellen Stand. Jede Person sieht nur, was sie im jeweiligen Bereich sehen darf.",
    topic: ["doku", "verweise"],
  },
  "doku.arbeitsbereich": {
    term: "Arbeitsbereich",
    text: "Sammlung von Seiten, etwa für eine Abteilung. Wer darin Mitglied ist, bekommt Lesen, Bearbeiten oder Verwalten.",
    topic: ["doku", "rechte"],
  },
  // Tickets
  "tickets.bereich": {
    term: "Bereich",
    text: "Eine Abteilung mit eigenem Postfach, zum Beispiel die IT. Du siehst nur Tickets der Bereiche, in denen du Mitglied bist.",
    topic: ["tickets", "uebersicht"],
  },
  "tickets.bereichsfarbe": {
    term: "Farbe des Bereichs",
    text: "Markiert die Tickets eines Bereichs in der Liste mit einem Punkt und einem Streifen. Der Name des Bereichs steht immer daneben.",
    topic: ["tickets", "einstellungen"],
  },
  "tickets.erfolge": {
    term: "Erfolge",
    text: "Freiwillige Abzeichen für sorgfältige Ticketarbeit, zum Beispiel beschriebene Lösungen oder Übergaben mit Notiz. Gezählt wird erst ab dem Einschalten; es gibt keine Rangliste und keine Zeitmessung.",
    topic: ["tickets", "erfolge"],
  },
  "tickets.erfolge-sichtbar": {
    term: "Sichtbarkeit der Erfolge",
    text: "Mit „Mitglieder meiner Bereiche“ sehen Personen aus deinen Ticket-Bereichen deine Gesamtstufe und deine Vitrine, aber keine Zahlen. Mit „Nur ich“ sieht sie niemand sonst.",
    topic: ["tickets", "erfolge"],
  },
  "tickets.meisterkranz": {
    term: "Meisterkranz",
    text: "Je Rang ein Abzeichen. Es wird frei, sobald alle sechs Kategorien diesen Rang erreicht haben.",
    topic: ["tickets", "erfolge"],
  },
  "tickets.leiste": {
    term: "Favoriten und Geöffnet",
    text: "Unter „Neues Ticket“ stehen deine Favoriten und die zuletzt geöffneten Tickets. Hier stellst du ein, wie viele es höchstens sind und wie sie aussehen.",
    topic: ["tickets", "leiste"],
  },
  "tickets.notiz": {
    term: "Interne Notiz",
    text: "Nur für Mitglieder des Bereichs. Der Melder sieht sie nicht und bekommt keine Mail.",
    topic: ["tickets", "ticket"],
  },
  "tickets.beteiligte": {
    term: "Beteiligte",
    text: "Personen, die Antworten an den Melder in Kopie bekommen.",
    topic: ["tickets", "ticket"],
  },
  "tickets.zuweisung": {
    term: "Zuweisung neuer Tickets",
    text: "„Wer zuerst übernimmt“ lässt neue Tickets frei. „Reihum“ gibt sie der Person mit „Bearbeiten“, die die wenigsten offenen Tickets hat.",
    topic: ["tickets", "einstellungen"],
  },
  "tickets.extern": {
    term: "Externe Absender",
    text: "Absender, deren Maildomäne nicht zu den eigenen gehört. „Unbekannt“ heißt: In diesem Bereich gibt es noch kein Ticket von ihnen.",
    topic: ["tickets", "email"],
  },
  "tickets.automails": {
    term: "Automatische Mails",
    text: "Der Melder bekommt eine kurze Mail, wenn ein Ticket diesen Status bekommt. Antwortest du selbst mit „Status danach“, geht keine zusätzliche Mail raus.",
    topic: ["tickets", "email"],
  },
  "tickets.rollen": {
    term: "Rollen im Bereich",
    text: "„Bearbeiten“ legt Tickets an, antwortet und ändert Status und Zuständigkeit. Die Bereichsverwaltung darf jedes Ticket zuweisen und den Bereich einstellen.",
    topic: ["tickets", "einstellungen"],
  },
  "tickets.kategorie": {
    term: "Kategorie",
    text: "Ordnet das Ticket ein, zum Beispiel Drucker oder Zugang. Eine Kategorie kann eine Priorität vorschlagen; du kannst sie danach ändern.",
    topic: ["tickets", "arbeitshilfen"],
  },
  "tickets.loesung": {
    term: "Lösung",
    text: "Beim Wechsel auf „Gelöst“ kannst du eine Lösungsart wählen und kurz beschreiben, was gemacht wurde. Ist es freigegeben, steht beides in der Mail an den Melder, sonst nur intern.",
    topic: ["tickets", "arbeitshilfen"],
  },
  "tickets.frist": {
    term: "Frist",
    text: "Bis wann das Ticket gelöst sein soll, gezählt in Arbeitszeit des Bereichs. Solange das Ticket auf eine Rückmeldung wartet, ruht die Frist.",
    topic: ["tickets", "arbeitshilfen"],
  },
  "tickets.erinnerung": {
    term: "Erinnerung",
    text: "Das Ticket ruht bis zum gewählten Zeitpunkt. Dann wird es wieder „In Arbeit“ und die zuständige Person bekommt eine Benachrichtigung.",
    topic: ["tickets", "arbeitshilfen"],
  },
  "tickets.zusammenfuehren": {
    term: "Zusammenführen",
    text: "Verschiebt den Verlauf in ein anderes Ticket und schließt dieses; spätere Mails landen im Ziel. Das lässt sich nicht rückgängig machen.",
    topic: ["tickets", "arbeitshilfen"],
  },
  "tickets.textbausteine": {
    term: "Textbausteine",
    text: "Vorgefertigte Antworten und Notizen, die du im Antwortfeld mit Schrägstrich und Kürzel einfügst, zum Beispiel /drucker. Platzhalter wie {Vorname} werden ersetzt.",
    topic: ["tickets", "arbeitshilfen"],
  },
  "tickets.aufbewahrung": {
    term: "Aufbewahrung",
    text: "Wie lange geschlossene Tickets bleiben, bevor ein täglicher Lauf sie anonymisiert oder löscht. Ausgeschaltet bleibt alles erhalten.",
    topic: ["tickets", "betrieb"],
  },
  "tickets.melder-bestand": {
    term: "Melder im IT-Bestand",
    text: "Stellen, Arbeitsplätze, Geräte und offene Verleihe der Person, gefunden über ihre Mailadresse. Das siehst du nur mit Rechten im IT-Bestand.",
    topic: ["tickets", "arbeitshilfen"],
  },
  "tickets.export": {
    term: "Export",
    text: "Lädt die gefilterte Liste als Excel-Datei herunter, ohne Nachrichten. Exportieren darf nur die Bereichsverwaltung, und jeder Export steht im Protokoll.",
    topic: ["tickets", "betrieb"],
  },
  "tickets.protokoll": {
    term: "Protokoll",
    text: "Wer wann was an Einstellungen, Rollen, Zuständigkeit oder Status geändert hat, ohne Texte. Einträge bleiben drei Jahre.",
    topic: ["tickets", "betrieb"],
  },
  "bestand.erneuerung": {
    term: "Erneuerung fällig",
    text: "Geräte, die älter sind als die Nutzungsdauer ihrer Art. Die Nutzungsdauer legst du in den Stammdaten bei den Hardware-Arten fest.",
    topic: ["it-bestand", "statistik"],
  },
  "bestand.nutzungsdauer": {
    term: "Nutzungsdauer",
    text: "Nach so vielen Jahren gilt ein Gerät dieser Art in der Statistik als „Erneuerung fällig“. Leer lassen, wenn es für die Art keine gibt.",
    topic: ["it-bestand", "statistik"],
  },
  "bestand.ueberfaellig": {
    term: "Überfälliger Verleih",
    text: "Ein Verleih, dessen Rückgabedatum vorbei ist, obwohl noch nicht alles zurück ist.",
    topic: ["it-bestand", "verleih"],
  },
  "bestand.ausgabe-vorbereitung": {
    term: "Vorbereitung",
    text: "Die Punkte, die vor der Übergabe erledigt sein müssen. Erst wenn alles abgehakt ist, bekommt die Person die Nachricht, dass ihre Geräte bereit sind.",
    topic: ["it-bestand", "ausgabe"],
  },
  "bestand.nutzungsregeln": {
    term: "Nutzungsregeln",
    text: "Der Text aus den Stammdaten, den die Person mit der Übernahme bestätigt. Er steht danach im Übergabeprotokoll.",
    topic: ["it-bestand", "ausgabe"],
  },
  "bestand.rueckgabe-daten": {
    term: "Daten gelöscht",
    text: "Hake das an, wenn das Gerät zurückgesetzt ist, zum Beispiel über Intune, und keine Daten der Person mehr darauf sind.",
    topic: ["it-bestand", "rueckgabe"],
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
  "/konto/rueckmeldungen": [["grundlagen", "rueckmeldung"]],
  "/neuigkeiten": [["grundlagen", "konto"]],
  "/benachrichtigungen": [["grundlagen", "benachrichtigungen"]],
  "/konto/benachrichtigungen": [["grundlagen", "benachrichtigungen"]],
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
  "/m365/neuerungen": [["evergreen", "liste"]],
  "/monitoring/dns": [["it-monitoring", "dns-abgleich"]],
  "/verwaltung/zabbix": [
    ["it-monitoring", "zabbix-einrichten"],
    ["it-monitoring", "zabbix-uebersicht"],
  ],
  "/monitoring/zabbix/berichte": [["it-monitoring", "zabbix-berichte"]],
  "/monitoring/zabbix/hosts": [
    ["it-monitoring", "zabbix-uebersicht"],
    ["it-monitoring", "zabbix-bestand"],
  ],
  "/monitoring/zabbix": [["it-monitoring", "zabbix-uebersicht"]],
  "/monitoring/fortigate": [["it-monitoring", "fortigate-uebersicht"]],
  "/monitoring/fortigate/policies": [["it-monitoring", "fortigate-policies"]],
  "/monitoring/fortigate/objekte": [["it-monitoring", "fortigate-objekte"]],
  "/monitoring/fortigate/unbenutzt": [["it-monitoring", "fortigate-unbenutzt"]],
  "/monitoring/fortigate/befunde": [["it-monitoring", "fortigate-befunde"]],
  "/monitoring/fortigate/pfad": [["it-monitoring", "fortigate-pfad"]],
  "/monitoring/fortigate/internet": [["it-monitoring", "fortigate-pfad"]],
  "/monitoring/fortigate/aenderungen": [["it-monitoring", "fortigate-aenderungen"]],
  "/verwaltung/fortigate": [["it-monitoring", "fortigate-einrichten"]],
  "/monitoring/netbird": [["it-monitoring", "netbird-uebersicht"]],
  "/monitoring/netbird/peers": [["it-monitoring", "netbird-peers"]],
  "/monitoring/netbird/netze": [["it-monitoring", "netbird-netze"]],
  "/monitoring/netbird/richtlinien": [["it-monitoring", "netbird-richtlinien"]],
  "/monitoring/netbird/gruppen": [["it-monitoring", "netbird-gruppen"]],
  "/verwaltung/netbird": [["it-monitoring", "netbird-einrichten"]],
  "/doku": [["doku", "seiten"]],
  "/doku/verwaltung": [["doku", "verwaltung"]],
  "/tickets": [["tickets", "uebersicht"]],
  "/tickets/erfolge": [["tickets", "erfolge"]],
  "/tickets/neu": [["tickets", "uebersicht"]],
  "/tickets/einstellungen": [["tickets", "einstellungen"]],
  "/tickets/uebersicht": [["tickets", "uebersicht"]],
  "/tickets/einstellungen/pflege": [
    ["tickets", "email"],
    ["tickets", "betrieb"],
  ],
  "/tickets/einstellungen/bereiche": [
    ["tickets", "einstellungen"],
    ["tickets", "betrieb"],
  ],
  "/tickets/einstellungen/email": [["tickets", "email"]],
  "/tickets/einstellungen/arbeit": [["tickets", "arbeitshilfen"]],
  "/bestand/vorgaenge": [["it-bestand", "vorgaenge"]],
  "/bestand/statistik": [["it-bestand", "statistik"]],
  "/bestand/hardware": [["it-bestand", "hardware"]],
  "/bestand/stellen": [["it-bestand", "stellen"]],
  "/bestand/arbeitsplaetze": [["it-bestand", "arbeitsplaetze"]],
  "/bestand/standorte": [["it-bestand", "standorte"]],
  "/bestand/verleih": [["it-bestand", "verleih"]],
  "/bestand/ausgaben": [["it-bestand", "ausgabe"]],
  "/bestand/rueckgaben": [["it-bestand", "rueckgabe"]],
  "/bestand/stammdaten": [["it-bestand", "stammdaten"]],
  "/budget": [["it-budget", "uebersicht"]],
  "/budget/planung": [["it-budget", "auswertung"]],
  "/budget/statistik": [["it-budget", "auswertung"]],
  "/budget/posten": [
    ["it-budget", "posten"],
    ["it-budget", "verknuepft"],
  ],
  "/budget/rechnungen": [
    ["it-budget", "buchen"],
    ["it-budget", "rechnungen"],
    ["it-budget", "verknuepft"],
    ["it-budget", "begriffe"],
  ],
  "/budget/vertraege": [
    ["it-budget", "vertraege"],
    ["it-budget", "verknuepft"],
  ],
  "/budget/partner": [["it-budget", "partner"]],
  "/budget/konten": [["it-budget", "konten"]],
  "/budget/import": [["it-budget", "import"]],
  "/budget/einstellungen": [["it-budget", "einstellungen"]],
  "/projekte": [["it-projekte", "ueberblick"]],
  "/it-tools/verlauf": [["it-tools", "verlauf"]],
  "/it-tools": [["it-tools", "ueberblick"]],
  "/verwaltung": [["verwaltung", "einstellungen"]],
  "/verwaltung/berechtigungen": [["verwaltung", "berechtigungen"]],
  "/verwaltung/datensicherung": [["verwaltung", "datensicherung"]],
  "/verwaltung/rueckmeldungen": [["verwaltung", "rueckmeldungen"]],
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
