import { describe, expect, it } from "vitest";
import { parseCrtSh, subdomainsToCsv, toAscii, toQueryName } from "./subdomains";

describe("Eingabe → abfragbarer Name", () => {
  it("normale Domains, Punkt am Ende, URL", () => {
    expect(toQueryName("Example.COM.")).toEqual({ name: "example.com", note: undefined });
    expect(toQueryName("https://www.example.com/pfad").name).toBe("www.example.com");
  });

  it("Wildcard nur ganz vorne", () => {
    const q = toQueryName("*.example.com");
    expect(q.name).toBe("*.example.com");
    expect(q.note).toMatch(/Wildcard-Eintrag selbst/);
    expect(() => toQueryName("www.*.example.com")).toThrow(/nur ganz vorne/);
  });

  it("Umlaute als Punycode", () => {
    expect(toAscii("bürger.hamburg")).toBe("xn--brger-kva.hamburg");
    const q = toQueryName("*.Bürger.hamburg");
    expect(q.name).toBe("*.xn--brger-kva.hamburg");
    expect(q.note).toMatch(/Umlaute umgewandelt/);
  });

  it("lehnt Unsinn ab", () => {
    expect(() => toQueryName(".hamburg")).toThrow();
    expect(() => toQueryName("a b.de")).toThrow();
    expect(() => toQueryName("")).toThrow();
  });
});

describe("Zertifikats-Logs", () => {
  it("sammelt Namen mit neuestem Datum und Wildcard-Kennung", () => {
    const json = [
      { name_value: "www.example.com\nexample.com", not_before: "2024-01-10T00:00:00" },
      { name_value: "*.app.example.com\nWWW.example.com", not_before: "2025-03-01T12:00:00" },
      { name_value: "other.org\nexample.com.evil.net", not_before: "2025-05-01T00:00:00" },
      { common_name: "mail.example.com" },
    ];
    const r = parseCrtSh(json, "example.com");
    const byName = Object.fromEntries(r.map((x) => [x.name, x]));
    expect(Object.keys(byName).sort()).toEqual([
      "app.example.com",
      "example.com",
      "mail.example.com",
      "www.example.com",
    ]);
    expect(byName["www.example.com"]!.lastSeen!.toISOString()).toBe("2025-03-01T12:00:00.000Z");
    expect(byName["app.example.com"]!.wildcard).toBe(true);
    expect(byName["mail.example.com"]!.lastSeen).toBeUndefined();
    expect(parseCrtSh({ error: true }, "example.com")).toEqual([]);
  });

  it("CSV", () => {
    const csv = subdomainsToCsv([
      {
        name: "www.example.com",
        sources: ["crtsh", "list"],
        certWildcard: false,
        addresses: ["192.0.2.1"],
        live: true,
        viaWildcard: false,
        lastSeen: new Date("2025-03-01T00:00:00Z"),
      },
      {
        name: "alt.example.com",
        sources: ["crtsh"],
        certWildcard: false,
        addresses: [],
        live: false,
        viaWildcard: false,
      },
    ]);
    expect(csv).toContain(
      "www.example.com;aktiv;;192.0.2.1;Zertifikats-Log, Namensliste;2025-03-01",
    );
    expect(csv).toContain("alt.example.com;löst nicht auf");
  });
});
