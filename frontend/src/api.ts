import type { Branding } from "./branding";

export interface Me {
  user_id?: string;
  display_name: string;
  email: string | null;
  roles: string[];
  authenticated_at: string;
  session_expires_at?: string;
  /** Adresse des Profilbilds aus Entra, falls vorhanden. */
  avatar_url?: string | null;
  /** Version der laufenden Werkbank. */
  version?: string;
}

/** Angemeldete Person laden. `null` bedeutet: nicht angemeldet. */
export async function fetchMe(): Promise<Me | null> {
  const response = await fetch("/api/me", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Unerwartete Antwort: ${response.status}`);
  }
  return (await response.json()) as Me;
}

export class ApiError extends Error {
  readonly status: number;
  /** Der Server verlangt eine erneute Anmeldung (Verwaltung, siehe spec.md 6.1). */
  readonly stepUpRequired: boolean;

  /** Fehlertext des Servers, falls er einen mitgeschickt hat. */
  readonly detail: string | null;

  constructor(status: number, stepUpRequired = false, detail: string | null = null) {
    super(`Unerwartete Antwort: ${status}`);
    this.status = status;
    this.stepUpRequired = stepUpRequired;
    this.detail = detail;
  }
}

/** Adresse für die Anmeldung, danach zurück zur angegebenen Seite. */
export function loginUrl(returnTo: string): string {
  return returnTo === "/"
    ? "/auth/login"
    : `/auth/login?${new URLSearchParams({ return_to: returnTo }).toString()}`;
}

/**
 * Fehlertext für Formulare. Bei zu alter Anmeldung verweist er auf den Hinweis oben auf der
 * Seite, der die erneute Anmeldung anbietet.
 */
export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status === 401) {
    return "Du bist nicht mehr angemeldet.";
  }
  if (error instanceof ApiError && error.stepUpRequired) {
    return "Nicht gespeichert: Für diese Änderung ist eine frische Anmeldung nötig. Oben auf der Seite kannst du dich erneut anmelden.";
  }
  return (error instanceof ApiError ? error.detail : null) ?? fallback;
}

/** Adresse für die erneute Anmeldung, danach zurück zur angegebenen Seite. */
export function stepUpLoginUrl(returnTo: string): string {
  const params = new URLSearchParams({ step_up: "true", return_to: returnTo });
  return `/auth/login?${params.toString()}`;
}

/**
 * Meldungen zur Anmeldung, auf die die ganze Oberfläche reagiert:
 * „abgemeldet“ (Sitzung abgelaufen) und „anmeldung-zu-alt“ (eine Änderung braucht eine
 * frische Anmeldung). So muss nicht jede Seite selbst darauf achten.
 */
export type AuthProblem = "abgemeldet" | "anmeldung-zu-alt";
export const AUTH_EVENT = "werkbank:anmeldung";

function reportAuthProblem(problem: AuthProblem): void {
  window.dispatchEvent(new CustomEvent<AuthProblem>(AUTH_EVENT, { detail: problem }));
}

function stepUpRequired(response: Response): boolean {
  return response.headers.get("X-Werkbank-Step-Up") === "required";
}

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    if (response.status === 401) {
      reportAuthProblem("abgemeldet");
    }
    throw new ApiError(response.status, stepUpRequired(response));
  }
  return (await response.json()) as T;
}

async function errorDetail(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "detail" in body) {
      const detail = (body as { detail: unknown }).detail;
      return typeof detail === "string" ? detail : null;
    }
  } catch {
    // Antwort ohne JSON: kein Fehlertext
  }
  return null;
}

async function sendJson<T>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    const stepUp = stepUpRequired(response);
    if (response.status === 401) {
      reportAuthProblem("abgemeldet");
    } else if (stepUp) {
      reportAuthProblem("anmeldung-zu-alt");
    }
    throw new ApiError(response.status, stepUp, await errorDetail(response));
  }
  return (await response.json()) as T;
}

/** Verändernde Anfrage mit JSON-Inhalt. */
export function postJson<T>(url: string, body?: unknown): Promise<T> {
  return sendJson("POST", url, body);
}

export function putJson<T>(url: string, body?: unknown): Promise<T> {
  return sendJson("PUT", url, body);
}

export function patchJson<T>(url: string, body?: unknown): Promise<T> {
  return sendJson("PATCH", url, body);
}

export function deleteJson<T>(url: string): Promise<T> {
  return sendJson("DELETE", url);
}

export interface Task {
  module: string;
  title: string;
  subtitle: string | null;
  link: string;
  count: number;
}

/** Aufgaben der angemeldeten Person. Bei einem Fehler oder unerwarteter Antwort: keine. */
export async function fetchTasks(): Promise<Task[]> {
  try {
    const data = await getJson<{ tasks?: unknown }>("/api/tasks");
    return Array.isArray(data.tasks) ? (data.tasks as Task[]) : [];
  } catch {
    return [];
  }
}

export interface AuditEntry {
  id: number;
  occurred_at: string;
  user: string | null;
  module: string;
  action: string;
  object_type: string | null;
  object_id: string | null;
  result: string;
  /** Gekürzte IP-Adresse des Absenders (Netz, nicht das einzelne Gerät). */
  origin: string | null;
  details: Record<string, unknown> | null;
}

export interface AuditFilter {
  module: string;
  action: string;
  since: string;
  until: string;
}

export function auditQuery(filter: AuditFilter, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filter, ...extra })) {
    if (value) {
      params.set(key, value);
    }
  }
  return params.toString();
}

export function fetchAudit(
  filter: AuditFilter,
  offset: number,
): Promise<{ entries: AuditEntry[]; has_more: boolean }> {
  return getJson(`/api/audit?${auditQuery(filter, { offset: String(offset), limit: "50" })}`);
}

export interface RoleHolder {
  avatar_url?: string | null;
  display_name: string;
  email: string | null;
  last_login_at: string | null;
}

export interface RoleInfo {
  value: string;
  label: string;
  description: string;
  holders: RoleHolder[];
}

export function fetchRoles(): Promise<RoleInfo[]> {
  return getJson("/api/admin/roles");
}

const dateTime = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "medium" });

export function formatDateTime(iso: string | null): string {
  return iso ? dateTime.format(new Date(iso)) : "–";
}

export interface SearchHit {
  module: string;
  kind: string;
  title: string;
  subtitle: string | null;
  link: string;
}

/** Suche über alle Module. Der Server liefert nur, was die Person sehen darf. */
export function searchAll(query: string): Promise<{ query: string; hits: SearchHit[] }> {
  return getJson(`/api/search?${new URLSearchParams({ q: query }).toString()}`);
}

export interface SmtpSettings {
  host: string;
  port: number;
  security: "starttls" | "tls" | "none";
  username: string;
  sender_address: string;
  sender_name: string;
  password_set: boolean;
  password_storage_available: boolean;
}

export interface AiSettings {
  enabled: boolean;
  base_url: string;
  model: string;
  texts_per_hour: number;
  texts_per_hour_min: number;
  texts_per_hour_max: number;
  api_key_set: boolean;
  key_storage_available: boolean;
}

export interface AiUpdate {
  enabled: boolean;
  base_url: string;
  model: string;
  texts_per_hour: number;
  /** Weglassen: Schlüssel bleibt. Leerer Text: Schlüssel löschen. */
  api_key?: string;
}

export interface AdminSettings {
  smtp: SmtpSettings;
  /** Fehlt bei älteren Servern. */
  ai?: AiSettings;
  audit_retention_days: number;
  audit_retention_min: number;
  audit_retention_max: number;
  /** Vorlauf für ablaufende Zertifikate und Secrets in Tagen: Hinweis, Warnung, dringend. */
  credential_warn_days?: number[];
  credential_warn_min?: number;
  credential_warn_max?: number;
}

export interface SmtpUpdate {
  host: string;
  port: number;
  security: string;
  username: string;
  sender_address: string;
  sender_name: string;
  /** Weglassen: Passwort bleibt. Leerer Text: Passwort löschen. */
  password?: string;
}

export function fetchAdminSettings(): Promise<AdminSettings> {
  return getJson("/api/admin/settings");
}

export function saveSmtpSettings(update: SmtpUpdate): Promise<AdminSettings> {
  return putJson("/api/admin/settings/smtp", update);
}

export function sendTestMail(): Promise<{ recipient: string }> {
  return postJson("/api/admin/settings/smtp/test");
}

export function saveAuditRetention(days: number): Promise<AdminSettings> {
  return putJson("/api/admin/settings/audit-retention", { days });
}

export function saveCredentialWarnDays(days: number[]): Promise<AdminSettings> {
  return putJson("/api/admin/settings/credential-warn-days", { days });
}

export function saveAiSettings(update: AiUpdate): Promise<AdminSettings> {
  return putJson("/api/admin/settings/ai", update);
}

export function testAiConnection(): Promise<{ model: string }> {
  return postJson("/api/admin/settings/ai/test");
}

// --- Verwaltung: Branding ----------------------------------------------------------------

export type BrandingImageKind = "logo-hell" | "logo-dunkel" | "favicon";

export interface BrandingUpdate {
  app_name: string;
  accent: string | null;
  show_name: boolean;
}

export function saveBranding(update: BrandingUpdate): Promise<Branding> {
  return putJson("/api/admin/branding", update);
}

export function uploadBrandingImage(kind: BrandingImageKind, base64: string): Promise<Branding> {
  return putJson(`/api/admin/branding/assets/${kind}`, { content_base64: base64 });
}

export function removeBrandingImage(kind: BrandingImageKind): Promise<Branding> {
  return deleteJson(`/api/admin/branding/assets/${kind}`);
}
