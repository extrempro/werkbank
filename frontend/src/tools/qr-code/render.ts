import { blockLayout, eclInfo, encodeText, MAX_VERSION, type Ecl, type QrCode } from "./qr";

/** Inhalt der freigestellten Mitte: Kürzel oder Logo (als data:-URL) */
export type Center =
  { kind: "text"; text: string } | { kind: "image"; href: string; width?: number; height?: number };

export interface RenderOptions {
  /** Ruhezone in Modulen (Norm: mindestens 4) */
  margin: number;
  foreground: string;
  background: string;
  center?: Center | null;
  /** Kantenlänge der Mitte in Prozent der Code-Breite */
  centerPercent?: number;
  /** Breite des Kürzels bei Schriftgröße 1 (im Browser gemessen); ohne Angabe wird geschätzt */
  textWidth?: number;
}

// ---------- Mitte (Logo oder Kürzel) ----------

export const CENTER_MIN = 15;
export const CENTER_MAX = 30;
export const CENTER_FONT = "Arial, Helvetica, sans-serif";

/**
 * Wie viele Module die Mitte überdeckt: die größte ungerade Zahl, die in den gewünschten Anteil passt.
 * Ungerade, damit sie exakt mittig sitzt (QR-Codes haben eine ungerade Kantenlänge); abgerundet,
 * damit kleine Codes nicht mehr verlieren, als die Fehlerkorrektur ausgleicht.
 */
export function centerModules(size: number, percent: number): number {
  const p = Math.min(CENTER_MAX, Math.max(CENTER_MIN, percent));
  const k = Math.floor((size * p) / 100);
  return Math.max(3, k % 2 === 0 ? k - 1 : k);
}

/** Module unter der Mitte entfernen – dort steht später das Logo auf dem Hintergrund */
export function clearCenter(modules: boolean[][], k: number): boolean[][] {
  const from = (modules.length - k) / 2;
  return modules.map((row, y) =>
    y < from || y >= from + k
      ? row
      : row.map((dark, x) => (x >= from && x < from + k ? false : dark)),
  );
}

/** Mit einer überdeckten Mitte muss die Fehlerkorrektur die fehlenden Module ausgleichen: mindestens Q */
export function eclForCenter(ecl: Ecl, active: boolean): Ecl {
  return active && eclInfo[ecl].index < eclInfo.Q.index ? "Q" : ecl;
}

/**
 * Wie stark belastet die Mitte die Fehlerkorrektur? Gezählt wird je Fehlerkorrektur-Block, wie viele
 * Codewörter unter der Mitte liegen – im ungünstigsten Fall ist jedes davon falsch.
 * `load` = Anteil der verkraftbaren Fehler im am stärksten betroffenen Block (1 = Grenze, darüber nicht mehr lesbar).
 */
export function centerLoad(qr: QrCode, k: number): number {
  const { blockOf, blocks, correctable } = blockLayout(qr.version, qr.ecl);
  const from = (qr.size - k) / 2;
  const hit = new Set<number>();
  for (let y = from; y < from + k; y++)
    for (let x = from; x < from + k; x++) {
      const cw = qr.codewordAt[y]![x]!;
      if (cw >= 0) hit.add(cw);
    }
  const perBlock = new Array<number>(blocks).fill(0);
  for (const cw of hit) perBlock[blockOf[cw]!]!++;
  return Math.max(...perBlock) / correctable;
}

/** So viel der Fehlerkorrektur darf die Mitte höchstens verbrauchen – der Rest bleibt für Druck, Knicke und schlechte Kameras */
export const CENTER_LOAD_MAX = 0.6;

/**
 * Code für eine überdeckte Mitte erzeugen: Fehlerkorrektur mindestens Q und – falls die Mitte trotzdem
 * zu viel verdeckt (vor allem bei sehr kurzen Inhalten) – eine höhere Stufe oder ein größerer Code.
 * `safe` = false: Auch der größte geprüfte Code reicht nicht; die Mitte sollte kleiner werden.
 */
export function encodeForCenter(
  text: string,
  ecl: Ecl,
  percent: number,
): { qr: QrCode; load: number; safe: boolean } {
  const levels: Ecl[] =
    eclInfo[ecl].index >= eclInfo.H.index ? ["H"] : [eclForCenter(ecl, true), "H"];
  let fallback: { qr: QrCode; load: number } | null = null;
  let firstError: unknown = null;
  for (let extra = 0; extra <= 6; extra++) {
    for (const level of levels) {
      let qr: QrCode;
      try {
        const natural = encodeText(text, { ecl: level });
        qr =
          extra === 0
            ? natural
            : natural.version + extra > MAX_VERSION
              ? natural
              : encodeText(text, { ecl: level, minVersion: natural.version + extra });
      } catch (e) {
        firstError ??= e;
        continue;
      }
      const load = centerLoad(qr, centerModules(qr.size, percent));
      if (load <= CENTER_LOAD_MAX) return { qr, load, safe: true };
      if (!fallback || load < fallback.load) fallback = { qr, load };
    }
  }
  if (!fallback) throw firstError ?? new Error("QR-Code konnte nicht erzeugt werden");
  return { ...fallback, safe: false };
}

export interface CenterLayout {
  /** überdeckte Module und linke obere Ecke (in Modulen, inkl. Rand) */
  k: number;
  x: number;
  y: number;
  /** nutzbare Fläche mit einem halben Modul Abstand zum Code */
  inner: { x: number; y: number; size: number };
  /** Anteil der überdeckten Fläche am Code (0–1) */
  coverage: number;
  text?: { value: string; x: number; y: number; fontSize: number };
  image?: { href: string; x: number; y: number; width: number; height: number };
}

export function centerLayout(qr: QrCode, o: RenderOptions): CenterLayout | null {
  const c = o.center;
  if (!c || (c.kind === "text" && !c.text.trim()) || (c.kind === "image" && !c.href)) return null;
  const k = centerModules(qr.size, o.centerPercent ?? 22);
  const x = o.margin + (qr.size - k) / 2;
  const inner = { x: x + 0.5, y: x + 0.5, size: k - 1 };
  const layout: CenterLayout = { k, x, y: x, inner, coverage: (k * k) / (qr.size * qr.size) };
  const mid = x + k / 2;
  if (c.kind === "text") {
    const value = [...c.text.trim()].slice(0, 3).join("");
    // fette Großbuchstaben sind etwa 0,72 em breit; im Browser wird genau gemessen
    const width = o.textWidth && o.textWidth > 0 ? o.textWidth : [...value].length * 0.72;
    const fontSize = Math.min(inner.size * 0.8, (inner.size * 0.96) / width);
    // Grundlinie so, dass Großbuchstaben (ca. 0,72 em hoch) mittig stehen
    layout.text = { value, x: mid, y: mid + fontSize * 0.36, fontSize };
  } else {
    const ratio = c.width && c.height ? c.width / c.height : 1;
    const width = ratio >= 1 ? inner.size : inner.size * ratio;
    const height = ratio >= 1 ? inner.size / ratio : inner.size;
    layout.image = { href: c.href, x: mid - width / 2, y: mid - height / 2, width, height };
  }
  return layout;
}

const xml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!,
  );
const r = (n: number) => Math.round(n * 1000) / 1000;

/** SVG-Pfad aller dunklen Module, zeilenweise zu Rechtecken zusammengefasst. */
export function svgPath(modules: boolean[][], margin: number): string {
  const parts: string[] = [];
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length;) {
      if (!row[x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < row.length && row[x + run]) run++;
      parts.push(`M${x + margin} ${y + margin}h${run}v1h-${run}z`);
      x += run;
    }
  });
  return parts.join("");
}

export function svgMarkup(qr: QrCode, o: RenderOptions): string {
  const dim = qr.size + o.margin * 2;
  const c = centerLayout(qr, o);
  const modules = c ? clearCenter(qr.modules, c.k) : qr.modules;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim * 8}" height="${dim * 8}">`,
    `<rect width="${dim}" height="${dim}" fill="${o.background}"/>`,
    `<path d="${svgPath(modules, o.margin)}" fill="${o.foreground}" shape-rendering="crispEdges"/>`,
    c?.text
      ? `<text x="${r(c.text.x)}" y="${r(c.text.y)}" font-family="${CENTER_FONT}" font-weight="700" font-size="${r(c.text.fontSize)}" text-anchor="middle" fill="${o.foreground}">${xml(c.text.value)}</text>`
      : "",
    c?.image
      ? `<image href="${xml(c.image.href)}" x="${r(c.image.x)}" y="${r(c.image.y)}" width="${r(c.image.width)}" height="${r(c.image.height)}" preserveAspectRatio="xMidYMid meet"/>`
      : "",
    `</svg>`,
  ].join("");
}

/** Ganzzahlige Pixel pro Modul, damit die Kanten scharf bleiben. */
export function pngScale(
  qr: QrCode,
  margin: number,
  targetPx: number,
): { scale: number; px: number } {
  const dim = qr.size + margin * 2;
  const scale = Math.max(1, Math.round(targetPx / dim));
  return { scale, px: scale * dim };
}

const loadImage = (href: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Das Logo konnte nicht gelesen werden"));
    img.src = href;
  });

export async function pngBlob(qr: QrCode, o: RenderOptions, targetPx: number): Promise<Blob> {
  const { scale, px } = pngScale(qr, o.margin, targetPx);
  const canvas = document.createElement("canvas");
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas wird nicht unterstützt");
  const c = centerLayout(qr, o);
  const modules = c ? clearCenter(qr.modules, c.k) : qr.modules;
  ctx.fillStyle = o.background;
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = o.foreground;
  modules.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) ctx.fillRect((x + o.margin) * scale, (y + o.margin) * scale, scale, scale);
    }),
  );
  if (c?.text) {
    ctx.font = `700 ${c.text.fontSize * scale}px ${CENTER_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(c.text.value, c.text.x * scale, c.text.y * scale);
  }
  if (c?.image) {
    const img = await loadImage(c.image.href);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      img,
      c.image.x * scale,
      c.image.y * scale,
      c.image.width * scale,
      c.image.height * scale,
    );
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG konnte nicht erzeugt werden"))),
      "image/png",
    ),
  );
}

// ---------- Kontrast ----------

function luminance(hex: string): number | null {
  const m = hex.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** Hinweise zur Lesbarkeit der gewählten Farben */
export function colorWarnings(foreground: string, background: string): string[] {
  const fg = luminance(foreground);
  const bg = luminance(background);
  if (fg === null || bg === null) return [];
  const warnings: string[] = [];
  const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  if (ratio < 4)
    warnings.push(
      `Geringer Kontrast (${ratio.toFixed(1)} : 1) – manche Scanner lesen den Code dann nicht.`,
    );
  if (fg > bg)
    warnings.push(
      "Heller Code auf dunklem Grund: Viele ältere Scanner können invertierte QR-Codes nicht lesen.",
    );
  return warnings;
}
