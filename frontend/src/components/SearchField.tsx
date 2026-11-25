import { useId, useRef, useState, type KeyboardEvent } from "react";
import { navigate } from "../router";
import { useFloating } from "./floating";

/** Höchstens so viele Treffer stehen im schwebenden Fenster */
export const SEARCH_HITS = 5;

export interface SearchHit {
  key: string | number;
  title: string;
  /** eine Zeile Zusatz, z. B. Art und Ort */
  extra?: string;
  /** Nummer o. Ä. rechts, in Festbreitenschrift */
  meta?: string;
  /** Pfad in der Werkbank; ein Klick oder Enter öffnet ihn */
  href?: string;
  /** Statt eines Pfads: öffnet den Eintrag auf derselben Seite (z. B. Ansicht rechts) */
  onOpen?: () => void;
}

export interface SearchFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Treffer zur aktuellen Eingabe (die Seite filtert, die Komponente zeigt die ersten fünf) */
  hits?: readonly SearchHit[];
  /** Zahl aller Treffer in der Liste */
  total?: number;
  /** Kein schwebendes Fenster, nur Filtern der Liste (z. B. Seiten ohne eigene Detailseite) */
  noPanel?: boolean;
  id?: string;
}

/**
 * Suchfeld über einer Liste (docs/design.md, „Masken und Suche“): sucht beim Tippen, ab dem
 * ersten Zeichen mit schwebendem Fenster der besten Treffer. Klick oder Enter öffnet einen
 * Treffer, ↑↓ wählt, Esc schließt; „Alle n in der Liste“ schließt das Fenster, die Liste
 * darunter ist schon gefiltert. „✕“ leert die Suche.
 */
export function SearchField({
  label = "Suchen",
  value,
  onChange,
  placeholder,
  hits = [],
  total,
  noPanel = false,
  id,
}: SearchFieldProps) {
  const ownId = useId();
  const inputId = id ?? ownId;
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const anchor = useRef<HTMLDivElement>(null);
  const shown = hits.slice(0, SEARCH_HITS);
  const panel = !noPanel && open && value.trim().length > 0;
  const floating = useFloating(anchor, panel);
  const selected = Math.min(active, Math.max(shown.length - 1, 0));
  const count = total ?? hits.length;

  const go = (hit: SearchHit) => {
    setOpen(false);
    if (hit.onOpen) {
      hit.onOpen();
    } else if (hit.href) {
      navigate(hit.href);
    }
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (panel) {
        event.preventDefault();
        setOpen(false);
      }
    } else if (event.key === "ArrowDown" && shown.length) {
      event.preventDefault();
      setOpen(true);
      setActive((selected + 1) % shown.length);
    } else if (event.key === "ArrowUp" && shown.length) {
      event.preventDefault();
      setActive((selected - 1 + shown.length) % shown.length);
    } else if (event.key === "Enter" && panel) {
      event.preventDefault();
      const hit = shown[selected];
      if (hit) {
        go(hit);
      }
    }
  };

  return (
    <div className="field search-field">
      <label htmlFor={inputId} className="field-label">
        {label}
      </label>
      <div className="search-field-input" ref={anchor}>
        <svg
          className="search-field-icon"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
        <input
          id={inputId}
          className="field-control"
          type="search"
          role={noPanel ? undefined : "combobox"}
          aria-autocomplete={noPanel ? undefined : "list"}
          aria-expanded={noPanel ? undefined : panel}
          aria-controls={noPanel ? undefined : listId}
          aria-activedescendant={panel && shown.length ? `${listId}-${selected}` : undefined}
          autoComplete="off"
          maxLength={200}
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
        />
        {value && (
          <button
            type="button"
            className="search-field-clear"
            aria-label="Suche leeren"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
          >
            ✕
          </button>
        )}
      </div>
      {!noPanel && (
        <div
          className="floating search-panel"
          style={floating}
          onMouseDown={(event) => event.preventDefault()}
        >
          {shown.length > 0 ? (
            <ul id={listId} role="listbox" aria-label="Treffer" className="floating-list">
              {shown.map((hit, index) => (
                <li
                  key={hit.key}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === selected}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => go(hit)}
                >
                  <span className="search-hit-text">
                    <span className="floating-main">{hit.title}</span>
                    {hit.extra && <span className="small">{hit.extra}</span>}
                  </span>
                  {hit.meta && <span className="small mono">{hit.meta}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="floating-status" role="status">
              Nichts gefunden für „{value.trim()}“.
            </p>
          )}
          <div className="search-panel-foot small">
            <span className="search-panel-keys">↑↓ wählen · Enter öffnen · Esc schließen</span>
            <button type="button" className="button-link" onClick={() => setOpen(false)}>
              {count > SEARCH_HITS ? `Alle ${count} in der Liste` : "In der Liste zeigen"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
