import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { BUDGET_CONTRACTS_PATH } from "../../navigation";
import {
  bookInvoice,
  BUDGET_EDITOR_ROLES,
  BUDGET_MANAGER_ROLE,
  createInvoice,
  deleteInvoice,
  euroInput,
  fetchContracts,
  fetchInvoices,
  fetchItems,
  fetchPartners,
  formatBudgetDay,
  formatEuro,
  formatRate,
  grossCents,
  parseEuro,
  parseRate,
  rememberedYear,
  rememberYear,
  STATUS_LABELS,
  updateInvoice,
  type Contract,
  type Invoice,
  type InvoiceList,
  type Item,
  type Partner,
} from "./api";
import { BudgetHead, ReadOnlyNote, useRevealOnMount } from "./shared";

interface FormProps {
  /** null: neue Rechnung erfassen. */
  invoice: Invoice | null;
  partners: Partner[];
  items: Item[];
  contracts: Contract[];
  onSaved: (invoice: Invoice) => void;
  onCancel: () => void;
}

function InvoiceForm({ invoice, partners, items, contracts, onSaved, onCancel }: FormProps) {
  const reveal = useRevealOnMount<HTMLElement>();
  const [invoicerId, setInvoicerId] = useState(invoice ? String(invoice.invoicer_id) : "");
  const [number, setNumber] = useState(invoice?.number ?? "");
  const [internal, setInternal] = useState(invoice?.internal_number ?? "");
  const [date, setDate] = useState(invoice?.invoice_date ?? "");
  const [itemId, setItemId] = useState(invoice ? String(invoice.item_id) : "");
  const [contractId, setContractId] = useState(
    invoice?.contract_id ? String(invoice.contract_id) : "",
  );
  const [net, setNet] = useState(invoice ? euroInput(invoice.net_cents) : "");
  const [rate, setRate] = useState(
    invoice ? (invoice.tax_rate_bp / 100).toLocaleString("de-DE") : "19",
  );
  // Leer: Brutto wird gerechnet. Gefüllt: Brutto laut Rechnung.
  const [gross, setGross] = useState(
    invoice && invoice.gross_cents !== grossCents(invoice.net_cents, invoice.tax_rate_bp)
      ? euroInput(invoice.gross_cents)
      : "",
  );
  const [description, setDescription] = useState(invoice?.description ?? "");
  const [project, setProject] = useState(invoice?.is_project ?? false);
  const [yearly, setYearly] = useState(invoice?.is_yearly ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const partnerChoices = partners.filter(
    (entry) => (entry.active && entry.is_invoicer) || entry.id === invoice?.invoicer_id,
  );
  const itemChoices = items.filter((entry) => entry.active || entry.id === invoice?.item_id);
  const contractChoices = contracts.filter(
    (entry) => entry.running || entry.id === invoice?.contract_id,
  );
  const netPreview = parseEuro(net);
  const ratePreview = parseRate(rate);

  const pickContract = (value: string) => {
    setContractId(value);
    // Der Vertrag bringt seinen Budgetposten mit, wenn noch keiner gewählt ist.
    const chosen = contracts.find((entry) => String(entry.id) === value);
    if (chosen && !itemId) {
      setItemId(String(chosen.item_id));
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const netCents = parseEuro(net);
    const taxRate = parseRate(rate);
    const grossText = gross.trim();
    const grossValue = grossText === "" ? null : parseEuro(grossText);
    let problem: string | null = null;
    if (!invoicerId || !itemId) {
      problem = "Bitte Rechnungssteller und Budgetposten wählen.";
    } else if (!number.trim()) {
      problem = "Bitte die Rechnungsnummer eintragen.";
    } else if (!date) {
      problem = "Bitte das Rechnungsdatum eintragen.";
    } else if (netCents === null) {
      problem = "Der Nettobetrag ist nicht lesbar. Bitte so eintragen: 1000,00";
    } else if (taxRate === null) {
      problem = "Der Steuersatz ist nicht lesbar. Bitte so eintragen: 19";
    } else if (grossText !== "" && grossValue === null) {
      problem = "Das Brutto ist nicht lesbar. Bitte so eintragen: 1190,00";
    }
    if (problem !== null || netCents === null || taxRate === null) {
      setError(problem);
      return;
    }
    const update = {
      invoicer_id: Number(invoicerId),
      number: number.trim(),
      internal_number: internal.trim(),
      invoice_date: date,
      item_id: Number(itemId),
      contract_id: contractId ? Number(contractId) : null,
      net_cents: netCents,
      tax_rate_bp: taxRate,
      gross_cents: grossValue,
      description: description.trim(),
      is_project: project,
      is_yearly: yearly,
    };
    setBusy(true);
    setError(null);
    (invoice ? updateInvoice(invoice.id, update) : createInvoice(update))
      .then(onSaved)
      .catch((failure: unknown) => {
        setError(errorText(failure, "Die Rechnung konnte nicht gespeichert werden."));
        setBusy(false);
      });
  };

  return (
    <section
      className="panel"
      aria-labelledby="rechnung-formular-titel"
      ref={reveal}
      tabIndex={-1}
    >
      <div className="panel-head">
        <h2 id="rechnung-formular-titel">
          {invoice ? `Rechnung ${invoice.number} bearbeiten` : "Rechnung erfassen"}
        </h2>
      </div>
      <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
        <div className="tool-row">
          <label>
            Rechnungssteller
            <select value={invoicerId} onChange={(event) => setInvoicerId(event.target.value)}>
              <option value="">Bitte wählen</option>
              {partnerChoices.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="narrow">
            Rechnungsnummer
            <input
              type="text"
              value={number}
              maxLength={80}
              onChange={(event) => setNumber(event.target.value)}
            />
          </label>
          <label className="narrow">
            Interne Nummer (freiwillig)
            <input
              type="text"
              value={internal}
              maxLength={60}
              onChange={(event) => setInternal(event.target.value)}
            />
          </label>
          <label className="narrow">
            Rechnungsdatum
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
          </label>
        </div>
        <div className="tool-row">
          <label>
            Vertrag (freiwillig)
            <select value={contractId} onChange={(event) => pickContract(event.target.value)}>
              <option value="">ohne Vertrag</option>
              {contractChoices.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title} · {entry.partner_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Budgetposten
            <select value={itemId} onChange={(event) => setItemId(event.target.value)}>
              <option value="">Bitte wählen</option>
              {itemChoices.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.account_number} {entry.account_name} · {entry.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="tool-row">
          <label className="narrow">
            Betrag netto (Euro)
            <input
              type="text"
              inputMode="decimal"
              value={net}
              onChange={(event) => setNet(event.target.value)}
            />
          </label>
          <label className="narrow">
            Steuersatz (%)
            <input
              type="text"
              inputMode="decimal"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
          </label>
          <label className="narrow">
            Brutto laut Rechnung (freiwillig)
            <input
              type="text"
              inputMode="decimal"
              value={gross}
              onChange={(event) => setGross(event.target.value)}
            />
          </label>
        </div>
        <p className="small" role="status">
          {netPreview !== null && ratePreview !== null
            ? `Gerechnetes Brutto: ${formatEuro(grossCents(netPreview, ratePreview))}. Weicht die Rechnung um Cent ab, trage ihr Brutto ein (höchstens 1 Euro Abweichung).`
            : "Das Brutto rechnet die Werkbank aus Netto und Steuersatz. Fürs Budget zählt das Brutto."}
        </p>
        <label>
          Bezeichnung (freiwillig)
          <input
            type="text"
            value={description}
            maxLength={200}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={project}
            onChange={(event) => setProject(event.target.checked)}
          />
          Gehört zu einem Projekt
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            className="check"
            checked={yearly}
            onChange={(event) => setYearly(event.target.checked)}
          />
          Kommt jährlich wieder
        </label>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {invoice ? "Änderungen speichern" : "Rechnung speichern"}
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

interface Loaded {
  list: InvoiceList;
  partners: Partner[];
  items: Item[];
  contracts: Contract[];
}

/** IT-Budget › Rechnungen: erfassen, prüfen und buchen. Erst Gebuchtes zählt zum Ist. */
export function InvoicesPage({ roles }: { roles: readonly string[] }) {
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const canBook = roles.includes(BUDGET_MANAGER_ROLE);
  const [year, setYear] = useState<number | null>(rememberedYear);
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formRound, setFormRound] = useState(0);
  const [round, setRound] = useState(0);
  // Rechnung, deren Löschen gerade bestätigt werden soll
  const [deleting, setDeleting] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([fetchInvoices(year), fetchPartners(), fetchItems(), fetchContracts()])
      .then(([list, partners, items, contracts]) => {
        if (active) {
          setData({ list, partners, items, contracts: contracts.entries });
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

  const closeForm = () => {
    setEditing(null);
    setFormOpen(false);
  };
  const done = (text: string) => {
    setMessage({ kind: "status", text });
    closeForm();
    setDeleting(null);
    setRound(round + 1);
  };
  const fail = (error: unknown, fallback: string) =>
    setMessage({ kind: "alert", text: errorText(error, fallback) });

  const onSaved = (saved: Invoice) => {
    setFormRound(formRound + 1);
    done(
      saved.status === "gebucht"
        ? `Rechnung ${saved.number} ist gespeichert und gebucht.`
        : `Rechnung ${saved.number} ist gespeichert und wartet auf die Prüfung.`,
    );
  };
  const onBook = (entry: Invoice) => {
    bookInvoice(entry.id)
      .then(() => done(`Rechnung ${entry.number} ist geprüft und gebucht. Sie zählt jetzt zum Ist.`))
      .catch((error: unknown) => fail(error, "Die Rechnung konnte nicht gebucht werden."));
  };
  const onDelete = (entry: Invoice) => {
    deleteInvoice(entry.id)
      .then(() => done(`Rechnung ${entry.number} ist gelöscht.`))
      .catch((error: unknown) => fail(error, "Die Rechnung konnte nicht gelöscht werden."));
  };

  const entries = data?.list.entries ?? [];
  const open = entries.filter((entry) => entry.status !== "gebucht").length;
  // Gebuchtes ändert nur der Budgetverwalter.
  const mayChange = (entry: Invoice) => canEdit && (entry.status !== "gebucht" || canBook);

  return (
    <div className="page page-wide budget-page">
      <BudgetHead
        title="Rechnungen"
        sub={
          <>
            IT und Budgetverwalter erfassen Rechnungen; prüfen und buchen darf nur der
            Budgetverwalter. Erst gebuchte Rechnungen zählen zum Ist.
          </>
        }
      >
        {data && (
          <div className="settings-form">
            <label className="narrow">
              Geschäftsjahr
              <select
                value={data.list.year}
                onChange={(event) => {
                  rememberYear(Number(event.target.value));
                  setMessage(null);
                  setYear(Number(event.target.value));
                }}
              >
                {data.list.years.map((entry) => (
                  <option key={entry.year} value={entry.year}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </BudgetHead>
      <ReadOnlyNote roles={roles} />

      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Rechnungen konnten nicht geladen werden.
        </p>
      )}
      {!failed && !data && <p role="status">Wird geladen …</p>}
      {data && (
        <div className="budget-toolbar budget-toolbar-split">
          <p className="budget-badges">
            <span className="pill pill-neutral">
              {entries.length} {entries.length === 1 ? "Rechnung" : "Rechnungen"}
            </span>
            <span className={open > 0 ? "pill pill-todo" : "pill pill-ok"}>{open} zu prüfen</span>
          </p>
          {canEdit && (
            <button
              type="button"
              className="button button-primary"
              aria-expanded={formOpen || editing !== null}
              onClick={() => {
                setEditing(null);
                setMessage(null);
                setFormRound(formRound + 1);
                setFormOpen(true);
              }}
            >
              Rechnung erfassen
            </button>
          )}
        </div>
      )}
      {canEdit && data && (formOpen || editing) && (
        <InvoiceForm
          key={editing ? `rechnung-${editing.id}` : `neu-${formRound}`}
          invoice={editing}
          partners={data.partners}
          items={data.items}
          contracts={data.contracts}
          onSaved={onSaved}
          onCancel={closeForm}
        />
      )}
      {message && (
        <p
          role={message.kind}
          className={message.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
        >
          {message.text}
        </p>
      )}
      {data && entries.length === 0 && (
        <p className="panel panel-empty">
          Im {data.list.year_name} ist noch keine Rechnung erfasst.
        </p>
      )}
      {data && entries.length > 0 && (
        <div
          className="table-wrap budget-table"
          tabIndex={0}
          role="region"
          aria-label={`Rechnungen ${data.list.year_name}`}
        >
          <table>
            <caption className="visually-hidden">
              Rechnungen im Geschäftsjahr {data.list.year_name}, die neueste zuerst
            </caption>
            <thead>
              <tr>
                <th scope="col">Datum</th>
                <th scope="col">Rechnungssteller</th>
                <th scope="col">Rechnungsnr.</th>
                <th scope="col">Vertrag</th>
                <th scope="col">Konto / Budgetposten</th>
                <th scope="col" className="betrag">
                  Netto
                </th>
                <th scope="col" className="betrag">
                  Brutto
                </th>
                <th scope="col">Status</th>
                {canEdit && <th scope="col">Aktion</th>}
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatBudgetDay(entry.invoice_date)}</td>
                  <td>{entry.invoicer_name}</td>
                  <th scope="row">
                    {entry.number}
                    <span className="small budget-muted tenant-part">
                      {[
                        entry.internal_number,
                        entry.description,
                        entry.is_project ? "Projekt" : "",
                        entry.is_yearly ? "jährlich" : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </th>
                  <td>
                    {entry.contract_id !== null ? (
                      <Link to={`${BUDGET_CONTRACTS_PATH}/${entry.contract_id}`}>
                        {entry.contract_title}
                      </Link>
                    ) : (
                      <span className="budget-muted">ohne Vertrag</span>
                    )}
                  </td>
                  <td>
                    <span className="mono">{entry.account_number}</span> {entry.account_name}
                    <span className="small budget-muted tenant-part">{entry.item_name}</span>
                  </td>
                  <td className="betrag">
                    {formatEuro(entry.net_cents)}
                    <span className="small budget-muted tenant-part">
                      + {formatRate(entry.tax_rate_bp)}
                    </span>
                  </td>
                  <td className="betrag">{formatEuro(entry.gross_cents)}</td>
                  <td>
                    <span
                      className={entry.status === "gebucht" ? "pill pill-ok" : "pill pill-todo"}
                    >
                      {STATUS_LABELS[entry.status]}
                    </span>
                    <span className="small budget-muted tenant-part">
                      {entry.created_by_name ? `erfasst: ${entry.created_by_name}` : ""}
                      {entry.booked_by_name ? ` · geprüft: ${entry.booked_by_name}` : ""}
                    </span>
                  </td>
                  {canEdit && (
                    <td>
                      <div className="budget-row-actions">
                        {canBook && entry.status !== "gebucht" && (
                          <button
                            type="button"
                            className="button button-primary"
                            aria-label={`Rechnung ${entry.number} prüfen und buchen`}
                            onClick={() => onBook(entry)}
                          >
                            Prüfen und buchen
                          </button>
                        )}
                        {!canBook && entry.status !== "gebucht" && (
                          <span className="small budget-muted">wartet auf Budgetverwalter</span>
                        )}
                        {mayChange(entry) && deleting !== entry.id && (
                          <>
                            <button
                              type="button"
                              className="button button-secondary"
                              aria-label={`Rechnung ${entry.number} bearbeiten`}
                              onClick={() => {
                                setMessage(null);
                                setEditing(entry);
                              }}
                            >
                              Bearbeiten
                            </button>
                            <button
                              type="button"
                              className="button button-secondary"
                              aria-label={`Rechnung ${entry.number} löschen`}
                              onClick={() => setDeleting(entry.id)}
                            >
                              Löschen
                            </button>
                          </>
                        )}
                        {mayChange(entry) && deleting === entry.id && (
                          <>
                            <button
                              type="button"
                              className="button button-danger"
                              onClick={() => onDelete(entry)}
                            >
                              Wirklich löschen
                            </button>
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => setDeleting(null)}
                            >
                              Doch nicht
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
