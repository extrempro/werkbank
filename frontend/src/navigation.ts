export interface NavItem {
  path: string;
  label: string;
}

export interface NavGroup {
  title: string | null;
  items: NavItem[];
}

const ADMIN = "Werkbank.Admin";
const AUDITOR = "Werkbank.Auditor";
const CONFIG_ROLES = ["Config.Reader", "Config.Reviewer"];
const EVERGREEN_ROLES = ["Evergreen.IT", "Evergreen.Team", "Evergreen.Betriebsrat", "Evergreen.GF"];

function hasAny(roles: readonly string[], wanted: readonly string[]): boolean {
  return wanted.some((role) => roles.includes(role));
}

/**
 * Navigation nach Rollen (docs/spec.md, Kapitel 4 und 10).
 * Nur Komfort: Die Rechte prüft immer der Server.
 */
export function navigationFor(roles: readonly string[]): NavGroup[] {
  const groups: NavGroup[] = [{ title: null, items: [{ path: "/", label: "Start" }] }];

  if (hasAny(roles, CONFIG_ROLES)) {
    groups.push({
      title: "M365-Konfiguration",
      items: [
        { path: "/m365", label: "Übersicht" },
        { path: "/m365/aenderungen", label: "Änderungen" },
        { path: "/m365/einstellungen", label: "Einstellungen" },
        { path: "/m365/snapshots", label: "Snapshots" },
      ],
    });
  }
  if (hasAny(roles, EVERGREEN_ROLES)) {
    groups.push({ title: "Evergreen", items: [{ path: "/evergreen", label: "Vorgänge" }] });
  }
  if (hasAny(roles, [ADMIN, AUDITOR, ...CONFIG_ROLES])) {
    const items: NavItem[] = [{ path: "/reports", label: "Reports" }];
    if (hasAny(roles, [ADMIN, AUDITOR])) {
      items.push({ path: "/audit", label: "Audit-Log" });
    }
    groups.push({ title: "Allgemein", items });
  }
  if (roles.includes(ADMIN)) {
    groups.push({ title: "Verwaltung", items: [{ path: "/verwaltung", label: "Einstellungen" }] });
  }
  return groups;
}

export function allNavItems(groups: readonly NavGroup[]): NavItem[] {
  return groups.flatMap((group) => group.items);
}
