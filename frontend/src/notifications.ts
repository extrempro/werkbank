import { deleteJson, getJson, postJson, putJson } from "./api";

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
  /** Zusätzlich per Mail, in Teams bzw. als Push (gesammelt, ohne Inhalte) */
  mail: boolean;
  teams: boolean;
  push: boolean;
}

export interface NotificationChannels {
  /** In der Verwaltung eingerichtet */
  mail: boolean;
  teams: boolean;
  /** Push hat die Verwaltung eingeschaltet */
  push: boolean;
  has_email: boolean;
}

export interface NotificationSettings {
  kinds: NotificationKind[];
  channels: NotificationChannels;
}

export type Channel = "enabled" | "mail" | "teams" | "push";

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
    push: kinds.filter((entry) => entry.enabled && entry.push).map((entry) => entry.kind),
  });
}

/** Schaltet einen Weg für eine Art um. Ohne Glocke gibt es auch keine Mail, kein Teams, kein Push. */
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
    return channel === "enabled" && !on
      ? { ...next, mail: false, teams: false, push: false }
      : next;
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

// --- Push aufs Handy ----------------------------------------------------------------------

export interface PushDevice {
  id: number;
  label: string;
  created_at: string;
  last_success_at: string | null;
}

export interface PushState {
  /** Von der Verwaltung eingeschaltet */
  available: boolean;
  public_key: string | null;
  devices: PushDevice[];
}

export function fetchPushState(): Promise<PushState> {
  return getJson(`${BASE}/push`);
}

export function removePushDevice(id: number): Promise<PushState> {
  return deleteJson(`${BASE}/push/subscriptions/${id}`);
}

export function sendPushTest(): Promise<PushState> {
  return postJson(`${BASE}/push/test`);
}

/** Kann dieser Browser überhaupt Push? (Auf dem iPhone nur als App auf dem Home-Bildschirm.) */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Läuft die Werkbank als installierte App (Home-Bildschirm)? */
export function runsAsApp(): boolean {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/** iPhone oder iPad: Push gibt es dort nur in der App vom Home-Bildschirm. */
export function isApple(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/** Kurzer Name des Geräts für die Liste im Konto, ohne Versionsnummern. */
export function deviceLabel(userAgent: string = navigator.userAgent): string {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
  if (/Linux/.test(userAgent)) return "Linux";
  return "Browser";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded =
    base64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

function base64url(buffer: ArrayBuffer | null): string {
  if (!buffer) {
    return "";
  }
  let text = "";
  for (const byte of new Uint8Array(buffer)) {
    text += String.fromCharCode(byte);
  }
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Abo dieses Browsers, falls vorhanden. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) {
    return null;
  }
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/** Fragt die Erlaubnis, abonniert und meldet das Gerät an. */
export async function enablePushHere(publicKey: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Mitteilungen sind für die Werkbank nicht erlaubt.");
  }
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  return postJson(`${BASE}/push/subscriptions`, {
    endpoint: subscription.endpoint,
    p256dh: base64url(subscription.getKey("p256dh")),
    auth: base64url(subscription.getKey("auth")),
    label: deviceLabel(),
  });
}

/** Meldet dieses Gerät ab und beendet das Abo im Browser. */
export async function disablePushHere(): Promise<PushState> {
  const subscription = await currentSubscription();
  if (!subscription) {
    return fetchPushState();
  }
  const state = await postJson<PushState>(`${BASE}/push/subscriptions/remove`, {
    endpoint: subscription.endpoint,
  });
  await subscription.unsubscribe();
  return state;
}
