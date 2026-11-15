/**
 * Zeitwerte aus Active Directory:
 * - FILETIME / Integer8 (lastLogonTimestamp, pwdLastSet, accountExpires, badPasswordTime …):
 *   100-Nanosekunden-Intervalle seit 01.01.1601 UTC
 * - Generalized Time (whenCreated, whenChanged): 20231015123045.0Z
 */

/** Differenz 1601 → 1970 in 100-ns-Einheiten */
const EPOCH_DIFF = 116_444_736_000_000_000n;
const TICKS_PER_MS = 10_000n;
export const NEVER = 9_223_372_036_854_775_807n; // 0x7FFFFFFFFFFFFFFF

export type AdTimeKind = "filetime" | "generalized";

export interface AdTimeResult {
  kind: AdTimeKind;
  /** null bei Sonderwerten (0, „nie“) */
  date: Date | null;
  /** Erklärung für Sonderwerte */
  special?: string;
  filetime?: bigint;
}

export function fileTimeToDate(ft: bigint): Date {
  return new Date(Number((ft - EPOCH_DIFF) / TICKS_PER_MS));
}

export function dateToFileTime(date: Date): bigint {
  return BigInt(date.getTime()) * TICKS_PER_MS + EPOCH_DIFF;
}

export function dateToGeneralizedTime(date: Date): string {
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return (
    `${p(date.getUTCFullYear(), 4)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}.0Z`
  );
}

export function parseGeneralizedTime(value: string): Date {
  const m = value
    .trim()
    .match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:[.,](\d+))?(Z|[+-]\d{4})$/);
  if (!m) throw new Error("Ungültige Generalized Time (erwartet z. B. 20231015123045.0Z)");
  const [, y, mo, d, h, mi, s, frac, tz] = m;
  const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
  let time = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
  if (tz && tz !== "Z") {
    const sign = tz.startsWith("-") ? -1 : 1;
    time -= sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5))) * 60_000;
  }
  return new Date(time);
}

export function parseAdTime(input: string): AdTimeResult {
  const value = input.trim();
  if (!value) throw new Error("Keine Eingabe");

  if (/^-?\d+$/.test(value) && value.length <= 20) {
    const ft = BigInt(value);
    if (ft === 0n) {
      return {
        kind: "filetime",
        date: null,
        filetime: ft,
        special:
          "0 = nicht gesetzt. Bei accountExpires: läuft nie ab. Bei pwdLastSet: Kennwort muss bei der nächsten Anmeldung geändert werden.",
      };
    }
    if (ft === NEVER) {
      return {
        kind: "filetime",
        date: null,
        filetime: ft,
        special: "Läuft nie ab (Maximalwert, typisch bei accountExpires).",
      };
    }
    if (ft === -1n) {
      return {
        kind: "filetime",
        date: null,
        filetime: ft,
        special:
          "-1 bei pwdLastSet: Kennwort gilt als gerade geändert (wird beim Speichern durch die aktuelle Zeit ersetzt).",
      };
    }
    if (ft < 0n) throw new Error("Negative Werte außer -1 sind keine gültige FILETIME");
    const date = fileTimeToDate(ft);
    if (date.getUTCFullYear() > 9999)
      throw new Error("Wert liegt außerhalb des darstellbaren Bereichs");
    return { kind: "filetime", date, filetime: ft };
  }

  const date = parseGeneralizedTime(value);
  return { kind: "generalized", date, filetime: dateToFileTime(date) };
}

/** „vor 3 Tagen“ / „in 2 Monaten“ */
export function relativeTime(date: Date, now = new Date()): string {
  const diffSec = Math.round((date.getTime() - now.getTime()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
    ["second", 1],
  ];
  const fmt = new Intl.RelativeTimeFormat("de", { numeric: "auto" });
  for (const [unit, seconds] of units) {
    if (Math.abs(diffSec) >= seconds || unit === "second")
      return fmt.format(Math.round(diffSec / seconds), unit);
  }
  return "";
}
