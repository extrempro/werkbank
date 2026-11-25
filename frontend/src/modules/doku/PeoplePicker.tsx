import { useCallback } from "react";
import { ComboField, type ComboItem } from "../../components/ComboField";
import { searchPeople, type Person } from "./api";

interface PersonItem extends ComboItem {
  person: Person;
}

/**
 * Person aus Entra suchen und hinzufügen (docs/design.md, „Masken und Suche“): Feld mit
 * Echtzeitsuche im schwebenden Fenster ab zwei Zeichen; eine Wahl fügt die Person hinzu und
 * leert das Feld für die nächste.
 */
export function PeoplePicker({
  label,
  exclude,
  onPick,
}: {
  label: string;
  /** Schon in der Liste (Objekt-IDs) */
  exclude: ReadonlySet<string>;
  onPick: (person: Person) => void;
}) {
  const search = useCallback(
    (query: string) =>
      searchPeople(query.trim()).then((people) => ({
        items: people.map((person): PersonItem => ({
          id: person.oid,
          label: person.name,
          detail: [person.upn, person.department].filter(Boolean).join(" · "),
          person,
        })),
        total: people.length,
      })),
    [],
  );
  return (
    <div className="doku-picker">
      <ComboField<PersonItem>
        label={label}
        minLength={2}
        placeholder="Name oder Anmeldename"
        search={search}
        exclude={[...exclude]}
        nothingFound={(query) => `Niemand in Entra gefunden für „${query}“.`}
        value={null}
        onChange={(item) => item && onPick(item.person)}
      />
    </div>
  );
}
