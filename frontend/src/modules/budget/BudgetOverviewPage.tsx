import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { BUDGET_ACCOUNTS_PATH, BUDGET_CONTRACTS_PATH } from "../../navigation";
import {
  BUDGET_EDITOR_ROLES,
  BUDGET_MANAGER_ROLE,
  DEADLINE_WINDOW_DAYS,
  deadlineBadge,
  euroInput,
  fetchBudgetOverview,
  fetchContracts,
  formatBudgetDay,
  formatEuro,
  KIND_LABELS,
  parseEuro,
  savePlan,
  share,
  type Contract,
  type Overview,
  type PlanEntry,
} from "./api";

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

/** IT-Budget › Übersicht: Kennzahlen, Budget nach Konten, Fristen und der Plan je Konto. */
export function BudgetOverviewPage({ roles }: { roles: readonly string[] }) {
  const canPlan = roles.includes(BUDGET_MANAGER_ROLE);
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const [year, setYear] = useState<number | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [failed, setFailed] = useState(false);
  // Eingaben im Bearbeitungsmodus je Konto; null: es wird nicht bearbeitet.
  const [draft, setDraft] = useState<Record<number, string> | null>(null);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

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

  const startEdit = () => {
    if (!overview) {
      return;
    }
    setMessage(null);
    setDraft(
      Object.fromEntries(overview.rows.map((row) => [row.account.id, euroInput(row.plan_cents)])),
    );
  };

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    if (!overview || !draft) {
      return;
    }
    const entries: PlanEntry[] = [];
    for (const row of overview.rows) {
      const text = (draft[row.account.id] ?? "").trim();
      const cents = text === "" ? null : parseEuro(text);
      if (text !== "" && cents === null) {
        setMessage({
          kind: "alert",
          text: `Der Betrag für ${row.account.number} ${row.account.name} ist nicht lesbar. Bitte so eintragen: 11900,00`,
        });
        return;
      }
      if (cents !== row.plan_cents) {
        entries.push({ account_id: row.account.id, amount_cents: cents });
      }
    }
    if (entries.length === 0) {
      setDraft(null);
      return;
    }
    setBusy(true);
    setMessage(null);
    savePlan(overview.year, entries)
      .then((result) => {
        setOverview(result);
        setDraft(null);
        setMessage({ kind: "status", text: "Der Plan ist gespeichert." });
      })
      .catch((error: unknown) => {
        setMessage({
          kind: "alert",
          text: errorText(error, "Der Plan konnte nicht gespeichert werden."),
        });
      })
      .finally(() => setBusy(false));
  };

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
                disabled={draft !== null}
                onChange={(event) => {
                  setMessage(null);
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
                                <Link to={BUDGET_CONTRACTS_PATH}>{entry.title}</Link>
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

              <section className="panel budget-section" aria-labelledby="budget-plan">
                <div className="budget-section-head">
                  <h2 id="budget-plan">Plan je Konto</h2>
                  <span className="budget-muted">Alle Beträge brutto</span>
                </div>
                <form onSubmit={onSave} noValidate>
                  <div
                    className="table-wrap budget-table"
                    tabIndex={0}
                    role="region"
                    aria-label={`Plan ${overview.year_name}`}
                  >
                    <table>
                      <caption className="visually-hidden">
                        Plan je Konto im {label} {overview.year_name}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Konto</th>
                          <th scope="col">Art</th>
                          <th scope="col" className="betrag">
                            Plan
                          </th>
                          <th scope="col" className="betrag">
                            Durch Verträge gebunden
                          </th>
                          <th scope="col" className="betrag">
                            Frei
                          </th>
                          <th scope="col" className="betrag">
                            Vorjahr
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.rows.map((row) => (
                          <tr key={row.account.id}>
                            <th scope="row">
                              <span className="mono">{row.account.number}</span>{" "}
                              {row.account.name}
                              {!row.account.active && (
                                <span className="pill pill-neutral budget-pill">stillgelegt</span>
                              )}
                            </th>
                            <td>{KIND_LABELS[row.account.kind]}</td>
                            <td className="betrag">
                              {draft ? (
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className="budget-input"
                                  aria-label={`Plan für ${row.account.number} ${row.account.name} in Euro`}
                                  value={draft[row.account.id] ?? ""}
                                  onChange={(event) =>
                                    setDraft({ ...draft, [row.account.id]: event.target.value })
                                  }
                                />
                              ) : (
                                amount(row.plan_cents)
                              )}
                            </td>
                            <td className="betrag">{formatEuro(row.committed_cents)}</td>
                            <td
                              className={
                                row.plan_cents !== null && row.committed_cents > row.plan_cents
                                  ? "betrag budget-bad"
                                  : "betrag"
                              }
                            >
                              {row.plan_cents === null
                                ? "–"
                                : formatEuro(row.plan_cents - row.committed_cents)}
                            </td>
                            <td className="betrag budget-muted">{amount(row.previous_cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        {(
                          [
                            ["Laufende Kosten", "running_cents"],
                            ["Investitionen", "investment_cents"],
                            ["Gesamt", "total_cents"],
                          ] as const
                        ).map(([title, key]) => (
                          <tr key={key} className={key === "total_cents" ? "budget-summe" : ""}>
                            <th scope="row" colSpan={2}>
                              {title}
                            </th>
                            <td className="betrag">{formatEuro(overview.plan[key])}</td>
                            <td className="betrag">{formatEuro(overview.committed[key])}</td>
                            <td className="betrag">
                              {formatEuro(overview.plan[key] - overview.committed[key])}
                            </td>
                            <td className="betrag budget-muted">
                              {formatEuro(overview.previous[key])}
                            </td>
                          </tr>
                        ))}
                      </tfoot>
                    </table>
                  </div>
                  {/* Eigene Schlüssel: Sonst verwendet React den Knopf „Plan bearbeiten“ als
                      „Plan speichern“ weiter, und derselbe Klick schickt das Formular ab. */}
                  {canPlan && (
                    <div className="actions budget-actions">
                      {draft ? (
                        <>
                          <button
                            key="speichern"
                            type="submit"
                            className="button button-primary"
                            disabled={busy}
                          >
                            Plan speichern
                          </button>
                          <button
                            key="abbrechen"
                            type="button"
                            className="button button-secondary"
                            disabled={busy}
                            onClick={() => {
                              setDraft(null);
                              setMessage(null);
                            }}
                          >
                            Abbrechen
                          </button>
                        </>
                      ) : (
                        <button
                          key="bearbeiten"
                          type="button"
                          className="button button-secondary"
                          onClick={startEdit}
                        >
                          Plan bearbeiten
                        </button>
                      )}
                    </div>
                  )}
                  {draft && (
                    <p className="small">
                      Beträge brutto in Euro, z. B. 11900,00. Ein leeres Feld heißt: für dieses
                      Konto ist nichts geplant.
                    </p>
                  )}
                </form>
                <p className="small budget-muted">
                  Gebunden = was aus Verträgen in diesem {label} zu erwarten ist. Frei = Plan
                  abzüglich gebunden.
                </p>
              </section>
            </>
          )}
          {message && (
            <p
              role={message.kind}
              className={message.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
            >
              {message.text}
            </p>
          )}
        </>
      )}
    </div>
  );
}
