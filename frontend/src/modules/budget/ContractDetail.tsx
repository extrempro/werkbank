import { useEffect, useRef, useState, type ReactNode } from "react";
import { errorText } from "../../api";
import {
  createMonthlyItems,
  deadlineBadge,
  deleteContract,
  DPA_LABELS,
  dpaTone,
  formatBudgetDay,
  formatEuro,
  formatRate,
  INTERVAL_LABELS,
  type Account,
  type Contract,
} from "./api";
import { DeleteButton } from "./shared";

function day(value: string | null, fallback: string): string {
  return value ? formatBudgetDay(value) : fallback;
}

/** Was passiert, wenn niemand kündigt. */
export function followUp(contract: Contract): string {
  if (contract.cancelled_to) {
    return `Gekündigt, endet am ${formatBudgetDay(contract.cancelled_to)}.`;
  }
  if (contract.interval === "einmalig") {
    return "Einmalige Zahlung, keine laufenden Kosten.";
  }
  if (!contract.ends_on) {
    return "Läuft unbefristet weiter.";
  }
  const yearly =
    contract.yearly_cents === null ? "" : `, ${formatEuro(contract.yearly_cents)} im Jahr`;
  return contract.renewal_months
    ? `Verlängert sich um ${contract.renewal_months} Monate${yearly}.`
    : `Endet am ${formatBudgetDay(contract.ends_on)}; für die Zeit danach ist ein neuer Vertrag nötig.`;
}

/** Vorschlag am monatlichen Vertrag: je fälliger Zahlung im Jahr einen Posten anlegen. */
function MonthlyItems({
  contract,
  year,
  yearName,
  accounts,
  onCreated,
}: {
  contract: Contract;
  year: number;
  yearName: string;
  accounts: Account[];
  onCreated: (text: string) => void;
}) {
  // Vorgabe: das Konto der schon zugeordneten Posten
  const linkedNumber = contract.items[0]?.account_number;
  const linked = accounts.find((entry) => entry.number === linkedNumber);
  const [accountId, setAccountId] = useState(linked ? String(linked.id) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const payments =
    contract.amount_cents > 0 ? Math.round(contract.current_year_cents / contract.amount_cents) : 0;
  if (payments === 0) {
    return null;
  }
  const choices = accounts.filter((entry) => entry.active);
  const run = () => {
    if (!accountId) {
      setError("Bitte das Konto für die Posten wählen.");
      return;
    }
    setBusy(true);
    setError(null);
    createMonthlyItems(contract.id, year, Number(accountId))
      .then((result) => {
        setBusy(false);
        const created = result.created.length;
        onCreated(
          created === 0
            ? `Für ${yearName} gibt es die Monatsposten schon.`
            : `${created} ${created === 1 ? "Monatsposten ist" : "Monatsposten sind"} angelegt${
                result.skipped > 0 ? `, ${result.skipped} gab es schon` : ""
              }.`,
        );
      })
      .catch((failure: unknown) => {
        setBusy(false);
        setError(errorText(failure, "Die Monatsposten konnten nicht angelegt werden."));
      });
  };
  return (
    <div className="budget-suggest">
      <p className="small">
        Vorschlag: je Monat ein Budgetposten mit Partner und Monatsbetrag ({payments} für {yearName}
        ). Rechnungen buchst du dann auf den Monat.
      </p>
      <div className="settings-form budget-suggest-row">
        <label>
          Konto der Posten
          <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
            <option value="">Bitte wählen</option>
            {choices.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.number} {entry.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="button button-secondary" disabled={busy} onClick={run}>
          Monatsposten für {yearName} anlegen ({payments})
        </button>
      </div>
      {error && (
        <p role="alert" className="hint-box hint-bad">
          {error}
        </p>
      )}
    </div>
  );
}

/** IT-Budget › Verträge › ein Vertrag als Ansicht rechts neben der Tabelle: Vertragsdaten,
 *  Fristen, Zuordnung zum Budget und Aktionen. */
export function ContractDetail({
  contract,
  year,
  yearName,
  accounts,
  canEdit,
  onEdit,
  onDeleted,
  onItemsCreated,
  onClose,
}: {
  contract: Contract;
  year: number;
  yearName: string;
  accounts: Account[];
  canEdit: boolean;
  onEdit: () => void;
  onDeleted: () => void;
  onItemsCreated: (text: string) => void;
  onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), [contract.id]);
  const badge = deadlineBadge(contract);
  const facts: [string, ReactNode][] = [
    ["Vertragspartner", contract.partner_name],
    ["Rechnungssteller", contract.invoicer_name ?? contract.partner_name],
    ["Vertragsnummer", contract.number || "–"],
    ["Beginn", formatBudgetDay(contract.starts_on)],
    ["Laufzeit bis", day(contract.term_end ?? contract.ends_on, "unbefristet")],
    [
      "Kündigungsfrist",
      contract.notice_months === null ? "–" : `${contract.notice_months} Monate zum Laufzeitende`,
    ],
    [
      "Automatische Verlängerung",
      contract.renewal_months ? `ja, um ${contract.renewal_months} Monate` : "nein",
    ],
    ["Turnus", INTERVAL_LABELS[contract.interval]],
    [
      "Betrag je Zahlung",
      `${formatEuro(contract.amount_cents)} brutto (netto ${formatEuro(contract.net_cents)} + ${formatRate(contract.tax_rate_bp)})`,
    ],
    [
      "Jahreskosten brutto",
      contract.yearly_cents === null ? "einmalig" : formatEuro(contract.yearly_cents),
    ],
  ];
  return (
    <section className="panel budget-pane" aria-labelledby="vertrag-ansicht-titel">
      <div className="panel-head case-head">
        <div>
          <p className="small">
            {contract.partner_name}
            {contract.number ? ` · Nr. ${contract.number}` : ""}
          </p>
          <h2 id="vertrag-ansicht-titel" ref={heading} tabIndex={-1}>
            {contract.title}
          </h2>
          <p className="budget-badges">
            <span className={contract.running ? "pill pill-ok" : "pill pill-neutral"}>
              {contract.running ? "läuft" : "beendet"}
            </span>
            {badge && <span className={`pill pill-${badge.tone}`}>Kündigung: {badge.text}</span>}
            <span className={`pill pill-${dpaTone(contract.dpa_status)}`}>
              AVV: {DPA_LABELS[contract.dpa_status]}
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
        <dl className="budget-cards budget-cards-small">
          <div className="panel budget-card">
            <dt>Soll {yearName}</dt>
            <dd className="budget-card-value">{formatEuro(contract.current_year_cents)}</dd>
          </div>
          <div className="panel budget-card">
            <dt>Ist {yearName}</dt>
            <dd className="budget-card-value">{formatEuro(contract.year_actual_cents)}</dd>
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
        {contract.note && <p className="budget-muted">{contract.note}</p>}
        <div className="budget-section-head">
          <h3>Fristen</h3>
        </div>
        <dl className="budget-facts">
          <div>
            <dt>Nächster Kündigungstermin</dt>
            <dd>{day(contract.notice_deadline, "kein Termin")}</dd>
          </div>
          <div>
            <dt>Wenn nicht gekündigt</dt>
            <dd>{followUp(contract)}</dd>
          </div>
        </dl>
        <div className="budget-section-head">
          <h3>Budgetposten</h3>
        </div>
        {contract.items.length === 0 ? (
          <p className="small budget-muted">
            Diesem Vertrag ist noch kein Budgetposten zugeordnet.
          </p>
        ) : (
          <ul className="budget-list">
            {contract.items.map((item) => (
              <li key={item.id}>
                <span>
                  <span className="mono">{item.number}</span> · {item.name}
                  <span className="small budget-muted tenant-part">
                    {item.account_number} {item.account_name}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="small budget-muted">
          Soll: Zahlungen, die {yearName} fällig werden
          {contract.cancelled_to ? " (nur bis zur Kündigung)" : ""}. Ist:{" "}
          {formatEuro(contract.year_actual_cents)} aus {contract.closed_items} von{" "}
          {contract.items.length} abgeschlossenen Budgetposten.
        </p>
        {canEdit && contract.interval === "monatlich" && contract.running && (
          <MonthlyItems
            key={contract.id}
            contract={contract}
            year={year}
            yearName={yearName}
            accounts={accounts}
            onCreated={onItemsCreated}
          />
        )}
        {canEdit && (
          <div className="actions">
            <button type="button" className="button button-primary" onClick={onEdit}>
              Bearbeiten
            </button>
            <DeleteButton
              what={`Vertrag ${contract.title}`}
              run={() => deleteContract(contract.id)}
              onDeleted={onDeleted}
            />
          </div>
        )}
      </div>
    </section>
  );
}
