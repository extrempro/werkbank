/**
 * Bilder als PDF: je Bild eine Seite, das Bild als JPEG eingebettet (DCTDecode).
 * Ohne Zusatzpaket, die Datei entsteht vollständig im Browser.
 */

export type PdfPageSize = "a4" | "bild";

export const pdfPageSizeLabels: Record<PdfPageSize, string> = {
  a4: "A4",
  bild: "Wie das Bild",
};

/** Maße in Punkt (1/72 Zoll). */
export interface PageLayout {
  pageWidth: number;
  pageHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfPage extends PageLayout {
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
}

const A4_SHORT = 595.28;
const A4_LONG = 841.89;
/** 10 mm Rand auf A4 */
const MARGIN = 28.35;
/** Bildschirm-Pixel in Punkt (96 dpi) */
const PX_TO_PT = 0.75;
/** Größte Seite, die PDF-Leser zuverlässig öffnen (200 Zoll) */
const MAX_PAGE = 14400;

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Lage des Bilds auf der Seite. A4: Ausrichtung nach dem Bild, eingepasst mit Rand,
 * nie größer als bei 96 dpi. „So groß wie das Bild“: Seite in Bildgröße bei 96 dpi.
 */
export function pageLayout(pixelWidth: number, pixelHeight: number, size: PdfPageSize): PageLayout {
  const naturalWidth = pixelWidth * PX_TO_PT;
  const naturalHeight = pixelHeight * PX_TO_PT;
  if (size === "bild") {
    const scale = Math.min(1, MAX_PAGE / naturalWidth, MAX_PAGE / naturalHeight);
    const width = round(Math.max(1, naturalWidth * scale));
    const height = round(Math.max(1, naturalHeight * scale));
    return { pageWidth: width, pageHeight: height, x: 0, y: 0, width, height };
  }
  const landscape = pixelWidth > pixelHeight;
  const pageWidth = landscape ? A4_LONG : A4_SHORT;
  const pageHeight = landscape ? A4_SHORT : A4_LONG;
  const scale = Math.min(
    1,
    (pageWidth - 2 * MARGIN) / naturalWidth,
    (pageHeight - 2 * MARGIN) / naturalHeight,
  );
  const width = round(naturalWidth * scale);
  const height = round(naturalHeight * scale);
  return {
    pageWidth,
    pageHeight,
    x: round((pageWidth - width) / 2),
    y: round((pageHeight - height) / 2),
    width,
    height,
  };
}

/** Setzt die PDF-Datei aus den Seiten zusammen (PDF 1.4, ein Bild je Seite). */
export function buildPdf(pages: PdfPage[]): Uint8Array {
  if (pages.length === 0) throw new Error("Keine Seiten für die PDF.");
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, body: string, stream?: Uint8Array) => {
    offsets[id] = length;
    push(`${id} 0 obj\n${body}\n`);
    if (stream) {
      push("stream\n");
      push(stream);
      push("\nendstream\n");
    }
    push("endobj\n");
  };

  // Kopf mit Binärzeile, damit Programme die Datei nicht als Text behandeln
  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  // 1 Katalog, 2 Seitenbaum, 3 Angaben, danach je Seite: Seite, Inhalt, Bild
  const pageId = (index: number) => 4 + index * 3;
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(
    2,
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${pageId(index)} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  );
  object(3, "<< /Producer (Werkbank) >>");
  pages.forEach((page, index) => {
    const id = pageId(index);
    const content = encoder.encode(
      `q ${page.width} 0 0 ${page.height} ${page.x} ${page.y} cm /Bild Do Q\n`,
    );
    object(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.pageWidth} ${page.pageHeight}] ` +
        `/Resources << /XObject << /Bild ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`,
    );
    object(id + 1, `<< /Length ${content.length} >>`, content);
    object(
      id + 2,
      `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>`,
      page.jpeg,
    );
  });

  const count = pageId(pages.length);
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id++) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) {
    out.set(chunk, position);
    position += chunk.length;
  }
  return out;
}

/**
 * „1-3, 5“ → [1, 2, 3, 5]. Leer heißt alle Seiten. Gibt null zurück, wenn die Eingabe
 * nicht passt oder eine Seite fehlt.
 */
export function parsePageRange(text: string, pageCount: number): number[] | null {
  const trimmed = text.trim();
  if (trimmed === "") return Array.from({ length: pageCount }, (_, index) => index + 1);
  const pages = new Set<number>();
  for (const part of trimmed.split(",")) {
    const match = /^\s*(\d{1,5})\s*(?:[-–]\s*(\d{1,5})\s*)?$/.exec(part);
    if (!match) return null;
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    if (from < 1 || to < from || to > pageCount) return null;
    for (let page = from; page <= to; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}
