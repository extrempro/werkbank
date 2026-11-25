import { afterEach, describe, expect, it } from "vitest";
import {
  claimUntil,
  DEFAULT_SOUNDS,
  inQuietTime,
  saveSounds,
  seenUntil,
  SOUND_KEY,
  storedSounds,
  toneFor,
  toneForBatch,
  type SoundSettings,
} from "./sounds";

afterEach(() => window.localStorage.clear());

const on: SoundSettings = {
  ...DEFAULT_SOUNDS,
  enabled: true,
  tones: { "IT-Budget": "gong", Tickets: "aus" },
};
const noon = new Date(2026, 10, 25, 12, 0);
const entry = (id: number, module: string, read = false) => ({ id, module, read });

describe("Töne", () => {
  it("sind anfangs aus und merken sich die Auswahl", () => {
    expect(storedSounds()).toEqual(DEFAULT_SOUNDS);
    saveSounds(on);
    expect(storedSounds()).toEqual(on);
  });

  it("verwirft kaputte oder unbekannte Werte", () => {
    window.localStorage.setItem(SOUND_KEY, "{kaputt");
    expect(storedSounds()).toEqual(DEFAULT_SOUNDS);
    window.localStorage.setItem(
      SOUND_KEY,
      JSON.stringify({ enabled: true, volume: 400, tones: { A: "trompete", B: "ping" } }),
    );
    const read = storedSounds();
    expect(read.volume).toBe(100);
    expect(read.tones).toEqual({ B: "ping" });
  });

  it("nimmt ohne Auswahl die Glocke", () => {
    expect(toneFor(on, "IT-Bestand")).toBe("glocke");
    expect(toneFor(on, "IT-Budget")).toBe("gong");
  });

  it("spielt für einen Schwung nur einen Ton, den der neuesten Benachrichtigung", () => {
    const entries = [entry(5, "IT-Bestand"), entry(9, "IT-Budget"), entry(3, "IT-Budget")];
    expect(toneForBatch(on, entries, 4, { hidden: false, now: noon })).toBe("gong");
  });

  it("überspringt Bereiche ohne Ton, Gelesenes und schon Gehörtes", () => {
    expect(
      toneForBatch(on, [entry(9, "Tickets"), entry(8, "IT-Doku")], 0, { hidden: false, now: noon }),
    ).toBe("glocke");
    expect(toneForBatch(on, [entry(9, "Tickets")], 0, { hidden: false, now: noon })).toBeNull();
    expect(
      toneForBatch(on, [entry(9, "IT-Budget", true)], 0, { hidden: false, now: noon }),
    ).toBeNull();
    expect(toneForBatch(on, [entry(9, "IT-Budget")], 9, { hidden: false, now: noon })).toBeNull();
  });

  it("bleibt still, wenn aus, leise, in der Ruhezeit oder im Vordergrund", () => {
    const list = [entry(9, "IT-Budget")];
    expect(toneForBatch(DEFAULT_SOUNDS, list, 0, { hidden: true, now: noon })).toBeNull();
    expect(toneForBatch({ ...on, volume: 0 }, list, 0, { hidden: true, now: noon })).toBeNull();
    const evening = new Date(2026, 10, 25, 19, 0);
    expect(
      toneForBatch({ ...on, quiet: true }, list, 0, { hidden: true, now: evening }),
    ).toBeNull();
    expect(toneForBatch({ ...on, quiet: true }, list, 0, { hidden: true, now: noon })).toBe("gong");
    expect(
      toneForBatch({ ...on, onlyHidden: true }, list, 0, { hidden: false, now: noon }),
    ).toBeNull();
    expect(toneForBatch({ ...on, onlyHidden: true }, list, 0, { hidden: true, now: noon })).toBe(
      "gong",
    );
  });

  it("kennt die Ruhezeit von 18 bis 7 Uhr", () => {
    expect(inQuietTime(new Date(2026, 10, 25, 17, 59))).toBe(false);
    expect(inQuietTime(new Date(2026, 10, 25, 18, 0))).toBe(true);
    expect(inQuietTime(new Date(2026, 10, 25, 6, 59))).toBe(true);
    expect(inQuietTime(new Date(2026, 10, 25, 7, 0))).toBe(false);
  });

  it("klingelt über mehrere Tabs nur einmal", () => {
    expect(seenUntil()).toBe(0);
    expect(claimUntil(5)).toBe(true);
    expect(claimUntil(5)).toBe(false);
    expect(claimUntil(4)).toBe(false);
    expect(claimUntil(6)).toBe(true);
    expect(seenUntil()).toBe(6);
  });
});
