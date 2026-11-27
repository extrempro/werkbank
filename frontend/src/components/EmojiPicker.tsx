import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useFloating } from "./floating";
import { SearchField } from "./SearchField";

/** Emoji mit Suchwörtern, nach Gruppen. Bewusst eine Auswahl, keine vollständige Liste. */
export const EMOJI_GROUPS: readonly { label: string; items: readonly [string, string][] }[] = [
  {
    label: "IT und Technik",
    items: [
      ["🖥️", "Computer Bildschirm PC Arbeitsplatz"],
      ["💻", "Laptop Notebook"],
      ["⌨️", "Tastatur"],
      ["🖱️", "Maus"],
      ["🖨️", "Drucker"],
      ["📱", "Handy Smartphone Telefon mobil"],
      ["☎️", "Telefon Festnetz"],
      ["🗄️", "Server Aktenschrank Rack"],
      ["💾", "Diskette Sicherung Backup speichern"],
      ["💿", "CD Datenträger"],
      ["🔌", "Stecker Strom"],
      ["🔋", "Batterie Akku USV"],
      ["📡", "Antenne Funk WLAN Satellit"],
      ["🌐", "Netz Netzwerk Internet Web Welt"],
      ["☁️", "Cloud Wolke"],
      ["📶", "Empfang WLAN Signal"],
      ["🛰️", "Satellit"],
      ["🤖", "Roboter Automatisierung KI"],
      ["🧮", "Rechnen Abakus"],
      ["📷", "Kamera Foto"],
      ["🎥", "Video Kamera Film"],
      ["🎧", "Kopfhörer Headset Audio"],
      ["🔊", "Lautsprecher Ton Audio"],
      ["📺", "Fernseher Display Monitor"],
    ],
  },
  {
    label: "Sicherheit",
    items: [
      ["🔒", "Schloss gesperrt sicher"],
      ["🔓", "offen entsperrt Schloss"],
      ["🔐", "Schloss Schlüssel verschlüsselt"],
      ["🔑", "Schlüssel Zugang Passwort"],
      ["🗝️", "alter Schlüssel"],
      ["🛡️", "Schild Schutz Sicherheit Firewall"],
      ["🚨", "Alarm Notfall Sirene"],
      ["⚠️", "Warnung Achtung Vorsicht"],
      ["⛔", "Verboten Stopp"],
      ["🚫", "verboten nicht erlaubt"],
      ["👁️", "Auge sehen Überwachung"],
      ["🪪", "Ausweis Identität Konto"],
    ],
  },
  {
    label: "Arbeit und Ablauf",
    items: [
      ["📋", "Klemmbrett Liste Checkliste"],
      ["✅", "Haken erledigt fertig"],
      ["☑️", "Kästchen Haken"],
      ["❌", "Kreuz falsch Fehler"],
      ["❓", "Frage Hilfe"],
      ["❗", "Ausrufezeichen wichtig"],
      ["💡", "Idee Glühbirne Tipp"],
      ["📌", "Pinnnadel angeheftet wichtig"],
      ["📍", "Ort Standort Markierung"],
      ["🔖", "Lesezeichen"],
      ["🏷️", "Etikett Schild Tag"],
      ["📎", "Büroklammer Anhang"],
      ["✏️", "Stift bearbeiten schreiben"],
      ["📝", "Notiz Protokoll schreiben"],
      ["📅", "Kalender Termin Datum"],
      ["⏰", "Wecker Zeit Erinnerung"],
      ["⏱️", "Stoppuhr Zeit"],
      ["🔁", "wiederholen Schleife regelmäßig"],
      ["🔄", "aktualisieren Sync"],
      ["⚙️", "Zahnrad Einstellungen Konfiguration"],
      ["🔧", "Schraubenschlüssel Werkzeug Wartung"],
      ["🔨", "Hammer bauen"],
      ["🧰", "Werkzeugkasten Werkzeug"],
      ["🧪", "Test Labor Versuch"],
      ["🚀", "Rakete Start Einführung Release"],
      ["🎯", "Ziel"],
      ["🏁", "Ziel Flagge fertig"],
      ["🧭", "Kompass Orientierung"],
      ["🗺️", "Karte Plan"],
      ["🧩", "Puzzle Baustein Erweiterung"],
    ],
  },
  {
    label: "Dokumente",
    items: [
      ["📘", "Buch Handbuch blau"],
      ["📕", "Buch rot"],
      ["📗", "Buch grün"],
      ["📙", "Buch orange"],
      ["📚", "Bücher Wissen Doku"],
      ["📖", "offenes Buch lesen Anleitung"],
      ["📄", "Seite Dokument Datei"],
      ["📃", "Seite gerollt"],
      ["📑", "Register Lesezeichen"],
      ["📁", "Ordner"],
      ["📂", "offener Ordner"],
      ["🗂️", "Karteikarten Register Ablage"],
      ["🗃️", "Karteikasten Archiv"],
      ["📦", "Paket Lieferung Karton"],
      ["📊", "Diagramm Balken Statistik"],
      ["📈", "Diagramm steigend"],
      ["📉", "Diagramm fallend"],
      ["🧾", "Beleg Rechnung Quittung"],
      ["💶", "Geld Euro Budget Kosten"],
      ["✉️", "Brief Mail E-Mail"],
      ["📧", "E-Mail Mail"],
      ["📬", "Briefkasten Post"],
      ["📢", "Ankündigung Megafon"],
      ["🔍", "Lupe Suche"],
    ],
  },
  {
    label: "Menschen und Orte",
    items: [
      ["👋", "Winken Hallo Willkommen"],
      ["👤", "Person Benutzer"],
      ["👥", "Personen Gruppe Team"],
      ["🧑‍💻", "Technikerin Techniker IT Entwickler"],
      ["🤝", "Handschlag Partner Vertrag"],
      ["🙋", "Meldung Frage Hand"],
      ["🎓", "Ausbildung Schulung Abschluss"],
      ["🏢", "Gebäude Büro Firma"],
      ["🏠", "Haus Startseite Zuhause"],
      ["🏗️", "Baustelle Umbau"],
      ["🚪", "Tür Eingang Zutritt"],
      ["🪑", "Stuhl Platz Raum"],
      ["🚗", "Auto Fahrzeug"],
      ["✈️", "Flugzeug Reise"],
      ["🎭", "Theater Masken Bühne"],
      ["🎵", "Musik Note"],
    ],
  },
  {
    label: "Symbole",
    items: [
      ["⭐", "Stern Favorit"],
      ["🔥", "Feuer dringend heiß"],
      ["❤️", "Herz"],
      ["🟢", "grün Punkt läuft"],
      ["🟡", "gelb Punkt"],
      ["🔴", "rot Punkt Störung"],
      ["🔵", "blau Punkt"],
      ["⚫", "schwarz Punkt"],
      ["➡️", "Pfeil rechts weiter"],
      ["⬆️", "Pfeil hoch"],
      ["ℹ️", "Info Information"],
      ["🆕", "neu"],
      ["🆘", "Hilfe Notfall SOS"],
      ["🎉", "Feier Party Konfetti"],
      ["🌱", "Pflanze Anfang neu"],
      ["⚡", "Blitz Strom schnell"],
    ],
  },
];

const ALL = EMOJI_GROUPS.flatMap((group) => group.items);
const RECENT_KEY = "werkbank:emoji-zuletzt";
const RECENT_MAX = 8;
const COLUMNS = 8;

function loadRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list.filter((entry): entry is string => typeof entry === "string").slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

function rememberRecent(emoji: string): void {
  try {
    const next = [emoji, ...loadRecent().filter((entry) => entry !== emoji)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Speicher nicht verfügbar: dann eben ohne „Zuletzt benutzt“
  }
}

function labelOf(emoji: string): string {
  const entry = ALL.find(([char]) => char === emoji);
  return entry?.[1].split(" ")[0] ?? "Emoji";
}

interface Props {
  /** Gewähltes Emoji, leer: keins */
  value: string;
  onChange: (emoji: string) => void;
  /** Name des Knopfs für Screenreader, z. B. „Emoji der Seite ändern“ */
  label: string;
  disabled?: boolean;
  /** Größe des Knopfs: „gross“ im Seitenkopf, sonst wie ein Eingabefeld */
  size?: "normal" | "gross";
}

/** Knopf mit dem gewählten Emoji; öffnet eine Auswahl mit Suche und „Zuletzt benutzt“. */
export function EmojiPicker({ value, onChange, label, disabled, size = "normal" }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const position = useFloating(trigger, open);

  const term = query.trim().toLowerCase();
  const sections = useMemo(() => {
    if (term) {
      const found = ALL.filter(([, words]) => words.toLowerCase().includes(term));
      return [{ label: `${found.length} Treffer`, items: found.map(([char]) => char) }];
    }
    const groups = EMOJI_GROUPS.map((group) => ({
      label: group.label,
      items: group.items.map(([char]) => char),
    }));
    return recent.length > 0 ? [{ label: "Zuletzt benutzt", items: recent }, ...groups] : groups;
  }, [term, recent]);
  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  // Erste laufende Nummer je Gruppe, für die Bewegung mit den Pfeiltasten über alle Gruppen
  const starts = useMemo(
    () =>
      sections.map((_, at) =>
        sections.slice(0, at).reduce((sum, section) => sum + section.items.length, 0),
      ),
    [sections],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.getElementById(`${baseId}-suche`)?.focus();
    return () => document.removeEventListener("pointerdown", close);
  }, [open, baseId]);

  const show = () => {
    setRecent(loadRecent());
    setQuery("");
    setFocusIndex(0);
    setOpen(true);
  };

  const finish = (emoji: string) => {
    if (emoji) {
      rememberRecent(emoji);
    }
    onChange(emoji);
    setOpen(false);
    trigger.current?.focus();
  };

  const focusCell = (index: number) => {
    const next = Math.max(0, Math.min(flat.length - 1, index));
    setFocusIndex(next);
    panel.current?.querySelector<HTMLButtonElement>(`[data-emoji-index="${next}"]`)?.focus();
  };

  const onPanelKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }
  };

  const onGridKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS,
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      focusCell(index + move);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusCell(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusCell(flat.length - 1);
    }
  };

  // Breiter als der Knopf und nicht über den rechten Rand hinaus
  const width = Math.min(320, window.innerWidth - 16);
  const left = typeof position.left === "number" ? position.left : 8;
  const style = {
    ...position,
    width,
    left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`emoji-trigger${size === "gross" ? " emoji-trigger-gross" : ""}${value ? "" : " emoji-trigger-leer"}`}
        aria-label={value ? `${label} (jetzt ${labelOf(value)})` : label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
      >
        <span aria-hidden="true">{value || "☺"}</span>
      </button>
      {open && (
        <div
          ref={panel}
          className="emoji-panel"
          role="dialog"
          aria-label="Emoji wählen"
          style={style}
          onKeyDown={onPanelKey}
        >
          <SearchField
            id={`${baseId}-suche`}
            label="Emoji suchen"
            value={query}
            noPanel
            placeholder="z. B. Server, Schloss, Buch"
            onChange={(next) => {
              setQuery(next);
              setFocusIndex(0);
            }}
          />
          <div className="emoji-sections">
            {sections
              .map((group, at) => ({ ...group, start: starts[at] ?? 0 }))
              .map((section) => (
                <div key={section.label} role="group" aria-label={section.label}>
                  <p className="emoji-group-label">{section.label}</p>
                  <div className="emoji-grid">
                    {section.items.map((emoji, position) => {
                      const own = section.start + position;
                      return (
                        <button
                          key={`${section.label}-${emoji}`}
                          type="button"
                          className="emoji-cell"
                          data-emoji-index={own}
                          tabIndex={own === focusIndex ? 0 : -1}
                          aria-label={labelOf(emoji)}
                          aria-pressed={emoji === value}
                          title={labelOf(emoji)}
                          onClick={() => finish(emoji)}
                          onKeyDown={(event) => onGridKey(event, own)}
                        >
                          {emoji}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            {flat.length === 0 && <p className="small emoji-none">Kein passendes Emoji.</p>}
          </div>
          {value && (
            <div className="emoji-foot">
              <button type="button" className="button-link" onClick={() => finish("")}>
                Emoji entfernen
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
