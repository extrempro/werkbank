import { useState } from "react";
import { monthlyIncidents, type DayLevel, type Health } from "./api";

const HOURS = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const dayFormat = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "UTC",
});
const longDay = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeZone: "UTC" });
const monthShort = new Intl.DateTimeFormat("de-DE", {
  month: "2-digit",
  year: "2-digit",
  timeZone: "UTC",
});
const monthLong = new Intl.DateTimeFormat("de-DE", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const LEVEL_TEXT: Record<DayLevel, string> = {
  ok: "keine Meldung",
  hinweis: "Hinweis",
  stoerung: "Störung",
};

function day(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function month(key: string): Date {
  return new Date(`${key}-01T00:00:00Z`);
}

/** Je Dienst ein Streifen über 90 Tage: Tage mit Störung oder Hinweis sind markiert. */
function Timeline({ health }: { health: Health }) {
  const days = health.timeline_days;
  if (days.length === 0) {
    return null;
  }
  const first = days[0] ?? "";
  const last = days[days.length - 1] ?? "";
  return (
    <section className="panel" aria-labelledby="health-zeitleiste">
      <div className="panel-head">
        <h2 id="health-zeitleiste">Letzte {days.length} Tage</h2>
        <span className="small">
          {longDay.format(day(first))} bis {longDay.format(day(last))}
        </span>
      </div>
      <div className="detail-body">
        <ul className="timeline">
          {health.timeline.map((line) => {
            const incidents = line.days.filter((level) => level === "stoerung").length;
            const advisories = line.days.filter((level) => level === "hinweis").length;
            return (
              <li key={line.service_id} className="timeline-row">
                <span className="timeline-name">{line.service_name}</span>
                <span className="timeline-cells" aria-hidden="true">
                  {line.days.map((level, index) => (
                    <span
                      key={days[index] ?? index}
                      className={`timeline-cell timeline-${level}`}
                      title={`${longDay.format(day(days[index] ?? first))}: ${LEVEL_TEXT[level]}`}
                    />
                  ))}
                </span>
                <span className="small timeline-sum">
                  {incidents === 0 && advisories === 0
                    ? "ohne Meldung"
                    : [
                        incidents > 0 && `${incidents} ${incidents === 1 ? "Tag" : "Tage"} Störung`,
                        advisories > 0 &&
                          `${advisories} ${advisories === 1 ? "Tag" : "Tage"} Hinweis`,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                </span>
                <span className="visually-hidden">
                  {line.days
                    .map((level, index) =>
                      level === "ok"
                        ? null
                        : `${dayFormat.format(day(days[index] ?? first))} ${LEVEL_TEXT[level]}`,
                    )
                    .filter(Boolean)
                    .join("; ")}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="small timeline-legend">
          <span className="timeline-key timeline-stoerung" aria-hidden="true" /> Störung{" "}
          <span className="timeline-key timeline-hinweis" aria-hidden="true" /> Hinweis{" "}
          <span className="timeline-key timeline-ok" aria-hidden="true" /> keine Meldung · Tage in
          UTC, die schwerste Meldung des Tages zählt.
        </p>
      </div>
    </section>
  );
}

/** Stunden mit Störung je Dienst in einem Jahr, als waagerechte Balken. */
function Durations({ health }: { health: Health }) {
  const years = [...new Set(health.stats.map((entry) => entry.year))].sort((a, b) => b - a);
  const [year, setYear] = useState<number | null>(null);
  const shown = year ?? years[0];
  const rows = health.stats.filter((entry) => entry.year === shown);
  const max = Math.max(1, ...rows.map((entry) => entry.incident_hours));
  if (shown === undefined) {
    return null;
  }
  return (
    <section className="panel" aria-labelledby="health-dauer">
      <div className="panel-head">
        <h2 id="health-dauer">Ausfalldauer je Dienst</h2>
        <div className="chips" role="group" aria-label="Jahr">
          {years.map((entry) => (
            <button
              type="button"
              key={entry}
              className="chip chip-filter"
              aria-pressed={entry === shown}
              onClick={() => setYear(entry)}
            >
              {entry}
            </button>
          ))}
        </div>
      </div>
      <ul className="detail-body hbars">
        {rows.map((entry) => (
          <li key={entry.service_id} className="hbar-row">
            <span className="hbar-name">{entry.service_name}</span>
            <span className="hbar-track" aria-hidden="true">
              <span
                className={entry.incident_hours > 0 ? "hbar" : "hbar hbar-empty"}
                style={{ width: `${Math.max((entry.incident_hours / max) * 100, 0.5)}%` }}
              />
            </span>
            <span className="hbar-value">
              {HOURS.format(entry.incident_hours)} Std.
              <span className="small">
                {" "}
                · {entry.incidents} {entry.incidents === 1 ? "Störung" : "Störungen"}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Störungen je Monat (Monat des Beginns), wählbar je Dienst. */
function Monthly({ health }: { health: Health }) {
  const [service, setService] = useState<string | null>(null);
  const services = health.timeline.map((line) => [line.service_id, line.service_name] as const);
  const months = monthlyIncidents(health.months, service);
  if (months.length === 0) {
    return null;
  }
  const max = Math.max(1, ...months.map((entry) => entry.incidents));
  const total = months.reduce((sum, entry) => sum + entry.incidents, 0);
  return (
    <section className="panel" aria-labelledby="health-monate">
      <div className="panel-head">
        <h2 id="health-monate">Störungen pro Monat</h2>
        <span className="small">
          letzte {months.length} Monate · {total} insgesamt
        </span>
      </div>
      <div className="detail-body">
        <div className="chips" role="group" aria-label="Dienst">
          <button
            type="button"
            className="chip chip-filter"
            aria-pressed={service === null}
            onClick={() => setService(null)}
          >
            Alle Dienste
          </button>
          {services.map(([id, name]) => (
            <button
              type="button"
              key={id}
              className="chip chip-filter"
              aria-pressed={service === id}
              onClick={() => setService(id)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="chart chart-dense" aria-hidden="true">
        {months.map((entry, index) => (
          <div
            className="chart-col"
            key={entry.month}
            title={`${monthLong.format(month(entry.month))}: ${entry.incidents}`}
          >
            <span className="chart-value">{entry.incidents > 0 ? entry.incidents : ""}</span>
            <span
              className={entry.incidents > 0 ? "chart-bar" : "chart-bar chart-bar-empty"}
              style={{ height: `${Math.round((entry.incidents / max) * 100)}%` }}
            />
            <span className="chart-label">
              {/* Jeden dritten Monat beschriften, den laufenden immer */}
              {(months.length - 1 - index) % 3 === 0 ? monthShort.format(month(entry.month)) : ""}
            </span>
          </div>
        ))}
      </div>
      <table className="visually-hidden">
        <caption>Störungen je Monat</caption>
        <thead>
          <tr>
            <th scope="col">Monat</th>
            <th scope="col">Störungen</th>
          </tr>
        </thead>
        <tbody>
          {months.map((entry) => (
            <tr key={entry.month}>
              <td>{monthLong.format(month(entry.month))}</td>
              <td>{entry.incidents}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Auswertungen des Dienststatus: Zeitleiste, Ausfalldauer und Störungen pro Monat. */
export function HealthCharts({ health }: { health: Health }) {
  return (
    <>
      <Timeline health={health} />
      <Durations health={health} />
      <Monthly health={health} />
    </>
  );
}
