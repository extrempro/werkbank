import { useEffect, useState } from "react";
import { errorText, formatDateTime } from "../../../api";
import { InfoTip } from "../../../components/InfoTip";
import {
  fetchZabbixReport,
  reportCsvUrl,
  reportPrinted,
  type ReportSplit,
  type ZbxReport,
} from "./api";
import { Feedback } from "../../../components/Feedback";

const percent = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Verfügbarkeit in Prozent, abgeschnitten statt gerundet: 99,996 % wird nie zu 100,00 %. */
export function formatPercent(value: number | null): string {
  if (value === null) {
    return "–";
  }
  return `${percent.format(Math.floor(value * 100) / 100)} %`;
}

/** Dauer in Tagen, Stunden und Minuten, z. B. „1 Tg. 2 Std. 5 Min.“. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) {
    return "0 Min.";
  }
  const minutes = Math.round(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [
    days > 0 ? `${days} Tg.` : null,
    hours > 0 ? `${hours} Std.` : null,
    rest > 0 || (days === 0 && hours === 0) ? `${Math.max(rest, 1)} Min.` : null,
  ];
  return parts.filter(Boolean).join(" ");
}

function formatDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${date}.${month}.${year}`;
}

function TargetPill({ value, target }: { value: number | null; target: number }) {
  if (value === null) {
    return <span className="pill pill-neutral">keine Daten</span>;
  }
  return value >= target ? (
    <span className="pill pill-ok">
      <span aria-hidden="true">✓ </span>Ziel erreicht
    </span>
  ) : (
    <span className="pill pill-bad">
      <span aria-hidden="true">! </span>unter Ziel
    </span>
  );
}

export function ZabbixReportsPage() {
  const [year, setYear] = useState<number | null>(null);
  const [split, setSplit] = useState<ReportSplit>("standort");
  const [data, setData] = useState<ZbxReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchZabbixReport(year, split).then(
      (value) => {
        if (active) {
          setData(value);
          setError(null);
        }
      },
      (caught: unknown) =>
        active && setError(errorText(caught, "Der Bericht konnte nicht geladen werden.")),
    );
    return () => {
      active = false;
    };
  }, [year, split]);

  const print = () => {
    if (!data) {
      return;
    }
    setMessage(null);
    reportPrinted(data.year, data.split).then(
      () => window.print(),
      (caught: unknown) => setMessage(errorText(caught, "Der Druck ließ sich nicht starten.")),
    );
  };

  const splitLabel = split === "standort" ? "Standort" : "Hostgruppe";

  return (
    <div className="page page-wide zbx-report">
      <header className="page-head zbx-head">
        <div>
          <p className="module-label">IT-Monitoring · Zabbix</p>
          <h1>Berichte</h1>
          <p className="page-sub">
            {data
              ? `Verfügbarkeit der überwachten Hosts im ${data.year_label} ${data.name}.`
              : "Verfügbarkeit der überwachten Hosts je Geschäftsjahr."}
          </p>
        </div>
      </header>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">Wird geladen …</p>}
      {data && (
        <>
          <div className="panel filter-bar no-print">
            <div className="filter-row zbx-report-filter">
              <label className="filter-field">
                {data.year_label}
                <select value={data.year} onChange={(event) => setYear(Number(event.target.value))}>
                  {data.years.map((entry) => (
                    <option key={entry.year} value={entry.year}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                Aufteilen nach
                <select
                  value={split}
                  onChange={(event) => setSplit(event.target.value as ReportSplit)}
                >
                  <option value="standort">Standort</option>
                  <option value="gruppe">Hostgruppe</option>
                </select>
              </label>
              <div className="filter-actions">
                <a
                  className="button button-secondary"
                  href={reportCsvUrl(data.year, data.split)}
                  download
                >
                  Als CSV exportieren
                </a>
                <button type="button" className="button button-secondary" onClick={print}>
                  Drucken oder als PDF
                </button>
              </div>
            </div>
          </div>
          <Feedback
            message={message ? { kind: "alert", text: message } : null}
            onClose={() => setMessage(null)}
          />
          <p className="print-only small">
            Ausgedruckt am {formatDateTime(new Date().toISOString())} · aufgeteilt nach {splitLabel}
          </p>
          <p className="small zbx-report-since">
            {data.since
              ? `Daten seit ${formatDay(data.since)}, ${data.days} ${data.days === 1 ? "abgeschlossener Tag" : "abgeschlossene Tage"} in diesem ${data.year_label}. `
              : "Die Werkbank sammelt die Daten für die Berichte ab dem ersten Abruf von Zabbix. "}
            Die Daten eines Tages kommen am Folgetag dazu.
          </p>

          <dl className="kpis">
            <div className="kpi">
              <dt>
                Verfügbarkeit <InfoTip term="zabbix.verfuegbarkeit" />
              </dt>
              <dd className="kpi-number">{formatPercent(data.availability)}</dd>
              <dd className="small">
                <TargetPill value={data.availability} target={data.target} />
              </dd>
            </div>
            <div className="kpi">
              <dt>
                Zielwert <InfoTip term="zabbix.zielwert" />
              </dt>
              <dd className="kpi-number">{formatPercent(data.target)}</dd>
              <dd className="small">für jeden Standort und jede Gruppe</dd>
            </div>
            <div className="kpi">
              <dt>
                Ausfall <InfoTip term="zabbix.ausfall" />
              </dt>
              <dd className="kpi-number">{formatDuration(data.downtime_s)}</dd>
              <dd className="small">
                Wartung, nicht mitgezählt: {formatDuration(data.maintenance_s)}
              </dd>
            </div>
            <div className="kpi">
              <dt>Hosts</dt>
              <dd className="kpi-number">{data.hosts}</dd>
              <dd className="small">mit überwachter Zeit im Zeitraum</dd>
            </div>
          </dl>

          <section className="panel" aria-labelledby="zbx-report-rows">
            <div className="panel-head">
              <h2 id="zbx-report-rows">Nach {splitLabel}</h2>
            </div>
            {data.rows.length === 0 ? (
              <p className="empty">Noch keine Daten für diesen Zeitraum.</p>
            ) : (
              <div className="table-wrap card-wrap">
                <table className="table-cards">
                  <thead>
                    <tr>
                      <th scope="col">{splitLabel}</th>
                      <th scope="col">Hosts</th>
                      <th scope="col">Verfügbarkeit</th>
                      <th scope="col">Ausfall</th>
                      <th scope="col">Ziel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.name}>
                        <th scope="row">{row.name}</th>
                        <td data-label="Hosts">{row.hosts}</td>
                        <td data-label="Verfügbarkeit" className="nowrap">
                          {formatPercent(row.availability)}
                        </td>
                        <td data-label="Ausfall" className="nowrap">
                          {formatDuration(row.downtime_s)}
                        </td>
                        <td data-label="Ziel">
                          <TargetPill value={row.availability} target={data.target} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="zbx-report-months">
            <div className="panel-head">
              <h2 id="zbx-report-months">Monatsübersicht</h2>
            </div>
            <div className="table-wrap card-wrap">
              <table className="table-cards">
                <thead>
                  <tr>
                    <th scope="col">Monat</th>
                    <th scope="col">Verfügbarkeit</th>
                    <th scope="col">Ausfall</th>
                    <th scope="col">Ziel</th>
                  </tr>
                </thead>
                <tbody>
                  {data.months.map((month) => (
                    <tr key={month.month}>
                      <th scope="row">{month.label}</th>
                      <td data-label="Verfügbarkeit" className="nowrap">
                        {formatPercent(month.availability)}
                      </td>
                      <td data-label="Ausfall">
                        {month.availability === null ? "–" : formatDuration(month.downtime_s)}
                      </td>
                      <td data-label="Ziel">
                        {month.availability === null ? (
                          "–"
                        ) : (
                          <TargetPill value={month.availability} target={data.target} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {data.triggers && (
            <section className="panel" aria-labelledby="zbx-report-triggers">
              <div className="panel-head">
                <h2 id="zbx-report-triggers">Häufigste Auslöser</h2>
              </div>
              {data.triggers.length === 0 ? (
                <p className="empty">Keine Probleme in diesem Zeitraum.</p>
              ) : (
                <div className="table-wrap card-wrap">
                  <table className="table-cards">
                    <thead>
                      <tr>
                        <th scope="col">Auslöser</th>
                        <th scope="col">Host</th>
                        <th scope="col">Anzahl</th>
                        <th scope="col">Dauer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.triggers.map((item) => (
                        <tr key={`${item.name}-${item.host}`}>
                          <th scope="row">{item.name}</th>
                          <td data-label="Host">{item.host || "–"}</td>
                          <td data-label="Anzahl">{item.count}</td>
                          <td data-label="Dauer" className="nowrap">
                            {formatDuration(item.duration_s)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {data.outages && (
            <section className="panel" aria-labelledby="zbx-report-outages">
              <div className="panel-head">
                <h2 id="zbx-report-outages">Längste Ausfälle</h2>
              </div>
              {data.outages.length === 0 ? (
                <p className="empty">Keine Ausfälle in diesem Zeitraum.</p>
              ) : (
                <div className="table-wrap card-wrap">
                  <table className="table-cards">
                    <thead>
                      <tr>
                        <th scope="col">Host</th>
                        <th scope="col">Auslöser</th>
                        <th scope="col">Beginn</th>
                        <th scope="col">Ende</th>
                        <th scope="col">Dauer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.outages.map((item) => (
                        <tr key={`${item.host}-${item.started_at}`}>
                          <th scope="row">
                            {item.host}
                            {item.site && <span className="small"> · {item.site}</span>}
                          </th>
                          <td data-label="Auslöser">{item.name}</td>
                          <td data-label="Beginn" className="nowrap">
                            {formatDateTime(item.started_at)}
                          </td>
                          <td data-label="Ende" className="nowrap">
                            {item.ended_at ? formatDateTime(item.ended_at) : "läuft noch"}
                          </td>
                          <td data-label="Dauer" className="nowrap">
                            {formatDuration(item.duration_s)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
