import { getJson, postJson, putJson } from "./api";
import { ADMIN_FEEDBACK_PATH } from "./navigation";
import { RELEASES } from "./release-notes";

export type FeedbackKind = "fehler" | "idee";
export type FeedbackStatus = "neu" | "in_arbeit" | "erledigt" | "abgelehnt";
export type FeedbackFilter = "offen" | "fehler" | "idee" | "erledigt" | "alle";

export const FEEDBACK_PATH = "/konto/rueckmeldungen";
export const FEEDBACK_ADMIN_PATH = ADMIN_FEEDBACK_PATH;
export const FEEDBACK_TEXT_MIN = 5;
export const FEEDBACK_TEXT_MAX = 2000;
/** Ziel für das verkleinerte Bildschirmfoto; der Server nimmt höchstens 300 KB. */
export const SCREENSHOT_TARGET = 150 * 1024;
export const SCREENSHOT_SERVER_MAX = 300 * 1024;
const SCREENSHOT_WIDTH = 1600;
const BROWSER_ERRORS_MAX = 5;

export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  fehler: "Fehler",
  idee: "Idee",
};

export const FEEDBACK_STATUS: Record<FeedbackStatus, { label: string; pill: string }> = {
  neu: { label: "Neu", pill: "pill-info" },
  in_arbeit: { label: "In Arbeit", pill: "pill-todo" },
  erledigt: { label: "Erledigt", pill: "pill-ok" },
  abgelehnt: { label: "Nicht umgesetzt", pill: "pill-neutral" },
};

export const FEEDBACK_FILTERS: { id: FeedbackFilter; label: string }[] = [
  { id: "offen", label: "Offen" },
  { id: "fehler", label: "Fehler" },
  { id: "idee", label: "Ideen" },
  { id: "erledigt", label: "Abgeschlossen" },
  { id: "alle", label: "Alle" },
];

export interface FeedbackReply {
  id: number;
  author: string;
  text: string;
  created_at: string;
}

export interface FeedbackSummary {
  id: number;
  number: string;
  kind: FeedbackKind;
  status: FeedbackStatus;
  title: string;
  page: string;
  user_name: string;
  has_screenshot: boolean;
  replies: number;
  created_at: string;
}

export interface Feedback extends FeedbackSummary {
  text: string;
  technical: {
    version?: string;
    window?: string;
    browser?: string;
    browser_errors?: string[];
  };
  reply_list: FeedbackReply[];
  status_changed_at: string | null;
  closed_at: string | null;
}

export interface FeedbackInput {
  kind: FeedbackKind;
  text: string;
  page: string;
  technical?: { version: string; window: string; browser_errors: string[] };
  screenshot?: string;
}

// --- Fehlermeldungen des Browsers (für Fehlerberichte) ---------------------------------------

const browserErrors: string[] = [];

/** Merkt sich die letzten Fehlermeldungen des Browsers, ohne Zeilenumbrüche und gekürzt. */
export function rememberBrowserError(message: string): void {
  const line = message.replace(/\s+/g, " ").trim().slice(0, 280);
  if (!line) {
    return;
  }
  browserErrors.push(line);
  if (browserErrors.length > BROWSER_ERRORS_MAX) {
    browserErrors.splice(0, browserErrors.length - BROWSER_ERRORS_MAX);
  }
}

export function recentBrowserErrors(): string[] {
  return [...browserErrors];
}

/** Einmal beim Start: Fehler und abgelehnte Promises mitschreiben. */
export function watchBrowserErrors(): void {
  window.addEventListener("error", (event) => {
    rememberBrowserError(event.message || "Fehler im Browser");
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    rememberBrowserError(
      reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason),
    );
  });
}

/** Was mit einem Fehlerbericht zusätzlich mitgeht (sichtbar vor dem Senden). */
export function technicalInfo(): { version: string; window: string; browser_errors: string[] } {
  return {
    version: RELEASES[0]?.version ?? "",
    window: `${window.innerWidth} × ${window.innerHeight}`,
    browser_errors: recentBrowserErrors(),
  };
}

/** Kurze Angabe zum Browser, z. B. „Edge 142 unter Windows“ (nur zur Anzeige). */
export function browserLabel(agent: string = navigator.userAgent): string {
  const browsers: [RegExp, string][] = [
    [/Edg\/(\d+)/, "Edge"],
    [/Firefox\/(\d+)/, "Firefox"],
    [/Chrome\/(\d+)/, "Chrome"],
    [/Version\/(\d+).*Safari/, "Safari"],
  ];
  let browser = "Browser";
  for (const [pattern, name] of browsers) {
    const match = pattern.exec(agent);
    if (match) {
      browser = `${name} ${match[1] ?? ""}`.trim();
      break;
    }
  }
  const systems: [RegExp, string][] = [
    [/Windows/, "Windows"],
    [/iPhone|iPad/, "iOS"],
    [/Android/, "Android"],
    [/Mac OS X/, "macOS"],
    [/Linux/, "Linux"],
  ];
  const system = systems.find(([pattern]) => pattern.test(agent))?.[1];
  return system ? `${browser} unter ${system}` : browser;
}

// --- Bildschirmfoto ------------------------------------------------------------------------

/** Base64 eines data:-URLs (ohne Präfix). */
export function dataUrlPayload(url: string): string {
  const comma = url.indexOf(",");
  return comma >= 0 ? url.slice(comma + 1) : "";
}

/** Größe in Bytes eines Base64-Texts. */
export function base64Bytes(payload: string): number {
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.floor((payload.length * 3) / 4) - padding;
}

/** Zeichnet ein Bild verkleinert als JPEG; Qualität sinkt, bis es klein genug ist. */
export function shrinkToJpeg(source: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(1, SCREENSHOT_WIDTH / Math.max(width, 1));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Das Bild ließ sich nicht verarbeiten.");
  }
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  let quality = 0.8;
  let payload = dataUrlPayload(canvas.toDataURL("image/jpeg", quality));
  while (base64Bytes(payload) > SCREENSHOT_TARGET && quality > 0.35) {
    quality -= 0.15;
    payload = dataUrlPayload(canvas.toDataURL("image/jpeg", quality));
  }
  if (base64Bytes(payload) > SCREENSHOT_SERVER_MAX) {
    throw new Error("Das Bild ist zu groß. Nimm bitte einen kleineren Ausschnitt.");
  }
  return payload;
}

/** Bilddatei (Auswahl oder Einfügen) als verkleinertes JPEG. */
export async function imageFileToJpeg(file: Blob): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) {
    throw new Error("Bitte wähle ein Bild (PNG, JPEG oder WebP).");
  }
  const bitmap = await createImageBitmap(file);
  try {
    return shrinkToJpeg(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/** Ob der Browser den Bildschirm aufnehmen kann (am Handy meist nicht). */
export function canCaptureScreen(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
}

/** Ein Bild vom Bildschirm: Der Browser fragt, was aufgenommen werden soll. */
export async function captureScreen(): Promise<string> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    await video.play();
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    return shrinkToJpeg(video, video.videoWidth, video.videoHeight);
  } finally {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}

// --- API ------------------------------------------------------------------------------------

export function sendFeedback(body: FeedbackInput): Promise<Feedback> {
  return postJson("/api/feedback", body, { quiet: true });
}

export function fetchMyFeedback(): Promise<Feedback[]> {
  return getJson("/api/feedback/mine");
}

export function fetchFeedbackList(
  filter: FeedbackFilter,
): Promise<{ entries: FeedbackSummary[]; open: number }> {
  return getJson(`/api/feedback?state=${filter}`);
}

export function fetchFeedback(id: number): Promise<Feedback> {
  return getJson(`/api/feedback/${id}`);
}

export function setFeedbackStatus(id: number, status: FeedbackStatus): Promise<Feedback> {
  return putJson(`/api/feedback/${id}/status`, { status }, { quiet: true });
}

export function replyFeedback(id: number, text: string): Promise<Feedback> {
  return postJson(`/api/feedback/${id}/replies`, { text }, { quiet: true });
}

export function screenshotUrl(id: number): string {
  return `/api/feedback/${id}/screenshot`;
}

export function feedbackAdminPath(id: number): string {
  return `${FEEDBACK_ADMIN_PATH}/${id}`;
}

export function parseFeedbackAdminPath(path: string): { id: number | null } | null {
  if (path === FEEDBACK_ADMIN_PATH) {
    return { id: null };
  }
  const match = /^\/verwaltung\/rueckmeldungen\/(\d{1,9})$/.exec(path);
  return match ? { id: Number(match[1]) } : null;
}

// Entwurf je Seite, solange das Fenster zu ist (nur im Speicher dieser Sitzung)
const drafts = new Map<string, { kind: FeedbackKind | null; text: string }>();

export function feedbackDraft(page: string): { kind: FeedbackKind | null; text: string } {
  return drafts.get(page) ?? { kind: null, text: "" };
}

export function keepFeedbackDraft(page: string, kind: FeedbackKind | null, text: string): void {
  if (!kind && !text.trim()) {
    drafts.delete(page);
  } else {
    drafts.set(page, { kind, text });
  }
}
