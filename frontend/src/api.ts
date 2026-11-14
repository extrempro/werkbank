export interface Me {
  display_name: string;
  email: string | null;
  roles: string[];
  authenticated_at: string;
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

/** Adresse für die erneute Anmeldung, danach zurück zur angegebenen Seite. */
export function stepUpLoginUrl(returnTo: string): string {
  const params = new URLSearchParams({ step_up: "true", return_to: returnTo });
  return `/auth/login?${params.toString()}`;
}

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new ApiError(response.status, response.headers.get("X-Werkbank-Step-Up") === "required");
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

async function sendJson<T>(method: "POST" | "PUT", url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) {
    throw new ApiError(response.status, false, await errorDetail(response));
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

export interface AuditEntry {
  id: number;
  occurred_at: string;
  user: string | null;
  module: string;
  action: string;
  object_type: string | null;
  object_id: string | null;
  result: string;
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
