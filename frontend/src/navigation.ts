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
const FORTIGATE_READER = "FortiGate.Reader";
const NETBIRD_READER = "NetBird.Reader";
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
export const MONITORING_FORTIGATE_PATH = "/monitoring/fortigate";
export const MONITORING_FORTIGATE_POLICIES_PATH = "/monitoring/fortigate/policies";
export const MONITORING_FORTIGATE_OBJECTS_PATH = "/monitoring/fortigate/objekte";
export const MONITORING_FORTIGATE_UNUSED_PATH = "/monitoring/fortigate/unbenutzt";
export const MONITORING_FORTIGATE_FINDINGS_PATH = "/monitoring/fortigate/befunde";
export const MONITORING_FORTIGATE_PATH_PATH = "/monitoring/fortigate/pfad";
export const MONITORING_FORTIGATE_INTERNET_PATH = "/monitoring/fortigate/internet";
export const MONITORING_FORTIGATE_CHANGES_PATH = "/monitoring/fortigate/aenderungen";
export const ADMIN_FORTIGATE_PATH = "/verwaltung/fortigate";
export const MONITORING_NETBIRD_PATH = "/monitoring/netbird";
export const MONITORING_NETBIRD_PEERS_PATH = "/monitoring/netbird/peers";
export const MONITORING_NETBIRD_NETWORKS_PATH = "/monitoring/netbird/netze";
export const MONITORING_NETBIRD_POLICIES_PATH = "/monitoring/netbird/richtlinien";
export const MONITORING_NETBIRD_CHANGES_PATH = "/monitoring/netbird/gruppen";
export const ADMIN_NETBIRD_PATH = "/verwaltung/netbird";
export const PROJECTS_PATH = "/projekte";
export const INVENTORY_HARDWARE_PATH = "/bestand/hardware";
export const INVENTORY_MASTER_PATH = "/bestand/stammdaten";
export const INVENTORY_LOCATIONS_PATH = "/bestand/standorte";
export const INVENTORY_POSITIONS_PATH = "/bestand/stellen";
export const INVENTORY_CASES_PATH = "/bestand/vorgaenge";
export const INVENTORY_WORKPLACES_PATH = "/bestand/arbeitsplaetze";
export const INVENTORY_LOANS_PATH = "/bestand/verleih";
export const INVENTORY_ISSUES_PATH = "/bestand/ausgaben";
export const INVENTORY_RETURNS_PATH = "/bestand/rueckgaben";
export const INVENTORY_STATISTICS_PATH = "/bestand/statistik";
export const ADMIN_PATH = "/verwaltung";
export const ADMIN_PERMISSIONS_PATH = "/verwaltung/berechtigungen";
export const ADMIN_MAIL_PATH = "/verwaltung/mail-teams";
export const ADMIN_CONNECTIONS_PATH = "/verwaltung/verbindungen";
export const ADMIN_BACKUP_PATH = "/verwaltung/datensicherung";
export const ADMIN_FEEDBACK_PATH = "/verwaltung/rueckmeldungen";
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
export const TICKETS_ACHIEVEMENTS_PATH = "/tickets/erfolge";
/** Neuerungen aus dem Nachrichtencenter (früher Evergreen › Microsoft 365). */
export const EVERGREEN_M365_PATH = "/m365/neuerungen";
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
  if (hasAny(roles, [...CONFIG_ROLES, TENANT_READER, DEVICES_ROLE, ...EVERGREEN_ROLES])) {
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
    if (hasAny(roles, EVERGREEN_ROLES)) {
      groups.push({
        title: "Neuerungen",
        items: [{ path: EVERGREEN_M365_PATH, label: "Nachrichtencenter", icon: "evergreen" }],
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
        : hasAny(roles, EVERGREEN_ROLES)
          ? EVERGREEN_M365_PATH
          : roles.includes(TENANT_READER)
            ? LICENSES_PATH
            : DEVICE_ASSOCIATION_PATH,
      groups,
    });
  }
  // Evergreen (weitere Software) erscheint wieder, sobald es dort mehr als Microsoft 365 gibt;
  // die Neuerungen von Microsoft 365 stehen unter Microsoft 365 › Neuerungen.
  // Admins sehen das Monitoring nur mit Monitoring.Reader (entschieden). FortiGate hat eigene
  // Rechte, unabhängig davon (auch ohne Monitoring.Reader).
  const monitoringFull = roles.includes(MONITORING_READER);
  const reportsItem = {
    path: MONITORING_ZABBIX_REPORTS_PATH,
    label: "Berichte",
    icon: "statistik" as const,
  };
  const monitoringGroups: NavGroup[] = [];
  if (monitoringFull) {
    monitoringGroups.push(
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
    );
  } else if (roles.includes(MONITORING_REPORTS)) {
    // Nur die Berichte, ohne Hostdetails
    monitoringGroups.push({ title: "Zabbix", items: [reportsItem] });
  }
  if (roles.includes(FORTIGATE_READER)) {
    monitoringGroups.push({
      title: "FortiGate",
      items: [
        { path: MONITORING_FORTIGATE_PATH, label: "Übersicht", icon: "uebersicht" },
        { path: MONITORING_FORTIGATE_FINDINGS_PATH, label: "Befunde", icon: "warnung" },
        { path: MONITORING_FORTIGATE_POLICIES_PATH, label: "Policies", icon: "schloss" },
        { path: MONITORING_FORTIGATE_OBJECTS_PATH, label: "Adressen & Dienste", icon: "netzwerk" },
        { path: MONITORING_FORTIGATE_UNUSED_PATH, label: "Unbenutzte Objekte", icon: "loeschen" },
        { path: MONITORING_FORTIGATE_PATH_PATH, label: "Pfad-Analyse", icon: "weiter" },
        {
          path: MONITORING_FORTIGATE_INTERNET_PATH,
          label: "Internet & Topologie",
          icon: "monitoring",
        },
        { path: MONITORING_FORTIGATE_CHANGES_PATH, label: "Änderungen", icon: "verlauf" },
      ],
    });
  }
  if (roles.includes(NETBIRD_READER)) {
    monitoringGroups.push({
      title: "NetBird",
      items: [
        { path: MONITORING_NETBIRD_PATH, label: "Übersicht", icon: "uebersicht" },
        { path: MONITORING_NETBIRD_PEERS_PATH, label: "Peers", icon: "geraet" },
        { path: MONITORING_NETBIRD_NETWORKS_PATH, label: "Netze & Dienste", icon: "netzwerk" },
        {
          path: MONITORING_NETBIRD_POLICIES_PATH,
          label: "Richtlinien & Ereignisse",
          icon: "schloss",
        },
        { path: MONITORING_NETBIRD_CHANGES_PATH, label: "Gruppen & Policies", icon: "aenderungen" },
      ],
    });
  }
  if (monitoringGroups.length > 0) {
    areas.push({
      id: "monitoring",
      label: "IT-Monitoring",
      short: "Monitoring",
      icon: "monitoring",
      section: "betrieb",
      home: monitoringFull
        ? MONITORING_ZABBIX_PATH
        : roles.includes(MONITORING_REPORTS)
          ? MONITORING_ZABBIX_REPORTS_PATH
          : roles.includes(FORTIGATE_READER)
            ? MONITORING_FORTIGATE_PATH
            : MONITORING_NETBIRD_PATH,
      groups: monitoringGroups,
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
          { path: TICKETS_ACHIEVEMENTS_PATH, label: "Meine Erfolge", icon: "stern" },
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
          title: "Ausgabe & Verleih",
          items: [
            { path: INVENTORY_ISSUES_PATH, label: "Ausgabe", icon: "ausgabe" },
            { path: INVENTORY_RETURNS_PATH, label: "Rückgabe", icon: "rueckgabe" },
            { path: INVENTORY_LOANS_PATH, label: "Verleih", icon: "verleih" },
          ],
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
            { path: ADMIN_FORTIGATE_PATH, label: "FortiGate", icon: "schloss" },
            { path: ADMIN_NETBIRD_PATH, label: "NetBird", icon: "netzwerk" },
            { path: ADMIN_BACKUP_PATH, label: "Datensicherung", icon: "snapshots" },
            { path: ADMIN_FEEDBACK_PATH, label: "Rückmeldungen", icon: "rueckmeldung" },
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
