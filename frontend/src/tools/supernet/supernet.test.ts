import { describe, expect, it } from "vitest";
import { aggregate, cidrString, commonSupernet, parseEntries } from "./supernet";

const agg = (t: string, v: 4 | 6 = 4) =>
  aggregate(parseEntries(t).entries, v).cidrs.map((c) => cidrString(v, c));

describe("Supernetting", () => {
  it("benachbarte Netze zusammenfassen", () => {
    expect(agg("192.168.0.0/24\n192.168.1.0/24\n192.168.2.0/24\n192.168.3.0/24")).toEqual([
      "192.168.0.0/22",
    ]);
    expect(agg("10.0.0.0/24, 10.0.1.0/24, 10.0.2.0/24")).toEqual(["10.0.0.0/23", "10.0.2.0/24"]);
  });
  it("enthaltene und doppelte Einträge entfallen", () => {
    expect(agg("10.0.0.0/8\n10.1.2.0/24\n10.0.0.0/8\n10.255.255.255")).toEqual(["10.0.0.0/8"]);
  });
  it("Einzeladressen und Bereiche", () => {
    expect(agg("192.0.2.0 192.0.2.1 192.0.2.2 192.0.2.3")).toEqual(["192.0.2.0/30"]);
    expect(agg("192.0.2.10 - 192.0.2.20")).toEqual([
      "192.0.2.10/31",
      "192.0.2.12/30",
      "192.0.2.16/30",
      "192.0.2.20/32",
    ]);
  });
  it("IPv6 und Fehler", () => {
    const r = parseEntries("2001:db8::/33\n2001:db8:8000::/33\nquatsch\n10.0.0.5/24");
    expect(agg("2001:db8::/33\n2001:db8:8000::/33", 6)).toEqual(["2001:db8::/32"]);
    expect(r.invalid).toEqual(["quatsch"]);
    expect(r.unaligned).toEqual(["10.0.0.5/24"]);
  });
  it("gemeinsames Obernetz", () => {
    const s = commonSupernet(parseEntries("10.0.1.0/24 10.0.6.0/24").entries, 4)!;
    expect(cidrString(4, s)).toBe("10.0.0.0/21");
    expect(s.addresses).toBe(2048n);
  });
});
