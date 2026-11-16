import { describe, expect, it } from "vitest";
import { makePassphrase, passphraseBits } from "../passphrase/passphrase";
import { lorem } from "../lorem/lorem";
import { checkStrength, countInRange, durationText } from "./strength";

describe("Passwortstärke", () => {
  it("erkennt schwache Muster", () => {
    expect(checkStrength("Passwort1").score).toBe(0);
    expect(checkStrength("P@ssw0rd").score).toBe(0);
    expect(checkStrength("Sommer2025!").score).toBeLessThanOrEqual(1);
    expect(checkStrength("qwertz12345").findings.join()).toMatch(/Tastaturmuster/);
    expect(checkStrength("aaaaaaaaaaaa").score).toBeLessThanOrEqual(1);
  });
  it("bewertet zufällige lange Kennwörter hoch", () => {
    expect(checkStrength("k7#Qm!vR2x@Lp9$wTz").score).toBe(4);
    expect(checkStrength("Wolke-Fenster-Kaffee-Brücke-Garten").score).toBeGreaterThanOrEqual(3);
  });
  it("Zeiten in Klartext", () => {
    expect(durationText(0.5)).toBe("sofort");
    expect(durationText(7200)).toBe("2 Stunden");
    expect(durationText(1e30)).toBe("praktisch nie");
  });
});

describe("Passphrase & Blindtext", () => {
  it("erzeugt Passphrasen", () => {
    const list = ["alpha", "beta", "gamma", "delta"];
    const p = makePassphrase(list, { words: 5, separator: "-", capitalize: true, addNumber: true, addSymbol: false });
    expect(p.split("-").length).toBe(5);
    expect(p).toMatch(/\d/);
    expect(p.split("-").every((w) => /^[A-Z]/.test(w))).toBe(true);
    expect(Math.round(passphraseBits(7776, { words: 6, separator: " ", capitalize: false, addNumber: false, addSymbol: false }))).toBe(78);
  });
  it("Lorem ipsum", () => {
    expect(lorem("words", 5, true)).toBe("lorem ipsum dolor sit amet");
    expect(lorem("paragraphs", 3, true).split("\n\n").length).toBe(3);
  });
});

describe("Datenlecks", () => {
  it("findet das Hash-Ende in der Liste", () => {
    const body = "0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2\r\n011053FD0102E94D6AE2F8B83D76FAF94F6:0";
    expect(countInRange(body, "00D4F6E8FA6EECAD2A3AA415EEC418D38EC")).toBe(2);
    expect(countInRange(body, "011053FD0102E94D6AE2F8B83D76FAF94F6")).toBe(0);
    expect(countInRange(body, "FFFF")).toBe(0);
  });
});
