/** Farben der Bereiche: feste Auswahl, dieselben Schlüssel wie im Backend (AREA_COLORS). */
export const AREA_COLORS = [
  "blau",
  "petrol",
  "violett",
  "orange",
  "gruen",
  "rot",
  "pink",
  "grau",
] as const;

export type AreaColor = (typeof AREA_COLORS)[number];

export const AREA_COLOR_LABELS: Record<AreaColor, string> = {
  blau: "Blau",
  petrol: "Petrol",
  violett: "Violett",
  orange: "Orange",
  gruen: "Grün",
  rot: "Rot",
  pink: "Pink",
  grau: "Grau",
};

/** CSS-Klasse für eine Farbe; Unbekanntes wird grau. */
export function areaColorClass(color: string | undefined): string {
  const known = AREA_COLORS.find((c) => c === color);
  return `bereich-${known ?? "grau"}`;
}

/** Farben je Bereich aus der eigenen Sicht (`/me`). */
export function colorsOf(areas: { id: number; color?: string }[]): Record<number, string> {
  return Object.fromEntries(areas.map((area) => [area.id, area.color ?? ""]));
}
