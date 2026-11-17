import { useEffect, useState } from "react";
import { formatDateTime } from "../../api";
import { formatDay, LineChart } from "../../components/LineChart";
import { fetchUsage, formatCount, USAGE_PERIODS, type ServiceUsage, type Usage } from "./api";
import { PeriodSelect } from "./PeriodSelect";

const percentFormat = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });

function share(entry: ServiceUsage): string {
  if (entry.active === null || entry.inactive === null) {
    return "keine Daten";
  }
  const total = entry.active + entry.inactive;
  if (total === 0) {
    return "keine Benutzer";
  }
  return `${formatCount(entry.inactive)} inaktiv · ${percentFormat.format((entry.active / total) * 100)} % aktiv`;
}

/** Microsoft 365 › Tenant › Nutzung: aktive Benutzer je Dienst. Nur Summen, keine Personen. */
export function UsagePage() {
  const [days, setDays] = useState(30);
  const [service, setService] = useState("exchange");
  const [data, setData] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchUsage(days)
      .then((result) => {
        if (active) {
          setData(result);
          setFailed(false);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [days]);

  const hasData = data !== null && data.services.some((entry) => entry.active !== null);
  const chosen = data?.services.find((entry) => entry.service === service);
  const history = data?.history ?? [];

  return (
    <div className="page">
      <header className="page-head">
        <p className="module-label">Microsoft 365 › Tenant</p>
        <h1>Nutzung</h1>
        <p className="page-sub">
          Wie viele Benutzer die Dienste im gewählten Zeitraum genutzt haben. Inaktiv heißt: mit
          Lizenz für den Dienst, aber im Zeitraum nicht aktiv. Die Werkbank liest und speichert nur
          Summen, keine Namen.
        </p>
      </header>

      <PeriodSelect days={days} onChange={setDays} periods={USAGE_PERIODS} />

      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Nutzung konnte nicht geladen werden.
        </p>
      )}
      {!failed && !data && <p role="status">Wird geladen …</p>}
      {data && !hasData && (
        <p className="panel panel-empty">
          {data.enabled
            ? "Es wurden noch keine Nutzungsberichte gelesen. Der erste Abruf läuft innerhalb einer Stunde nach dem Einschalten."
            : "Der Abruf der Nutzung ist in dieser Installation nicht eingeschaltet (siehe Anleitung zur Einrichtung)."}
        </p>
      )}
      {data && hasData && (
        <>
          <dl className="kpis">
            {data.services.map((entry) => (
              <div className="kpi" key={entry.service}>
                <dt>{entry.name}</dt>
                <dd className="kpi-number">
                  {entry.active === null ? "–" : formatCount(entry.active)}
                </dd>
                <dd className="small">{share(entry)}</dd>
              </div>
            ))}
          </dl>
          <p className="small" role="status">
            Aktive Benutzer in den letzten {data.days} Tagen
            {data.report_date ? ` bis ${formatDay(data.report_date)}` : ""} (Bericht von Microsoft,
            meist zwei Tage Verzug). Abgerufen{" "}
            {data.fetched_at ? formatDateTime(data.fetched_at) : "–"}.
          </p>
          <section className="panel" aria-labelledby="nutzung-verlauf">
            <div className="panel-head">
              <h2 id="nutzung-verlauf">Aktive Benutzer je Tag</h2>
              <div className="chips" role="group" aria-label="Dienst">
                {data.services.map((entry) => (
                  <button
                    type="button"
                    key={entry.service}
                    className="chip chip-filter"
                    aria-pressed={service === entry.service}
                    onClick={() => setService(entry.service)}
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
            </div>
            {history.length === 0 ? (
              <p className="empty">Für diesen Zeitraum gibt es noch keine Tageswerte.</p>
            ) : (
              <LineChart
                title={`Aktive Benutzer je Tag: ${chosen?.name ?? service}`}
                days={history.map((entry) => entry.day)}
                series={[
                  {
                    id: service,
                    label: chosen?.name ?? service,
                    values: history.map((entry) => entry.values[service] ?? null),
                  },
                ]}
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
