/** Anzeigehilfen für die angemeldete Person (Kopfzeile, Startseite). */

const ROLE_LABELS: readonly (readonly [string, string])[] = [
  ["Werkbank.Admin", "Administration"],
  ["Config.Reviewer", "Reviewer"],
  ["Evergreen.IT", "IT"],
  ["Evergreen.Team", "Evergreen-Team"],
  ["Evergreen.Betriebsrat", "Betriebsrat"],
  ["Evergreen.GF", "Geschäftsführung"],
  ["Werkbank.Auditor", "Revision"],
  ["Config.Reader", "Lesezugriff"],
];

const ROLE_INFO: Record<string, { label: string; description: string }> = {
  "Werkbank.Admin": {
    label: "Werkbank Admin",
    description: "Verwaltung der Werkbank: Module, Konnektoren, Regeln, Audit-Log",
  },
  "Werkbank.Auditor": { label: "Werkbank Auditor", description: "Audit-Log und Reports lesen" },
  "Config.Reader": {
    label: "Konfiguration Leser",
    description: "M365-Konfiguration ansehen und exportieren",
  },
  "Config.Reviewer": {
    label: "Konfiguration Prüfer",
    description: "Änderungen bewerten, Beschreibungen und Soll-Werte pflegen",
  },
  "Evergreen.IT": {
    label: "Evergreen IT",
    description: "Technische Bewertung und Umsetzung von Evergreen-Vorgängen",
  },
  "Evergreen.Team": {
    label: "Evergreen Team",
    description: "Rückmeldungen der Fachabteilungen und BR-Vorlagen",
  },
  "Evergreen.Betriebsrat": {
    label: "Evergreen Betriebsrat",
    description: "Stellungnahme zu vorgelegten Vorgängen",
  },
  "Evergreen.GF": { label: "Evergreen Geschäftsführung", description: "Abnahme von Vorgängen" },
};

/** Name und Beschreibung einer App-Rolle (wie in der Verwaltung). */
export function roleInfo(role: string): { label: string; description: string } {
  return ROLE_INFO[role] ?? { label: role, description: "" };
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

/** Begrüßung nach Tageszeit. */
export function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 11) {
    return "Guten Morgen";
  }
  return hour < 18 ? "Guten Tag" : "Guten Abend";
}
