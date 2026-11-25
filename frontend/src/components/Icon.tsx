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
  werkzeuge: [
    "M14.5 6.5a4 4 0 0 0-5.2 5.2L4 17l3 3 5.3-5.3a4 4 0 0 0 5.2-5.2l-2.6 2.6-2.2-.6-.6-2.2z",
  ],
  netzwerk: [
    "M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    "M6 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    "M18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    "M12 7v5",
    "M6 17v-2.5h12V17",
  ],
  system: ["M3 5h18v14H3z", "M7 10l3 2-3 2", "M12 15h5"],
  encoding: ["M8 7l-5 5 5 5", "M16 7l5 5-5 5", "M14 4l-4 16"],
  formatter: ["M4 6h16", "M8 10h12", "M8 14h8", "M4 18h12"],
  konverter: ["M4 8h14", "M15 5l3 3-3 3", "M20 16H6", "M9 13l-3 3 3 3"],
  text: ["M5 6V4h14v2", "M12 4v16", "M9 20h6"],
  identitaet: [
    "M3 5h18v14H3z",
    "M9 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    "M6 16c.5-1.5 1.6-2 3-2s2.5.5 3 2",
    "M15 9h3",
    "M15 12h3",
  ],
  rechner: [
    "M6 3h12v18H6z",
    "M9 7h6",
    "M9 12h.01",
    "M12 12h.01",
    "M15 12h.01",
    "M9 16h.01",
    "M12 16h.01",
    "M15 16h.01",
  ],
  zertifikate: ["M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z", "M9 12l2 2 4-4"],
  planung: ["M3 5h6v4H3z", "M15 15h6v4h-6z", "M15 5h6v4h-6z", "M9 7h6", "M6 9v8h9"],
  generator: ["M5 5h14v14H5z", "M9 9h.01", "M15 9h.01", "M12 12h.01", "M9 15h.01", "M15 15h.01"],
  dienststatus: ["M3 12h4l2-5 4 10 2-5h6"],
  schluessel: ["M8 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M11.5 11H21", "M17 11v3", "M20 11v2"],
  lizenzen: ["M4 6h16v12H4z", "M8 11h8", "M8 14h5", "M4 9h16"],
  budget: [
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
    "M15.5 8.5A4 4 0 1 0 15.5 15.5",
    "M7.5 11h5",
    "M7.5 13.5h5",
  ],
  posten: ["M4 6h3", "M10 6h10", "M4 12h3", "M10 12h10", "M4 18h3", "M10 18h10"],
  rechnungen: ["M6 3h12v18l-3-2-3 2-3-2-3 2z", "M9 8h6", "M9 12h6", "M9 16h3"],
  statistik: ["M4 20h16", "M7 20v-6", "M12 20V6", "M17 20v-9"],
  kalender: ["M4 6h16v14H4z", "M4 10h16", "M8 3v4", "M16 3v4", "M8 14h2", "M14 14h2"],
  vertraege: ["M6 3h9l4 4v14H6z", "M15 3v4h4", "M9 12h7", "M9 15h7", "M9 18h4"],
  partner: [
    "M3 21h18",
    "M5 21V6l7-3v18",
    "M12 9h7v12",
    "M8 9v1",
    "M8 13v1",
    "M8 17v1",
    "M16 13v1",
    "M16 17v1",
  ],
  konten: ["M4 5h16v14H4z", "M4 10h16", "M4 14.5h16", "M10 5v14"],
  benutzer: [
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    "M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5",
    "M16 4.5a3.5 3.5 0 0 1 0 6.5",
    "M18 14.8c1.9.7 3.2 2.5 3.6 5.2",
  ],
  vorgaenge: ["M8 5H6v15h12V5h-2", "M9 3h6v4H9z", "M9 13l2 2 4-4"],
  tickets: ["M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z", "M15 7v2", "M15 11v2", "M15 15v2"],
  plus: ["M12 5v14", "M5 12h14"],
  brief: ["M3 6h18v12H3z", "M3 7l9 6 9-6"],
  schloss: ["M6 11h12v9H6z", "M8 11V8a4 4 0 0 1 8 0v3"],
  eingang: ["M3 13h5l1.5 3h5L16 13h5", "M5.5 5h13L21 13v6H3v-6z"],
  reports: ["M6 3h8l4 4v14H6z", "M14 3v4h4", "M9 13h6", "M9 17h6"],
  audit: ["M8 6h12", "M8 12h12", "M8 18h12", "M4 6h.01", "M4 12h.01", "M4 18h.01"],
  // Person mit Schild (Admin); nicht als Zahnrad, das sah wie die Sonne für „hell“ aus
  verwaltung: [
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    "M3 20c.6-3.4 3-5 6-5 1.3 0 2.5.3 3.4.9",
    "M17 13l4 1.5V17c0 2.4-1.6 4-4 5-2.4-1-4-2.6-4-5v-2.5z",
  ],
  neuigkeiten: ["M4 10v4h3l7 4V6l-7 4z", "M18 9a4 4 0 0 1 0 6"],
  verlauf: ["M12 7v5l3 2", "M3 12a9 9 0 1 0 3-6.7", "M3 4v4h4"],
  monitoring: ["M3 12h4l3-8 4 16 3-8h4"],
  import: ["M12 4v11", "M7 10l5 5 5-5", "M4 20h16"],
  projekte: ["M3 8h18v12H3z", "M8 8V5h8v3", "M3 13h18"],
  bestand: ["M4 5h16v11H4z", "M9 20h6", "M12 16v4"],
  stellen: [
    "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    "M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6",
    "M16 4h5",
    "M16 8h5",
    "M18 12h3",
  ],
  arbeitsplatz: ["M3 11h18", "M5 11v9", "M19 11v9", "M8 4h8v5H8z", "M12 9v2"],
  verleih: ["M3 7h11v10H3z", "M14 12h7", "M18 9l3 3-3 3"],
  standort: [
    "M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z",
    "M12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  ],
  handbuch: [
    "M4 5a2 2 0 0 1 2-2h6v17H6a2 2 0 0 0-2 2z",
    "M20 5a2 2 0 0 0-2-2h-6v17h6a2 2 0 0 1 2 2z",
  ],
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
  glocke: ["M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "M10.3 21a1.94 1.94 0 0 0 3.4 0"],
  lautsprecher: ["M11 5L6 9H2v6h4l5 4V5z", "M15.5 8.5a5 5 0 0 1 0 7", "M18.5 5.5a9 9 0 0 1 0 13"],
  evergreen: ["M12 3l6 8h-4l5 7H5l5-7H6z", "M12 18v3"],
  geraet: ["M5 5h14v10H5z", "M3 19h18", "M9 15l-1 4", "M15 15l1 4"],
  stern: ["M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"],
  "pfeil-unten": ["M6 9l6 6 6-6"],
  "pfeil-rechts": ["M9 6l6 6-6 6"],
  zurueck: ["M15 6l-6 6 6 6"],
  menue: ["M4 7h16", "M4 12h16", "M4 17h16"],
  schliessen: ["M6 6l12 12", "M18 6L6 18"],
  abmelden: ["M14 4h5v16h-5", "M10 8l-4 4 4 4", "M6 12h10"],
  konto: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 21c1-4 4-6 8-6s7 2 8 6"],
  auto: ["M12 3a9 9 0 1 0 0 18z", "M12 3a9 9 0 0 1 0 18"],
  aufgaben: ["M22 12h-6l-2 3h-4l-2-3H2", "M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"],
  loeschen: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 13h10l1-13", "M9 7V4h6v3"],
  ausklappen: ["M13 6l6 6-6 6", "M5 6l6 6-6 6"],
  qr: [
    "M4 4h6v6H4z",
    "M14 4h6v6h-6z",
    "M4 14h6v6H4z",
    "M14 14h2v2h-2z",
    "M18 18h2v2h-2z",
    "M14 18h2",
    "M18 14h2",
  ],
  kamera: ["M4 8h3l2-3h6l2 3h3v11H4z", "M12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  aktualisieren: [
    "M20 11a8 8 0 0 0-14.3-4.9L4 8",
    "M4 4v4h4",
    "M4 13a8 8 0 0 0 14.3 4.9L20 16",
    "M20 20v-4h-4",
  ],
  kopieren: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
  info: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 11v5", "M12 8h.01"],
  hilfe: [
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
    "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6",
    "M12 17h.01",
  ],
  haken: ["M5 12l5 5 9-10"],
  warnung: ["M12 4l9 16H3z", "M12 10v4", "M12 17h.01"],
  extern: ["M14 4h6v6", "M20 4l-9 9", "M18 14v6H4V6h6"],
  link: [
    "M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1",
    "M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1",
  ],
  pdf: ["M14 3H6v18h12V7z", "M14 3v4h4", "M9 13h6", "M9 17h4"],
  bild: ["M4 5h16v14H4z", "M9 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M4 17l5-5 4 4 2-2 5 5"],
  datei: ["M14 3H6v18h12V7z", "M14 3v4h4"],
  herunterladen: ["M12 4v11", "M7 10l5 5 5-5", "M5 20h14"],
  weiter: ["M9 6l6 6-6 6"],
  "ort-stadt": ["M3 21h18", "M5 21V8l7-5 7 5v13"],
  "ort-standort": ["M4 3h16v18H4z", "M9 7h2M13 7h2M9 11h2M13 11h2", "M10 21v-4h4v4"],
  "ort-abschnitt": ["M3 7h18v14H3z", "M12 7v14"],
  "ort-etage": ["M12 3l9 5-9 5-9-5z", "M3 13l9 5 9-5"],
  rueckgaengig: ["M9 14L4 9l5-5", "M4 9h11a5 5 0 0 1 0 10h-3"],
  wiederholen: ["M15 14l5-5-5-5", "M20 9H9a5 5 0 0 0 0 10h3"],
  doku: ["M5 3h10l4 4v14H5z", "M15 3v4h4", "M8 11h8", "M8 15h8", "M8 19h5"],
  "alles-einklappen": ["M7 20l5-5 5 5", "M7 4l5 5 5-5"],
} as const;

export type IconName = keyof typeof PATHS;

/** `filled`: Fläche gefüllt, z. B. der Stern einer angehefteten Seite. */
export function Icon({ name, filled = false }: { name: IconName; filled?: boolean }) {
  return (
    <svg
      className="icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
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
