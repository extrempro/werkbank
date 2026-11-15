import { describe, expect, it } from "vitest";
import { htmlDecode, htmlEncode } from "../html-entities/html";
import { parseUrl, urlDecode, urlEncode } from "./url";

describe("URL", () => {
  it("kodiert und dekodiert", () => {
    expect(urlEncode("a b&c=ä/", "component")).toBe("a%20b%26c%3D%C3%A4%2F");
    expect(urlEncode("a b", "form")).toBe("a+b");
    expect(urlEncode("https://x.de/a b?q=1", "uri")).toBe("https://x.de/a%20b?q=1");
    expect(urlDecode("a+b%C3%A4", true)).toBe("a bä");
    expect(() => urlDecode("%E0%A4%A", false)).toThrow();
  });

  it("zerlegt URLs", () => {
    const u = parseUrl("https://user:pw@example.com:8443/pfad/ä?x=1&y=a%20b#oben")!;
    expect(u).toMatchObject({
      protocol: "https",
      username: "user",
      password: "••••",
      host: "example.com",
      port: "8443",
      path: "/pfad/ä",
      hash: "oben",
    });
    expect(u.params).toEqual([
      { key: "x", value: "1" },
      { key: "y", value: "a b" },
    ]);
    expect(parseUrl("kein url")).toBeNull();
  });
});

describe("HTML-Entities", () => {
  it("kodiert in drei Stufen", () => {
    expect(htmlEncode('<a href="x">Grüße & €</a>', "minimal")).toBe(
      "&lt;a href=&quot;x&quot;&gt;Grüße &amp; €&lt;/a&gt;",
    );
    expect(htmlEncode("Grüße €", "named")).toBe("Gr&uuml;&szlig;e &euro;");
    expect(htmlEncode("ü😀", "numeric")).toBe("&#252;&#128512;");
  });
  it("dekodiert benannte und numerische", () => {
    expect(htmlDecode("&lt;b&gt; &auml;&#x1F600;&#228; &unbekannt;")).toBe("<b> ä😀ä &unbekannt;");
  });
});
