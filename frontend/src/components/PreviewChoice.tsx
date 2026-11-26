import { useId, type ReactNode } from "react";

/**
 * Auswahl aus einer festen Liste mit Vorschaubild je Möglichkeit (docs/design.md, „Masken und
 * Suche“), z. B. der Stil der Erfolge. Jede Möglichkeit hat einen Namen; die Vorschau ist nur
 * Zusatz und für Screenreader verborgen.
 */
export function PreviewChoice<T extends string>({
  legend,
  value,
  options,
  onChange,
  hint,
  disabled = false,
}: {
  legend: string;
  value: T;
  options: readonly { value: T; label: string; preview: ReactNode }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const name = useId();
  const noteId = useId();
  return (
    <fieldset
      className="preview-choice field-wide"
      aria-describedby={hint ? noteId : undefined}
      disabled={disabled}
    >
      <legend className="field-label">{legend}</legend>
      <div className="preview-choice-grid">
        {options.map((option) => (
          <label
            key={option.value}
            className={`preview-choice-option${value === option.value ? " preview-choice-on" : ""}`}
          >
            <span className="preview-choice-image" aria-hidden="true">
              {option.preview}
            </span>
            <span className="preview-choice-label">
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              {option.label}
            </span>
          </label>
        ))}
      </div>
      {hint && (
        <p id={noteId} className="field-hint">
          {hint}
        </p>
      )}
    </fieldset>
  );
}
