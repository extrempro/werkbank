import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import { Link } from "../../components/Link";
import { BUDGET_CONTRACTS_PATH } from "../../navigation";
import {
  bookInvoice,
  BUDGET_EDITOR_ROLES,
  BUDGET_MANAGER_ROLE,
  createInvoice,
  deleteDocument,
  deleteInvoice,
  DOCUMENT_MAX_MB,
  documentUrl,
  euroInput,
  fetchContracts,
  fetchInvoices,
  fetchBudgetSettings,
  fetchItems,
  fiscalYearOf,
  itemMatches,
  fetchPartners,
  fileSize,
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
  uploadDocument,
  type Contract,
  INVOICE_LINES_MAX,
  type Invoice,
  type InvoiceLine,
  type InvoiceLineUpdate,
  type InvoiceList,
  type InvoiceUpdate,
  type Item,
  type ItemStatus,
  type Partner,
} from "./api";
import { BudgetHead, DeleteButton, ReadOnlyNote, useRevealOnMount } from "./shared";

interface FormProps {
  /** null: neue Rechnung erfassen. */
  invoice: Invoice | null;
  partners: Partner[];
  items: Item[];
  contracts: Contract[];
  /** Monat, mit dem das Geschäftsjahr beginnt, und das gerade gezeigte Jahr als Vorgabe. */
  startMonth: number;
  listYear: number;
  onSaved: (invoice: Invoice) => void;
  onCancel: () => void;
}

/** Eingaben einer Position als Text, wie sie in den Feldern stehen. */
interface LineDraft {
  key: number;
  itemId: string;
  contractId: string;
  net: string;
  rate: string;
  /** Leer: Brutto wird gerechnet. Gefüllt: Brutto laut Rechnung. */
  gross: string;
  description: string;
  project: boolean;
  yearly: boolean;
  /** Schließt den Posten für das Geschäftsjahr der Rechnung ab. */
  closes: boolean;
  /** Suchtext, der die Auswahl der Budgetposten eingrenzt. */
  search: string;
}

function emptyLine(key: number): LineDraft {
  return {
    key,
    itemId: "",
    contractId: "",
    net: "",
    rate: "19",
    gross: "",
    description: "",
    project: false,
    yearly: false,
    closes: true,
    search: "",
  };
}

function draftOf(line: InvoiceLine, key: number): LineDraft {
  return {
    key,
    itemId: String(line.item_id),
    contractId: line.contract_id ? String(line.contract_id) : "",
    net: euroInput(line.net_cents),
    rate: (line.tax_rate_bp / 100).toLocaleString("de-DE"),
    gross:
      line.gross_cents !== grossCents(line.net_cents, line.tax_rate_bp)
        ? euroInput(line.gross_cents)
        : "",
    description: line.description,
    project: line.is_project,
    yearly: line.is_yearly,
    closes: line.closes_item,
    search: "",
  };
}

const STATUS_ORDER: (ItemStatus | null)[] = ["offen", "rechnung", "abgeschlossen", null];

function groupLabel(status: ItemStatus | null, yearName: string): string {
  if (status === null) {
    return `Läuft ${yearName} nicht`;
  }
  return status === "offen"
    ? `Offen ${yearName}`
    : status === "rechnung"
      ? `Rechnung liegt vor ${yearName}`
      : `Abgeschlossen ${yearName}`;
}

/** Brutto einer Position, solange Netto und Steuersatz lesbar sind; sonst null. */
function lineGross(line: LineDraft): number | null {
  const typed = line.gross.trim();
  if (typed !== "") {
    return parseEuro(typed);
  }
  const net = parseEuro(line.net);
  const rate = parseRate(line.rate);
  return net === null || rate === null ? null : grossCents(net, rate);
}

function InvoiceForm({
  invoice,
  partners,
  items,
  contracts,
  startMonth,
  listYear,
  onSaved,
  onCancel,
}: FormProps) {
  const reveal = useRevealOnMount<HTMLElement>();
  const [invoicerId, setInvoicerId] = useState(invoice ? String(invoice.invoicer_id) : "");
  const [number, setNumber] = useState(invoice?.number ?? "");
  const [internal, setInternal] = useState(invoice?.internal_number ?? "");
  const [date, setDate] = useState(invoice?.invoice_date ?? "");
  const [lines, setLines] = useState<LineDraft[]>(
    invoice ? invoice.lines.map(draftOf) : [emptyLine(0)],
  );
  const [nextKey, setNextKey] = useState(invoice ? invoice.lines.length : 1);
  // Rechnungsbetrag laut Beleg: freiwillig, dient dem Abgleich mit der Summe der Positionen
  const [total, setTotal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Status der Budgetposten im Geschäftsjahr des Rechnungsdatums, für die Auswahl
  const fiscalYear = fiscalYearOf(date, startMonth) ?? listYear;
  const [statuses, setStatuses] = useState<{
    year: number;
    byItem: Map<number, ItemStatus | null>;
  }>({ year: 0, byItem: new Map() });
  useEffect(() => {
    let active = true;
    fetchItems(fiscalYear)
      .then((list) => {
        if (active) {
          setStatuses({
            year: fiscalYear,
            byItem: new Map(list.map((entry) => [entry.id, entry.status ?? null])),
          });
        }
      })
      // Ohne Status bleibt die Auswahl nutzbar, nur ungruppiert.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [fiscalYear]);
  const yearName =
    startMonth === 1
      ? String(fiscalYear)
      : `${fiscalYear}/${String((fiscalYear + 1) % 100).padStart(2, "0")}`;
  const statusOf = (id: number): ItemStatus | null =>
    statuses.year === fiscalYear ? (statuses.byItem.get(id) ?? null) : null;

  const usedItems = new Set(invoice?.lines.map((line) => line.item_id));
  const usedContracts = new Set(invoice?.lines.map((line) => line.contract_id));
  const partnerChoices = partners.filter(
    (entry) => (entry.active && entry.is_invoicer) || entry.id === invoice?.invoicer_id,
  );
  const itemChoices = items.filter((entry) => entry.active || usedItems.has(entry.id));
  const contractChoices = contracts.filter((entry) => entry.running || usedContracts.has(entry.id));

  const change = (key: number, update: Partial<LineDraft>) =>
    setLines(lines.map((line) => (line.key === key ? { ...line, ...update } : line)));

  const pickContract = (line: LineDraft, value: string) => {
    // Der Vertrag bringt seinen Budgetposten mit, wenn noch keiner gewählt ist.
    const chosen = contracts.find((entry) => String(entry.id) === value);
    change(line.key, {
      contractId: value,
      itemId: chosen && !line.itemId ? String(chosen.item_id) : line.itemId,
      // Laufende Vertragszahlungen schließen den Posten in der Regel nicht ab.
      closes: value === "",
    });
  };

  const sums = lines.map(lineGross);
  const grossSum = sums.every((value) => value !== null)
    ? sums.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const netSum = lines.reduce<number | null>((sum, line) => {
    const net = parseEuro(line.net);
    return sum === null || net === null ? null : sum + net;
  }, 0);
  const totalText = total.trim();
  const totalCents = totalText === "" ? null : parseEuro(totalText);
  const rest = totalCents !== null && grossSum !== null ? totalCents - grossSum : null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    let problem: string | null = null;
    if (!invoicerId) {
      problem = "Bitte den Rechnungssteller wählen.";
    } else if (!number.trim()) {
      problem = "Bitte die Rechnungsnummer eintragen.";
    } else if (!date) {
      problem = "Bitte das Rechnungsdatum eintragen.";
    }
    const parsed: InvoiceLineUpdate[] = [];
    lines.forEach((line, index) => {
      if (problem !== null) {
        return;
      }
      const where = lines.length > 1 ? `Position ${index + 1}: ` : "";
      const netCents = parseEuro(line.net);
      const taxRate = parseRate(line.rate);
      const grossText = line.gross.trim();
      const grossValue = grossText === "" ? null : parseEuro(grossText);
      if (!line.itemId) {
        problem = `${where}Bitte den Budgetposten wählen.`;
      } else if (netCents === null) {
        problem = `${where}Der Nettobetrag ist nicht lesbar. Bitte so eintragen: 1000,00`;
      } else if (taxRate === null) {
        problem = `${where}Der Steuersatz ist nicht lesbar. Bitte so eintragen: 19`;
      } else if (grossText !== "" && grossValue === null) {
        problem = `${where}Das Brutto ist nicht lesbar. Bitte so eintragen: 1190,00`;
      } else {
        parsed.push({
          item_id: Number(line.itemId),
          contract_id: line.contractId ? Number(line.contractId) : null,
          net_cents: netCents,
          tax_rate_bp: taxRate,
          gross_cents: grossValue,
          description: line.description.trim(),
          is_project: line.project,
          is_yearly: line.yearly,
          closes_item: line.closes,
        });
      }
    });
    if (problem === null && totalText !== "" && totalCents === null) {
      problem = "Der Rechnungsbetrag ist nicht lesbar. Bitte so eintragen: 1190,00";
    } else if (problem === null && rest !== null && rest !== 0) {
      problem =
        rest > 0
          ? `Vom Rechnungsbetrag sind noch ${formatEuro(rest)} nicht auf Positionen verteilt.`
          : `Die Positionen ergeben ${formatEuro(-rest)} mehr als der Rechnungsbetrag.`;
    }
    if (problem !== null) {
      setError(problem);
      return;
    }
    const update: InvoiceUpdate = {
      invoicer_id: Number(invoicerId),
      number: number.trim(),
      internal_number: internal.trim(),
      invoice_date: date,
      lines: parsed,
      total_gross_cents: totalCents,
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
    <section className="panel" aria-labelledby="rechnung-formular-titel" ref={reveal} tabIndex={-1}>
      <div className="panel-head">
        <h2 id="rechnung-formular-titel">
          {invoice ? `Rechnung ${invoice.number} bearbeiten` : "Rechnung erfassen"}
        </h2>
      </div>
      <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
        <fieldset className="budget-fieldset">
          <legend>Kopf</legend>
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
        </fieldset>
        {lines.map((line, index) => {
          const gross = lineGross(line);
          return (
            <fieldset key={line.key} className="budget-fieldset">
              <legend>{lines.length > 1 ? `Position ${index + 1}` : "Position"}</legend>
              <div className="tool-row">
                <label className="narrow">
                  Budgetposten suchen
                  <input
                    type="search"
                    value={line.search}
                    placeholder="Name oder Konto"
                    onChange={(event) => change(line.key, { search: event.target.value })}
                  />
                </label>
                <label>
                  Budgetposten
                  <select
                    value={line.itemId}
                    onChange={(event) => change(line.key, { itemId: event.target.value })}
                  >
                    <option value="">Bitte wählen</option>
                    {STATUS_ORDER.map((group) => {
                      const members = itemChoices.filter(
                        (entry) =>
                          statusOf(entry.id) === group &&
                          (itemMatches(entry, line.search) || String(entry.id) === line.itemId),
                      );
                      if (members.length === 0) {
                        return null;
                      }
                      return (
                        <optgroup key={group ?? "ohne"} label={groupLabel(group, yearName)}>
                          {members.map((entry) => (
                            <option key={entry.id} value={entry.id}>
                              {entry.account_number} · {entry.name} · erwartet{" "}
                              {formatEuro(entry.amount_cents)}
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </label>
                <label>
                  Vertrag (freiwillig)
                  <select
                    value={line.contractId}
                    onChange={(event) => pickContract(line, event.target.value)}
                  >
                    <option value="">ohne Vertrag</option>
                    {contractChoices.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.title} · {entry.partner_name}
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
                    value={line.net}
                    onChange={(event) => change(line.key, { net: event.target.value })}
                  />
                </label>
                <label className="narrow">
                  Steuersatz (%)
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.rate}
                    onChange={(event) => change(line.key, { rate: event.target.value })}
                  />
                </label>
                <label className="narrow">
                  Brutto laut Rechnung (freiwillig)
                  <input
                    type="text"
                    inputMode="decimal"
                    value={line.gross}
                    onChange={(event) => change(line.key, { gross: event.target.value })}
                  />
                </label>
                <label>
                  Bezeichnung (freiwillig)
                  <input
                    type="text"
                    value={line.description}
                    maxLength={200}
                    onChange={(event) => change(line.key, { description: event.target.value })}
                  />
                </label>
              </div>
              <p className="small">
                {gross !== null
                  ? `Brutto der Position: ${formatEuro(gross)}`
                  : "Das Brutto rechnet die Werkbank aus Netto und Steuersatz."}
              </p>
              <div className="budget-checks">
                <label className="check-label">
                  <input
                    type="checkbox"
                    className="check"
                    checked={line.project}
                    onChange={(event) => change(line.key, { project: event.target.checked })}
                  />
                  Gehört zu einem Projekt
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    className="check"
                    checked={line.yearly}
                    onChange={(event) => change(line.key, { yearly: event.target.checked })}
                  />
                  Kommt jährlich wieder
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    className="check"
                    checked={line.closes}
                    onChange={(event) => change(line.key, { closes: event.target.checked })}
                  />
                  Schließt den Budgetposten ab
                </label>
                {lines.length > 1 && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setLines(lines.filter((entry) => entry.key !== line.key))}
                  >
                    Position {index + 1} entfernen
                  </button>
                )}
              </div>
            </fieldset>
          );
        })}
        {lines.length < INVOICE_LINES_MAX && (
          <div>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setLines([...lines, emptyLine(nextKey)]);
                setNextKey(nextKey + 1);
              }}
            >
              Position hinzufügen
            </button>
          </div>
        )}
        <fieldset className="budget-fieldset">
          <legend>Summe</legend>
          <div className="tool-row">
            <label className="narrow">
              Rechnungsbetrag laut Beleg (brutto, freiwillig)
              <input
                type="text"
                inputMode="decimal"
                value={total}
                onChange={(event) => setTotal(event.target.value)}
              />
            </label>
          </div>
          <p className="small" role="status">
            {grossSum !== null && netSum !== null
              ? `Summe der Positionen: netto ${formatEuro(netSum)}, brutto ${formatEuro(grossSum)}.`
              : "Die Summe erscheint, sobald alle Beträge lesbar sind."}
            {rest === 0 && " Das entspricht dem Rechnungsbetrag."}
            {rest !== null && rest > 0 && ` Noch nicht verteilt: ${formatEuro(rest)}.`}
            {rest !== null && rest < 0 && ` Zu viel verteilt: ${formatEuro(-rest)}.`}
            {
              " Fürs Budget zählt das Brutto. Weicht eine Position um Cent ab, trage ihr Brutto ein (höchstens 1 Euro Abweichung)."
            }
          </p>
        </fieldset>
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
  startMonth: number;
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
    Promise.all([
      fetchInvoices(year),
      fetchPartners(),
      fetchItems(),
      fetchContracts(),
      fetchBudgetSettings(),
    ])
      .then(([list, partners, items, contracts, settings]) => {
        if (active) {
          setData({
            list,
            partners,
            items,
            contracts: contracts.entries,
            startMonth: settings.start_month,
          });
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
      .then(() =>
        done(`Rechnung ${entry.number} ist geprüft und gebucht. Sie zählt jetzt zum Ist.`),
      )
      .catch((error: unknown) => fail(error, "Die Rechnung konnte nicht gebucht werden."));
  };
  const onDelete = (entry: Invoice) => {
    deleteInvoice(entry.id)
      .then(() => done(`Rechnung ${entry.number} ist gelöscht.`))
      .catch((error: unknown) => fail(error, "Die Rechnung konnte nicht gelöscht werden."));
  };

  const onUpload = (entry: Invoice, file: File | undefined) => {
    if (!file) {
      return;
    }
    if (file.size > DOCUMENT_MAX_MB * 1024 * 1024) {
      setMessage({ kind: "alert", text: `Die Datei ist größer als ${DOCUMENT_MAX_MB} MB.` });
      return;
    }
    setMessage(null);
    uploadDocument(entry.id, file)
      .then(() => done(`Der Beleg zu ${entry.number} ist gespeichert.`))
      .catch((error: unknown) => fail(error, "Der Beleg konnte nicht gespeichert werden."));
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
          startMonth={data.startMonth}
          listYear={data.list.year}
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
                <th scope="col">Positionen (Konto, Budgetposten)</th>
                <th scope="col" className="betrag">
                  Netto
                </th>
                <th scope="col" className="betrag">
                  Brutto
                </th>
                <th scope="col">Status</th>
                <th scope="col">Beleg</th>
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
                    <span className="small budget-muted tenant-part">{entry.internal_number}</span>
                  </th>
                  <td>
                    <ul className="budget-lines">
                      {entry.lines.map((line) => (
                        <li key={line.id}>
                          <span className="mono">{line.account_number}</span> {line.item_name}
                          <span className="small budget-muted tenant-part">
                            {[
                              entry.lines.length > 1
                                ? `${formatEuro(line.gross_cents)} brutto`
                                : "",
                              `${formatRate(line.tax_rate_bp)} Steuer`,
                              line.description,
                              line.is_project ? "Projekt" : "",
                              line.is_yearly ? "jährlich" : "",
                              line.closes_item ? "schließt ab" : "",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                            {line.contract_id !== null && (
                              <>
                                {" · "}
                                <Link to={`${BUDGET_CONTRACTS_PATH}/${line.contract_id}`}>
                                  {line.contract_title}
                                </Link>
                              </>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="betrag">{formatEuro(entry.net_cents)}</td>
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
                  <td>
                    {entry.doc_name ? (
                      <>
                        <a href={documentUrl(entry.id)} download={entry.doc_name}>
                          {entry.doc_name}
                        </a>
                        <span className="small budget-muted tenant-part">
                          PDF{entry.doc_size ? `, ${fileSize(entry.doc_size)}` : ""}
                        </span>
                        {mayChange(entry) && (
                          <DeleteButton
                            what={`Beleg von Rechnung ${entry.number}`}
                            run={() => deleteDocument(entry.id)}
                            onDeleted={() => done(`Der Beleg von ${entry.number} ist entfernt.`)}
                          />
                        )}
                      </>
                    ) : mayChange(entry) ? (
                      <label className="button button-secondary budget-upload">
                        Beleg hochladen
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          className="visually-hidden"
                          aria-label={`Beleg zu Rechnung ${entry.number} hochladen (PDF)`}
                          onChange={(event) => {
                            onUpload(entry, event.target.files?.[0]);
                            event.target.value = "";
                          }}
                        />
                      </label>
                    ) : (
                      <span className="budget-muted">kein Beleg</span>
                    )}
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
