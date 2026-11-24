import { Icon } from "../../components/Icon";
import { PeoplePicker } from "./PeoplePicker";
import type { PersonRight } from "./api";

/** Liste von Personen mit Recht: Recht ändern, entfernen, Person hinzufügen. */
export function MembersEditor({
  people,
  roles,
  defaultRole,
  pickerLabel,
  caption,
  fixed,
  roleLabel = "Recht für",
  onChange,
}: {
  people: PersonRight[];
  roles: Record<string, string>;
  defaultRole: string;
  pickerLabel: string;
  caption: string;
  /** Personen, die sich nicht entfernen lassen (z. B. Mitglieder des Arbeitsbereichs) */
  fixed?: ReadonlySet<string>;
  /** Beschriftung der Auswahl je Person, z. B. „Recht für“ */
  roleLabel?: string;
  onChange: (next: PersonRight[]) => void;
}) {
  const set = (oid: string, role: string) =>
    onChange(people.map((person) => (person.oid === oid ? { ...person, role } : person)));
  return (
    <div className="doku-members">
      {people.length === 0 ? (
        <p className="small">Noch niemand.</p>
      ) : (
        <table className="doku-members-table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Recht</th>
              <th scope="col">
                <span className="visually-hidden">Entfernen</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.oid}>
                <th scope="row">{person.name || person.oid}</th>
                <td>
                  <select
                    aria-label={`${roleLabel} ${person.name || person.oid}`}
                    value={person.role}
                    onChange={(event) => set(person.oid, event.target.value)}
                  >
                    {Object.entries(roles).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {!fixed?.has(person.oid) && (
                    <button
                      type="button"
                      className="row-button"
                      aria-label={`${person.name || person.oid} entfernen`}
                      title="Entfernen"
                      onClick={() => onChange(people.filter((p) => p.oid !== person.oid))}
                    >
                      <Icon name="loeschen" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PeoplePicker
        label={pickerLabel}
        exclude={new Set(people.map((person) => person.oid))}
        onPick={(person) =>
          onChange([...people, { oid: person.oid, name: person.name, role: defaultRole }])
        }
      />
    </div>
  );
}
