import { describe, expect, it } from "vitest";
import {
  formatIpv4,
  formatIpv6,
  formatIpv6Full,
  maskToPrefix,
  parseIp,
  parseIpv4,
  parseIpv6,
  prefixMask,
} from "./ip";

describe("IPv4", () => {
  it("liest und schreibt Adressen", () => {
    expect(formatIpv4(parseIpv4("192.168.10.77")!)).toBe("192.168.10.77");
    expect(parseIpv4("0.0.0.0")).toBe(0n);
    expect(parseIpv4("255.255.255.255")).toBe(0xffffffffn);
  });

  it("lehnt ungültige Adressen ab", () => {
    for (const bad of ["300.1.1.1", "1.2.3", "1.2.3.4.5", "a.b.c.d", "1..2.3", ""])
      expect(parseIpv4(bad)).toBe(null);
  });
});

describe("IPv6", () => {
  it("liest verschiedene Schreibweisen", () => {
    expect(parseIpv6("::")).toBe(0n);
    expect(parseIpv6("::1")).toBe(1n);
    expect(parseIpv6("2001:db8::1")).toBe(0x20010db8000000000000000000000001n);
    expect(parseIpv6("2001:0DB8:0000:0000:0000:0000:0000:0001")).toBe(
      0x20010db8000000000000000000000001n,
    );
    expect(parseIpv6("fe80::1%eth0")).toBe(0xfe800000000000000000000000000001n);
    expect(parseIpv6("[2001:db8::1]")).toBe(0x20010db8000000000000000000000001n);
  });

  it("liest eingebettete IPv4-Adressen", () => {
    expect(parseIpv6("::ffff:192.0.2.1")).toBe(0xffffc0000201n);
    expect(parseIpv6("64:ff9b::198.51.100.7")).toBe(0x0064ff9b0000000000000000c6336407n);
  });

  it("lehnt ungültige Adressen ab", () => {
    for (const bad of [
      "1::2::3",
      "1:2:3",
      "12345::1",
      "2001:db8::g",
      "1:2:3:4:5:6:7:8:9",
      "::ffff:300.1.1.1",
    ]) {
      expect(parseIpv6(bad)).toBe(null);
    }
  });

  it("schreibt die Kurzform nach RFC 5952", () => {
    expect(formatIpv6(0n)).toBe("::");
    expect(formatIpv6(1n)).toBe("::1");
    expect(formatIpv6(parseIpv6("2001:db8:0:0:1:0:0:1")!)).toBe("2001:db8::1:0:0:1");
    expect(formatIpv6(parseIpv6("2001:db8:0:1:1:1:1:1")!)).toBe("2001:db8:0:1:1:1:1:1"); // einzelne 0 nicht kürzen
    expect(formatIpv6(parseIpv6("fe80::")!)).toBe("fe80::");
    expect(formatIpv6Full(1n)).toBe("0000:0000:0000:0000:0000:0000:0000:0001");
  });
});

describe("Masken", () => {
  it("rechnet Präfix und Maske ineinander um", () => {
    expect(formatIpv4(prefixMask(4, 24))).toBe("255.255.255.0");
    expect(formatIpv4(prefixMask(4, 0))).toBe("0.0.0.0");
    expect(maskToPrefix(4, parseIpv4("255.255.252.0")!)).toBe(22);
    expect(maskToPrefix(4, parseIpv4("255.0.255.0")!)).toBe(null);
  });

  it("erkennt die IP-Version", () => {
    expect(parseIp("10.0.0.1")?.version).toBe(4);
    expect(parseIp("2001:db8::")?.version).toBe(6);
    expect(parseIp("hallo")).toBe(null);
  });
});
