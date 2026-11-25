import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { errorText } from "../api";
import { useFloating } from "./floating";

export interface ComboItem {
  id: number | string;
  label: string;
  /** eine Zeile Zusatz, z. B. Hersteller oder Gebäude und Etage */
  detail: string;
}

export interface ComboResult<T extends ComboItem = ComboItem> {
  items: T[];
  /** Zahl aller Treffer (kann größer sein als `items`) */
  total: number;
}

/** Wartet kurz nach der letzten Eingabe, bevor gesucht wird. */
function useSettled<T>(value: T, delay = 200): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

export interface ComboFieldProps<T extends ComboItem> {
  label: string;
  value: T | null;
  onChange: (item: T | null) => void;
  /** Suche (auf dem Server oder in einer geladenen Liste); leerer Text: die ersten Einträge */
  search: (query: string) => Promise<ComboResult<T>>;
  placeholder?: string;
  /** Mehrzahl für die Zählzeile ohne Eingabe, z. B. „Räume“ → „31 Räume · tippe zum Eingrenzen“ */
  unit?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  /** Treffer, die nicht angeboten werden (z. B. schon gewählte) */
  exclude?: readonly (number | string)[];
  /** Kennung des Eingabefelds, z. B. für die Links der Fehlerübersicht */
  id?: string;
  /** Gesucht wird erst ab so vielen Zeichen (z. B. 2 für die Suche in Entra); 0: schon leer */
  minLength?: number;
  /** Text ohne Treffer, z. B. mit dem Hinweis, dass nur Sichtbares gefunden wird */
  nothingFound?: (query: string) => string;
  /** Fokus beim Erscheinen (z. B. in einem kleinen Fenster nur mit diesem Feld) */
  autoFocus?: boolean;
  /** Esc bei geschlossenem Fenster, z. B. um ein umgebendes Fenster zu schließen */
  onEscape?: () => void;
}

/**
 * Auswahl mit Echtzeitsuche (docs/design.md, „Masken und Suche“): Schon beim Antippen öffnet
 * ein schwebendes Fenster über dem Inhalt; jedes Zeichen grenzt ein. ↑↓ wählt, Enter
 * übernimmt, Esc schließt; das Fenster schließt auch, sobald der Fokus das Feld verlässt.
 * Gewählt steht der Eintrag mit „Ändern“ da.
 */
export function ComboField<T extends ComboItem>({
  label,
  value,
  onChange,
  search,
  placeholder,
  unit,
  required = false,
  hint,
  error = null,
  exclude = [],
  id,
  minLength = 0,
  nothingFound,
  autoFocus = false,
  onEscape,
}: ComboFieldProps<T>) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [result, setResult] = useState<ComboResult<T> | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const settled = useSettled(query);
  const ownId = useId();
  const inputId = id ?? ownId;
  const listId = useId();
  const hintId = useId();
  const anchor = useRef<HTMLDivElement>(null);

  const tooShort = settled.trim().length < minLength;
  useEffect(() => {
    if (!open || value || tooShort) {
      return;
    }
    let current = true;
    search(settled).then(
      (next) => {
        if (current) {
          setResult(next);
          setFailed(null);
        }
      },
      (problem: unknown) =>
        current && setFailed(errorText(problem, "Die Suche hat nicht geklappt.")),
    );
    return () => {
      current = false;
    };
  }, [search, settled, open, value, tooShort]);

  const items = tooShort ? [] : (result?.items ?? []).filter((item) => !exclude.includes(item.id));
  const selected = Math.min(active, Math.max(items.length - 1, 0));
  const optionId = (index: number) => `${listId}-${index}`;
  const floating = useFloating(anchor, open && !value);

  const choose = (item: T) => {
    onChange(item);
    setOpen(false);
    setQuery("");
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive(items.length ? (selected + 1) % items.length : 0);
    } else if (event.key === "ArrowUp" && items.length) {
      event.preventDefault();
      setActive((selected - 1 + items.length) % items.length);
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      const item = items[selected];
      if (item) {
        choose(item);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      onEscape();
    }
  };

  const describedBy = error || hint ? hintId : undefined;
  const marker = required ? (
    <span className="field-required" aria-hidden="true">
      {" "}
      *
    </span>
  ) : null;

  if (value) {
    return (
      <div className="field combo">
        <span className="field-label">
          {label}
          {marker}
        </span>
        <div className="combo-chosen">
          <span className="combo-text">
            <strong>{value.label}</strong>
            {value.detail && <span className="small">{value.detail}</span>}
          </span>
          <button
            id={inputId}
            type="button"
            className="row-button"
            aria-label={`${label} ändern: ${value.label}`}
            onClick={() => {
              onChange(null);
              setOpen(true);
              window.setTimeout(() => document.getElementById(inputId)?.focus(), 0);
            }}
          >
            Ändern
          </button>
        </div>
        {error ? (
          <p id={hintId} role="alert" className="field-error">
            {error}
          </p>
        ) : (
          hint && (
            <p id={hintId} className="field-hint">
              {hint}
            </p>
          )
        )}
      </div>
    );
  }

  const status = tooShort
    ? minLength > 1
      ? `Tippe mindestens ${minLength} Zeichen.`
      : "Tippe zum Suchen."
    : !result || settled !== query
      ? "Wird gesucht …"
      : items.length === 0
        ? (nothingFound?.(query.trim()) ?? `Nichts gefunden für „${query.trim()}“.`)
        : !settled.trim() && unit
          ? `${result.total} ${unit} · tippe zum Eingrenzen`
          : result.total > result.items.length
            ? `${result.items.length} von ${result.total} Treffern – tippe weiter`
            : result.total === 1
              ? "1 Treffer"
              : `${result.total} Treffer`;

  return (
    <div className="field combo">
      <label htmlFor={inputId} className="field-label">
        {label}
        {marker}
      </label>
      <div className="combo-input" ref={anchor}>
        <input
          id={inputId}
          className="field-control"
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && items.length ? optionId(selected) : undefined}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          maxLength={100}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
        />
      </div>
      {/* Schwebend über dem Inhalt; ein Klick hinein (auch auf die Scrollleiste) lässt den
          Fokus im Feld, sonst schlösse sich das Fenster vor der Wahl. */}
      <div
        className="floating combo-panel"
        style={floating}
        onMouseDown={(event) => event.preventDefault()}
      >
        <p className="floating-status small" role="status">
          {status}
        </p>
        <ul id={listId} role="listbox" aria-label={label} className="floating-list">
          {items.map((item, index) => (
            <li
              key={item.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === selected}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(item)}
            >
              <span className="floating-main">{item.label}</span>
              {item.detail && <span className="small">{item.detail}</span>}
            </li>
          ))}
        </ul>
      </div>
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      {error ? (
        <p id={hintId} role="alert" className="field-error">
          {error}
        </p>
      ) : (
        hint && (
          <p id={hintId} className="field-hint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}
