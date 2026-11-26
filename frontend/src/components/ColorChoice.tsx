import { useId, type ReactNode } from "react";

/**
 * Auswahl einer Farbe aus einer festen Liste (docs/design.md, „Masken und Suche“): jede Farbe
 * als Punkt mit Namen, damit die Auswahl nicht allein über die Farbe erkennbar ist. Die Farbe
 * selbst kommt über eine CSS-Klasse je Möglichkeit, die `--auswahl-farbe` setzt.
 */
export function ColorChoice<T extends string>({
  legend,
  value,
  options,
  onChange,
  hint,
}: {
  legend: string;
  value: T;
  options: readonly { value: T; label: string; className: string }[];
  onChange: (value: T) => void;
  hint?: ReactNode;
}) {
  const name = useId();
  const noteId = useId();
  return (
    <fieldset className="color-choice field-wide" aria-describedby={hint ? noteId : undefined}>
      <legend className="field-label">{legend}</legend>
      <div className="color-choice-grid">
        {options.map((option) => (
          <label
            key={option.value}
            className={`color-choice-option ${option.className}${value === option.value ? " color-choice-on" : ""}`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span className="color-choice-dot" aria-hidden="true" />
            {option.label}
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
