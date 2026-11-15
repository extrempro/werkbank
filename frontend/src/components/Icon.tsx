/** Schlichte Linien-Symbole (24 × 24, eigene Zeichnungen). Rein schmückend: immer mit Text daneben. */

const PATHS = {
  start: ["M3 11l9-8 9 8", "M5 10v10h14V10", "M10 20v-6h4v6"],
  suche: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-4-4"],
  uebersicht: ["M4 20V4", "M4 20h16", "M8 16v-4", "M12 16V8", "M16 16v-6"],
  aenderungen: ["M4 8h13", "M14 5l3 3-3 3", "M20 16H7", "M10 13l-3 3 3 3"],
  einstellungen: ["M4 7h9", "M17 7h3", "M15 5v4", "M4 17h3", "M11 17h9", "M9 15v4"],
  empfehlungen: ["M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z", "M9 12l2 2 4-4"],
  m365: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
  snapshots: ["M4 8h3l2-3h6l2 3h3v11H4z", "M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  werkzeuge: ["M14.5 6.5a4 4 0 0 0-5.2 5.2L4 17l3 3 5.3-5.3a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.2-.6-.6-2.2z"],
  vorgaenge: ["M8 5H6v15h12V5h-2", "M9 3h6v4H9z", "M9 13l2 2 4-4"],
  eingang: ["M3 13h5l1.5 3h5L16 13h5", "M5.5 5h13L21 13v6H3v-6z"],
  reports: ["M6 3h8l4 4v14H6z", "M14 3v4h4", "M9 13h6", "M9 17h6"],
  audit: ["M8 6h12", "M8 12h12", "M8 18h12", "M4 6h.01", "M4 12h.01", "M4 18h.01"],
  verwaltung: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M12 3v3",
    "M12 18v3",
    "M3 12h3",
    "M18 12h3",
    "M5.6 5.6l2.1 2.1",
    "M16.3 16.3l2.1 2.1",
    "M5.6 18.4l2.1-2.1",
    "M16.3 7.7l2.1-2.1",
  ],
  neuigkeiten: ["M4 10v4h3l7 4V6l-7 4z", "M18 9a4 4 0 0 1 0 6"],
  hell: [
    "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    "M12 3v2",
    "M12 19v2",
    "M3 12h2",
    "M19 12h2",
    "M5.6 5.6l1.4 1.4",
    "M17 17l1.4 1.4",
    "M5.6 18.4L7 17",
    "M17 7l1.4-1.4",
  ],
  dunkel: ["M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"],
  einklappen: ["M11 6l-6 6 6 6", "M19 6l-6 6 6 6"],
  ausklappen: ["M13 6l6 6-6 6", "M5 6l6 6-6 6"],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
