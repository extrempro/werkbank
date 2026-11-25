import { useCallback, useEffect, useRef } from "react";
import { ComboField } from "../../components/ComboField";
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
    />
  );
}

/** Höchstens so viele Treffer zeigt die Auswahl aus einer geladenen Liste */
const LIST_HITS = 20;

export interface ListOption {
  id: number;
  label: string;
  detail?: string;
}

/**
 * Auswahl mit Suche über eine schon geladene Liste (z. B. Partner oder Verträge im Budget).
 * Ersetzt ein langes Auswahlfeld; der Wert ist die Nummer als Text, leer ohne Auswahl.
 */
export function ListPicker({
  label,
  options,
  value,
  onChange,
  placeholder,
  required = false,
  error = null,
}: {
  label: string;
  options: readonly ListOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  error?: string | null;
}) {
  // Die Suche bleibt dieselbe Funktion, auch wenn die Liste bei jedem Rendern neu entsteht;
  // sonst sucht die Auswahl in einer Schleife.
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const search = useCallback((query: string): Promise<LookupResult> => {
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
  const chosen = options.find((option) => String(option.id) === value) ?? null;
  return (
    <LookupPicker
      search={search}
      label={label}
      required={required}
      placeholder={placeholder}
      error={error}
      value={chosen ? { id: chosen.id, label: chosen.label, detail: chosen.detail ?? "" } : null}
      onChange={(item) => onChange(item ? String(item.id) : "")}
    />
  );
}
