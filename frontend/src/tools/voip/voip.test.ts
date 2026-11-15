import { describe, expect, it } from "vitest";
import { voipBandwidth } from "./voip";

describe("voipBandwidth", () => {
  it("G.711 mit 20 ms über Ethernet = 87,2 kbit/s", () => {
    const r = voipBandwidth({ kbps: 64, ptime: 20, ipv6: false, layer2: "ethernet", srtp: false, calls: 1 });
    expect(r.payloadBytes).toBe(160);
    expect(r.headerBytes).toBe(58);
    expect(r.pps).toBe(50);
    expect(r.perCall).toBe(87200);
  });
  it("G.729 auf IP-Ebene = 24 kbit/s", () => {
    expect(voipBandwidth({ kbps: 8, ptime: 20, ipv6: false, layer2: "none", srtp: false, calls: 1 }).perCall).toBe(24000);
  });
  it("mehrere Gespräche, IPv6 und SRTP", () => {
    const r = voipBandwidth({ kbps: 64, ptime: 20, ipv6: true, layer2: "vlan", srtp: true, calls: 10 });
    expect(r.headerBytes).toBe(12 + 8 + 40 + 22 + 10);
    expect(r.total).toBe(r.perCall * 10);
  });
  it("prüft Eingaben", () => {
    expect(() => voipBandwidth({ kbps: 64, ptime: 1, ipv6: false, layer2: "none", srtp: false, calls: 1 })).toThrow("Paketintervall");
  });
});
