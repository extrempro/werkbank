import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ComboField, type ComboItem, type ComboResult } from "./ComboField";
import { ChoiceCards, Segmented } from "./Field";

/** Bis zu so vielen Möglichkeiten zeigt `ListChoice` Auswahlkarten, darüber ein Suchfeld. */
export const CARDS_MAX = 10;
/** Höchstens so viele Treffer zeigt das Suchfeld über eine geladene Liste. */
const LIST_HITS = 20;

/** Treffer der Suche über eine geladene Liste (Nummer als Kennung) */
export interface ListItem extends ComboItem {
  id: number;
}

export interface ChoiceOption {
  id: number;
  label: string;
  /** eine Zeile Zusatz, z. B. Nummer oder Partner */
  detail?: string;
}

/**
 * Suche über eine schon geladene Liste für `ComboField`: Die Funktion bleibt dieselbe, auch
 * wenn die Liste bei jedem Rendern neu entsteht; sonst sucht die Auswahl in einer Schleife.
 */
export function useListSearch(
  options: readonly ChoiceOption[],
): (query: string) => Promise<ComboResult<ListItem>> {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  return useCallback((query: string) => {
    const needle = query.trim().toLocaleLowerCase("de");
    const hits = latest.current.filter(
      (option) =>
        !needle ||
        `${option.label} ${option.detail ?? ""}`.toLocaleLowerCase("de").includes(needle),
    );
    return Promise.resolve({
      items: hits
        .slice(0, LIST_HITS)
        .map((option) => ({ id: option.id, label: option.label, detail: option.detail ?? "" })),
      total: hits.length,
    });
  }, []);
}

/**
 * Auswahl aus einer Liste, die wachsen kann (docs/design.md, „Masken und Suche“): bis zehn
 * Möglichkeiten als Auswahlkarten, darüber als Feld mit Echtzeitsuche im schwebenden Fenster.
 * Der Wert ist die Nummer als Text, leer ohne Auswahl. Mit `none` gibt es bei den Karten eine
 * Karte für „nichts gewählt“ (z. B. „Kein Projekt“); im Suchfeld leert „Ändern“ die Wahl.
 */
export function ListChoice({
  label,
  options,
  value,
  onChange,
  required = false,
  hint,
  error = null,
  id,
  placeholder,
  unit,
  none,
  compact = false,
}: {
  label: string;
  options: readonly ChoiceOption[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  id?: string;
  placeholder?: string;
  /** Mehrzahl für die Zählzeile im Suchfeld, z. B. „Konten“ */
  unit?: string;
  /** Beschriftung der Karte ohne Auswahl, z. B. „Kein Projekt“ */
  none?: string;
  /** Immer als Suchfeld, z. B. in einem kleinen Fenster an der Schreibmarke */
  compact?: boolean;
}) {
  const search = useListSearch(options);
  if (!compact && options.length <= CARDS_MAX) {
    const cards = options.map((option) => ({
      value: String(option.id),
      label: option.label,
      hint: option.detail,
    }));
    return (
      <ChoiceCards
        legend={label}
        required={required}
        hint={hint}
        error={error}
        id={id}
        value={value || (none ? "" : null)}
        options={none ? [{ value: "", label: none }, ...cards] : cards}
        onChange={onChange}
      />
    );
  }
  const chosen = options.find((option) => String(option.id) === value) ?? null;
  return (
    <div className="field-wide">
      <ComboField<ListItem>
        label={label}
        id={id}
        required={required}
        hint={hint ?? (none ? `Leer lassen: ${none}` : undefined)}
        error={error}
        placeholder={placeholder}
        unit={unit}
        search={search}
        value={chosen ? { id: chosen.id, label: chosen.label, detail: chosen.detail ?? "" } : null}
        onChange={(item) => onChange(item ? String(item.id) : "")}
      />
    </div>
  );
}

/**
 * Auswahl aus festen Möglichkeiten (docs/design.md, „Masken und Suche“): 2–4 als Knopfleiste,
 * 5–10 als Auswahlkarten, darüber als Feld mit Echtzeitsuche. Die Werte sind Texte.
 */
export function FixedChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  wide = false,
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
  wide?: boolean;
  /** Gesperrt: Die Auswahl steht als Text da */
  disabled?: boolean;
}) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  // „Ändern“ im Suchfeld: Bis zur neuen Wahl gilt die alte weiter, das Feld ist leer.
  const [editing, setEditing] = useState(false);
  const search = useCallback((query: string) => {
    const needle = query.trim().toLocaleLowerCase("de");
    const hits = latest.current.filter(
      (option) =>
        !needle || `${option.label} ${option.hint ?? ""}`.toLocaleLowerCase("de").includes(needle),
    );
    return Promise.resolve({
      items: hits
        .slice(0, LIST_HITS)
        .map((option) => ({ id: option.value, label: option.label, detail: option.hint ?? "" })),
      total: hits.length,
    });
  }, []);
  if (disabled) {
    return (
      <div className={wide ? "field field-wide" : "field"}>
        <span className="field-label">{label}</span>
        <span>{options.find((option) => option.value === value)?.label ?? value}</span>
      </div>
    );
  }
  if (options.length <= 4) {
    return (
      <Segmented
        label={label}
        value={value}
        options={options}
        onChange={onChange}
        hint={hint}
        wide={wide}
      />
    );
  }
  if (options.length <= CARDS_MAX) {
    return (
      <ChoiceCards
        legend={label}
        value={value}
        options={options}
        onChange={onChange}
        hint={hint}
        wide={wide}
      />
    );
  }
  const chosen = options.find((option) => option.value === value);
  return (
    <div className={wide ? "field-wide" : undefined}>
      <ComboField<ComboItem>
        label={label}
        hint={hint}
        search={search}
        placeholder="Tippe zum Suchen …"
        value={
          chosen && !editing
            ? { id: chosen.value, label: chosen.label, detail: chosen.hint ?? "" }
            : null
        }
        onChange={(item) => {
          setEditing(!item);
          if (item) {
            onChange(item.id as T);
          }
        }}
      />
    </div>
  );
}
