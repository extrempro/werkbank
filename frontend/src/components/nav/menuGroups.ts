import {
  findNavEntry,
  START_AREA,
  type NavArea,
  type NavEntry,
  type NavGroup,
} from "../../navigation";
import { RECENT_SHOWN, type NavPrefs } from "../../navPrefs";

/** Eine Gruppe im Seitenmenü oder im Menü am Handy. */
export interface MenuGroup {
  /** Eindeutig je Bereich; Schlüssel für den gemerkten Zustand (auf/zu). */
  key: string;
  title: string | null;
  entries: NavEntry[];
  /** Anfangs eingeklappt (aus der Navigation). */
  collapsed: boolean;
  /** Persönliche Gruppe (Angeheftet, Zuletzt besucht): zeigt den Bereich als Chip. */
  personal: boolean;
}

function fromGroup(area: NavArea, group: NavGroup, index: number): MenuGroup {
  return {
    key: `${area.id}/${group.title ?? index}`,
    title: group.title,
    entries: group.items.map((item) => ({ item, area, group: group.title })),
    collapsed: group.collapsed ?? false,
    personal: false,
  };
}

/** Seiten zu gespeicherten Pfaden; ohne Recht oder unbekannt fallen sie weg. */
export function entriesFor(areas: readonly NavArea[], paths: readonly string[]): NavEntry[] {
  return paths.flatMap((path) => {
    const entry = findNavEntry(areas, path);
    return entry ? [entry] : [];
  });
}

/**
 * Gruppen eines Bereichs. Im Start-Bereich stehen zwischen „Start“ und den übrigen Seiten die
 * persönlichen Gruppen „Angeheftet“ (immer, auch leer) und „Zuletzt besucht“ (wenn vorhanden).
 */
export function menuGroups(area: NavArea, areas: readonly NavArea[], prefs: NavPrefs): MenuGroup[] {
  const groups = area.groups.map((group, index) => fromGroup(area, group, index));
  if (area.id !== START_AREA) {
    return groups;
  }
  const personal: MenuGroup[] = [
    {
      key: `${area.id}/Angeheftet`,
      title: "Angeheftet",
      entries: entriesFor(areas, prefs.pinned),
      collapsed: false,
      personal: true,
    },
  ];
  const recent = entriesFor(areas, prefs.recent).slice(0, RECENT_SHOWN);
  if (recent.length > 0) {
    personal.push({
      key: `${area.id}/Zuletzt besucht`,
      title: "Zuletzt besucht",
      entries: recent,
      collapsed: false,
      personal: true,
    });
  }
  return [...groups.slice(0, 1), ...personal, ...groups.slice(1)];
}
