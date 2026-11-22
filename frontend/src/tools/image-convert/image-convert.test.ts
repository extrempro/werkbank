import { describe, expect, it } from "vitest";
import { detectFormat, formatBytes, outputName, sizeChange } from "./formats";
import { buildIco, readIcoSizes } from "./ico";
import { fitSquare, targetSize } from "./resize";
import { bytesToBase64, embedRasterInSvg, svgIntrinsicSize } from "./svg";
import { crc32, createZip } from "./zip";

const bytes = (...parts: (number[] | string)[]) =>
  Uint8Array.from(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

describe("detectFormat", () => {
  it("erkennt Formate an der Signatur", () => {
    expect(detectFormat(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(detectFormat(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(detectFormat(bytes("GIF89a"))).toBe("gif");
    expect(detectFormat(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("webp");
    expect(detectFormat(bytes("BM", [0, 0, 0, 0]))).toBe("bmp");
    expect(detectFormat(bytes([0, 0, 1, 0, 1, 0]))).toBe("ico");
    expect(detectFormat(bytes([0, 0, 0, 0x1c], "ftypavif"))).toBe("avif");
    expect(detectFormat(bytes([0, 0, 0, 0x18], "ftypheic"))).toBe("heic");
    expect(detectFormat(bytes([0x49, 0x49, 0x2a, 0x00]))).toBe("tiff");
    expect(detectFormat(bytes("%PDF-1.7\n"))).toBe("pdf");
  });

  it("erkennt SVG auch mit XML-Kopf, Kommentar und BOM", () => {
    expect(detectFormat(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe("svg");
    expect(
      detectFormat(new TextEncoder().encode('﻿<?xml version="1.0"?>\n<!-- Logo -->\n<svg>')),
    ).toBe("svg");
    expect(detectFormat(bytes("<html><svg></svg></html>"))).toBe("unknown");
    // viele Kommentare ohne SVG: schnell und ohne Treffer
    expect(detectFormat(bytes(`<!--${"--><!--".repeat(150)}`))).toBe("unknown");
    expect(detectFormat(bytes('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN">\n<svg>'))).toBe(
      "svg",
    );
    expect(detectFormat(bytes("Hallo"))).toBe("unknown");
  });
});

describe("Dateinamen und Größen", () => {
  it("tauscht die Endung und vermeidet doppelte Namen", () => {
    const taken = new Set<string>();
    expect(outputName("Foto.HEIC", "webp", taken)).toBe("Foto.webp");
    expect(outputName("Foto.jpg", "webp", taken)).toBe("Foto-2.webp");
    expect(outputName("logo", "png", taken)).toBe("logo.png");
    expect(outputName("archiv.v2.tar.png", "jpg", taken)).toBe("archiv.v2.tar.jpg");
  });

  it("formatiert Größen und Änderungen", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1,5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(sizeChange(1000, 370)).toBe("−63 %");
    expect(sizeChange(1000, 1120)).toBe("+12 %");
    expect(sizeChange(113, 12726)).toBe("×113");
  });
});

describe("targetSize", () => {
  it("hält das Seitenverhältnis", () => {
    expect(targetSize(4000, 3000, { mode: "width", value: 1000, noUpscale: true })).toEqual({
      width: 1000,
      height: 750,
    });
    expect(targetSize(4000, 3000, { mode: "height", value: 600, noUpscale: true })).toEqual({
      width: 800,
      height: 600,
    });
    expect(targetSize(3000, 4000, { mode: "longest", value: 2000, noUpscale: true })).toEqual({
      width: 1500,
      height: 2000,
    });
    expect(targetSize(4000, 3000, { mode: "percent", value: 25, noUpscale: true })).toEqual({
      width: 1000,
      height: 750,
    });
    expect(targetSize(4000, 3000, { mode: "original", value: 0, noUpscale: true })).toEqual({
      width: 4000,
      height: 3000,
    });
  });

  it("vergrößert nur, wenn erlaubt", () => {
    expect(targetSize(200, 100, { mode: "width", value: 400, noUpscale: true })).toEqual({
      width: 200,
      height: 100,
    });
    expect(targetSize(200, 100, { mode: "width", value: 400, noUpscale: false })).toEqual({
      width: 400,
      height: 200,
    });
  });

  it("begrenzt auf die maximale Canvas-Größe", () => {
    expect(targetSize(1000, 500, { mode: "percent", value: 10000, noUpscale: false })).toEqual({
      width: 16384,
      height: 8192,
    });
  });

  it("passt Bilder in ein Quadrat ein", () => {
    expect(fitSquare(200, 100, 32)).toEqual({ x: 0, y: 8, width: 32, height: 16 });
    expect(fitSquare(50, 50, 16)).toEqual({ x: 0, y: 0, width: 16, height: 16 });
  });
});

describe("ZIP", () => {
  it("berechnet CRC-32 korrekt", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("schreibt Kopf- und Endsätze", () => {
    const zip = createZip([
      { name: "a.txt", data: new TextEncoder().encode("Hallo") },
      { name: "Grüße.png", data: new Uint8Array([1, 2, 3]) },
    ]);
    const v = new DataView(zip.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(v.getUint32(end, true)).toBe(0x06054b50);
    expect(v.getUint16(end + 10, true)).toBe(2);
  });
});

describe("ICO", () => {
  it("setzt Verzeichnis und Größen (256 als 0)", () => {
    const ico = buildIco([
      { size: 256, png: new Uint8Array(10) },
      { size: 16, png: new Uint8Array(5) },
    ]);
    expect(readIcoSizes(ico)).toEqual([16, 256]);
    const v = new DataView(ico.buffer);
    expect(v.getUint32(6 + 12, true)).toBe(6 + 32); // erstes Bild direkt nach dem Verzeichnis
    expect(ico.length).toBe(6 + 32 + 15);
  });

  it("verlangt mindestens eine Größe", () => {
    expect(() => buildIco([])).toThrow();
  });
});

describe("SVG", () => {
  it("liest die Eigengröße", () => {
    expect(svgIntrinsicSize('<svg width="200" height="100">')).toMatchObject({
      width: 200,
      height: 100,
    });
    expect(svgIntrinsicSize('<svg width="10mm" height="5mm">')).toMatchObject({
      width: 38,
      height: 19,
    });
    expect(svgIntrinsicSize('<svg viewBox="0 0 24 12">')).toMatchObject({
      width: 1024,
      height: 512,
      fromViewBox: true,
    });
    expect(svgIntrinsicSize('<svg width="300" viewBox="0 0 30 10">')).toMatchObject({
      width: 300,
      height: 100,
    });
    expect(
      svgIntrinsicSize('<svg width="100%" height="100%" viewBox="0 0 2000 1000">'),
    ).toMatchObject({ width: 2000, height: 1000 });
    expect(svgIntrinsicSize("<svg>")).toMatchObject({ width: 1024, height: 1024 });
  });

  it("bettet ein Rasterbild ein", () => {
    const svg = embedRasterInSvg(bytesToBase64(new Uint8Array([1, 2, 3])), 10, 20);
    expect(svg).toContain('viewBox="0 0 10 20"');
    expect(svg).toContain("data:image/png;base64,AQID");
  });
});
