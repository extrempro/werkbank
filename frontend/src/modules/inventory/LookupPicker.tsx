import { useCallback } from "react";
import { ComboField } from "../../components/ComboField";
import { useListSearch, type ChoiceOption } from "../../components/ListChoice";
import { lookup, type LookupItem, type LookupKind, type LookupResult } from "./api";

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
  /** Hinweis unter dem Feld */
  hint?: string;
  /** Kennung des Eingabefelds, z. B. für die Links der Fehlerübersicht */
  id?: string;
}

/**
 * Auswahl mit Suche im IT-Bestand: Der Server sucht nach Nummer, Name, Person, Raum, Hostname
 * oder Seriennummer und liefert höchstens 20 Treffer. Darstellung und Bedienung kommen aus der
 * gemeinsamen Komponente `ComboField` (schwebendes Fenster, Echtzeitsuche).
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
  hint,
  id,
}: LookupPickerProps) {
  const find = useCallback(
    (query: string): Promise<LookupResult> =>
      search ? search(query) : lookup(kind, query, { computers }),
    [search, kind, computers],
  );
  return (
    <ComboField<LookupItem>
      label={label}
      value={value}
      onChange={onChange}
      search={find}
      placeholder={placeholder}
      required={required}
      exclude={exclude}
      error={error}
      hint={hint}
      id={id}
    />
  );
}

export type ListOption = ChoiceOption;

/**
 * Auswahl mit Suche über eine schon geladene Liste (z. B. Partner oder Verträge im Budget),
 * immer als Suchfeld. Der Wert ist die Nummer als Text, leer ohne Auswahl. Für Listen, die
 * auch kurz sein können, passt `ListChoice` (Karten bis zehn Einträge).
 */
export function ListPicker({
  label,
  options,
  value,
  onChange,
  placeholder,
  required = false,
  error = null,
  hint,
  id,
}: {
  label: string;
  options: readonly ListOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  error?: string | null;
  hint?: string;
  id?: string;
}) {
  const search = useListSearch(options);
  const chosen = options.find((option) => String(option.id) === value) ?? null;
  return (
    <LookupPicker
      search={search}
      label={label}
      required={required}
      placeholder={placeholder}
      error={error}
      hint={hint}
      id={id}
      value={chosen ? { id: chosen.id, label: chosen.label, detail: chosen.detail ?? "" } : null}
      onChange={(item) => onChange(item ? String(item.id) : "")}
    />
  );
}
