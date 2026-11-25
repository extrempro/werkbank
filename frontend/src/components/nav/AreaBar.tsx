import type { MouseEvent } from "react";
import type { BarSection, NavArea } from "../../navigation";
import { Icon } from "../Icon";

interface AreaBarProps {
  areas: readonly NavArea[];
  currentId: string | undefined;
  /** Bereiche mit offenen Aufgaben bekommen einen Punkt. */
  hasOpen: (area: NavArea) => boolean;
  /** Seitenmenü eingeklappt: unten erscheint „Menü ausklappen“. */
  collapsed: boolean;
  sideMenuId: string;
  onArea: (event: MouseEvent<HTMLAnchorElement>, area: NavArea) => void;
  onExpand: () => void;
}

const TOP: BarSection[] = ["start", "anwendungen", "betrieb", "planung", "werkzeuge"];

/**
 * Schmale Leiste ganz links: ein Symbol mit Kurznamen je Bereich, Gruppen durch Linien getrennt.
 * Handbuch und Verwaltung stehen im Kontomenü oben rechts, nicht hier.
 */
export function AreaBar({
  areas,
  currentId,
  hasOpen,
  collapsed,
  sideMenuId,
  onArea,
  onExpand,
}: AreaBarProps) {
  const link = (area: NavArea) => {
    const dot = area.id !== currentId && hasOpen(area);
    return (
      <li key={area.id}>
        <a
          className="area-link"
          href={area.home}
          title={area.label}
          aria-current={area.id === currentId ? "true" : undefined}
          onClick={(event) => onArea(event, area)}
        >
          <Icon name={area.icon} />
          {/* Sichtbar der Kurzname, für Screenreader der volle Name */}
          <span className="area-short" aria-hidden="true">
            {area.short}
          </span>
          <span className="visually-hidden">
            {dot ? `${area.label}, offene Aufgaben` : area.label}
          </span>
          {dot && <span className="area-dot" aria-hidden="true" />}
        </a>
      </li>
    );
  };
  const sections = TOP.map((section) => areas.filter((area) => area.section === section)).filter(
    (list) => list.length > 0,
  );
  return (
    <nav className="area-bar" aria-label="Bereiche">
      <div className="area-top">
        {sections.map((list) => (
          <ul className="area-section" key={list[0]?.id}>
            {list.map(link)}
          </ul>
        ))}
      </div>
      <ul className="area-section area-bottom">
        {collapsed && (
          <li>
            <button
              type="button"
              className="area-link"
              title="Menü ausklappen"
              aria-expanded={false}
              aria-controls={sideMenuId}
              onClick={onExpand}
            >
              <Icon name="ausklappen" />
              <span className="visually-hidden">Menü ausklappen</span>
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}
