import { useEffect, useState } from "react";
import { Link } from "../../components/Link";
import { BUDGET_ACCOUNTS_PATH, BUDGET_CONTRACTS_PATH, BUDGET_ITEMS_PATH } from "../../navigation";
import {
  BUDGET_EDITOR_ROLES,
  DEADLINE_WINDOW_DAYS,
  deadlineBadge,
  fetchBudgetOverview,
  rememberedYear,
  rememberYear,
  fetchContracts,
  formatBudgetDay,
  formatEuro,
  share,
  type Contract,
  type Overview,
} from "./api";
import { ReadOnlyNote } from "./shared";

function amount(cents: number | null): string {
  return cents === null ? "–" : formatEuro(cents);
}

interface Notice {
  kind: string;
  tone: "bad" | "todo";
  text: string;
}

/** Was auffällt: Konten über der Erwartung, offene Rechnungen und Verträge ohne AVV. */
function notices(overview: Overview, contracts: Contract[]): Notice[] {
  const found: Notice[] = [];
  for (const row of overview.rows) {
    const name = `${row.account.number} ${row.account.name}`;
    const expected = row.expected_cents ?? 0;
    if (row.forecast_cents > expected) {
      found.push({
        kind: "Budget",
        tone: "bad",
        text: `${name}: Prognose liegt ${formatEuro(row.forecast_cents - expected)} über der Erwartung.`,
      });
    }
  }
  if (overview.open_invoices > 0) {
    found.push({
      kind: "Rechnung",
      tone: "todo",
      text:
        overview.open_invoices === 1
          ? "1 Rechnung ist noch zu prüfen."
          : `${overview.open_invoices} Rechnungen sind noch zu prüfen.`,
    });
  }
  for (const contract of contracts) {
    if (contract.running && contract.dpa_status === "fehlt") {
      found.push({
        kind: "AVV",
        tone: "bad",
        text: `${contract.title}: Auftragsverarbeitungsvertrag fehlt.`,
      });
    }
  }
  return found;
}

/** Balken „Ist und Prognose von der Erwartung“. Als SVG, weil die Breite ohne Inline-Style gesetzt wird. */
function Bar({
  actual,
  forecast,
  over,
  label,
}: {
  actual: number;
  forecast: number;
  over: boolean;
  label: string;
}) {
  return (
    <svg
      className="budget-track"
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <rect className="budget-track-bg" width="100" height="10" />
      <rect
        className={over ? "budget-fill-over" : "budget-fill-forecast"}
        width={forecast}
        height="10"
      />
      <rect className="budget-fill" width={actual} height="10" />
    </svg>
  );
}

/** IT-Budget › Übersicht: Kennzahlen, Budget nach Konten, Fristen und Handlungsbedarf. */
export function BudgetOverviewPage({ roles }: { roles: readonly string[] }) {
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const [year, setYear] = useState<number | null>(rememberedYear);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchBudgetOverview(year)
      .then((result) => {
        if (active) {
          setOverview(result);
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
  }, [year]);

  useEffect(() => {
    let active = true;
    // Die Fristen sind eine Zugabe: Ohne sie bleibt die Übersicht nutzbar.
    fetchContracts()
      .then((result) => {
        if (active) {
          setContracts(result.entries);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const label = overview?.settings.year_label ?? "Geschäftsjahr";

  const upcoming = contracts
    .filter(
      (entry) =>
        entry.running &&
        entry.days_to_deadline !== null &&
        entry.days_to_deadline >= 0 &&
        entry.days_to_deadline <= DEADLINE_WINDOW_DAYS,
    )
    .sort((a, b) => (a.days_to_deadline ?? 0) - (b.days_to_deadline ?? 0));
  const attention = overview ? notices(overview, contracts) : [];
  const expected = overview?.expected.total_cents ?? 0;
  const delta = overview ? overview.forecast.total_cents - expected : 0;
  const bars = overview?.rows.filter(
    (row) => row.expected_cents !== null || row.forecast_cents > 0,
  );

  return (
    <div className="page page-wide budget-page">
      <header className="page-head budget-head">
        <div>
          <p className="module-label">IT-Budget</p>
          <h1>Übersicht</h1>
          {overview && (
            <p className="page-sub">
              {overview.settings.cost_center
                ? `Kostenstelle ${overview.settings.cost_center} · `
                : ""}
              {label} {overview.year_name}: {formatBudgetDay(overview.first_day)} bis{" "}
              {formatBudgetDay(overview.last_day)}
              {overview.year === overview.settings.current_year ? " · läuft gerade" : ""}
            </p>
          )}
        </div>
        {overview && (
          <div className="settings-form">
            <label className="narrow">
              {label}
              <select
                value={overview.year}
                onChange={(event) => {
                  rememberYear(Number(event.target.value));
                  setYear(Number(event.target.value));
                }}
              >
                {overview.years.map((entry) => (
                  <option key={entry.year} value={entry.year}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </header>
      <ReadOnlyNote roles={roles} />

      {failed && (
        <p role="alert" className="panel panel-empty">
          Das Budget konnte nicht geladen werden.
        </p>
      )}
      {!failed && !overview && <p role="status">Wird geladen …</p>}
      {overview && (
        <>
          <dl className="budget-cards">
            <div className="panel budget-card">
              <dt>
                Erwartet {label} {overview.year_name}
              </dt>
              <dd className="budget-card-value">{formatEuro(expected)}</dd>
              <dd className="budget-card-sub">
                Vorjahr {formatEuro(overview.previous.total_cents)}
              </dd>
            </div>
            <div className="panel budget-card">
              <dt>Offene Budgetposten</dt>
              <dd className="budget-card-value">{overview.statuses.open}</dd>
              <dd className="budget-card-sub">
                {overview.statuses.invoiced} mit Rechnung · {overview.statuses.closed}{" "}
                abgeschlossen
              </dd>
            </div>
            <div className="panel budget-card">
              <dt>Ist bis heute</dt>
              <dd className="budget-card-value">{formatEuro(overview.actual.total_cents)}</dd>
              <dd className="budget-card-sub">
                {share(overview.actual.total_cents, expected)} % der Erwartung
                {overview.open_invoices > 0
                  ? ` · ${overview.open_invoices} ${overview.open_invoices === 1 ? "Rechnung" : "Rechnungen"} zu prüfen`
                  : ""}
              </dd>
            </div>
            <div className="panel budget-card">
              <dt>Prognose Jahresende</dt>
              <dd className="budget-card-value">{formatEuro(overview.forecast.total_cents)}</dd>
              <dd
                className={delta > 0 ? "budget-card-sub budget-bad" : "budget-card-sub budget-ok"}
              >
                {delta > 0
                  ? `${formatEuro(delta)} über der Erwartung`
                  : delta < 0
                    ? `${formatEuro(-delta)} unter der Erwartung`
                    : "wie erwartet"}
              </dd>
            </div>
          </dl>

          {overview.rows.length === 0 ? (
            <p className="panel panel-empty">
              Es sind noch keine Konten angelegt.{" "}
              {canEdit && <Link to={BUDGET_ACCOUNTS_PATH}>Konten anlegen</Link>}
            </p>
          ) : (
            <>
              <div className="budget-columns">
                <section className="panel budget-section budget-main" aria-labelledby="budget-bars">
                  <div className="budget-section-head">
                    <h2 id="budget-bars">Budget nach Konten</h2>
                    <ul className="budget-legend" aria-label="Legende">
                      <li>
                        <span className="budget-dot budget-dot-bound" aria-hidden="true" />
                        Ist
                      </li>
                      <li>
                        <span className="budget-dot budget-dot-forecast" aria-hidden="true" />
                        Prognose
                      </li>
                      <li>
                        <span className="budget-dot budget-dot-over" aria-hidden="true" />
                        über der Erwartung
                      </li>
                    </ul>
                  </div>
                  {bars && bars.length > 0 ? (
                    bars.map((row) => {
                      const plan = row.expected_cents ?? 0;
                      const over = row.forecast_cents > plan;
                      const actual = share(row.actual_cents, plan);
                      const forecast = share(row.forecast_cents, plan);
                      return (
                        <div className="budget-bar" key={row.account.id}>
                          <div className="budget-bar-head">
                            <span>
                              <strong>{row.account.number}</strong> {row.account.name}
                            </span>
                            <span className="betrag budget-muted">
                              {formatEuro(row.forecast_cents)} von {amount(row.expected_cents)}
                            </span>
                          </div>
                          <Bar
                            actual={actual}
                            forecast={forecast}
                            over={over}
                            label={`${row.account.name}: Ist ${actual} %, Prognose ${forecast} % der Erwartung`}
                          />
                        </div>
                      );
                    })
                  ) : (
                    <p className="budget-muted">
                      Für dieses Jahr ist noch nichts erwartet oder gebucht.
                    </p>
                  )}
                </section>

                <div className="budget-side">
                  <section className="panel budget-section" aria-labelledby="budget-fristen">
                    <h2 id="budget-fristen">
                      Kündigungstermine – nächste {DEADLINE_WINDOW_DAYS} Tage
                    </h2>
                    {upcoming.length === 0 ? (
                      <p className="budget-muted">Kein Termin in diesem Zeitraum.</p>
                    ) : (
                      <ul className="budget-list">
                        {upcoming.map((entry) => {
                          const badge = deadlineBadge(entry);
                          return (
                            <li key={entry.id}>
                              <span>
                                <Link to={`${BUDGET_CONTRACTS_PATH}/${entry.id}`}>
                                  {entry.title}
                                </Link>
                                <span className="budget-muted budget-line">
                                  {entry.partner_name} · kündbar bis{" "}
                                  {entry.notice_deadline
                                    ? formatBudgetDay(entry.notice_deadline)
                                    : "–"}
                                </span>
                              </span>
                              {badge && (
                                <span className={`pill pill-${badge.tone}`}>{badge.text}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </section>
                  <section className="panel budget-section" aria-labelledby="budget-bedarf">
                    <h2 id="budget-bedarf">Handlungsbedarf</h2>
                    {attention.length === 0 ? (
                      <p className="budget-muted">Nichts zu tun.</p>
                    ) : (
                      <ul className="budget-list budget-list-start">
                        {attention.map((entry) => (
                          <li key={entry.text}>
                            <span className={`pill pill-${entry.tone}`}>{entry.kind}</span>
                            <span>{entry.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </div>

              <p className="small budget-muted">
                Erwartete Kosten stehen am <Link to={BUDGET_ITEMS_PATH}>Budgetposten</Link>. Ist =
                gebuchte Rechnungen. Prognose = bei abgeschlossenen Posten das Ist, sonst das Höhere
                aus Erwartung und Ist. Verträge sind Posten nur zugeordnet; ins Budget gehen ihre
                Kosten über die Rechnungen. Alle Beträge sind brutto.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
