/** IPv4- und IPv6-Adressen als BigInt – Grundlage für alle Subnetz-Berechnungen. */

export type IpVersion = 4 | 6;

export interface IpAddress {
  version: IpVersion;
  value: bigint;
}

export const bitsOf = (version: IpVersion): number => (version === 4 ? 32 : 128);
export const maxValue = (version: IpVersion): bigint => (1n << BigInt(bitsOf(version))) - 1n;

export function parseIpv4(text: string): bigint | null {
  const parts = text.trim().split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

export function parseIpv6(text: string): bigint | null {
  let s = text.trim().replace(/^\[|\]$/g, "");
  s = s.replace(/%.*$/, ""); // Zonen-ID (fe80::1%eth0) ignorieren
  if (!/^[0-9a-fA-F:.]+$/.test(s) || !s.includes(":")) return null;

  // eingebettete IPv4-Adresse am Ende (::ffff:192.0.2.1) in zwei Hex-Gruppen umwandeln
  const lastColon = s.lastIndexOf(":");
  const tail = s.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIpv4(tail);
    if (v4 === null) return null;
    s = `${s.slice(0, lastColon + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }

  const halves = s.split("::");
  if (halves.length > 2) return null;
  const split = (part: string | undefined) => (part ? part.split(":") : []);
  let groups: string[];
  if (halves.length === 2) {
    const head = split(halves[0]);
    const rest = split(halves[1]);
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<string>(missing).fill("0"), ...rest];
  } else {
    groups = split(halves[0]);
  }
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

export function parseIp(text: string): IpAddress | null {
  const v4 = parseIpv4(text);
  if (v4 !== null) return { version: 4, value: v4 };
  const v6 = parseIpv6(text);
  if (v6 !== null) return { version: 6, value: v6 };
  return null;
}

export function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => ((value >> shift) & 255n).toString()).join(".");
}

function ipv6Groups(value: bigint): number[] {
  const groups: number[] = [];
  for (let i = 7; i >= 0; i--) groups.push(Number((value >> BigInt(i * 16)) & 0xffffn));
  return groups;
}

/** Kurzform nach RFC 5952: Kleinbuchstaben, längste Nullfolge (≥ 2 Gruppen) als :: */
export function formatIpv6(value: bigint): string {
  const groups = ipv6Groups(value);
  let bestStart = -1;
  let bestLen = 1;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart < 0) return hex.join(":");
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLen).join(":")}`;
}

export function formatIpv6Full(value: bigint): string {
  return ipv6Groups(value)
    .map((g) => g.toString(16).padStart(4, "0"))
    .join(":");
}

export function formatIp(version: IpVersion, value: bigint): string {
  return version === 4 ? formatIpv4(value) : formatIpv6(value);
}

/** Netzmaske als Zahl für ein Präfix */
export function prefixMask(version: IpVersion, prefix: number): bigint {
  const bits = bitsOf(version);
  return prefix === 0 ? 0n : (maxValue(version) << BigInt(bits - prefix)) & maxValue(version);
}

/** Prüft, ob eine Zahl eine gültige Netzmaske (1…10…0) ist und liefert das Präfix */
export function maskToPrefix(version: IpVersion, mask: bigint): number | null {
  const bits = bitsOf(version);
  for (let p = 0; p <= bits; p++) if (prefixMask(version, p) === mask) return p;
  return null;
}

export function toBinary(version: IpVersion, value: bigint): string {
  return value.toString(2).padStart(bitsOf(version), "0");
}
