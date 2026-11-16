import { useEffect, useState } from "react";
import { exportUrl, fetchPlanning, formatEuro, runtimeText, type Planning } from "./api";
import { StatusPill } from "./ItemsPage";
import { BudgetHead } from "./shared";

/** IT-Budget › Mehrjahresübersicht: erwartete Kosten, Ist und Status über fünf Geschäftsjahre. */
export function PlanningPage() {
  // Ausblick: das laufende und die vier folgenden Jahre; Rückblick: die fünf bis zum laufenden
  const [back, setBack] = useState(false);
  const [data, setData] = useState<Planning | null>(null);
  const [failed, setFailed] = useState(false);
  const current = data?.current_year ?? null;
  const start = back && current !== null ? current - 4 : null;

  useEffect(() => {
    let active = true;
    fetchPlanning(start)
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
  }, [start]);

  const label = data?.year_label ?? "Geschäftsjahr";
  // Die gezeigten Jahre gehören zur gewählten Sicht; bis die Antwort da ist, bleibt die alte.
  const years = data?.years ?? [];
  const first = years[0];
  const last = years[years.length - 1];
  const rangeName = first && last ? `${first.name} bis ${last.name}` : "";

  return (
    <div className="page page-wide budget-page">
      <BudgetHead
        title="Mehrjahresübersicht"
        sub="Erwartete Kosten, Ist und Status aller Budgetposten über fünf Jahre. Die Zahlen ergeben sich aus Laufzeit und Rechnungen; geändert wird am Budgetposten. Alle Beträge sind brutto."
      />
      <div className="budget-toolbar budget-toolbar-split">
        <div className="chips" role="group" aria-label="Zeitraum">
          <button
            type="button"
            className="chip chip-filter"
            aria-pressed={!back}
            onClick={() => setBack(false)}
          >
            Ausblick: nächste fünf Jahre
          </button>
          <button
            type="button"
            className="chip chip-filter"
            aria-pressed={back}
            onClick={() => setBack(true)}
          >
            Rückblick: letzte fünf Jahre
          </button>
        </div>
        {data && (
          <a className="button button-secondary" href={exportUrl(start)} download>
            Als Excel-Datei herunterladen
          </a>
        )}
      </div>
      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Mehrjahresübersicht konnte nicht geladen werden.
        </p>
      )}
      {!failed && !data && <p role="status">Wird geladen …</p>}
      {data && data.rows.length === 0 && (
        <p className="panel panel-empty">Im Zeitraum {rangeName} läuft kein Budgetposten.</p>
      )}
      {data && data.rows.length > 0 && (
        <div
          className="table-wrap budget-table"
          tabIndex={0}
          role="region"
          aria-label={`Mehrjahresübersicht ${rangeName}`}
        >
          <table>
            <caption className="visually-hidden">
              Erwartete Kosten, Ist und Status je {label}, {rangeName}
            </caption>
            <thead>
              <tr>
                <th scope="col">Budgetposten</th>
                {years.map((year) => (
                  <th key={year.year} scope="col" className="betrag">
                    {year.name}
                    {year.year === data.current_year && (
                      <span className="small budget-muted tenant-part">läuft</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.item.id}>
                  <th scope="row">
                    {row.item.name}
                    <span className="small budget-muted tenant-part">
                      <span className="mono">{row.item.account_number}</span> ·{" "}
                      {runtimeText(row.item)}
                    </span>
                  </th>
                  {years.map((year) => {
                    const cell = row.years[String(year.year)];
                    if (!cell || cell.status === null) {
                      return (
                        <td key={year.year} className="betrag budget-muted">
                          –
                        </td>
                      );
                    }
                    return (
                      <td key={year.year} className="betrag">
                        {cell.expected_cents === null ? "–" : formatEuro(cell.expected_cents)}
                        <span className="small budget-muted tenant-part">
                          Ist {formatEuro(cell.actual_cents)}
                        </span>
                        <StatusPill status={cell.status} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="budget-summe">
                <th scope="row">Summe erwartet</th>
                {years.map((year) => (
                  <td key={year.year} className="betrag">
                    {formatEuro(year.expected_cents)}
                  </td>
                ))}
              </tr>
              <tr className="budget-summe">
                <th scope="row">Summe Ist</th>
                {years.map((year) => (
                  <td key={year.year} className="betrag">
                    {formatEuro(year.actual_cents)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
