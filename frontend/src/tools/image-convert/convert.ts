/** Umwandlung im Browser: Dekodieren, Skalieren und Kodieren über Canvas. Nichts verlässt den Rechner. */

import {
  detectFormat,
  inputLabels,
  outputInfo,
  type InputFormat,
  type OutputFormat,
} from "./formats";
import { buildIco } from "./ico";
import { fitSquare, targetSize, type ResizeOptions } from "./resize";
import { bytesToBase64, embedRasterInSvg, svgIntrinsicSize } from "./svg";
import { createZip, type ZipEntry } from "./zip";

export interface ConvertSettings {
  format: OutputFormat;
  /** 1–100, nur für JPEG/WebP/AVIF */
  quality: number;
  resize: ResizeOptions;
  /** Hintergrundfarbe für Formate ohne Transparenz (JPEG) und das Apple-Touch-Icon */
  background: string;
  icoSizes: number[];
}

export interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  format: InputFormat;
  release: () => void;
}

export interface ConvertResult {
  blob: Blob;
  extension: string;
  width: number;
  height: number;
  notes: string[];
}

// ---------- Unterstützung erkennen ----------

/** Welche Formate kann dieser Browser per Canvas erzeugen? (Chrome/Firefox: WebP ja; AVIF meist nein) */
export async function detectEncoders(): Promise<Set<OutputFormat>> {
  const supported = new Set<OutputFormat>(["png", "jpeg", "ico", "svg", "favicon"]);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 2;
  for (const f of ["webp", "avif"] as const) {
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, outputInfo[f].mime, 0.8));
    if (blob?.type === outputInfo[f].mime) supported.add(f);
  }
  return supported;
}

// ---------- Laden ----------

function loadViaImgElement(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.src = url;
  return img.decode().then(() => img);
}

/** Datei als data:-Adresse lesen (für Vorschau und Laden im <img>). */
export function dataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Die Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

export async function loadImage(file: Blob): Promise<LoadedImage> {
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  const format = detectFormat(head);

  if (format === "svg") {
    // SVG im <img> rendern: Skripte und externe Inhalte werden dabei vom Browser blockiert
    const text = await file.text();
    const size = svgIntrinsicSize(text);
    // als data:-Adresse, weil die Sicherheitsrichtlinie der Werkbank keine blob:-Bilder erlaubt
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
    try {
      const img = await loadViaImgElement(url);
      return {
        source: img,
        width: size.width,
        height: size.height,
        format,
        release: () => undefined,
      };
    } catch {
      throw new Error("SVG konnte nicht dargestellt werden (fehlerhafte Datei?)");
    }
  }

  try {
    // berücksichtigt die EXIF-Ausrichtung von Handyfotos
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      format,
      release: () => bitmap.close(),
    };
  } catch {
    // Fallback: manche Formate (z. B. HEIC in Safari) kann nur das <img>-Element
    try {
      const img = await loadViaImgElement(await dataUrl(file));
      return {
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        format,
        release: () => undefined,
      };
    } catch {
      if (format === "heic") {
        throw new Error(
          "HEIC (iPhone-Foto) kann nur Safari lesen. Tipp: in Safari öffnen oder am iPhone „Kompatibelste“ als Kameraformat wählen.",
        );
      }
      if (format === "tiff") throw new Error("TIFF kann nur Safari lesen.");
      if (format === "unknown") throw new Error("Unbekanntes Dateiformat – keine Bilddatei?");
      if (format === "avif")
        throw new Error("AVIF kann dieser Browser nicht lesen (oder die Datei ist beschädigt).");
      // PNG, JPEG, GIF, WebP, BMP, ICO kann jeder aktuelle Browser – dann ist die Datei kaputt
      throw new Error(
        `Die Datei ist beschädigt oder unvollständig (kein gültiges ${inputLabels[format]}).`,
      );
    }
  }
}

// ---------- Zeichnen & Kodieren ----------

function createCanvas(
  width: number,
  height: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas wird von diesem Browser nicht unterstützt");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

/** Schrittweise halbieren, damit starkes Verkleinern nicht „krisselig“ wird */
function drawScaled(img: LoadedImage, width: number, height: number): HTMLCanvasElement {
  let source: CanvasImageSource = img.source;
  let w = img.width;
  let h = img.height;
  if (img.format !== "svg") {
    while (w / 2 >= width && h / 2 >= height && w > 2 && h > 2) {
      const step = createCanvas(Math.round(w / 2), Math.round(h / 2));
      step.ctx.drawImage(source, 0, 0, step.canvas.width, step.canvas.height);
      source = step.canvas;
      w = step.canvas.width;
      h = step.canvas.height;
    }
  }
  const { canvas, ctx } = createCanvas(width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < data.length; i += 4) if (data[i]! < 255) return true;
  return false;
}

function fillBackground(canvas: HTMLCanvasElement, color: string) {
  const ctx = canvas.getContext("2d")!;
  ctx.save();
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Bild konnte nicht erzeugt werden (zu groß für den Browser?)"));
        else if (blob.type !== mime)
          reject(
            new Error(
              `Dieser Browser kann kein ${mime.replace("image/", "").toUpperCase()} erzeugen.`,
            ),
          );
        else resolve(blob);
      },
      mime,
      quality,
    ),
  );
}

async function pngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Uint8Array(await (await canvasToBlob(canvas, "image/png")).arrayBuffer());
}

function squareIcon(img: LoadedImage, size: number, background?: string): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(size, size);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
  }
  const fit = fitSquare(img.width, img.height, size);
  const scaled = drawScaled(img, fit.width, fit.height);
  ctx.drawImage(scaled, fit.x, fit.y);
  return canvas;
}

// ---------- Umwandeln ----------

export async function convertImage(
  img: LoadedImage,
  s: ConvertSettings,
  original?: Blob,
): Promise<ConvertResult> {
  const notes: string[] = [];
  if (img.format === "gif") notes.push("Bei animierten GIFs wird nur das erste Bild übernommen.");

  if (s.format === "ico") {
    const sizes = [...s.icoSizes].sort((a, b) => a - b);
    if (img.width !== img.height)
      notes.push("Nicht quadratisch – mittig eingepasst, Ränder transparent.");
    const images = await Promise.all(
      sizes.map(async (size) => ({ size, png: await pngBytes(squareIcon(img, size)) })),
    );
    return {
      blob: new Blob([buildIco(images) as BlobPart], { type: "image/x-icon" }),
      extension: "ico",
      width: sizes.at(-1)!,
      height: sizes.at(-1)!,
      notes,
    };
  }

  if (s.format === "favicon") {
    return faviconPackage(img, s, original, notes);
  }

  const { width, height } = targetSize(img.width, img.height, s.resize);
  const canvas = drawScaled(img, width, height);
  const info = outputInfo[s.format];

  if (s.format === "svg") {
    const png = await pngBytes(canvas);
    const svg = embedRasterInSvg(bytesToBase64(png), width, height);
    return {
      blob: new Blob([svg], { type: "image/svg+xml" }),
      extension: "svg",
      width,
      height,
      notes,
    };
  }

  if (!info.alpha && hasTransparency(canvas)) {
    fillBackground(canvas, s.background);
    notes.push(
      `Transparente Bereiche mit ${s.background.toUpperCase()} gefüllt (${info.label} kennt keine Transparenz).`,
    );
  }
  const blob = await canvasToBlob(
    canvas,
    info.mime,
    info.lossy ? Math.min(1, Math.max(0.01, s.quality / 100)) : undefined,
  );
  return { blob, extension: info.extension, width, height, notes };
}

async function faviconPackage(
  img: LoadedImage,
  s: ConvertSettings,
  original: Blob | undefined,
  notes: string[],
): Promise<ConvertResult> {
  if (Math.min(img.width, img.height) < 512 && img.format !== "svg") {
    notes.push(
      `Vorlage nur ${img.width} × ${img.height} px – für scharfe Symbole mindestens 512 × 512 px oder SVG verwenden.`,
    );
  }
  const date = new Date();
  const entries: ZipEntry[] = [];
  const add = (name: string, data: Uint8Array) => entries.push({ name, data, date });

  const icoImages = await Promise.all(
    [16, 32, 48].map(async (size) => ({ size, png: await pngBytes(squareIcon(img, size)) })),
  );
  add("favicon.ico", buildIco(icoImages));
  add("favicon-32x32.png", icoImages.find((i) => i.size === 32)!.png);
  add("apple-touch-icon.png", await pngBytes(squareIcon(img, 180, s.background))); // iOS: ohne Transparenz
  add("icon-192.png", await pngBytes(squareIcon(img, 192)));
  add("icon-512.png", await pngBytes(squareIcon(img, 512)));
  if (img.format === "svg" && original)
    add("icon.svg", new Uint8Array(await original.arrayBuffer()));

  const manifest = {
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
  add("site.webmanifest", new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`));
  const html = [
    '<link rel="icon" href="/favicon.ico" sizes="32x32">',
    ...(img.format === "svg" ? ['<link rel="icon" href="/icon.svg" type="image/svg+xml">'] : []),
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    '<link rel="manifest" href="/site.webmanifest">',
  ].join("\n");
  add(
    "einbinden.html",
    new TextEncoder().encode(`<!-- In den <head> der Seite einfügen -->\n${html}\n`),
  );

  notes.push(`${entries.length} Dateien: ${entries.map((e) => e.name).join(", ")}`);
  return {
    blob: new Blob([createZip(entries) as BlobPart], { type: "application/zip" }),
    extension: "zip",
    width: 512,
    height: 512,
    notes,
  };
}
