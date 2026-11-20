import { useEffect, useId, useState } from "react";
import { errorText } from "../../api";
import { searchPeople, type Person } from "./api";

/**
 * Auswahl einer Person aus Entra. Gesucht wird ab zwei Zeichen, kurz nach dem letzten Tippen.
 * Ausgewählt ist höchstens eine Person; „Ändern“ öffnet die Suche wieder.
 */
export function PersonPicker({
  value,
  onChange,
  label = "Wer besetzt die Stelle? (Person aus Entra)",
}: {
  value: Person | null;
  onChange: (next: Person | null) => void;
  label?: string;
}) {
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  // Treffer mit dem Suchtext, für den sie gelten; ein anderer Suchtext zählt als „lädt“
  const [result, setResult] = useState<{ query: string; hits: Person[] } | null>(null);
  const [failed, setFailed] = useState<{ query: string; text: string } | null>(null);
  const term = query.trim();

  useEffect(() => {
    if (term.length < 2) {
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      searchPeople(term).then(
        (hits) => active && setResult({ query: term, hits }),
        (problem: unknown) =>
          active &&
          setFailed({
            query: term,
            text: errorText(problem, "Die Suche in Entra hat nicht geklappt."),
          }),
      );
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [term]);

  if (value) {
    return (
      <div className="picker">
        <p className="picker-label">{label}</p>
        <div className="picked">
          <span>
            <strong>{value.name}</strong>
            {value.upn && <span className="small"> · {value.upn}</span>}
          </span>
          <button
            type="button"
            className="row-button"
            onClick={() => {
              onChange(null);
              setQuery("");
            }}
          >
            Andere Person wählen
          </button>
        </div>
      </div>
    );
  }

  const hits = result && result.query === term ? result.hits : null;
  const error = failed && failed.query === term ? failed.text : null;
  const searching = term.length >= 2 && hits === null && error === null;

  return (
    <div className="picker">
      <label htmlFor={inputId} className="picker-label">
        {label}
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        maxLength={60}
        autoComplete="off"
        placeholder="Name oder Anmeldename, leer lassen, wenn unbesetzt"
        aria-controls={listId}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div id={listId} className="picker-hits" aria-live="polite">
        {searching && <p className="small">Suche in Entra …</p>}
        {error && (
          <p role="alert" className="hint-box hint-bad">
            {error}
          </p>
        )}
        {hits && hits.length === 0 && <p className="small">Niemand gefunden.</p>}
        {hits && hits.length > 0 && (
          <ul aria-label="Personen aus Entra">
            {hits.map((person) => (
              <li key={person.oid}>
                <button type="button" className="picker-hit" onClick={() => onChange(person)}>
                  <strong>{person.name}</strong>
                  <span className="small">
                    {[person.upn, person.department, person.enabled === false ? "deaktiviert" : ""]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
