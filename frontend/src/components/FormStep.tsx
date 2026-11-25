import type { ReactNode } from "react";

/** Abschnitt einer Maske mit Nummer und Überschrift. */
export function FormStep({
  number,
  title,
  hint,
  children,
}: {
  number: number;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="form-step">
      <legend>
        <span className="form-step-number" aria-hidden="true">
          {number}
        </span>
        {title}
        {hint && <span className="form-step-hint"> ({hint})</span>}
      </legend>
      <div className="form-step-body">{children}</div>
    </fieldset>
  );
}
