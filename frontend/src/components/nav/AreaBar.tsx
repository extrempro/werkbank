import type { MouseEvent } from "react";
import { HANDBOOK_PATH } from "../../handbook";
import type { BarSection, NavArea } from "../../navigation";
import { Icon } from "../Icon";

interface AreaBarProps {
  areas: readonly NavArea[];
  currentId: string | undefined;
  /** Bereiche mit offenen Aufgaben bekommen einen Punkt. */
  hasOpen: (area: NavArea) => boolean;
  handbookOpen: boolean;
  /** Seitenmenü eingeklappt: unten erscheint „Menü ausklappen“. */
  collapsed: boolean;
  sideMenuId: string;
  onArea: (event: MouseEvent<HTMLAnchorElement>, area: NavArea) => void;
  onHandbook: (event: MouseEvent<HTMLAnchorElement>) => void;
  onExpand: () => void;
}

const TOP: BarSection[] = ["start", "anwendungen", "betrieb", "planung", "werkzeuge"];

/** Schmale Leiste ganz links: ein Symbol mit Kurznamen je Bereich, Gruppen durch Linien getrennt. */
export function AreaBar({
  areas,
  currentId,
  hasOpen,
  handbookOpen,
  collapsed,
  sideMenuId,
  onArea,
  onHandbook,
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
          aria-label={dot ? `${area.label}, offene Aufgaben` : area.label}
          aria-current={area.id === currentId ? "true" : undefined}
          onClick={(event) => onArea(event, area)}
        >
          <Icon name={area.icon} />
          <span className="area-short" aria-hidden="true">
            {area.short}
          </span>
          {dot && <span className="area-dot" aria-hidden="true" />}
        </a>
      </li>
    );
  };
  const sections = TOP.map((section) => areas.filter((area) => area.section === section)).filter(
    (list) => list.length > 0,
  );
  const bottom = areas.filter((area) => area.section === "unten");
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
        {bottom.map(link)}
        <li>
          <a
            className="area-link"
            href={HANDBOOK_PATH}
            title="Handbuch"
            aria-label="Handbuch"
            aria-current={handbookOpen ? "page" : undefined}
            onClick={onHandbook}
          >
            <Icon name="handbuch" />
            <span className="area-short" aria-hidden="true">
              Handbuch
            </span>
          </a>
        </li>
        {collapsed && (
          <li>
            <button
              type="button"
              className="area-link"
              title="Menü ausklappen"
              aria-label="Menü ausklappen"
              aria-expanded={false}
              aria-controls={sideMenuId}
              onClick={onExpand}
            >
              <Icon name="ausklappen" />
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}
