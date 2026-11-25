import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { SearchField, type SearchHit } from "./SearchField";
import { useModal } from "./nav/useModal";

/** Ab dieser Breite abwärts gilt die Handy-Darstellung (wie Leiste unten und Menü-Blatt). */
export const PHONE_QUERY = "(max-width: 760px)";

/** Ob die Media-Query zutrifft; ohne `matchMedia` (z. B. in Tests) nie. */
export function useMediaQuery(query: string): boolean {
  const read = () => typeof window.matchMedia === "function" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export interface StatusOption<T extends string> {
  value: T;
  label: string;
  /** Anzahl der Einträge; erscheint hinter dem Namen. */
  count?: number | null;
}

interface FilterBarProps<T extends string> {
  /** Suchfeld; ohne Angabe keins. */
  search?: {
    label: string;
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
    /** Treffer für das schwebende Fenster (höchstens fünf werden gezeigt); ohne: kein Fenster */
    hits?: readonly SearchHit[];
    /** Zahl aller Treffer in der Liste */
    total?: number;
  };
  /** Status: am Computer als Chips, am Handy als Auswahl (siehe `statusSelect`). */
  status?: {
    label: string;
    value: T;
    options: StatusOption<T>[];
    onChange: (value: T) => void;
  };
  /** Weitere Filter (beschriftete Felder): am Computer in der Zeile, am Handy in einem Blatt. */
  more?: ReactNode;
  /** Titel des Blatts, z. B. „Weitere Filter und Sortierung“. */
  moreTitle?: string;
  /** So viele weitere Filter weichen von der Vorgabe ab; erscheint am Knopf. */
  moreActive?: number;
  /** Etwas ist gefiltert: zeigt „Filter aufheben“ bzw. „Zurücksetzen“. */
  onReset?: () => void;
  /** Zusätzliches am Ende der Zeile, z. B. ein Verweis. */
  extra?: ReactNode;
  /** Ohne eigene Fläche, z. B. oben in einer Liste, die schon eine hat. */
  plain?: boolean;
  /** Status immer als Auswahl unter der Suche, z. B. in einer Liste mit fester Breite, in der
   *  Chips nicht in eine Zeile passen (design.md, „Filter-Chips nie seitlich scrollen“). */
  statusSelect?: boolean;
}

function optionText(option: StatusOption<string>): string {
  return option.count === undefined || option.count === null
    ? option.label
    : `${option.label} · ${option.count}`;
}

/** Blatt von unten mit den weiteren Filtern (nur am Handy). */
function FilterSheet({
  title,
  children,
  onReset,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onReset?: () => void;
  onClose: () => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModal(sheet, true, onClose);
  return (
    <div
      className="sheet-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={sheet}
        className="sheet filter-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="sheet-head">
          <h2 id={titleId} className="sheet-title">
            {title}
          </h2>
          <button type="button" className="sheet-close" aria-label="Schließen" onClick={onClose}>
            <Icon name="schliessen" />
          </button>
        </div>
        <div className="sheet-body filter-sheet-body">{children}</div>
        <div className="filter-sheet-foot">
          {onReset && (
            <button type="button" className="button button-secondary" onClick={onReset}>
              Zurücksetzen
            </button>
          )}
          <button type="button" className="button button-primary" onClick={onClose}>
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Suche und Filter über einer Liste. Am Computer und Tablet: Suche und weitere Filter in einer
 * Zeile, darunter der Status als Chips. Am Handy: Suche über die ganze Breite, darunter der
 * Status als Auswahl und „Weitere Filter“, die in einem Blatt von unten öffnen.
 */
export function FilterBar<T extends string>({
  search,
  status,
  more,
  moreTitle = "Weitere Filter",
  moreActive = 0,
  onReset,
  extra,
  plain = false,
  statusSelect = false,
}: FilterBarProps<T>) {
  const phone = useMediaQuery(PHONE_QUERY);
  const asSelect = phone || statusSelect;
  const [sheetOpen, setSheetOpen] = useState(false);
  const searchId = useId();
  const statusId = useId();
  const sheetShown = phone && sheetOpen && more !== undefined;
  return (
    <div
      className={[
        plain ? "filter-bar filter-bar-plain" : "panel filter-bar",
        phone ? "filter-bar-phone" : "",
        statusSelect ? "filter-bar-stack" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="filter-row">
        {search && (
          <div className="filter-search">
            <SearchField
              id={searchId}
              label={search.label}
              value={search.value}
              placeholder={search.placeholder}
              onChange={search.onChange}
              hits={search.hits}
              total={search.total}
              noPanel={!search.hits}
            />
          </div>
        )}
        {asSelect && status && (
          <div className="filter-status">
            <label htmlFor={statusId}>{status.label}</label>
            <select
              id={statusId}
              value={status.value}
              onChange={(event) => status.onChange(event.target.value as T)}
            >
              {status.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {optionText(option)}
                </option>
              ))}
            </select>
          </div>
        )}
        {phone && more !== undefined && (
          <button
            type="button"
            className="button button-secondary filter-more-button"
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            onClick={() => setSheetOpen(true)}
          >
            <Icon name="einstellungen" />
            Weitere Filter
            {moreActive > 0 && " "}
            {moreActive > 0 && (
              <span className="filter-count" aria-label={`${moreActive} geändert`}>
                {moreActive}
              </span>
            )}
          </button>
        )}
        {!phone && more}
        {!phone && onReset && (
          <button type="button" className="button button-secondary filter-reset" onClick={onReset}>
            Filter aufheben
          </button>
        )}
        {extra}
      </div>
      {!asSelect && status && (
        <div className="chips filter-chips" role="group" aria-label={status.label}>
          {status.options.map((option) => (
            <button
              key={option.value}
              type="button"
              className="chip chip-filter"
              aria-pressed={status.value === option.value}
              onClick={() => status.onChange(option.value)}
            >
              {optionText(option)}
            </button>
          ))}
        </div>
      )}
      {sheetShown && (
        <FilterSheet title={moreTitle} onReset={onReset} onClose={() => setSheetOpen(false)}>
          {more}
        </FilterSheet>
      )}
    </div>
  );
}
