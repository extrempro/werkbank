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

/** Was auffällt: Konten, die mehr binden als geplant, und Verträge ohne AVV. */
function notices(overview: Overview, contracts: Contract[]): Notice[] {
  const found: Notice[] = [];
  for (const row of overview.rows) {
    const name = `${row.account.number} ${row.account.name}`;
    if (row.plan_cents === null && row.committed_cents > 0) {
      found.push({
        kind: "Plan",
        tone: "todo",
        text: `${name}: ${formatEuro(row.committed_cents)} aus Verträgen, aber kein Plan.`,
      });
    } else if (row.plan_cents !== null && row.committed_cents > row.plan_cents) {
      found.push({
        kind: "Budget",
        tone: "bad",
        text: `${name}: Verträge binden ${formatEuro(row.committed_cents - row.plan_cents)} mehr als geplant.`,
      });
    }
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

/** Balken „gebunden vom Plan“. Als SVG, weil die Breite ohne Inline-Style gesetzt wird. */
function Bar({ percent, over, label }: { percent: number; over: boolean; label: string }) {
  return (
    <svg
      className="budget-track"
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <rect className="budget-track-bg" width="100" height="10" />
      <rect className={over ? "budget-fill-over" : "budget-fill"} width={percent} height="10" />
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
  const free = overview ? overview.plan.total_cents - overview.committed.total_cents : 0;
  const bars = overview?.rows.filter((row) => row.plan_cents !== null || row.committed_cents > 0);

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
                Plan {label} {overview.year_name}
              </dt>
              <dd className="budget-card-value">{formatEuro(overview.plan.total_cents)}</dd>
              <dd className="budget-card-sub">
                Vorjahr {formatEuro(overview.previous.total_cents)}
              </dd>
            </div>
            <div className="panel budget-card">
              <dt>Durch Verträge gebunden</dt>
              <dd className="budget-card-value">{formatEuro(overview.committed.total_cents)}</dd>
              <dd className="budget-card-sub">
                {share(overview.committed.total_cents, overview.plan.total_cents)} % des Plans ·{" "}
                {overview.committed_contracts}{" "}
                {overview.committed_contracts === 1 ? "Vertrag" : "Verträge"}
              </dd>
            </div>
            <div className="panel budget-card">
              <dt>Noch frei</dt>
              <dd className="budget-card-value">{formatEuro(free)}</dd>
              <dd className={free < 0 ? "budget-card-sub budget-bad" : "budget-card-sub budget-ok"}>
                {free < 0 ? "mehr gebunden als geplant" : "Plan abzüglich gebunden"}
              </dd>
            </div>
            <div className="panel budget-card">
              <dt>Laufende Kosten / Investitionen</dt>
              <dd className="budget-card-value">{formatEuro(overview.plan.running_cents)}</dd>
              <dd className="budget-card-sub">
                dazu {formatEuro(overview.plan.investment_cents)} Investitionen
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
                        gebunden
                      </li>
                      <li>
                        <span className="budget-dot budget-dot-over" aria-hidden="true" />
                        über Plan
                      </li>
                    </ul>
                  </div>
                  {bars && bars.length > 0 ? (
                    bars.map((row) => {
                      const plan = row.plan_cents ?? 0;
                      const over = row.committed_cents > plan;
                      const percent = share(row.committed_cents, plan);
                      return (
                        <div className="budget-bar" key={row.account.id}>
                          <div className="budget-bar-head">
                            <span>
                              <strong>{row.account.number}</strong> {row.account.name}
                            </span>
                            <span className="betrag budget-muted">
                              {formatEuro(row.committed_cents)} von {amount(row.plan_cents)}
                            </span>
                          </div>
                          <Bar
                            percent={percent}
                            over={over}
                            label={`${row.account.name}: ${percent} % des Plans durch Verträge gebunden`}
                          />
                        </div>
                      );
                    })
                  ) : (
                    <p className="budget-muted">
                      Für dieses Jahr ist noch nichts geplant und nichts gebunden.
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
                Geplant wird je Budgetposten: <Link to={BUDGET_ITEMS_PATH}>Budgetposten</Link>.
                Gebunden = was aus Verträgen in diesem {label} zu erwarten ist. Alle Beträge sind
                brutto.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
