import { useId, type ReactNode } from "react";

/** Was das Eingabeelement eines Felds an Eigenschaften bekommt. */
export interface FieldControl {
  id: string;
  className: "field-control";
  "aria-required": true | undefined;
  "aria-invalid": true | undefined;
  "aria-describedby": string | undefined;
}

/**
 * Ein Feld einer Maske (docs/design.md, „Masken und Suche“): Beschriftung über dem Feld,
 * Pflicht mit „*“, darunter ein Hinweis oder statt ihm der Fehler. Das Eingabeelement
 * (input, select, textarea) bekommt Kennung, Klasse und ARIA über `children`.
 *
 *   <Field label="Name" required hint="So heißt das Gerät in Listen." error={problem}>
 *     {(control) => <input {...control} value={name} onChange={…} />}
 *   </Field>
 */
export function Field({
  label,
  required = false,
  hint,
  error,
  wide = false,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  /** über beide Spalten einer zweispaltigen Maske */
  wide?: boolean;
  children: (control: FieldControl) => ReactNode;
}) {
  const id = useId();
  const noteId = useId();
  const note = error || hint ? noteId : undefined;
  return (
    <div className={wide ? "field field-wide" : "field"}>
      <label htmlFor={id} className="field-label">
        {label}
        {required && (
          <span className="field-required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {children({
        id,
        className: "field-control",
        "aria-required": required || undefined,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": note,
      })}
      {error ? (
        <p id={noteId} className="field-error">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" />
          </svg>
          {error}
        </p>
      ) : (
        hint && (
          <p id={noteId} className="field-hint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Hinweis oben in einer Maske mit Pflichtfeldern. */
export function RequiredNote() {
  return (
    <p className="field-hint">
      Felder mit <span aria-hidden="true">*</span>
      <span className="visually-hidden">Stern</span> sind Pflicht.
    </p>
  );
}

/**
 * Nach dem Absenden oben in der Maske: „n Angaben fehlen noch“ mit Links zu den Feldern.
 * `problems`: Feldkennung (id des Eingabeelements) und Name des Felds.
 */
export function ErrorSummary({
  problems,
}: {
  problems: readonly { id: string; label: string; text?: string }[];
}) {
  if (problems.length === 0) {
    return null;
  }
  return (
    <div className="error-summary" role="alert">
      <strong>
        {problems.length === 1 ? "1 Angabe fehlt noch." : `${problems.length} Angaben fehlen noch.`}
      </strong>
      <ul>
        {problems.map((problem) => (
          <li key={problem.id}>
            <a
              href={`#${problem.id}`}
              onClick={(event) => {
                event.preventDefault();
                document.getElementById(problem.id)?.focus();
              }}
            >
              {problem.label}
            </a>
            {problem.text && `: ${problem.text}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Auswahlkarten für 5–10 Möglichkeiten oder eine Liste, die wachsen kann: Name und kurze
 * Erklärung je Karte, Raster bricht um (PC drei Spalten, Handy eine). Darunter echte
 * Auswahlknöpfe (Tastatur, Screenreader).
 */
export function ChoiceCards<T extends string>({
  legend,
  value,
  options,
  onChange,
  required = false,
}: {
  legend: string;
  value: T | null;
  options: readonly { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  required?: boolean;
}) {
  const name = useId();
  return (
    <fieldset className="choice-cards">
      <legend className="field-label">
        {legend}
        {required && (
          <span className="field-required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </legend>
      <div className="choice-cards-grid">
        {options.map((option) => (
          <label
            key={option.value}
            className={value === option.value ? "choice-card choice-card-on" : "choice-card"}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className="choice-card-text">
              <span className="choice-card-label">{option.label}</span>
              {option.hint && <span className="small">{option.hint}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
