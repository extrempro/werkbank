import { ApiError, deleteJson, getJson, postJson, putJson } from "../../api";

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

export type YearStatus = "entwurf" | "freigegeben";

export interface OverviewRow {
  account: Account;
  /** Geplanter Betrag brutto in Cent; null: für dieses Jahr ist nichts geplant. */
  plan_cents: number | null;
  previous_cents: number | null;
  /** Was aus Verträgen in diesem Geschäftsjahr noch zu erwarten ist (ohne schon Gebuchtes). */
  committed_cents: number;
  /** Summe der gebuchten Rechnungen. */
  actual_cents: number;
  /** Ist plus noch gebunden. */
  forecast_cents: number;
}

/** Ein Budgetposten: wofür das Geld eines Kontos gedacht ist. */
export interface Item {
  id: number;
  account_id: number;
  account_number: string;
  account_name: string;
  kind: AccountKind;
  name: string;
  /** Üblicher Partner des Postens; beim Erfassen einer Rechnung vorausgewählt. */
  partner_id: number | null;
  partner_name: string | null;
  note: string;
  /** Frei vergebene Schlagworte zum Suchen und Auswerten. */
  tags: string[];
  active: boolean;
}

export interface ItemUpdate {
  account_id: number;
  name: string;
  partner_id: number | null;
  /** Nur beim Anlegen: Plan für dieses Geschäftsjahr gleich mit eintragen. */
  plan_year?: number;
  plan_cents?: number;
  note: string;
  tags: string[];
  active: boolean;
}

export interface ItemRow {
  item: Item;
  plan_cents: number | null;
  previous_cents: number | null;
  committed_cents: number;
  actual_cents: number;
  forecast_cents: number;
  /** Zahl der Verträge auf diesem Posten mit Kosten in diesem Jahr. */
  contracts: number;
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
  year_status: YearStatus;
  /** Je Konto die Summen seiner Budgetposten. */
  rows: OverviewRow[];
  items: ItemRow[];
  plan: Totals;
  previous: Totals;
  committed: Totals;
  actual: Totals;
  forecast: Totals;
  /** Rechnungen dieses Jahres, die noch auf die Prüfung warten. */
  open_invoices: number;
  /** Zahl der Verträge, aus denen in diesem Jahr Kosten zu erwarten sind. */
  committed_contracts: number;
}

export interface PlanEntry {
  item_id: number;
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

export function fetchItems(): Promise<Item[]> {
  return getJson<Item[]>("/api/budget/items");
}

export function createItem(update: ItemUpdate): Promise<Item> {
  return postJson<Item>("/api/budget/items", update);
}

export function updateItem(id: number, update: ItemUpdate): Promise<Item> {
  return putJson<Item>(`/api/budget/items/${id}`, update);
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
  item_id: number;
  /** Rechnungssteller, wenn er vom Vertragspartner abweicht. */
  invoicer_id: number | null;
  dpa_status: DpaStatus;
  number: string;
  starts_on: string;
  ends_on: string | null;
  renewal_months: number | null;
  notice_months: number | null;
  cancelled_to: string | null;
  /** Betrag je Zahlung netto; das Brutto rechnet der Server. */
  net_cents: number;
  /** Steuersatz in Hundertstel Prozent: 1900 = 19 %. */
  tax_rate_bp: number;
  interval: ContractInterval;
  note: string;
}

export interface Contract extends ContractUpdate {
  id: number;
  partner_name: string;
  item_name: string;
  account_number: string;
  account_name: string;
  /** Betrag je Zahlung brutto. */
  amount_cents: number;
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

/** Brutto aus Netto und Steuersatz (Hundertstel Prozent), kaufmännisch gerundet wie auf dem Server. */
export function grossCents(netCents: number, taxRateBp: number): number {
  return Math.floor((netCents * (10_000 + taxRateBp) + 5_000) / 10_000);
}

/** Steuersatz als Text, z. B. „19 %“ oder „8,1 %“. */
export function formatRate(taxRateBp: number): string {
  return `${(taxRateBp / 100).toLocaleString("de-DE", { maximumFractionDigits: 2 })} %`;
}

/** Steuersatz aus einer Eingabe wie „19“ oder „8,1“ in Hundertstel Prozent; null, wenn unlesbar. */
export function parseRate(text: string): number | null {
  const clean = text.replace(/[\s%]/g, "");
  if (!/^\d{1,3}(,\d{1,2})?$/.test(clean)) {
    return null;
  }
  const [whole = "0", fraction = ""] = clean.split(",");
  const rate = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return rate <= 10_000 ? rate : null;
}

// Das zuletzt gewählte Geschäftsjahr gilt für alle Budget-Seiten, bis die Werkbank neu lädt.
let chosenYear: number | null = null;

export function rememberedYear(): number | null {
  return chosenYear;
}

export function rememberYear(year: number): void {
  chosenYear = year;
}

export type InvoiceStatus = "zu_pruefen" | "gebucht";

export interface InvoiceUpdate {
  invoicer_id: number;
  number: string;
  internal_number: string;
  invoice_date: string;
  item_id: number;
  contract_id: number | null;
  net_cents: number;
  tax_rate_bp: number;
  /** null: Brutto aus Netto und Steuersatz rechnen; sonst das Brutto laut Rechnung. */
  gross_cents: number | null;
  description: string;
  is_project: boolean;
  is_yearly: boolean;
}

export interface Invoice extends Omit<InvoiceUpdate, "gross_cents"> {
  id: number;
  gross_cents: number;
  invoicer_name: string;
  item_name: string;
  account_number: string;
  account_name: string;
  contract_title: string | null;
  status: InvoiceStatus;
  created_by_name: string | null;
  booked_by_name: string | null;
  booked_at: string | null;
  /** PDF-Beleg: Dateiname und Größe in Bytes; null: kein Beleg. */
  doc_name: string | null;
  doc_size: number | null;
}

export interface InvoiceList {
  year: number;
  year_name: string;
  years: { year: number; name: string }[];
  entries: Invoice[];
}

export interface PartnerDetail {
  partner: Partner;
  contracts: Contract[];
  invoices: Invoice[];
  invoice_total: number;
}

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  zu_pruefen: "zu prüfen",
  gebucht: "gebucht",
};

export function fetchInvoices(year: number | null): Promise<InvoiceList> {
  return getJson<InvoiceList>(
    year === null ? "/api/budget/invoices" : `/api/budget/invoices?year=${year}`,
  );
}

export function createInvoice(update: InvoiceUpdate): Promise<Invoice> {
  return postJson<Invoice>("/api/budget/invoices", update);
}

export function updateInvoice(id: number, update: InvoiceUpdate): Promise<Invoice> {
  return putJson<Invoice>(`/api/budget/invoices/${id}`, update);
}

export function bookInvoice(id: number): Promise<Invoice> {
  return postJson<Invoice>(`/api/budget/invoices/${id}/book`);
}

export function deleteInvoice(id: number): Promise<{ deleted: boolean }> {
  return deleteJson<{ deleted: boolean }>(`/api/budget/invoices/${id}`);
}

export function fetchPartnerDetail(id: number): Promise<PartnerDetail> {
  return getJson<PartnerDetail>(`/api/budget/partners/${id}`);
}

export function mergePartner(
  id: number,
  intoId: number,
): Promise<{ partner: Partner; moved_contracts: number; moved_invoices: number }> {
  return postJson(`/api/budget/partners/${id}/merge`, { into_id: intoId });
}

type Deleted = Promise<{ deleted: boolean }>;

export function deleteContract(id: number): Deleted {
  return deleteJson(`/api/budget/contracts/${id}`);
}

export function deleteItem(id: number): Deleted {
  return deleteJson(`/api/budget/items/${id}`);
}

export function deletePartner(id: number): Deleted {
  return deleteJson(`/api/budget/partners/${id}`);
}

export interface PlanYear {
  year: number;
  name: string;
  status: YearStatus;
}

export interface PlanningRow {
  item: Item;
  /** Plan je Geschäftsjahr; fehlt ein Jahr, ist nichts geplant. */
  plans: Record<string, number>;
  /** Erwartete Vertragskosten je Geschäftsjahr als Vorschlag. */
  proposals: Record<string, number>;
}

export interface Planning {
  year_label: string;
  years: PlanYear[];
  rows: PlanningRow[];
}

export function fetchPlanning(): Promise<Planning> {
  return getJson<Planning>("/api/budget/planning");
}

export function setYearStatus(year: number, status: YearStatus): Promise<PlanYear> {
  return putJson<PlanYear>(`/api/budget/years/${year}/status`, { status });
}

/** Höchstgröße eines Belegs in Megabyte (wie auf dem Server). */
export const DOCUMENT_MAX_MB = 15;

export function documentUrl(invoiceId: number): string {
  return `/api/budget/invoices/${invoiceId}/document`;
}

/** Lädt einen PDF-Beleg hoch. Der Inhalt der Anfrage ist die Datei selbst. */
export async function uploadDocument(invoiceId: number, file: File): Promise<Invoice> {
  const response = await fetch(documentUrl(invoiceId), {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/pdf",
      // Der Dateiname kann Umlaute enthalten; Kopfzeilen vertragen nur ASCII.
      "X-Dateiname": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!response.ok) {
    // Der Server nennt den Grund als JSON; fehlt er, bleibt es beim allgemeinen Fehlertext.
    const detail = await response
      .json()
      .then((body: unknown) => {
        const value = (body as { detail?: unknown } | null)?.detail;
        return typeof value === "string" ? value : null;
      })
      .catch(() => null);
    throw new ApiError(response.status, false, detail);
  }
  return (await response.json()) as Invoice;
}

export function deleteDocument(invoiceId: number): Promise<Invoice> {
  return deleteJson<Invoice>(documentUrl(invoiceId));
}

/** Dateigröße in Worten, z. B. „340 KB“ oder „1,2 MB“. */
export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toLocaleString("de-DE", { maximumFractionDigits: 1 })} MB`;
}

// --- Tags und Statistik ---

export const TAG_MAX_LENGTH = 30;
export const TAGS_MAX = 10;

export interface TagCount {
  tag: string;
  /** Anzahl der Budgetposten mit diesem Tag. */
  items: number;
}

/** any: einer der Tags reicht; all: alle Tags müssen am Posten stehen. */
export type TagMode = "any" | "all";

export interface StatisticYear {
  year: number;
  name: string;
  plan_cents: number;
  actual_cents: number;
}

export interface Statistic {
  year_label: string;
  current_year: number;
  tags: string[];
  mode: TagMode;
  years: StatisticYear[];
  /** Passende Budgetposten mit ihren Summen über den Zeitraum. */
  items: { item: Item; plan_cents: number; actual_cents: number }[];
}

export interface SavedStatistic {
  id: number;
  name: string;
  tags: string[];
  mode: TagMode;
}

export function fetchTags(): Promise<TagCount[]> {
  return getJson<TagCount[]>("/api/budget/tags");
}

/** Plan und Ist der Posten mit diesen Tags über fünf Geschäftsjahre, ab `start` (sonst Rückblick). */
export function queryStatistic(
  tags: string[],
  mode: TagMode,
  start: number | null,
): Promise<Statistic> {
  return postJson<Statistic>("/api/budget/statistics/query", {
    tags,
    mode,
    ...(start === null ? {} : { start }),
  });
}

export function fetchStatistics(): Promise<SavedStatistic[]> {
  return getJson<SavedStatistic[]>("/api/budget/statistics");
}

export function saveStatistic(
  name: string,
  tags: string[],
  mode: TagMode,
): Promise<SavedStatistic> {
  return postJson<SavedStatistic>("/api/budget/statistics", { name, tags, mode });
}

export function deleteStatistic(id: number): Deleted {
  return deleteJson<{ deleted: boolean }>(`/api/budget/statistics/${id}`);
}

/**
 * Liest die Eingabe „Cloud, Lizenzen“ als Liste von Tags: ohne Rand, ohne Doppelte (Groß- und
 * Kleinschreibung zählt nicht). Fehlertext statt Liste, wenn ein Tag zu lang ist oder es zu viele sind.
 */
export function parseTags(text: string): string[] | string {
  const tags: string[] = [];
  for (const part of text.split(",")) {
    const tag = part.trim().replace(/\s+/g, " ");
    if (tag === "") {
      continue;
    }
    if (tag.length > TAG_MAX_LENGTH) {
      return `Der Tag „${tag}“ ist zu lang. Erlaubt sind höchstens ${TAG_MAX_LENGTH} Zeichen.`;
    }
    if (!tags.some((entry) => entry.toLowerCase() === tag.toLowerCase())) {
      tags.push(tag);
    }
  }
  if (tags.length > TAGS_MAX) {
    return `Es sind höchstens ${TAGS_MAX} Tags je Budgetposten möglich.`;
  }
  return tags;
}

/** Ob ein Budgetposten zum Suchtext passt: Name, Notiz, Konto, Partner oder Tag. */
export function itemMatches(item: Item, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") {
    return true;
  }
  return [
    item.name,
    item.note,
    item.account_number,
    item.account_name,
    item.partner_name ?? "",
    ...item.tags,
  ].some((text) => text.toLowerCase().includes(needle));
}

export function hasTag(item: Item, tag: string): boolean {
  return item.tags.some((entry) => entry.toLowerCase() === tag.toLowerCase());
}

/** Runder Höchstwert für die Achse eines Diagramms: 1, 2 oder 5 mal eine Zehnerpotenz. */
export function niceMax(value: number): number {
  if (value <= 0) {
    return 1;
  }
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((factor) => factor * power >= value) ?? 10;
  return step * power;
}
