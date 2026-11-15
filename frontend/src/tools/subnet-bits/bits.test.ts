import { describe, expect, it } from "vitest";
import { bitsFor, hostBitsFor, subnetBits } from "./bits";

describe("Subnetting-Bits", () => {
  it("Bits für Subnetze und Hosts", () => {
    expect([1, 2, 3, 4, 5, 8, 9].map(bitsFor)).toEqual([0, 1, 2, 2, 3, 3, 4]);
    expect([1, 2, 3, 6, 7, 30, 62, 63, 254].map(hostBitsFor)).toEqual([2, 2, 3, 3, 4, 5, 6, 7, 8]);
  });
  it("/24 in 4 Subnetze", () => {
    const r = subnetBits("192.168.10.0/24", 4, 50);
    expect(r).toMatchObject({
      subnetBits: 2,
      newPrefix: 26,
      mask: "255.255.255.192",
      subnets: 4,
      hostsPerSubnet: 62,
      blockSize: 64,
      octet: 4,
      fits: true,
      spareBits: 0,
    });
    expect(r.examples[1]).toEqual({
      network: "192.168.10.64/26",
      first: "192.168.10.65",
      last: "192.168.10.126",
      broadcast: "192.168.10.127",
    });
  });
  it("passt nicht, wenn zu viele Hosts verlangt sind", () => {
    const r = subnetBits("/24", 4, 100);
    expect(r.fits).toBe(false);
    expect(r.spareBits).toBe(-1);
    expect(r.examples).toHaveLength(0);
  });
  it("Schrittweite im dritten Oktett", () => {
    expect(subnetBits("10.0.0.0/16", 5, 0)).toMatchObject({
      newPrefix: 19,
      blockSize: 32,
      octet: 3,
      subnets: 8,
    });
  });
  it("prüft das Ausgangsnetz", () => {
    expect(() => subnetBits("abc", 2, 2)).toThrow("Ausgangsnetz");
    expect(() => subnetBits("999.1.1.1/24", 2, 2)).toThrow("IPv4");
  });
});
