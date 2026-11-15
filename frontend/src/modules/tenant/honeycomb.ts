/** Rechenhilfen der Wabenansicht: Anordnung der Waben und Umbruch der Namen. */

/** Radius einer Wabe (Mitte bis Spitze) und Abstand zwischen zwei Waben in Pixeln. */
export const HEX_RADIUS = 60;
const HEX_GAP = 4;
const HEX_HALF_WIDTH = (HEX_RADIUS * Math.sqrt(3)) / 2;
const STEP_X = 2 * HEX_HALF_WIDTH + HEX_GAP;
const STEP_Y = 1.5 * HEX_RADIUS + HEX_GAP;
const EDGE = 3;

/** So viele Zeichen passen in der Schrift der Wabe sicher in eine Zeile. */
export const NAME_LINE_LENGTH = 13;

export interface HexLayout {
  columns: number;
  width: number;
  height: number;
  /** Mittelpunkt je Wabe, in der Reihenfolge der Einträge. */
  centers: { x: number; y: number }[];
}

/** Eckpunkte einer Wabe um den Ursprung, Spitze oben. */
export function hexPoints(radius = HEX_RADIUS): string {
  const half = (radius * Math.sqrt(3)) / 2;
  const points = [
    [0, -radius],
    [half, -radius / 2],
    [half, radius / 2],
    [0, radius],
    [-half, radius / 2],
    [-half, -radius / 2],
  ];
  return points.map(([x = 0, y = 0]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
}

/** Ordnet die Waben zeilenweise an; jede zweite Zeile ist um eine halbe Wabe versetzt. */
export function hexLayout(count: number, available: number): HexLayout {
  // Die versetzte Zeile braucht eine halbe Wabe mehr Platz.
  const columns = Math.max(1, Math.floor((available - 2 * EDGE - STEP_X / 2) / STEP_X));
  const rows = Math.ceil(count / columns);
  const centers = Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    return {
      x: EDGE + HEX_HALF_WIDTH + column * STEP_X + (row % 2 === 1 ? STEP_X / 2 : 0),
      y: EDGE + HEX_RADIUS + row * STEP_Y,
    };
  });
  return {
    columns,
    width: Math.ceil(2 * EDGE + columns * STEP_X + (rows > 1 ? STEP_X / 2 : 0)),
    height: rows === 0 ? 0 : Math.ceil(2 * EDGE + 2 * HEX_RADIUS + (rows - 1) * STEP_Y),
    centers,
  };
}

function shorten(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * Name für die Wabe: eine Zeile, wenn er passt; sonst zwei Zeilen, getrennt an Leerzeichen oder
 * Bindestrich. Was dann noch zu lang ist, endet mit „…“. Der volle Name steht in den Einzelheiten.
 */
export function nameLines(name: string, limit = NAME_LINE_LENGTH): string[] {
  const text = name.trim().replace(/\s+/g, " ");
  if (text.length <= limit) {
    return [text];
  }
  // Teile enden am Leerzeichen oder hinter einem Bindestrich.
  const parts = text.split(/(?<=[-\s])/);
  let first = "";
  let used = 0;
  for (const part of parts) {
    if ((first + part).trimEnd().length > limit) {
      break;
    }
    first += part;
    used += 1;
  }
  if (used === 0) {
    // Ein einzelnes langes Wort: hart trennen.
    return [text.slice(0, limit), shorten(text.slice(limit).trim(), limit)];
  }
  return [first.trimEnd(), shorten(parts.slice(used).join("").trim(), limit)];
}

/** Restlaufzeit in Kurzform für die Wabe. */
export function shortRemaining(days: number | null): string {
  if (days === null) {
    return "ohne Ablauf";
  }
  if (days < 0) {
    return "abgelaufen";
  }
  if (days === 0) {
    return "heute";
  }
  return days === 1 ? "1 Tag" : `${days} Tage`;
}
