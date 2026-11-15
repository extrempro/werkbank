import { describe, expect, it } from "vitest";
import {
  charsets,
  entropyBits,
  generatePassword,
  randomInt,
  strengthLabel,
  type PasswordOptions,
} from "./password";

const base: PasswordOptions = {
  length: 24,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
};

describe("generatePassword", () => {
  it("hat die gewünschte Länge und enthält jede Gruppe", () => {
    for (let i = 0; i < 200; i++) {
      const pw = generatePassword(base);
      expect(pw.length).toBe(24);
      expect(/[a-z]/.test(pw) && /[A-Z]/.test(pw) && /[0-9]/.test(pw)).toBe(true);
      expect([...pw].some((c) => charsets.symbols.includes(c))).toBe(true);
    }
  });

  it("verwendet nur gewählte Gruppen", () => {
    const pw = generatePassword({ ...base, upper: false, symbols: false, length: 40 });
    expect(/^[a-z0-9]+$/.test(pw)).toBe(true);
  });

  it("lässt mehrdeutige Zeichen weg", () => {
    for (let i = 0; i < 100; i++) {
      expect(
        /[Il1O0o]/.test(generatePassword({ ...base, excludeAmbiguous: true, length: 64 })),
      ).toBe(false);
    }
  });

  it("prüft die Eingaben", () => {
    expect(() =>
      generatePassword({ ...base, lower: false, upper: false, digits: false, symbols: false }),
    ).toThrow();
    expect(() => generatePassword({ ...base, length: 3 })).toThrow();
  });
});

describe("randomInt", () => {
  it("bleibt im Bereich und trifft alle Werte", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const n = randomInt(7);
      expect(n >= 0 && n < 7).toBe(true);
      seen.add(n);
    }
    expect(seen.size).toBe(7);
  });
});

describe("Entropie", () => {
  it("berechnet Bit und Bewertung", () => {
    // 26+26+10+28 = 90 Zeichen → 24 × log2(90) ≈ 156 Bit
    expect(entropyBits(base)).toBe(156);
    expect(strengthLabel(156).text).toBe("sehr stark");
    expect(strengthLabel(40).tone).toBe("error");
  });
});
