import { describe, expect, it } from "vitest";
import { find, formatXml, minifyXml, parseXml, textOf } from "./xml";

describe("XML", () => {
  it("formatiert und minimiert", () => {
    const nodes = parseXml(
      '<?xml version="1.0"?><a x="1 &amp; 2"><b>Text &lt;hier&gt;</b><c/><!-- k --><d><![CDATA[<roh>]]></d></a>',
    );
    expect(formatXml(nodes)).toBe(
      [
        '<?xml version="1.0"?>',
        '<a x="1 &amp; 2">',
        "  <b>Text &lt;hier&gt;</b>",
        "  <c/>",
        "  <!-- k -->",
        "  <d><![CDATA[<roh>]]></d>",
        "</a>",
      ].join("\n"),
    );
    expect(minifyXml(parseXml("<a>\n  <b> x </b>\n</a>"))).toBe("<a><b>x</b></a>");
    expect(textOf(find(nodes, "b"))).toBe("Text <hier>");
  });

  it("meldet Fehler mit Zeile", () => {
    expect(() => parseXml("<a>\n<b></a>")).toThrow(/Zeile 2: <\/a> passt nicht zu <b>/);
    expect(() => parseXml("<a>")).toThrow(/nicht geschlossen/);
    expect(() => parseXml('<a x="1" x="2"/>')).toThrow(/doppelt/);
    expect(() => parseXml("nur text")).toThrow();
  });
});
