/** Speichereinheiten: dezimal (kB, MB, GB …), binär (KiB, MiB, GiB …) und Bit */

export interface Unit {
  id: string;
  label: string;
  /** Faktor in Bit */
  bits: number;
  system: "dezimal" | "binär" | "bit";
}

const dec = ["k", "M", "G", "T", "P", "E"];
const bin = ["Ki", "Mi", "Gi", "Ti", "Pi", "Ei"];

export const units: Unit[] = [
  { id: "B", label: "Byte (B)", bits: 8, system: "dezimal" },
  ...dec.map((p, i) => ({
    id: `${p}B`,
    label: `${p === "k" ? "Kilo" : p === "M" ? "Mega" : p === "G" ? "Giga" : p === "T" ? "Tera" : p === "P" ? "Peta" : "Exa"}byte (${p}B)`,
    bits: 8 * 1000 ** (i + 1),
    system: "dezimal" as const,
  })),
  ...bin.map((p, i) => ({
    id: `${p}B`,
    label: `${["Kibi", "Mebi", "Gibi", "Tebi", "Pebi", "Exbi"][i]}byte (${p}B)`,
    bits: 8 * 1024 ** (i + 1),
    system: "binär" as const,
  })),
  { id: "bit", label: "Bit", bits: 1, system: "bit" },
  ...dec.slice(0, 4).map((p, i) => ({
    id: `${p}bit`,
    label: `${p}bit`,
    bits: 1000 ** (i + 1),
    system: "bit" as const,
  })),
];

export const unitById = (id: string) =>
  units.find((u) => u.id === id || u.id.toLowerCase() === id.toLowerCase());

/** „1,5 TB“, „931.3GiB“, „500 GB“ → Bit; KB (groß) wird als kB gelesen */
export function parseSize(text: string): { bits: number; unit: Unit } | null {
  const m = /^\s*([\d.,']+)\s*([a-zA-Z]*)\s*$/.exec(text);
  if (!m) return null;
  const n = parseNumber(m[1]!);
  if (n === null) return null;
  const u = m[2] ? unitById(m[2] === "KB" ? "kB" : m[2] === "b" ? "bit" : m[2]) : unitById("B");
  if (!u) return null;
  return { bits: n * u.bits, unit: u };
}

/** deutsche und englische Schreibweise: 1.234,5 / 1,234.5 / 1234,5 / 1234.5 */
export function parseNumber(s: string): number | null {
  let t = s.replace(/'/g, "").trim();
  if (!t) return null;
  if (t.includes(",") && t.includes("."))
    t =
      t.lastIndexOf(",") > t.lastIndexOf(".")
        ? t.replace(/\./g, "").replace(",", ".")
        : t.replace(/,/g, "");
  else if (t.includes(",")) t = t.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3}){2,}$/.test(t)) t = t.replace(/\./g, "");
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Zahl deutsch formatieren mit sinnvoller Genauigkeit */
export function fmt(n: number, digits = 4): string {
  if (n === 0) return "0";
  if (n >= 1e15 || n < 1e-6) return n.toExponential(3).replace(".", ",");
  const d = n >= 1000 ? 2 : Math.max(0, digits - Math.floor(Math.log10(n)) - 1);
  return n.toLocaleString("de-DE", { maximumFractionDigits: Math.min(d, 10) });
}

/** passende Einheit wählen: binär oder dezimal */
export function humanSize(bytes: number, system: "dezimal" | "binär"): string {
  const base = system === "binär" ? 1024 : 1000;
  const names =
    system === "binär"
      ? ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"]
      : ["B", "kB", "MB", "GB", "TB", "PB", "EB"];
  let i = 0;
  let v = bytes;
  while (v >= base && i < names.length - 1) {
    v /= base;
    i++;
  }
  return `${fmt(v, 4)} ${names[i]}`;
}
