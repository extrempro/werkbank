/**
 * ICO-Datei aus PNG-Bildern zusammensetzen (PNG-in-ICO, unterstützt seit Windows Vista
 * und von allen aktuellen Browsern).
 */

export interface IcoImage {
  /** Kantenlänge in Pixeln (1–256) */
  size: number;
  png: Uint8Array;
}

export const DEFAULT_ICO_SIZES = [16, 32, 48, 256];
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

export function buildIco(images: IcoImage[]): Uint8Array {
  if (images.length === 0) throw new Error("Mindestens eine Größe auswählen");
  const sorted = [...images].sort((a, b) => a.size - b.size);
  const headerSize = 6 + 16 * sorted.length;
  const total = headerSize + sorted.reduce((n, i) => n + i.png.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0, true); // reserviert
  v.setUint16(2, 1, true); // Typ 1 = Symbol
  v.setUint16(4, sorted.length, true);

  let offset = headerSize;
  sorted.forEach((img, i) => {
    if (img.size < 1 || img.size > 256) throw new Error(`Ungültige Symbolgröße ${img.size}`);
    const e = 6 + i * 16;
    v.setUint8(e, img.size === 256 ? 0 : img.size); // 0 bedeutet 256
    v.setUint8(e + 1, img.size === 256 ? 0 : img.size);
    v.setUint8(e + 2, 0); // keine Palette
    v.setUint8(e + 3, 0);
    v.setUint16(e + 4, 1, true); // Farbebenen
    v.setUint16(e + 6, 32, true); // Bit pro Pixel
    v.setUint32(e + 8, img.png.length, true);
    v.setUint32(e + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.length;
  });
  return out;
}

/** Größen aus einer ICO-Datei lesen (für Anzeige und Tests) */
export function readIcoSizes(bytes: Uint8Array): number[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint16(0, true) !== 0 || v.getUint16(2, true) !== 1) throw new Error("Keine ICO-Datei");
  const count = v.getUint16(4, true);
  return Array.from({ length: count }, (_, i) => v.getUint8(6 + i * 16) || 256);
}
