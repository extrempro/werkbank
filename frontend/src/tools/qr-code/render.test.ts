import { describe, expect, it } from "vitest";
import { blockLayout, encodeText } from "./qr";
import {
  CENTER_LOAD_MAX,
  centerLayout,
  centerLoad,
  centerModules,
  clearCenter,
  colorWarnings,
  eclForCenter,
  encodeForCenter,
  pngScale,
  svgMarkup,
  svgPath,
} from "./render";

describe("svgPath", () => {
  it("fasst dunkle Module zeilenweise zusammen", () => {
    expect(
      svgPath(
        [
          [true, true, false],
          [false, true, true],
        ],
        4,
      ),
    ).toBe("M4 4h2v1h-2zM5 5h2v1h-2z");
  });
});

describe("svgMarkup", () => {
  it("enthält Hintergrund, Farben und Ruhezone", () => {
    const qr = encodeText("Test", { ecl: "M" });
    const svg = svgMarkup(qr, { margin: 4, foreground: "#112233", background: "#ffffff" });
    expect(svg).toContain(`viewBox="0 0 ${qr.size + 8} ${qr.size + 8}"`);
    expect(svg).toContain('fill="#112233"');
    expect(svg).toContain('fill="#ffffff"');
  });
});

describe("pngScale", () => {
  it("wählt ganzzahlige Pixel pro Modul", () => {
    const qr = encodeText("Test", { ecl: "M" }); // Version 1: 21 Module + 2 × 4 Rand = 29
    expect(pngScale(qr, 4, 512)).toEqual({ scale: 18, px: 522 });
    expect(pngScale(qr, 4, 10)).toEqual({ scale: 1, px: 29 });
  });
});

describe("colorWarnings", () => {
  it("warnt bei wenig Kontrast und invertierten Farben", () => {
    expect(colorWarnings("#000000", "#ffffff")).toEqual([]);
    expect(colorWarnings("#777777", "#888888")[0]).toMatch(/Kontrast/);
    expect(colorWarnings("#ffffff", "#000000")[0]).toMatch(/invertiert/);
  });
});

describe("Fehlerkorrektur unter der Mitte", () => {
  it("zählt die verdeckten Codewörter je Block", () => {
    const qr = encodeText("https://intranet.example.com/wiki/it", { ecl: "Q" });
    const small = centerLoad(qr, 3);
    const big = centerLoad(qr, 9);
    expect(small > 0).toBe(true);
    expect(big > small).toBe(true);
    // alles verdeckt: weit über der Grenze
    expect(centerLoad(qr, qr.size) > 1).toBe(true);
  });

  it("Aufbau der Blöcke passt zum Code", () => {
    for (const [text, ecl] of [
      ["a", "H"],
      ["x".repeat(200), "Q"],
      ["y".repeat(900), "M"],
    ] as const) {
      const qr = encodeText(text, { ecl });
      const { blockOf, blocks } = blockLayout(qr.version, ecl);
      expect(Math.max(...qr.codewordAt.flat())).toBe(blockOf.length - 1);
      expect(Math.max(...blockOf)).toBe(blocks - 1);
    }
  });

  it("kurze Inhalte bekommen einen größeren Code, damit die Mitte lesbar bleibt", () => {
    const plain = encodeText("abc", { ecl: "Q" });
    const { qr, load, safe } = encodeForCenter("abc", "L", 30);
    expect(plain.version).toBe(1);
    expect(qr.version > 1).toBe(true);
    expect(safe).toBe(true);
    expect(load <= CENTER_LOAD_MAX).toBe(true);
  });

  it("bleibt bei normalen Inhalten bei der kleinsten passenden Größe", () => {
    const text = "https://intranet.example.com/wiki/it-support";
    const { qr, safe } = encodeForCenter(text, "M", 22);
    expect(safe).toBe(true);
    expect(qr.ecl).toBe("Q");
    expect(qr.version).toBe(encodeText(text, { ecl: "Q" }).version);
    expect(encodeForCenter(text, "H", 22).qr.ecl).toBe("H");
  });

  it("jede Größe und Länge bleibt unter der Grenze", () => {
    for (const len of [1, 5, 20, 60, 150, 400, 1200]) {
      for (const percent of [15, 22, 30]) {
        const r = encodeForCenter("k".repeat(len), "L", percent);
        expect(r.safe).toBe(true);
        expect(r.load <= CENTER_LOAD_MAX).toBe(true);
      }
    }
  });

  it("zu langer Inhalt wird weiter als Fehler gemeldet", () => {
    expect(() => encodeForCenter("z".repeat(5000), "L", 22)).toThrow("zu lang");
  });
});

describe("Mitte mit Logo oder Kürzel", () => {
  const qr = encodeText("https://intranet.example.com/wiki/it", { ecl: "Q" });
  const base = { margin: 4, foreground: "#000000", background: "#ffffff" };

  it("überdeckt eine ungerade Zahl Module, nie mehr als gewünscht", () => {
    expect(centerModules(21, 22)).toBe(3);
    expect(centerModules(21, 30)).toBe(5);
    expect(centerModules(33, 22)).toBe(7);
    expect(centerModules(33, 99)).toBe(9);
    expect(centerModules(177, 30)).toBe(53);
    for (const size of [21, 25, 29, 57, 177]) {
      for (const p of [15, 22, 30]) {
        const k = centerModules(size, p);
        expect(k % 2).toBe(1);
        expect(k <= Math.max(3, (size * p) / 100)).toBe(true);
      }
    }
  });

  it("räumt genau die Mitte frei", () => {
    const full = Array.from({ length: 7 }, () => Array.from({ length: 7 }, () => true));
    const cleared = clearCenter(full, 3);
    expect(cleared.map((row) => row.map((d) => (d ? "#" : ".")).join(""))).toEqual([
      "#######",
      "#######",
      "##...##",
      "##...##",
      "##...##",
      "#######",
      "#######",
    ]);
    expect(full[3]![3]).toBe(true);
  });

  it("hebt die Fehlerkorrektur nur bei Bedarf an", () => {
    expect(eclForCenter("L", true)).toBe("Q");
    expect(eclForCenter("M", true)).toBe("Q");
    expect(eclForCenter("H", true)).toBe("H");
    expect(eclForCenter("L", false)).toBe("L");
  });

  it("ohne Inhalt gibt es keine Mitte", () => {
    expect(centerLayout(qr, base)).toBe(null);
    expect(centerLayout(qr, { ...base, center: { kind: "text", text: "  " } })).toBe(null);
    expect(centerLayout(qr, { ...base, center: { kind: "image", href: "" } })).toBe(null);
  });

  it("Kürzel: höchstens drei Zeichen, mittig, passt in die Fläche", () => {
    const c = centerLayout(qr, {
      ...base,
      center: { kind: "text", text: " ABCD " },
      centerPercent: 22,
    })!;
    expect(c.text!.value).toBe("ABC");
    expect(c.text!.x).toBe(4 + qr.size / 2);
    expect(c.text!.fontSize * 3 * 0.72 <= c.inner.size).toBe(true);
    expect(c.coverage < 0.1).toBe(true);
    const wide = centerLayout(qr, {
      ...base,
      center: { kind: "text", text: "WWW" },
      textWidth: 2.8,
    })!;
    expect(wide.text!.fontSize * 2.8 <= wide.inner.size).toBe(true);
  });

  it("Logo behält sein Seitenverhältnis", () => {
    const c = centerLayout(qr, {
      ...base,
      center: { kind: "image", href: "data:image/png;base64,AAAA", width: 200, height: 100 },
    })!;
    expect(c.image!.width).toBe(c.inner.size);
    expect(c.image!.height).toBe(c.inner.size / 2);
    expect(c.image!.y + c.image!.height / 2).toBe(4 + qr.size / 2);
  });

  it("SVG enthält Kürzel bzw. Logo und keine Module darunter", () => {
    const text = svgMarkup(qr, { ...base, center: { kind: "text", text: "<A&" } });
    expect(text).toContain(">&lt;A&amp;</text>");
    expect(text).toContain('font-weight="700"');
    const logo = svgMarkup(qr, {
      ...base,
      center: { kind: "image", href: 'data:image/svg+xml,<svg a="1">' },
    });
    expect(logo).toContain('<image href="data:image/svg+xml,&lt;svg a=&quot;1&quot;&gt;"');
    expect(
      svgMarkup(qr, base).length >
        svgMarkup(qr, { ...base, center: { kind: "text", text: "IT" }, centerPercent: 30 }).length -
          200,
    ).toBe(true);
  });
});
