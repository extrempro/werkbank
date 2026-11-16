/** Zielgröße berechnen – Seitenverhältnis bleibt immer erhalten. */

export type ResizeMode = "original" | "width" | "height" | "longest" | "percent";

export interface ResizeOptions {
  mode: ResizeMode;
  /** Pixel bzw. Prozent je nach Modus */
  value: number;
  /** kleinere Bilder nicht vergrößern */
  noUpscale: boolean;
}

export const resizeLabels: Record<ResizeMode, string> = {
  original: "Originalgröße",
  width: "Breite (px)",
  height: "Höhe (px)",
  longest: "Längste Seite (px)",
  percent: "Prozent",
};

export const MAX_DIMENSION = 16384;

export function targetSize(width: number, height: number, o: ResizeOptions): { width: number; height: number } {
  if (width <= 0 || height <= 0) throw new Error("Bild hat keine gültige Größe");
  let factor = 1;
  const v = Number.isFinite(o.value) && o.value > 0 ? o.value : 0;
  switch (o.mode) {
    case "width":
      factor = v ? v / width : 1;
      break;
    case "height":
      factor = v ? v / height : 1;
      break;
    case "longest":
      factor = v ? v / Math.max(width, height) : 1;
      break;
    case "percent":
      factor = v ? v / 100 : 1;
      break;
  }
  if (o.noUpscale) factor = Math.min(factor, 1);
  // Browser-Canvas sind auf etwa 16384 px je Seite begrenzt
  factor = Math.min(factor, MAX_DIMENSION / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  };
}

/** Bild mittig in ein Quadrat einpassen (für Symbole) */
export function fitSquare(width: number, height: number, size: number): { x: number; y: number; width: number; height: number } {
  const scale = size / Math.max(width, height);
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return { x: Math.floor((size - w) / 2), y: Math.floor((size - h) / 2), width: w, height: h };
}
