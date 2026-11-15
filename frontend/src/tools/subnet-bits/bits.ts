/** Subnetting-Bits: Wie viele Bits für eine Zahl von Subnetzen bzw. Hosts? (IPv4) */
import { formatIpv4, parseIpv4, prefixMask } from "../cidr/ip";

export const bitsFor = (count: number) => (count <= 1 ? 0 : Math.ceil(Math.log2(count)));
/** Host-Bits inklusive Netz- und Broadcast-Adresse */
export const hostBitsFor = (hosts: number) => Math.max(2, Math.ceil(Math.log2(hosts + 2)));

export interface BitsResult {
  basePrefix: number;
  subnetBits: number;
  hostBitsNeeded: number;
  newPrefix: number;
  hostBits: number;
  mask: string;
  subnets: number;
  hostsPerSubnet: number;
  /** Schrittweite im maßgeblichen Oktett */
  blockSize: number;
  octet: number;
  fits: boolean;
  /** größtmögliches Präfix, das die Hosts noch fasst – wenn nur Hosts vorgegeben sind */
  spareBits: number;
  examples: { network: string; first: string; last: string; broadcast: string }[];
}

export function subnetBits(base: string, wantSubnets: number, wantHosts: number): BitsResult {
  const m = /^\s*(?:(\d{1,3}(?:\.\d{1,3}){3})\s*)?\/?\s*(\d{1,2})\s*$/.exec(base);
  if (!m) throw new Error("Ausgangsnetz als „192.168.0.0/24“ oder nur „/24“ angeben.");
  const basePrefix = Number(m[2]);
  if (basePrefix > 30) throw new Error("Das Ausgangsnetz muss /30 oder größer sein.");
  const addr = m[1] ? parseIpv4(m[1]) : null;
  if (m[1] && addr === null) throw new Error("Ungültige IPv4-Adresse.");
  if (!(wantSubnets >= 1) || !(wantHosts >= 0)) throw new Error("Anzahl Subnetze (mind. 1) und Hosts prüfen.");

  const hostBitsNeeded = wantHosts > 0 ? hostBitsFor(wantHosts) : 2;
  const sBits = bitsFor(wantSubnets);
  const newPrefix = basePrefix + sBits;
  const hostBits = 32 - newPrefix;
  const fits = newPrefix <= 30 && hostBits >= hostBitsNeeded;
  const octet = Math.min(4, Math.floor((Math.max(newPrefix, 1) - 1) / 8) + 1);
  const blockSize = 2 ** (octet * 8 - newPrefix);
  const examples: BitsResult["examples"] = [];
  if (addr !== null && newPrefix <= 30) {
    const net = addr & prefixMask(4, basePrefix);
    const size = 1n << BigInt(hostBits);
    for (let i = 0n; i < BigInt(Math.min(2 ** sBits, 16)); i++) {
      const n = net + i * size;
      examples.push({ network: `${formatIpv4(n)}/${newPrefix}`, first: formatIpv4(n + 1n), last: formatIpv4(n + size - 2n), broadcast: formatIpv4(n + size - 1n) });
    }
  }
  return {
    basePrefix,
    subnetBits: sBits,
    hostBitsNeeded,
    newPrefix,
    hostBits,
    mask: newPrefix <= 32 ? formatIpv4(prefixMask(4, Math.min(newPrefix, 32))) : "–",
    subnets: 2 ** sBits,
    hostsPerSubnet: hostBits >= 2 ? 2 ** hostBits - 2 : 0,
    blockSize,
    octet,
    fits,
    spareBits: 32 - basePrefix - sBits - hostBitsNeeded,
    examples,
  };
}
