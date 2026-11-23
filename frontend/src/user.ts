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
  ["Projekte.Editor", "IT-Projekte"],
  ["Projekte.Reader", "IT-Projekte"],
  ["Bestand.Editor", "IT-Bestand"],
  ["Bestand.Reader", "IT-Bestand"],
  ["Geraete.Zuordnung", "Gerätezuordnung"],
];

const ROLE_INFO: Record<string, { label: string; description: string }> = {
  "Geraete.Zuordnung": {
    label: "Gerätezuordnung",
    description:
      "Neue Windows-Geräte per QR-Code scannen, zur Freigabe senden, freigeben, verwerfen",
  },
  "Werkbank.Admin": {
    label: "Werkbank Admin",
    description: "Verwaltung der Werkbank: Module, Konnektoren, Regeln, Audit-Log",
  },
  "Config.Reader": {
    label: "Konfiguration Leser",
    description: "M365-Konfiguration ansehen und exportieren",
  },
  "Config.Reviewer": {
    label: "Konfiguration Prüfer",
    description: "Änderungen bewerten, Beschreibungen und Soll-Werte pflegen",
  },
  "Evergreen.Reader": {
    label: "Evergreen Leser",
    description: "Evergreen-Einträge mit Bewertung und Notizen ansehen",
  },
  "Evergreen.Editor": {
    label: "Evergreen Bearbeiter",
    description:
      "Evergreen-Einträge anlegen, bewerten, Notizen anfügen, abschließen und wieder öffnen",
  },
  "Monitoring.Reader": {
    label: "Monitoring Leser",
    description: "Bereich IT-Monitoring ansehen (z. B. DNS-Abgleich mit NetBox)",
  },
  "Monitoring.Berichte": {
    label: "Monitoring Berichte",
    description: "Nur die Berichte von IT-Monitoring ansehen und exportieren, ohne Hostdetails",
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
  "Bestand.Reader": {
    label: "IT-Bestand Leser",
    description: "IT-Bestand ansehen: Hardware und Stammdaten",
  },
  "Bestand.Editor": {
    label: "IT-Bestand Bearbeiter",
    description:
      "IT-Bestand pflegen: Hardware erfassen, Inventurnummern setzen, ausmustern, Stammdaten",
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
