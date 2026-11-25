/**
 * Töne für neue Benachrichtigungen in der Glocke.
 * Die Einstellungen gelten für diesen Browser (localStorage), nicht für das Konto.
 * Die Töne erzeugt der Browser selbst (Web Audio), es gibt keine Audiodateien.
 */

export type ToneId =
  "aus" | "glocke" | "ping" | "zwei" | "drei" | "sanft" | "klopfen" | "gong" | "dringend";

export const TONES: readonly { id: ToneId; label: string }[] = [
  { id: "aus", label: "Kein Ton" },
  { id: "glocke", label: "Glocke" },
  { id: "ping", label: "Ping" },
  { id: "zwei", label: "Zwei Töne" },
  { id: "drei", label: "Drei Töne" },
  { id: "sanft", label: "Sanft" },
  { id: "klopfen", label: "Klopfen" },
  { id: "gong", label: "Gong" },
  { id: "dringend", label: "Dringend" },
];

/** Frequenz (Hz), Beginn (s), Dauer (s), Wellenform */
type Note = [number, number, number, OscillatorType];

const NOTES: Record<Exclude<ToneId, "aus">, Note[]> = {
  glocke: [
    [880, 0, 0.9, "sine"],
    [1320, 0, 0.6, "sine"],
  ],
  ping: [[1568, 0, 0.35, "sine"]],
  zwei: [
    [660, 0, 0.18, "triangle"],
    [990, 0.16, 0.3, "triangle"],
  ],
  drei: [
    [523, 0, 0.15, "sine"],
    [659, 0.13, 0.15, "sine"],
    [784, 0.26, 0.35, "sine"],
  ],
  sanft: [
    [440, 0, 0.6, "sine"],
    [554, 0.08, 0.6, "sine"],
  ],
  klopfen: [
    [180, 0, 0.08, "square"],
    [180, 0.16, 0.08, "square"],
  ],
  gong: [
    [196, 0, 1.6, "sine"],
    [392, 0, 1.0, "sine"],
    [588, 0, 0.6, "sine"],
  ],
  dringend: [
    [880, 0, 0.12, "sawtooth"],
    [660, 0.14, 0.12, "sawtooth"],
    [880, 0.28, 0.12, "sawtooth"],
    [660, 0.42, 0.18, "sawtooth"],
  ],
};

export interface SoundSettings {
  /** Töne überhaupt abspielen */
  enabled: boolean;
  /** 0 bis 100 */
  volume: number;
  /** Zwischen 18 und 7 Uhr still */
  quiet: boolean;
  /** Nur, wenn die Werkbank nicht im Vordergrund ist */
  onlyHidden: boolean;
  /** Ton je Bereich (Name des Bereichs wie in der Glocke, z. B. „IT-Budget“) */
  tones: Record<string, ToneId>;
}

export const SOUND_KEY = "werkbank-toene";
/** Höchste Benachrichtigung, für die schon ein Ton kam (über alle Tabs). */
export const SOUND_SEEN_KEY = "werkbank-toene-gehoert";
export const DEFAULT_TONE: ToneId = "glocke";
const QUIET_FROM = 18;
const QUIET_UNTIL = 7;

export const DEFAULT_SOUNDS: SoundSettings = {
  enabled: false,
  volume: 60,
  quiet: false,
  onlyHidden: false,
  tones: {},
};

function isTone(value: unknown): value is ToneId {
  return typeof value === "string" && TONES.some((tone) => tone.id === value);
}

export function storedSounds(): SoundSettings {
  try {
    const raw = window.localStorage.getItem(SOUND_KEY);
    if (!raw) {
      return DEFAULT_SOUNDS;
    }
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) {
      return DEFAULT_SOUNDS;
    }
    const value = data as Record<string, unknown>;
    const tones: Record<string, ToneId> = {};
    if (typeof value.tones === "object" && value.tones !== null) {
      for (const [area, tone] of Object.entries(value.tones as Record<string, unknown>)) {
        if (isTone(tone)) {
          tones[area] = tone;
        }
      }
    }
    const volume = typeof value.volume === "number" ? value.volume : DEFAULT_SOUNDS.volume;
    return {
      enabled: value.enabled === true,
      volume: Math.min(100, Math.max(0, Math.round(volume))),
      quiet: value.quiet === true,
      onlyHidden: value.onlyHidden === true,
      tones,
    };
  } catch {
    return DEFAULT_SOUNDS;
  }
}

export function saveSounds(settings: SoundSettings): void {
  try {
    window.localStorage.setItem(SOUND_KEY, JSON.stringify(settings));
  } catch {
    // Speicher gesperrt: Die Auswahl gilt dann nur bis zum Neuladen.
  }
}

export function toneFor(settings: SoundSettings, area: string): ToneId {
  return settings.tones[area] ?? DEFAULT_TONE;
}

export function toneLabel(id: ToneId): string {
  return TONES.find((tone) => tone.id === id)?.label ?? id;
}

/** Ruhezeit 18:00 bis 7:00 Uhr */
export function inQuietTime(now: Date = new Date()): boolean {
  const hour = now.getHours();
  return hour >= QUIET_FROM || hour < QUIET_UNTIL;
}

interface NewEntry {
  id: number;
  module: string;
  read: boolean;
}

/**
 * Welcher Ton für einen Schwung neuer Benachrichtigungen erklingt: ein einziger, und zwar der
 * Ton des Bereichs der neuesten Benachrichtigung, die überhaupt einen Ton hat. `null` = still.
 */
export function toneForBatch(
  settings: SoundSettings,
  entries: readonly NewEntry[],
  seen: number,
  context: { hidden: boolean; now?: Date },
): ToneId | null {
  if (!settings.enabled || settings.volume <= 0) {
    return null;
  }
  if (settings.onlyHidden && !context.hidden) {
    return null;
  }
  if (settings.quiet && inQuietTime(context.now)) {
    return null;
  }
  const fresh = entries
    .filter((entry) => !entry.read && entry.id > seen)
    .sort((a, b) => b.id - a.id);
  for (const entry of fresh) {
    const tone = toneFor(settings, entry.module);
    if (tone !== "aus") {
      return tone;
    }
  }
  return null;
}

/** Bis zu welcher Benachrichtigung es schon einen Ton gab; 0 = noch nie. */
export function seenUntil(): number {
  try {
    const value = Number(window.localStorage.getItem(SOUND_SEEN_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * Merkt sich die höchste Nummer. Gibt `true` zurück, wenn dieser Tab der erste mit dem neuen
 * Stand ist – sonst hat schon ein anderer Tab den Ton gespielt.
 */
export function claimUntil(id: number): boolean {
  try {
    if (seenUntil() >= id) {
      return false;
    }
    window.localStorage.setItem(SOUND_SEEN_KEY, String(id));
    return true;
  } catch {
    return true;
  }
}

let context: AudioContext | null = null;

/** Spielt einen Ton. Ohne Web Audio (oder vor der ersten Bedienung der Seite) bleibt es still. */
export function playTone(id: ToneId, volume: number): void {
  if (id === "aus" || volume <= 0) {
    return;
  }
  const Ctx =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) {
    return;
  }
  try {
    context ??= new Ctx();
    const audio = context;
    if (audio.state === "suspended") {
      void audio.resume();
    }
    const gain = (volume / 100) * 0.3;
    const start = audio.currentTime + 0.02;
    for (const [frequency, offset, length, wave] of NOTES[id]) {
      const oscillator = audio.createOscillator();
      const envelope = audio.createGain();
      oscillator.type = wave;
      oscillator.frequency.value = frequency;
      envelope.gain.setValueAtTime(0.0001, start + offset);
      envelope.gain.exponentialRampToValueAtTime(gain, start + offset + 0.01);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + offset + length);
      oscillator.connect(envelope).connect(audio.destination);
      oscillator.start(start + offset);
      oscillator.stop(start + offset + length + 0.05);
    }
  } catch {
    // Kein Ton möglich: nicht schlimm, die Glocke zeigt die Benachrichtigung trotzdem.
  }
}
