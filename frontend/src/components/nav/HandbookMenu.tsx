import { useId, useState, type MouseEvent } from "react";
import { areasFor, HANDBOOK_PATH, searchHandbook, topicPath } from "../../handbook";
import { Icon } from "../Icon";

/** Gemerkter Zustand der Bereiche im Handbuch-Menü (auf/zu) in diesem Browser. */
export const HANDBOOK_GROUPS_KEY = "werkbank-handbuch-gruppen";

function readGroups(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(HANDBOOK_GROUPS_KEY) ?? "{}");
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
    window.localStorage.setItem(HANDBOOK_GROUPS_KEY, JSON.stringify(groups));
  } catch {
    // Speicher gesperrt: Der Zustand gilt dann nur bis zum Neuladen.
  }
}

interface HandbookMenuProps {
  roles: readonly string[];
  /** Geöffneter Bereich und geöffnetes Thema (für Hervorhebung und offene Gruppe). */
  areaId: string | null;
  topicId: string | null;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void;
}

/**
 * Inhalt des Handbuch-Menüs: Suche, „Übersicht“ und die Bereiche wie in der Bereichsleiste,
 * jeweils zum Auf- und Zuklappen, darin die Teile mit Überschrift und die Themen. Steht im
 * Seitenmenü und am Handy im Blatt „Alle Themen“.
 */
export function HandbookMenuContent({ roles, areaId, topicId, onNavigate }: HandbookMenuProps) {
  const [stored, setStored] = useState(readGroups);
  const [query, setQuery] = useState("");
  const baseId = useId();
  const areas = areasFor(roles);
  const term = query.trim();
  const hits = term.length >= 2 ? searchHandbook(term, roles, 20) : null;

  const isOpen = (id: string) => stored[id] ?? id === areaId;
  const toggle = (id: string) => {
    const next = { ...stored, [id]: !isOpen(id) };
    setStored(next);
    saveGroups(next);
  };
  const link = (path: string, label: string, current: boolean) => (
    <a
      href={path}
      aria-current={current ? "page" : undefined}
      onClick={(event) => onNavigate(event, path)}
    >
      <span className="nav-label">{label}</span>
    </a>
  );

  return (
    <>
      <div className="handbook-menu-search">
        <label htmlFor={`${baseId}-suche`}>Im Handbuch suchen</label>
        <input
          id={`${baseId}-suche`}
          type="search"
          value={query}
          maxLength={100}
          autoComplete="off"
          placeholder="z. B. Soll-Wert"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="side-groups">
        {hits ? (
          <div className="side-group">
            <p className="side-subhead" role="status">
              {hits.length === 0 ? "Keine Treffer" : `${hits.length} Treffer`}
            </p>
            <ul>
              {hits.map((hit) => (
                <li className="side-item" key={`${hit.area.id}/${hit.topic.id}`}>
                  {link(
                    topicPath(hit.area.id, hit.topic.id),
                    `${hit.topic.title} · ${hit.area.title}`,
                    hit.area.id === areaId && hit.topic.id === topicId,
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <>
            <ul className="handbook-menu-home">
              <li className="side-item">{link(HANDBOOK_PATH, "Übersicht", areaId === null)}</li>
            </ul>
            {areas.map((area) => {
              const open = isOpen(area.id);
              const listId = `${baseId}-${area.id}`;
              const count = area.parts.reduce((sum, part) => sum + part.topics.length, 0);
              return (
                <div className="side-group handbook-area" key={area.id}>
                  <button
                    type="button"
                    className="side-group-toggle handbook-area-toggle"
                    aria-expanded={open}
                    aria-controls={listId}
                    onClick={() => toggle(area.id)}
                  >
                    <Icon name="pfeil-unten" />
                    <span className="handbook-area-title">{area.title}</span>
                    <span className="handbook-area-count" aria-hidden="true">
                      {count}
                    </span>
                  </button>
                  <div id={listId} hidden={!open}>
                    {area.parts.map((part, index) => (
                      <div key={part.title ?? index}>
                        {part.title && <p className="side-subhead">{part.title}</p>}
                        <ul aria-label={part.title ? `${area.title}: ${part.title}` : area.title}>
                          {part.topics.map((topic) => (
                            <li className="side-item" key={topic.id}>
                              {link(
                                topicPath(area.id, topic.id),
                                topic.title,
                                area.id === areaId && topic.id === topicId,
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}

/** Seitenmenü des Handbuchs (statt des Menüs eines Bereichs). */
export function HandbookMenu({
  id,
  hidden,
  onCollapse,
  ...props
}: HandbookMenuProps & { id: string; hidden: boolean; onCollapse: () => void }) {
  return (
    <nav id={id} className="side-menu handbook-menu" aria-label="Seiten: Handbuch" hidden={hidden}>
      <p className="side-title">Handbuch</p>
      <HandbookMenuContent {...props} />
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
