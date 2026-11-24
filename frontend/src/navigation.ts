import type { IconName } from "./components/Icon";
import { CATEGORY_LABELS, TOOLS, type ToolCategory } from "./tools";

export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

export interface NavGroup {
  title: string | null;
  items: NavItem[];
  /** Gruppe ist anfangs eingeklappt (die Person kann sie aufklappen; der Browser merkt es sich). */
  collapsed?: boolean;
}

export const NEWS_PATH = "/neuigkeiten";

const ADMIN = "Werkbank.Admin";
const CONFIG_ROLES = ["Config.Reader", "Config.Reviewer"];
const TOOLS_USER = "Tools.User";
const MONITORING_READER = "Monitoring.Reader";
const MONITORING_REPORTS = "Monitoring.Berichte";
const PROJECT_ROLES = ["Projekte.Reader", "Projekte.Editor"];
const INVENTORY_ROLES = ["Bestand.Reader", "Bestand.Editor"];
const TENANT_READER = "Tenant.Reader";
const DEVICES_ROLE = "Geraete.Zuordnung";
const BUDGET_MANAGER = "Budget.Manager";
const BUDGET_ROLES = ["Budget.Reader", "Budget.Editor", BUDGET_MANAGER];
const DOKU_ADMIN = "Doku.Admin";
const DOKU_ROLES = ["Doku.Nutzer", DOKU_ADMIN];

export const TOOLS_PATH = "/it-tools";
export const TOOLS_HISTORY_PATH = "/it-tools/verlauf";
export const LICENSES_PATH = "/m365/lizenzen";
export const USERS_PATH = "/m365/benutzer";
export const CREDENTIALS_PATH = "/m365/zugangsdaten";
export const HEALTH_PATH = "/m365/dienststatus";
export const USAGE_PATH = "/m365/nutzung";
export const DEVICE_ASSOCIATION_PATH = "/m365/geraete/zuordnung";
export const BUDGET_PATH = "/budget";
export const BUDGET_ACCOUNTS_PATH = "/budget/konten";
export const BUDGET_SETTINGS_PATH = "/budget/einstellungen";
export const BUDGET_IMPORT_PATH = "/budget/import";
export const BUDGET_CONTRACTS_PATH = "/budget/vertraege";
export const BUDGET_PARTNERS_PATH = "/budget/partner";
export const BUDGET_ITEMS_PATH = "/budget/posten";
export const BUDGET_INVOICES_PATH = "/budget/rechnungen";
export const BUDGET_PLANNING_PATH = "/budget/planung";
export const BUDGET_STATISTICS_PATH = "/budget/statistik";
export const MONITORING_DNS_PATH = "/monitoring/dns";
export const MONITORING_ZABBIX_PATH = "/monitoring/zabbix";
export const MONITORING_ZABBIX_HOSTS_PATH = "/monitoring/zabbix/hosts";
export const MONITORING_ZABBIX_MAINTENANCE_PATH = "/monitoring/zabbix/wartungen";
export const ADMIN_ZABBIX_PATH = "/verwaltung/zabbix";
export const MONITORING_ZABBIX_REPORTS_PATH = "/monitoring/zabbix/berichte";
export const PROJECTS_PATH = "/projekte";
export const INVENTORY_HARDWARE_PATH = "/bestand/hardware";
export const INVENTORY_MASTER_PATH = "/bestand/stammdaten";
export const INVENTORY_LOCATIONS_PATH = "/bestand/standorte";
export const INVENTORY_POSITIONS_PATH = "/bestand/stellen";
export const INVENTORY_CASES_PATH = "/bestand/vorgaenge";
export const INVENTORY_WORKPLACES_PATH = "/bestand/arbeitsplaetze";
export const INVENTORY_LOANS_PATH = "/bestand/verleih";
export const INVENTORY_STATISTICS_PATH = "/bestand/statistik";
export const ADMIN_PATH = "/verwaltung";
export const ADMIN_PERMISSIONS_PATH = "/verwaltung/berechtigungen";
export const ADMIN_MAIL_PATH = "/verwaltung/mail-teams";
export const ADMIN_CONNECTIONS_PATH = "/verwaltung/verbindungen";
export const AUDIT_PATH = "/audit";

/** Seite einer Kategorie der IT-Tools. */
export function toolCategoryPath(category: string): string {
  return `${TOOLS_PATH}/kategorie/${category}`;
}
const EVERGREEN_ROLES = ["Evergreen.Reader", "Evergreen.Editor"];
/**
 * Tickets hängen nicht an App-Rollen, sondern an den Rollen je Bereich (Server, Graph). Die
 * Oberfläche fragt sie bei /api/tickets/me ab und gibt sie als diese zwei Kennzeichen weiter.
 */
export const TICKETS_MEMBER = "tickets:bereich";
export const TICKETS_SETTINGS = "tickets:einstellungen";
export const TICKETS_PATH = "/tickets";
export const TICKETS_NEW_PATH = "/tickets/neu";
export const TICKETS_SETTINGS_PATH = "/tickets/einstellungen";
export const TICKETS_OVERVIEW_PATH = "/tickets/uebersicht";
export const EVERGREEN_M365_PATH = "/evergreen/m365";
export const DOKU_PATH = "/doku";
export const DOKU_ADMIN_PATH = "/doku/verwaltung";

function hasAny(roles: readonly string[], wanted: readonly string[]): boolean {
  return wanted.some((role) => roles.includes(role));
}

/** Abschnitte der Bereichsleiste, durch Linien getrennt; „unten“ steht am Fuß der Leiste. */
export type BarSection = "start" | "anwendungen" | "betrieb" | "planung" | "werkzeuge" | "unten";

/** Ein Bereich der Werkbank: allgemeine Seiten oder ein Tool mit seinen eigenen Seiten. */
export interface NavArea {
  id: string;
  /** Voller Name: Seitenmenü, Tooltip und Screenreader. */
  label: string;
  /** Kurzname unter dem Symbol in der Bereichsleiste. */
  short: string;
  icon: IconName;
  /** Abschnitt in der Bereichsleiste. */
  section: BarSection;
  /** Seite, die beim Wechsel in den Bereich geöffnet wird. */
  home: string;
  groups: NavGroup[];
}

/** Die persönlichen Gruppen (Angeheftet, Zuletzt besucht) stehen im Start-Bereich. */
export const START_AREA = "werkbank";

/**
 * Bereiche nach Rollen (docs/spec.md, Kapitel 4 und 10), in der Reihenfolge der Bereichsleiste.
 * Ein neuer Bereich braucht nur einen Eintrag hier. Nur Komfort: Die Rechte prüft immer der
 * Server; die erlaubten Pfade stehen dort noch einmal (backend/werkbank/core/navigation.py).
 */
export function areasFor(roles: readonly string[]): NavArea[] {
  const areas: NavArea[] = [
    {
      id: START_AREA,
      label: "Start",
      short: "Start",
      icon: "start",
      section: "start",
      home: "/",
      // Zwischen den beiden Gruppen stehen im Menü „Angeheftet“ und „Zuletzt besucht“.
      groups: [
        { title: null, items: [{ path: "/", label: "Start", icon: "start" }] },
        { title: null, items: [{ path: "/suche", label: "Suche", icon: "suche" }] },
      ],
    },
  ];
  if (hasAny(roles, [...CONFIG_ROLES, TENANT_READER, DEVICES_ROLE])) {
    const groups: NavGroup[] = [];
    if (hasAny(roles, CONFIG_ROLES)) {
      groups.push({
        title: "Konfiguration",
        items: [
          { path: "/m365", label: "Übersicht", icon: "uebersicht" },
          { path: "/m365/aenderungen", label: "Änderungen", icon: "aenderungen" },
          { path: "/m365/einstellungen", label: "Einstellungen", icon: "einstellungen" },
          { path: "/m365/empfehlungen", label: "Empfehlungen", icon: "empfehlungen" },
          { path: "/m365/snapshots", label: "Snapshots", icon: "snapshots" },
        ],
      });
    }
    if (roles.includes(TENANT_READER)) {
      groups.push({
        title: "Tenant",
        items: [
          { path: LICENSES_PATH, label: "Lizenzen", icon: "lizenzen" },
          { path: USERS_PATH, label: "Benutzer", icon: "benutzer" },
          { path: CREDENTIALS_PATH, label: "Zertifikate & Secrets", icon: "schluessel" },
          { path: HEALTH_PATH, label: "Dienststatus", icon: "dienststatus" },
          { path: USAGE_PATH, label: "Nutzung", icon: "statistik" },
        ],
      });
    }
    if (roles.includes(DEVICES_ROLE)) {
      groups.push({
        title: "Geräte",
        items: [{ path: DEVICE_ASSOCIATION_PATH, label: "Gerätezuordnung", icon: "geraet" }],
      });
    }
    areas.push({
      id: "m365",
      label: "Microsoft 365",
      short: "M365",
      icon: "m365",
      section: "anwendungen",
      home: hasAny(roles, CONFIG_ROLES)
        ? "/m365"
        : roles.includes(TENANT_READER)
          ? LICENSES_PATH
          : DEVICE_ASSOCIATION_PATH,
      groups,
    });
  }
  if (hasAny(roles, EVERGREEN_ROLES)) {
    // Je Software ein Unterabschnitt; weitere kommen später dazu.
    const items: NavItem[] = [{ path: EVERGREEN_M365_PATH, label: "Microsoft 365", icon: "m365" }];
    areas.push({
      id: "evergreen",
      label: "Evergreen",
      short: "Evergreen",
      icon: "evergreen",
      section: "anwendungen",
      home: EVERGREEN_M365_PATH,
      // Ohne Überschrift: Der Bereich heißt schon so.
      groups: [{ title: null, items }],
    });
  }
  // Admins sehen das Monitoring nur mit Monitoring.Reader (entschieden).
  const monitoringFull = roles.includes(MONITORING_READER);
  const reportsItem = {
    path: MONITORING_ZABBIX_REPORTS_PATH,
    label: "Berichte",
    icon: "statistik" as const,
  };
  if (!monitoringFull && roles.includes(MONITORING_REPORTS)) {
    // Nur die Berichte, ohne Hostdetails
    areas.push({
      id: "monitoring",
      label: "IT-Monitoring",
      short: "Monitoring",
      icon: "monitoring",
      section: "betrieb",
      home: MONITORING_ZABBIX_REPORTS_PATH,
      groups: [{ title: "Zabbix", items: [reportsItem] }],
    });
  }
  if (monitoringFull) {
    areas.push({
      id: "monitoring",
      label: "IT-Monitoring",
      short: "Monitoring",
      icon: "monitoring",
      section: "betrieb",
      home: MONITORING_ZABBIX_PATH,
      groups: [
        {
          title: "Zabbix",
          items: [
            { path: MONITORING_ZABBIX_PATH, label: "Übersicht", icon: "uebersicht" },
            { path: MONITORING_ZABBIX_HOSTS_PATH, label: "Hosts", icon: "geraet" },
            { path: MONITORING_ZABBIX_MAINTENANCE_PATH, label: "Wartungen", icon: "kalender" },
            reportsItem,
          ],
        },
        {
          title: "NetBox",
          items: [{ path: MONITORING_DNS_PATH, label: "DNS-Abgleich", icon: "netzwerk" }],
        },
      ],
    });
  }
  if (hasAny(roles, [TICKETS_MEMBER, TICKETS_SETTINGS])) {
    const groups: NavGroup[] = [];
    if (roles.includes(TICKETS_MEMBER)) {
      groups.push({
        title: null,
        items: [
          { path: TICKETS_OVERVIEW_PATH, label: "Übersicht", icon: "uebersicht" },
          { path: TICKETS_PATH, label: "Alle Tickets", icon: "tickets" },
          { path: TICKETS_NEW_PATH, label: "Neues Ticket", icon: "plus" },
        ],
      });
    }
    if (roles.includes(TICKETS_SETTINGS)) {
      groups.push({
        title: "Verwaltung",
        collapsed: roles.includes(TICKETS_MEMBER),
        items: [{ path: TICKETS_SETTINGS_PATH, label: "Einstellungen", icon: "einstellungen" }],
      });
    }
    areas.push({
      id: "tickets",
      label: "Tickets",
      short: "Tickets",
      icon: "tickets",
      section: "betrieb",
      home: roles.includes(TICKETS_MEMBER) ? TICKETS_OVERVIEW_PATH : TICKETS_SETTINGS_PATH,
      groups,
    });
  }
  if (hasAny(roles, INVENTORY_ROLES)) {
    areas.push({
      id: "bestand",
      label: "IT-Bestand",
      short: "Bestand",
      icon: "bestand",
      section: "betrieb",
      home: INVENTORY_HARDWARE_PATH,
      groups: [
        {
          title: null,
          items: [
            { path: INVENTORY_CASES_PATH, label: "Vorgänge", icon: "vorgaenge" },
            { path: INVENTORY_STATISTICS_PATH, label: "Statistik", icon: "statistik" },
          ],
        },
        {
          title: "Bestand",
          items: [
            { path: INVENTORY_HARDWARE_PATH, label: "Hardware", icon: "geraet" },
            { path: INVENTORY_POSITIONS_PATH, label: "Stellen", icon: "stellen" },
            { path: INVENTORY_WORKPLACES_PATH, label: "Arbeitsplätze", icon: "arbeitsplatz" },
            { path: INVENTORY_LOCATIONS_PATH, label: "Standorte", icon: "standort" },
          ],
        },
        {
          title: "Verleih",
          items: [{ path: INVENTORY_LOANS_PATH, label: "Verleih", icon: "verleih" }],
        },
        {
          title: "Verwaltung",
          collapsed: true,
          items: [{ path: INVENTORY_MASTER_PATH, label: "Stammdaten", icon: "einstellungen" }],
        },
      ],
    });
  }
  if (hasAny(roles, DOKU_ROLES)) {
    // Im Bereich steht statt dieser Liste der Seitenbaum (modules/doku/DokuMenu.tsx)
    const groups: NavGroup[] = [
      { title: null, items: [{ path: DOKU_PATH, label: "Übersicht", icon: "doku" }] },
    ];
    if (roles.includes(DOKU_ADMIN)) {
      groups.push({
        title: "Verwaltung",
        items: [{ path: DOKU_ADMIN_PATH, label: "Arbeitsbereiche", icon: "einstellungen" }],
      });
    }
    areas.push({
      id: "doku",
      label: "Dokumentation",
      short: "Doku",
      icon: "doku",
      section: "betrieb",
      home: DOKU_PATH,
      groups,
    });
  }
  if (hasAny(roles, BUDGET_ROLES)) {
    const groups: NavGroup[] = [
      {
        title: "Überblick",
        items: [
          { path: BUDGET_PATH, label: "Übersicht", icon: "uebersicht" },
          { path: BUDGET_PLANNING_PATH, label: "Mehrjahresübersicht", icon: "kalender" },
          { path: BUDGET_STATISTICS_PATH, label: "Statistik", icon: "statistik" },
        ],
      },
      {
        title: "Ausgaben",
        items: [
          { path: BUDGET_ITEMS_PATH, label: "Budgetposten", icon: "posten" },
          { path: BUDGET_INVOICES_PATH, label: "Rechnungen", icon: "rechnungen" },
          { path: BUDGET_CONTRACTS_PATH, label: "Verträge", icon: "vertraege" },
        ],
      },
      {
        title: "Stammdaten",
        items: [
          { path: BUDGET_PARTNERS_PATH, label: "Partner", icon: "partner" },
          { path: BUDGET_ACCOUNTS_PATH, label: "Konten", icon: "konten" },
        ],
      },
    ];
    if (roles.includes(BUDGET_MANAGER)) {
      groups.push({
        title: "Verwaltung",
        collapsed: true,
        items: [
          { path: BUDGET_IMPORT_PATH, label: "Import", icon: "import" },
          { path: BUDGET_SETTINGS_PATH, label: "Einstellungen", icon: "einstellungen" },
        ],
      });
    }
    areas.push({
      id: "budget",
      label: "IT-Budget",
      short: "Budget",
      icon: "budget",
      section: "planung",
      home: BUDGET_PATH,
      groups,
    });
  }
  if (hasAny(roles, PROJECT_ROLES)) {
    areas.push({
      id: "projekte",
      label: "IT-Projekte",
      short: "Projekte",
      icon: "projekte",
      section: "planung",
      home: PROJECTS_PATH,
      // Ohne Überschrift: Der Bereich heißt schon so. Die Projekte selbst stehen auf der Seite.
      groups: [
        {
          title: null,
          items: [{ path: PROJECTS_PATH, label: "Alle Projekte", icon: "uebersicht" }],
        },
      ],
    });
  }
  if (roles.includes(TOOLS_USER)) {
    const categories = (Object.keys(CATEGORY_LABELS) as ToolCategory[]).filter((category) =>
      TOOLS.some((tool) => tool.category === category),
    );
    areas.push({
      id: "it-tools",
      label: "IT-Tools",
      short: "Tools",
      icon: "werkzeuge",
      section: "werkzeuge",
      home: TOOLS_PATH,
      groups: [
        // Ohne Überschrift: Der Bereich heißt schon so.
        {
          title: null,
          items: [
            { path: TOOLS_PATH, label: "Alle Tools", icon: "uebersicht" },
            { path: TOOLS_HISTORY_PATH, label: "Verlauf", icon: "verlauf" },
          ],
        },
        {
          title: "Kategorien",
          items: categories.map((category) => ({
            path: toolCategoryPath(category),
            label: CATEGORY_LABELS[category],
            icon: category,
          })),
        },
      ],
    });
  }
  if (roles.includes(ADMIN)) {
    areas.push({
      id: "verwaltung",
      label: "Verwaltung",
      short: "Verwaltung",
      icon: "verwaltung",
      section: "unten",
      home: ADMIN_PATH,
      // Ohne Überschrift: Der Bereich heißt schon so.
      groups: [
        {
          title: null,
          items: [
            { path: ADMIN_PATH, label: "Allgemein", icon: "einstellungen" },
            { path: ADMIN_PERMISSIONS_PATH, label: "Berechtigungen", icon: "benutzer" },
            { path: ADMIN_MAIL_PATH, label: "Mail & Teams", icon: "eingang" },
            { path: ADMIN_CONNECTIONS_PATH, label: "Verbindungen", icon: "netzwerk" },
            { path: ADMIN_ZABBIX_PATH, label: "Zabbix", icon: "monitoring" },
            { path: AUDIT_PATH, label: "Audit-Log", icon: "audit" },
          ],
        },
      ],
    });
  }
  return areas;
}

/** Alle Gruppen aller Bereiche, z. B. um zu prüfen, ob eine Seite erreichbar ist. */
export function navigationFor(roles: readonly string[]): NavGroup[] {
  return areasFor(roles).flatMap((area) => area.groups);
}

export function allNavItems(groups: readonly NavGroup[]): NavItem[] {
  return groups.flatMap((group) => group.items);
}

/**
 * Menüpunkt, zu dem ein Pfad gehört: derselbe Pfad oder der längste, unter dem er liegt
 * (z. B. `/bestand/hardware/7` → Hardware). Start („/“) zählt nur genau.
 */
export function activeNavPath(items: readonly NavItem[], path: string): string | undefined {
  let best: string | undefined;
  for (const item of items) {
    const owns = item.path === path || (item.path !== "/" && path.startsWith(`${item.path}/`));
    if (owns && (best === undefined || item.path.length > best.length)) {
      best = item.path;
    }
  }
  return best;
}

/** Bereich, zu dem ein Pfad gehört. Unbekannte Pfade (Konto, Neuigkeiten) zählen zum ersten. */
export function areaForPath(areas: readonly NavArea[], path: string): NavArea | undefined {
  return (
    areas.find((area) => activeNavPath(allNavItems(area.groups), path) !== undefined) ?? areas[0]
  );
}

/** Ein Menüpunkt mit seinem Bereich und seiner Gruppe (für Suche, Anheften, Zuletzt besucht). */
export interface NavEntry {
  item: NavItem;
  area: NavArea;
  group: string | null;
}

export function navEntries(areas: readonly NavArea[]): NavEntry[] {
  return areas.flatMap((area) =>
    area.groups.flatMap((group) => group.items.map((item) => ({ item, area, group: group.title }))),
  );
}

/** Menüpunkt zu genau diesem Pfad; ohne Recht oder bei unbekanntem Pfad `undefined`. */
export function findNavEntry(areas: readonly NavArea[], path: string): NavEntry | undefined {
  return navEntries(areas).find((entry) => entry.item.path === path);
}

/** Text vereinfachen, damit „ae“ auch „ä“ findet und Groß-/Kleinschreibung nicht zählt. */
function fold(text: string): string {
  return text
    .toLocaleLowerCase("de-DE")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

/**
 * Schnellsuche über die Seiten, die die Person sehen darf: nach Name, Gruppe und Bereich.
 * Jedes Wort muss irgendwo vorkommen; Treffer im Namen stehen vorn.
 */
export function searchPages(areas: readonly NavArea[], query: string, limit = 12): NavEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const scored: { entry: NavEntry; score: number; index: number }[] = [];
  navEntries(areas).forEach((entry, index) => {
    const label = fold(entry.item.label);
    const context = fold(`${entry.group ?? ""} ${entry.area.label} ${entry.area.short}`);
    let score = 0;
    for (const word of words) {
      if (label.startsWith(word) || label.includes(` ${word}`)) {
        score += 3;
      } else if (label.includes(word)) {
        score += 2;
      } else if (context.includes(word)) {
        score += 1;
      } else {
        return;
      }
    }
    scored.push({ entry, score, index });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ entry }) => entry);
}
