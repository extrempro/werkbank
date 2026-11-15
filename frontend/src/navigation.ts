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

  const m365: NavGroup[] = [];
  if (hasAny(roles, CONFIG_ROLES)) {
    m365.push({
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
    const items: NavItem[] = [{ path: "/evergreen", label: "Vorgänge", icon: "vorgaenge" }];
    if (hasAny(roles, EVERGREEN_EDITORS)) {
      items.push({ path: "/evergreen/eingang", label: "Eingang", icon: "eingang" });
    }
    m365.push({ title: "Evergreen", items });
  }

  const areas: NavArea[] = [
    { id: "werkbank", label: "Werkbank", icon: "start", home: "/", groups: general },
  ];
  const first = m365[0]?.items[0];
  if (first) {
    areas.push({
      id: "m365",
      label: "Microsoft 365",
      icon: "m365",
      home: first.path,
      groups: m365,
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
