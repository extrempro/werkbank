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

/** Status eines Budgetpostens in einem Geschäftsjahr; rechnung: Rechnung liegt vor. */
export type ItemStatus = "offen" | "rechnung" | "abgeschlossen";

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  offen: "offen",
  rechnung: "Rechnung liegt vor",
  abgeschlossen: "abgeschlossen",
};

export interface OverviewRow {
  account: Account;
  /** Erwartete Kosten brutto in Cent; null: in diesem Jahr läuft kein Posten des Kontos. */
  expected_cents: number | null;
  previous_cents: number | null;
  /** Summe der gebuchten Rechnungspositionen. */
  actual_cents: number;
  /** Abgeschlossen das Ist, sonst das Höhere aus erwarteten Kosten und Ist. */
  forecast_cents: number;
}

/** Ein Budgetposten: ein Vorhaben mit erwarteten Kosten je Geschäftsjahr und Laufzeit. */
export interface Item {
  id: number;
  /** Feste Nummer, z. B. BP-2026-012. */
  number: string;
  account_id: number;
  account_number: string;
  account_name: string;
  kind: AccountKind;
  name: string;
  /** Erwartete Kosten je Geschäftsjahr, brutto. */
  amount_cents: number;
  start_year: number;
  start_year_name: string;
  /** null: bis auf Weiteres; gleich start_year: einmalig. */
  end_year: number | null;
  end_year_name: string | null;
  note: string;
  /** Frei vergebene Schlagworte zum Suchen und Auswerten. */
  tags: string[];
  active: boolean;
  /** Nur wenn mit Geschäftsjahr abgefragt: Status in diesem Jahr. */
  status?: ItemStatus | null;
  /** Partner (Firma) des Postens; ältere Posten haben noch keinen. */
  partner_id?: number | null;
  partner_name?: string | null;
  /** Zugeordneter Vertrag; ein Posten hat höchstens einen. */
  contract_id?: number | null;
  contract_title?: string | null;
  /** IT-Projekt, zu dem der Posten gehört; höchstens eins. */
  project_id?: number | null;
  project_name?: string | null;
}

export interface ItemUpdate {
  account_id: number;
  /** Partner (Firma) des Postens, Pflicht. */
  partner_id: number;
  name: string;
  amount_cents: number;
  start_year: number;
  end_year: number | null;
  note: string;
  tags: string[];
  active: boolean;
  /** Zugeordneter Vertrag; null: keiner. */
  contract_id: number | null;
  /** IT-Projekt; null: keins. */
  project_id: number | null;
}

export interface ItemRow {
  item: Item;
  expected_cents: number | null;
  previous_cents: number | null;
  actual_cents: number;
  forecast_cents: number;
  status: ItemStatus | null;
  /** Von Hand abgehakt („Abschließen“ am Posten) bzw. durch eine Rechnungsposition. */
  closed_by_hand: boolean;
  closed_by_invoice: boolean;
  /** Zahl der laufenden Verträge, die dem Posten zugeordnet sind. */
  contracts: number;
}

export interface Closure {
  item_id: number;
  year: number;
  status: ItemStatus | null;
  closed_by_hand: boolean;
  closed_by_invoice: boolean;
}

/** Budgetposten für ein Geschäftsjahr abhaken. */
export function closeItem(id: number, year: number): Promise<Closure> {
  return postJson<Closure>(`/api/budget/items/${id}/close`, { year });
}

/** Abhaken zurücknehmen (nur, was von Hand abgeschlossen ist). */
export function reopenItem(id: number, year: number): Promise<Closure> {
  return postJson<Closure>(`/api/budget/items/${id}/reopen`, { year });
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
  /** Je Konto die Summen seiner Budgetposten. */
  rows: OverviewRow[];
  items: ItemRow[];
  expected: Totals;
  previous: Totals;
  actual: Totals;
  forecast: Totals;
  /** Budgetposten dieses Jahres nach Status. */
  statuses: { open: number; invoiced: number; closed: number };
  /** Rechnungen dieses Jahres, die noch auf die Prüfung warten. */
  open_invoices: number;
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

export function fetchItems(year: number | null = null): Promise<Item[]> {
  if (year !== null) {
    return getJson<Item[]>(`/api/budget/items?year=${year}`);
  }
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
  /** Zugeordnete Budgetposten; ein Vertrag geht auch ohne. Ein Posten hat höchstens einen Vertrag. */
  item_ids: number[];
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

export interface ContractItem {
  id: number;
  number: string;
  name: string;
  account_number: string;
  account_name: string;
}

export interface Contract extends Omit<ContractUpdate, "item_ids"> {
  id: number;
  partner_name: string;
  /** Zugeordnete Budgetposten. */
  items: ContractItem[];
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
  /** Soll: Zahlungen, die im gewählten Geschäftsjahr fällig werden (bis zur Kündigung). */
  current_year_cents: number;
  /** Ist: gebuchte Rechnungen der zugeordneten Posten, die im Geschäftsjahr abgeschlossen sind. */
  year_actual_cents: number;
  /** So viele der zugeordneten Posten sind im Geschäftsjahr abgeschlossen. */
  closed_items: number;
}

/** Zugeordnete Budgetposten in Kurzform: „6815 · Lizenzen, 6820 · Telefonie“. */
export function contractItemsText(contract: Contract): string {
  if (contract.items.length === 0) {
    return "ohne Budgetposten";
  }
  return contract.items.map((item) => `${item.account_number} · ${item.name}`).join(", ");
}

export interface ContractList {
  /** Gewähltes Geschäftsjahr; current_year_name ist sein Name. */
  year: number;
  current_year_name: string;
  years: { year: number; name: string }[];
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

export interface MonthlyItemsResult {
  created: Item[];
  /** Monate, für die es im Konto schon einen Posten mit diesem Namen gibt. */
  skipped: number;
}

/** Legt für einen monatlichen Vertrag je fälliger Zahlung im Geschäftsjahr einen Posten an. */
export function createMonthlyItems(
  contractId: number,
  year: number,
  accountId: number,
): Promise<MonthlyItemsResult> {
  return postJson<MonthlyItemsResult>(`/api/budget/contracts/${contractId}/monthly-items`, {
    year,
    account_id: accountId,
  });
}

export function fetchContracts(year?: number | null): Promise<ContractList> {
  return getJson<ContractList>(
    year ? `/api/budget/contracts?year=${year}` : "/api/budget/contracts",
  );
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

/** Eine Position einer Rechnung: ein Betrag für genau einen Budgetposten. */
export interface InvoiceLineUpdate {
  item_id: number;
  net_cents: number;
  tax_rate_bp: number;
  /** null: Brutto aus Netto und Steuersatz rechnen; sonst das Brutto laut Rechnung. */
  gross_cents: number | null;
  description: string;
  is_project: boolean;
  is_yearly: boolean;
  /** Schließt den Budgetposten für das Geschäftsjahr der Rechnung ab, sobald sie gebucht ist. */
  closes_item: boolean;
}

export interface InvoiceLine extends Omit<InvoiceLineUpdate, "gross_cents"> {
  id: number;
  gross_cents: number;
  /** Feste Nummer des Budgetpostens. */
  item_number: string;
  item_name: string;
  account_number: string;
  account_name: string;
  /** Vertrag des Budgetpostens, wie er jetzt zugeordnet ist. */
  contract_id: number | null;
  contract_title: string | null;
}

export interface InvoiceUpdate {
  invoicer_id: number;
  number: string;
  internal_number: string;
  invoice_date: string;
  lines: InvoiceLineUpdate[];
  /** Rechnungsbetrag laut Beleg (brutto); angegeben muss er der Summe der Positionen entsprechen. */
  total_gross_cents: number | null;
}

export interface Invoice {
  id: number;
  invoicer_id: number;
  invoicer_name: string;
  number: string;
  internal_number: string;
  invoice_date: string;
  /** Summen der Positionen. */
  net_cents: number;
  gross_cents: number;
  lines: InvoiceLine[];
  status: InvoiceStatus;
  created_by_name: string | null;
  booked_by_name: string | null;
  booked_at: string | null;
  /** PDF-Beleg: Dateiname und Größe in Bytes; null: kein Beleg. */
  doc_name: string | null;
  doc_size: number | null;
}

export const INVOICE_LINES_MAX = 50;

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
  /** Budgetposten, deren Partner die Firma ist. */
  items?: Item[];
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
  expected_cents: number;
  actual_cents: number;
}

export interface PlanCell {
  /** null: der Posten läuft in dem Jahr nicht. */
  expected_cents: number | null;
  actual_cents: number;
  status: ItemStatus | null;
}

export interface PlanningRow {
  item: Item;
  /** Je Geschäftsjahr (Schlüssel: Jahr). */
  years: Record<string, PlanCell>;
}

export interface Planning {
  year_label: string;
  current_year: number;
  years: PlanYear[];
  rows: PlanningRow[];
}

/** Fünf Geschäftsjahre ab `start`; ohne Angabe ab dem laufenden. */
export function fetchPlanning(start: number | null): Promise<Planning> {
  return getJson<Planning>(`/api/budget/planning${start === null ? "" : `?start=${start}`}`);
}

/** Adresse der Excel-Datei mit Mehrjahresübersicht und Rechnungspositionen. */
export function exportUrl(start: number | null): string {
  return `/api/budget/export${start === null ? "" : `?start=${start}`}`;
}

/** Laufzeit in Worten: „2026/27“, „2026/27 bis 2028/29“ oder „ab 2026/27, bis auf Weiteres“. */
export function runtimeText(item: Item): string {
  if (item.end_year === item.start_year) {
    return `einmalig ${item.start_year_name}`;
  }
  if (item.end_year_name === null) {
    return `ab ${item.start_year_name}, bis auf Weiteres`;
  }
  return `${item.start_year_name} bis ${item.end_year_name}`;
}

/** Geschäftsjahr eines Tages (JJJJ-MM-TT) bei Beginn im Monat `startMonth`. */
export function fiscalYearOf(day: string, startMonth: number): number | null {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(day);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  return Number(match[2]) >= startMonth ? year : year - 1;
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
  id: number;
  tag: string;
  /** Anzahl der Budgetposten mit diesem Tag. */
  items: number;
}

/** any: einer der Tags reicht; all: alle Tags müssen am Posten stehen. */
export type TagMode = "any" | "all";

export interface StatisticYear {
  year: number;
  name: string;
  expected_cents: number;
  actual_cents: number;
  /** Ist bis zum selben Tag wie heute (im laufenden Jahr gleich dem Ist). */
  actual_to_date_cents: number;
}

export interface StatisticTag {
  tag: string;
  years: StatisticYear[];
}

export interface Statistic {
  year_label: string;
  current_year: number;
  tags: string[];
  mode: TagMode;
  years: StatisticYear[];
  /** Passende Budgetposten mit ihren Summen über den Zeitraum. */
  items: { item: Item; expected_cents: number; actual_cents: number }[];
  /** Dieselben Jahre je einzelnem Tag. */
  per_tag: StatisticTag[];
}

export interface StatisticSummary {
  year_label: string;
  current_year: number;
  year: number;
  year_name: string;
  years: { year: number; name: string }[];
  compare: number | null;
  compare_name: string | null;
  /** Angefangene Monate: 12 bei vergangenen, 0 bei künftigen Jahren. */
  elapsed_months: number;
  expected_cents: number;
  actual_cents: number;
  compare_to_date_cents: number | null;
  compare_actual_cents: number | null;
  months: { name: string; actual_cents: number; compare_cents: number | null }[];
  accounts: { account: Account; expected_cents: number; actual_cents: number }[];
  partners: { id: number; name: string; actual_cents: number }[];
  contracts: {
    yearly_cents: number;
    soon_days: number;
    soon: number;
    next: {
      id: number;
      title: string;
      partner_name: string;
      yearly_cents: number | null;
      notice_deadline: string;
    }[];
  };
}

export interface StatisticCompare {
  year_label: string;
  current_year: number;
  year: number;
  years: { year: number; name: string }[];
  /** Stichtag für „bis heute“; nur im laufenden Jahr. */
  cutoff: string | null;
  accounts: {
    account: Account;
    values: {
      year: number;
      expected_cents: number;
      actual_cents: number;
      actual_to_date_cents: number;
    }[];
  }[];
}

/** Plan, Ist je Monat, Konten, Rechnungssteller und Verträge eines Geschäftsjahrs. */
export function fetchStatisticSummary(
  year: number | null,
  compare: number | null,
): Promise<StatisticSummary> {
  const params = new URLSearchParams();
  if (year !== null) {
    params.set("year", String(year));
  }
  if (compare !== null) {
    params.set("compare", String(compare));
  }
  const query = params.toString();
  return getJson<StatisticSummary>(`/api/budget/statistics/summary${query ? `?${query}` : ""}`);
}

/** Plan und Ist je Konto im gewählten Jahr und den vier davor. */
export function fetchStatisticCompare(year: number | null): Promise<StatisticCompare> {
  return getJson<StatisticCompare>(
    `/api/budget/statistics/compare${year !== null ? `?year=${year}` : ""}`,
  );
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

/** Tag in die Liste aufnehmen (nur Budgetverwalter). */
export function createTag(name: string): Promise<TagCount> {
  return postJson<TagCount>("/api/budget/tags", { name });
}

/** Tag umbenennen, auch an allen Budgetposten und gespeicherten Statistiken. */
export function renameTag(id: number, name: string): Promise<TagCount> {
  return putJson<TagCount>(`/api/budget/tags/${id}`, { name });
}

/** Tag aus der Liste und von allen Budgetposten und Statistiken entfernen. */
export function deleteTag(id: number): Deleted {
  return deleteJson<{ deleted: boolean }>(`/api/budget/tags/${id}`);
}

/** Erwartete Kosten und Ist der Posten mit diesen Tags über fünf Geschäftsjahre, ab `start` (sonst Rückblick). */
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

/** Ob ein Budgetposten zum Suchtext passt: Name, Notiz, Konto oder Tag. */
export function itemMatches(item: Item, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === "") {
    return true;
  }
  return [
    item.number,
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
