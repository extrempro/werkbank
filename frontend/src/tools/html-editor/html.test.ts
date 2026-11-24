import { describe, expect, it } from "vitest";
import { countText, formatHtml, TEMPLATES } from "./html";

describe("HTML-Editor", () => {
  it("rückt Blockelemente ein und lässt Fließtext zusammen", () => {
    expect(formatHtml("<div><p>Hallo <strong>Welt</strong>!</p><br><hr></div>")).toBe(
      [
        "<div>",
        "  <p>",
        "    Hallo <strong>Welt</strong>!",
        "  </p>",
        "  <br>",
        "  <hr>",
        "</div>",
      ].join("\n"),
    );
  });

  it("lässt pre, style und Kommentare unverändert", () => {
    const html = "<div><pre>  a\n   b</pre><style>p { color: red; }</style><!-- x --></div>";
    expect(formatHtml(html)).toBe(
      [
        "<div>",
        "  <pre>  a\n   b</pre>",
        "  <style>p { color: red; }</style>",
        "  <!-- x -->",
        "</div>",
      ].join("\n"),
    );
  });

  it("verträgt kaputtes HTML und leere Eingabe", () => {
    expect(formatHtml("")).toBe("");
    expect(formatHtml("</div></div>a < b")).toBe("</div>\n</div>\na < b");
    expect(formatHtml("<!doctype html><html><body>x</body></html>")).toBe(
      "<!doctype html>\n<html>\n  <body>\n    x\n  </body>\n</html>",
    );
  });

  it("zählt Zeilen und Zeichen und startet leer und hat nur die Vorlage Tabelle", () => {
    expect(countText("")).toEqual({ lines: 0, chars: 0 });
    expect(countText("a\nb")).toEqual({ lines: 2, chars: 3 });
    expect(TEMPLATES.leer.html).toBe("");
    expect(Object.keys(TEMPLATES)).toEqual(["leer", "tabelle"]);
  });
});
