import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { BUDGET_ACCOUNTS_PATH } from "../../navigation";
import {
  BUDGET_EDITOR_ROLES,
  BUDGET_MANAGER_ROLE,
  euroInput,
  fetchBudgetOverview,
  formatBudgetDay,
  formatEuro,
  KIND_LABELS,
  parseEuro,
  savePlan,
  type Overview,
  type PlanEntry,
} from "./api";

function amount(cents: number | null): string {
  return cents === null ? "–" : formatEuro(cents);
}

/** IT-Budget › Übersicht: Plan je Konto für ein Geschäftsjahr, mit dem Vorjahr zum Vergleich. */
export function BudgetOverviewPage({ roles }: { roles: readonly string[] }) {
  const canPlan = roles.includes(BUDGET_MANAGER_ROLE);
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const [year, setYear] = useState<number | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
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

  return (
    <div className="page page-wide">
      <header className="page-head">
        <p className="module-label">IT-Budget</p>
        <h1>Übersicht</h1>
        <p className="page-sub">
          Geplantes Budget je Konto. Alle Beträge sind brutto.
          {overview?.settings.cost_center
            ? ` Kostenstelle ${overview.settings.cost_center}.`
            : ""}
        </p>
      </header>

      {failed && (
        <p role="alert" className="panel panel-empty">
          Das Budget konnte nicht geladen werden.
        </p>
      )}
      {!failed && !overview && <p role="status">Wird geladen …</p>}
      {overview && (
        <>
          <div className="settings-form budget-year">
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
            <p className="small">
              {formatBudgetDay(overview.first_day)} bis {formatBudgetDay(overview.last_day)}
              {overview.year === overview.settings.current_year ? " · läuft gerade" : ""}
            </p>
          </div>

          <dl className="kpis">
            <div className="kpi">
              <dt>Plan gesamt</dt>
              <dd className="kpi-number">{formatEuro(overview.plan.total_cents)}</dd>
            </div>
            <div className="kpi">
              <dt>Laufende Kosten</dt>
              <dd className="kpi-number">{formatEuro(overview.plan.running_cents)}</dd>
            </div>
            <div className="kpi">
              <dt>Investitionen</dt>
              <dd className="kpi-number">{formatEuro(overview.plan.investment_cents)}</dd>
            </div>
          </dl>

          {overview.rows.length === 0 ? (
            <p className="panel panel-empty">
              Es sind noch keine Konten angelegt.{" "}
              {canEdit && <Link to={BUDGET_ACCOUNTS_PATH}>Konten anlegen</Link>}
            </p>
          ) : (
            <form onSubmit={onSave} noValidate>
              <div
                className="table-wrap"
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
                        Vorjahr
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.rows.map((row) => (
                      <tr key={row.account.id}>
                        <th scope="row">
                          <span className="mono">{row.account.number}</span> {row.account.name}
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
                        <td className="betrag">{amount(row.previous_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={2}>
                        Laufende Kosten
                      </th>
                      <td className="betrag">{formatEuro(overview.plan.running_cents)}</td>
                      <td className="betrag">{formatEuro(overview.previous.running_cents)}</td>
                    </tr>
                    <tr>
                      <th scope="row" colSpan={2}>
                        Investitionen
                      </th>
                      <td className="betrag">{formatEuro(overview.plan.investment_cents)}</td>
                      <td className="betrag">{formatEuro(overview.previous.investment_cents)}</td>
                    </tr>
                    <tr className="budget-summe">
                      <th scope="row" colSpan={2}>
                        Gesamt
                      </th>
                      <td className="betrag">{formatEuro(overview.plan.total_cents)}</td>
                      <td className="betrag">{formatEuro(overview.previous.total_cents)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {canPlan && (
                <div className="actions budget-actions">
                  {draft ? (
                    <>
                      <button type="submit" className="button button-primary" disabled={busy}>
                        Plan speichern
                      </button>
                      <button
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
                    <button type="button" className="button button-secondary" onClick={startEdit}>
                      Plan bearbeiten
                    </button>
                  )}
                </div>
              )}
              {draft && (
                <p className="small">
                  Beträge brutto in Euro, z. B. 11900,00. Ein leeres Feld heißt: für dieses Konto
                  ist nichts geplant.
                </p>
              )}
            </form>
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
