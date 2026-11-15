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
  const clean = text.replace(/[\s  €]/g, "");
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
