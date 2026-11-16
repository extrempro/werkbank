/**
 * QR-Code-Encoder nach ISO/IEC 18004 (Model 2, Versionen 1–40).
 *
 * Unterstützt die Modi Numerisch, Alphanumerisch und Byte (UTF-8), alle vier Fehlerkorrekturstufen
 * und die automatische Wahl von Version und Maske. Ergebnis ist eine Matrix aus booleschen Werten
 * (true = dunkles Modul) ohne Ruhezone.
 */

export type Ecl = "L" | "M" | "Q" | "H";

export const eclInfo: Record<
  Ecl,
  { label: string; recovery: string; formatBits: number; index: number }
> = {
  L: { label: "L – niedrig", recovery: "ca. 7 %", formatBits: 1, index: 0 },
  M: { label: "M – mittel", recovery: "ca. 15 %", formatBits: 0, index: 1 },
  Q: { label: "Q – hoch", recovery: "ca. 25 %", formatBits: 3, index: 2 },
  H: { label: "H – sehr hoch", recovery: "ca. 30 %", formatBits: 2, index: 3 },
};

// Tabellen aus der Norm (Index = Version, Index 0 unbenutzt)
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  [
    -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30,
    30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  [
    -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30,
    30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
];

const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  [
    -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14,
    15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  [
    -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23,
    25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  [
    -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34,
    34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  [
    -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35,
    37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
];

export const MIN_VERSION = 1;
export const MAX_VERSION = 40;

// ---------- Kapazität ----------

/** Anzahl der Module für Daten + Fehlerkorrektur (ohne Funktionsmuster, Format- und Versionsinfo) */
export function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

/** Anzahl der Daten-Codewörter (Bytes) für Version und Fehlerkorrektur */
export function numDataCodewords(ver: number, ecl: Ecl): number {
  const e = eclInfo[ecl].index;
  return (
    Math.floor(numRawDataModules(ver) / 8) -
    ECC_CODEWORDS_PER_BLOCK[e]![ver]! * NUM_ERROR_CORRECTION_BLOCKS[e]![ver]!
  );
}

// ---------- Segmente ----------

export type Mode = "numeric" | "alphanumeric" | "byte";

const ALPHANUMERIC_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

const modeBits: Record<Mode, number> = { numeric: 0x1, alphanumeric: 0x2, byte: 0x4 };
const charCountBits: Record<Mode, [number, number, number]> = {
  numeric: [10, 12, 14],
  alphanumeric: [9, 11, 13],
  byte: [8, 16, 16],
};

function countBits(mode: Mode, ver: number): number {
  return charCountBits[mode][ver <= 9 ? 0 : ver <= 26 ? 1 : 2];
}

interface Segment {
  mode: Mode;
  numChars: number;
  bits: number[];
}

function appendBits(out: number[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i--) out.push((value >>> i) & 1);
}

/** Wählt den kompaktesten Modus für den ganzen Text. */
export function chooseMode(text: string): Mode {
  if (/^\d*$/.test(text)) return "numeric";
  if ([...text].every((c) => ALPHANUMERIC_CHARSET.includes(c))) return "alphanumeric";
  return "byte";
}

export function makeSegment(text: string): Segment {
  const mode = chooseMode(text);
  const bits: number[] = [];
  if (mode === "numeric") {
    for (let i = 0; i < text.length; i += 3) {
      const chunk = text.slice(i, i + 3);
      appendBits(bits, Number(chunk), chunk.length * 3 + 1);
    }
    return { mode, numChars: text.length, bits };
  }
  if (mode === "alphanumeric") {
    for (let i = 0; i < text.length; i += 2) {
      const a = ALPHANUMERIC_CHARSET.indexOf(text[i]!);
      if (i + 1 < text.length)
        appendBits(bits, a * 45 + ALPHANUMERIC_CHARSET.indexOf(text[i + 1]!), 11);
      else appendBits(bits, a, 6);
    }
    return { mode, numChars: text.length, bits };
  }
  const bytes = new TextEncoder().encode(text);
  for (const b of bytes) appendBits(bits, b, 8);
  return { mode, numChars: bytes.length, bits };
}

function segmentTotalBits(seg: Segment, ver: number): number {
  const cc = countBits(seg.mode, ver);
  if (seg.numChars >= 1 << cc) return Infinity;
  return 4 + cc + seg.bits.length;
}

// ---------- Reed-Solomon (GF(2^8), Polynom 0x11D) ----------

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

export function reedSolomonDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j]!, root);
      if (j + 1 < result.length) result[j]! ^= result[j + 1]!;
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

export function reedSolomonRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift()!;
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i]! ^= gfMultiply(coef, factor);
    });
  }
  return result;
}

// ---------- Codewörter ----------

/** Datenbits → Daten-Codewörter inkl. Terminator und Füllbytes */
export function encodeDataCodewords(seg: Segment, ver: number, ecl: Ecl): number[] {
  const capacityBits = numDataCodewords(ver, ecl) * 8;
  const bits: number[] = [];
  appendBits(bits, modeBits[seg.mode], 4);
  appendBits(bits, seg.numChars, countBits(seg.mode, ver));
  bits.push(...seg.bits);
  if (bits.length > capacityBits) throw new Error("Daten passen nicht in diese Version");
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
  appendBits(bits, 0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) appendBits(bits, pad, 8);
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]!;
    codewords.push(byte);
  }
  return codewords;
}

/** Fehlerkorrektur je Block berechnen und Blöcke verschränken */
export function addEccAndInterleave(data: number[], ver: number, ecl: Ecl): number[] {
  const e = eclInfo[ecl].index;
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[e]![ver]!;
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[e]![ver]!;
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const divisor = reedSolomonDivisor(blockEccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = reedSolomonRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0); // Platzhalter, damit alle Blöcke gleich lang sind
    blocks.push(dat.concat(ecc));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]!);
    });
  }
  return result;
}

/**
 * Aufbau der Fehlerkorrektur: zu welchem Block jedes Codewort des verschränkten Datenstroms gehört
 * und wie viele fehlerhafte Codewörter ein Block höchstens verkraftet.
 */
export function blockLayout(
  ver: number,
  ecl: Ecl,
): { blockOf: number[]; blocks: number; correctable: number } {
  const e = eclInfo[ecl].index;
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[e]![ver]!;
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[e]![ver]!;
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const blockOf: number[] = [];
  // gleiche Reihenfolge wie in addEccAndInterleave
  for (let i = 0; i <= shortBlockLen; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) blockOf.push(j);
    }
  }
  return {
    blockOf: blockOf.slice(0, rawCodewords),
    blocks: numBlocks,
    correctable: Math.floor(blockEccLen / 2),
  };
}

// ---------- Matrix ----------

function alignmentPositions(ver: number): number[] {
  if (ver === 1) return [];
  const size = ver * 4 + 17;
  const numAlign = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** 15 Bit Formatinformation (Fehlerkorrektur + Maske, BCH-geschützt, maskiert) */
export function formatBits(ecl: Ecl, mask: number): number {
  const data = (eclInfo[ecl].formatBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 18 Bit Versionsinformation (ab Version 7) */
export function versionBits(ver: number): number {
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (ver << 12) | rem;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

class Matrix {
  readonly version: number;
  readonly size: number;
  readonly modules: boolean[][];
  readonly isFunction: boolean[][];
  /** zu welchem Codewort (Position im verschränkten Datenstrom) ein Modul gehört; -1 = Muster, Format oder Restbit */
  readonly codewordAt: number[][];

  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.modules = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.isFunction = Array.from({ length: this.size }, () =>
      new Array<boolean>(this.size).fill(false),
    );
    this.codewordAt = Array.from({ length: this.size }, () =>
      new Array<number>(this.size).fill(-1),
    );
  }

  setFunction(x: number, y: number, dark: boolean) {
    this.modules[y]![x] = dark;
    this.isFunction[y]![x] = true;
  }

  drawFunctionPatterns(ecl: Ecl) {
    const size = this.size;
    for (let i = 0; i < size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(size - 4, 3);
    this.drawFinder(3, size - 4);
    const pos = alignmentPositions(this.version);
    const n = pos.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
        this.drawAlignment(pos[i]!, pos[j]!);
      }
    }
    this.drawFormat(ecl, 0); // Platzhalter, wird nach der Maskenwahl überschrieben
    this.drawVersion();
  }

  private drawFinder(x: number, y: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size)
          this.setFunction(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }

  private drawAlignment(x: number, y: number) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++)
        this.setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  drawFormat(ecl: Ecl, mask: number) {
    const bits = formatBits(ecl, mask);
    const size = this.size;
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(bits, i));
    this.setFunction(8, 7, bit(bits, 6));
    this.setFunction(8, 8, bit(bits, 7));
    this.setFunction(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.setFunction(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunction(8, size - 15 + i, bit(bits, i));
    this.setFunction(8, size - 8, true); // immer dunkles Modul
  }

  private drawVersion() {
    if (this.version < 7) return;
    const bits = versionBits(this.version);
    for (let i = 0; i < 18; i++) {
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, bit(bits, i));
      this.setFunction(b, a, bit(bits, i));
    }
  }

  drawCodewords(data: number[]) {
    const size = this.size;
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // vertikale Timing-Linie überspringen
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (!this.isFunction[y]![x] && i < data.length * 8) {
            this.modules[y]![x] = bit(data[i >>> 3]!, 7 - (i & 7));
            this.codewordAt[y]![x] = i >>> 3;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y]![x]) continue;
        let invert: boolean;
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          case 1:
            invert = y % 2 === 0;
            break;
          case 2:
            invert = x % 3 === 0;
            break;
          case 3:
            invert = (x + y) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) === 0;
            break;
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          default:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (invert) this.modules[y]![x] = !this.modules[y]![x];
      }
    }
  }

  /** Strafpunkte nach der Norm (N1–N4) – je niedriger, desto besser lesbar */
  penalty(): number {
    const size = this.size;
    const m = this.modules;
    let score = 0;

    const line = (get: (i: number) => boolean) => {
      // N1: Folgen ≥ 5 gleicher Farbe
      let runColor = get(0);
      let run = 1;
      for (let i = 1; i < size; i++) {
        if (get(i) === runColor) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          runColor = get(i);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
      // N3: Finder-ähnliche Muster 1011101 mit 4 hellen Modulen davor oder danach.
      // Außerhalb der Matrix liegt die helle Ruhezone – Muster direkt am Rand zählen also mit.
      const at = (k: number) => (k >= 0 && k < size ? get(k) : false);
      for (let i = -4; i + 10 < size + 4; i++) {
        const p = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => at(i + k));
        const a =
          p[0] &&
          !p[1] &&
          p[2] &&
          p[3] &&
          p[4] &&
          !p[5] &&
          p[6] &&
          !p[7] &&
          !p[8] &&
          !p[9] &&
          !p[10];
        const b =
          !p[0] &&
          !p[1] &&
          !p[2] &&
          !p[3] &&
          p[4] &&
          !p[5] &&
          p[6] &&
          p[7] &&
          p[8] &&
          !p[9] &&
          p[10];
        if (a) score += 40;
        if (b) score += 40;
      }
    };
    for (let y = 0; y < size; y++) line((x) => m[y]![x]!);
    for (let x = 0; x < size; x++) line((y) => m[y]![x]!);

    // N2: 2×2-Blöcke gleicher Farbe
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = m[y]![x];
        if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) score += 3;
      }
    }

    // N4: Verhältnis dunkel/hell
    let dark = 0;
    for (const row of m) for (const v of row) if (v) dark++;
    const total = size * size;
    score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return score;
  }
}

// ---------- öffentliche API ----------

export interface QrCode {
  version: number;
  ecl: Ecl;
  mask: number;
  mode: Mode;
  size: number;
  /** modules[y][x] = true → dunkel */
  modules: boolean[][];
  /** codewordAt[y][x] = Nummer des Codeworts, zu dem das Modul gehört (-1 = Muster, Format, Restbit) */
  codewordAt: number[][];
  /** Anteil der genutzten Datenkapazität (0–1) */
  fill: number;
}

export interface EncodeOptions {
  ecl?: Ecl;
  minVersion?: number;
  /** feste Maske 0–7; ohne Angabe wird die beste gewählt */
  mask?: number;
}

export function encodeText(text: string, options: EncodeOptions = {}): QrCode {
  const ecl = options.ecl ?? "M";
  const seg = makeSegment(text);

  let version = -1;
  for (let ver = Math.max(MIN_VERSION, options.minVersion ?? 1); ver <= MAX_VERSION; ver++) {
    if (segmentTotalBits(seg, ver) <= numDataCodewords(ver, ecl) * 8) {
      version = ver;
      break;
    }
  }
  if (version < 0) {
    const maxBytes = numDataCodewords(MAX_VERSION, ecl) - 3;
    throw new Error(
      `Inhalt zu lang für einen QR-Code mit Fehlerkorrektur ${ecl} (max. ca. ${maxBytes} Bytes). Text kürzen oder niedrigere Fehlerkorrektur wählen.`,
    );
  }

  const data = encodeDataCodewords(seg, version, ecl);
  const codewords = addEccAndInterleave(data, version, ecl);

  const matrix = new Matrix(version);
  matrix.drawFunctionPatterns(ecl);
  matrix.drawCodewords(codewords);

  let mask = options.mask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let candidate = 0; candidate < 8; candidate++) {
      matrix.applyMask(candidate);
      matrix.drawFormat(ecl, candidate);
      const score = matrix.penalty();
      if (score < best) {
        best = score;
        mask = candidate;
      }
      matrix.applyMask(candidate); // XOR – zweimal anwenden hebt die Maske wieder auf
    }
  }
  matrix.applyMask(mask);
  matrix.drawFormat(ecl, mask);

  const usedBits = segmentTotalBits(seg, version);
  return {
    version,
    ecl,
    mask,
    mode: seg.mode,
    size: matrix.size,
    modules: matrix.modules,
    codewordAt: matrix.codewordAt,
    fill: usedBits / (numDataCodewords(version, ecl) * 8),
  };
}
