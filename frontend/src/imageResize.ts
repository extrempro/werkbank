/**
 * Bilder für das Branding schon im Browser passend machen: verkleinern, Favicon quadratisch
 * setzen, JPEG in PNG wandeln. So muss niemand vorher ein Bildprogramm bemühen. Der Server
 * prüft das Ergebnis trotzdem (Format, Größe, Abmessungen).
 */

export type ImageKind = "logo" | "favicon";
/** „auto“ passt zu große Bilder an, „original“ lässt das Bild, wie es ist. */
export type ResizeMode = "auto" | "original";

export interface Size {
  width: number;
  height: number;
}

/** Längste Kante eines Logos nach dem Verkleinern: reicht für scharfe Anzeige überall. */
export const LOGO_TARGET = 800;
/** Grenzen des Servers für Logos. */
export const LOGO_MIN = 16;
export const LOGO_MAX = 2000;
export const FAVICON_TARGET = 256;
export const FAVICON_MIN = 32;
export const FAVICON_MAX = 512;

export const INPUT_TYPES = ["image/png", "image/webp", "image/jpeg"];

export interface Plan {
  /** Größe der Zeichenfläche. */
  canvas: Size;
  /** Größe, in der das Bild mittig darauf gezeichnet wird. */
  image: Size;
  /** Das Bild muss neu gezeichnet werden (statt die Datei unverändert zu schicken). */
  redraw: boolean;
}

function fit(size: Size, longest: number): Size {
  const scale = Math.min(1, longest / Math.max(size.width, size.height));
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/**
 * Legt fest, wie ein Bild gezeichnet wird. Vergrößert wird nie.
 * Logo: längste Kante höchstens `longest`. Favicon: quadratisch, Bild mittig, Rest durchsichtig.
 */
export function planResize(source: Size, kind: ImageKind, longest?: number): Plan {
  if (kind === "favicon") {
    const side = Math.min(longest ?? FAVICON_TARGET, Math.max(source.width, source.height));
    const image = fit(source, side);
    const square = source.width === source.height;
    return {
      canvas: { width: side, height: side },
      image,
      redraw: !square || side !== source.width,
    };
  }
  const image = fit(source, longest ?? LOGO_TARGET);
  return { canvas: image, image, redraw: image.width !== source.width };
}

/** Grund, warum ein Bild auch nach dem Anpassen nicht passt, sonst null. */
export function sizeProblem(size: Size, kind: ImageKind): string | null {
  if (kind === "favicon") {
    return Math.max(size.width, size.height) < FAVICON_MIN
      ? `Das Bild ist zu klein. Ein Favicon braucht mindestens ${FAVICON_MIN} Pixel.`
      : null;
  }
  return Math.min(size.width, size.height) < LOGO_MIN
    ? `Das Bild ist zu klein. Ein Logo braucht mindestens ${LOGO_MIN} Pixel in Breite und Höhe.`
    : null;
}

export interface Prepared {
  /** Inhalt als Base64, fertig für den Server. */
  base64: string;
  bytes: number;
  /** Abmessungen vorher und nachher; fehlen, wenn der Browser das Bild nicht lesen konnte. */
  before?: Size;
  after?: Size;
  /** Das Bild wurde neu gezeichnet (verkleinert, quadratisch gesetzt oder umgewandelt). */
  changed: boolean;
}

export class ImageProblem extends Error {}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Datei nicht lesbar"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Liest das Bild direkt aus der Datei. Bewusst ohne Umweg über eine blob:-Adresse: Die
 * Content-Security-Policy der Werkbank lässt Bilder nur von der eigenen Adresse zu.
 */
function loadImage(file: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "function") {
    return Promise.reject(new Error("Bild nicht lesbar"));
  }
  return createImageBitmap(file);
}

function draw(image: ImageBitmap, plan: Plan): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = plan.canvas.width;
  canvas.height = plan.canvas.height;
  const context = canvas.getContext("2d");
  if (!context) {
    return Promise.resolve(null);
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    Math.round((plan.canvas.width - plan.image.width) / 2),
    Math.round((plan.canvas.height - plan.image.height) / 2),
    plan.image.width,
    plan.image.height,
  );
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/**
 * Bereitet eine Datei für den Upload vor. Kann der Browser das Bild nicht zeichnen, geht die
 * Datei unverändert an den Server, der sie prüft.
 */
export async function prepareImage(
  file: File,
  kind: ImageKind,
  mode: ResizeMode,
  maxBytes: number,
): Promise<Prepared> {
  const original = async (): Promise<Prepared> => ({
    base64: await blobToBase64(file),
    bytes: file.size,
    changed: false,
  });
  let image: ImageBitmap;
  try {
    image = await loadImage(file);
  } catch {
    return original();
  }
  const before = { width: image.width, height: image.height };
  const problem = sizeProblem(before, kind);
  if (problem) {
    throw new ImageProblem(problem);
  }
  const mustConvert =
    file.type === "image/jpeg" || (kind === "favicon" && file.type !== "image/png");
  const limit = kind === "favicon" ? FAVICON_MAX : LOGO_MAX;
  const tooLarge = Math.max(before.width, before.height) > limit || file.size > maxBytes;
  if (mode === "original" && !mustConvert) {
    if (tooLarge || (kind === "favicon" && before.width !== before.height)) {
      throw new ImageProblem(
        kind === "favicon"
          ? "Im Original passt das Bild nicht: Ein Favicon muss quadratisch sein, höchstens 512 Pixel und 256 KB groß. Mit „Automatisch anpassen“ erledigt das die Werkbank."
          : "Im Original ist das Bild zu groß (höchstens 2000 Pixel und 256 KB). Mit „Automatisch anpassen“ verkleinert es die Werkbank.",
      );
    }
    return { ...(await original()), before, after: before };
  }

  // Automatisch: erst auf die übliche Größe, dann weiter verkleinern, bis die Datei passt.
  let longest = mode === "original" ? limit : kind === "favicon" ? FAVICON_TARGET : LOGO_TARGET;
  let plan = planResize(before, kind, longest);
  if (!plan.redraw && !mustConvert && !tooLarge) {
    return { ...(await original()), before, after: before };
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const blob = await draw(image, plan);
    if (!blob) {
      return original();
    }
    if (blob.size <= maxBytes) {
      return {
        base64: await blobToBase64(blob),
        bytes: blob.size,
        before,
        after: plan.canvas,
        changed: true,
      };
    }
    longest = Math.round(Math.max(plan.canvas.width, plan.canvas.height) * 0.7);
    plan = planResize(before, kind, longest);
  }
  throw new ImageProblem(
    "Das Bild bleibt auch verkleinert zu groß. Bitte ein einfacheres Bild wählen.",
  );
}
