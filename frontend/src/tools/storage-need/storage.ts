/** Speicherbedarf mit Komprimierung, Deduplizierung, Wachstum und Reserve */

export interface StorageInput {
  /** Rohdaten in Byte */
  data: number;
  /** Komprimierungsfaktor, z. B. 2 für 2:1 */
  compression: number;
  /** Deduplizierungsfaktor, 1 = keine */
  dedup: number;
  /** Wachstum pro Jahr in Prozent */
  growth: number;
  years: number;
  /** Reserve als Zuschlag in Prozent */
  reserve: number;
}

export interface StorageYear {
  year: number;
  raw: number;
  reduced: number;
  withReserve: number;
}

export const ratioFromSavings = (percent: number) => 1 / (1 - percent / 100);
export const savingsFromRatio = (ratio: number) => (1 - 1 / ratio) * 100;

export function storageNeed(i: StorageInput): StorageYear[] {
  if (!(i.data > 0)) throw new Error("Datenmenge fehlt.");
  if (!(i.compression >= 1) || !(i.dedup >= 1))
    throw new Error("Faktoren müssen mindestens 1 sein (1 = keine Einsparung).");
  if (i.growth <= -100) throw new Error("Wachstum muss größer als −100 % sein.");
  const out: StorageYear[] = [];
  for (let y = 0; y <= Math.max(0, Math.floor(i.years)); y++) {
    const raw = i.data * (1 + i.growth / 100) ** y;
    const reduced = raw / i.compression / i.dedup;
    out.push({ year: y, raw, reduced, withReserve: reduced * (1 + i.reserve / 100) });
  }
  return out;
}
