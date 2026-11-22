import { useState } from "react";
import { formatEuro, niceMax } from "./api";

/** Ein Jahr im Vergleich: Farbe nach Abstand zum oben gewählten (0 bis 4). */
export interface ChartYear {
  year: number;
  name: string;
  slot: number;
  /** Erwartete Kosten statt Ist (laufende oder künftige Jahre): gestrichelt. */
  plan: boolean;
}

export interface ChartGroup {
  key: string;
  name: string;
  /** Betrag je Jahr in Cent. */
  values: Record<number, number>;
}

export type ChartLayout = "saeulen" | "ueberlappend" | "nebeneinander";

/** Prozentuale Veränderung, z. B. „+12 %“; leer ohne Vergleichswert. */
export function change(now: number, before: number): string {
  if (!before) {
    return now ? "neu" : "";
  }
  const percent = Math.round((now / before - 1) * 100);
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : "±";
  return `${sign}${Math.abs(percent)} %`;
}

function share(value: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
}

/** Farbe und Linie eines Jahres als Klassen (Farben aus der Diagrammpalette). */
export function yearClass(year: ChartYear): string {
  return `stat-c${year.slot}${year.plan ? " stat-plan" : ""}`;
}

function ticks(max: number): number[] {
  return [0, 0.25, 0.5, 0.75, 1].map((part) => part * max);
}

/** Achse links und Gitterlinien für Säulen. */
function Axis({ max, height }: { max: number; height: number }) {
  return (
    <div className="stat-axis" style={{ height }} aria-hidden="true">
      {ticks(max).map((value) => (
        <span key={value} style={{ bottom: `${share(value, max)}%` }}>
          {formatEuro(value).replace(/,00\s€$/, " €")}
        </span>
      ))}
    </div>
  );
}

function Grid({ max }: { max: number }) {
  return (
    <>
      {ticks(max).map((value) => (
        <span
          key={value}
          className="stat-gridline"
          style={{ bottom: `${share(value, max)}%` }}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

/**
 * Gruppen (Konten, Arten oder Tags) mit einem Wert je Geschäftsjahr: als knapp überlappende Säulen,
 * überlappende Balken oder Balken nebeneinander. Die gewählte Gruppe steht mit allen Beträgen
 * darüber; dieselben Zahlen gibt es als Tabelle.
 */
export function GroupChart({
  label,
  groupHead,
  years,
  groups,
  layout,
  selected,
  onSelect,
}: {
  label: string;
  groupHead: string;
  /** Gewählte Jahre, das neueste zuerst. */
  years: ChartYear[];
  groups: ChartGroup[];
  layout: ChartLayout;
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  const [table, setTable] = useState(false);
  if (groups.length === 0 || years.length === 0) {
    return null;
  }
  const max = niceMax(
    Math.max(1, ...groups.flatMap((group) => years.map((y) => group.values[y.year] ?? 0))),
  );
  const current = groups.find((group) => group.key === selected) ?? groups[0];
  const newest = years[0];
  const oldest = years[years.length - 1];
  const value = (group: ChartGroup, year: ChartYear) => group.values[year.year] ?? 0;
  const diff = (group: ChartGroup) =>
    years.length > 1 && newest && oldest ? change(value(group, newest), value(group, oldest)) : "";
  const describe = (group: ChartGroup) =>
    `${group.name}: ${years.map((year) => `${year.name}${year.plan ? " (erwartet)" : ""} ${formatEuro(value(group, year))}`).join(", ")}`;
  const back = [...years].reverse();
  const width = 16 + (years.length - 1) * 11;

  return (
    <div className="stat-group-chart">
      <div className="stat-readout" aria-live="polite">
        <strong>{current?.name}</strong>
        {current &&
          years.map((year) => (
            <span key={year.year}>
              <span className={`stat-key ${yearClass(year)}`} aria-hidden="true" />
              {year.name}
              {year.plan ? " (erwartet)" : ""}: {formatEuro(value(current, year))}
            </span>
          ))}
        {current && years.length > 1 && oldest && diff(current) && (
          <span className="budget-muted">
            {diff(current)} zu {oldest.name}
          </span>
        )}
        <button
          type="button"
          className="button button-secondary stat-table-toggle"
          onClick={() => setTable(!table)}
        >
          {table ? "Als Grafik" : "Als Tabelle"}
        </button>
      </div>
      {table ? (
        <div className="table-wrap budget-table" tabIndex={0} role="region" aria-label={label}>
          <table>
            <caption className="visually-hidden">{label}</caption>
            <thead>
              <tr>
                <th scope="col">{groupHead}</th>
                {years.map((year) => (
                  <th key={year.year} scope="col" className="betrag">
                    {year.name}
                    {year.plan ? " (erwartet)" : ""}
                  </th>
                ))}
                {years.length > 1 && oldest && (
                  <th scope="col" className="betrag">
                    Veränderung zu {oldest.name}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.key}>
                  <th scope="row">{group.name}</th>
                  {years.map((year) => (
                    <td key={year.year} className="betrag">
                      {formatEuro(value(group, year))}
                    </td>
                  ))}
                  {years.length > 1 && <td className="betrag">{diff(group)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : layout === "saeulen" ? (
        <div className="stat-scroll">
          <div
            className="stat-columns"
            style={{ minWidth: Math.max(320, 80 + groups.length * Math.max(84, width + 40)) }}
          >
            <Axis max={max} height={240} />
            <div className="stat-columns-body">
              <div className="stat-plot" style={{ height: 240 }}>
                <Grid max={max} />
                <div
                  className="stat-groups"
                  style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}
                >
                  {groups.map((group) => (
                    <button
                      key={group.key}
                      type="button"
                      className="stat-hit stat-group"
                      aria-pressed={group === current}
                      aria-label={describe(group)}
                      onClick={() => onSelect(group.key)}
                    >
                      <span className="stat-cluster" style={{ width, marginLeft: -width / 2 }}>
                        {back.map((year, index) => (
                          <span
                            key={year.year}
                            className={`stat-column ${yearClass(year)}`}
                            style={{
                              left: index * 11,
                              height: `${Math.max(0.5, share(value(group, year), max))}%`,
                            }}
                          />
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <div
                className="stat-group-names"
                style={{ gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))` }}
                aria-hidden="true"
              >
                {groups.map((group) => (
                  <span key={group.key} className={group === current ? "stat-chosen" : undefined}>
                    {group.name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="stat-rows">
          {groups.map((group) => (
            <button
              key={group.key}
              type="button"
              className="stat-hit stat-row"
              aria-pressed={group === current}
              onClick={() => onSelect(group.key)}
            >
              <span className="stat-row-name">
                {group.name}
                <span className="visually-hidden">{describe(group).slice(group.name.length)}</span>
              </span>
              {layout === "ueberlappend" ? (
                <span
                  className="stat-track"
                  style={{ height: 13 + (years.length - 1) * 8 }}
                  aria-hidden="true"
                >
                  {back.map((year, index) => (
                    <span
                      key={year.year}
                      className={`stat-yearbar ${yearClass(year)}`}
                      style={{
                        top: index * 8,
                        width: `${Math.max(1, share(value(group, year), max))}%`,
                      }}
                    />
                  ))}
                </span>
              ) : (
                <span className="stat-stack" aria-hidden="true">
                  {years.map((year) => (
                    <span key={year.year} className="stat-side">
                      <span
                        className={`stat-bar-side ${yearClass(year)}`}
                        style={{ width: `${Math.max(1, share(value(group, year), max) * 0.8)}%` }}
                      />
                      <span className="small">{formatEuro(value(group, year))}</span>
                    </span>
                  ))}
                </span>
              )}
              <span className="stat-row-diff">{diff(group)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Schalter für die Jahre im Vergleich; das oben gewählte ist immer dabei. */
export function YearChips({
  years,
  chosen,
  onToggle,
}: {
  years: ChartYear[];
  chosen: readonly number[];
  onToggle: (year: number) => void;
}) {
  return (
    <div className="stat-chips" role="group" aria-label="Jahre im Vergleich">
      {years.map((year) => {
        const on = chosen.includes(year.year);
        return (
          <button
            key={year.year}
            type="button"
            className={`chip chip-filter stat-chip ${yearClass(year)}`}
            aria-pressed={on}
            disabled={year.slot === 0}
            onClick={() => onToggle(year.year)}
          >
            <span className="stat-key" aria-hidden="true" />
            {year.name}
            {year.slot === 0 && <span className="small budget-muted">oben gewählt</span>}
            {year.plan && <span className="small budget-muted">erwartet</span>}
          </button>
        );
      })}
    </div>
  );
}

const W = 660;
const H = 220;

function points(values: number[], max: number): string {
  let sum = 0;
  return values
    .map((value, index) => {
      sum += value;
      return `${((index + 0.5) * (W / 12)).toFixed(1)},${(H - (sum / max) * H).toFixed(1)}`;
    })
    .join(" ");
}

function cumulative(values: number[], upto: number): number {
  return values.slice(0, upto + 1).reduce((total, value) => total + value, 0);
}

/**
 * Verlauf eines Jahres: Ist aufsummiert je Monat, das Vergleichsjahr und die erwarteten Kosten
 * als Linie. Monate lassen sich antippen; dieselben Zahlen gibt es als Tabelle.
 */
export function CumulativeChart({
  months,
  actual,
  compare,
  compareName,
  expected,
  elapsed,
  yearName,
}: {
  months: string[];
  actual: number[];
  compare: number[] | null;
  compareName: string | null;
  expected: number;
  elapsed: number;
  yearName: string;
}) {
  const [month, setMonth] = useState(Math.max(0, Math.min(11, elapsed - 1)));
  const [table, setTable] = useState(false);
  const shown = actual.slice(0, elapsed);
  const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0);
  const max = niceMax(Math.max(1, expected, total(shown), compare ? total(compare) : 0));
  const planY = H - (expected / max) * H;
  return (
    <div className="stat-cumulative">
      <ul className="stat-keys">
        <li>
          <span className="stat-key stat-c0" aria-hidden="true" />
          Ist {yearName}
        </li>
        {compare && compareName && (
          <li>
            <span className="stat-key stat-c1" aria-hidden="true" />
            Ist {compareName}
          </li>
        )}
        <li>
          <span className="stat-key stat-key-plan" aria-hidden="true" />
          Erwartet {yearName}
        </li>
        <li>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => setTable(!table)}
          >
            {table ? "Als Grafik" : "Als Tabelle"}
          </button>
        </li>
      </ul>
      <p className="stat-readout" aria-live="polite">
        <strong>{months[month]}</strong>
        <span>
          Ist bis dahin:{" "}
          <strong>{month < elapsed ? formatEuro(cumulative(actual, month)) : "noch offen"}</strong>
        </span>
        {compare && compareName && (
          <span>
            {compareName} bis dahin: <strong>{formatEuro(cumulative(compare, month))}</strong>
          </span>
        )}
        <span>
          Erwartet im ganzen Jahr: <strong>{formatEuro(expected)}</strong>
        </span>
      </p>
      {table ? (
        <div
          className="table-wrap budget-table"
          tabIndex={0}
          role="region"
          aria-label={`Ist je Monat ${yearName}`}
        >
          <table>
            <caption className="visually-hidden">Ist je Monat {yearName}</caption>
            <thead>
              <tr>
                <th scope="col">Monat</th>
                <th scope="col" className="betrag">
                  Ist
                </th>
                <th scope="col" className="betrag">
                  Ist aufsummiert
                </th>
                {compare && compareName && (
                  <th scope="col" className="betrag">
                    Ist {compareName}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {months.map((name, index) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td className="betrag">
                    {index < elapsed ? formatEuro(actual[index] ?? 0) : "–"}
                  </td>
                  <td className="betrag">
                    {index < elapsed ? formatEuro(cumulative(actual, index)) : "–"}
                  </td>
                  {compare && <td className="betrag">{formatEuro(compare[index] ?? 0)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="stat-scroll">
          <div className="stat-columns" style={{ minWidth: 440 }}>
            <Axis max={max} height={H} />
            <div className="stat-columns-body">
              <div className="stat-plot" style={{ height: H }}>
                <Grid max={max} />
                <svg
                  className="stat-lines"
                  viewBox={`0 0 ${W} ${H}`}
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <line className="stat-line-plan" x1={0} x2={W} y1={planY} y2={planY} />
                  {compare && (
                    <polyline className="stat-line stat-line-c1" points={points(compare, max)} />
                  )}
                  {shown.length > 0 && (
                    <polyline className="stat-line stat-line-c0" points={points(shown, max)} />
                  )}
                </svg>
                <div className="stat-months">
                  {months.map((name, index) => (
                    <button
                      key={name}
                      type="button"
                      className="stat-hit stat-month"
                      aria-pressed={index === month}
                      aria-label={`${name} anzeigen`}
                      onClick={() => setMonth(index)}
                      onMouseEnter={() => setMonth(index)}
                    />
                  ))}
                </div>
              </div>
              <div className="stat-month-names" aria-hidden="true">
                {months.map((name, index) => (
                  <span key={name} className={index === month ? "stat-chosen" : undefined}>
                    {name.slice(0, 3)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Ist je Monat als Säulen, daneben das Vergleichsjahr. */
export function MonthColumns({
  months,
  actual,
  compare,
  elapsed,
}: {
  months: string[];
  actual: number[];
  compare: number[] | null;
  elapsed: number;
}) {
  const max = niceMax(Math.max(1, ...actual, ...(compare ?? [])));
  return (
    <div className="stat-scroll" tabIndex={0} role="region" aria-label="Ausgaben je Monat, Säulen">
      <div className="stat-columns" style={{ minWidth: 420 }}>
        <Axis max={max} height={160} />
        <div className="stat-columns-body">
          <div className="stat-plot" style={{ height: 160 }}>
            <Grid max={max} />
            <div className="stat-month-bars">
              {months.map((name, index) => (
                <div
                  key={name}
                  className="stat-month-bar"
                  role="img"
                  aria-label={`${name}: Ist ${index < elapsed ? formatEuro(actual[index] ?? 0) : "noch offen"}${compare ? `, Vergleich ${formatEuro(compare[index] ?? 0)}` : ""}`}
                >
                  <span
                    className="stat-c0 stat-fill"
                    style={{ height: `${index < elapsed ? share(actual[index] ?? 0, max) : 0}%` }}
                  />
                  {compare && (
                    <span
                      className="stat-c1 stat-fill"
                      style={{ height: `${share(compare[index] ?? 0, max)}%` }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="stat-month-names" aria-hidden="true">
            {months.map((name) => (
              <span key={name}>{name.slice(0, 3)}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
