/** Übertragungsdauer aus Datenmenge und Bandbreite (und umgekehrt) */

export interface Preset {
  label: string;
  /** Bit/s */
  rate: number;
}

export const presets: Preset[] = [
  { label: "DSL 16", rate: 16e6 },
  { label: "VDSL 50", rate: 50e6 },
  { label: "VDSL 100", rate: 100e6 },
  { label: "250 Mbit/s", rate: 250e6 },
  { label: "Upload 40 Mbit/s", rate: 40e6 },
  { label: "1 Gbit/s", rate: 1e9 },
  { label: "2,5 Gbit/s", rate: 2.5e9 },
  { label: "10 Gbit/s", rate: 10e9 },
  { label: "25 Gbit/s", rate: 25e9 },
  { label: "USB 2.0 (≈ 280 Mbit/s real)", rate: 280e6 },
  { label: "USB 3.0 (5 Gbit/s)", rate: 5e9 },
  { label: "WLAN Wi-Fi 6 (≈ 600 Mbit/s real)", rate: 600e6 },
];

/** Sekunden für `bytes` bei `rate` Bit/s und `efficiency` (0–1, Protokoll-Overhead) */
export const duration = (bytes: number, rate: number, efficiency: number) => (bytes * 8) / (rate * efficiency);

/** benötigte Bandbreite (Bit/s) für `bytes` in `seconds` */
export const requiredRate = (bytes: number, seconds: number, efficiency: number) => (bytes * 8) / seconds / efficiency;

export function durationText(s: number): string {
  if (!Number.isFinite(s)) return "–";
  if (s < 1) return `${Math.round(s * 1000)} ms`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  const parts: string[] = [];
  if (d) parts.push(`${d} ${d === 1 ? "Tag" : "Tage"}`);
  if (h) parts.push(`${h} h`);
  if (m && d < 10) parts.push(`${m} min`);
  if (!d && !h && (sec || !m)) parts.push(`${sec} s`);
  return parts.join(" ");
}

export function rateText(bps: number): string {
  const u: [number, string][] = [
    [1e12, "Tbit/s"],
    [1e9, "Gbit/s"],
    [1e6, "Mbit/s"],
    [1e3, "kbit/s"],
  ];
  const [f, name] = u.find(([x]) => bps >= x) ?? [1, "bit/s"];
  return `${(bps / f).toLocaleString("de-DE", { maximumFractionDigits: 2 })} ${name}`;
}

/** Zeitangabe wie „8h“, „30 min“, „1,5 Tage“, „01:30:00“ → Sekunden */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(",", ".");
  const hms = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(t);
  if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3] ?? 0);
  let total = 0;
  let found = false;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(tage?|d|stunden?|std|h|minuten?|min|m|sekunden?|sek|s)\b/g)) {
    found = true;
    const n = Number(m[1]);
    const u = m[2]!;
    total += n * (/^(tage?|d)$/.test(u) ? 86400 : /^(stunden?|std|h)$/.test(u) ? 3600 : /^(minuten?|min|m)$/.test(u) ? 60 : 1);
  }
  return found && total > 0 ? total : null;
}
