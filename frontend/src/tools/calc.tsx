import type { ReactNode } from "react";
import { parseNumber } from "./data-units/units";

/** Zahl aus einem Eingabefeld (deutsche und englische Schreibweise); leer oder ungültig → NaN. */
export const num = (text: string): number => parseNumber(text) ?? NaN;

/** Ganze Zahl aus der Adresszeile innerhalb von Grenzen; ungültig → Standard. */
export function intParam(text: string, min: number, max: number, fallback: number): number {
  const value = Number(text);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export const euro = (value: number) =>
  value.toLocaleString("de-DE", { style: "currency", currency: "EUR" });
export const dec = (value: number, digits = 2) =>
  value.toLocaleString("de-DE", { maximumFractionDigits: digits });
export const percent = (value: number, digits = 1) => `${dec(value, digits)} %`;

/** Zahlenfeld mit Beschriftung, Einheit und optionalem Hinweis. */
export function NumField({
  label,
  value,
  onChange,
  unit,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  unit?: string;
  hint?: ReactNode;
}) {
  return (
    <div className="tool-field">
      <label>
        {label}
        {unit && <span className="tool-unit"> ({unit})</span>}
        <input
          type="text"
          className="mono"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value.trim())}
        />
      </label>
      {hint && <p className="small">{hint}</p>}
    </div>
  );
}

export type Tone = "neutral" | "ok" | "warn" | "bad";

/** Kennzahl: Bezeichnung und Wert, optional hervorgehoben. */
export function Tile({
  value,
  label,
  tone = "neutral",
}: {
  value: ReactNode;
  label: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={tone === "neutral" ? "kpi" : `kpi kpi-${tone}`}>
      <dt>{label}</dt>
      <dd className="tool-kpi">{value}</dd>
    </div>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return <dl className="kpis">{children}</dl>;
}

/** Schlichte Datentabelle; Spalten ab `numericFrom` stehen rechtsbündig. */
export function DataTable({
  caption,
  head,
  rows,
  numericFrom = 1,
  highlight,
}: {
  caption: string;
  head: string[];
  rows: ReactNode[][];
  numericFrom?: number;
  /** Zeilen, die hervorgehoben werden. */
  highlight?: (index: number) => boolean;
}) {
  const align = (index: number) => (index >= numericFrom ? "number" : undefined);
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
      <table>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {head.map((title, index) => (
              <th key={index} scope="col" className={align(index)}>
                {title || <span className="visually-hidden">Hinweis</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className={highlight?.(rowIndex) ? "tool-hit" : undefined}>
              {row.map((cell, index) =>
                index === 0 ? (
                  <th key={index} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={index} className={align(index)}>
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
