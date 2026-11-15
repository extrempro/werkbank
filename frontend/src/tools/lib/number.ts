/** Zahlensysteme mit BigInt: Dezimal, Hex, Binär, Oktal, Zweierkomplement */

export type Base = 2 | 8 | 10 | 16;

export function parseNumber(input: string, base?: Base): { value: bigint; base: Base } {
  let v = input.trim().replace(/[\s_']/g, "").toLowerCase();
  let neg = false;
  if (v.startsWith("-")) {
    neg = true;
    v = v.slice(1);
  }
  let b: Base | undefined = base;
  if (!b) {
    if (v.startsWith("0x")) b = 16;
    else if (v.startsWith("0b")) b = 2;
    else if (v.startsWith("0o")) b = 8;
    else if (/h$/.test(v) && /^[0-9a-f]+h$/.test(v)) b = 16;
    else if (/^[0-9]+$/.test(v)) b = 10;
    else if (/^[0-9a-f]+$/.test(v)) b = 16;
    else throw new Error("Nicht erkannt – Beispiele: 255, 0xFF, 0b1111, 0o377");
  }
  v = v.replace(/^0[xbo]/, "").replace(/h$/, "");
  const digits = { 2: /^[01]+$/, 8: /^[0-7]+$/, 10: /^\d+$/, 16: /^[0-9a-f]+$/ }[b];
  if (!digits.test(v)) throw new Error(`Ungültige Ziffer für Basis ${b}`);
  const prefix = { 2: "0b", 8: "0o", 10: "", 16: "0x" }[b];
  const value = BigInt(prefix + v);
  return { value: neg ? -value : value, base: b };
}

export const group = (s: string, size: number, sep = " ") => s.replace(new RegExp(`\\B(?=(.{${size}})+$)`, "g"), sep);

/** Zweierkomplement mit fester Breite; null, wenn der Wert nicht hineinpasst */
export function twosComplement(value: bigint, bits: number): bigint | null {
  const min = -(1n << BigInt(bits - 1));
  const maxUnsigned = (1n << BigInt(bits)) - 1n;
  if (value < min || value > maxUnsigned) return null;
  return value < 0n ? (1n << BigInt(bits)) + value : value;
}

/** vorzeichenbehaftete Deutung einer vorzeichenlosen Zahl */
export function asSigned(value: bigint, bits: number): bigint | null {
  if (value < 0n || value >= 1n << BigInt(bits)) return null;
  return value >= 1n << BigInt(bits - 1) ? value - (1n << BigInt(bits)) : value;
}

export function bytesOf(value: bigint): number[] {
  if (value < 0n) return [];
  const out: number[] = [];
  let v = value;
  do {
    out.unshift(Number(v & 0xffn));
    v >>= 8n;
  } while (v > 0n);
  return out;
}
