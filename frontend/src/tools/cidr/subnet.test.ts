import { describe, expect, it } from "vitest";
import { formatIp, parseIp } from "./ip";
import {
  calculateSubnet,
  cidrText,
  classify,
  contains,
  formatCount,
  formatCountShort,
  ipv4Class,
  neighbours,
  parseSubnetInput,
  plural,
  prefixForHosts,
  rangeToCidrs,
  reverseZones,
  splitSubnet,
} from "./subnet";

const ip = (s: string) => parseIp(s)!.value;
const v4 = (n: bigint) => formatIp(4, n);
const v6 = (n: bigint) => formatIp(6, n);

function net(input: string) {
  const p = parseSubnetInput(input);
  if (p.kind !== "network") throw new Error("kein Netz");
  return calculateSubnet(p.version, p.address, p.prefix);
}

describe("parseSubnetInput", () => {
  it("erkennt alle Schreibweisen", () => {
    expect(parseSubnetInput("192.168.10.77/24")).toMatchObject({ kind: "network", prefix: 24, source: "cidr" });
    expect(parseSubnetInput("192.168.10.77 / 24")).toMatchObject({ prefix: 24, source: "cidr" });
    expect(parseSubnetInput("10.1.2.3 255.255.0.0")).toMatchObject({ prefix: 16, source: "mask" });
    expect(parseSubnetInput("10.1.2.3/255.255.252.0")).toMatchObject({ prefix: 22, source: "mask" });
    expect(parseSubnetInput("172.16.0.0 0.0.15.255")).toMatchObject({ prefix: 20, source: "wildcard" });
    expect(parseSubnetInput("2001:db8:abcd::/48")).toMatchObject({ version: 6, prefix: 48, source: "cidr" });
  });

  it("nimmt bei einzelner Adresse das Standard-Präfix", () => {
    expect(parseSubnetInput("10.0.0.5")).toMatchObject({ prefix: 32, source: "address" });
    expect(parseSubnetInput("10.0.0.5", 24)).toMatchObject({ prefix: 24, source: "address" });
    expect(parseSubnetInput("2001:db8::1", 64)).toMatchObject({ prefix: 64 });
    expect(parseSubnetInput("2001:db8::1", 200)).toMatchObject({ prefix: 128 });
  });

  it("erkennt Bereiche in beide Richtungen", () => {
    expect(parseSubnetInput("10.0.0.10 - 10.0.0.50")).toMatchObject({ kind: "range", start: ip("10.0.0.10"), end: ip("10.0.0.50") });
    expect(parseSubnetInput("10.0.0.50–10.0.0.10")).toMatchObject({ kind: "range", start: ip("10.0.0.10") });
    expect(parseSubnetInput("10.0.0.1 bis 10.0.0.9")).toMatchObject({ kind: "range" });
  });

  it("meldet Fehler verständlich", () => {
    expect(() => parseSubnetInput("300.1.1.1/24")).toThrow(/keine gültige/);
    expect(() => parseSubnetInput("10.0.0.0/33")).toThrow(/Präfix/);
    expect(() => parseSubnetInput("10.0.0.0 255.0.255.0")).toThrow(/Maske/);
    expect(() => parseSubnetInput("10.0.0.1 - 2001:db8::1")).toThrow(/IP-Version/);
    expect(() => parseSubnetInput("")).toThrow();
  });
});

describe("calculateSubnet (IPv4)", () => {
  it("berechnet ein /24-Netz", () => {
    const n = net("192.168.10.77/24");
    expect(v4(n.network)).toBe("192.168.10.0");
    expect(v4(n.last)).toBe("192.168.10.255");
    expect(v4(n.mask)).toBe("255.255.255.0");
    expect(v4(n.hostMask)).toBe("0.0.0.255");
    expect(v4(n.firstHost)).toBe("192.168.10.1");
    expect(v4(n.lastHost)).toBe("192.168.10.254");
    expect(n.usable).toBe(254n);
    expect(n.offset).toBe(77n);
    expect(n.role).toBe("host");
  });

  it("behandelt /31, /32 und /0", () => {
    expect(net("10.0.0.0/31").usable).toBe(2n);
    expect(net("10.0.0.9/32")).toMatchObject({ usable: 1n, role: "single" });
    expect(v4(net("10.0.0.9/32").firstHost)).toBe("10.0.0.9");
    expect(net("0.0.0.0/0").usable).toBe(2n ** 32n - 2n);
  });

  it("erkennt Netz- und Broadcast-Adresse", () => {
    expect(net("192.168.1.0/24").role).toBe("network");
    expect(net("192.168.1.255/24").role).toBe("broadcast");
  });
});

describe("calculateSubnet (IPv6)", () => {
  it("berechnet ein /64-Netz", () => {
    const n = net("2001:db8:abcd:12::1/64");
    expect(v6(n.network)).toBe("2001:db8:abcd:12::");
    expect(v6(n.last)).toBe("2001:db8:abcd:12:ffff:ffff:ffff:ffff");
    expect(n.size).toBe(2n ** 64n);
    expect(n.usable).toBe(2n ** 64n);
    expect(n.offset).toBe(1n);
  });
});

describe("Hilfsfunktionen", () => {
  it("prüft, ob eine Adresse im Netz liegt", () => {
    const n = net("10.0.0.0/22");
    expect(contains(n, ip("10.0.3.255"))).toBe(true);
    expect(contains(n, ip("10.0.4.0"))).toBe(false);
  });

  it("findet Nachbarnetze", () => {
    const { previous, next } = neighbours(net("10.0.4.0/22"));
    expect(v4(previous!)).toBe("10.0.0.0");
    expect(v4(next!)).toBe("10.0.8.0");
    expect(neighbours(net("0.0.0.0/24")).previous).toBe(null);
    expect(neighbours(net("255.255.255.0/24")).next).toBe(null);
  });

  it("ordnet Adressbereiche zu", () => {
    expect(classify(4, ip("192.168.1.0"), 24).label).toMatch(/RFC 1918/);
    expect(classify(4, ip("192.168.1.0"), 24).private).toBe(true);
    expect(classify(4, ip("100.64.0.0"), 10).label).toMatch(/Carrier-Grade/);
    expect(classify(4, ip("8.8.8.0"), 24).label).toMatch(/Öffentlich/);
    expect(classify(4, ip("255.255.255.255"), 32).label).toBe("Limited Broadcast");
    expect(classify(4, ip("0.0.0.0"), 0).label).toMatch(/mehrere/);
    expect(classify(6, ip("fd12:3456::"), 48).label).toMatch(/ULA/);
    expect(classify(6, ip("2001:db8::"), 48).label).toBe("Dokumentation");
    expect(classify(6, ip("2a00:1450::"), 32).label).toMatch(/Global Unicast/);
    expect(classify(6, ip("fe80::"), 64).label).toBe("Link-Local");
  });

  it("nennt die historische Klasse", () => {
    expect(ipv4Class(ip("10.0.0.0")).name).toBe("A");
    expect(ipv4Class(ip("172.16.0.0")).name).toBe("B");
    expect(ipv4Class(ip("192.168.0.0")).name).toBe("C");
    expect(ipv4Class(ip("224.0.0.0")).name).toMatch(/D/);
  });
});

describe("reverseZones", () => {
  it("liefert IPv4-Zonen", () => {
    expect(reverseZones(net("192.168.10.0/24")).zones).toEqual(["10.168.192.in-addr.arpa"]);
    expect(reverseZones(net("10.20.0.0/16")).zones).toEqual(["20.10.in-addr.arpa"]);
    expect(reverseZones(net("10.0.4.0/22")).zones).toEqual([
      "4.0.10.in-addr.arpa",
      "5.0.10.in-addr.arpa",
      "6.0.10.in-addr.arpa",
      "7.0.10.in-addr.arpa",
    ]);
    const small = reverseZones(net("192.168.10.64/26"));
    expect(small.zones).toEqual(["10.168.192.in-addr.arpa"]);
    expect(small.note).toMatch(/RFC 2317/);
    expect(reverseZones(net("10.0.0.0/12")).total).toBe(16);
  });

  it("liefert IPv6-Zonen", () => {
    expect(reverseZones(net("2001:db8::/32")).zones).toEqual(["8.b.d.0.1.0.0.2.ip6.arpa"]);
    expect(reverseZones(net("2001:db8::/31")).zones).toEqual(["8.b.d.0.1.0.0.2.ip6.arpa", "9.b.d.0.1.0.0.2.ip6.arpa"]);
  });
});

describe("splitSubnet", () => {
  it("teilt ein /24 in /26 auf", () => {
    const r = splitSubnet(net("192.168.10.0/24"), 26);
    expect(r.total).toBe(4n);
    expect(r.items.map((i) => cidrText(4, i.network, i.prefix))).toEqual([
      "192.168.10.0/26",
      "192.168.10.64/26",
      "192.168.10.128/26",
      "192.168.10.192/26",
    ]);
    expect(v4(r.items[1]!.lastHost)).toBe("192.168.10.126");
  });

  it("begrenzt sehr große Aufteilungen", () => {
    const r = splitSubnet(net("2001:db8::/32"), 48, 10);
    expect(r.total).toBe(65536n);
    expect(r.items).toHaveLength(10);
    expect(cidrText(6, r.items[1]!.network, 48)).toBe("2001:db8:1::/48");
  });

  it("lehnt kleinere Ziel-Präfixe ab", () => {
    expect(() => splitSubnet(net("10.0.0.0/24"), 24)).toThrow();
  });
});

describe("rangeToCidrs", () => {
  const blocks = (a: string, b: string) => {
    const p = parseSubnetInput(`${a} - ${b}`);
    if (p.kind !== "range") throw new Error();
    return rangeToCidrs(p.version, p.start, p.end).map((c) => cidrText(p.version, c.network, c.prefix));
  };

  it("findet die kleinste Abdeckung", () => {
    expect(blocks("10.0.0.0", "10.0.0.255")).toEqual(["10.0.0.0/24"]);
    expect(blocks("10.0.0.10", "10.0.0.50")).toEqual(["10.0.0.10/31", "10.0.0.12/30", "10.0.0.16/28", "10.0.0.32/28", "10.0.0.48/31", "10.0.0.50/32"]);
    expect(blocks("0.0.0.0", "255.255.255.255")).toEqual(["0.0.0.0/0"]);
    expect(blocks("10.0.0.7", "10.0.0.7")).toEqual(["10.0.0.7/32"]);
    expect(blocks("2001:db8::", "2001:db8::ff")).toEqual(["2001:db8::/120"]);
  });
});

describe("prefixForHosts", () => {
  it("wählt das kleinste passende Netz", () => {
    expect(prefixForHosts(1)).toBe(30);
    expect(prefixForHosts(2)).toBe(30);
    expect(prefixForHosts(50)).toBe(26);
    expect(prefixForHosts(254)).toBe(24);
    expect(prefixForHosts(255)).toBe(23);
    expect(prefixForHosts(0)).toBe(null);
  });
});

describe("formatCount", () => {
  it("formatiert große Zahlen", () => {
    expect(formatCount(254n)).toBe("254");
    expect(formatCount(65534n)).toBe("65.534");
    expect(formatCount(2n ** 64n)).toBe("18.446.744.073.709.551.616 (2⁶⁴)");
  });
});

describe("formatCountShort", () => {
  it("kürzt nur sehr große Zahlen", () => {
    expect(formatCountShort(65534n)).toBe("65.534");
    expect(formatCountShort(2n ** 78n)).toBe("2⁷⁸");
    expect(formatCountShort(332041393326771929089n)).toBe("≈ 3,3 × 10²⁰");
    expect(plural(1n, "Adresse", "Adressen")).toBe("1 Adresse");
    expect(plural(4n, "Adresse", "Adressen")).toBe("4 Adressen");
  });
});
