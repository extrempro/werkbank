/**
 * PDF-Seiten als Bild: pdf.js zeichnet die Seiten im Browser. Die Bibliothek wird erst
 * geladen, wenn jemand eine PDF öffnet. Schriften, CMaps und WebAssembly-Dekoder liegen
 * unter /pdfjs/ (siehe vite.config.ts).
 */

import type { PDFDocumentProxy } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");

let library: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  library ??= Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]).then(([module, worker]) => {
    module.GlobalWorkerOptions.workerSrc = worker.default;
    return module;
  });
  return library;
}

/** Auflösungen für PDF-Seiten in dpi */
export const PDF_DPI = [72, 150, 300] as const;
/** Längste Seite eines gezeichneten Bilds in Pixeln */
const MAX_SIDE = 10000;
/** Höchstens so viele Pixel je Seite (40 Megapixel) */
const MAX_PIXELS = 40_000_000;
export const MAX_PDF_PAGES = 500;

export interface OpenedPdf {
  pages: number;
  /** Größe der ersten Seite in Punkt */
  width: number;
  height: number;
  document: PDFDocumentProxy;
  /** Gibt Speicher und Worker wieder frei. */
  close: () => void;
}

export async function openPdf(file: Blob): Promise<OpenedPdf> {
  const module = await pdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = module.getDocument({
    data,
    cMapUrl: "/pdfjs/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    enableXfa: false,
  });
  const close = () => void task.destroy();
  let document: PDFDocumentProxy;
  try {
    document = await task.promise;
  } catch (caught) {
    close();
    if (caught instanceof module.PasswordException) {
      throw new Error("Die PDF ist mit einem Kennwort geschützt und lässt sich nicht öffnen.", {
        cause: caught,
      });
    }
    throw new Error("Die Datei ist beschädigt oder keine gültige PDF.", { cause: caught });
  }
  if (document.numPages > MAX_PDF_PAGES) {
    close();
    throw new Error(`Die PDF hat ${document.numPages} Seiten, höchstens ${MAX_PDF_PAGES} gehen.`);
  }
  const first = await document.getPage(1);
  const viewport = first.getViewport({ scale: 1 });
  first.cleanup();
  return {
    pages: document.numPages,
    width: viewport.width,
    height: viewport.height,
    document,
    close,
  };
}

/** Maßstab für eine Seite: gewünschte dpi, aber nie über die Grenzen des Browsers. */
export function renderScale(width: number, height: number, dpi: number): number {
  const scale = dpi / 72;
  const bySide = MAX_SIDE / Math.max(width, height);
  const byArea = Math.sqrt(MAX_PIXELS / (width * height));
  return Math.max(0.01, Math.min(scale, bySide, byArea));
}

/** Zeichnet eine Seite (ab 1) auf weißem Grund. */
export async function renderPage(
  document: PDFDocumentProxy,
  number: number,
  dpi: number,
): Promise<HTMLCanvasElement> {
  const page = await document.getPage(number);
  try {
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: renderScale(base.width, base.height, dpi) });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    await page.render({ canvas, viewport, background: "#ffffff" }).promise;
    return canvas;
  } finally {
    page.cleanup();
  }
}
