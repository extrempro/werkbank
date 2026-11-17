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
  ["Budget.Manager", "Budgetverwaltung"],
  ["Tenant.Reader", "Tenant"],
  ["Budget.Editor", "IT-Budget"],
  ["Budget.Reader", "IT-Budget"],
  ["Tools.User", "IT-Tools"],
  ["Monitoring.Reader", "IT-Monitoring"],
  ["Projekte.Editor", "IT-Projekte"],
  ["Projekte.Reader", "IT-Projekte"],
];

const ROLE_INFO: Record<string, { label: string; description: string }> = {
  "Werkbank.Admin": {
    label: "Werkbank Admin",
    description: "Verwaltung der Werkbank: Module, Konnektoren, Regeln, Audit-Log",
  },
  "Werkbank.Auditor": {
    label: "Werkbank Auditor",
    description: "Audit-Log über die Schnittstelle lesen (die Seite sehen nur Admins)",
  },
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
  "Monitoring.Reader": {
    label: "Monitoring Leser",
    description: "Bereich IT-Monitoring ansehen (z. B. DNS-Abgleich mit NetBox)",
  },
  "Tools.User": {
    label: "IT-Tools Nutzer",
    description: "Bereich IT-Tools öffnen (Rechner, Generatoren, Konverter)",
  },
  "Tenant.Reader": {
    label: "Tenant Leser",
    description: "Lizenzen und Benutzerzahlen des Tenants mit Verlauf ansehen",
  },
  "Budget.Editor": {
    label: "Budget Bearbeiter",
    description:
      "IT-Budget ansehen; Konten, Budgetposten, Verträge, Partner und Rechnungen pflegen",
  },
  "Budget.Manager": {
    label: "Budgetverwalter",
    description: "Wie Bearbeiter, dazu Rechnungen buchen und die Einstellungen festlegen",
  },
  "Budget.Reader": { label: "Budget Leser", description: "IT-Budget ansehen" },
  "Projekte.Reader": {
    label: "Projekte Leser",
    description: "IT-Projekte ansehen: Übersicht, Budget, Jour Fixe und Aufgaben",
  },
  "Projekte.Editor": {
    label: "Projekte Bearbeiter",
    description:
      "IT-Projekte anlegen und pflegen: Einstellungen, Jour Fixe mit Anhängen und Aufgaben",
  },
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
