import { ConfirmButton } from "../../components/ConfirmDialog";
import { InfoTip } from "../../components/InfoTip";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { errorText } from "../../api";
import { FilterBar, useMediaQuery } from "../../components/FilterBar";
import { Link } from "../../components/Link";
import { SplitHandle, useSplit } from "../../components/SplitHandle";
import {
  BUDGET_ACCOUNTS_PATH,
  BUDGET_INVOICES_PATH,
  BUDGET_SETTINGS_PATH,
  BUDGET_STATISTICS_PATH,
} from "../../navigation";
import { navigate, useSearchParam } from "../../router";
import {
  BUDGET_EDITOR_ROLES,
  BUDGET_MANAGER_ROLE,
  closeItem,
  createItem,
  deleteItem,
  euroInput,
  fetchAccounts,
  fetchBudgetOverview,
  fetchContracts,
  fetchInvoices,
  fetchPartners,
  fetchTags,
  formatBudgetDay,
  formatEuro,
  hasTag,
  ITEM_STATUS_LABELS,
  itemMatches,
  parseEuro,
  TAGS_MAX,
  rememberedYear,
  rememberYear,
  reopenItem,
  runtimeText,
  updateItem,
  type Account,
  type Contract,
  type Invoice,
  type Item,
  type ItemRow,
  type ItemStatus,
  type ItemUpdate,
  type Overview,
  type Partner,
  type TagCount,
} from "./api";
import { DeleteButton, FormStep, ReadOnlyNote } from "./shared";
import { fetchProjectChoices, projectPath, type ProjectChoice } from "../projects/api";

function amount(cents: number | null): string {
  return cents === null ? "–" : formatEuro(cents);
}

// Farben nach der Designrichtlinie: offen braucht noch etwas (orange), Rechnung liegt vor
// wartet (blau), abgeschlossen ist erledigt (grün).
const STATUS_PILLS: Record<ItemStatus, string> = {
  offen: "pill pill-todo",
  rechnung: "pill pill-info",
  abgeschlossen: "pill pill-ok",
};

/** Status als kleines Etikett; ohne Status (Posten läuft im Jahr nicht) ein Strich. */
export function StatusPill({ status }: { status: ItemStatus | null | undefined }) {
  if (!status) {
    return <span className="budget-muted">–</span>;
  }
  return (
    <span className={`${STATUS_PILLS[status]} budget-pill`}>{ITEM_STATUS_LABELS[status]}</span>
  );
}

type Runtime = "einmalig" | "bis" | "offen";

const RUNTIMES: { value: Runtime; label: string }[] = [
  { value: "einmalig", label: "Einmalig" },
  { value: "bis", label: "Mehrere Jahre" },
  { value: "offen", label: "Bis auf Weiteres" },
];

interface FormProps {
  /** null: neuen Budgetposten anlegen. */
  item: Item | null;
  accounts: Account[];
  /** Verträge zur Auswahl; ein Posten hat höchstens einen. */
  contracts: Contract[];
  /** IT-Projekte zur Auswahl; ein Posten gehört höchstens zu einem. */
  projects: ProjectChoice[];
  /** Partner zur Auswahl (Pflicht am Posten). */
  partners: Partner[];
  /** Die Liste der Tags, aus der der Posten wählt. */
  knownTags: TagCount[];
  /** Darf die Liste der Tags pflegen (Budgetverwalter): zeigt den Weg dorthin. */
  canManageTags: boolean;
  /** Wählbare Geschäftsjahre, aufsteigend. */
  years: { year: number; name: string }[];
  /** Vorgabe für den Beginn eines neuen Postens: das gerade gezeigte Geschäftsjahr. */
  defaultYear: number;
  yearLabel: string;
  onSaved: (item: Item) => void;
  onCancel: () => void;
}

/** Maske für einen Budgetposten in drei Abschnitten: was und bei wem, Kosten und Laufzeit,
 *  Verknüpfen. Steht in der Ansicht rechts neben der Tabelle. */
function ItemForm({
  item,
  accounts,
  contracts,
  projects,
  partners,
  knownTags,
  canManageTags,
  years,
  defaultYear,
  yearLabel,
  onSaved,
  onCancel,
}: FormProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const [accountId, setAccountId] = useState(item ? String(item.account_id) : "");
  const [partnerId, setPartnerId] = useState(item?.partner_id ? String(item.partner_id) : "");
  // Stillgelegte Partner nur, wenn der Posten sie schon hat.
  const partnerChoices = partners.filter((entry) => entry.active || entry.id === item?.partner_id);
  const [name, setName] = useState(item?.name ?? "");
  const [cost, setCost] = useState(item ? euroInput(item.amount_cents) : "");
  const [start, setStart] = useState(String(item?.start_year ?? defaultYear));
  const [runtime, setRuntime] = useState<Runtime>(
    !item || item.end_year === item.start_year
      ? "einmalig"
      : item.end_year === null
        ? "offen"
        : "bis",
  );
  const [end, setEnd] = useState(item?.end_year ? String(item.end_year) : "");
  const [contractId, setContractId] = useState(item?.contract_id ? String(item.contract_id) : "");
  const [projectId, setProjectId] = useState(item?.project_id ? String(item.project_id) : "");
  // Abgeschlossene Projekte stehen nur zur Wahl, wenn der Posten schon dazugehört.
  const projectChoices = projects.filter(
    (entry) => entry.status !== "abgeschlossen" || entry.id === item?.project_id,
  );
  const [note, setNote] = useState(item?.note ?? "");
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [active, setActive] = useState(item?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Etwas eingetragen oder gewählt: Vor dem Wechsel zu den Tags wird nachgefragt.
  const [touched, setTouched] = useState(false);
  const [leaveAsked, setLeaveAsked] = useState(false);
  const choices = accounts.filter((entry) => entry.active || entry.id === item?.account_id);
  const isChosen = (tag: string) => tags.some((entry) => entry.toLowerCase() === tag.toLowerCase());
  const toggleTag = (tag: string) => {
    setTouched(true);
    setTags(
      isChosen(tag)
        ? tags.filter((entry) => entry.toLowerCase() !== tag.toLowerCase())
        : [...tags, tag],
    );
  };

  const onManageTags = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    if (touched) {
      setLeaveAsked(true);
    } else {
      navigate(BUDGET_SETTINGS_PATH);
    }
  };
  // Ein Jahr außerhalb der Liste (z. B. ein alter Posten) bleibt wählbar.
  const yearChoices = [...years];
  for (const value of [item?.start_year, item?.end_year]) {
    if (value && !yearChoices.some((entry) => entry.year === value)) {
      yearChoices.push({ year: value, name: String(value) });
    }
  }
  yearChoices.sort((left, right) => left.year - right.year);
  const endChoices = yearChoices.filter((entry) => entry.year > Number(start));
  const yearName = (value: string) =>
    yearChoices.find((entry) => String(entry.year) === value)?.name ?? value;

  // Zusammenfassung in Worten unter Kosten und Laufzeit
  const costCents = parseEuro(cost);
  let summary: string | null = null;
  if (costCents !== null && cost.trim() !== "") {
    const each = formatEuro(costCents);
    if (runtime === "einmalig") {
      summary = `Plan: ${each} nur für ${yearLabel} ${yearName(start)}.`;
    } else if (runtime === "offen") {
      summary = `Plan: ${each} je ${yearLabel} ab ${yearName(start)}, bis du ein Ende einträgst.`;
    } else if (end && Number(end) > Number(start)) {
      const count = endChoices.filter((entry) => entry.year <= Number(end)).length + 1;
      summary = `Plan: ${each} je ${yearLabel} von ${yearName(start)} bis ${yearName(end)}, zusammen ${formatEuro(costCents * count)}.`;
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    let problem: string | null = null;
    if (!name.trim()) {
      problem = "Bitte eine Bezeichnung eintragen.";
    } else if (!accountId) {
      problem = "Bitte ein Konto wählen.";
    } else if (!partnerId) {
      problem = "Bitte einen Partner wählen.";
    } else if (costCents === null) {
      problem = "Der Betrag ist nicht lesbar. Bitte so eintragen: 15000,00";
    } else if (runtime === "bis" && (!end || Number(end) <= Number(start))) {
      problem = `Bitte wählen, bis zu welchem ${yearLabel} der Posten läuft.`;
    } else if (tags.length > TAGS_MAX) {
      problem = `Es sind höchstens ${TAGS_MAX} Tags je Budgetposten möglich.`;
    }
    if (problem !== null || costCents === null) {
      setError(problem);
      return;
    }
    const update: ItemUpdate = {
      account_id: Number(accountId),
      partner_id: Number(partnerId),
      name: name.trim(),
      amount_cents: costCents,
      start_year: Number(start),
      end_year: runtime === "einmalig" ? Number(start) : runtime === "bis" ? Number(end) : null,
      note: note.trim(),
      tags,
      active,
      contract_id: contractId ? Number(contractId) : null,
      project_id: projectId ? Number(projectId) : null,
    };
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
    <section className="panel budget-pane" aria-labelledby="posten-formular-titel">
      <div className="panel-head case-head">
        <div>
          <p className="small">
            {item ? `Budgetposten ${item.number}` : "Die Nummer wird beim Speichern vergeben."}
          </p>
          <h2 id="posten-formular-titel" ref={heading} tabIndex={-1}>
            {item ? `${item.name} bearbeiten` : "Posten hinzufügen"}
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
      <form
        className="detail-body settings-form budget-form"
        onSubmit={onSubmit}
        onChange={() => setTouched(true)}
        noValidate
      >
        <p className="small budget-muted">
          Pflichtfelder sind mit <span aria-hidden="true">*</span>
          <span className="visually-hidden">Stern</span> markiert.
        </p>
        <FormStep number={1} title="Was und bei wem">
          <label className="form-wide">
            <span>
              Bezeichnung <span aria-hidden="true">*</span>
            </span>
            <input
              type="text"
              value={name}
              maxLength={160}
              required
              aria-required="true"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>
              Konto <span aria-hidden="true">*</span>
            </span>
            <select
              value={accountId}
              required
              aria-required="true"
              onChange={(event) => setAccountId(event.target.value)}
            >
              <option value="">Bitte wählen</option>
              {choices.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.number} {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>
              Partner <span aria-hidden="true">*</span>
            </span>
            <select
              value={partnerId}
              required
              aria-required="true"
              aria-describedby="posten-partner-hinweis"
              onChange={(event) => setPartnerId(event.target.value)}
            >
              <option value="">Bitte wählen</option>
              {partnerChoices.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <span id="posten-partner-hinweis" className="form-hint">
              Die Firma, um die es geht.
            </span>
          </label>
        </FormStep>
        <FormStep number={2} title="Kosten und Laufzeit">
          <label>
            <span>
              Betrag (Brutto) <span aria-hidden="true">*</span>
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={cost}
              required
              aria-required="true"
              onChange={(event) => setCost(event.target.value)}
            />
          </label>
          <label>
            {runtime === "einmalig" ? yearLabel : `Ab ${yearLabel}`}
            <select value={start} onChange={(event) => setStart(event.target.value)}>
              {yearChoices.map((entry) => (
                <option key={entry.year} value={entry.year}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-wide form-field">
            <span className="form-label" id="posten-laufzeit">
              Laufzeit
            </span>
            <div className="segmented" role="group" aria-labelledby="posten-laufzeit">
              {RUNTIMES.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  aria-pressed={runtime === entry.value}
                  onClick={() => {
                    setTouched(true);
                    setRuntime(entry.value);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
          {runtime === "bis" && (
            <label>
              Bis {yearLabel}
              <select value={end} onChange={(event) => setEnd(event.target.value)}>
                <option value="">Bitte wählen</option>
                {endChoices.map((entry) => (
                  <option key={entry.year} value={entry.year}>
                    {entry.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {summary && (
            <p className="form-wide form-summary" aria-live="polite">
              {summary}
            </p>
          )}
        </FormStep>
        <FormStep number={3} title="Verknüpfen" hint="freiwillig">
          <label>
            Vertrag
            <select value={contractId} onChange={(event) => setContractId(event.target.value)}>
              <option value="">Kein Vertrag</option>
              {contracts.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.title} · {entry.partner_name}
                </option>
              ))}
            </select>
          </label>
          {projectChoices.length > 0 && (
            <label>
              IT-Projekt
              <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                <option value="">Kein Projekt</option>
                {projectChoices.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                    {entry.status === "abgeschlossen" ? " (abgeschlossen)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="form-wide form-field">
            <span className="form-label" id="posten-tags">
              Tags
            </span>
            {knownTags.length > 0 ? (
              <div className="chips" role="group" aria-labelledby="posten-tags">
                {knownTags.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="chip budget-tag"
                    aria-pressed={isChosen(entry.tag)}
                    onClick={() => toggleTag(entry.tag)}
                  >
                    {entry.tag}
                  </button>
                ))}
              </div>
            ) : (
              <p className="small budget-muted">
                Es gibt noch keine Tags.{" "}
                {canManageTags
                  ? "Lege sie zuerst an, dann kannst du sie hier wählen."
                  : "Der Budgetverwalter legt sie unter Einstellungen an."}
              </p>
            )}
            {canManageTags && !leaveAsked && (
              <p className="small">
                <a href={BUDGET_SETTINGS_PATH} onClick={onManageTags}>
                  Tags verwalten unter Einstellungen › Tags
                </a>
              </p>
            )}
            {canManageTags && leaveAsked && (
              <div className="hint-box" role="alert">
                <p>
                  Du hast in diesem Formular schon etwas eingetragen. Beim Wechsel zu den Tags geht
                  das verloren, weil der Budgetposten noch nicht gespeichert ist.
                </p>
                <div className="actions">
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => setLeaveAsked(false)}
                  >
                    Hierbleiben
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => navigate(BUDGET_SETTINGS_PATH)}
                  >
                    Trotzdem zu den Tags
                  </button>
                </div>
              </div>
            )}
          </div>
          <label className="form-wide">
            Notiz
            <input
              type="text"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {item && (
            <label className="check-label form-wide">
              <input
                type="checkbox"
                className="check"
                checked={active}
                onChange={(event) => setActive(event.target.checked)}
              />
              Budgetposten ist aktiv
            </label>
          )}
        </FormStep>
        {error && (
          <p role="alert" className="hint-box hint-bad">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {item ? "Änderungen speichern" : "Posten speichern"}
          </button>
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      </form>
    </section>
  );
}

const STEPS: { status: ItemStatus; label: string }[] = [
  { status: "offen", label: "offen" },
  { status: "rechnung", label: "Rechnung liegt vor" },
  { status: "abgeschlossen", label: "abgeschlossen" },
];

/** Ansicht eines Budgetpostens rechts neben der Tabelle. */
function ItemDetail({
  row,
  yearLabel,
  yearName,
  invoices,
  canEdit,
  canOpenProjects,
  onEdit,
  onClosure,
  onDeleted,
  onClose,
}: {
  row: ItemRow;
  yearLabel: string;
  yearName: string;
  /** Rechnungen des Jahres mit einer Position auf diesem Posten; null: noch nicht geladen. */
  invoices: Invoice[] | null;
  canEdit: boolean;
  canOpenProjects: boolean;
  onEdit: () => void;
  onClosure: (close: boolean) => unknown;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const { item } = row;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [item.id]);
  const level = row.status ? STEPS.findIndex((entry) => entry.status === row.status) : -1;
  const lines = (invoices ?? []).flatMap((invoice) =>
    invoice.lines.filter((line) => line.item_id === item.id).map((line) => ({ invoice, line })),
  );
  const canClose = canEdit && row.status !== null && row.status !== "abgeschlossen";
  const facts: [string, ReactNode][] = [
    ["Nummer", <span className="mono">{item.number}</span>],
    [
      "Partner",
      item.partner_name ?? (
        <span className="pill pill-todo budget-pill">fehlt – beim Bearbeiten wählen</span>
      ),
    ],
    ["Konto", `${item.account_number} ${item.account_name}`],
    ["Laufzeit", runtimeText(item)],
    ["Vertrag", item.contract_title ?? "–"],
  ];
  if (item.project_id && item.project_name) {
    facts.push([
      "IT-Projekt",
      canOpenProjects ? (
        <Link to={projectPath(item.project_id)}>{item.project_name}</Link>
      ) : (
        item.project_name
      ),
    ]);
  }
  facts.push(["Tags", item.tags.length > 0 ? item.tags.join(", ") : "–"]);
  facts.push(["Vorjahr", amount(row.previous_cents)]);
  if (item.note) {
    facts.push(["Notiz", item.note]);
  }
  const canReopen = canEdit && row.status === "abgeschlossen" && row.closed_by_hand;
  return (
    <section className="panel budget-pane" aria-labelledby="posten-ansicht-titel">
      <div className="panel-head case-head">
        <div>
          <p className="small">
            <span className="mono">{item.number}</span> · {item.account_number} {item.account_name}
          </p>
          <h2 id="posten-ansicht-titel" ref={heading} tabIndex={-1}>
            {item.name}
          </h2>
          <p className="budget-badges">
            <StatusPill status={row.status} />
            {!item.active && <span className="pill pill-neutral budget-pill">stillgelegt</span>}
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
        {row.status && (
          <div className="stepper-wrap">
            <ol className="stepper" aria-label={`Status für ${yearLabel} ${yearName}`}>
              {STEPS.map((entry, index) => {
                const done = index < level || (index === level && entry.status === "abgeschlossen");
                const current = index === level && !done;
                return (
                  <li
                    key={entry.status}
                    className={done ? "done" : current ? "current" : undefined}
                    aria-current={index === level ? "step" : undefined}
                  >
                    <span className="stepper-mark" aria-hidden="true">
                      {done ? "✓" : index + 1}
                    </span>
                    {entry.label}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
        <dl className="budget-cards budget-cards-small">
          <div className="panel budget-card">
            <dt>
              Geplant <InfoTip term="budget.geplant" />
            </dt>
            <dd className="budget-card-value">{amount(row.expected_cents)}</dd>
          </div>
          <div className="panel budget-card">
            <dt>
              Ist <InfoTip term="budget.ist" />
            </dt>
            <dd className="budget-card-value">{formatEuro(row.actual_cents)}</dd>
          </div>
          <div className="panel budget-card">
            <dt>
              Verfügbar <InfoTip term="budget.verfuegbar" />
            </dt>
            <dd className="budget-card-value">
              {row.expected_cents === null
                ? "–"
                : formatEuro(row.expected_cents - row.actual_cents)}
            </dd>
          </div>
        </dl>
        <dl className="budget-facts">
          {facts.map(([term, value]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="budget-section-head">
          <h3>Rechnungen auf diesem Posten</h3>
          {canEdit && <Link to={BUDGET_INVOICES_PATH}>Rechnung erfassen</Link>}
        </div>
        {invoices === null ? (
          <p role="status" className="small">
            Wird geladen …
          </p>
        ) : lines.length === 0 ? (
          <p className="small budget-muted">
            Für {yearLabel} {yearName} gibt es noch keine Rechnung auf diesem Posten.
          </p>
        ) : (
          <ul className="budget-list">
            {lines.map(({ invoice, line }) => (
              <li key={line.id}>
                <span>
                  {invoice.number} · {formatBudgetDay(invoice.invoice_date)}
                  <span className="small budget-muted tenant-part">
                    {invoice.status === "gebucht" ? "gebucht" : "zu prüfen"}
                  </span>
                </span>
                <span className="betrag">{formatEuro(line.gross_cents)}</span>
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="actions">
            {canClose && (
              <ConfirmButton
                className="button button-primary"
                confirm={{
                  title: "Posten abschließen?",
                  text: `${item.name} gilt dann im ${yearLabel} ${yearName} als erledigt. Mit „Wieder öffnen“ machst du das rückgängig.`,
                  action: "Abschließen",
                }}
                onConfirm={() => onClosure(true)}
              >
                Abschließen
              </ConfirmButton>
            )}
            <button
              type="button"
              className={canClose ? "button button-secondary" : "button button-primary"}
              onClick={onEdit}
            >
              Bearbeiten
            </button>
            {canReopen && (
              <ConfirmButton
                className="button button-secondary"
                confirm={{
                  title: "Posten wieder öffnen?",
                  text: `${item.name} gilt im ${yearLabel} ${yearName} wieder als offen.`,
                  action: "Wieder öffnen",
                }}
                onConfirm={() => onClosure(false)}
              >
                Wieder öffnen
              </ConfirmButton>
            )}
            <DeleteButton
              what={`Budgetposten ${item.name}`}
              run={() => deleteItem(item.id)}
              onDeleted={onDeleted}
            />
          </div>
        )}
      </div>
    </section>
  );
}

type StatusFilter = "alle" | ItemStatus | "ohne";
type SortKey = "nr" | "name" | "konto" | "partner" | "plan" | "ist";
type GroupKey = "konto" | "partner" | "keine";

const SORT_LABELS: Record<SortKey, string> = {
  nr: "Nummer",
  name: "Name",
  konto: "Konto",
  partner: "Partner",
  plan: "Geplant",
  ist: "Ist",
};

function compareRows(key: SortKey): (left: ItemRow, right: ItemRow) => number {
  const text = (value: string) => value.toLocaleLowerCase("de");
  switch (key) {
    case "name":
      return (left, right) => text(left.item.name).localeCompare(text(right.item.name), "de");
    case "konto":
      return (left, right) =>
        left.item.account_number.localeCompare(right.item.account_number, "de", {
          numeric: true,
        });
    case "partner":
      // Posten ohne Partner zuletzt
      return (left, right) =>
        (left.item.partner_name ? 0 : 1) - (right.item.partner_name ? 0 : 1) ||
        text(left.item.partner_name ?? "").localeCompare(text(right.item.partner_name ?? ""), "de");
    case "plan":
      return (left, right) => (left.expected_cents ?? 0) - (right.expected_cents ?? 0);
    case "ist":
      return (left, right) => left.actual_cents - right.actual_cents;
    default:
      return (left, right) =>
        left.item.number.localeCompare(right.item.number, "de", { numeric: true });
  }
}

const SPLIT_KEY = "werkbank-budgetposten-breite";
const NARROW_QUERY = "(max-width: 1023px)";

/** IT-Budget › Budgetposten: Tabelle mit Ansicht rechts. Ein gewählter Posten oder die Maske
 *  öffnet neben der Tabelle; schmal steht nur die Ansicht mit „Zur Liste“. */
export function ItemsPage({ roles }: { roles: readonly string[] }) {
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const canOpenProjects = roles.includes("Projekte.Reader") || roles.includes("Projekte.Editor");
  const narrow = useMediaQuery(NARROW_QUERY);
  const [year, setYear] = useState<number | null>(rememberedYear);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [knownTags, setKnownTags] = useState<TagCount[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [projects, setProjects] = useState<ProjectChoice[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [projectFilter, setProjectFilter] = useState("");
  // Suchtext aus der Adresse (Treffer der Suche oben führen mit der Nummer des Postens hierher).
  // Eigene Eingabe gilt, bis ein neuer Suchtext über die Adresse kommt.
  const linked = useSearchParam("suche");
  const [typed, setTyped] = useState({ from: linked, text: linked });
  const search = typed.from === linked ? typed.text : linked;
  const setSearch = (text: string) => setTyped({ from: linked, text });
  const [tagFilter, setTagFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("alle");
  const [sort, setSort] = useState<{ key: SortKey; up: boolean }>({ key: "nr", up: true });
  const [group, setGroup] = useState<GroupKey>("konto");
  const [failed, setFailed] = useState(false);
  // Ansicht rechts: ein gewählter Posten, die Maske für einen neuen oder einen gewählten Posten
  const [picked, setView] = useState<
    | { kind: "posten"; id: number }
    | { kind: "neu"; round: number }
    | { kind: "bearbeiten"; id: number }
    | null
  >(null);
  const [round, setRound] = useState(0);
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const [split, changeSplit] = useSplit(SPLIT_KEY);

  useEffect(() => {
    let active = true;
    // Die Tag-Liste ist eine Zugabe für Filter und Auswahl: Ohne sie bleibt die Seite nutzbar.
    const tagList = fetchTags().catch((): TagCount[] => []);
    // Ebenso die Verträge für die Auswahl im Formular.
    const contractList = fetchContracts()
      .then((list) =>
        [...list.entries].sort((left, right) => left.title.localeCompare(right.title, "de")),
      )
      .catch((): Contract[] => []);
    // Ebenso die IT-Projekte für Auswahl und Filter.
    const projectList = fetchProjectChoices().catch((): ProjectChoice[] => []);
    const partnerList = fetchPartners()
      .then((list) => [...list].sort((left, right) => left.name.localeCompare(right.name, "de")))
      .catch((): Partner[] => []);
    Promise.all([
      fetchBudgetOverview(year),
      fetchAccounts(),
      tagList,
      contractList,
      projectList,
      partnerList,
    ])
      .then(([result, list, tags, contractEntries, projectEntries, partnerEntries]) => {
        if (active) {
          setOverview(result);
          setAccounts(list);
          setKnownTags(tags);
          setContracts(contractEntries);
          setProjects(projectEntries);
          setPartners(partnerEntries);
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

  // Rechnungen des Jahres für die Ansicht eines Postens; ohne sie bleibt die Ansicht nutzbar.
  const shownYear = overview?.year ?? null;
  useEffect(() => {
    if (shownYear === null) {
      return;
    }
    let active = true;
    fetchInvoices(shownYear)
      .then((list) => active && setInvoices(list.entries))
      .catch(() => active && setInvoices([]));
    return () => {
      active = false;
    };
  }, [shownYear, round]);

  const label = overview?.settings.year_label ?? "Geschäftsjahr";
  const all = overview?.items ?? [];
  const matchesStatus = (row: ItemRow, filter: StatusFilter) =>
    filter === "alle" || (filter === "ohne" ? !row.item.partner_id : row.status === filter);
  const rows = all
    .filter(
      (row) =>
        itemMatches(row.item, search) &&
        (tagFilter === "" || hasTag(row.item, tagFilter)) &&
        matchesStatus(row, statusFilter) &&
        (projectFilter === "" || String(row.item.project_id ?? "") === projectFilter),
    )
    .sort((left, right) => {
      const result = compareRows(sort.key)(left, right);
      return (sort.up ? result : -result) || left.item.id - right.item.id;
    });
  const groups: { key: string; title: string; sub: string; rows: ItemRow[] }[] = [];
  if (group === "keine") {
    groups.push({ key: "alle", title: "", sub: "", rows });
  } else {
    const byKey = new Map<string, ItemRow[]>();
    for (const row of rows) {
      const key =
        group === "konto"
          ? `${row.item.account_number} ${row.item.account_name}`
          : (row.item.partner_name ?? "");
      byKey.set(key, [...(byKey.get(key) ?? []), row]);
    }
    const keys = [...byKey.keys()].sort((left, right) =>
      left === "" ? 1 : right === "" ? -1 : left.localeCompare(right, "de", { numeric: true }),
    );
    for (const key of keys) {
      const list = byKey.get(key) ?? [];
      groups.push({
        key,
        title: key || "Ohne Partner",
        sub: `${list.length} Posten · geplant ${formatEuro(
          list.reduce((sum, row) => sum + (row.expected_cents ?? 0), 0),
        )} · Ist ${formatEuro(list.reduce((sum, row) => sum + row.actual_cents, 0))}`,
        rows: list,
      });
    }
  }
  const sums = {
    expected: rows.reduce((sum, row) => sum + (row.expected_cents ?? 0), 0),
    actual: rows.reduce((sum, row) => sum + row.actual_cents, 0),
  };
  const filtered =
    search.trim() !== "" || tagFilter !== "" || statusFilter !== "alle" || projectFilter !== "";
  const moreActive =
    (tagFilter !== "" ? 1 : 0) +
    (projectFilter !== "" ? 1 : 0) +
    (group !== "konto" ? 1 : 0) +
    (narrow && (sort.key !== "nr" || !sort.up) ? 1 : 0);
  const yearChoices = [...(overview?.years ?? [])].sort((left, right) => left.year - right.year);
  // Kommt die Nummer eines Postens über die Adresse, öffnet er gleich (bis zum Schließen).
  const [dismissed, setDismissed] = useState("");
  const linkedRow = linked
    ? all.find((row) => row.item.number.toLowerCase() === linked.trim().toLowerCase())
    : undefined;
  const view =
    picked ??
    (linkedRow && dismissed !== linked ? { kind: "posten" as const, id: linkedRow.item.id } : null);
  const selectedId = view && view.kind !== "neu" ? view.id : null;
  const selectedRow =
    selectedId === null ? null : (all.find((row) => row.item.id === selectedId) ?? null);
  const paneOpen = view !== null && (view.kind === "neu" || selectedRow !== null);
  const closeView = () => {
    setView(null);
    setDismissed(linked);
  };

  const onItemSaved = (saved: Item) => {
    setMessage({ kind: "status", text: `${saved.name} (${saved.number}) ist gespeichert.` });
    setView({ kind: "posten", id: saved.id });
    setRound(round + 1);
  };

  /** Posten im gewählten Geschäftsjahr abhaken (close) oder das Abhaken zurücknehmen. */
  const onClosure = (row: ItemRow, close: boolean) => {
    if (!overview) {
      return;
    }
    const shown = overview.year;
    return (close ? closeItem(row.item.id, shown) : reopenItem(row.item.id, shown))
      .then(() => {
        setMessage({
          kind: "status",
          text: close
            ? `${row.item.name} ist im ${overview.settings.year_label} ${overview.year_name} abgeschlossen.`
            : `${row.item.name} ist wieder offen.`,
        });
        setRound(round + 1);
      })
      .catch((failure: unknown) =>
        setMessage({ kind: "alert", text: errorText(failure, "Das hat nicht geklappt.") }),
      );
  };

  const resetFilters = () => {
    setSearch("");
    setTagFilter("");
    setStatusFilter("alle");
    setProjectFilter("");
    setGroup("konto");
    setSort({ key: "nr", up: true });
  };

  const sortHeader = (key: SortKey, text: string, className?: string) => {
    const on = sort.key === key;
    return (
      <th
        scope="col"
        className={className}
        aria-sort={on ? (sort.up ? "ascending" : "descending") : "none"}
      >
        <button
          type="button"
          className="th-sort"
          onClick={() => setSort({ key, up: on ? !sort.up : true })}
        >
          {text}
          <span aria-hidden="true">{on ? (sort.up ? " ▲" : " ▼") : ""}</span>
        </button>
      </th>
    );
  };
  const columnCount = 8;

  return (
    <div className="page page-wide budget-page">
      <header className="page-head budget-head">
        <div>
          <p className="module-label">IT-Budget</p>
          <h1>Budgetposten</h1>
          <p className="page-sub">
            Jeder Posten ist ein Vorhaben mit Partner, Betrag und Laufzeit.
          </p>
        </div>
        {overview && (
          <div className="budget-head-actions settings-form">
            <label className="narrow">
              {label}
              <select
                value={overview.year}
                onChange={(event) => {
                  setMessage(null);
                  setView(null);
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
            {canEdit && accounts.length > 0 && (
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  setMessage(null);
                  setView({ kind: "neu", round: round + 1 });
                }}
              >
                Posten hinzufügen
              </button>
            )}
          </div>
        )}
      </header>
      <ReadOnlyNote roles={roles} />

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
      {overview && all.length > 0 && (
        <FilterBar<StatusFilter>
          search={{
            label: "Budgetposten suchen",
            value: search,
            placeholder: "Nummer, Name, Konto, Partner oder Tag",
            onChange: setSearch,
          }}
          status={{
            label: "Status",
            value: statusFilter,
            onChange: setStatusFilter,
            options: [
              { value: "alle", label: "Alle", count: all.length },
              ...(Object.keys(ITEM_STATUS_LABELS) as ItemStatus[]).map((entry) => ({
                value: entry,
                label:
                  entry === "offen"
                    ? "Offen"
                    : entry === "abgeschlossen"
                      ? "Abgeschlossen"
                      : ITEM_STATUS_LABELS[entry],
                count: all.filter((row) => row.status === entry).length,
              })),
              {
                value: "ohne",
                label: "Ohne Partner",
                count: all.filter((row) => !row.item.partner_id).length,
              },
            ],
          }}
          moreTitle="Weitere Filter und Sortierung"
          moreActive={moreActive}
          onReset={
            filtered || group !== "konto" || sort.key !== "nr" || !sort.up
              ? resetFilters
              : undefined
          }
          more={
            <>
              {knownTags.length > 0 && (
                <label className="filter-field">
                  Tag
                  <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
                    <option value="">alle</option>
                    {knownTags.map((entry) => (
                      <option key={entry.tag} value={entry.tag}>
                        {entry.tag} ({entry.items})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {projects.length > 0 && (
                <label className="filter-field">
                  IT-Projekt
                  <select
                    value={projectFilter}
                    onChange={(event) => setProjectFilter(event.target.value)}
                  >
                    <option value="">alle</option>
                    {projects.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="filter-field">
                Gruppieren
                <select
                  value={group}
                  onChange={(event) => setGroup(event.target.value as GroupKey)}
                >
                  <option value="konto">nach Konto</option>
                  <option value="partner">nach Partner</option>
                  <option value="keine">nicht gruppieren</option>
                </select>
              </label>
              {narrow && (
                <label className="filter-field">
                  Sortieren
                  <select
                    value={`${sort.key}-${sort.up ? "auf" : "ab"}`}
                    onChange={(event) => {
                      const [key, direction] = event.target.value.split("-");
                      setSort({ key: key as SortKey, up: direction === "auf" });
                    }}
                  >
                    {(Object.keys(SORT_LABELS) as SortKey[]).flatMap((key) => [
                      <option key={`${key}-auf`} value={`${key}-auf`}>
                        {SORT_LABELS[key]} aufsteigend
                      </option>,
                      <option key={`${key}-ab`} value={`${key}-ab`}>
                        {SORT_LABELS[key]} absteigend
                      </option>,
                    ])}
                  </select>
                </label>
              )}
            </>
          }
          extra={
            tagFilter !== "" ? (
              <Link to={`${BUDGET_STATISTICS_PATH}?tag=${encodeURIComponent(tagFilter)}`}>
                Statistik zu „{tagFilter}“
              </Link>
            ) : undefined
          }
        />
      )}
      {overview && accounts.length > 0 && (
        <p role="status" className="small budget-muted">
          {all.length === 0
            ? `In ${overview.year_name} läuft noch kein Budgetposten.`
            : `${filtered ? `${rows.length} von ${all.length}` : rows.length} Budgetposten · geplant ${formatEuro(sums.expected)} · Ist ${formatEuro(sums.actual)}`}
        </p>
      )}
      {message && (
        <p
          role={message.kind}
          className={message.kind === "alert" ? "hint-box hint-bad" : "hint-box"}
        >
          {message.text}
        </p>
      )}
      {overview && (all.length > 0 || paneOpen) && (
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
              {all.length > 0 && rows.length === 0 && (
                <p className="empty">Kein Budgetposten passt zu Suche und Filter.</p>
              )}
              {rows.length > 0 && (
                <table className="case-table budget-items-table">
                  <caption className="visually-hidden">
                    Budgetposten im {label} {overview.year_name}
                  </caption>
                  <thead>
                    <tr>
                      {sortHeader("nr", "Nr.", "col-nr")}
                      {sortHeader("name", "Budgetposten")}
                      {sortHeader("konto", "Konto", "col-extra")}
                      {sortHeader("partner", "Partner", "col-extra")}
                      {sortHeader("plan", "Geplant", "col-extra betrag")}
                      {sortHeader("ist", "Ist", "col-extra betrag")}
                      <th scope="col">Status</th>
                      <th scope="col" className="col-extra betrag">
                        Vorjahr
                      </th>
                    </tr>
                  </thead>
                  {groups.map((entry) => (
                    <tbody key={entry.key}>
                      {group !== "keine" && (
                        <tr className="case-group">
                          <th scope="rowgroup" colSpan={columnCount}>
                            {entry.title}
                            <span className="small budget-muted"> · {entry.sub}</span>
                          </th>
                        </tr>
                      )}
                      {entry.rows.map((row) => (
                        <ItemTableRow
                          key={row.item.id}
                          row={row}
                          selected={row.item.id === selectedId}
                          onOpen={() => {
                            setMessage(null);
                            setView({ kind: "posten", id: row.item.id });
                          }}
                        />
                      ))}
                    </tbody>
                  ))}
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
                {view?.kind === "posten" && selectedRow && (
                  <ItemDetail
                    row={selectedRow}
                    yearLabel={label}
                    yearName={overview.year_name}
                    invoices={invoices}
                    canEdit={canEdit}
                    canOpenProjects={canOpenProjects}
                    onEdit={() => setView({ kind: "bearbeiten", id: selectedRow.item.id })}
                    onClosure={(close) => onClosure(selectedRow, close)}
                    onDeleted={() => {
                      setMessage({
                        kind: "status",
                        text: `${selectedRow.item.name} ist gelöscht.`,
                      });
                      setView(null);
                      setRound(round + 1);
                    }}
                    onClose={closeView}
                  />
                )}
                {canEdit &&
                  (view?.kind === "neu" || (view?.kind === "bearbeiten" && selectedRow)) && (
                    <ItemForm
                      key={view.kind === "neu" ? `neu-${view.round}` : `posten-${view.id}`}
                      item={view.kind === "bearbeiten" && selectedRow ? selectedRow.item : null}
                      accounts={accounts}
                      contracts={contracts}
                      projects={projects}
                      partners={partners}
                      knownTags={knownTags}
                      canManageTags={roles.includes(BUDGET_MANAGER_ROLE)}
                      years={yearChoices}
                      defaultYear={overview.year}
                      yearLabel={label}
                      onSaved={onItemSaved}
                      onCancel={() =>
                        setView(view.kind === "bearbeiten" ? { kind: "posten", id: view.id } : null)
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

/** Zeile der Tabelle: ganz anklickbar; für Tastatur und Screenreader zählt der Name. */
function ItemTableRow({
  row,
  selected,
  onOpen,
}: {
  row: ItemRow;
  selected: boolean;
  onOpen: () => void;
}) {
  const { item } = row;
  return (
    <tr
      className={selected ? "case-row is-selected" : "case-row"}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("button, a")) {
          onOpen();
        }
      }}
    >
      <td className="col-nr mono nowrap">{item.number}</td>
      <td className="case-title-cell">
        <span className="case-meta small">
          <span className="mono">{item.number}</span> · {item.account_number} {item.account_name}
        </span>
        <button
          type="button"
          className="button-link budget-row-title"
          aria-current={selected ? "true" : undefined}
          onClick={onOpen}
        >
          {item.name}
        </button>
        <span className="small budget-muted tenant-part">{runtimeText(item)}</span>
        {!item.active && <span className="pill pill-neutral budget-pill">stillgelegt</span>}
      </td>
      <td className="col-extra">
        <span className="mono">{item.account_number}</span>
        <span className="small budget-muted tenant-part">{item.account_name}</span>
      </td>
      <td className="col-extra">
        {item.partner_name ?? <span className="pill pill-todo budget-pill">Partner fehlt</span>}
      </td>
      <td className="col-extra betrag">{amount(row.expected_cents)}</td>
      <td className="col-extra betrag">{formatEuro(row.actual_cents)}</td>
      <td className="nowrap budget-status-cell">
        <StatusPill status={row.status} />
        <span className="case-meta small betrag">{amount(row.expected_cents)}</span>
      </td>
      <td className="col-extra betrag budget-muted">{amount(row.previous_cents)}</td>
    </tr>
  );
}
