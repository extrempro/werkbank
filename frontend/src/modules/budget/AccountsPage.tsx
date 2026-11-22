import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import {
  BUDGET_EDITOR_ROLES,
  createAccount,
  fetchAccounts,
  KIND_LABELS,
  updateAccount,
  type Account,
  type AccountKind,
} from "./api";
import { BudgetHead, ReadOnlyNote, useRevealOnMount } from "./shared";
import { Feedback } from "../../components/Feedback";

interface FormProps {
  /** null: neues Konto anlegen. */
  account: Account | null;
  onSaved: (account: Account) => void;
  onCancel: () => void;
}

function AccountForm({ account, onSaved, onCancel }: FormProps) {
  const reveal = useRevealOnMount<HTMLElement>();
  const [number, setNumber] = useState(account?.number ?? "");
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(account?.kind ?? "laufend");
  const [note, setNote] = useState(account?.note ?? "");
  const [active, setActive] = useState(account?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!number.trim() || !name.trim()) {
      setError("Bitte Kontonummer und Bezeichnung eintragen.");
      return;
    }
    const update = { number: number.trim(), name: name.trim(), kind, note: note.trim(), active };
    setBusy(true);
    setError(null);
    (account ? updateAccount(account.id, update) : createAccount(update))
      .then(onSaved)
      .catch((problem: unknown) => {
        setError(errorText(problem, "Das Konto konnte nicht gespeichert werden."));
        setBusy(false);
      });
  };

  const title = account ? `Konto ${account.number} bearbeiten` : "Konto anlegen";
  return (
    <section className="panel" aria-labelledby="konto-formular-titel" ref={reveal} tabIndex={-1}>
      <div className="panel-head">
        <h2 id="konto-formular-titel">{title}</h2>
      </div>
      <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
        <div className="tool-row">
          <label className="narrow">
            Kontonummer
            <input
              type="text"
              value={number}
              maxLength={20}
              onChange={(event) => setNumber(event.target.value)}
            />
          </label>
          <label>
            Bezeichnung
            <input
              type="text"
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="narrow">
            Art
            <select value={kind} onChange={(event) => setKind(event.target.value as AccountKind)}>
              <option value="laufend">{KIND_LABELS.laufend}</option>
              <option value="investition">{KIND_LABELS.investition}</option>
            </select>
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
        {account && (
          <label className="check-label">
            <input
              type="checkbox"
              className="check"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            Konto ist aktiv
          </label>
        )}
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {account ? "Änderungen speichern" : "Konto speichern"}
          </button>
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Abbrechen
          </button>
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

/** IT-Budget › Konten: Konten des Budgets anlegen, ändern und stilllegen. */
export function AccountsPage({ roles }: { roles: readonly string[] }) {
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  // Zählt hoch, damit das Formular nach dem Speichern leer neu beginnt.
  const [formRound, setFormRound] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const closeForm = () => {
    setEditing(null);
    setFormOpen(false);
  };
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchAccounts()
      .then((result) => {
        if (active) {
          setAccounts(result);
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
  }, []);

  const onSaved = (saved: Account) => {
    const others = (accounts ?? []).filter((entry) => entry.id !== saved.id);
    setAccounts(
      [...others, saved].sort((a, b) =>
        a.number.toLowerCase().localeCompare(b.number.toLowerCase()),
      ),
    );
    setStatus(`Konto ${saved.number} ist gespeichert.`);
    setEditing(null);
    setFormOpen(false);
    setFormRound(formRound + 1);
  };

  return (
    <div className="page page-wide budget-page">
      <BudgetHead
        title="Konten"
        sub={
          <>
            Die Konten, auf die das IT-Budget verteilt ist. Konten werden nicht gelöscht, sondern
            stillgelegt, damit frühere Jahre vollständig bleiben.
          </>
        }
      />
      <ReadOnlyNote roles={roles} />
      {canEdit && accounts && (
        <div className="budget-toolbar">
          <button
            type="button"
            className="button button-primary"
            aria-expanded={formOpen || editing !== null}
            onClick={() => {
              setEditing(null);
              setFormRound(formRound + 1);
              setFormOpen(true);
            }}
          >
            Konto anlegen
          </button>
        </div>
      )}
      {canEdit && accounts && (formOpen || editing) && (
        <AccountForm
          key={editing ? `konto-${editing.id}` : `neu-${formRound}`}
          account={editing}
          onSaved={onSaved}
          onCancel={closeForm}
        />
      )}

      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Konten konnten nicht geladen werden.
        </p>
      )}
      {!failed && !accounts && <p role="status">Wird geladen …</p>}
      {accounts && accounts.length === 0 && (
        <p className="panel panel-empty">Es sind noch keine Konten angelegt.</p>
      )}
      {accounts && accounts.length > 0 && (
        <div
          className="table-wrap card-wrap budget-table"
          tabIndex={0}
          role="region"
          aria-label="Konten"
        >
          <table className="table-cards">
            <caption className="visually-hidden">Konten des IT-Budgets</caption>
            <thead>
              <tr>
                <th scope="col">Kontonummer</th>
                <th scope="col">Bezeichnung</th>
                <th scope="col">Art</th>
                <th scope="col">Notiz</th>
                <th scope="col">Stand</th>
                {canEdit && <th scope="col">Aktion</th>}
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <th scope="row" className="mono">
                    {account.number}
                  </th>
                  <td data-label="Bezeichnung">{account.name}</td>
                  <td data-label="Art">{KIND_LABELS[account.kind]}</td>
                  <td data-label="Notiz">{account.note || "–"}</td>
                  <td data-label="Stand">
                    <span className={account.active ? "pill pill-ok" : "pill pill-neutral"}>
                      {account.active ? "aktiv" : "stillgelegt"}
                    </span>
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        className="button button-secondary"
                        aria-label={`Konto ${account.number} bearbeiten`}
                        onClick={() => {
                          setStatus(null);
                          setEditing(account);
                        }}
                      >
                        Bearbeiten
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Feedback
        message={status ? { kind: "status", text: status } : null}
        onClose={() => setStatus(null)}
      />
    </div>
  );
}
