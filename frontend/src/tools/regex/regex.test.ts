import { describe, expect, it } from "vitest";
import { cleanFlags, runRegex, type RegexResult } from "./regex";

function run(pattern: string, flags: string, text: string, replacement: string | null) {
  const result = runRegex(pattern, flags, text, replacement);
  if ("error" in result) {
    throw new Error(result.error);
  }
  return result satisfies RegexResult;
}

describe("Regex-Tester", () => {
  it("findet Treffer und zerlegt den Text zum Markieren", () => {
    const result = run(String.raw`(\d+)\.(\d+)`, "g", "a 1.2 b 30.4", null);
    expect(result.matches.map((match) => match[0])).toEqual(["1.2", "30.4"]);
    expect(result.parts).toEqual([
      { text: "a " },
      { text: "1.2", hit: 0 },
      { text: " b " },
      { text: "30.4", hit: 1 },
      { text: "" },
    ]);
    expect(result.replaced).toBeNull();
  });

  it("ohne g zählt nur der erste Treffer, auch beim Ersetzen", () => {
    const result = run("a", "", "aaa", "b");
    expect(result.matches).toHaveLength(1);
    expect(result.replaced).toBe("baa");
    expect(run("a", "g", "aaa", "b").replaced).toBe("bbb");
  });

  it("kennt die Namen benannter Gruppen", () => {
    const result = run(
      String.raw`(?<tag>\d+)\.(\d+)\.(?<jahr>\d{4})`,
      "g",
      "7.11.2026",
      "$<jahr>",
    );
    expect(result.groupNames[1]).toBe("tag");
    expect(result.groupNames[2]).toBeUndefined();
    expect(result.groupNames[3]).toBe("jahr");
    // Maskierte Klammern und Zeichenklassen zählen nicht als Gruppe.
    expect(run(String.raw`\((?<a>[()x])`, "", "(x", null).groupNames[1]).toBe("a");
    expect(result.replaced).toBe("2026");
  });

  it("meldet ungültige Ausdrücke und lässt nur bekannte Schalter zu", () => {
    expect(runRegex("(", "g", "x", null)).toHaveProperty("error");
    expect(cleanFlags("ggixyz")).toBe("gi");
    expect(run("A", "ix", "a", null).matches).toHaveLength(1);
  });

  it("markiert leere Treffer sichtbar", () => {
    expect(run("x*", "", "ab", null).parts[0]).toEqual({ text: "∅", hit: 0 });
  });
});
