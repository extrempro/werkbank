import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { errorText } from "../../api";
import { lookup, type LookupItem, type LookupKind, type LookupResult } from "./api";
import { useDebounced } from "./paged";

interface LookupPickerProps {
  /** Art der Suche im IT-Bestand; alternativ eine eigene Suche über `search`. */
  kind?: LookupKind;
  /** Eigene Suche (z. B. Einstellungen der M365-Konfiguration in Evergreen). */
  search?: (query: string) => Promise<LookupResult>;
  label: string;
  value: LookupItem | null;
  onChange: (item: LookupItem | null) => void;
  placeholder?: string;
  /** nur Notebooks und PCs (Vorgang „Gleiches Gerät“) */
  computers?: boolean;
  /** Pflichtfeld: Hinweis am Label */
  required?: boolean;
  /** Treffer, die nicht angeboten werden (z. B. schon gewählte Stellen) */
  exclude?: readonly number[];
  /** Fehlermeldung vom Formular */
  error?: string | null;
}

/**
 * Auswahl mit Suche: Der Server sucht nach Nummer, Name, Person, Raum, Hostname oder
 * Seriennummer und liefert höchstens 20 Treffer. Pfeiltasten wählen, Enter übernimmt,
 * Escape schließt die Liste. Gewählt steht der Eintrag mit „Ändern“ da.
 */
export function LookupPicker({
  kind = "position",
  search,
  label,
  value,
  onChange,
  placeholder,
  computers = false,
  required = false,
  exclude = [],
  error = null,
}: LookupPickerProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [result, setResult] = useState<{ items: LookupItem[]; total: number } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const debounced = useDebounced(query);
  const inputId = useId();
  const listId = useId();
  const errorId = useId();

  useEffect(() => {
    if (!open || value) {
      return;
    }
    let current = true;
    (search ? search(debounced) : lookup(kind, debounced, { computers })).then(
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
  }, [kind, search, debounced, computers, open, value]);

  const items = (result?.items ?? []).filter((item) => !exclude.includes(item.id));
  const selected = Math.min(active, Math.max(items.length - 1, 0));
  const optionId = (index: number) => `${listId}-${index}`;

  const choose = (item: LookupItem) => {
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
    }
  };

  const labelText = required ? `${label} (Pflicht)` : label;
  if (value) {
    return (
      <div className="lookup">
        <span className="lookup-label">{labelText}</span>
        <div className="lookup-chosen">
          <span className="lookup-text">
            <strong>{value.label}</strong>
            {value.detail && <span className="small">{value.detail}</span>}
          </span>
          <button
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
        {error && (
          <p id={errorId} role="alert" className="field-error">
            {error}
          </p>
        )}
      </div>
    );
  }
  const expanded = open && items.length > 0;
  return (
    <div className="lookup">
      <label htmlFor={inputId} className="lookup-label">
        {labelText}
      </label>
      <input
        id={inputId}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded ? optionId(selected) : undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        autoComplete="off"
        maxLength={100}
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
      />
      <ul id={listId} role="listbox" aria-label={label} className="lookup-list" hidden={!expanded}>
        {items.map((item, index) => (
          <li
            key={item.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === selected}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(item)}
          >
            <strong>{item.label}</strong>
            {item.detail && <span className="small">{item.detail}</span>}
          </li>
        ))}
      </ul>
      {open && result && (
        <p className="small lookup-status" role="status">
          {items.length === 0
            ? "Keine Treffer."
            : result.total > result.items.length
              ? `${result.items.length} von ${result.total} Treffern – grenze die Suche weiter ein.`
              : `${items.length} Treffer`}
        </p>
      )}
      {failed && (
        <p role="alert" className="hint-box hint-bad">
          {failed}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
