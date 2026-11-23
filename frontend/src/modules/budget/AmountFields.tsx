import { useId, type ReactNode } from "react";
import { InfoTip } from "../../components/InfoTip";
import { euroInput, formatEuro, formatRate, grossCents, parseEuro, parseRate } from "./api";

/** Eingabe eines Betrags: netto oder brutto, dazu ein frei wählbarer Steuersatz. */
export type AmountMode = "netto" | "brutto";

export interface AmountValue {
  mode: AmountMode;
  /** Betrag wie eingetippt (netto oder brutto, je nach mode) */
  amount: string;
  /** Steuersatz in Prozent wie eingetippt, z. B. „19“ oder „8,1“ */
  rate: string;
}

export interface AmountCents {
  net_cents: number;
  gross_cents: number;
  tax_rate_bp: number;
}

/** Netto aus Brutto, kaufmännisch gerundet wie auf dem Server. */
export function netFromGross(gross: number, taxRateBp: number): number {
  const divisor = 10_000 + taxRateBp;
  return Math.floor((gross * 10_000 * 2 + divisor) / (2 * divisor));
}

/** Startwert für die Maske: gespeichertes Netto mit Steuersatz, sonst leer mit 19 %. */
export function amountValue(netCents: number | null, taxRateBp = 1900): AmountValue {
  return {
    mode: "netto",
    amount: netCents === null ? "" : euroInput(netCents),
    rate: (taxRateBp / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 }),
  };
}

/** Liest die Eingabe: Netto, Brutto und Steuersatz in Cent bzw. Hundertstel Prozent. */
export function readAmount(value: AmountValue): AmountCents | { problem: string } {
  const rate = parseRate(value.rate);
  if (rate === null) {
    return { problem: "Der Steuersatz ist nicht lesbar. Bitte so eintragen: 19 oder 8,1" };
  }
  const cents = parseEuro(value.amount);
  if (cents === null) {
    return { problem: "Der Betrag ist nicht lesbar. Bitte so eintragen: 1000,00" };
  }
  return value.mode === "netto"
    ? { net_cents: cents, gross_cents: grossCents(cents, rate), tax_rate_bp: rate }
    : { net_cents: netFromGross(cents, rate), gross_cents: cents, tax_rate_bp: rate };
}

/** Der andere Wert in Worten, z. B. „Brutto: 2.380,00 € (19 % auf 2.000,00 € netto)“. */
export function amountSummary(value: AmountValue): string | null {
  if (value.amount.trim() === "") {
    return null;
  }
  const read = readAmount(value);
  if ("problem" in read) {
    return read.problem;
  }
  const rate = formatRate(read.tax_rate_bp);
  return value.mode === "netto"
    ? `Brutto: ${formatEuro(read.gross_cents)} (${rate} auf ${formatEuro(read.net_cents)} netto)`
    : `Netto: ${formatEuro(read.net_cents)} (${formatEuro(read.gross_cents)} brutto mit ${rate})`;
}

/**
 * Betrag mit Netto/Brutto-Umschalter und freiem Steuersatz; gleich in Budgetposten, Vertrag und
 * Rechnungsposition. Der andere Wert steht sofort darunter.
 */
export function AmountFields({
  legend,
  value,
  onChange,
  required = true,
  hint,
  extra,
  summaryText,
}: {
  legend: string;
  value: AmountValue;
  onChange: (next: AmountValue) => void;
  required?: boolean;
  hint?: string;
  /** Weiteres Feld neben Betrag und Steuersatz, z. B. ein abweichendes Brutto */
  extra?: ReactNode;
  /** Eigener Text unter den Feldern statt des gerechneten anderen Werts */
  summaryText?: string | null;
}) {
  const id = useId();
  const summary = summaryText ?? amountSummary(value);
  const switchMode = (mode: AmountMode) => {
    if (mode === value.mode) {
      return;
    }
    // Den eingetragenen Betrag umrechnen, damit der Wechsel nichts verändert
    const read = readAmount(value);
    const amount =
      "problem" in read
        ? value.amount
        : euroInput(mode === "netto" ? read.net_cents : read.gross_cents);
    onChange({ ...value, mode, amount });
  };
  return (
    <fieldset className="form-wide budget-amount">
      <legend>
        {legend}
        {required && <span aria-hidden="true"> *</span>}
      </legend>
      <div className="budget-amount-mode" role="group" aria-label="Betrag eingeben als">
        <span className="small">
          Ich trage ein: <InfoTip term="budget.betrag" />
        </span>
        {(["netto", "brutto"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className="chip chip-filter"
            aria-pressed={value.mode === mode}
            onClick={() => switchMode(mode)}
          >
            {mode === "netto" ? "Netto" : "Brutto"}
          </button>
        ))}
      </div>
      <div className="budget-amount-fields">
        <label>
          <span>
            {value.mode === "netto" ? "Betrag netto (Euro)" : "Betrag brutto (Euro)"}
            {required && <span aria-hidden="true"> *</span>}
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={value.amount}
            required={required}
            aria-required={required}
            aria-describedby={`${id}-ergebnis`}
            onChange={(event) => onChange({ ...value, amount: event.target.value })}
          />
        </label>
        <label>
          Steuersatz (%)
          <input
            type="text"
            inputMode="decimal"
            value={value.rate}
            aria-describedby={`${id}-ergebnis`}
            onChange={(event) => onChange({ ...value, rate: event.target.value })}
          />
        </label>
        {extra}
      </div>
      <p id={`${id}-ergebnis`} className="small budget-amount-result" aria-live="polite">
        {summary ?? "Den anderen Wert rechnet die Werkbank aus dem Steuersatz."}
      </p>
      {hint && <p className="small budget-muted">{hint}</p>}
    </fieldset>
  );
}
