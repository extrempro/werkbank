import { describe, expect, it } from "vitest";
import {
  addEccAndInterleave,
  chooseMode,
  encodeDataCodewords,
  encodeText,
  formatBits,
  makeSegment,
  numDataCodewords,
  reedSolomonDivisor,
  reedSolomonRemainder,
  versionBits,
} from "./qr";

describe("Kapazität", () => {
  it("stimmt mit den Tabellen der Norm überein", () => {
    expect([
      numDataCodewords(1, "L"),
      numDataCodewords(1, "M"),
      numDataCodewords(1, "Q"),
      numDataCodewords(1, "H"),
    ]).toEqual([19, 16, 13, 9]);
    expect([
      numDataCodewords(2, "L"),
      numDataCodewords(2, "M"),
      numDataCodewords(2, "Q"),
      numDataCodewords(2, "H"),
    ]).toEqual([34, 28, 22, 16]);
    expect([
      numDataCodewords(10, "L"),
      numDataCodewords(10, "M"),
      numDataCodewords(10, "Q"),
      numDataCodewords(10, "H"),
    ]).toEqual([274, 216, 154, 122]);
    expect([
      numDataCodewords(40, "L"),
      numDataCodewords(40, "M"),
      numDataCodewords(40, "Q"),
      numDataCodewords(40, "H"),
    ]).toEqual([2956, 2334, 1666, 1276]);
  });
});

describe("Modus", () => {
  it("wählt den kompaktesten Modus", () => {
    expect(chooseMode("0123456789")).toBe("numeric");
    expect(chooseMode("HELLO WORLD")).toBe("alphanumeric");
    expect(chooseMode("https://example.com")).toBe("byte");
    expect(chooseMode("Grüße")).toBe("byte");
  });

  it("zählt bei UTF-8 Bytes statt Zeichen", () => {
    expect(makeSegment("ü").numChars).toBe(2);
  });
});

describe("Referenzbeispiel „HELLO WORLD“ (Version 1-M)", () => {
  const data = encodeDataCodewords(makeSegment("HELLO WORLD"), 1, "M");

  it("erzeugt die Daten-Codewörter", () => {
    expect(data).toEqual([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]);
  });

  it("erzeugt die Fehlerkorrektur-Codewörter", () => {
    expect(reedSolomonRemainder(data, reedSolomonDivisor(10))).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
    expect(addEccAndInterleave(data, 1, "M")).toHaveLength(26);
  });
});

describe("Format- und Versionsinformation", () => {
  it("entspricht den Werten der Norm", () => {
    expect(formatBits("M", 0).toString(2).padStart(15, "0")).toBe("101010000010010");
    expect(formatBits("L", 0).toString(2).padStart(15, "0")).toBe("111011111000100");
    expect(formatBits("H", 7).toString(2).padStart(15, "0")).toBe("000100000111011");
    expect(versionBits(7).toString(2).padStart(18, "0")).toBe("000111110010010100");
    expect(versionBits(40).toString(2).padStart(18, "0")).toBe("101000110001101001");
  });
});

describe("encodeText", () => {
  it("wählt die kleinste passende Version", () => {
    expect(encodeText("HELLO WORLD", { ecl: "M" })).toMatchObject({
      version: 1,
      size: 21,
      mode: "alphanumeric",
    });
    expect(encodeText("https://example.com", { ecl: "M" }).version).toBe(2);
  });

  it("setzt Finder-Muster und das dunkle Modul", () => {
    const qr = encodeText("Test", { ecl: "L" });
    const m = qr.modules;
    // Finder oben links: äußerer Ring dunkel, zweiter Ring hell, Kern dunkel
    expect([m[0]![0], m[1]![1], m[3]![3], m[0]![6], m[6]![6]]).toEqual([
      true,
      false,
      true,
      true,
      true,
    ]);
    expect(m[qr.size - 8]![8]).toBe(true);
  });

  it("meldet zu lange Inhalte", () => {
    expect(() => encodeText("x".repeat(3000), { ecl: "L" })).toThrow(/zu lang/);
    expect(encodeText("x".repeat(2953), { ecl: "L" }).version).toBe(40);
  });
});
