import { describe, expect, it } from "vitest";
import { buildPdf, pageLayout, parsePageRange, type PdfPage } from "./pdf";
import { renderScale } from "./pdfread";

const text = (data: Uint8Array) => new TextDecoder("latin1").decode(data);

const page = (overrides: Partial<PdfPage> = {}): PdfPage => ({
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  pixelWidth: 4,
  pixelHeight: 2,
  ...pageLayout(4, 2, "bild"),
  ...overrides,
});

describe("pageLayout", () => {
  it("legt ein Hochformat-Bild mit Rand auf A4 hoch", () => {
    const layout = pageLayout(2000, 3000, "a4");
    expect(layout.pageWidth).toBe(595.28);
    expect(layout.pageHeight).toBe(841.89);
    // eingepasst, Seitenverhältnis bleibt, mittig
    expect(layout.width / layout.height).toBeCloseTo(2 / 3, 2);
    expect(layout.height).toBeCloseTo(841.89 - 2 * 28.35, 1);
    expect(layout.x).toBeCloseTo((595.28 - layout.width) / 2, 1);
  });

  it("dreht A4 für Querformat und vergrößert kleine Bilder nicht", () => {
    const layout = pageLayout(400, 200, "a4");
    expect(layout.pageWidth).toBe(841.89);
    expect(layout.pageHeight).toBe(595.28);
    expect(layout.width).toBe(300);
    expect(layout.height).toBe(150);
  });

  it("macht die Seite so groß wie das Bild (96 dpi), höchstens 200 Zoll", () => {
    expect(pageLayout(800, 600, "bild")).toEqual({
      pageWidth: 600,
      pageHeight: 450,
      x: 0,
      y: 0,
      width: 600,
      height: 450,
    });
    const huge = pageLayout(40000, 20000, "bild");
    expect(huge.pageWidth).toBe(14400);
    expect(huge.pageHeight).toBe(7200);
  });
});

describe("buildPdf", () => {
  it("baut eine gültige Struktur mit einem Bild je Seite", () => {
    const pdf = buildPdf([page(), page({ pixelWidth: 2, pixelHeight: 4 })]);
    const content = text(pdf);
    expect(content.startsWith("%PDF-1.4\n")).toBe(true);
    expect(content).toContain("/Type /Pages /Kids [4 0 R 7 0 R] /Count 2");
    expect(content.match(/\/Subtype \/Image/g)).toHaveLength(2);
    expect(content).toContain("/Filter /DCTDecode /Length 4");
    expect(content.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("verweist in der Tabelle auf die richtigen Stellen", () => {
    const pdf = buildPdf([page()]);
    const content = text(pdf);
    const start = Number(/startxref\n(\d+)/.exec(content)![1]);
    expect(content.slice(start, start + 4)).toBe("xref");
    const offsets = [...content.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(offsets).toHaveLength(6);
    offsets.forEach((offset, index) => {
      expect(content.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
    });
  });

  it("lehnt eine PDF ohne Seiten ab", () => {
    expect(() => buildPdf([])).toThrow();
  });
});

describe("parsePageRange", () => {
  it("liest Seiten und Bereiche", () => {
    expect(parsePageRange("", 3)).toEqual([1, 2, 3]);
    expect(parsePageRange("2", 3)).toEqual([2]);
    expect(parsePageRange("1-3, 5", 6)).toEqual([1, 2, 3, 5]);
    expect(parsePageRange("3–4,1,3", 4)).toEqual([1, 3, 4]);
  });

  it("lehnt Unsinn und fehlende Seiten ab", () => {
    expect(parsePageRange("0", 3)).toBeNull();
    expect(parsePageRange("4", 3)).toBeNull();
    expect(parsePageRange("3-1", 3)).toBeNull();
    expect(parsePageRange("a", 3)).toBeNull();
    expect(parsePageRange("1-", 3)).toBeNull();
  });
});

describe("renderScale", () => {
  it("nimmt die gewünschte Auflösung, solange sie in den Browser passt", () => {
    expect(renderScale(595, 842, 150)).toBeCloseTo(150 / 72, 5);
  });

  it("begrenzt sehr große Seiten", () => {
    // Plakat 2 × 2 m bei 300 dpi wäre viel zu groß
    const scale = renderScale(5669, 5669, 300);
    expect(5669 * scale).toBeLessThanOrEqual(10000);
    expect(5669 * scale * 5669 * scale).toBeLessThanOrEqual(40_000_000);
  });
});
