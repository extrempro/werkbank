import { useEffect, useState, type ReactNode } from "react";

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
