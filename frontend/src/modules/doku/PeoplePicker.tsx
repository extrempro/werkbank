import { useEffect, useId, useState } from "react";
import { errorText } from "../../api";
import { searchPeople, type Person } from "./api";

/** Person aus Entra suchen und hinzufügen (Name, Anmeldename, Abteilung). */
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
  const id = useId();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) {
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      searchPeople(term).then(
        (result) => {
          if (active) {
            setHits(result);
            setError(null);
          }
        },
        (problem: unknown) =>
          active && setError(errorText(problem, "Die Suche ist gerade nicht möglich.")),
      );
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [term]);

  const shown = (hits ?? []).filter((person) => !exclude.has(person.oid));
  return (
    <div className="doku-picker">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="search"
        value={query}
        maxLength={60}
        autoComplete="off"
        placeholder="Name oder Anmeldename"
        onChange={(event) => {
          setQuery(event.target.value);
          if (event.target.value.trim().length < 2) {
            setHits(null);
          }
        }}
      />
      {error && (
        <p className="hint-box hint-bad" role="alert">
          {error}
        </p>
      )}
      {term.length >= 2 && hits !== null && (
        <ul className="doku-picker-hits" aria-label="Gefundene Personen">
          {shown.length === 0 && <li className="small">Niemand gefunden.</li>}
          {shown.map((person) => (
            <li key={person.oid}>
              <span>
                <strong>{person.name}</strong>
                <span className="small">
                  {" "}
                  {person.upn}
                  {person.department ? ` · ${person.department}` : ""}
                </span>
              </span>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  onPick(person);
                  setQuery("");
                  setHits(null);
                }}
              >
                Hinzufügen
                <span className="visually-hidden">{`: ${person.name}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
