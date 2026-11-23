/**
 * Cron-Ausdrücke (Vixie/cronie, wie in crontab) erklären und nächste Ausführungen berechnen.
 * 6 Felder = mit Sekunden vorne (Spring/Quartz-Stil, „?“ wird wie „*“ behandelt).
 */

export interface CronField {
  values: number[];
  /** „*“ (ohne Einschränkung) */
  any: boolean;
  raw: string;
}

export interface Cron {
  second: CronField;
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
  hasSeconds: boolean;
  /** @reboot */
  reboot?: boolean;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export const monthNames = [
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
export const dayNames = [
  "Sonntag",
  "Montag",
  "Dienstag",
  "Mittwoch",
  "Donnerstag",
  "Freitag",
  "Samstag",
];

const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

function parseField(
  raw: string,
  min: number,
  max: number,
  label: string,
  names?: string[],
  nameOffset = 0,
): CronField {
  const text = raw.toLowerCase() === "?" ? "*" : raw.toLowerCase();
  const set = new Set<number>();
  const num = (s: string): number => {
    if (names) {
      const i = names.indexOf(s.slice(0, 3));
      if (i >= 0 && /^[a-z]+$/.test(s)) return i + nameOffset;
    }
    if (!/^\d+$/.test(s))
      throw new Error(
        `${label}: „${s}“ ist keine Zahl${/[lw#]/.test(s) ? " (L, W und # werden nicht unterstützt)" : ""}`,
      );
    return Number(s);
  };
  for (const part of text.split(",")) {
    if (!part) throw new Error(`${label}: leerer Eintrag`);
    const [range, stepRaw] = part.split("/");
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1)
      throw new Error(`${label}: ungültige Schrittweite „${stepRaw}“`);
    let lo: number;
    let hi: number;
    if (range === "*") [lo, hi] = [min, max];
    else if (range!.includes("-")) {
      const [a, b] = range!.split("-");
      [lo, hi] = [num(a!), num(b!)];
    } else {
      lo = num(range!);
      hi = stepRaw === undefined ? lo : max;
    }
    if (label === "Wochentag") {
      if (lo === 7 && hi === 7) lo = hi = 0;
      else if (hi === 7) {
        hi = 6;
        set.add(0);
      }
    }
    if (lo < min || hi > max || lo > hi)
      throw new Error(`${label}: ${range} liegt außerhalb von ${min}–${max}`);
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  return { values: [...set].sort((a, b) => a - b), any: text === "*", raw };
}

export function parseCron(expr: string): Cron {
  let text = expr.trim().replace(/\s+/g, " ");
  if (!text) throw new Error("Bitte gib einen Cron-Ausdruck ein");
  if (text.toLowerCase() === "@reboot") {
    const all = (min: number, max: number): CronField => ({
      values: Array.from({ length: max - min + 1 }, (_, i) => min + i),
      any: true,
      raw: "*",
    });
    return {
      second: all(0, 0),
      minute: all(0, 59),
      hour: all(0, 23),
      dom: all(1, 31),
      month: all(1, 12),
      dow: all(0, 6),
      hasSeconds: false,
      reboot: true,
    };
  }
  if (text.startsWith("@")) {
    const m = MACROS[text.toLowerCase()];
    if (!m) throw new Error(`Unbekanntes Makro ${text}`);
    text = m;
  }
  const parts = text.split(" ");
  // crontab-Zeile mit Befehl: nur die ersten 5 Felder nehmen
  if (parts.length > 6 && /^[\d*,/\-a-z?]+$/i.test(parts[4]!) && !/^[\d*,/\-?]+$/.test(parts[5]!))
    parts.length = 5;
  if (parts.length !== 5 && parts.length !== 6)
    throw new Error(
      `Erwartet 5 Felder (Minute Stunde Tag Monat Wochentag), gefunden ${parts.length}`,
    );
  const hasSeconds = parts.length === 6;
  const [s, mi, h, dom, mon, dow] = hasSeconds ? parts : ["0", ...parts];
  return {
    second: parseField(s!, 0, 59, "Sekunde"),
    minute: parseField(mi!, 0, 59, "Minute"),
    hour: parseField(h!, 0, 23, "Stunde"),
    dom: parseField(dom!, 1, 31, "Tag"),
    month: parseField(mon!, 1, 12, "Monat", MONTHS, 1),
    dow: parseField(dow!, 0, 7, "Wochentag", DAYS, 0),
    hasSeconds,
  };
}

// ---------- nächste Ausführungen ----------

function dayMatches(c: Cron, d: Date, utc: boolean): boolean {
  const dom = utc ? d.getUTCDate() : d.getDate();
  const dow = utc ? d.getUTCDay() : d.getDay();
  const month = (utc ? d.getUTCMonth() : d.getMonth()) + 1;
  if (!c.month.values.includes(month)) return false;
  const domOk = c.dom.values.includes(dom);
  const dowOk = c.dow.values.includes(dow);
  // Vixie-Cron: sind beide eingeschränkt, reicht einer von beiden
  if (!c.dom.any && !c.dow.any) return domOk || dowOk;
  return domOk && dowOk;
}

export function nextRuns(c: Cron, from: Date, count: number, utc = false): Date[] {
  if (c.reboot) return [];
  const out: Date[] = [];
  const day = new Date(from.getTime());
  if (utc) day.setUTCHours(0, 0, 0, 0);
  else day.setHours(0, 0, 0, 0);
  for (let i = 0; i < 366 * 8 && out.length < count; i++) {
    if (dayMatches(c, day, utc)) {
      for (const h of c.hour.values) {
        for (const m of c.minute.values) {
          for (const s of c.second.values) {
            const t = new Date(day.getTime());
            if (utc) t.setUTCHours(h, m, s, 0);
            else t.setHours(h, m, s, 0);
            // Sommerzeit: nicht existierende Uhrzeiten überspringen
            if ((utc ? t.getUTCHours() : t.getHours()) !== h) continue;
            if (t > from) out.push(t);
            if (out.length >= count) return out;
          }
        }
      }
    }
    if (utc) day.setUTCDate(day.getUTCDate() + 1);
    else day.setDate(day.getDate() + 1);
  }
  return out;
}

// ---------- Erklärung ----------

const pad = (n: number) => String(n).padStart(2, "0");

function listText(values: string[]): string {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} und ${values.at(-1)}`;
}

/** zusammenhängende Bereiche zusammenfassen: 1,2,3,5 → 1–3, 5 */
function ranges(values: number[], fmt: (n: number) => string, joiner = " bis "): string[] {
  const out: string[] = [];
  for (let i = 0; i < values.length;) {
    let j = i;
    while (j + 1 < values.length && values[j + 1] === values[j]! + 1) j++;
    out.push(
      j - i >= 2
        ? `${fmt(values[i]!)}${joiner}${fmt(values[j]!)}`
        : j > i
          ? `${fmt(values[i]!)}, ${fmt(values[j]!)}`
          : fmt(values[i]!),
    );
    i = j + 1;
  }
  return out;
}

function stepOf(f: CronField, min: number): number | null {
  const m = f.raw.match(/^(\*|\d+)\/(\d+)$/);
  if (!m) return null;
  const start = m[1] === "*" ? min : Number(m[1]);
  return start === min ? Number(m[2]) : null;
}

function timeText(c: Cron): string {
  const sec = c.hasSeconds && !(c.second.values.length === 1 && c.second.values[0] === 0);
  const minStep = stepOf(c.minute, 0);
  const hourStep = stepOf(c.hour, 0);
  if (sec) {
    const s = stepOf(c.second, 0);
    const base = s
      ? `alle ${s} Sekunden`
      : c.second.any
        ? "jede Sekunde"
        : `in Sekunde ${listText(ranges(c.second.values, String))}`;
    return `${base}${c.minute.any ? "" : `, Minute ${listText(ranges(c.minute.values, String))}`}${c.hour.any ? "" : `, Stunde ${listText(ranges(c.hour.values, String))}`}`;
  }
  if (c.minute.any && c.hour.any) return "jede Minute";
  if (minStep && c.hour.any) return `alle ${minStep} Minuten`;
  if (c.minute.any)
    return `jede Minute in den Stunden ${listText(ranges(c.hour.values, (h) => `${pad(h)}`, "–"))} Uhr`;
  if (minStep)
    return `alle ${minStep} Minuten zwischen ${pad(c.hour.values[0]!)}:00 und ${pad(c.hour.values.at(-1)!)}:59`;
  if (c.hour.any)
    return c.minute.values.length === 1
      ? `stündlich zur Minute ${c.minute.values[0]}`
      : `stündlich zu den Minuten ${listText(c.minute.values.map(String))}`;
  if (hourStep && c.minute.values.length === 1)
    return `alle ${hourStep} Stunden zur Minute ${c.minute.values[0]} (ab ${pad(c.hour.values[0]!)}:${pad(c.minute.values[0]!)})`;
  const times = c.hour.values.flatMap((h) => c.minute.values.map((m) => `${pad(h)}:${pad(m)}`));
  if (times.length <= 6) return `um ${listText(times)} Uhr`;
  return `zu den Minuten ${listText(ranges(c.minute.values, String))} in den Stunden ${listText(ranges(c.hour.values, String, "–"))}`;
}

function dayText(c: Cron): string {
  const parts: string[] = [];
  const dowText = () => {
    const v = c.dow.values;
    if (v.join() === "1,2,3,4,5") return "montags bis freitags";
    if (v.join() === "0,6") return "am Wochenende";
    return listText(ranges(v, (d) => `${dayNames[d]!.toLowerCase()}s`, " bis "));
  };
  const domText = () =>
    c.dom.values.length === 1
      ? `am ${c.dom.values[0]}. des Monats`
      : `an den Tagen ${listText(ranges(c.dom.values, String, "–"))} des Monats`;
  if (!c.dom.any && !c.dow.any) parts.push(`${domText()} oder ${dowText()}`);
  else if (!c.dom.any) parts.push(domText());
  else if (!c.dow.any) parts.push(dowText());
  else parts.push("täglich");
  if (!c.month.any)
    parts.push(`im ${listText(ranges(c.month.values, (m) => monthNames[m - 1]!, " bis "))}`);
  return parts.join(" ");
}

export function explainCron(c: Cron): string {
  if (c.reboot) return "Einmal beim Start des Systems (bzw. des cron-Dienstes).";
  const t = timeText(c);
  const d = dayText(c);
  const text = `${t.charAt(0).toUpperCase()}${t.slice(1)}, ${d}.`;
  return text.replace(", täglich.", ", jeden Tag.");
}

export const cronExamples: { expr: string; label: string }[] = [
  { expr: "*/5 * * * *", label: "alle 5 Minuten" },
  { expr: "0 * * * *", label: "stündlich" },
  { expr: "30 2 * * *", label: "täglich 02:30" },
  { expr: "0 8 * * 1-5", label: "werktags 08:00" },
  { expr: "0 22 * * 0", label: "sonntags 22:00" },
  { expr: "0 0 1 * *", label: "Monatserster" },
  { expr: "0 6,18 * * *", label: "06:00 und 18:00" },
  { expr: "@reboot", label: "beim Start" },
];
