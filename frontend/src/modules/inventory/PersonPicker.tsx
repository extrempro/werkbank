import { useCallback } from "react";
import { ComboField, type ComboItem } from "../../components/ComboField";
import { searchPeople, type Person } from "./api";

interface PersonItem extends ComboItem {
  person: Person;
}

function personItem(person: Person): PersonItem {
  return {
    id: person.oid,
    label: person.name,
    detail: [person.upn, person.department, person.enabled === false ? "deaktiviert" : ""]
      .filter(Boolean)
      .join(" · "),
    person,
  };
}

/**
 * Auswahl einer Person aus Entra (docs/design.md, „Masken und Suche“): Feld mit Echtzeitsuche
 * im schwebenden Fenster, gesucht wird ab zwei Zeichen. Ausgewählt ist höchstens eine Person;
 * „Ändern“ öffnet die Suche wieder.
 */
export function PersonPicker({
  value,
  onChange,
  label = "Wer besetzt die Stelle?",
  hint = "Person aus Entra; leer lassen, wenn die Stelle unbesetzt ist.",
  required = false,
  error = null,
  id,
}: {
  value: Person | null;
  onChange: (next: Person | null) => void;
  label?: string;
  hint?: string;
  required?: boolean;
  error?: string | null;
  id?: string;
}) {
  const search = useCallback(
    (query: string) =>
      searchPeople(query.trim()).then((people) => ({
        items: people.map(personItem),
        total: people.length,
      })),
    [],
  );
  return (
    <ComboField<PersonItem>
      label={label}
      hint={hint}
      required={required}
      error={error}
      id={id}
      minLength={2}
      placeholder="Name oder Anmeldename"
      search={search}
      nothingFound={(query) => `Niemand in Entra gefunden für „${query}“.`}
      value={value ? personItem(value) : null}
      onChange={(item) => onChange(item ? item.person : null)}
    />
  );
}
