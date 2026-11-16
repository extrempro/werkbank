import { describe, expect, it } from "vitest";
import { expandIpv6, isValidHostname, parseDohResponse, reverseName } from "./doh";

describe("reverseName", () => {
  it("bildet IPv4-PTR-Namen", () => {
    expect(reverseName("192.0.2.10")).toBe("10.2.0.192.in-addr.arpa");
  });

  it("bildet IPv6-PTR-Namen", () => {
    expect(reverseName("2001:db8::1")).toBe(
      "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa",
    );
  });

  it("lehnt Nicht-IPs ab", () => {
    expect(() => reverseName("example.com")).toThrow();
    expect(() => reverseName("300.1.1.1")).toThrow();
  });
});

describe("expandIpv6", () => {
  it("expandiert verkürzte Adressen", () => {
    expect(expandIpv6("::1")).toBe("0000:0000:0000:0000:0000:0000:0000:0001");
    expect(expandIpv6("fe80::")).toBe("fe80:0000:0000:0000:0000:0000:0000:0000");
    expect(expandIpv6("1:2:3:4:5:6:7:8")).toBe("0001:0002:0003:0004:0005:0006:0007:0008");
  });

  it("lehnt ungültige Adressen ab", () => {
    expect(() => expandIpv6("1::2::3")).toThrow();
    expect(() => expandIpv6("1:2:3")).toThrow();
    expect(() => expandIpv6("12345::1")).toThrow();
  });
});

describe("isValidHostname", () => {
  it("prüft Domainnamen", () => {
    expect(isValidHostname("example.com")).toBe(true);
    expect(isValidHostname("_dmarc.example.com")).toBe(true);
    expect(isValidHostname("bad domain.com")).toBe(false);
    expect(isValidHostname("-bad.com")).toBe(false);
  });
});

describe("parseDohResponse", () => {
  it("übersetzt Typen und Status", () => {
    const r = parseDohResponse("example.com", {
      Status: 0,
      AD: true,
      Answer: [{ name: "example.com.", type: 1, TTL: 300, data: "93.184.215.14" }],
    });
    expect(r).toEqual({
      query: "example.com",
      status: "NOERROR",
      authenticated: true,
      answers: [{ name: "example.com", type: "A", ttl: 300, data: "93.184.215.14" }],
    });
  });

  it("liefert NXDOMAIN ohne Antworten", () => {
    expect(parseDohResponse("nope.invalid", { Status: 3 })).toMatchObject({ status: "NXDOMAIN", answers: [] });
  });
});
