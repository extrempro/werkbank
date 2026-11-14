import type { DayCount } from "./api";

const dayLabel = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" });
const longDay = new Intl.DateTimeFormat("de-DE", { dateStyle: "full" });

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00`);
}

/** Säulen je Tag. Für Screenreader steht dieselbe Information als Tabelle darunter. */
export function ChangesChart({ days }: { days: DayCount[] }) {
  const max = Math.max(1, ...days.map((day) => day.count));
  const total = days.reduce((sum, day) => sum + day.count, 0);
  return (
    <section className="panel" aria-labelledby="diagramm-titel">
      <div className="panel-head">
        <h2 id="diagramm-titel">Änderungen pro Tag</h2>
        <span className="small">
          letzte {days.length} Tage · {total} insgesamt
        </span>
      </div>
      <div className="chart" aria-hidden="true">
        {days.map((day) => (
          <div className="chart-col" key={day.day}>
            <span className="chart-value">{day.count > 0 ? day.count : ""}</span>
            <span
              className={day.count > 0 ? "chart-bar" : "chart-bar chart-bar-empty"}
              style={{ height: `${Math.round((day.count / max) * 100)}%` }}
            />
            <span className="chart-label">{dayLabel.format(parseDay(day.day))}</span>
          </div>
        ))}
      </div>
      <table className="visually-hidden">
        <caption>Erkannte Änderungen je Tag</caption>
        <thead>
          <tr>
            <th scope="col">Tag</th>
            <th scope="col">Änderungen</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.day}>
              <td>{longDay.format(parseDay(day.day))}</td>
              <td>{day.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
