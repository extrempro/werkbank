import { getJson, postJson, putJson } from "./api";

export const NOTIFICATIONS_PATH = "/benachrichtigungen";
const BASE = "/api/notifications";

export interface NotificationEntry {
  id: number;
  kind: string;
  /** Bereich, z. B. „IT-Budget“ */
  module: string;
  title: string;
  /** Seite in der Werkbank, immer ein Pfad wie „/budget/rechnungen“ */
  link: string;
  created_at: string;
  read: boolean;
}

export interface NotificationList {
  unread: number;
  entries: NotificationEntry[];
}

export interface NotificationKind {
  kind: string;
  module: string;
  label: string;
  /** In der Glocke */
  enabled: boolean;
  /** Zusätzlich per Mail bzw. in Teams (gesammelt, ohne Inhalte) */
  mail: boolean;
  teams: boolean;
}

export interface NotificationChannels {
  /** In der Verwaltung eingerichtet */
  mail: boolean;
  teams: boolean;
  has_email: boolean;
}

export interface NotificationSettings {
  kinds: NotificationKind[];
  channels: NotificationChannels;
}

export type Channel = "enabled" | "mail" | "teams";

/** Benachrichtigungen der angemeldeten Person; bei einem Fehler eine leere Liste. */
export async function fetchNotifications(limit = 10): Promise<NotificationList> {
  try {
    const data = await getJson<NotificationList>(`${BASE}?limit=${limit}`);
    return {
      unread: typeof data.unread === "number" ? data.unread : 0,
      entries: Array.isArray(data.entries) ? data.entries : [],
    };
  } catch {
    return { unread: 0, entries: [] };
  }
}

export function markRead(id: number): Promise<{ unread: number }> {
  return postJson(`${BASE}/${id}/read`);
}

export function markAllRead(): Promise<{ unread: number }> {
  return postJson(`${BASE}/read-all`);
}

export function fetchNotificationSettings(): Promise<NotificationSettings> {
  return getJson(`${BASE}/settings`);
}

export function saveNotificationSettings(kinds: NotificationKind[]): Promise<NotificationSettings> {
  return putJson(`${BASE}/settings`, {
    disabled: kinds.filter((entry) => !entry.enabled).map((entry) => entry.kind),
    mail: kinds.filter((entry) => entry.enabled && entry.mail).map((entry) => entry.kind),
    teams: kinds.filter((entry) => entry.enabled && entry.teams).map((entry) => entry.kind),
  });
}

/** Schaltet einen Weg für eine Art um. Ohne Glocke gibt es auch keine Mail und kein Teams. */
export function toggleChannel(
  kinds: NotificationKind[],
  kind: string,
  channel: Channel,
  on: boolean,
): NotificationKind[] {
  return kinds.map((entry) => {
    if (entry.kind !== kind) {
      return entry;
    }
    const next = { ...entry, [channel]: on };
    return channel === "enabled" && !on ? { ...next, mail: false, teams: false } : next;
  });
}

/** Nur Pfade innerhalb der Werkbank sind als Ziel erlaubt. */
export function safeLink(link: string): string {
  return link.startsWith("/") && !link.startsWith("//") ? link : NOTIFICATIONS_PATH;
}

const relative = new Intl.RelativeTimeFormat("de-DE", { numeric: "auto" });

/** „vor 5 Minuten“, „gestern“ … bis zu einer Woche, danach das Datum. */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.round((then.getTime() - now.getTime()) / 1000);
  if (Number.isNaN(seconds)) {
    return "";
  }
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 1) {
    return "gerade eben";
  }
  if (Math.abs(minutes) < 60) {
    return relative.format(minutes, "minute");
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return relative.format(hours, "hour");
  }
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) {
    return relative.format(days, "day");
  }
  return then.toLocaleDateString("de-DE", { dateStyle: "medium" });
}

/** Arten nach Bereich gruppiert, in der Reihenfolge des Servers. */
export function groupByModule(kinds: NotificationKind[]): [string, NotificationKind[]][] {
  const groups = new Map<string, NotificationKind[]>();
  for (const kind of kinds) {
    groups.set(kind.module, [...(groups.get(kind.module) ?? []), kind]);
  }
  return [...groups.entries()];
}
