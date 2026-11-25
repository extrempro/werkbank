import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { ComboField, type ComboItem, type ComboResult } from "./ComboField";
import { ChoiceCards } from "./Field";

/** Bis zu so vielen Möglichkeiten zeigt `ListChoice` Auswahlkarten, darüber ein Suchfeld. */
export const CARDS_MAX = 10;
/** Höchstens so viele Treffer zeigt das Suchfeld über eine geladene Liste. */
const LIST_HITS = 20;

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
): (query: string) => Promise<ComboResult> {
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
}) {
  const search = useListSearch(options);
  if (options.length <= CARDS_MAX) {
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
      <ComboField<ComboItem>
        label={label}
        id={id}
        required={required}
        hint={hint}
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
