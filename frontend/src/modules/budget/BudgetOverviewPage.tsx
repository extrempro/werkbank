import { InfoTip } from "../../components/InfoTip";
import { useEffect, useState } from "react";
import { Link } from "../../components/Link";
import {
  BUDGET_ACCOUNTS_PATH,
  BUDGET_CONTRACTS_PATH,
  BUDGET_INVOICES_PATH,
  BUDGET_ITEMS_PATH,
} from "../../navigation";
import {
  BUDGET_EDITOR_ROLES,
  DEADLINE_WINDOW_DAYS,
  deadlineBadge,
  fetchBudgetOverview,
  rememberedYear,
  rememberYear,
  fetchContracts,
  fetchInvoices,
  formatBudgetDay,
  KIND_LABELS,
  formatEuro,
  share,
  type Contract,
  type Invoice,
  type Overview,
} from "./api";
import { ReadOnlyNote } from "./shared";

function amount(cents: number | null): string {
  return cents === null ? "–" : formatEuro(cents);
}

interface Todo {
  count: number;
  text: string;
  sub: string;
  tone: "todo" | "bad" | "info";
  to: string;
}

/** Was zu tun ist, mit Sprung in die passende Liste. */
function todos(overview: Overview, contracts: Contract[]): Todo[] {
  const found: Todo[] = [];
  if (overview.open_invoices > 0) {
    found.push({
      count: overview.open_invoices,
      text: overview.open_invoices === 1 ? "Rechnung zu prüfen" : "Rechnungen zu prüfen",
      sub: "erst gebucht zählen sie zum Ist",
      tone: "todo",
      to: BUDGET_INVOICES_PATH,
    });
  }
  const withoutPartner = overview.items.filter((row) => !row.item.partner_id).length;
  if (withoutPartner > 0) {
    found.push({
      count: withoutPartner,
      text: withoutPartner === 1 ? "Posten ohne Partner" : "Posten ohne Partner",
      sub: "beim nächsten Bearbeiten wählen",
      tone: "info",
      to: BUDGET_ITEMS_PATH,
    });
  }
  const soon = contracts.filter(
    (entry) =>
      entry.running &&
      entry.days_to_deadline !== null &&
      entry.days_to_deadline >= 0 &&
      entry.days_to_deadline <= DEADLINE_WINDOW_DAYS,
  ).length;
  if (soon > 0) {
    found.push({
      count: soon,
      text: soon === 1 ? "Kündigungstermin" : "Kündigungstermine",
      sub: `in den nächsten ${DEADLINE_WINDOW_DAYS} Tagen`,
      tone: "todo",
      to: BUDGET_CONTRACTS_PATH,
    });
  }
  const missing = contracts.filter((entry) => entry.running && entry.dpa_status === "fehlt").length;
  if (missing > 0) {
    found.push({
      count: missing,
      text: missing === 1 ? "Vertrag ohne AVV" : "Verträge ohne AVV",
      sub: "Auftragsverarbeitungsvertrag nachreichen",
      tone: "bad",
      to: BUDGET_CONTRACTS_PATH,
    });
  }
  const over = overview.rows.filter(
    (row) => row.expected_cents !== null && row.actual_cents > row.expected_cents,
  ).length;
  if (over > 0) {
    found.push({
      count: over,
      text: over === 1 ? "Konto über dem Plan" : "Konten über dem Plan",
      sub: "Ist liegt über den geplanten Kosten",
      tone: "bad",
      to: BUDGET_ITEMS_PATH,
    });
  }
  return found;
}

/** Balken „Ist vom Geplanten“. Als SVG, weil die Breite ohne Inline-Style gesetzt wird. */
function Bar({ used, over, label }: { used: number; over: boolean; label: string }) {
  return (
    <svg
      className="budget-track"
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <rect className="budget-track-bg" width="100" height="10" />
      <rect className={over ? "budget-fill-over" : "budget-fill"} width={used} height="10" />
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
  const todoList = overview ? todos(overview, contracts) : [];
  const expected = overview?.expected.total_cents ?? 0;
  const actual = overview?.actual.total_cents ?? 0;
  const groups = (["laufend", "investition"] as const).map((kind) => ({
    kind,
    rows: (overview?.rows ?? []).filter(
      (row) => row.account.kind === kind && (row.expected_cents !== null || row.actual_cents > 0),
    ),
  }));
  const [booked, setBooked] = useState<Invoice[]>([]);
  const shownYear = overview?.year ?? null;
  useEffect(() => {
    if (shownYear === null) {
      return;
    }
    let active = true;
    // Zuletzt gebucht ist eine Zugabe: Ohne sie bleibt die Übersicht nutzbar.
    fetchInvoices(shownYear)
      .then((list) => {
        if (active) {
          setBooked(
            list.entries
              .filter((entry) => entry.status === "gebucht")
              .sort((left, right) =>
                (right.booked_at ?? right.invoice_date).localeCompare(
                  left.booked_at ?? left.invoice_date,
                ),
              )
              .slice(0, 5),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [shownYear]);

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
          {todoList.length > 0 && (
            <section aria-labelledby="budget-todo" className="budget-todos-wrap">
              <h2 id="budget-todo" className="budget-todo-title">
                Zu erledigen
              </h2>
              <ul className="budget-todos">
                {todoList.map((entry) => (
                  <li key={entry.text}>
                    <Link to={entry.to} className="panel budget-todo">
                      <span className={`budget-todo-count budget-todo-${entry.tone}`}>
                        {entry.count}
                      </span>{" "}
                      <span>
                        <strong>{entry.text}</strong>{" "}
                        <span className="small budget-muted tenant-part">{entry.sub}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <dl className="budget-cards">
            <div className="panel budget-card">
              <dt>
                Geplant {overview.year_name} <InfoTip term="budget.geplant" />
              </dt>
              <dd className="budget-card-value">{formatEuro(expected)}</dd>
              <dd className="budget-card-sub">
                Vorjahr {formatEuro(overview.previous.total_cents)}
              </dd>
            </div>
            <div className="panel budget-card">
              <dt>
                Ist bis heute <InfoTip term="budget.ist" />
              </dt>
              <dd className="budget-card-value">{formatEuro(actual)}</dd>
              <dd className="budget-card-sub">{share(actual, expected)} % des Geplanten</dd>
            </div>
            <div className="panel budget-card">
              <dt>
                Verfügbar <InfoTip term="budget.verfuegbar" />
              </dt>
              <dd className="budget-card-value">{formatEuro(expected - actual)}</dd>
              <dd
                className={expected - actual < 0 ? "budget-card-sub budget-bad" : "budget-card-sub"}
              >
                {expected - actual < 0 ? "über dem Plan" : "noch nicht ausgegeben"}
              </dd>
            </div>
            <div className="panel budget-card">
              <dt>Budgetposten</dt>
              <dd className="budget-card-value">
                {overview.statuses.open + overview.statuses.invoiced + overview.statuses.closed}
              </dd>
              <dd className="budget-card-sub">
                {overview.statuses.open} offen · {overview.statuses.invoiced} mit Rechnung ·{" "}
                {overview.statuses.closed} abgeschlossen
              </dd>
            </div>
          </dl>

          {overview.rows.length === 0 ? (
            <p className="panel panel-empty">
              Es sind noch keine Konten angelegt.{" "}
              {canEdit && <Link to={BUDGET_ACCOUNTS_PATH}>Konten anlegen</Link>}
            </p>
          ) : (
            <div className="budget-columns">
              <section className="panel budget-section budget-main" aria-labelledby="budget-konten">
                <div className="budget-section-head">
                  <h2 id="budget-konten">Budget nach Konten</h2>
                  <Link to={BUDGET_ITEMS_PATH}>Alle Budgetposten</Link>
                </div>
                {groups.every((group) => group.rows.length === 0) ? (
                  <p className="budget-muted">
                    Für dieses Jahr ist noch nichts geplant oder gebucht.
                  </p>
                ) : (
                  <div className="table-wrap card-wrap budget-table">
                    <table className="table-cards">
                      <caption className="visually-hidden">
                        Budget nach Konten im {label} {overview.year_name}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Konto</th>
                          <th scope="col" className="betrag">
                            Geplant
                          </th>
                          <th scope="col" className="betrag">
                            Ist
                          </th>
                          <th scope="col" className="betrag">
                            Verfügbar
                          </th>
                          <th scope="col">Auslastung</th>
                        </tr>
                      </thead>
                      {groups
                        .filter((group) => group.rows.length > 0)
                        .map((group) => (
                          <tbody key={group.kind}>
                            <tr className="card-group budget-kind-row">
                              <th scope="rowgroup" colSpan={5}>
                                {KIND_LABELS[group.kind]}
                              </th>
                            </tr>
                            {group.rows.map((row) => {
                              const plan = row.expected_cents ?? 0;
                              const used = share(row.actual_cents, plan);
                              const over = row.actual_cents > plan;
                              return (
                                <tr key={row.account.id}>
                                  <th scope="row">
                                    <strong>{row.account.number}</strong> {row.account.name}
                                  </th>
                                  <td className="betrag" data-label="Geplant">
                                    {amount(row.expected_cents)}
                                  </td>
                                  <td className="betrag" data-label="Ist">
                                    {formatEuro(row.actual_cents)}
                                  </td>
                                  <td
                                    className={over ? "betrag budget-bad" : "betrag"}
                                    data-label="Verfügbar"
                                  >
                                    {formatEuro(plan - row.actual_cents)}
                                  </td>
                                  <td data-label="Auslastung">
                                    <span className="budget-usage">
                                      <Bar
                                        used={used}
                                        over={over}
                                        label={`${row.account.name}: ${used} % ausgegeben`}
                                      />
                                      <span className="small">{used} %</span>
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        ))}
                      <tfoot>
                        <tr>
                          <th scope="row">Summe</th>
                          <td className="betrag" data-label="Geplant">
                            {formatEuro(expected)}
                          </td>
                          <td className="betrag" data-label="Ist">
                            {formatEuro(actual)}
                          </td>
                          <td className="betrag" data-label="Verfügbar">
                            {formatEuro(expected - actual)}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </section>

              <div className="budget-side">
                <section className="panel budget-section" aria-labelledby="budget-fristen">
                  <div className="budget-section-head">
                    <h2 id="budget-fristen">Kündigungstermine</h2>
                    <Link to={BUDGET_CONTRACTS_PATH}>Verträge</Link>
                  </div>
                  {upcoming.length === 0 ? (
                    <p className="budget-muted">
                      Kein Termin in den nächsten {DEADLINE_WINDOW_DAYS} Tagen.
                    </p>
                  ) : (
                    <ul className="budget-list">
                      {upcoming.map((entry) => {
                        const badge = deadlineBadge(entry);
                        return (
                          <li key={entry.id}>
                            <span>
                              <Link to={`${BUDGET_CONTRACTS_PATH}/${entry.id}`}>{entry.title}</Link>
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
                <section className="panel budget-section" aria-labelledby="budget-gebucht">
                  <div className="budget-section-head">
                    <h2 id="budget-gebucht">Zuletzt gebucht</h2>
                    <Link to={BUDGET_INVOICES_PATH}>Rechnungen</Link>
                  </div>
                  {booked.length === 0 ? (
                    <p className="budget-muted">Noch keine gebuchte Rechnung.</p>
                  ) : (
                    <ul className="budget-list">
                      {booked.map((entry) => (
                        <li key={entry.id}>
                          <span>
                            {entry.number}
                            <span className="budget-muted budget-line">
                              {entry.invoicer_name} · {formatBudgetDay(entry.invoice_date)}
                            </span>
                          </span>
                          <span className="betrag">{formatEuro(entry.gross_cents)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          )}
          <p className="small budget-muted">
            Geplant: die Beträge der <Link to={BUDGET_ITEMS_PATH}>Budgetposten</Link>. Ist: gebuchte
            Rechnungen. Verträge sind Posten nur zugeordnet; ins Budget gehen ihre Kosten über die
            Rechnungen. Alle Beträge sind brutto.
          </p>
        </>
      )}
    </div>
  );
}
