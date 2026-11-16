/** Hilfen für SVG als Eingabe (Rastern) und als Ausgabe (eingebettetes Rasterbild). */

const DEFAULT_SIZE = 1024;

function parseLength(value: string | undefined): number | null {
  if (!value) return null;
  const m = value.trim().match(/^([\d.]+)\s*(px|pt|mm|cm|in)?$/i);
  if (!m) return null; // Prozentangaben u. Ä. ignorieren
  const n = Number(m[1]);
  const factor: Record<string, number> = { px: 1, pt: 96 / 72, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };
  return n > 0 ? n * factor[(m[2] ?? "px").toLowerCase()]! : null;
}

/**
 * Eigengröße einer SVG-Datei aus width/height bzw. viewBox.
 * Ohne Angaben: 1024 px an der längeren Seite.
 */
export function svgIntrinsicSize(text: string): { width: number; height: number; fromViewBox: boolean } {
  const tag = text.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const attr = (name: string) => tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
  const w = parseLength(attr("width"));
  const h = parseLength(attr("height"));
  const vb = attr("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const vbW = vb && vb.length === 4 && vb[2]! > 0 ? vb[2]! : null;
  const vbH = vb && vb.length === 4 && vb[3]! > 0 ? vb[3]! : null;

  if (w && h) return { width: Math.round(w), height: Math.round(h), fromViewBox: false };
  if (w && vbW && vbH) return { width: Math.round(w), height: Math.round((w * vbH) / vbW), fromViewBox: false };
  if (h && vbW && vbH) return { width: Math.round((h * vbW) / vbH), height: Math.round(h), fromViewBox: false };
  if (vbW && vbH) {
    // viewBox-Einheiten sind oft winzig (z. B. 24 × 24) – auf eine brauchbare Größe hochrechnen
    const scale = Math.max(1, DEFAULT_SIZE / Math.max(vbW, vbH));
    return { width: Math.round(vbW * scale), height: Math.round(vbH * scale), fromViewBox: true };
  }
  return { width: DEFAULT_SIZE, height: DEFAULT_SIZE, fromViewBox: true };
}

/** Rasterbild (PNG) in eine SVG-Hülle einbetten */
export function embedRasterInSvg(pngBase64: string, width: number, height: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<image width="${width}" height="${height}" href="data:image/png;base64,${pngBase64}"/>` +
    `</svg>`
  );
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
