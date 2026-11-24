import { ApiError, deleteJson, getJson, postJson } from "../../api";
import { BUDGET_IMPORT_PATH } from "../../navigation";
import type { AccountKind } from "./api";

export type ImportStatus = "entwurf" | "offen" | "abgeschlossen" | "abgebrochen";
export type RowStatus = "offen" | "uebernommen" | "uebersprungen";
/** entschieden: für die Firma schon gewählt; gefunden: gleicher Name; aehnlich; neu. */
export type PartnerMatch = "entschieden" | "gefunden" | "aehnlich" | "neu";

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  entwurf: "Entwurf",
  offen: "in Arbeit",
  abgeschlossen: "abgeschlossen",
  abgebrochen: "abgebrochen",
};

export const ROW_STATUS_LABELS: Record<RowStatus, string> = {
  offen: "offen",
  uebernommen: "übernommen",
  uebersprungen: "übersprungen",
};

export const ROW_STATUS_PILLS: Record<RowStatus, string> = {
  offen: "pill pill-neutral",
  uebernommen: "pill pill-ok",
  uebersprungen: "pill pill-todo",
};

export interface ImportAccount {
  number: string;
  name: string;
  budget_cents: number | null;
  /** Konto in der Werkbank; null: wird beim Start angelegt. */
  account_id: number | null;
  created: boolean;
  rows: number;
}

export interface ImportRow {
  id: number;
  row_number: number;
  invoice_date: string | null;
  number: string;
  internal_number: string;
  firm: string;
  description: string;
  gross_cents: number;
  account_number: string | null;
  yearly: boolean;
  hints: string[];
  status: RowStatus;
  invoice_id: number | null;
  planned_item_id: number | null;
  partner_match: PartnerMatch;
  partner_id: number | null;
  partner_name: string | null;
  /** Budgetposten, den das Übernehmen für diese Zeile angelegt hat. */
  item_id: number | null;
  item_name: string | null;
}

export interface ImportSummary {
  id: number;
  file_name: string;
  year: number;
  year_name: string;
  status: ImportStatus;
  rows: number;
  open: number;
  taken: number;
  skipped: number;
  created_at: string;
  created_by: string | null;
  finished_at: string | null;
}

export interface ImportDetail extends ImportSummary {
  tax_rate_bp: number;
  skipped_rows: number;
  hints: number;
  firms: number;
  new_firms: number;
  year_label: string;
  accounts: ImportAccount[];
  rows_detail: ImportRow[];
}

/** Übernehmen einer Zeile: eigener Budgetposten mit Partner, ohne Rechnung. */
export interface TakeUpdate {
  /** Wird der Name des Budgetpostens. */
  description: string;
  /** Konto des neuen Budgetpostens (je Zeile ein eigener Posten). */
  account_id: number;
  /** Erwartete Kosten brutto. */
  gross_cents: number;
  yearly: boolean;
  partner_id?: number;
  new_partner?: string;
}

/** Zeile mit „Jährlich“ in die Planung: ihr Posten läuft im folgenden Geschäftsjahr weiter. */
export interface PlanEntry {
  row_id: number;
  /** Erwartete Kosten je Geschäftsjahr. */
  amount_cents: number;
  /** true: bis auf Weiteres; false: nur noch im folgenden Geschäftsjahr. */
  ongoing: boolean;
}

const BASE = "/api/budget/imports";

export function importPath(id: number): string {
  return `${BUDGET_IMPORT_PATH}/${id}`;
}

export function fetchImports(): Promise<ImportSummary[]> {
  return getJson(BASE);
}

export function fetchImport(id: number): Promise<ImportDetail> {
  return getJson(`${BASE}/${id}`);
}

/** Höchstgröße einer Excel-Datei in Megabyte (wie auf dem Server). */
export const FILE_MAX_MB = 10;

/** Lädt eine Excel-Datei hoch; der Server legt einen Entwurf an. */
export async function uploadImport(file: File): Promise<ImportDetail> {
  const response = await fetch(BASE, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "X-Dateiname": encodeURIComponent(file.name),
    },
    body: file,
  });
  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: unknown) => {
        const value = (body as { detail?: unknown } | null)?.detail;
        return typeof value === "string" ? value : null;
      })
      .catch(() => null);
    throw new ApiError(response.status, false, detail);
  }
  return (await response.json()) as ImportDetail;
}

export function startImport(
  id: number,
  year: number,
  taxRateBp: number,
  kinds: Record<string, AccountKind>,
): Promise<ImportDetail> {
  return postJson(`${BASE}/${id}/start`, { year, tax_rate_bp: taxRateBp, kinds });
}

export function takeRow(id: number, rowId: number, update: TakeUpdate): Promise<ImportDetail> {
  return postJson(`${BASE}/${id}/rows/${rowId}/take`, update);
}

export function skipRow(id: number, rowId: number): Promise<ImportDetail> {
  return postJson(`${BASE}/${id}/rows/${rowId}/skip`);
}

export function reopenRow(id: number, rowId: number): Promise<ImportDetail> {
  return postJson(`${BASE}/${id}/rows/${rowId}/reopen`);
}

export function planRows(
  id: number,
  entries: PlanEntry[],
): Promise<{ extended: number; detail: ImportDetail }> {
  return postJson(`${BASE}/${id}/plan`, { entries });
}

/** Offene oder übersprungene Zeile löschen; übernommene bleiben. */
export function deleteRow(id: number, rowId: number): Promise<ImportDetail> {
  return deleteJson(`${BASE}/${id}/rows/${rowId}`);
}

/** Import abbrechen: offene und übersprungene Zeilen werden gelöscht, übernommene bleiben. */
export function cancelImport(id: number): Promise<ImportDetail> {
  return postJson(`${BASE}/${id}/cancel`);
}

export function deleteImport(id: number): Promise<{ deleted: boolean }> {
  return deleteJson(`${BASE}/${id}`);
}

/** Netto aus Brutto, kaufmännisch gerundet (wie auf dem Server). */
export function netFromGross(grossCents: number, taxRateBp: number): number {
  const divisor = 10_000 + taxRateBp;
  return Math.floor((grossCents * 10_000 * 2 + divisor) / (2 * divisor));
}

export type RowFilter = "offen" | "hinweis" | "alle";

export function filterRows(rows: ImportRow[], filter: RowFilter): ImportRow[] {
  if (filter === "offen") {
    return rows.filter((row) => row.status === "offen");
  }
  if (filter === "hinweis") {
    return rows.filter((row) => row.hints.length > 0 && row.status === "offen");
  }
  return rows;
}

/** Nächste offene Zeile nach der gegebenen (ringsum); null, wenn keine mehr offen ist. */
export function nextOpenRow(rows: ImportRow[], afterId: number | null): ImportRow | null {
  const start = rows.findIndex((row) => row.id === afterId);
  for (let step = 1; step <= rows.length; step += 1) {
    const row = rows[(start + step + rows.length) % rows.length];
    if (row && row.status === "offen") {
      return row;
    }
  }
  return null;
}

/** Zeilen mit „Jährlich“, die übernommen und noch nicht in die Planung übernommen sind. */
export function planCandidates(rows: ImportRow[]): ImportRow[] {
  return rows.filter(
    (row) => row.yearly && row.status === "uebernommen" && row.planned_item_id === null,
  );
}

/** Anteil in Prozent, auf eine Stelle gerundet. */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}
