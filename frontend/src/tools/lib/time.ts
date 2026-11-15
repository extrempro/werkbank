/** Unix-Zeitstempel und Zeitzonen */

export type Unit = "s" | "ms" | "us" | "ns";

export const unitLabels: Record<Unit, string> = { s: "Sekunden", ms: "Millisekunden", us: "Mikrosekunden", ns: "Nanosekunden" };

/** Einheit anhand der Größe erraten (bis Jahr ~5138 in Sekunden) */
export function guessUnit(value: bigint): Unit {
  const abs = value < 0n ? -value : value;
  if (abs < 100_000_000_000n) return "s";
  if (abs < 100_000_000_000_000n) return "ms";
  if (abs < 100_000_000_000_000_000n) return "us";
  return "ns";
}

export function parseTimestamp(input: string, unit?: Unit): { date: Date; unit: Unit; fraction: string } {
  const v = input.trim().replace(/[\s_']/g, "");
  const m = /^(-?\d+)(?:[.,](\d+))?$/.exec(v);
  if (!m) throw new Error("Bitte eine Zahl eingeben, z. B. 1762516800");
  const whole = BigInt(m[1]!);
  const u = unit ?? guessUnit(whole);
  const div = { s: 1n, ms: 1000n, us: 1_000_000n, ns: 1_000_000_000n }[u];
  const ms = Number((whole * 1000n) / div) + (m[2] && u === "s" ? Number(`0.${m[2]}`) * 1000 : 0);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) throw new Error("Außerhalb des darstellbaren Zeitraums");
  const rest = (whole * 1000n) % div;
  return { date, unit: u, fraction: rest ? `+${rest} ${u === "us" ? "µs-Anteil" : "ns-Anteil"}` : "" };
}

export function relativeText(date: Date, now = Date.now()): string {
  const diff = (date.getTime() - now) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [86400 * 30, "day"],
    [86400 * 365, "month"],
    [Infinity, "year"],
  ];
  const sizes = { second: 1, minute: 60, hour: 3600, day: 86400, month: 86400 * 30.44, year: 86400 * 365.25 };
  const [, u] = steps.find(([limit]) => abs < limit)!;
  return rtf.format(Math.round(diff / sizes[u as keyof typeof sizes]), u);
}

/** ISO-Kalenderwoche */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Excel-Seriennummer (1900-System, lokale Zeit) */
export const excelSerial = (d: Date) => (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000 + 25569;

// ---------- Zeitzonen ----------

/** Offset der Zone zu einem Zeitpunkt in Minuten (Berlin im Winter = +60) */
export function zoneOffset(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** Wanduhrzeit „2026-11-07T14:30“ in einer Zone → Zeitpunkt; bei Sommerzeit-Lücken wird vorgerückt */
export function wallTimeToDate(local: string, zone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) throw new Error("Ungültiges Datum");
  const asUtc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  let guess = asUtc - zoneOffset(zone, new Date(asUtc)) * 60000;
  guess = asUtc - zoneOffset(zone, new Date(guess)) * 60000;
  return new Date(guess);
}

export const formatOffset = (min: number) => `UTC${min >= 0 ? "+" : "−"}${String(Math.floor(Math.abs(min) / 60)).padStart(2, "0")}:${String(Math.abs(min) % 60).padStart(2, "0")}`;

export function allZones(): string[] {
  const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const list = fn ? fn("timeZone") : [];
  return list.includes("UTC") ? list : ["UTC", ...list];
}

export const defaultZones = ["Europe/Berlin", "UTC", "Europe/London", "America/New_York", "America/Chicago", "America/Los_Angeles", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo", "Australia/Sydney"];
