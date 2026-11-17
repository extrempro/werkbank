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
}

export const NEWS_PATH = "/neuigkeiten";

const ADMIN = "Werkbank.Admin";
const AUDITOR = "Werkbank.Auditor";
const CONFIG_ROLES = ["Config.Reader", "Config.Reviewer"];
const EVERGREEN_EDITORS = ["Evergreen.IT", "Evergreen.Team"];
const TOOLS_USER = "Tools.User";
const MONITORING_READER = "Monitoring.Reader";
const PROJECT_ROLES = ["Projekte.Reader", "Projekte.Editor"];
const TENANT_READER = "Tenant.Reader";
const BUDGET_MANAGER = "Budget.Manager";
const BUDGET_ROLES = ["Budget.Reader", "Budget.Editor", BUDGET_MANAGER];

export const TOOLS_PATH = "/it-tools";
export const TOOLS_HISTORY_PATH = "/it-tools/verlauf";
export const LICENSES_PATH = "/m365/lizenzen";
export const USERS_PATH = "/m365/benutzer";
export const CREDENTIALS_PATH = "/m365/zugangsdaten";
export const HEALTH_PATH = "/m365/dienststatus";
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
export const PROJECTS_PATH = "/projekte";

/** Seite einer Kategorie der IT-Tools. */
export function toolCategoryPath(category: string): string {
  return `${TOOLS_PATH}/kategorie/${category}`;
}
const EVERGREEN_ROLES = ["Evergreen.IT", "Evergreen.Team", "Evergreen.Betriebsrat", "Evergreen.GF"];

function hasAny(roles: readonly string[], wanted: readonly string[]): boolean {
  return wanted.some((role) => roles.includes(role));
}

/** Ein Bereich der Werkbank: allgemeine Seiten oder ein Tool mit seinen eigenen Seiten. */
export interface NavArea {
  id: string;
  label: string;
  icon: IconName;
  /** Seite, die beim Wechsel in den Bereich geöffnet wird. */
  home: string;
  groups: NavGroup[];
}

/**
 * Bereiche nach Rollen (docs/spec.md, Kapitel 4 und 10). Jedes Tool bekommt einen eigenen
 * Bereich; die Navigation zeigt immer nur die Seiten des gewählten Bereichs.
 * Nur Komfort: Die Rechte prüft immer der Server.
 */
export function areasFor(roles: readonly string[]): NavArea[] {
  const general: NavGroup[] = [
    {
      title: null,
      items: [
        { path: "/", label: "Start", icon: "start" },
        { path: "/suche", label: "Suche", icon: "suche" },
      ],
    },
  ];
  if (hasAny(roles, [ADMIN, AUDITOR, ...CONFIG_ROLES])) {
    const items: NavItem[] = [{ path: "/reports", label: "Reports", icon: "reports" }];
    if (hasAny(roles, [ADMIN, AUDITOR])) {
      items.push({ path: "/audit", label: "Audit-Log", icon: "audit" });
    }
    general.push({ title: "Allgemein", items });
  }
  if (roles.includes(ADMIN)) {
    general.push({
      title: "Verwaltung",
      items: [{ path: "/verwaltung", label: "Einstellungen", icon: "verwaltung" }],
    });
  }

  const areas: NavArea[] = [
    { id: "werkbank", label: "Werkbank", icon: "start", home: "/", groups: general },
  ];
  if (hasAny(roles, [...CONFIG_ROLES, TENANT_READER])) {
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
        ],
      });
    }
    areas.push({
      id: "m365",
      label: "Microsoft 365",
      icon: "m365",
      home: hasAny(roles, CONFIG_ROLES) ? "/m365" : LICENSES_PATH,
      groups,
    });
  }
  if (hasAny(roles, EVERGREEN_ROLES)) {
    const items: NavItem[] = [{ path: "/evergreen", label: "Vorgänge", icon: "vorgaenge" }];
    if (hasAny(roles, EVERGREEN_EDITORS)) {
      items.push({ path: "/evergreen/eingang", label: "Eingang", icon: "eingang" });
    }
    areas.push({
      id: "evergreen",
      label: "Evergreen",
      icon: "vorgaenge",
      home: "/evergreen",
      // Ohne Überschrift: Der Bereich heißt schon so.
      groups: [{ title: null, items }],
    });
  }
  if (hasAny(roles, BUDGET_ROLES)) {
    const items: NavItem[] = [
      { path: BUDGET_PATH, label: "Übersicht", icon: "uebersicht" },
      { path: BUDGET_ITEMS_PATH, label: "Budgetposten", icon: "posten" },
      { path: BUDGET_PLANNING_PATH, label: "Mehrjahresübersicht", icon: "kalender" },
      { path: BUDGET_STATISTICS_PATH, label: "Statistik", icon: "statistik" },
      { path: BUDGET_CONTRACTS_PATH, label: "Verträge", icon: "vertraege" },
      { path: BUDGET_INVOICES_PATH, label: "Rechnungen", icon: "rechnungen" },
      { path: BUDGET_PARTNERS_PATH, label: "Partner", icon: "partner" },
      { path: BUDGET_ACCOUNTS_PATH, label: "Konten", icon: "konten" },
    ];
    if (roles.includes(BUDGET_MANAGER)) {
      items.push({ path: BUDGET_IMPORT_PATH, label: "Import", icon: "import" });
      items.push({ path: BUDGET_SETTINGS_PATH, label: "Einstellungen", icon: "einstellungen" });
    }
    areas.push({
      id: "budget",
      label: "IT-Budget",
      icon: "budget",
      home: BUDGET_PATH,
      // Ohne Überschrift: Der Bereich heißt schon so.
      groups: [{ title: null, items }],
    });
  }
  if (roles.includes(TOOLS_USER)) {
    const categories = (Object.keys(CATEGORY_LABELS) as ToolCategory[]).filter((category) =>
      TOOLS.some((tool) => tool.category === category),
    );
    areas.push({
      id: "it-tools",
      label: "IT-Tools",
      icon: "werkzeuge",
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
  if (hasAny(roles, PROJECT_ROLES)) {
    areas.push({
      id: "projekte",
      label: "IT-Projekte",
      icon: "projekte",
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
  if (roles.includes(MONITORING_READER) || roles.includes(ADMIN)) {
    areas.push({
      id: "monitoring",
      label: "IT-Monitoring",
      icon: "monitoring",
      home: MONITORING_DNS_PATH,
      groups: [
        {
          title: null,
          items: [
            { path: MONITORING_DNS_PATH, label: "DNS-Abgleich mit NetBox", icon: "netzwerk" },
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

/** Bereich, zu dem ein Pfad gehört. Unbekannte Pfade (Konto, Neuigkeiten) zählen zum ersten. */
export function areaForPath(areas: readonly NavArea[], path: string): NavArea | undefined {
  const owns = (area: NavArea) =>
    allNavItems(area.groups).some(
      (item) => item.path === path || (item.path !== "/" && path.startsWith(`${item.path}/`)),
    );
  return areas.find(owns) ?? areas[0];
}

export function allNavItems(groups: readonly NavGroup[]): NavItem[] {
  return groups.flatMap((group) => group.items);
}
