/** Bildformate: Erkennung anhand der Dateisignatur, Bezeichnungen, Dateinamen. */

export type InputFormat = "png" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "svg" | "avif" | "heic" | "tiff" | "unknown";

export type OutputFormat = "png" | "jpeg" | "webp" | "avif" | "ico" | "svg" | "favicon";

export const inputLabels: Record<InputFormat, string> = {
  png: "PNG",
  jpeg: "JPEG",
  gif: "GIF",
  webp: "WebP",
  bmp: "BMP",
  ico: "ICO",
  svg: "SVG",
  avif: "AVIF",
  heic: "HEIC",
  tiff: "TIFF",
  unknown: "unbekannt",
};

export interface OutputInfo {
  label: string;
  extension: string;
  mime: string;
  /** Qualitätsregler sinnvoll */
  lossy: boolean;
  /** unterstützt Transparenz */
  alpha: boolean;
  hint: string;
}

export const outputInfo: Record<OutputFormat, OutputInfo> = {
  png: { label: "PNG", extension: "png", mime: "image/png", lossy: false, alpha: true, hint: "verlustfrei, mit Transparenz – für Screenshots, Grafiken, Logos" },
  jpeg: { label: "JPEG", extension: "jpg", mime: "image/jpeg", lossy: true, alpha: false, hint: "kleine Dateien für Fotos – ohne Transparenz" },
  webp: { label: "WebP", extension: "webp", mime: "image/webp", lossy: true, alpha: true, hint: "modern, deutlich kleiner als JPEG/PNG, mit Transparenz" },
  avif: { label: "AVIF", extension: "avif", mime: "image/avif", lossy: true, alpha: true, hint: "sehr kleine Dateien – Export nicht in jedem Browser verfügbar" },
  ico: { label: "ICO", extension: "ico", mime: "image/x-icon", lossy: false, alpha: true, hint: "Windows-Symbol / Favicon mit mehreren Größen in einer Datei" },
  svg: { label: "SVG (eingebettet)", extension: "svg", mime: "image/svg+xml", lossy: false, alpha: true, hint: "Rasterbild in einer SVG-Hülle – wird dadurch nicht zur Vektorgrafik" },
  favicon: { label: "Favicon-Paket (ZIP)", extension: "zip", mime: "application/zip", lossy: false, alpha: true, hint: "favicon.ico, apple-touch-icon, Android-Symbole und HTML-Schnipsel" },
};

const startsWith = (b: Uint8Array, sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);
const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));

/** Erkennt das Format an den ersten Bytes (unabhängig von der Dateiendung). */
export function detectFormat(bytes: Uint8Array): InputFormat {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a") return "gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  if (ascii(bytes, 0, 2) === "BM") return "bmp";
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00]) || startsWith(bytes, [0x00, 0x00, 0x02, 0x00])) return "ico";
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return "tiff";
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brands = ascii(bytes, 8, Math.min(bytes.length, 64));
    if (/avi[fs]/.test(brands)) return "avif";
    if (/hei[cxms]|hev[cx]|mif1|msf1/.test(brands)) return "heic";
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 1024)).replace(/^\uFEFF/, "").trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) return "svg";
  return "unknown";
}

/** foto.heic → foto.webp; doppelte Namen bekommen -2, -3 … */
export function outputName(original: string, extension: string, taken: Set<string>): string {
  const base = original.replace(/\.[^./\\]+$/, "") || "bild";
  let name = `${base}.${extension}`;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base}-${i}.${extension}`;
  taken.add(name.toLowerCase());
  return name;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toLocaleString("de-DE", { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[u]}`;
}

/** „−63 %“ / „+12 %“ */
export function sizeChange(before: number, after: number): string {
  if (before === 0) return "";
  if (after >= before * 10) return `×${Math.round(after / before)}`;
  const pct = Math.round(((after - before) / before) * 100);
  return pct === 0 ? "±0 %" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)} %`;
}
