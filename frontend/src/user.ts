/** Anzeigehilfen für die angemeldete Person (Kopfzeile, Startseite). */

const ROLE_LABELS: readonly (readonly [string, string])[] = [
  ["Werkbank.Admin", "Administration"],
  ["Config.Reviewer", "Reviewer"],
  ["Evergreen.Editor", "Evergreen-Bearbeiter"],
  ["Evergreen.Reader", "Evergreen-Leser"],
  ["Config.Reader", "Lesezugriff"],
  ["Budget.Manager", "Budgetverwaltung"],
  ["Tenant.Reader", "Tenant"],
  ["Budget.Editor", "IT-Budget"],
  ["Budget.Reader", "IT-Budget"],
  ["Tools.User", "IT-Tools"],
  ["Monitoring.Reader", "IT-Monitoring"],
  ["Monitoring.Berichte", "Monitoring-Berichte"],
  ["FortiGate.Editor", "FortiGate"],
  ["FortiGate.Reader", "FortiGate"],
  ["Projekte.Editor", "IT-Projekte"],
  ["Projekte.Reader", "IT-Projekte"],
  ["Bestand.Editor", "IT-Bestand"],
  ["Bestand.Reader", "IT-Bestand"],
  ["Geraete.Zuordnung", "Gerätezuordnung"],
];

interface RightArea {
  name: string;
  /** Stufen von der höchsten zur niedrigsten: Bezeichnung, entscheidende Rolle, Erklärung. */
  levels: readonly (readonly [string, string, string])[];
}

/**
 * Bereiche und Stufen wie unter Verwaltung › Berechtigungen (Server: `core/permissions.py`).
 * Die Rollennamen sind nur noch interne Kennungen; angezeigt werden Bereich und Stufe.
 */
const RIGHT_AREAS: readonly RightArea[] = [
  {
    name: "Tickets",
    levels: [
      ["Verwalten", "Tickets.Verwaltung", "Bereiche und Postfächer einrichten"],
      ["Nutzen", "Tickets.Nutzer", "Tickets der eigenen Bereiche bearbeiten"],
    ],
  },
  {
    name: "Dokumentation",
    levels: [
      ["Verwalten", "Doku.Admin", "Arbeitsbereiche, Versionen und Papierkorb verwalten"],
      ["Nutzen", "Doku.Nutzer", "Seiten der eigenen Arbeitsbereiche lesen und bearbeiten"],
    ],
  },
  {
    name: "IT-Bestand",
    levels: [
      ["Bearbeiten", "Bestand.Editor", "Hardware, Stammdaten und Vorgänge pflegen"],
      ["Lesen", "Bestand.Reader", "Hardware, Stammdaten und Vorgänge ansehen"],
    ],
  },
  {
    name: "Gerätezuordnung",
    levels: [
      [
        "Nutzen",
        "Geraete.Zuordnung",
        "Neue Windows-Geräte per QR-Code scannen, zur Freigabe senden und freigeben",
      ],
    ],
  },
  {
    name: "IT-Projekte",
    levels: [
      ["Bearbeiten", "Projekte.Editor", "Projekte, Jour Fixe und Aufgaben pflegen"],
      ["Lesen", "Projekte.Reader", "Projekte mit Budget, Jour Fixe und Aufgaben ansehen"],
    ],
  },
  {
    name: "IT-Budget",
    levels: [
      ["Verwalten", "Budget.Manager", "Wie Bearbeiten, dazu Rechnungen buchen und Einstellungen"],
      ["Bearbeiten", "Budget.Editor", "Konten, Posten, Verträge, Partner und Rechnungen pflegen"],
      ["Lesen", "Budget.Reader", "IT-Budget ansehen"],
    ],
  },
  {
    name: "IT-Monitoring",
    levels: [
      ["Lesen", "Monitoring.Reader", "Den ganzen Bereich ansehen"],
      ["Nur Berichte", "Monitoring.Berichte", "Nur die Berichte, ohne Hostdetails"],
    ],
  },
  {
    name: "FortiGate",
    levels: [
      ["Bearbeiten", "FortiGate.Editor", "Wie Lesen, dazu „Jetzt abrufen“"],
      ["Lesen", "FortiGate.Reader", "Policies, Adressen und Dienste der Firewalls ansehen"],
    ],
  },
  {
    name: "M365-Einstellungen",
    levels: [
      ["Prüfen", "Config.Reviewer", "Änderungen bewerten, Beschreibungen und Soll-Werte pflegen"],
      ["Lesen", "Config.Reader", "Einstellungen und Tenant-Übersicht ansehen"],
      ["Lesen", "Tenant.Reader", "Einstellungen und Tenant-Übersicht ansehen"],
    ],
  },
  {
    name: "Evergreen",
    levels: [
      ["Bearbeiten", "Evergreen.Editor", "Einträge anlegen, bewerten und abschließen"],
      ["Lesen", "Evergreen.Reader", "Einträge mit Bewertung und Notizen ansehen"],
    ],
  },
  {
    name: "IT-Tools",
    levels: [["Nutzen", "Tools.User", "Rechner, Generatoren und Konverter"]],
  },
];

export const ADMIN_ROLE = "Werkbank.Admin";

const OTHER_INFO: Record<string, { label: string; description: string }> = {
  [ADMIN_ROLE]: {
    label: "Admin-Gruppe",
    description: "Verwaltung der Werkbank; die Mitgliedschaft kommt aus Entra",
  },
  "tickets:bereich": {
    label: "Tickets: Mitglied eines Bereichs",
    description: "Tickets der eigenen Bereiche",
  },
  "tickets:einstellungen": {
    label: "Tickets: Einstellungen",
    description: "Einstellungen der Ticket-Bereiche",
  },
};

export interface Right {
  area: string;
  level: string;
  description: string;
}

/** Höchste Stufe je Bereich, wie unter Verwaltung › Berechtigungen. */
export function myRights(roles: readonly string[]): Right[] {
  const rights: Right[] = [];
  for (const area of RIGHT_AREAS) {
    const level = area.levels.find(([, role]) => roles.includes(role));
    if (level) {
      rights.push({ area: area.name, level: level[0], description: level[2] });
    }
  }
  return rights;
}

/** Name und Beschreibung einer Rolle als Bereich und Stufe, z. B. „IT-Budget: Lesen“. */
export function roleInfo(role: string): { label: string; description: string } {
  for (const area of RIGHT_AREAS) {
    const level = area.levels.find(([, key]) => key === role);
    if (level) {
      return { label: `${area.name}: ${level[0]}`, description: level[2] };
    }
  }
  return OTHER_INFO[role] ?? { label: role, description: "" };
}

/** Bezeichnung der wichtigsten Rolle; ohne bekannte Rolle `null`. */
export function roleLabel(roles: readonly string[]): string | null {
  const match = ROLE_LABELS.find(([role]) => roles.includes(role));
  return match ? match[1] : null;
}

/** Bis zu zwei Anfangsbuchstaben aus dem Anzeigenamen, z. B. „Erika Beispiel“ → „EB“. */
export function initials(displayName: string): string {
  const parts = displayName
    .replace(/\(.*?\)/g, " ")
    .split(/[\s,]+/)
    .filter((part) => /^\p{L}/u.test(part));
  const first = parts[0];
  if (!first) {
    return "?";
  }
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  return (first.charAt(0) + (last ? last.charAt(0) : "")).toUpperCase();
}

/** Begrüßung nach Tageszeit, per du. */
export function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 11) {
    return "Guten Morgen";
  }
  return hour < 18 ? "Hallo" : "Guten Abend";
}

/**
 * Vorname für die Begrüßung: aus „Vorname Nachname“ das erste Wort, aus „Nachname, Vorname“
 * das Wort nach dem Komma; Zusätze in Klammern fallen weg.
 */
export function firstName(displayName: string): string {
  const clean = displayName.replace(/\(.*?\)/g, " ").trim();
  const comma = clean.indexOf(",");
  const part = comma >= 0 ? clean.slice(comma + 1) : clean;
  return part.trim().split(/\s+/)[0] || displayName.trim();
}
