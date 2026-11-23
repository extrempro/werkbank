import { describe, expect, it } from "vitest";
import { nextTop } from "./stickyPanes";

describe("Ansicht rechts läuft mit der Seite mit", () => {
  const base = 80;

  it("bleibt oben stehen, solange die Ansicht ins Fenster passt", () => {
    expect(nextTop({ base, top: base }, 300, 600, 900)).toBe(base);
  });

  it("läuft beim Scrollen nach unten mit, bis ihr Ende sichtbar ist", () => {
    // 1500 hoch, Fenster 900: Ende sichtbar bei top = 900 - 1500 - 16 = -616
    expect(nextTop({ base, top: base }, 200, 1500, 900)).toBe(-120);
    expect(nextTop({ base, top: -120 }, 2000, 1500, 900)).toBe(-616);
  });

  it("läuft beim Scrollen nach oben zurück, bis ihr Anfang wieder oben steht", () => {
    expect(nextTop({ base, top: -616 }, -100, 1500, 900)).toBe(-516);
    expect(nextTop({ base, top: -516 }, -5000, 1500, 900)).toBe(base);
  });
});
