import { useId, useState, type MouseEvent } from "react";
import type { NavArea } from "../../navigation";
import { useNavPrefs } from "../../navPrefs";
import { Icon } from "../Icon";
import { menuGroups, type MenuGroup } from "./menuGroups";
import { PinButton } from "./PinButton";

/** Gemerkter Zustand der Gruppen (auf/zu) in diesem Browser. */
export const GROUPS_KEY = "werkbank-navigation-gruppen";

function readGroups(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(GROUPS_KEY) ?? "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, boolean] => {
        return typeof entry[1] === "boolean";
      }),
    );
  } catch {
    return {};
  }
}

function saveGroups(groups: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(GROUPS_KEY, JSON.stringify(groups));
  } catch {
    // Speicher gesperrt: Der Zustand gilt dann nur bis zum Neuladen.
  }
}

interface SideMenuProps {
  id: string;
  area: NavArea;
  areas: readonly NavArea[];
  /** Hervorgehobener Menüpunkt (die Seite oder die, unter der sie liegt). */
  activePath: string | undefined;
  hidden: boolean;
  badgeFor: (path: string) => number;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void;
  onCollapse: () => void;
}

/** Seiten des gewählten Bereichs, in Gruppen zum Auf- und Zuklappen, mit Stern zum Anheften. */
export function SideMenu({
  id,
  area,
  areas,
  activePath,
  hidden,
  badgeFor,
  onNavigate,
  onCollapse,
}: SideMenuProps) {
  const prefs = useNavPrefs();
  const [stored, setStored] = useState(readGroups);
  const baseId = useId();
  const groups = menuGroups(area, areas, prefs);

  // Eine Wahl der Person gilt; sonst ist die Gruppe der geöffneten Seite immer offen.
  const isOpen = (group: MenuGroup): boolean =>
    stored[group.key] ??
    (!group.collapsed || group.entries.some((entry) => entry.item.path === activePath));
  const toggle = (group: MenuGroup) => {
    const next = { ...stored, [group.key]: !isOpen(group) };
    setStored(next);
    saveGroups(next);
  };

  return (
    <nav id={id} className="side-menu" aria-label={`Seiten: ${area.label}`} hidden={hidden}>
      <p className="side-title">{area.label}</p>
      <div className="side-groups">
        {groups.map((group, index) => {
          const open = group.title === null || isOpen(group);
          const listId = `${baseId}-${index}`;
          return (
            <div className="side-group" key={group.key}>
              {group.title && (
                <button
                  type="button"
                  className="side-group-toggle"
                  aria-expanded={open}
                  aria-controls={listId}
                  onClick={() => toggle(group)}
                >
                  <span>{group.title}</span>
                  <Icon name="pfeil-unten" />
                </button>
              )}
              {group.personal && group.entries.length === 0 ? (
                <p id={listId} className="side-hint" hidden={!open}>
                  Noch nichts angeheftet. Mit dem Stern neben einer Seite heftest du sie hier an.
                </p>
              ) : (
                <ul id={listId} hidden={!open}>
                  {group.entries.map((entry) => {
                    const count = group.personal ? 0 : badgeFor(entry.item.path);
                    return (
                      <li className="side-item" key={entry.item.path}>
                        <a
                          href={entry.item.path}
                          aria-current={
                            !group.personal && entry.item.path === activePath ? "page" : undefined
                          }
                          onClick={(event) => onNavigate(event, entry.item.path)}
                        >
                          <Icon name={entry.item.icon} />
                          <span className="nav-label">{entry.item.label}</span>
                          {/* Leerzeichen trennen die Teile des Namens für Screenreader. */}
                          {group.personal && entry.area.id !== area.id && (
                            <>
                              {" "}
                              <span className="side-chip">{entry.area.short}</span>
                            </>
                          )}
                          {count > 0 && " "}
                          {count > 0 && (
                            <span className="nav-count">
                              {count}{" "}
                              <span className="visually-hidden">
                                {entry.item.path === "/" ? "offene Aufgaben" : "offen"}
                              </span>
                            </span>
                          )}
                        </a>
                        {entry.item.path !== "/" && (
                          <PinButton
                            path={entry.item.path}
                            label={entry.item.label}
                            className="side-pin"
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <p className="side-error" role="status">
        {prefs.error}
      </p>
      <button
        type="button"
        className="side-collapse"
        aria-expanded={!hidden}
        aria-controls={id}
        onClick={onCollapse}
      >
        <Icon name="einklappen" />
        <span>Menü einklappen</span>
      </button>
    </nav>
  );
}
