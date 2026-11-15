import type { ComponentType } from "react";

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
  load: () => Promise<{ default: ComponentType }>;
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    id: "subnetz",
    name: "Subnetz-Rechner",
    category: "netzwerk",
    description:
      "IPv4- und IPv6-Netze berechnen: CIDR, Maske, Wildcard oder Bereich eingeben, Netz aufteilen, Adressen prüfen.",
    tags: ["cidr", "subnet", "ipv4", "ipv6", "netzmaske", "wildcard", "broadcast", "präfix"],
    load: () => import("./cidr/CidrTool"),
  },
  {
    id: "chmod",
    name: "chmod-Rechner",
    category: "system",
    description:
      "Linux-Dateirechte umrechnen: oktal (755), rwxr-xr-x und u=rwx,g=rx,o=rx, mit SetUID, SetGID, Sticky und umask.",
    tags: ["linux", "unix", "rechte", "permissions", "755", "644", "rwx", "umask"],
    load: () => import("./chmod/ChmodTool"),
  },
  {
    id: "base64",
    name: "Base64",
    category: "encoding",
    description:
      "Text in Base64 kodieren oder Base64 zurück in Text wandeln (UTF-8, auch URL-safe).",
    tags: ["encode", "decode", "kodieren", "dekodieren"],
    load: () => import("./base64/Base64Tool"),
  },
  {
    id: "uuid",
    name: "UUID-Generator",
    category: "generator",
    description: "Erzeugt zufällige UUIDs (Version 4).",
    tags: ["guid", "zufall"],
    load: () => import("./uuid/UuidTool"),
  },
  {
    id: "passwort",
    name: "Passwort-Generator",
    category: "generator",
    description:
      "Sichere Kennwörter mit wählbaren Zeichengruppen erzeugen. Alles geschieht im Browser, nichts wird übertragen.",
    tags: ["kennwort", "password", "zufall", "sicher"],
    load: () => import("./password/PasswordTool"),
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
