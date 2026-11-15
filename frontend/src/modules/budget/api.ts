import { getJson, postJson, putJson } from "../../api";

export type AccountKind = "laufend" | "investition";

export interface BudgetSettings {
  /** Monat, mit dessen erstem Tag das Geschäftsjahr beginnt (1 bis 12). */
  start_month: number;
  /** So heißt das Geschäftsjahr in der Oberfläche. */
  year_label: string;
  cost_center: string;
  current_year: number;
  current_year_name: string;
}

export interface BudgetSettingsUpdate {
  start_month: number;
  year_label: string;
  cost_center: string;
}

export interface Account {
  id: number;
  number: string;
  name: string;
  kind: AccountKind;
  note: string;
  active: boolean;
}

export interface AccountUpdate {
  number: string;
  name: string;
  kind: AccountKind;
  note: string;
  active: boolean;
}

export interface OverviewRow {
  account: Account;
  /** Geplanter Betrag brutto in Cent; null: für dieses Jahr ist nichts geplant. */
  plan_cents: number | null;
  previous_cents: number | null;
  /** Erwartete Kosten aus Verträgen in diesem Geschäftsjahr. */
  committed_cents: number;
}

export interface Totals {
  running_cents: number;
  investment_cents: number;
  total_cents: number;
}

export interface Overview {
  settings: BudgetSettings;
  year: number;
  year_name: string;
  first_day: string;
  last_day: string;
  years: { year: number; name: string }[];
  rows: OverviewRow[];
  plan: Totals;
  previous: Totals;
  committed: Totals;
  /** Zahl der Verträge, aus denen in diesem Jahr Kosten zu erwarten sind. */
  committed_contracts: number;
}

export interface PlanEntry {
  account_id: number;
  amount_cents: number | null;
}

export const BUDGET_EDITOR_ROLES = ["Budget.Editor", "Budget.Manager"];
export const BUDGET_MANAGER_ROLE = "Budget.Manager";

export const KIND_LABELS: Record<AccountKind, string> = {
  laufend: "Laufende Kosten",
  investition: "Investition",
};

export const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

export function fetchBudgetSettings(): Promise<BudgetSettings> {
  return getJson<BudgetSettings>("/api/budget/settings");
}

export function saveBudgetSettings(update: BudgetSettingsUpdate): Promise<BudgetSettings> {
  return putJson<BudgetSettings>("/api/budget/settings", update);
}

export function fetchAccounts(): Promise<Account[]> {
  return getJson<Account[]>("/api/budget/accounts");
}

export function createAccount(update: AccountUpdate): Promise<Account> {
  return postJson<Account>("/api/budget/accounts", update);
}

export function updateAccount(id: number, update: AccountUpdate): Promise<Account> {
  return putJson<Account>(`/api/budget/accounts/${id}`, update);
}

export function fetchBudgetOverview(year: number | null): Promise<Overview> {
  return getJson<Overview>(
    year === null ? "/api/budget/overview" : `/api/budget/overview?year=${year}`,
  );
}

export function savePlan(year: number, entries: PlanEntry[]): Promise<Overview> {
  return putJson<Overview>(`/api/budget/plans/${year}`, { entries });
}

/** Obergrenze je Betrag in Cent (wie auf dem Server). */
export const AMOUNT_MAX = 1_000_000_000_000;

const euroFormat = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

/** Betrag in Cent als Text, z. B. „11.900,00 €“. */
export function formatEuro(cents: number): string {
  return euroFormat.format(cents / 100);
}

/** Betrag in Cent für ein Eingabefeld, z. B. „11900,00“. */
export function euroInput(cents: number | null): string {
  if (cents === null) {
    return "";
  }
  const whole = Math.trunc(cents / 100);
  return `${whole},${String(cents % 100).padStart(2, "0")}`;
}

/**
 * Liest einen Betrag in deutscher Schreibweise („11.900,00“, „11900“, „11900,5“, „1 190 €“).
 * Ergebnis in Cent; null, wenn die Eingabe kein gültiger Betrag ist.
 */
export function parseEuro(text: string): number | null {
  const clean = text.replace(/[\s€]/g, "");
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(clean)) {
    return null;
  }
  const [whole = "0", fraction = ""] = clean.replace(/\./g, "").split(",");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= AMOUNT_MAX ? cents : null;
}

/** Tag im Format JJJJ-MM-TT als „01.08.2026“. */
export function formatBudgetDay(day: string): string {
  const [year = "", month = "", date = ""] = day.split("-");
  return `${date}.${month}.${year}`;
}

export interface Partner {
  id: number;
  name: string;
  is_contract_partner: boolean;
  is_invoicer: boolean;
  customer_number: string;
  note: string;
  active: boolean;
}

export type PartnerUpdate = Omit<Partner, "id">;

export type ContractInterval =
  "monatlich" | "vierteljaehrlich" | "halbjaehrlich" | "jaehrlich" | "einmalig";

export type DpaStatus = "vorhanden" | "fehlt" | "nicht_erforderlich";

export interface ContractUpdate {
  title: string;
  partner_id: number;
  account_id: number;
  /** Rechnungssteller, wenn er vom Vertragspartner abweicht. */
  invoicer_id: number | null;
  dpa_status: DpaStatus;
  number: string;
  starts_on: string;
  ends_on: string | null;
  renewal_months: number | null;
  notice_months: number | null;
  cancelled_to: string | null;
  amount_cents: number;
  interval: ContractInterval;
  note: string;
}

export interface Contract extends ContractUpdate {
  id: number;
  partner_name: string;
  account_number: string;
  account_name: string;
  invoicer_name: string | null;
  /** Kosten eines vollen Jahres; null bei einmaliger Zahlung. */
  yearly_cents: number | null;
  running: boolean;
  term_end: string | null;
  notice_deadline: string | null;
  days_to_deadline: number | null;
  deadline_soon: boolean;
  /** Erwartete Kosten im laufenden Geschäftsjahr. */
  current_year_cents: number;
}

export interface ContractList {
  current_year_name: string;
  notice_warn_days: number;
  entries: Contract[];
}

export const INTERVAL_LABELS: Record<ContractInterval, string> = {
  monatlich: "monatlich",
  vierteljaehrlich: "vierteljährlich",
  halbjaehrlich: "halbjährlich",
  jaehrlich: "jährlich",
  einmalig: "einmalig",
};

export function fetchPartners(): Promise<Partner[]> {
  return getJson<Partner[]>("/api/budget/partners");
}

export function createPartner(update: PartnerUpdate): Promise<Partner> {
  return postJson<Partner>("/api/budget/partners", update);
}

export function updatePartner(id: number, update: PartnerUpdate): Promise<Partner> {
  return putJson<Partner>(`/api/budget/partners/${id}`, update);
}

export function fetchContracts(): Promise<ContractList> {
  return getJson<ContractList>("/api/budget/contracts");
}

export function createContract(update: ContractUpdate): Promise<Contract> {
  return postJson<Contract>("/api/budget/contracts", update);
}

export function updateContract(id: number, update: ContractUpdate): Promise<Contract> {
  return putJson<Contract>(`/api/budget/contracts/${id}`, update);
}

/** Rollen eines Partners in Worten. */
export function partnerRoles(partner: Partner): string {
  if (partner.is_contract_partner && partner.is_invoicer) {
    return "Vertragspartner und Rechnungssteller";
  }
  return partner.is_contract_partner ? "Vertragspartner" : "Rechnungssteller";
}

/** Laufzeit eines Vertrags in Worten. */
export function termText(contract: Contract): string {
  const start = formatBudgetDay(contract.starts_on);
  if (contract.cancelled_to) {
    return `${start} bis ${formatBudgetDay(contract.cancelled_to)} (gekündigt)`;
  }
  if (!contract.ends_on) {
    return contract.interval === "einmalig" ? start : `seit ${start}, unbefristet`;
  }
  const end = formatBudgetDay(contract.term_end ?? contract.ends_on);
  return contract.renewal_months
    ? `${start} bis ${end}, verlängert sich um ${contract.renewal_months} Monate`
    : `${start} bis ${end}`;
}

export const DPA_LABELS: Record<DpaStatus, string> = {
  vorhanden: "vorhanden",
  fehlt: "fehlt",
  nicht_erforderlich: "nicht erforderlich",
};

/** Farbe des AVV-Stands: fehlt ist rot, vorhanden grün. */
export function dpaTone(status: DpaStatus): "ok" | "bad" | "neutral" {
  return status === "fehlt" ? "bad" : status === "vorhanden" ? "ok" : "neutral";
}

/** So viele Tage vorher zeigt die Werkbank einen Kündigungstermin als anstehend. */
export const DEADLINE_WINDOW_DAYS = 120;

/** Hinweis zum Kündigungstermin: Text und Dringlichkeit; null ohne Termin. */
export function deadlineBadge(
  contract: Contract,
): { text: string; tone: "ok" | "todo" | "bad" } | null {
  const days = contract.days_to_deadline;
  if (days === null || !contract.running) {
    return null;
  }
  if (days < 0) {
    return { text: "Frist verstrichen", tone: "bad" };
  }
  if (days <= DEADLINE_WINDOW_DAYS) {
    const text = days === 0 ? "heute" : days === 1 ? "noch 1 Tag" : `noch ${days} Tage`;
    return { text, tone: days <= 30 ? "bad" : "todo" };
  }
  return { text: `in ${Math.round(days / 30)} Monaten`, tone: "ok" };
}

/** Anteil in Prozent, auf ganze Zahlen gerundet und auf 0 bis 100 begrenzt. */
export function share(part: number, whole: number): number {
  if (whole <= 0) {
    return part > 0 ? 100 : 0;
  }
  return Math.max(0, Math.min(100, Math.round((part / whole) * 100)));
}
