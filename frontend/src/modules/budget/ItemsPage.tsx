import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { BUDGET_ACCOUNTS_PATH } from "../../navigation";
import {
  BUDGET_EDITOR_ROLES,
  BUDGET_MANAGER_ROLE,
  createItem,
  euroInput,
  fetchAccounts,
  fetchBudgetOverview,
  formatEuro,
  parseEuro,
  savePlan,
  updateItem,
  type Account,
  type Item,
  type Overview,
  type PlanEntry,
} from "./api";

function amount(cents: number | null): string {
  return cents === null ? "–" : formatEuro(cents);
}

interface FormProps {
  /** null: neuen Budgetposten anlegen. */
  item: Item | null;
  accounts: Account[];
  onSaved: (item: Item) => void;
  onCancel: () => void;
}

function ItemForm({ item, accounts, onSaved, onCancel }: FormProps) {
  const [accountId, setAccountId] = useState(item ? String(item.account_id) : "");
  const [name, setName] = useState(item?.name ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  const [active, setActive] = useState(item?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choices = accounts.filter((entry) => entry.active || entry.id === item?.account_id);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!accountId || !name.trim()) {
      setError("Bitte Konto wählen und eine Bezeichnung eintragen.");
      return;
    }
    const update = { account_id: Number(accountId), name: name.trim(), note: note.trim(), active };
    setBusy(true);
    setError(null);
    (item ? updateItem(item.id, update) : createItem(update))
      .then(onSaved)
      .catch((problem: unknown) => {
        setError(errorText(problem, "Der Budgetposten konnte nicht gespeichert werden."));
        setBusy(false);
      });
  };

  return (
    <section className="panel" aria-labelledby="posten-formular-titel">
      <div className="panel-head">
        <h2 id="posten-formular-titel">
          {item ? `${item.name} bearbeiten` : "Budgetposten anlegen"}
        </h2>
      </div>
      <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
        <div className="tool-row">
          <label>
            Konto
            <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              <option value="">Bitte wählen</option>
              {choices.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.number} {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Bezeichnung
            <input
              type="text"
              value={name}
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </div>
        <label>
          Notiz (freiwillig)
          <input
            type="text"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        {item && (
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            Budgetposten ist aktiv
          </label>
        )}
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {item ? "Änderungen speichern" : "Budgetposten anlegen"}
          </button>
          {item && (
            <button type="button" className="button button-secondary" onClick={onCancel}>
              Abbrechen
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="hint-box hint-bad">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}

/** IT-Budget › Budgetposten: Posten je Konto mit Plan, gebunden und frei; hier wird geplant. */
export function ItemsPage({ roles }: { roles: readonly string[] }) {
  const canPlan = roles.includes(BUDGET_MANAGER_ROLE);
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const [year, setYear] = useState<number | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [failed, setFailed] = useState(false);
  // Eingaben im Bearbeitungsmodus je Posten; null: es wird nicht bearbeitet.
  const [draft, setDraft] = useState<Record<number, string> | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const [formRound, setFormRound] = useState(0);
  const [round, setRound] = useState(0);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([fetchBudgetOverview(year), fetchAccounts()])
      .then(([result, list]) => {
        if (active) {
          setOverview(result);
          setAccounts(list);
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
  }, [year, round]);

  const label = overview?.settings.year_label ?? "Geschäftsjahr";

  const startEdit = () => {
    if (!overview) {
      return;
    }
    setMessage(null);
    setDraft(
      Object.fromEntries(overview.items.map((row) => [row.item.id, euroInput(row.plan_cents)])),
    );
  };

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    if (!overview || !draft) {
      return;
    }
    const entries: PlanEntry[] = [];
    for (const row of overview.items) {
      const text = (draft[row.item.id] ?? "").trim();
      const cents = text === "" ? null : parseEuro(text);
      if (text !== "" && cents === null) {
        setMessage({
          kind: "alert",
          text: `Der Betrag für ${row.item.name} ist nicht lesbar. Bitte so eintragen: 11900,00`,
        });
        return;
      }
      if (cents !== row.plan_cents) {
        entries.push({ item_id: row.item.id, amount_cents: cents });
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

  const onItemSaved = (saved: Item) => {
    setMessage({ kind: "status", text: `${saved.name} ist gespeichert.` });
    setEditing(null);
    setFormRound(formRound + 1);
    setRound(round + 1);
  };

  const columns = canEdit ? 7 : 6;

  return (
    <div className="page page-wide budget-page">
      <header className="page-head budget-head">
        <div>
          <p className="module-label">IT-Budget</p>
          <h1>Budgetposten</h1>
          <p className="page-sub">
            Wofür das Geld eines Kontos gedacht ist. Geplant wird je Posten; das Konto zeigt die
            Summe. Alle Beträge sind brutto.
          </p>
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
          Die Budgetposten konnten nicht geladen werden.
        </p>
      )}
      {!failed && !overview && <p role="status">Wird geladen …</p>}
      {overview && accounts.length === 0 && (
        <p className="panel panel-empty">
          Es sind noch keine Konten angelegt. Budgetposten gehören zu einem Konto.{" "}
          {canEdit && <Link to={BUDGET_ACCOUNTS_PATH}>Konten anlegen</Link>}
        </p>
      )}
      {overview && accounts.length > 0 && overview.items.length === 0 && (
        <p className="panel panel-empty">Es sind noch keine Budgetposten angelegt.</p>
      )}
      {overview && overview.items.length > 0 && (
        <form onSubmit={onSave} noValidate>
          <div
            className="table-wrap budget-table"
            tabIndex={0}
            role="region"
            aria-label={`Budgetposten ${overview.year_name}`}
          >
            <table>
              <caption className="visually-hidden">
                Budgetposten mit Plan im {label} {overview.year_name}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Konto</th>
                  <th scope="col">Budgetposten</th>
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
                  {canEdit && <th scope="col">Aktion</th>}
                </tr>
              </thead>
              <tbody>
                {overview.items.map((row) => (
                  <tr key={row.item.id}>
                    <td>
                      <span className="mono">{row.item.account_number}</span>
                      <span className="small budget-muted tenant-part">
                        {row.item.account_name}
                      </span>
                    </td>
                    <th scope="row">
                      {row.item.name}
                      {!row.item.active && (
                        <span className="pill pill-neutral budget-pill">stillgelegt</span>
                      )}
                      <span className="small budget-muted tenant-part">
                        {row.contracts === 0
                          ? "kein Vertrag zugeordnet"
                          : row.contracts === 1
                            ? "1 Vertrag"
                            : `${row.contracts} Verträge`}
                      </span>
                    </th>
                    <td className="betrag">
                      {draft ? (
                        <input
                          type="text"
                          inputMode="decimal"
                          className="budget-input"
                          aria-label={`Plan für ${row.item.name} (${row.item.account_number}) in Euro`}
                          value={draft[row.item.id] ?? ""}
                          onChange={(event) =>
                            setDraft({ ...draft, [row.item.id]: event.target.value })
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
                    {canEdit && (
                      <td>
                        <button
                          type="button"
                          className="button button-secondary"
                          aria-label={`${row.item.name} bearbeiten`}
                          disabled={draft !== null}
                          onClick={() => {
                            setMessage(null);
                            setEditing(row.item);
                          }}
                        >
                          Bearbeiten
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="budget-summe">
                  <th scope="row" colSpan={2}>
                    Summe
                  </th>
                  <td className="betrag">{formatEuro(overview.plan.total_cents)}</td>
                  <td className="betrag">{formatEuro(overview.committed.total_cents)}</td>
                  <td className="betrag">
                    {formatEuro(overview.plan.total_cents - overview.committed.total_cents)}
                  </td>
                  <td className="betrag budget-muted" colSpan={columns - 5}>
                    {formatEuro(overview.previous.total_cents)}
                  </td>
                </tr>
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
              Beträge brutto in Euro, z. B. 11900,00. Ein leeres Feld heißt: für diesen Posten ist
              nichts geplant.
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
      {canEdit && overview && accounts.length > 0 && (
        <ItemForm
          key={editing ? `posten-${editing.id}` : `neu-${formRound}`}
          item={editing}
          accounts={accounts}
          onSaved={onItemSaved}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
