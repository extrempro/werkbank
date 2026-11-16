import { Link } from "../../components/Link";
import { BUDGET_CONTRACTS_PATH } from "../../navigation";
import {
  deadlineBadge,
  DPA_LABELS,
  dpaTone,
  formatBudgetDay,
  formatEuro,
  formatRate,
  INTERVAL_LABELS,
  type Contract,
} from "./api";

function day(value: string | null, fallback: string): string {
  return value ? formatBudgetDay(value) : fallback;
}

/** Was passiert, wenn niemand kündigt. */
function followUp(contract: Contract): string {
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

/** IT-Budget › Verträge › ein Vertrag: Vertragsdaten, Fristen und Zuordnung zum Budget. */
export function ContractDetail({ contract, yearName }: { contract: Contract; yearName: string }) {
  const badge = deadlineBadge(contract);
  const facts: [string, string][] = [
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
    ["Betrag je Zahlung netto", formatEuro(contract.net_cents)],
    ["Steuersatz", formatRate(contract.tax_rate_bp)],
    ["Betrag je Zahlung brutto", formatEuro(contract.amount_cents)],
    [
      "Jahreskosten brutto",
      contract.yearly_cents === null ? "einmalig" : formatEuro(contract.yearly_cents),
    ],
  ];
  return (
    <>
      <p>
        <Link to={BUDGET_CONTRACTS_PATH}>← Zurück zu den Verträgen</Link>
      </p>
      <p className="budget-badges">
        <span className={contract.running ? "pill pill-ok" : "pill pill-neutral"}>
          {contract.running ? "läuft" : "beendet"}
        </span>
        {badge && <span className={`pill pill-${badge.tone}`}>Kündigung: {badge.text}</span>}
        <span className={`pill pill-${dpaTone(contract.dpa_status)}`}>
          AVV: {DPA_LABELS[contract.dpa_status]}
        </span>
      </p>
      <div className="budget-columns">
        <div className="budget-main budget-side">
          <section className="panel budget-section" aria-labelledby="vertrag-daten">
            <h2 id="vertrag-daten">Vertragsdaten</h2>
            <dl className="budget-facts">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {contract.note && <p className="budget-muted">{contract.note}</p>}
          </section>
          <section className="panel budget-section" aria-labelledby="vertrag-budget">
            <h2 id="vertrag-budget">Zuordnung zum Budget</h2>
            <ul className="budget-list">
              {contract.items.map((item) => (
                <li key={item.id}>
                  <span>
                    {item.name}
                    <span className="budget-muted budget-line">
                      {item.account_number} {item.account_name}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="small budget-muted">
              Zahlungen im {yearName}: {formatEuro(contract.current_year_cents)}. Ins Budget gehen
              sie über die Rechnungen.
            </p>
          </section>
        </div>
        <div className="budget-side">
          <section className="panel budget-section" aria-labelledby="vertrag-fristen">
            <h2 id="vertrag-fristen">Fristen</h2>
            <dl className="budget-facts budget-facts-stack">
              <div>
                <dt>Nächster Kündigungstermin</dt>
                <dd>{day(contract.notice_deadline, "kein Termin")}</dd>
              </div>
              <div>
                <dt>Wenn nicht gekündigt</dt>
                <dd>{followUp(contract)}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </>
  );
}
