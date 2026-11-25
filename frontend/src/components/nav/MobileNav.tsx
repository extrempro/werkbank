import { useCallback, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { NavArea } from "../../navigation";
import { useNavPrefs } from "../../navPrefs";
import { Icon } from "../Icon";
import { menuGroups } from "./menuGroups";
import { useModal } from "./useModal";

interface MobileNavProps {
  areas: readonly NavArea[];
  current: NavArea | undefined;
  activePath: string | undefined;
  taskCount: number;
  searchOpen: boolean;
  hasOpen: (area: NavArea) => boolean;
  badgeFor: (path: string) => number;
  onNavigate: (path: string) => void;
  onSearch: () => void;
  onTasks: () => void;
  /** Zusätzlicher Inhalt im Menü-Blatt eines Bereichs, z. B. die Ticket-Leiste. */
  extraFor?: (
    area: NavArea,
    onNavigate: (event: MouseEvent<HTMLAnchorElement>, path: string) => void,
  ) => ReactNode;
}

/**
 * Handy: feste Leiste unten (Start, Suche, Aufgaben, Menü). „Menü“ öffnet ein Blatt von unten:
 * erst die Seiten des aktuellen Bereichs, über „Alle Bereiche“ jeden anderen.
 */
export function MobileNav({
  areas,
  current,
  activePath,
  taskCount,
  searchOpen,
  hasOpen,
  badgeFor,
  onNavigate,
  onSearch,
  onTasks,
  extraFor,
}: MobileNavProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const sheetId = useId();
  const titleId = useId();
  const onStart = activePath === "/";

  const go = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    event.preventDefault();
    onNavigate(path);
  };

  return (
    <>
      <nav className="mobile-bar" aria-label="Schnellzugriff">
        <a
          href="/"
          className="mobile-bar-item"
          aria-current={onStart ? "page" : undefined}
          onClick={(event) => go(event, "/")}
        >
          <Icon name="start" />
          <span>Start</span>
        </a>
        <button
          type="button"
          className="mobile-bar-item"
          aria-haspopup="dialog"
          aria-expanded={searchOpen}
          onClick={onSearch}
        >
          <Icon name="suche" />
          <span>Suche</span>
        </button>
        <a
          href="/"
          className="mobile-bar-item"
          onClick={(event) => {
            event.preventDefault();
            onTasks();
          }}
        >
          <Icon name="aufgaben" />
          <span>Aufgaben</span>
          {taskCount > 0 && " "}
          {taskCount > 0 && (
            <span className="mobile-bar-count">
              {taskCount > 99 ? "99+" : taskCount} <span className="visually-hidden">offen</span>
            </span>
          )}
        </a>
        <button
          type="button"
          className="mobile-bar-item"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          aria-controls={sheetOpen ? sheetId : undefined}
          onClick={() => setSheetOpen(true)}
        >
          <Icon name="menue" />
          <span>Menü</span>
        </button>
      </nav>
      {sheetOpen && (
        <MenuSheet
          id={sheetId}
          titleId={titleId}
          areas={areas}
          current={current}
          activePath={activePath}
          hasOpen={hasOpen}
          badgeFor={badgeFor}
          onClose={closeSheet}
          onNavigate={onNavigate}
          extraFor={extraFor}
        />
      )}
    </>
  );
}

interface MenuSheetProps {
  id: string;
  titleId: string;
  areas: readonly NavArea[];
  current: NavArea | undefined;
  activePath: string | undefined;
  hasOpen: (area: NavArea) => boolean;
  badgeFor: (path: string) => number;
  onClose: () => void;
  onNavigate: (path: string) => void;
  extraFor?: MobileNavProps["extraFor"];
}

function MenuSheet({
  id,
  titleId,
  areas,
  current,
  activePath,
  hasOpen,
  badgeFor,
  onClose,
  onNavigate,
  extraFor,
}: MenuSheetProps) {
  const prefs = useNavPrefs();
  // null: Liste aller Bereiche; sonst die Seiten dieses Bereichs
  const [shown, setShown] = useState<NavArea | null>(current ?? null);
  const sheet = useRef<HTMLDivElement>(null);
  useModal(sheet, true, onClose);

  const go = (event: MouseEvent<HTMLAnchorElement>, path: string) => {
    event.preventDefault();
    onClose();
    window.setTimeout(() => onNavigate(path), 0);
  };
  const show = (area: NavArea | null) => {
    setShown(area);
    // Nach dem Wechsel steht der Fokus wieder oben im Blatt.
    window.setTimeout(() => sheet.current?.querySelector<HTMLElement>(".sheet-focus")?.focus(), 0);
  };

  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={sheet}
        id={id}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sheet-head">
          {shown ? (
            <button type="button" className="sheet-back" onClick={() => show(null)}>
              <Icon name="zurueck" />
              Alle Bereiche
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="sheet-close"
            aria-label="Menü schließen"
            onClick={onClose}
          >
            <Icon name="schliessen" />
          </button>
        </div>
        <h2 id={titleId} className="sheet-title sheet-focus" tabIndex={-1}>
          {shown ? shown.label : "Alle Bereiche"}
        </h2>
        <div className="sheet-body">
          {shown
            ? menuGroups(shown, areas, prefs).map((group, index) => (
                <div className="sheet-group" key={group.key}>
                  {group.title && <p className="sheet-group-title">{group.title}</p>}
                  {group.personal && group.entries.length === 0 ? (
                    <p className="side-hint">
                      Noch nichts angeheftet. Am Computer heftest du Seiten mit dem Stern an.
                    </p>
                  ) : (
                    <ul aria-label={group.title ?? (index === 0 ? shown.label : undefined)}>
                      {group.entries.map((entry) => {
                        const pinned = prefs.pinned.includes(entry.item.path);
                        const count = group.personal ? 0 : badgeFor(entry.item.path);
                        return (
                          <li key={entry.item.path}>
                            <a
                              href={entry.item.path}
                              aria-current={
                                !group.personal && entry.item.path === activePath
                                  ? "page"
                                  : undefined
                              }
                              onClick={(event) => go(event, entry.item.path)}
                            >
                              <Icon name={entry.item.icon} />
                              <span className="nav-label">{entry.item.label}</span>
                              {group.personal && entry.area.id !== shown.id && (
                                <>
                                  {" "}
                                  <span className="side-chip">{entry.area.short}</span>
                                </>
                              )}
                              {pinned && !group.personal && (
                                <>
                                  {" "}
                                  <span className="sheet-pinned">
                                    <Icon name="stern" filled />
                                    <span className="visually-hidden">angeheftet</span>
                                  </span>
                                </>
                              )}
                              {count > 0 && " "}
                              {count > 0 && (
                                <span className="nav-count">
                                  {count} <span className="visually-hidden">offen</span>
                                </span>
                              )}
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ))
            : null}
          {shown && extraFor?.(shown, go)}
          {shown ? null : (
            <ul className="sheet-areas">
              {/* Handbuch und Verwaltung stehen im Kontomenü oben rechts */}
              {areas
                .filter((area) => area.section !== "unten")
                .map((area) => (
                  <li key={area.id}>
                    <button
                      type="button"
                      className={
                        area.id === current?.id ? "sheet-area sheet-area-current" : "sheet-area"
                      }
                      aria-current={area.id === current?.id ? "true" : undefined}
                      onClick={() => show(area)}
                    >
                      <Icon name={area.icon} />
                      <span className="nav-label">{area.label}</span>
                      {hasOpen(area) && (
                        <span className="area-dot">
                          <span className="visually-hidden">, offene Aufgaben</span>
                        </span>
                      )}
                      <Icon name="pfeil-rechts" />
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
