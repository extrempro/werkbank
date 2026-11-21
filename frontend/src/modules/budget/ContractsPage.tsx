import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { errorText } from "../../api";
import { FilterBar } from "../../components/FilterBar";
import { Link } from "../../components/Link";
import { SplitHandle, useSplit } from "../../components/SplitHandle";
import { BUDGET_CONTRACTS_PATH } from "../../navigation";
import { navigate } from "../../router";
import {
  BUDGET_EDITOR_ROLES,
  createContract,
  DEADLINE_WINDOW_DAYS,
  deadlineBadge,
  DPA_LABELS,
  dpaTone,
  euroInput,
  fetchAccounts,
  fetchBudgetSettings,
  fetchItems,
  fetchContracts,
  fetchPartners,
  formatBudgetDay,
  formatEuro,
  itemMatches,
  grossCents,
  INTERVAL_LABELS,
  parseEuro,
  parseRate,
  rememberedYear,
  rememberYear,
  share,
  termText,
  updateContract,
  type Account,
  type Contract,
  type ContractInterval,
  type ContractList,
  type DpaStatus,
  type Item,
  type Partner,
} from "./api";
import { ContractDetail } from "./ContractDetail";
import { BudgetHead, FormStep, ReadOnlyNote } from "./shared";

interface FormProps {
  /** null: neuen Vertrag anlegen. */
  contract: Contract | null;
  partners: Partner[];
  items: Item[];
  yearLabel: string;
  onSaved: (contract: Contract) => void;
  onCancel: () => void;
}

/** Ganze Zahl aus einem Eingabefeld; leer ist null, Unlesbares NaN. */
function wholeNumber(text: string): number | null {
  const clean = text.trim();
  if (clean === "") {
    return null;
  }
  return /^\d{1,3}$/.test(clean) ? Number(clean) : Number.NaN;
}

function ContractForm({ contract, partners, items, yearLabel, onSaved, onCancel }: FormProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const [title, setTitle] = useState(contract?.title ?? "");
  const [partnerId, setPartnerId] = useState(contract ? String(contract.partner_id) : "");
  const [itemIds, setItemIds] = useState<number[]>(contract?.items.map((entry) => entry.id) ?? []);
  const [itemSearch, setItemSearch] = useState("");
  const [invoicerId, setInvoicerId] = useState(
    contract?.invoicer_id ? String(contract.invoicer_id) : "",
  );
  const [dpa, setDpa] = useState<DpaStatus>(contract?.dpa_status ?? "nicht_erforderlich");
  const [number, setNumber] = useState(contract?.number ?? "");
  const [amount, setAmount] = useState(contract ? euroInput(contract.net_cents) : "");
  const [rate, setRate] = useState(
    contract ? (contract.tax_rate_bp / 100).toLocaleString("de-DE") : "19",
  );
  const [interval, setInterval] = useState<ContractInterval>(contract?.interval ?? "jaehrlich");
  const [startsOn, setStartsOn] = useState(contract?.starts_on ?? "");
  const [endsOn, setEndsOn] = useState(contract?.ends_on ?? "");
  const [renewal, setRenewal] = useState(contract?.renewal_months?.toString() ?? "");
  const [notice, setNotice] = useState(contract?.notice_months?.toString() ?? "");
  const [cancelledTo, setCancelledTo] = useState(contract?.cancelled_to ?? "");
  const [note, setNote] = useState(contract?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Stillgelegte Einträge stehen nur zur Wahl, wenn der Vertrag sie schon nutzt.
  const partnerChoices = partners.filter(
    (entry) => (entry.active && entry.is_contract_partner) || entry.id === contract?.partner_id,
  );
  const invoicerChoices = partners.filter(
    (entry) => (entry.active && entry.is_invoicer) || entry.id === contract?.invoicer_id,
  );
  // Aktive Posten und die schon zugeordneten; der Suchtext grenzt ein, Gewählte bleiben sichtbar.
  const itemChoices = items.filter(
    (entry) =>
      (entry.active || itemIds.includes(entry.id)) &&
      (itemIds.includes(entry.id) || itemMatches(entry, itemSearch)),
  );
  const toggleItem = (id: number) =>
    setItemIds(itemIds.includes(id) ? itemIds.filter((entry) => entry !== id) : [...itemIds, id]);
  // Kündigungsfrist 0 bis 12 Monate; ein älterer, längerer Wert bleibt wählbar.
  const noticeChoices = Array.from({ length: 13 }, (_, months) => months);
  if (contract?.notice_months && contract.notice_months > 12) {
    noticeChoices.push(contract.notice_months);
  }
  const netPreview = parseEuro(amount);
  const ratePreview = parseRate(rate);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const cents = parseEuro(amount);
    const taxRate = parseRate(rate);
    const renewalMonths = wholeNumber(renewal);
    const noticeMonths = wholeNumber(notice);
    let problem: string | null = null;
    if (!title.trim()) {
      problem = "Bitte eine Bezeichnung eintragen.";
    } else if (!partnerId) {
      problem = "Bitte den Vertragspartner wählen.";
    } else if (cents === null) {
      problem = "Der Betrag ist nicht lesbar. Bitte so eintragen: 1000,00";
    } else if (taxRate === null) {
      problem = "Der Steuersatz ist nicht lesbar. Bitte so eintragen: 19";
    } else if (!startsOn) {
      problem = "Bitte den Beginn eintragen.";
    } else if (endsOn && endsOn < startsOn) {
      problem = "Das Ende der Laufzeit liegt vor dem Beginn.";
    } else if (Number.isNaN(renewalMonths) || Number.isNaN(noticeMonths)) {
      problem = "Verlängerung und Kündigungsfrist bitte in ganzen Monaten eintragen.";
    } else if (renewalMonths !== null && !endsOn) {
      problem = "Eine Verlängerung gibt es nur bei einem Ende der Laufzeit.";
    }
    if (problem !== null || cents === null || taxRate === null) {
      setError(problem);
      return;
    }
    const update = {
      title: title.trim(),
      partner_id: Number(partnerId),
      item_ids: itemIds,
      invoicer_id: invoicerId ? Number(invoicerId) : null,
      dpa_status: dpa,
      number: number.trim(),
      starts_on: startsOn,
      ends_on: endsOn || null,
      renewal_months: renewalMonths,
      notice_months: noticeMonths,
      cancelled_to: cancelledTo || null,
      net_cents: cents,
      tax_rate_bp: taxRate,
      interval,
      note: note.trim(),
    };
    setBusy(true);
    setError(null);
    (contract ? updateContract(contract.id, update) : createContract(update))
      .then(onSaved)
      .catch((failure: unknown) => {
        setError(errorText(failure, "Der Vertrag konnte nicht gespeichert werden."));
        setBusy(false);
      });
  };

  const gross =
    netPreview !== null && ratePreview !== null ? grossCents(netPreview, ratePreview) : null;
  const perYear = PAYMENTS_PER_YEAR[interval];
  return (
    <section className="panel budget-pane" aria-labelledby="vertrag-formular-titel">
      <div className="panel-head case-head">
        <div>
          <p className="small">Verträge</p>
          <h2 id="vertrag-formular-titel" ref={heading} tabIndex={-1}>
            {contract ? `${contract.title} bearbeiten` : "Vertrag anlegen"}
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
        <p className="small budget-muted">
          Pflichtfelder sind mit <span aria-hidden="true">*</span>
          <span className="visually-hidden">Stern</span> markiert.
        </p>
        <FormStep number={1} title="Vertrag und Partner">
          <label className="form-wide">
            <span>
              Bezeichnung <span aria-hidden="true">*</span>
            </span>
            <input
              type="text"
              value={title}
              maxLength={160}
              required
              aria-required="true"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            <span>
              Vertragspartner <span aria-hidden="true">*</span>
            </span>
            <select
              value={partnerId}
              required
              aria-required="true"
              onChange={(event) => setPartnerId(event.target.value)}
            >
              <option value="">Bitte wählen</option>
              {partnerChoices.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rechnungssteller
            <select value={invoicerId} onChange={(event) => setInvoicerId(event.target.value)}>
              <option value="">wie Vertragspartner</option>
              {invoicerChoices.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Vertragsnummer
            <input
              type="text"
              value={number}
              maxLength={60}
              onChange={(event) => setNumber(event.target.value)}
            />
          </label>
          <label>
            Auftragsverarbeitungsvertrag (AVV)
            <select value={dpa} onChange={(event) => setDpa(event.target.value as DpaStatus)}>
              {(Object.keys(DPA_LABELS) as DpaStatus[]).map((key) => (
                <option key={key} value={key}>
                  {DPA_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        </FormStep>
        <FormStep number={2} title="Kosten">
          <div className="form-wide form-field">
            <span className="form-label" id="vertrag-turnus">
              Turnus
            </span>
            <div className="segmented" role="group" aria-labelledby="vertrag-turnus">
              {(Object.keys(INTERVAL_LABELS) as ContractInterval[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={interval === key}
                  onClick={() => setInterval(key)}
                >
                  {INTERVAL_TITLES[key]}
                </button>
              ))}
            </div>
          </div>
          <label>
            <span>
              {AMOUNT_LABELS[interval]} (netto) <span aria-hidden="true">*</span>
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              required
              aria-required="true"
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label>
            Steuersatz (%)
            <input
              type="text"
              inputMode="decimal"
              value={rate}
              onChange={(event) => setRate(event.target.value)}
            />
          </label>
          <p className="form-wide form-summary" role="status">
            {gross !== null
              ? interval === "einmalig"
                ? `Brutto ${formatEuro(gross)} einmal zum Beginn.`
                : `Brutto ${formatEuro(gross)} ${INTERVAL_EACH[interval]}${
                    perYear > 1
                      ? ` · im Jahr ${formatEuro(gross * perYear)} (${perYear} Zahlungen)`
                      : ""
                  } = Soll je ${yearLabel}, nach einer Kündigung nur bis zum Kündigungstag.`
              : "Das Brutto rechnet die Werkbank aus Netto und Steuersatz. Fürs Budget zählt das Brutto."}
          </p>
        </FormStep>
        <FormStep number={3} title="Laufzeit und Kündigung">
          <label>
            <span>
              Beginn <span aria-hidden="true">*</span>
            </span>
            <input
              type="date"
              value={startsOn}
              required
              aria-required="true"
              onChange={(event) => setStartsOn(event.target.value)}
            />
          </label>
          <label>
            Ende der Laufzeit
            <input
              type="date"
              value={endsOn}
              aria-describedby="vertrag-ende-hinweis"
              onChange={(event) => setEndsOn(event.target.value)}
            />
            <span id="vertrag-ende-hinweis" className="form-hint">
              leer: unbefristet
            </span>
          </label>
          <label>
            Verlängert sich um (Monate)
            <input
              type="text"
              inputMode="numeric"
              value={renewal}
              onChange={(event) => setRenewal(event.target.value)}
            />
          </label>
          <label>
            Kündigungsfrist
            <select value={notice} onChange={(event) => setNotice(event.target.value)}>
              <option value="">keine</option>
              {noticeChoices.map((months) => (
                <option key={months} value={months}>
                  {months === 1 ? "1 Monat" : `${months} Monate`} zum Laufzeitende
                </option>
              ))}
            </select>
          </label>
          {contract && (
            <label>
              Gekündigt zum
              <input
                type="date"
                value={cancelledTo}
                aria-describedby="vertrag-gekuendigt-hinweis"
                onChange={(event) => setCancelledTo(event.target.value)}
              />
              <span id="vertrag-gekuendigt-hinweis" className="form-hint">
                Danach zählt das Soll nichts mehr.
              </span>
            </label>
          )}
          <label className="form-wide">
            Notiz
            <input
              type="text"
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
        </FormStep>
        <FormStep
          number={4}
          title={`Budgetposten (${itemIds.length} zugeordnet)`}
          hint="freiwillig"
        >
          <p className="small budget-muted form-wide">
            Der Vertrag wird den Posten nur zugeordnet. Ins Budget gehen seine Kosten über die
            Rechnungen auf diese Posten. Ein Posten hat höchstens einen Vertrag.
          </p>
          <label className="form-wide">
            Budgetposten suchen
            <input
              type="search"
              value={itemSearch}
              placeholder="Nummer, Name oder Konto"
              onChange={(event) => setItemSearch(event.target.value)}
            />
          </label>
          {itemChoices.length === 0 ? (
            <p className="small budget-muted form-wide">Kein Budgetposten passt zur Suche.</p>
          ) : (
            <ul className="budget-choices form-wide">
              {itemChoices.map((entry) => {
                // Ein Posten mit einem anderen Vertrag ist hier nicht wählbar.
                const other =
                  entry.contract_id && entry.contract_id !== contract?.id
                    ? entry.contract_title
                    : null;
                return (
                  <li key={entry.id}>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        className="check"
                        checked={itemIds.includes(entry.id)}
                        disabled={other !== null && !itemIds.includes(entry.id)}
                        onChange={() => toggleItem(entry.id)}
                      />
                      {entry.number} · {entry.account_number} · {entry.name}
                      {other !== null && (
                        <span className="small budget-muted"> (Vertrag: {other})</span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </FormStep>
        {error && (
          <p role="alert" className="hint-box hint-bad">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {contract ? "Änderungen speichern" : "Vertrag speichern"}
          </button>
          <button type="button" className="button button-secondary" onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      </form>
    </section>
  );
}

/** Zahlungen in einem vollen Jahr je Turnus (einmalig: keine laufenden). */
const PAYMENTS_PER_YEAR: Record<ContractInterval, number> = {
  monatlich: 12,
  vierteljaehrlich: 4,
  halbjaehrlich: 2,
  jaehrlich: 1,
  einmalig: 0,
};

const INTERVAL_TITLES: Record<ContractInterval, string> = {
  monatlich: "Monatlich",
  vierteljaehrlich: "Vierteljährlich",
  halbjaehrlich: "Halbjährlich",
  jaehrlich: "Jährlich",
  einmalig: "Einmalig",
};

/** Das Betragsfeld heißt passend zum Turnus. */
const AMOUNT_LABELS: Record<ContractInterval, string> = {
  monatlich: "Monatsbetrag",
  vierteljaehrlich: "Betrag je Quartal",
  halbjaehrlich: "Betrag je Halbjahr",
  jaehrlich: "Jahresbetrag",
  einmalig: "Betrag",
};

const INTERVAL_EACH: Record<ContractInterval, string> = {
  monatlich: "je Monat",
  vierteljaehrlich: "je Quartal",
  halbjaehrlich: "je Halbjahr",
  jaehrlich: "im Jahr",
  einmalig: "einmalig",
};

interface Loaded {
  list: ContractList;
  partners: Partner[];
  items: Item[];
  accounts: Account[];
  yearLabel: string;
}

type ContractFilter = "laufend" | "bald" | "gekuendigt" | "avv" | "alle";
const SPLIT_KEY = "werkbank-vertraege-breite";

/** IT-Budget › Verträge: Tabelle mit Ansicht rechts. Ein gewählter Vertrag (eigene Adresse)
 *  öffnet neben der Tabelle; anlegen und bearbeiten ebenfalls dort. */
export function ContractsPage({
  roles,
  selectedId,
}: {
  roles: readonly string[];
  /** Gesetzt: dieser Vertrag steht in der Ansicht rechts. */
  selectedId?: number;
}) {
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<ContractFilter>("laufend");
  const [search, setSearch] = useState("");
  const [partnerFilter, setPartnerFilter] = useState("");
  const [intervalFilter, setIntervalFilter] = useState<ContractInterval | "">("");
  const [year, setYear] = useState<number | null>(rememberedYear);
  // Maske in der Ansicht: neuer Vertrag oder der gewählte
  const [form, setForm] = useState<
    { kind: "neu"; round: number } | { kind: "bearbeiten"; id: number } | null
  >(null);
  const [status, setStatus] = useState<string | null>(null);
  // Nach dem Speichern neu laden: Reihenfolge und Termine rechnet der Server.
  const [round, setRound] = useState(0);
  const layoutRef = useRef<HTMLDivElement>(null);
  const [split, changeSplit] = useSplit(SPLIT_KEY);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchContracts(year),
      fetchPartners(),
      fetchItems(),
      fetchAccounts().catch((): Account[] => []),
      // Die Bezeichnung des Geschäftsjahrs ist eine Zugabe.
      fetchBudgetSettings().catch(() => null),
    ])
      .then(([list, partners, items, accounts, settings]) => {
        if (active) {
          setData({
            list,
            partners,
            items,
            accounts,
            yearLabel: settings?.year_label ?? "Geschäftsjahr",
          });
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
  }, [round, year]);

  const select = (id: number | null) =>
    navigate(id === null ? BUDGET_CONTRACTS_PATH : `${BUDGET_CONTRACTS_PATH}/${id}`);

  const onSaved = (saved: Contract) => {
    setStatus(`${saved.title} ist gespeichert.`);
    setForm(null);
    setRound(round + 1);
    select(saved.id);
  };

  const all = data?.list.entries ?? [];
  const running = all.filter((entry) => entry.running);
  const isSoon = (entry: Contract) =>
    entry.running &&
    entry.days_to_deadline !== null &&
    entry.days_to_deadline >= 0 &&
    entry.days_to_deadline <= DEADLINE_WINDOW_DAYS;
  const matchesFilter = (entry: Contract, key: ContractFilter) =>
    key === "alle"
      ? true
      : key === "laufend"
        ? entry.running
        : key === "bald"
          ? isSoon(entry)
          : key === "gekuendigt"
            ? entry.cancelled_to !== null
            : entry.dpa_status === "fehlt";
  const needle = search.trim().toLowerCase();
  const shown = all.filter(
    (entry) =>
      matchesFilter(entry, filter) &&
      (partnerFilter === "" || String(entry.partner_id) === partnerFilter) &&
      (intervalFilter === "" || entry.interval === intervalFilter) &&
      (needle === "" ||
        [entry.title, entry.partner_name, entry.invoicer_name ?? "", entry.number, entry.note]
          .concat(entry.items.flatMap((item) => [item.name, item.number]))
          .some((text) => text.toLowerCase().includes(needle))),
  );
  const soon = running.filter(isSoon).length;
  const missingDpa = running.filter((entry) => entry.dpa_status === "fehlt").length;
  const target = all.reduce((sum, entry) => sum + entry.current_year_cents, 0);
  const actual = all.reduce((sum, entry) => sum + entry.year_actual_cents, 0);
  const yearName = data?.list.current_year_name ?? "";
  const label = data?.yearLabel ?? "Geschäftsjahr";
  const selected =
    selectedId === undefined ? null : (all.find((entry) => entry.id === selectedId) ?? null);
  const paneOpen =
    form !== null || (selectedId !== undefined && (selected !== null || data !== null));
  const filtered =
    needle !== "" || filter !== "laufend" || partnerFilter !== "" || intervalFilter !== "";
  const partnersInList = [...new Map(all.map((entry) => [entry.partner_id, entry.partner_name]))]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name, "de"));
  const closeView = () => {
    setForm(null);
    select(null);
  };

  return (
    <div className="page page-wide budget-page">
      <BudgetHead
        title="Verträge"
        sub="Soll: im Jahr fällige Zahlungen. Ist: Rechnungen der zugeordneten Posten, sobald sie abgeschlossen sind."
      >
        {data && (
          <div className="budget-head-actions settings-form">
            <label className="narrow">
              {label}
              <select
                value={data.list.year}
                onChange={(event) => {
                  rememberYear(Number(event.target.value));
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
                  setStatus(null);
                  setForm({ kind: "neu", round: round + 1 });
                }}
              >
                Vertrag anlegen
              </button>
            )}
          </div>
        )}
      </BudgetHead>
      <ReadOnlyNote roles={roles} />

      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Verträge konnten nicht geladen werden.
        </p>
      )}
      {!failed && !data && <p role="status">Wird geladen …</p>}
      {data && all.length > 0 && (
        <dl className="budget-cards">
          <div className="panel budget-card">
            <dt>Laufende Verträge</dt>
            <dd className="budget-card-value">{running.length}</dd>
            <dd className="budget-card-sub">
              {soon} {soon === 1 ? "Kündigungstermin" : "Kündigungstermine"} in{" "}
              {DEADLINE_WINDOW_DAYS} Tagen
            </dd>
          </div>
          <div className="panel budget-card">
            <dt>Soll {yearName}</dt>
            <dd className="budget-card-value">{formatEuro(target)}</dd>
            <dd className="budget-card-sub">fällige Zahlungen</dd>
          </div>
          <div className="panel budget-card">
            <dt>Ist {yearName}</dt>
            <dd className="budget-card-value">{formatEuro(actual)}</dd>
            <dd className="budget-card-sub">{share(actual, target)} % des Solls</dd>
          </div>
          <div className="panel budget-card">
            <dt>AVV fehlt</dt>
            <dd className="budget-card-value">{missingDpa}</dd>
            <dd className="budget-card-sub">
              {missingDpa > 0 ? "bitte nachreichen" : "bei allen laufenden Verträgen da"}
            </dd>
          </div>
        </dl>
      )}
      {data && all.length > 0 && (
        <FilterBar<ContractFilter>
          search={{
            label: "Verträge suchen",
            value: search,
            placeholder: "Vertrag, Partner, Vertragsnummer oder Posten",
            onChange: setSearch,
          }}
          status={{
            label: "Status",
            value: filter,
            onChange: setFilter,
            options: [
              { value: "laufend", label: "Laufend", count: running.length },
              { value: "bald", label: "Kündigung bald", count: soon },
              {
                value: "gekuendigt",
                label: "Gekündigt",
                count: all.filter((entry) => entry.cancelled_to !== null).length,
              },
              {
                value: "avv",
                label: "AVV fehlt",
                count: all.filter((entry) => entry.dpa_status === "fehlt").length,
              },
              { value: "alle", label: "Alle", count: all.length },
            ],
          }}
          moreActive={(partnerFilter !== "" ? 1 : 0) + (intervalFilter !== "" ? 1 : 0)}
          onReset={
            filtered
              ? () => {
                  setSearch("");
                  setFilter("laufend");
                  setPartnerFilter("");
                  setIntervalFilter("");
                }
              : undefined
          }
          more={
            <>
              <label className="filter-field">
                Vertragspartner
                <select
                  value={partnerFilter}
                  onChange={(event) => setPartnerFilter(event.target.value)}
                >
                  <option value="">alle</option>
                  {partnersInList.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="filter-field">
                Turnus
                <select
                  value={intervalFilter}
                  onChange={(event) =>
                    setIntervalFilter(event.target.value as ContractInterval | "")
                  }
                >
                  <option value="">alle</option>
                  {(Object.keys(INTERVAL_LABELS) as ContractInterval[]).map((key) => (
                    <option key={key} value={key}>
                      {INTERVAL_TITLES[key]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          }
        />
      )}
      {status && (
        <p role="status" className="hint-box">
          {status}
        </p>
      )}
      {data && all.length === 0 && !paneOpen && (
        <p className="panel panel-empty">Es sind noch keine Verträge angelegt.</p>
      )}
      {data && (all.length > 0 || paneOpen) && (
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
              {all.length > 0 && shown.length === 0 && (
                <p className="empty">Kein Vertrag passt zu Suche und Filter.</p>
              )}
              {shown.length > 0 && (
                <table className="case-table budget-contracts-table">
                  <caption className="visually-hidden">Verträge nach Kündigungstermin</caption>
                  <thead>
                    <tr>
                      <th scope="col">Vertrag</th>
                      <th scope="col" className="col-extra betrag">
                        Kosten
                      </th>
                      <th scope="col" className="col-extra betrag">
                        Soll {yearName}
                      </th>
                      <th scope="col" className="col-extra betrag">
                        Ist {yearName}
                      </th>
                      <th scope="col">Kündigung</th>
                      <th scope="col" className="col-extra">
                        AVV
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((entry) => (
                      <ContractRow
                        key={entry.id}
                        entry={entry}
                        selected={entry.id === selectedId && form?.kind !== "neu"}
                        onOpen={() => {
                          setStatus(null);
                          setForm(null);
                          select(entry.id);
                        }}
                      />
                    ))}
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
                  href={BUDGET_CONTRACTS_PATH}
                  onClick={(event) => {
                    event.preventDefault();
                    closeView();
                  }}
                >
                  ‹ Zur Liste
                </a>
                {form === null && selectedId !== undefined && !selected && (
                  <p className="panel panel-empty">
                    Diesen Vertrag gibt es nicht.{" "}
                    <Link to={BUDGET_CONTRACTS_PATH}>Zu den Verträgen</Link>
                  </p>
                )}
                {form === null && selected && (
                  <ContractDetail
                    contract={selected}
                    year={data.list.year}
                    yearName={yearName}
                    accounts={data.accounts}
                    canEdit={canEdit}
                    onEdit={() => setForm({ kind: "bearbeiten", id: selected.id })}
                    onDeleted={() => {
                      setStatus(`${selected.title} ist gelöscht.`);
                      setRound(round + 1);
                      closeView();
                    }}
                    onItemsCreated={(text) => {
                      setStatus(text);
                      setRound(round + 1);
                    }}
                    onClose={closeView}
                  />
                )}
                {canEdit && form !== null && (form.kind === "neu" || selected) && (
                  <ContractForm
                    key={form.kind === "neu" ? `neu-${form.round}` : `vertrag-${form.id}`}
                    contract={form.kind === "bearbeiten" ? selected : null}
                    partners={data.partners}
                    items={data.items}
                    yearLabel={label}
                    onSaved={onSaved}
                    onCancel={() => setForm(null)}
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

/** Zeile der Vertragstabelle: ganz anklickbar; für Tastatur zählt der Verweis im Titel. */
function ContractRow({
  entry,
  selected,
  onOpen,
}: {
  entry: Contract;
  selected: boolean;
  onOpen: () => void;
}) {
  const badge = deadlineBadge(entry);
  const path = `${BUDGET_CONTRACTS_PATH}/${entry.id}`;
  return (
    <tr
      className={selected ? "case-row is-selected" : "case-row"}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("a, button")) {
          onOpen();
        }
      }}
    >
      <td className="case-title-cell">
        <span className="case-meta small">
          {entry.partner_name}
          {entry.items.length > 0 ? ` · ${entry.items.length} Posten` : ""}
        </span>
        <a
          href={path}
          aria-current={selected ? "true" : undefined}
          onClick={(event) => {
            const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
            if (event.button !== 0 || modified) {
              return;
            }
            event.preventDefault();
            onOpen();
          }}
        >
          {entry.title}
        </a>
        {!entry.running && <span className="pill pill-neutral budget-pill">beendet</span>}
        <span className="small budget-muted tenant-part">
          <span className="case-wide-only">{entry.partner_name} · </span>
          {termText(entry)}
        </span>
      </td>
      <td className="col-extra betrag">
        <strong>
          {formatEuro(entry.amount_cents)} {INTERVAL_LABELS[entry.interval]}
        </strong>
        {entry.yearly_cents !== null && entry.interval !== "jaehrlich" && (
          <span className="small budget-muted tenant-part">
            {formatEuro(entry.yearly_cents)} im Jahr
          </span>
        )}
      </td>
      <td className="col-extra betrag">{formatEuro(entry.current_year_cents)}</td>
      <td className="col-extra betrag">
        {formatEuro(entry.year_actual_cents)}
        {entry.items.length > 0 && (
          <span className="small budget-muted tenant-part">
            {entry.closed_items} von {entry.items.length} Posten abgeschlossen
          </span>
        )}
      </td>
      <td className="budget-status-cell">
        {badge ? (
          <span className={`pill pill-${badge.tone} budget-pill`}>{badge.text}</span>
        ) : entry.cancelled_to ? (
          <span className="pill pill-neutral budget-pill">gekündigt</span>
        ) : (
          <span className="budget-muted">–</span>
        )}
        <span className="small budget-muted tenant-part">
          {entry.cancelled_to
            ? `endet ${formatBudgetDay(entry.cancelled_to)}`
            : entry.notice_deadline
              ? `bis ${formatBudgetDay(entry.notice_deadline)}`
              : ""}
        </span>
        <span className="case-meta small betrag">
          {formatEuro(entry.amount_cents)} {INTERVAL_LABELS[entry.interval]}
        </span>
      </td>
      <td className="col-extra">
        <span className={`pill pill-${dpaTone(entry.dpa_status)}`}>
          {DPA_LABELS[entry.dpa_status]}
        </span>
      </td>
    </tr>
  );
}
