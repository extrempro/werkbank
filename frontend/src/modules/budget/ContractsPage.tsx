import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "../../api";
import {
  BUDGET_EDITOR_ROLES,
  createContract,
  DEADLINE_WINDOW_DAYS,
  deadlineBadge,
  DPA_LABELS,
  dpaTone,
  euroInput,
  fetchItems,
  fetchContracts,
  fetchPartners,
  formatBudgetDay,
  formatEuro,
  formatRate,
  grossCents,
  INTERVAL_LABELS,
  parseEuro,
  parseRate,
  termText,
  updateContract,
  type Contract,
  type ContractInterval,
  type ContractList,
  type DpaStatus,
  type Item,
  type Partner,
} from "./api";

interface FormProps {
  /** null: neuen Vertrag anlegen. */
  contract: Contract | null;
  partners: Partner[];
  items: Item[];
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

function ContractForm({ contract, partners, items, onSaved, onCancel }: FormProps) {
  const [title, setTitle] = useState(contract?.title ?? "");
  const [partnerId, setPartnerId] = useState(contract ? String(contract.partner_id) : "");
  const [itemId, setItemId] = useState(contract ? String(contract.item_id) : "");
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
  const itemChoices = items.filter((entry) => entry.active || entry.id === contract?.item_id);
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
    } else if (!partnerId || !itemId) {
      problem = "Bitte Vertragspartner und Budgetposten wählen.";
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
      item_id: Number(itemId),
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

  return (
    <section className="panel" aria-labelledby="vertrag-formular-titel">
      <div className="panel-head">
        <h2 id="vertrag-formular-titel">
          {contract ? `${contract.title} bearbeiten` : "Vertrag anlegen"}
        </h2>
      </div>
      <form className="detail-body settings-form" onSubmit={onSubmit} noValidate>
        <div className="tool-row">
          <label>
            Bezeichnung
            <input
              type="text"
              value={title}
              maxLength={160}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label className="narrow">
            Vertragsnummer (freiwillig)
            <input
              type="text"
              value={number}
              maxLength={60}
              onChange={(event) => setNumber(event.target.value)}
            />
          </label>
        </div>
        <div className="tool-row">
          <label>
            Vertragspartner
            <select value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
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
        </div>
        <div className="tool-row">
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
            Betrag je Zahlung (netto, Euro)
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
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
            Turnus
            <select
              value={interval}
              onChange={(event) => setInterval(event.target.value as ContractInterval)}
            >
              {(Object.keys(INTERVAL_LABELS) as ContractInterval[]).map((key) => (
                <option key={key} value={key}>
                  {INTERVAL_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="small" role="status">
          {netPreview !== null && ratePreview !== null
            ? `Brutto je Zahlung: ${formatEuro(grossCents(netPreview, ratePreview))}. Fürs Budget zählt das Brutto.`
            : "Das Brutto rechnet die Werkbank aus Netto und Steuersatz. Fürs Budget zählt das Brutto."}
        </p>
        <div className="tool-row">
          <label className="narrow">
            Beginn
            <input
              type="date"
              value={startsOn}
              onChange={(event) => setStartsOn(event.target.value)}
            />
          </label>
          <label className="narrow">
            Ende der Laufzeit (leer: unbefristet)
            <input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} />
          </label>
          <label className="narrow">
            Verlängert sich um (Monate)
            <input
              type="text"
              inputMode="numeric"
              value={renewal}
              onChange={(event) => setRenewal(event.target.value)}
            />
          </label>
          <label className="narrow">
            Kündigungsfrist (Monate)
            <input
              type="text"
              inputMode="numeric"
              value={notice}
              onChange={(event) => setNotice(event.target.value)}
            />
          </label>
        </div>
        <label className="narrow">
          Auftragsverarbeitungsvertrag (AVV)
          <select value={dpa} onChange={(event) => setDpa(event.target.value as DpaStatus)}>
            {(Object.keys(DPA_LABELS) as DpaStatus[]).map((key) => (
              <option key={key} value={key}>
                {DPA_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        {contract && (
          <label className="narrow">
            Gekündigt zum (leer: nicht gekündigt)
            <input
              type="date"
              value={cancelledTo}
              onChange={(event) => setCancelledTo(event.target.value)}
            />
          </label>
        )}
        <label>
          Notiz (freiwillig)
          <input
            type="text"
            value={note}
            maxLength={500}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <p className="small">
          Die erste Zahlung zählt zum Beginn, die weiteren im gewählten Turnus. Daraus rechnet die
          Werkbank, was im Geschäftsjahr gebunden ist. Die Kündigungsfrist zählt rückwärts vom Ende
          der Laufzeit.
        </p>
        <div className="actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {contract ? "Änderungen speichern" : "Vertrag anlegen"}
          </button>
          {contract && (
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

interface Loaded {
  list: ContractList;
  partners: Partner[];
  items: Item[];
}

type View = "laufend" | "alle";

/** IT-Budget › Verträge: Verträge mit Laufzeit, Kündigungstermin und Kosten im Jahr. */
export function ContractsPage({ roles }: { roles: readonly string[] }) {
  const canEdit = BUDGET_EDITOR_ROLES.some((role) => roles.includes(role));
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>("laufend");
  const [editing, setEditing] = useState<Contract | null>(null);
  const [formRound, setFormRound] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  // Nach dem Speichern neu laden: Reihenfolge und Termine rechnet der Server.
  const [round, setRound] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([fetchContracts(), fetchPartners(), fetchItems()])
      .then(([list, partners, items]) => {
        if (active) {
          setData({ list, partners, items });
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
  }, [round]);

  const onSaved = (saved: Contract) => {
    setStatus(`${saved.title} ist gespeichert.`);
    setEditing(null);
    setFormRound(formRound + 1);
    setRound(round + 1);
  };

  const all = data?.list.entries ?? [];
  const running = all.filter((entry) => entry.running);
  const shown = view === "alle" ? all : running;
  const soon = running.filter(
    (entry) =>
      entry.days_to_deadline !== null &&
      entry.days_to_deadline >= 0 &&
      entry.days_to_deadline <= DEADLINE_WINDOW_DAYS,
  ).length;
  const missingDpa = running.filter((entry) => entry.dpa_status === "fehlt").length;

  return (
    <div className="page page-wide budget-page">
      <header className="page-head">
        <p className="module-label">IT-Budget</p>
        <h1>Verträge</h1>
        <p className="page-sub">
          Verträge mit Laufzeit und Kündigungstermin. Ihre erwarteten Kosten zählen in der Übersicht
          als „gebunden“. Alle Beträge sind brutto.
        </p>
      </header>

      {failed && (
        <p role="alert" className="panel panel-empty">
          Die Verträge konnten nicht geladen werden.
        </p>
      )}
      {!failed && !data && <p role="status">Wird geladen …</p>}
      {data && all.length === 0 && (
        <p className="panel panel-empty">Es sind noch keine Verträge angelegt.</p>
      )}
      {data && all.length > 0 && (
        <>
          <p className="budget-badges">
            <span className="pill pill-neutral">
              {running.length} {running.length === 1 ? "laufender Vertrag" : "laufende Verträge"}
            </span>
            <span className={soon > 0 ? "pill pill-todo" : "pill pill-ok"}>
              {soon} {soon === 1 ? "Termin" : "Termine"} in {DEADLINE_WINDOW_DAYS} Tagen
            </span>
            <span className={missingDpa > 0 ? "pill pill-bad" : "pill pill-ok"}>
              {missingDpa} AVV fehlt
            </span>
            <span className="pill pill-neutral">
              Gebunden {data.list.current_year_name}:{" "}
              {formatEuro(all.reduce((sum, entry) => sum + entry.current_year_cents, 0))}
            </span>
          </p>
          <div className="chips" role="group" aria-label="Verträge filtern">
            <button
              type="button"
              className="chip chip-filter"
              aria-pressed={view === "laufend"}
              onClick={() => setView("laufend")}
            >
              Laufend ({running.length})
            </button>
            <button
              type="button"
              className="chip chip-filter"
              aria-pressed={view === "alle"}
              onClick={() => setView("alle")}
            >
              Alle ({all.length})
            </button>
          </div>
          {shown.length === 0 ? (
            <p className="panel panel-empty">Es läuft kein Vertrag.</p>
          ) : (
            <div
              className="table-wrap budget-table"
              tabIndex={0}
              role="region"
              aria-label="Verträge"
            >
              <table>
                <caption className="visually-hidden">Verträge nach Kündigungstermin</caption>
                <thead>
                  <tr>
                    <th scope="col">Vertrag</th>
                    <th scope="col">Vertragspartner</th>
                    <th scope="col">Rechnungssteller</th>
                    <th scope="col" className="betrag">
                      Jahreskosten
                    </th>
                    <th scope="col">Nächster Kündigungstermin</th>
                    <th scope="col">AVV</th>
                    {canEdit && <th scope="col">Aktion</th>}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((entry) => {
                    const badge = deadlineBadge(entry);
                    return (
                      <tr key={entry.id}>
                        <th scope="row">
                          {entry.title}
                          {!entry.running && (
                            <span className="pill pill-neutral budget-pill">beendet</span>
                          )}
                          <span className="small budget-muted tenant-part">
                            {entry.account_number} · {entry.item_name} · {termText(entry)}
                            {entry.number ? ` · Nr. ${entry.number}` : ""}
                          </span>
                        </th>
                        <td>{entry.partner_name}</td>
                        <td>
                          {entry.invoicer_name ?? entry.partner_name}
                          {entry.invoicer_name && (
                            <span className="pill pill-info budget-pill">abweichend</span>
                          )}
                        </td>
                        <td className="betrag">
                          {entry.yearly_cents === null
                            ? formatEuro(entry.amount_cents)
                            : formatEuro(entry.yearly_cents)}
                          <span className="small budget-muted tenant-part">
                            {entry.yearly_cents === null
                              ? "einmalig"
                              : `${formatEuro(entry.amount_cents)} ${INTERVAL_LABELS[entry.interval]}`}
                            {` · netto ${formatEuro(entry.net_cents)} + ${formatRate(entry.tax_rate_bp)}`}
                          </span>
                        </td>
                        <td>
                          {entry.cancelled_to
                            ? `gekündigt zum ${formatBudgetDay(entry.cancelled_to)}`
                            : entry.notice_deadline
                              ? formatBudgetDay(entry.notice_deadline)
                              : "–"}
                          {badge && (
                            <span className={`pill pill-${badge.tone} budget-pill`}>
                              {badge.text}
                            </span>
                          )}
                        </td>
                        <td>
                          <span className={`pill pill-${dpaTone(entry.dpa_status)}`}>
                            {DPA_LABELS[entry.dpa_status]}
                          </span>
                        </td>
                        {canEdit && (
                          <td>
                            <button
                              type="button"
                              className="button button-secondary"
                              aria-label={`${entry.title} bearbeiten`}
                              onClick={() => {
                                setStatus(null);
                                setEditing(entry);
                              }}
                            >
                              Bearbeiten
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {status && (
        <p role="status" className="hint-box">
          {status}
        </p>
      )}
      {canEdit && data && (
        <ContractForm
          key={editing ? `vertrag-${editing.id}` : `neu-${formRound}`}
          contract={editing}
          partners={data.partners}
          items={data.items}
          onSaved={onSaved}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}
