import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { errorText } from "../../api";
import { ConfirmButton } from "../../components/ConfirmDialog";
import { FilterBar } from "../../components/FilterBar";
import { Link } from "../../components/Link";
import { SplitHandle, useSplit } from "../../components/SplitHandle";
import { BUDGET_INVOICES_PATH } from "../../navigation";
import { navigate, useSearchParam } from "../../router";
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
  fetchInvoices,
  fetchBudgetSettings,
  fetchItems,
  fiscalYearOf,
  fetchPartners,
  fileSize,
  formatBudgetDay,
  formatEuro,
  formatRate,
  grossCents,
  parseEuro,
  rememberedYear,
  rememberYear,
  STATUS_LABELS,
  updateInvoice,
  uploadDocument,
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
import { AmountFields, amountValue, readAmount, type AmountValue } from "./AmountFields";
import { BudgetHead, DeleteButton, FormStep, ReadOnlyNote } from "./shared";
import { Feedback } from "../../components/Feedback";
import {
  ErrorSummary,
  Field,
  problemFor,
  RequiredNote,
  type Problem,
} from "../../components/Field";
import { ListPicker } from "../inventory/LookupPicker";
import {
  contractPath,
  CopyLinkBar,
  invoicePath,
  itemPath,
  LinkedBlock,
  linkedYear,
  PdfLink,
  type LinkedEntry,
} from "./links";

interface FormProps {
  /** null: neue Rechnung erfassen. */
  invoice: Invoice | null;
  partners: Partner[];
  items: Item[];
  /** Monat, mit dem das Geschäftsjahr beginnt, und das gerade gezeigte Jahr als Vorgabe. */
  startMonth: number;
  listYear: number;
  yearLabel: string;
  onSaved: (invoice: Invoice) => void;
  onCancel: () => void;
}

/** Eingaben einer Position als Text, wie sie in den Feldern stehen. */
interface LineDraft {
  key: number;
  itemId: string;
  /** Betrag netto oder brutto mit Steuersatz */
  amount: AmountValue;
  /** Nur bei Netto: leer, dann wird Brutto gerechnet; gefüllt, dann Brutto laut Rechnung. */
  gross: string;
  description: string;
  project: boolean;
  yearly: boolean;
  /** Schließt den Posten für das Geschäftsjahr der Rechnung ab. */
  closes: boolean;
}

function emptyLine(key: number): LineDraft {
  return {
    key,
    itemId: "",
    amount: amountValue(null),
    gross: "",
    description: "",
    project: false,
    yearly: false,
    closes: true,
  };
}

function draftOf(line: InvoiceLine, key: number): LineDraft {
  return {
    key,
    itemId: String(line.item_id),
    amount: amountValue(line.net_cents, line.tax_rate_bp),
    gross:
      line.gross_cents !== grossCents(line.net_cents, line.tax_rate_bp)
        ? euroInput(line.gross_cents)
        : "",
    description: line.description,
    project: line.is_project,
    yearly: line.is_yearly,
    closes: line.closes_item,
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
  if (line.amount.mode === "netto" && typed !== "") {
    return parseEuro(typed);
  }
  const read = readAmount(line.amount);
  return "problem" in read ? null : read.gross_cents;
}

/** Netto einer Position, solange es lesbar ist; sonst null. */
function lineNet(line: LineDraft): number | null {
  const read = readAmount(line.amount);
  return "problem" in read ? null : read.net_cents;
}

function InvoiceForm({
  invoice,
  partners,
  items,
  startMonth,
  listYear,
  yearLabel,
  onSaved,
  onCancel,
}: FormProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
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
  const [tried, setTried] = useState(false);
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
  const partnerChoices = partners.filter(
    (entry) => (entry.active && entry.is_invoicer) || entry.id === invoice?.invoicer_id,
  );
  const itemChoices = items.filter((entry) => entry.active || usedItems.has(entry.id));
  // Posten des gewählten Rechnungsstellers stehen oben in der Auswahl.
  const ownItems = invoicerId
    ? itemChoices.filter((entry) => String(entry.partner_id ?? "") === invoicerId)
    : [];
  const otherItems = itemChoices.filter((entry) => !ownItems.includes(entry));
  const invoicerName = partners.find((entry) => String(entry.id) === invoicerId)?.name;
  // Auswahl der Budgetposten: zuerst die des Rechnungsstellers, dann nach Stand im Jahr.
  const itemOption = (entry: Item, group: string) => ({
    id: entry.id,
    label: `${entry.number} · ${entry.name}`,
    detail: `${entry.account_number} · erwartet ${formatEuro(entry.amount_cents)} · ${group}`,
  });
  const itemOptions = [
    ...ownItems.map((entry) =>
      itemOption(entry, `Posten von ${invoicerName ?? "diesem Rechnungssteller"}`),
    ),
    ...STATUS_ORDER.flatMap((group) =>
      otherItems
        .filter((entry) => statusOf(entry.id) === group)
        .map((entry) => itemOption(entry, groupLabel(group, yearName))),
    ),
  ];

  const change = (key: number, update: Partial<LineDraft>) =>
    setLines(lines.map((line) => (line.key === key ? { ...line, ...update } : line)));

  const itemById = (value: string) => items.find((entry) => String(entry.id) === value);
  const pickItem = (line: LineDraft, value: string) => {
    // Hat der Posten einen Vertrag (laufende Zahlungen), schließt die Position ihn nicht ab.
    change(line.key, { itemId: value, closes: !itemById(value)?.contract_id });
  };

  const sums = lines.map(lineGross);
  const grossSum = sums.every((value) => value !== null)
    ? sums.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const netSum = lines.reduce<number | null>((sum, line) => {
    const net = lineNet(line);
    return sum === null || net === null ? null : sum + net;
  }, 0);
  const totalText = total.trim();
  const totalCents = totalText === "" ? null : parseEuro(totalText);
  const rest = totalCents !== null && grossSum !== null ? totalCents - grossSum : null;

  // Geprüft wird beim Absenden, danach bei jeder Änderung.
  const problems: Problem[] = [];
  if (!invoicerId) {
    problems.push({
      id: "rechnung-steller",
      label: "Rechnungssteller",
      text: "Wähle den Rechnungssteller.",
    });
  }
  if (!number.trim()) {
    problems.push({
      id: "rechnung-nummer",
      label: "Rechnungsnummer",
      text: "Trag die Rechnungsnummer ein.",
    });
  }
  if (!date) {
    problems.push({
      id: "rechnung-datum",
      label: "Rechnungsdatum",
      text: "Trag das Rechnungsdatum ein.",
    });
  }
  const parsed: InvoiceLineUpdate[] = [];
  lines.forEach((line, index) => {
    const where = lines.length > 1 ? `Position ${index + 1}, ` : "";
    const read = readAmount(line.amount);
    const byGross = line.amount.mode === "brutto";
    const grossText = byGross ? "" : line.gross.trim();
    const grossValue = grossText === "" ? null : parseEuro(grossText);
    let fine = true;
    if (!line.itemId) {
      problems.push({
        id: `rechnung-posten-${line.key}`,
        label: `${where}Budgetposten`,
        text: "Wähle den Budgetposten.",
      });
      fine = false;
    }
    if ("problem" in read) {
      problems.push({
        id: `rechnung-betrag-${line.key}`,
        label: `${where}Betrag`,
        text: line.amount.amount.trim() ? read.problem : "Trag den Betrag ein.",
      });
      fine = false;
    }
    if (grossText !== "" && grossValue === null) {
      problems.push({
        id: `rechnung-brutto-${line.key}`,
        label: `${where}Brutto laut Rechnung`,
        text: "Nicht lesbar. Trag es so ein: 1190,00",
      });
      fine = false;
    }
    if (fine && !("problem" in read)) {
      parsed.push({
        item_id: Number(line.itemId),
        net_cents: read.net_cents,
        tax_rate_bp: read.tax_rate_bp,
        gross_cents: byGross ? read.gross_cents : grossValue,
        description: line.description.trim(),
        is_project: line.project,
        is_yearly: line.yearly,
        closes_item: line.closes,
      });
    }
  });
  if (totalText !== "" && totalCents === null) {
    problems.push({
      id: "rechnung-summe",
      label: "Rechnungsbetrag",
      text: "Nicht lesbar. Trag ihn so ein: 1190,00",
    });
  } else if (rest !== null && rest !== 0) {
    problems.push({
      id: "rechnung-summe",
      label: "Rechnungsbetrag",
      text:
        rest > 0
          ? `Davon sind noch ${formatEuro(rest)} nicht auf Positionen verteilt.`
          : `Die Positionen ergeben ${formatEuro(-rest)} mehr.`,
    });
  }
  const shown = tried ? problems : [];

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (problems.length > 0) {
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
    <section className="panel budget-pane" aria-labelledby="rechnung-formular-titel">
      <div className="panel-head case-head">
        <div>
          <p className="small">Rechnungen</p>
          <h2 id="rechnung-formular-titel" ref={heading} tabIndex={-1}>
            {invoice ? `Rechnung ${invoice.number} bearbeiten` : "Rechnung erfassen"}
          </h2>
        </div>
        <button
          type="button"
          className="button button-secondary case-close"
          aria-label="Maske schließen"
          onClick={onCancel}
        >
          ×
        </button>
      </div>
      <form className="detail-body settings-form budget-form" onSubmit={onSubmit} noValidate>
        <RequiredNote />
        <ErrorSummary problems={shown} />
        <FormStep number={1} title="Von wem">
          <ListPicker
            label="Rechnungssteller"
            id="rechnung-steller"
            required
            placeholder="Name des Rechnungsstellers …"
            hint="Danach stehen seine Budgetposten oben in der Auswahl."
            options={partnerChoices.map((entry) => ({ id: entry.id, label: entry.name }))}
            value={invoicerId}
            onChange={setInvoicerId}
            error={problemFor(shown, "rechnung-steller")}
          />
        </FormStep>
        <FormStep number={2} title="Rechnung">
          <Field
            label="Rechnungsnummer"
            id="rechnung-nummer"
            required
            error={problemFor(shown, "rechnung-nummer")}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                value={number}
                maxLength={80}
                onChange={(event) => setNumber(event.target.value)}
              />
            )}
          </Field>
          <Field label="Interne Nummer" hint="freiwillig">
            {(control) => (
              <input
                {...control}
                type="text"
                value={internal}
                maxLength={60}
                onChange={(event) => setInternal(event.target.value)}
              />
            )}
          </Field>
          <Field
            label="Rechnungsdatum"
            id="rechnung-datum"
            required
            hint={`Zählt für ${yearLabel} ${yearName}.`}
            error={problemFor(shown, "rechnung-datum")}
          >
            {(control) => (
              <input
                {...control}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            )}
          </Field>
        </FormStep>
        <FormStep number={3} title="Positionen">
          {lines.map((line, index) => {
            const gross = lineGross(line);
            return (
              <fieldset key={line.key} className="budget-fieldset form-wide">
                <legend>{lines.length > 1 ? `Position ${index + 1}` : "Position"}</legend>
                <ListPicker
                  label="Budgetposten"
                  id={`rechnung-posten-${line.key}`}
                  required
                  placeholder="Nummer, Name oder Konto …"
                  options={itemOptions}
                  value={line.itemId}
                  onChange={(value) => pickItem(line, value)}
                  error={problemFor(shown, `rechnung-posten-${line.key}`)}
                />
                {itemById(line.itemId)?.contract_title && (
                  <p className="small budget-muted">
                    Vertrag des Postens: {itemById(line.itemId)?.contract_title}
                  </p>
                )}
                <AmountFields
                  legend="Betrag der Position"
                  id={`rechnung-betrag-${line.key}`}
                  error={problemFor(shown, `rechnung-betrag-${line.key}`)}
                  value={line.amount}
                  onChange={(amount) => change(line.key, { amount })}
                  summaryText={
                    gross !== null
                      ? `Brutto der Position: ${formatEuro(gross)}${
                          line.amount.mode === "brutto"
                            ? ` · netto ${formatEuro(lineNet(line) ?? 0)}`
                            : ""
                        }`
                      : null
                  }
                  extra={
                    line.amount.mode === "netto" && (
                      <Field
                        label="Brutto laut Rechnung"
                        id={`rechnung-brutto-${line.key}`}
                        hint="freiwillig"
                        error={problemFor(shown, `rechnung-brutto-${line.key}`)}
                      >
                        {(control) => (
                          <input
                            {...control}
                            type="text"
                            inputMode="decimal"
                            value={line.gross}
                            onChange={(event) => change(line.key, { gross: event.target.value })}
                          />
                        )}
                      </Field>
                    )
                  }
                />
                <Field label="Bezeichnung" hint="freiwillig" wide>
                  {(control) => (
                    <input
                      {...control}
                      type="text"
                      value={line.description}
                      maxLength={200}
                      onChange={(event) => change(line.key, { description: event.target.value })}
                    />
                  )}
                </Field>
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
            <div className="form-wide">
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
        </FormStep>
        <FormStep number={4} title="Summe">
          <Field
            label="Rechnungsbetrag laut Beleg (brutto)"
            id="rechnung-summe"
            hint="freiwillig"
            error={problemFor(shown, "rechnung-summe")}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="decimal"
                value={total}
                onChange={(event) => setTotal(event.target.value)}
              />
            )}
          </Field>
          <p className="small form-wide form-summary" role="status">
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
        </FormStep>
        {error && (
          <p role="alert" className="hint-box hint-bad">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {invoice ? "Änderungen speichern" : "Rechnung erfassen"}
          </button>
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      </form>
    </section>
  );
}

interface Loaded {
  list: InvoiceList;
  partners: Partner[];
  items: Item[];
  startMonth: number;
  yearLabel: string;
}

/** Ansicht einer Rechnung rechts neben der Tabelle: Kopf, Positionen, Beleg und Aktionen. */
function InvoiceDetail({
  entry,
  year,
  canBook,
  mayChange,
  onBook,
  onEdit,
  onDelete,
  onUpload,
  onDocumentDeleted,
  onClose,
}: {
  entry: Invoice;
  /** Geschäftsjahr der Liste, für die Links */
  year: number;
  canBook: boolean;
  mayChange: boolean;
  onBook: () => unknown;
  onEdit: () => void;
  onDelete: () => unknown;
  onUpload: (file: File | undefined) => void;
  onDocumentDeleted: () => void;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [entry.id]);
  const booked = entry.status === "gebucht";
  const facts: [string, ReactNode][] = [
    ["Rechnungsdatum", formatBudgetDay(entry.invoice_date)],
    ["Rechnungssteller", entry.invoicer_name],
    ["Interne Nummer", entry.internal_number || "–"],
    ["Netto", formatEuro(entry.net_cents)],
    ["Brutto", formatEuro(entry.gross_cents)],
    ["Erfasst von", entry.created_by_name ?? "–"],
  ];
  if (entry.booked_by_name) {
    facts.push(["Geprüft von", entry.booked_by_name]);
  }
  // Verknüpft: je Position der Budgetposten und dessen Vertrag, jeder nur einmal
  const linkedEntries: LinkedEntry[] = [];
  const known = new Set<string>();
  for (const line of entry.lines) {
    if (!known.has(`posten-${line.item_id}`)) {
      known.add(`posten-${line.item_id}`);
      linkedEntries.push({
        key: `posten-${line.item_id}`,
        kind: "Budgetposten",
        label: `${line.item_number} ${line.item_name}`,
        path: itemPath(line.item_id, year),
        extra: `${line.account_number} ${line.account_name}`,
      });
    }
    if (line.contract_id !== null && !known.has(`vertrag-${line.contract_id}`)) {
      known.add(`vertrag-${line.contract_id}`);
      linkedEntries.push({
        key: `vertrag-${line.contract_id}`,
        kind: "Vertrag des Postens",
        label: line.contract_title ?? "Vertrag",
        path: contractPath(line.contract_id),
      });
    }
  }
  const hasPdf = entry.doc_name !== null;
  return (
    <section className="panel budget-pane" aria-labelledby="rechnung-ansicht-titel">
      <div className="panel-head case-head">
        <div>
          <p className="small">
            {formatBudgetDay(entry.invoice_date)} · {entry.invoicer_name}
          </p>
          <h2 id="rechnung-ansicht-titel" ref={heading} tabIndex={-1}>
            Rechnung {entry.number}
          </h2>
          <p className="budget-badges">
            <span className={booked ? "pill pill-ok" : "pill pill-todo"}>
              {STATUS_LABELS[entry.status]}
            </span>
          </p>
        </div>
        <button
          type="button"
          className="button button-secondary case-close"
          aria-label="Ansicht schließen"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="detail-body">
        <CopyLinkBar path={invoicePath(entry.id, year)} />
        <dl className="budget-facts">
          {facts.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="budget-section-head">
          <h3>Positionen</h3>
        </div>
        <ul className="budget-list">
          {entry.lines.map((line) => (
            <li key={line.id}>
              <span>
                <Link to={itemPath(line.item_id, year)}>
                  <span className="mono">{line.item_number}</span> {line.item_name}
                </Link>{" "}
                · {line.account_number}
                <span className="small budget-muted tenant-part">
                  {[
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
                      <Link to={contractPath(line.contract_id)}>{line.contract_title}</Link>
                    </>
                  )}
                </span>
              </span>
              <span className="budget-linked-actions">
                <span className="betrag">{formatEuro(line.gross_cents)}</span>
                {hasPdf && <PdfLink invoiceId={entry.id} number={entry.number} small />}
              </span>
            </li>
          ))}
        </ul>
        <LinkedBlock id="rechnung-verknuepft" entries={linkedEntries} />
        <div className="budget-section-head">
          <h3>Beleg</h3>
        </div>
        {entry.doc_name ? (
          <p className="budget-doc">
            <a href={documentUrl(entry.id)} download={entry.doc_name}>
              {entry.doc_name}
            </a>
            <span className="small budget-muted">
              {" "}
              PDF{entry.doc_size ? `, ${fileSize(entry.doc_size)}` : ""}
            </span>
            {mayChange && (
              <DeleteButton
                what={`Beleg von Rechnung ${entry.number}`}
                run={() => deleteDocument(entry.id)}
                onDeleted={onDocumentDeleted}
              />
            )}
          </p>
        ) : mayChange ? (
          <label className="button button-secondary budget-upload">
            Beleg hochladen
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="visually-hidden"
              aria-label={`Beleg zu Rechnung ${entry.number} hochladen (PDF)`}
              onChange={(event) => {
                onUpload(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        ) : (
          <p className="small budget-muted">kein Beleg</p>
        )}
        {!booked && !canBook && (
          <p className="small budget-muted">Prüfen und buchen darf nur der Budgetverwalter.</p>
        )}
        {(mayChange || (canBook && !booked)) && (
          <div className="actions">
            {canBook && !booked && (
              <ConfirmButton
                className="button button-primary"
                confirm={{
                  title: "Rechnung buchen?",
                  text: `Rechnung ${entry.number} über ${formatEuro(entry.gross_cents)} wird gebucht und zählt ab dann zum Ist ihrer Budgetposten. Danach lässt sie sich nicht mehr bearbeiten.`,
                  action: "Buchen",
                }}
                onConfirm={onBook}
              >
                Prüfen und buchen
              </ConfirmButton>
            )}
            {mayChange && (
              <>
                <button
                  type="button"
                  className={
                    canBook && !booked ? "button button-secondary" : "button button-primary"
                  }
                  onClick={onEdit}
                >
                  Bearbeiten
                </button>
                <ConfirmButton
                  className="button button-secondary button-danger-text"
                  confirm={{
                    title: "Rechnung löschen?",
                    text: `Rechnung ${entry.number} wird mit allen Positionen${entry.doc_name ? " und dem Beleg" : ""} gelöscht.`,
                    action: "Löschen",
                    danger: true,
                  }}
                  onConfirm={onDelete}
                >
                  Löschen
                </ConfirmButton>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

type InvoiceFilter = "alle" | "zu_pruefen" | "gebucht";
const SPLIT_KEY = "werkbank-rechnungen-breite";

/** IT-Budget › Rechnungen: erfassen, prüfen und buchen. Erst Gebuchtes zählt zum Ist.
 *  Tabelle mit Ansicht rechts; erfassen und bearbeiten ebenfalls in der Ansicht. */
type InvoiceView =
  | { kind: "rechnung"; id: number }
  | { kind: "neu"; round: number }
  | { kind: "bearbeiten"; id: number }
  | null;

export function InvoicesPage({
  roles,
  selectedId: linkedId,
}: {
  roles: readonly string[];
  /** Gesetzt (eigene Adresse /budget/rechnungen/{id}): diese Rechnung steht in der Ansicht. */
  selectedId?: number;
}) {
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const canBook = roles.includes(BUDGET_MANAGER_ROLE);
  // Geschäftsjahr aus der Adresse (?jahr=), etwa aus einem weitergegebenen Link
  const linkedYearText = useSearchParam("jahr");
  const [year, setYear] = useState<number | null>(
    () => linkedYear(linkedYearText) ?? rememberedYear(),
  );
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setViewState] = useState<InvoiceView>(
    linkedId === undefined ? null : { kind: "rechnung", id: linkedId },
  );
  // Wechselt die Adresse (Link, Zurück im Browser), folgt die Ansicht ihr.
  const [seen, setSeen] = useState({ id: linkedId, year: linkedYearText });
  if (seen.id !== linkedId || seen.year !== linkedYearText) {
    setSeen({ id: linkedId, year: linkedYearText });
    if (seen.id !== linkedId) {
      setViewState(linkedId === undefined ? null : { kind: "rechnung", id: linkedId });
    }
    const fromAddress = linkedYear(linkedYearText);
    if (
      fromAddress !== null &&
      seen.year !== linkedYearText &&
      fromAddress !== (data?.list.year ?? year)
    ) {
      rememberYear(fromAddress);
      setYear(fromAddress);
    }
  }
  /** Ansicht wechseln; die Adresse folgt, damit sich der Link einer Rechnung weitergeben lässt. */
  const setView = (next: InvoiceView) => {
    setViewState(next);
    navigate(
      next !== null && next.kind !== "neu"
        ? invoicePath(next.id, data?.list.year)
        : BUDGET_INVOICES_PATH,
    );
  };
  const [round, setRound] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<InvoiceFilter>("alle");
  const [invoicerFilter, setInvoicerFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const [split, changeSplit] = useSplit(SPLIT_KEY);

  useEffect(() => {
    let active = true;
    Promise.all([fetchInvoices(year), fetchPartners(), fetchItems(), fetchBudgetSettings()])
      .then(([list, partners, items, settings]) => {
        if (active) {
          setData({
            list,
            partners,
            items,
            startMonth: settings.start_month,
            yearLabel: settings.year_label,
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

  const done = (text: string, next: InvoiceView = null) => {
    setMessage({ kind: "status", text });
    setView(next);
    setRound(round + 1);
  };
  const fail = (error: unknown, fallback: string) =>
    setMessage({ kind: "alert", text: errorText(error, fallback) });

  const onSaved = (saved: Invoice) => {
    done(
      saved.status === "gebucht"
        ? `Rechnung ${saved.number} ist gespeichert und gebucht.`
        : `Rechnung ${saved.number} ist gespeichert und wartet auf die Prüfung.`,
      { kind: "rechnung", id: saved.id },
    );
  };
  const onBook = (entry: Invoice) =>
    bookInvoice(entry.id)
      .then(() =>
        done(`Rechnung ${entry.number} ist geprüft und gebucht. Sie zählt jetzt zum Ist.`, {
          kind: "rechnung",
          id: entry.id,
        }),
      )
      .catch((error: unknown) => fail(error, "Die Rechnung konnte nicht gebucht werden."));
  const onDelete = (entry: Invoice) =>
    deleteInvoice(entry.id)
      .then(() => done(`Rechnung ${entry.number} ist gelöscht.`))
      .catch((error: unknown) => fail(error, "Die Rechnung konnte nicht gelöscht werden."));

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
      .then(() =>
        done(`Der Beleg zu ${entry.number} ist gespeichert.`, { kind: "rechnung", id: entry.id }),
      )
      .catch((error: unknown) => fail(error, "Der Beleg konnte nicht gespeichert werden."));
  };

  const entries = data?.list.entries ?? [];
  const open = entries.filter((entry) => entry.status !== "gebucht").length;
  // Gebuchtes ändert nur der Budgetverwalter.
  const mayChange = (entry: Invoice) => canEdit && (entry.status !== "gebucht" || canBook);
  const needle = search.trim().toLowerCase();
  const shown = entries.filter(
    (entry) =>
      (statusFilter === "alle" || entry.status === statusFilter) &&
      (invoicerFilter === "" || String(entry.invoicer_id) === invoicerFilter) &&
      (accountFilter === "" || entry.lines.some((line) => line.account_number === accountFilter)) &&
      (needle === "" ||
        [
          entry.number,
          entry.internal_number,
          entry.invoicer_name,
          ...entry.lines.flatMap((line) => [line.item_name, line.item_number, line.account_number]),
        ].some((text) => text.toLowerCase().includes(needle))),
  );
  const invoicers = [...new Map(entries.map((entry) => [entry.invoicer_id, entry.invoicer_name]))]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name, "de"));
  const accountNumbers = [
    ...new Map(
      entries.flatMap((entry) =>
        entry.lines.map((line) => [
          line.account_number,
          `${line.account_number} ${line.account_name}`,
        ]),
      ),
    ),
  ].sort((left, right) => left[0].localeCompare(right[0], "de", { numeric: true }));
  const filtered =
    needle !== "" || statusFilter !== "alle" || invoicerFilter !== "" || accountFilter !== "";
  const selectedId = view && view.kind !== "neu" ? view.id : null;
  const selected =
    selectedId === null ? null : (entries.find((entry) => entry.id === selectedId) ?? null);
  const paneOpen = view !== null && (view.kind === "neu" || selected !== null);
  const closeView = () => setView(null);

  return (
    <div className="page page-wide budget-page">
      <BudgetHead
        title="Rechnungen"
        sub="Erfassen, prüfen, buchen. Erst gebuchte Rechnungen zählen zum Ist ihres Budgetpostens."
      >
        {data && (
          <div className="budget-head-actions settings-form">
            <label className="narrow">
              {data.yearLabel}
              <select
                value={data.list.year}
                onChange={(event) => {
                  rememberYear(Number(event.target.value));
                  setMessage(null);
                  setView(null);
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
            {canEdit && (
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  setMessage(null);
                  setView({ kind: "neu", round: round + 1 });
                }}
              >
                Rechnung erfassen
              </button>
            )}
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
      {data && entries.length > 0 && (
        <FilterBar<InvoiceFilter>
          search={{
            label: "Suchen",
            value: search,
            placeholder: "Rechnungsnummer, Rechnungssteller oder Posten",
            onChange: setSearch,
            hits: shown.map((entry) => ({
              key: entry.id,
              title: entry.invoicer_name,
              extra: STATUS_LABELS[entry.status],
              meta: entry.number,
              href: invoicePath(entry.id, data?.list.year),
            })),
            total: shown.length,
          }}
          status={{
            label: "Status",
            value: statusFilter,
            onChange: setStatusFilter,
            options: [
              { value: "alle", label: "Alle", count: entries.length },
              { value: "zu_pruefen", label: "Zu prüfen", count: open },
              { value: "gebucht", label: "Gebucht", count: entries.length - open },
            ],
          }}
          moreActive={(invoicerFilter !== "" ? 1 : 0) + (accountFilter !== "" ? 1 : 0)}
          onReset={
            filtered
              ? () => {
                  setSearch("");
                  setStatusFilter("alle");
                  setInvoicerFilter("");
                  setAccountFilter("");
                }
              : undefined
          }
          more={
            <>
              <label className="filter-field">
                Rechnungssteller
                <select
                  value={invoicerFilter}
                  onChange={(event) => setInvoicerFilter(event.target.value)}
                >
                  <option value="">alle</option>
                  {invoicers.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                Konto
                <select
                  value={accountFilter}
                  onChange={(event) => setAccountFilter(event.target.value)}
                >
                  <option value="">alle</option>
                  {accountNumbers.map(([number, text]) => (
                    <option key={number} value={number}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
            </>
          }
        />
      )}
      {data && entries.length > 0 && (
        <p role="status" className="small budget-muted">
          {filtered ? `${shown.length} von ${entries.length}` : entries.length}{" "}
          {entries.length === 1 ? "Rechnung" : "Rechnungen"} · {open} zu prüfen
        </p>
      )}
      <Feedback message={message} onClose={() => setMessage(null)} />
      {data && entries.length === 0 && !paneOpen && (
        <p className="panel panel-empty">
          Im {data.list.year_name} ist noch keine Rechnung erfasst.
        </p>
      )}
      {data && (entries.length > 0 || paneOpen) && (
        <div
          ref={layoutRef}
          className={
            paneOpen
              ? "case-layout case-layout-table case-layout-detail"
              : "case-layout case-layout-table"
          }
          style={{ "--case-split": split } as CSSProperties}
        >
          <div className="panel case-list">
            <div className="case-scroll">
              {entries.length > 0 && shown.length === 0 && (
                <p className="empty">Keine Rechnung passt zu Suche und Filter.</p>
              )}
              {shown.length > 0 && (
                <table className="case-table budget-invoices-table">
                  <caption className="visually-hidden">
                    Rechnungen im {data.yearLabel} {data.list.year_name}, die neueste zuerst
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Rechnung</th>
                      <th scope="col" className="col-extra">
                        Datum
                      </th>
                      <th scope="col" className="col-extra">
                        Rechnungssteller
                      </th>
                      <th scope="col" className="col-extra">
                        Budgetposten
                      </th>
                      <th scope="col">Status</th>
                      <th scope="col" className="col-extra betrag">
                        Brutto
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((entry) => {
                      const isSelected = entry.id === selectedId;
                      const openIt = () => {
                        setMessage(null);
                        setView({ kind: "rechnung", id: entry.id });
                      };
                      return (
                        <tr
                          key={entry.id}
                          className={isSelected ? "case-row is-selected" : "case-row"}
                          onClick={(event) => {
                            if (!(event.target as HTMLElement).closest("button, a")) {
                              openIt();
                            }
                          }}
                        >
                          <td className="case-title-cell">
                            <span className="case-meta small">
                              {formatBudgetDay(entry.invoice_date)} · {entry.invoicer_name}
                            </span>
                            <button
                              type="button"
                              className="button-link budget-row-title"
                              aria-current={isSelected ? "true" : undefined}
                              onClick={openIt}
                            >
                              {entry.number}
                            </button>
                            {entry.internal_number && (
                              <span className="small budget-muted tenant-part">
                                intern {entry.internal_number}
                              </span>
                            )}
                          </td>
                          <td className="col-extra nowrap">
                            {formatBudgetDay(entry.invoice_date)}
                          </td>
                          <td className="col-extra">{entry.invoicer_name}</td>
                          <td className="col-extra">
                            {entry.lines.length === 1
                              ? entry.lines[0]?.item_name
                              : `${entry.lines.length} Posten`}
                            <span className="small budget-muted tenant-part">
                              {[
                                ...new Set(
                                  entry.lines.map(
                                    (line) => `${line.account_number} ${line.account_name}`,
                                  ),
                                ),
                              ].join(", ")}
                            </span>
                          </td>
                          <td className="nowrap budget-status-cell">
                            <span
                              className={
                                entry.status === "gebucht" ? "pill pill-ok" : "pill pill-todo"
                              }
                            >
                              {STATUS_LABELS[entry.status]}
                            </span>
                            {entry.doc_name !== null && (
                              <PdfLink invoiceId={entry.id} number={entry.number} small />
                            )}
                            <span className="case-meta small betrag">
                              {formatEuro(entry.gross_cents)}
                            </span>
                          </td>
                          <td className="col-extra betrag">{formatEuro(entry.gross_cents)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
          {paneOpen && (
            <SplitHandle value={split} onChange={changeSplit} container={() => layoutRef.current} />
          )}
          <div className="case-main">
            {paneOpen && (
              <>
                <a
                  className="case-back"
                  href="#"
                  onClick={(event) => {
                    event.preventDefault();
                    closeView();
                  }}
                >
                  ‹ Zur Liste
                </a>
                {view?.kind === "rechnung" && selected && (
                  <InvoiceDetail
                    key={selected.id}
                    entry={selected}
                    year={data.list.year}
                    canBook={canBook}
                    mayChange={mayChange(selected)}
                    onBook={() => onBook(selected)}
                    onEdit={() => setView({ kind: "bearbeiten", id: selected.id })}
                    onDelete={() => onDelete(selected)}
                    onUpload={(file) => onUpload(selected, file)}
                    onDocumentDeleted={() =>
                      done(`Der Beleg von ${selected.number} ist entfernt.`, {
                        kind: "rechnung",
                        id: selected.id,
                      })
                    }
                    onClose={closeView}
                  />
                )}
                {canEdit && (view?.kind === "neu" || (view?.kind === "bearbeiten" && selected)) && (
                  <InvoiceForm
                    key={view.kind === "neu" ? `neu-${view.round}` : `rechnung-${view.id}`}
                    invoice={view.kind === "bearbeiten" ? selected : null}
                    partners={data.partners}
                    items={data.items}
                    startMonth={data.startMonth}
                    listYear={data.list.year}
                    yearLabel={data.yearLabel}
                    onSaved={onSaved}
                    onCancel={() =>
                      setView(view.kind === "bearbeiten" ? { kind: "rechnung", id: view.id } : null)
                    }
                  />
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
