import { useEffect, useState, type ReactNode } from "react";
import { CARDS_MAX, FixedChoice } from "../components/ListChoice";

/** Kopiert einen Text in die Zwischenablage und bestätigt das kurz. */
export function CopyButton({ value, label = "Kopieren" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") {
      return undefined;
    }
    const timer = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [state]);

  const onCopy = () => {
    const clipboard = navigator.clipboard;
    if (!clipboard) {
      setState("failed");
      return;
    }
    clipboard.writeText(value).then(
      () => setState("done"),
      () => setState("failed"),
    );
  };

  return (
    <button type="button" className="button button-secondary tool-copy" onClick={onCopy}>
      {state === "done" ? "Kopiert" : state === "failed" ? "Nicht möglich" : label}
      <span className="visually-hidden" role="status">
        {state === "done" ? " – in der Zwischenablage" : ""}
      </span>
    </button>
  );
}

export interface InfoRow {
  label: string;
  value: ReactNode;
  /** Text für die Zwischenablage; ohne Angabe gibt es keinen Knopf. */
  copy?: string;
  /** Wert in normaler Schrift statt in Festbreite. */
  plain?: boolean;
}

/** Tabelle aus Bezeichnung und Wert, optional mit Kopierknopf. */
export function InfoTable({ rows, caption }: { rows: InfoRow[]; caption: string }) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table className="tool-info">
        <caption className="visually-hidden">{caption}</caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td className={row.plain ? undefined : "mono"}>{row.value}</td>
              <td className="tool-info-copy">
                {row.copy !== undefined && (
                  <CopyButton value={row.copy} label={`${row.label} kopieren`} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Ergebnis als Textblock mit Kopierknopf. */
export function Output({ value, label = "Ergebnis" }: { value: string; label?: string }) {
  return (
    <div className="tool-output">
      <div className="section-head">
        <h2>{label}</h2>
        {value !== "" && <CopyButton value={value} label={`${label} kopieren`} />}
      </div>
      <pre className="value-block" tabIndex={0} aria-label={label}>
        {value === "" ? " " : value}
      </pre>
    </div>
  );
}

/** Macht doppelte Bezeichnungen eindeutig (zweites Vorkommen: „name (2)“). */
export function numberDuplicates<T extends { label: string }>(rows: T[]): T[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const count = (seen.get(row.label) ?? 0) + 1;
    seen.set(row.label, count);
    return count === 1 ? row : { ...row, label: `${row.label} (${count})` };
  });
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="hint-box hint-bad">
      {children}
    </p>
  );
}

/** Abschnitt innerhalb eines Tools. */
export function ToolSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="tool-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/**
 * Auswahl aus wenigen Möglichkeiten als Knopfgruppe; die gewählte ist gedrückt. Ab fünf
 * Möglichkeiten wird daraus das Suchfeld mit schwebendem Fenster (docs/design.md, §8).
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  if (options.length > CARDS_MAX) {
    return (
      <FixedChoice
        label={label}
        value={value}
        options={options.map(([key, text]) => ({ value: key, label: text }))}
        onChange={onChange}
      />
    );
  }
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          className="chip chip-filter"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
