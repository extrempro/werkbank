import { lazy, type ComponentType } from "react";

/**
 * IT-Tools: kleine Werkzeuge, die vollständig im Browser rechnen.
 * Ein neues Tool bekommt einen Ordner (Logik mit Tests, Oberfläche) und einen Eintrag hier.
 * Die Oberfläche wird erst beim Öffnen des Tools geladen.
 */

export type ToolCategory = "netzwerk" | "system" | "encoding" | "generator";

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  netzwerk: "Netzwerk",
  system: "Linux und Server",
  encoding: "Encoding",
  generator: "Generatoren",
};

export interface ToolDefinition {
  /** Eindeutig, stabil, Teil der Adresse: /it-tools/<id> */
  id: string;
  name: string;
  category: ToolCategory;
  description: string;
  /** Zusätzliche Suchbegriffe. */
  tags: string[];
  /** Oberfläche des Tools; wird erst beim Öffnen geladen. */
  component: ComponentType;
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: "subnetz",
    name: "Subnetz-Rechner",
    category: "netzwerk",
    description:
      "IPv4- und IPv6-Netze berechnen: CIDR, Maske, Wildcard oder Bereich eingeben, Netz aufteilen, Adressen prüfen.",
    tags: ["cidr", "subnet", "ipv4", "ipv6", "netzmaske", "wildcard", "broadcast", "präfix"],
    component: lazy(() => import("./cidr/CidrTool")),
  },
  {
    id: "subnetting-bits",
    name: "Subnetting-Bits",
    category: "netzwerk",
    description:
      "Wie viele Bits muss ich für eine Anzahl Subnetze oder Hosts borgen? Zeigt neue Maske, Schrittweite, Bit-Aufteilung und die entstehenden Subnetze.",
    tags: ["subnetz", "borgen", "hostbits", "netzbits", "subnetzmaske", "präfix", "ipv4", "aufteilen"],
    component: lazy(() => import("./subnet-bits/SubnetBitsTool")),
  },
  {
    id: "netze-zusammenfassen",
    name: "Netze zusammenfassen",
    category: "netzwerk",
    description:
      "Liste von Netzen, Adressen und Bereichen zur kleinsten CIDR-Liste zusammenfassen, für Firewall-Regeln, Routen und Allowlists.",
    tags: ["supernet", "supernetting", "aggregieren", "cidr", "route", "summary", "allowlist"],
    component: lazy(() => import("./supernet/SupernetTool")),
  },
  {
    id: "firewall-regeln",
    name: "Firewall-Regeln prüfen",
    category: "netzwerk",
    description:
      "Regelwerk eingeben und ein Testpaket hindurchschicken: Welche Regel greift zuerst? Findet außerdem Regeln, die nie erreicht werden.",
    tags: ["regelwerk", "acl", "paketfilter", "first match", "allow", "deny", "testpaket", "iptables"],
    component: lazy(() => import("./firewall-rules/FirewallRulesTool")),
  },
  {
    id: "mac-adressen",
    name: "MAC-Adressen",
    category: "netzwerk",
    description:
      "MAC-Adressen umformatieren (Windows, Linux, Cisco), Hersteller nachschlagen, Multicast und lokale Adressen erkennen, EUI-64 und IPv6-Link-Local.",
    tags: ["mac", "oui", "hersteller", "vendor", "cisco", "eui-64", "link-local", "arp"],
    component: lazy(() => import("./mac/MacTool")),
  },
  {
    id: "ports",
    name: "Port-Nachschlagewerk",
    category: "netzwerk",
    description:
      "Welcher Dienst nutzt welchen Port? Über 150 gebräuchliche Ports mit Protokoll und Hinweisen, dazu Firewall-Befehle.",
    tags: ["port", "tcp", "udp", "firewall", "dienst", "service", "rdp", "smb", "ldap", "kerberos"],
    component: lazy(() => import("./ports/PortsTool")),
  },
  {
    id: "chmod",
    name: "chmod-Rechner",
    category: "system",
    description:
      "Linux-Dateirechte umrechnen: oktal (755), rwxr-xr-x und u=rwx,g=rx,o=rx, mit SetUID, SetGID, Sticky und umask.",
    tags: ["linux", "unix", "rechte", "permissions", "755", "644", "rwx", "umask"],
    component: lazy(() => import("./chmod/ChmodTool")),
  },
  {
    id: "base64",
    name: "Base64",
    category: "encoding",
    description:
      "Text in Base64 kodieren oder Base64 zurück in Text wandeln (UTF-8, auch URL-safe).",
    tags: ["encode", "decode", "kodieren", "dekodieren"],
    component: lazy(() => import("./base64/Base64Tool")),
  },
  {
    id: "uuid",
    name: "UUID-Generator",
    category: "generator",
    description: "Erzeugt zufällige UUIDs (Version 4).",
    tags: ["guid", "zufall"],
    component: lazy(() => import("./uuid/UuidTool")),
  },
  {
    id: "passwort",
    name: "Passwort-Generator",
    category: "generator",
    description:
      "Sichere Kennwörter mit wählbaren Zeichengruppen erzeugen. Alles geschieht im Browser, nichts wird übertragen.",
    tags: ["kennwort", "password", "zufall", "sicher"],
    component: lazy(() => import("./password/PasswordTool")),
  },
];

export function findTool(id: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.id === id);
}

/** Sucht in Name, Beschreibung und Suchbegriffen; alle Wörter müssen vorkommen. */
export function searchTools(query: string): ToolDefinition[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [...TOOLS];
  }
  return TOOLS.filter((tool) => {
    const text = [tool.name, tool.description, CATEGORY_LABELS[tool.category], ...tool.tags]
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export const FAVORITES_KEY = "werkbank-it-tools-favoriten";

export function readFavorites(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string" && findTool(id) !== undefined)
      : [];
  } catch {
    return [];
  }
}

export function saveFavorites(ids: string[]): void {
  try {
    window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids));
  } catch {
    // Speicher gesperrt: Favoriten gelten dann nur bis zum Neuladen.
  }
}
