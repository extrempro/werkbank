/** Kennwort-Erzeugung mit kryptografisch sicheren Zufallswerten (crypto.getRandomValues). */

export interface PasswordOptions {
  length: number;
  lower: boolean;
  upper: boolean;
  digits: boolean;
  symbols: boolean;
  /** schwer unterscheidbare Zeichen weglassen (I, l, 1, O, 0, …) */
  excludeAmbiguous: boolean;
}

export const charsets = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  // ohne Leerzeichen und Anführungszeichen, damit Kennwörter in Skripten/Konfigurationen keine Probleme machen
  symbols: "!#$%&()*+,-./:;<=>?@[]^_{|}~",
} as const;

const ambiguous = new Set("Il1O0o|`'\"".split(""));

/** Gleichverteilte Zufallszahl in [0, max) ohne Modulo-Verzerrung */
export function randomInt(max: number): number {
  if (max <= 0 || max > 2 ** 32) throw new Error("Ungültiger Bereich");
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % max;
  }
}

function pick(chars: string): string {
  return chars[randomInt(chars.length)]!;
}

export function activeSets(opts: PasswordOptions): string[] {
  const keys = (["lower", "upper", "digits", "symbols"] as const).filter((k) => opts[k]);
  return keys
    .map((k) =>
      opts.excludeAmbiguous
        ? [...charsets[k]].filter((c) => !ambiguous.has(c)).join("")
        : charsets[k],
    )
    .filter((s) => s.length > 0);
}

export function generatePassword(opts: PasswordOptions): string {
  const sets = activeSets(opts);
  if (sets.length === 0) throw new Error("Mindestens eine Zeichengruppe auswählen");
  if (opts.length < sets.length)
    throw new Error(`Mindestens ${sets.length} Zeichen nötig, damit jede Gruppe vorkommt`);
  const all = sets.join("");
  // aus jeder gewählten Gruppe mindestens ein Zeichen, Rest beliebig
  const chars = [
    ...sets.map(pick),
    ...Array.from({ length: opts.length - sets.length }, () => pick(all)),
  ];
  // Fisher-Yates mit sicherem Zufall, damit die Pflichtzeichen nicht vorne stehen
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}

/** Näherung der Entropie in Bit (Länge × log2(Zeichenvorrat)) */
export function entropyBits(opts: PasswordOptions): number {
  const pool = activeSets(opts).join("").length;
  return pool === 0 ? 0 : Math.round(opts.length * Math.log2(pool));
}

export function strengthLabel(bits: number): { text: string; tone: "error" | "warn" | "ok" } {
  if (bits < 50) return { text: "schwach", tone: "error" };
  if (bits < 80) return { text: "mittel", tone: "warn" };
  if (bits < 128) return { text: "stark", tone: "ok" };
  return { text: "sehr stark", tone: "ok" };
}
