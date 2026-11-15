import { describe, expect, it } from "vitest";
import { conversions } from "../case/case";
import { cleanList, compareLists, formatList } from "../list-clean/list";
import { cleanSpecialChars, findSpecialChars, textStats } from "../text-stats/stats";
import { diffLines, diffWords, sideBySide, unifiedDiff } from "./diff";

describe("Diff", () => {
  it("Zeilen", () => {
    const d = diffLines("a\nb\nc\nd", "a\nB\nc\nd\ne", { ignoreCase: false, ignoreWhitespace: false });
    expect(d.ops.map((o) => `${o.type[0]}${o.text}`)).toEqual(["ea", "db", "iB", "ec", "ed", "ie"]);
    expect([d.added, d.removed]).toEqual([2, 1]);
    expect(diffLines("a\nb", "A\n b ", { ignoreCase: true, ignoreWhitespace: true }).added).toBe(0);
    const rows = sideBySide(d.ops);
    expect(rows.map((r) => r.type)).toEqual(["equal", "change", "equal", "equal", "insert"]);
    expect(unifiedDiff(d.ops, 1)).toContain("@@ -1,4 +1,5 @@");
  });
  it("Wörter", () => {
    expect(diffWords("Server alt läuft", "Server neu läuft").filter((p) => p.type !== "equal").map((p) => p.type + ":" + p.text)).toEqual(["delete:alt", "insert:neu"]);
  });
});

describe("Listen", () => {
  const o = { trim: true, removeEmpty: true, dedupe: "ignoreCase" as const, sort: "natural" as const, splitOn: "any" as const, caseChange: "none" as const };
  it("bereinigt und formatiert", () => {
    const r = cleanList("srv10\n srv2 ,SRV2;\n\nsrv1", o);
    expect(r.items).toEqual(["srv1", "srv2", "srv10"]);
    expect(r.removedDuplicates).toBe(1);
    expect(formatList(["a", "b'c"], "sql")).toBe("IN ('a', 'b''c')");
    expect(formatList(["a", "$x"], "powershell")).toBe('@("a", "`$x")');
    expect(formatList(["a.b", "c"], "regex")).toBe("a\\.b|c");
  });
  it("vergleicht", () => {
    expect(compareLists(["a", "B"], ["b", "c"], true)).toEqual({ onlyA: ["a"], onlyB: ["c"], both: ["B"] });
  });
});

describe("Schreibweisen & Zählen", () => {
  const conv = (id: string, t: string) => conversions.find((c) => c.id === id)!.fn(t);
  it("wandelt um", () => {
    expect(conv("camel", "Mein schöner Server-Name")).toBe("meinSchönerServerName");
    expect(conv("snake", "getHTTPResponseCode")).toBe("get_http_response_code");
    expect(conv("kebab", "UserAccountControl")).toBe("user-account-control");
    expect(conv("title", "hallo welt aus köln")).toBe("Hallo Welt Aus Köln");
    expect(conv("ascii", "Größe Café")).toBe("Groesse Cafe");
  });
  it("zählt und findet unsichtbare Zeichen", () => {
    const s = textStats("Hallo Welt.\nZweite Zeile! 😀");
    expect(s).toMatchObject({ words: 4, lines: 2, sentences: 2 });
    expect(s.chars).toBe(27);
    const sp = findSpecialChars("pass​wort x");
    expect(sp.map((c) => c.code)).toEqual(["U+200B", "U+00A0"]);
    expect(cleanSpecialChars("„a“​–b ")).toBe('"a"-b ');
  });
});
