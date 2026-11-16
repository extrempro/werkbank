import { useEffect, useId, useRef, useState, type PointerEvent } from "react";

export interface ChartSeries {
  id: string;
  label: string;
  /** Ein Wert je Tag; `null`, wenn es für den Tag keinen gibt. */
  values: (number | null)[];
}

interface LineChartProps {
  /** Kurze Beschreibung für Screenreader, z. B. „Verlauf der Lizenz“. */
  title: string;
  /** Tage als JJJJ-MM-TT, aufsteigend. */
  days: string[];
  /** Höchstens drei Reihen; die Farbe hängt an der Position und bleibt damit fest. */
  series: ChartSeries[];
}

// Gezeichnet wird in echten Pixeln: Die Breite folgt dem Platz, Schrift und Linien bleiben
// dadurch auf jedem Gerät gleich groß und lesbar.
const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 280;
const MAX_WIDTH = 1400;
const HEIGHT = 300;
const LEFT = 56;
const RIGHT = 20;
const TOP = 16;
const BOTTOM = 34;
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM;
const DAY_MS = 86_400_000;

const dayFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});
const numberFormat = new Intl.NumberFormat("de-DE");

export function formatDay(day: string): string {
  const time = Date.parse(`${day}T00:00:00Z`);
  return Number.isNaN(time) ? day : dayFormat.format(time);
}

/** Runde Schrittweite (1, 2, 5 mal Zehnerpotenz), mindestens 1, für etwa vier Achsenwerte. */
export function niceStep(span: number, target = 4): number {
  const rough = Math.max(span, 1) / target;
  const power = 10 ** Math.floor(Math.log10(rough));
  const factor = rough / power;
  const nice = factor <= 1 ? 1 : factor <= 2 ? 2 : factor <= 5 ? 5 : 10;
  return Math.max(1, nice * power);
}

/** Achsenwerte, die alle Daten einschließen. */
export function axisTicks(min: number, max: number): number[] {
  const step = niceStep(max - min);
  const low = Math.floor(min / step) * step;
  let high = Math.ceil(max / step) * step;
  if (high === low) {
    high = low + step;
  }
  const ticks: number[] = [];
  for (let value = low; value <= high + step / 2; value += step) {
    ticks.push(value);
  }
  return ticks;
}

/**
 * Liniendiagramm für einen Verlauf über Tage. Alle Reihen teilen sich eine Achse.
 * Die Werte eines Tages stehen unter dem Diagramm (Zeiger, Regler oder Tabelle),
 * die Farbe ist nie die einzige Unterscheidung.
 */
export function LineChart({ title, days, series }: LineChartProps) {
  const sliderId = useId();
  const [picked, setPicked] = useState<number | null>(null);
  const frame = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      if (measured > 0) {
        setWidth(Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, measured))));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const WIDTH = width;
  const PLOT_WIDTH = WIDTH - LEFT - RIGHT;
  const shown = series.slice(0, 3);
  const numbers = shown.flatMap((entry) =>
    entry.values.filter((value): value is number => value !== null),
  );
  if (days.length === 0 || numbers.length === 0) {
    return (
      <figure className="line-chart" ref={frame}>
        <p className="panel-empty">Noch kein Verlauf vorhanden.</p>
      </figure>
    );
  }

  const last = days.length - 1;
  const active = picked !== null && picked <= last ? picked : last;
  const times = days.map((day) => Date.parse(`${day}T00:00:00Z`));
  const start = times[0] ?? 0;
  const span = Math.max((times[last] ?? start) - start, DAY_MS);
  const x = (index: number) =>
    days.length === 1
      ? LEFT + PLOT_WIDTH / 2
      : LEFT + (((times[index] ?? start) - start) / span) * PLOT_WIDTH;
  const ticks = axisTicks(Math.min(...numbers), Math.max(...numbers));
  const low = ticks[0] ?? 0;
  const high = ticks[ticks.length - 1] ?? 1;
  const y = (value: number) => TOP + PLOT_HEIGHT - ((value - low) / (high - low)) * PLOT_HEIGHT;

  const path = (values: (number | null)[]) => {
    let result = "";
    let pen = false;
    values.forEach((value, index) => {
      if (value === null) {
        pen = false;
        return;
      }
      result += `${pen ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)} `;
      pen = true;
    });
    return result.trim();
  };

  const onPointer = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) {
      return;
    }
    const position = ((event.clientX - box.left) / box.width) * WIDTH;
    let nearest = 0;
    for (let index = 1; index < days.length; index += 1) {
      if (Math.abs(x(index) - position) < Math.abs(x(nearest) - position)) {
        nearest = index;
      }
    }
    setPicked(nearest);
  };

  const labelDays =
    days.length <= 2 ? [...days.keys()] : WIDTH < 420 ? [0, last] : [0, Math.floor(last / 2), last];
  const activeDay = days[active] ?? "";

  return (
    <figure className="line-chart" ref={frame}>
      <svg
        className="chart-plot"
        width={WIDTH}
        height={HEIGHT}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`${title}: ${formatDay(days[0] ?? "")} bis ${formatDay(days[last] ?? "")}. Die Werte stehen in der Tabelle darunter.`}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="chart-grid" x1={LEFT} x2={WIDTH - RIGHT} y1={y(tick)} y2={y(tick)} />
            <text className="chart-axis" x={LEFT - 10} y={y(tick) + 5} textAnchor="end">
              {numberFormat.format(tick)}
            </text>
          </g>
        ))}
        {labelDays.map((index, position) => (
          <text
            key={index}
            className="chart-axis"
            x={x(index)}
            y={HEIGHT - 10}
            textAnchor={
              days.length === 1 || (position > 0 && position < labelDays.length - 1)
                ? "middle"
                : position === 0
                  ? "start"
                  : "end"
            }
          >
            {formatDay(days[index] ?? "")}
          </text>
        ))}
        <line
          className="chart-cursor"
          x1={x(active)}
          x2={x(active)}
          y1={TOP}
          y2={TOP + PLOT_HEIGHT}
        />
        {shown.map((entry, position) => (
          <path
            key={entry.id}
            className={`chart-line chart-line-${position + 1}`}
            d={path(entry.values)}
          />
        ))}
        {shown.map((entry, position) => {
          const value = entry.values[active];
          return value === null || value === undefined ? null : (
            <circle
              key={entry.id}
              className={`chart-dot chart-dot-${position + 1}`}
              cx={x(active)}
              cy={y(value)}
              r={6}
            />
          );
        })}
      </svg>
      <figcaption className="chart-readout">
        <span className="chart-day">{formatDay(activeDay)}</span>
        <ul className="chart-legend">
          {shown.map((entry, position) => {
            const value = entry.values[active];
            return (
              <li key={entry.id}>
                <span className={`chart-key chart-key-${position + 1}`} aria-hidden="true" />
                {entry.label}:{" "}
                <strong>
                  {value === null || value === undefined ? "–" : numberFormat.format(value)}
                </strong>
              </li>
            );
          })}
        </ul>
      </figcaption>
      {days.length === 1 && (
        <p className="small">
          Der Verlauf beginnt mit diesem Tag. Eine Linie entsteht, sobald weitere Tage dazukommen.
        </p>
      )}
      {days.length > 1 && (
        <div className="chart-slider">
          <label htmlFor={sliderId}>Tag wählen</label>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={last}
            step={1}
            value={active}
            aria-valuetext={formatDay(activeDay)}
            onChange={(event) => setPicked(Number(event.target.value))}
          />
        </div>
      )}
      <details className="chart-table">
        <summary>Als Tabelle anzeigen</summary>
        <div className="table-wrap tool-scroll" tabIndex={0} role="region" aria-label={title}>
          <table>
            <caption className="visually-hidden">{title}</caption>
            <thead>
              <tr>
                <th scope="col">Tag</th>
                {shown.map((entry) => (
                  <th key={entry.id} scope="col">
                    {entry.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days
                .map((day, index) => ({ day, index }))
                .reverse()
                .map(({ day, index }) => (
                  <tr key={day}>
                    <th scope="row">{formatDay(day)}</th>
                    {shown.map((entry) => {
                      const value = entry.values[index];
                      return (
                        <td key={entry.id}>
                          {value === null || value === undefined ? "–" : numberFormat.format(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
