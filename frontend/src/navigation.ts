import type { IconName } from "./components/Icon";

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
const EVERGREEN_ROLES = ["Evergreen.IT", "Evergreen.Team", "Evergreen.Betriebsrat", "Evergreen.GF"];

function hasAny(roles: readonly string[], wanted: readonly string[]): boolean {
  return wanted.some((role) => roles.includes(role));
}

/**
 * Navigation nach Rollen (docs/spec.md, Kapitel 4 und 10).
 * Nur Komfort: Die Rechte prüft immer der Server.
 */
export function navigationFor(roles: readonly string[]): NavGroup[] {
  const groups: NavGroup[] = [
    {
      title: null,
      items: [
        { path: "/", label: "Start", icon: "start" },
        { path: "/suche", label: "Suche", icon: "suche" },
      ],
    },
  ];

  if (hasAny(roles, CONFIG_ROLES)) {
    groups.push({
      title: "M365-Konfiguration",
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
    const items: NavItem[] = [{ path: "/evergreen", label: "Vorgänge", icon: "vorgaenge" }];
    if (hasAny(roles, EVERGREEN_EDITORS)) {
      items.push({ path: "/evergreen/eingang", label: "Eingang", icon: "eingang" });
    }
    groups.push({ title: "Evergreen", items });
  }
  if (hasAny(roles, [ADMIN, AUDITOR, ...CONFIG_ROLES])) {
    const items: NavItem[] = [{ path: "/reports", label: "Reports", icon: "reports" }];
    if (hasAny(roles, [ADMIN, AUDITOR])) {
      items.push({ path: "/audit", label: "Audit-Log", icon: "audit" });
    }
    groups.push({ title: "Allgemein", items });
  }
  if (roles.includes(ADMIN)) {
    groups.push({
      title: "Verwaltung",
      items: [{ path: "/verwaltung", label: "Einstellungen", icon: "verwaltung" }],
    });
  }
  return groups;
}

export function allNavItems(groups: readonly NavGroup[]): NavItem[] {
  return groups.flatMap((group) => group.items);
}
