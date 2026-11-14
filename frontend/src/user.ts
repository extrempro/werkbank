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
