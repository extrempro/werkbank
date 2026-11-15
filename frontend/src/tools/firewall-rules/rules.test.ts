import { describe, expect, it } from "vitest";
import { findShadowed, matchPacket, parseRules, portsText } from "./rules";

const text = `# Web
erlauben tcp any 10.0.0.10 80,443   # Webserver
allow udp 192.168.1.0/24 any 53
deny ip 192.168.1.0/24 10.0.0.0/8
permit tcp 192.168.1.5 10.0.0.20 22
allow tcp any any 1024-65535`;

describe("parseRules", () => {
  it("liest Aktionen, Netze, Ports und Kommentare", () => {
    const { rules, errors } = parseRules(text);
    expect(errors).toEqual([]);
    expect(rules).toHaveLength(5);
    expect(rules[0]).toMatchObject({ line: 2, action: "allow", proto: "tcp", comment: "Webserver" });
    expect(portsText(rules[0]!)).toBe("80,443");
    expect(rules[2]).toMatchObject({ action: "deny", proto: "any" });
    expect(rules[2]!.dst.text).toBe("10.0.0.0/8");
    expect(portsText(rules[2]!)).toBe("alle");
  });
  it("meldet Fehler mit Zeilennummer", () => {
    const { rules, errors } = parseRules("allow tcp any any 80\nfoo tcp any any\nallow tcp 300.1.1.1 any\nallow icmp any any 80\nallow tcp any any 99999");
    expect(rules).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([2, 3, 4, 5]);
    expect(errors[0]!.message).toContain("Aktion");
    expect(errors[2]!.message).toContain("Ports gibt es nur");
  });
  it("normalisiert Hostbits", () => {
    expect(parseRules("allow tcp 192.168.1.77/24 any").rules[0]!.src.text).toBe("192.168.1.0/24");
  });
});

describe("matchPacket", () => {
  const { rules } = parseRules(text);
  it("erste passende Regel gewinnt", () => {
    expect(matchPacket(rules, { proto: "tcp", src: "8.8.8.8", dst: "10.0.0.10", port: 443 })).toBe(0);
    expect(matchPacket(rules, { proto: "udp", src: "192.168.1.9", dst: "10.0.0.53", port: 53 })).toBe(1);
    expect(matchPacket(rules, { proto: "tcp", src: "192.168.1.5", dst: "10.0.0.20", port: 22 })).toBe(2);
    expect(matchPacket(rules, { proto: "icmp", src: "192.168.1.5", dst: "10.0.0.20" })).toBe(2);
    expect(matchPacket(rules, { proto: "tcp", src: "1.2.3.4", dst: "5.6.7.8", port: 8080 })).toBe(4);
  });
  it("-1 wenn nichts passt", () => {
    expect(matchPacket(rules, { proto: "tcp", src: "1.2.3.4", dst: "5.6.7.8", port: 25 })).toBe(-1);
  });
  it("prüft das Testpaket", () => {
    expect(() => matchPacket(rules, { proto: "tcp", src: "x", dst: "1.1.1.1", port: 1 })).toThrow("Quelladresse");
    expect(() => matchPacket(rules, { proto: "tcp", src: "1.1.1.1", dst: "1.1.1.1" })).toThrow("Zielport");
  });
  it("IPv6", () => {
    const r = parseRules("allow tcp 2001:db8::/32 any 443").rules;
    expect(matchPacket(r, { proto: "tcp", src: "2001:db8::1", dst: "2001:db8::2", port: 443 })).toBe(0);
    expect(matchPacket(r, { proto: "tcp", src: "10.0.0.1", dst: "10.0.0.2", port: 443 })).toBe(-1);
  });
});

describe("findShadowed", () => {
  it("findet verdeckte Regeln", () => {
    expect(findShadowed(parseRules(text).rules)).toEqual([{ rule: 3, by: 2, sameAction: false }]);
  });
  it("gleiche Aktion = überflüssig", () => {
    expect(findShadowed(parseRules("allow tcp any any 1-1024\nallow tcp 10.0.0.0/8 any 80,443").rules)).toEqual([{ rule: 1, by: 0, sameAction: true }]);
  });
  it("Teilüberdeckung zählt nicht", () => {
    expect(findShadowed(parseRules("allow tcp any any 80\nallow tcp any any 80,443\ndeny tcp any any").rules)).toEqual([]);
  });
});
