import { useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { searchPages, type NavArea, type NavEntry } from "../../navigation";
import { RECENT_SHOWN, useNavPrefs } from "../../navPrefs";
import { searchUrl, SEARCH_PATH } from "../../pages/SearchPage";
import { Icon } from "../Icon";
import { entriesFor } from "./menuGroups";
import { useModal } from "./useModal";

interface QuickSearchProps {
  areas: readonly NavArea[];
  onClose: () => void;
  onNavigate: (path: string) => void;
}

/**
 * Schnellsuche (Strg+K / ⌘K): findet Seiten nach Name, Gruppe und Bereich, nur mit Recht.
 * Ohne Eingabe stehen die zuletzt besuchten Seiten da. Enter öffnet den markierten Treffer.
 * Wird nur gezeigt, solange sie offen ist.
 */
export function QuickSearch({ areas, onClose, onNavigate }: QuickSearchProps) {
  const prefs = useNavPrefs();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const listId = useId();
  const headId = useId();
  useModal(dialog, true, onClose, input);

  const trimmed = query.trim();
  const hits: NavEntry[] =
    trimmed === ""
      ? entriesFor(areas, prefs.recent).slice(0, RECENT_SHOWN)
      : searchPages(areas, trimmed);
  const selected = Math.min(active, Math.max(hits.length - 1, 0));
  const optionId = (index: number) => `${listId}-${index}`;
  const allUrl = trimmed.length >= 2 ? searchUrl(trimmed) : SEARCH_PATH;

  const open = (path: string) => {
    onClose();
    // Erst schließen (der Fokus kehrt zurück), dann die Seite öffnen (der Fokus geht zum Inhalt).
    window.setTimeout(() => onNavigate(path), 0);
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && hits.length > 0) {
      event.preventDefault();
      setActive((selected + 1) % hits.length);
    } else if (event.key === "ArrowUp" && hits.length > 0) {
      event.preventDefault();
      setActive((selected - 1 + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const hit = hits[selected];
      if (hit) {
        open(hit.item.path);
      } else if (trimmed.length >= 2) {
        open(allUrl);
      }
    }
  };
  const onBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="qs-backdrop" onMouseDown={onBackdrop}>
      <div ref={dialog} className="qs" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="visually-hidden">
          Schnellsuche
        </h2>
        <div className="qs-field">
          <Icon name="suche" />
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-label="Seite suchen"
            aria-autocomplete="list"
            aria-expanded={hits.length > 0}
            aria-controls={listId}
            aria-activedescendant={hits.length > 0 ? optionId(selected) : undefined}
            autoComplete="off"
            maxLength={100}
            placeholder="Seite suchen …"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
          />
          <button type="button" className="button button-quiet qs-cancel" onClick={onClose}>
            Abbrechen
          </button>
        </div>
        <p className="qs-heading" id={headId}>
          {trimmed === "" ? "Zuletzt besucht" : "Seiten"}
        </p>
        <ul className="qs-list" role="listbox" id={listId} aria-labelledby={headId}>
          {hits.map((hit, index) => (
            <li
              key={hit.item.path}
              id={optionId(index)}
              role="option"
              aria-selected={index === selected}
              onMouseEnter={() => setActive(index)}
              onClick={() => open(hit.item.path)}
            >
              <Icon name={hit.item.icon} />
              <span className="qs-text">
                <span className="qs-label">{hit.item.label}</span>
                <span className="qs-meta">
                  {hit.group ? `${hit.group} · ${hit.area.label}` : hit.area.label}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {hits.length === 0 && (
          <p className="qs-empty">
            {trimmed === "" ? "Noch keine Seiten besucht." : "Keine Seite gefunden."}
          </p>
        )}
        <p className="visually-hidden" role="status">
          {trimmed === ""
            ? ""
            : `${hits.length} ${hits.length === 1 ? "Seite" : "Seiten"} gefunden`}
        </p>
        <a
          className="qs-all"
          href={allUrl}
          onClick={(event) => {
            event.preventDefault();
            open(allUrl);
          }}
        >
          <Icon name="suche" />
          In allen Einträgen suchen
          {trimmed.length >= 2 && <span className="qs-query"> nach „{trimmed}“</span>}
        </a>
      </div>
    </div>
  );
}
