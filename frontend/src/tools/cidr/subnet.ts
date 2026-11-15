import {
  bitsOf,
  formatIp,
  formatIpv6Full,
  maskToPrefix,
  maxValue,
  parseIp,
  parseIpv4,
  prefixMask,
  type IpVersion,
} from "./ip";

// ---------- Eingabe ----------

export type NetworkSource = "cidr" | "mask" | "wildcard" | "address";

export type ParsedInput =
  | {
      kind: "network";
      version: IpVersion;
      /** Adresse wie eingegeben (kann eine Host-Adresse sein) */
      address: bigint;
      prefix: number;
      source: NetworkSource;
    }
  | { kind: "range"; version: IpVersion; start: bigint; end: bigint };

export const sourceLabels: Record<NetworkSource, string> = {
  cidr: "CIDR-Schreibweise",
  mask: "Adresse + Subnetzmaske",
  wildcard: "Adresse + Wildcard-Maske",
  address: "einzelne Adresse",
};

function parsePrefixOrMask(version: IpVersion, text: string): { prefix: number; source: NetworkSource } {
  const t = text.trim().replace(/^\//, "");
  if (/^\d{1,3}$/.test(t)) {
    const prefix = Number(t);
    if (prefix > bitsOf(version)) throw new Error(`Präfix muss zwischen 0 und ${bitsOf(version)} liegen`);
    return { prefix, source: "cidr" };
  }
  if (version === 4) {
    const mask = parseIpv4(t);
    if (mask === null) throw new Error(`„${t}“ ist weder Präfix noch Maske`);
    const asMask = maskToPrefix(4, mask);
    if (asMask !== null) return { prefix: asMask, source: "mask" };
    const asWildcard = maskToPrefix(4, ~mask & maxValue(4));
    if (asWildcard !== null) return { prefix: asWildcard, source: "wildcard" };
    throw new Error(`„${t}“ ist keine gültige Subnetz- oder Wildcard-Maske`);
  }
  throw new Error(`„${t}“ ist kein gültiges Präfix`);
}

/**
 * Erkennt die Eingabe:
 * 192.168.1.0/24 · 192.168.1.0/255.255.255.0 · 10.0.0.5 255.255.0.0 · 10.0.0.0 0.0.0.255 (Wildcard)
 * 10.0.0.10 - 10.0.0.50 (Bereich) · 10.0.0.5 (Adresse, Präfix aus defaultPrefix) · 2001:db8::/48
 */
export function parseSubnetInput(raw: string, defaultPrefix?: number): ParsedInput {
  const text = raw.trim().replace(/\s+/g, " ");
  if (!text) throw new Error("Keine Eingabe");

  const range = text.match(/^(\S+) ?(?:-|–|bis) ?(\S+)$/i);
  if (range && !range[1]!.includes("/")) {
    const a = parseIp(range[1]!);
    const b = parseIp(range[2]!);
    if (a && b) {
      if (a.version !== b.version) throw new Error("Anfang und Ende des Bereichs müssen dieselbe IP-Version haben");
      const [start, end] = a.value <= b.value ? [a.value, b.value] : [b.value, a.value];
      return { kind: "range", version: a.version, start, end };
    }
  }

  let addressText = text;
  let suffix: string | undefined;
  const slash = text.indexOf("/");
  if (slash >= 0) {
    addressText = text.slice(0, slash).trim();
    suffix = text.slice(slash + 1).trim();
  } else if (text.includes(" ")) {
    const [a, ...rest] = text.split(" ");
    addressText = a!;
    suffix = rest.join(" ");
  }

  const ip = parseIp(addressText);
  if (!ip) throw new Error(`„${addressText}“ ist keine gültige IPv4- oder IPv6-Adresse`);

  if (suffix === undefined || suffix === "") {
    const prefix = defaultPrefix !== undefined && defaultPrefix <= bitsOf(ip.version) ? defaultPrefix : bitsOf(ip.version);
    return { kind: "network", version: ip.version, address: ip.value, prefix, source: "address" };
  }
  const { prefix, source } = parsePrefixOrMask(ip.version, suffix);
  return { kind: "network", version: ip.version, address: ip.value, prefix, source };
}

// ---------- Netzberechnung ----------

export interface SubnetInfo {
  version: IpVersion;
  bits: number;
  prefix: number;
  address: bigint;
  network: bigint;
  /** letzte Adresse (bei IPv4 die Broadcast-Adresse) */
  last: bigint;
  mask: bigint;
  hostMask: bigint;
  size: bigint;
  usable: bigint;
  firstHost: bigint;
  lastHost: bigint;
  /** Position der eingegebenen Adresse im Netz */
  offset: bigint;
  role: "network" | "broadcast" | "host" | "single";
}

export function calculateSubnet(version: IpVersion, address: bigint, prefix: number): SubnetInfo {
  const bits = bitsOf(version);
  const mask = prefixMask(version, prefix);
  const hostMask = ~mask & maxValue(version);
  const network = address & mask;
  const last = network | hostMask;
  const size = hostMask + 1n;

  let usable = size;
  let firstHost = network;
  let lastHost = last;
  if (version === 4 && prefix <= 30) {
    usable = size - 2n;
    firstHost = network + 1n;
    lastHost = last - 1n;
  }

  let role: SubnetInfo["role"] = "host";
  if (size === 1n) role = "single";
  else if (version === 4 && prefix <= 30 && address === network) role = "network";
  else if (version === 4 && prefix <= 30 && address === last) role = "broadcast";

  return { version, bits, prefix, address, network, last, mask, hostMask, size, usable, firstHost, lastHost, offset: address - network, role };
}

export function contains(info: SubnetInfo, value: bigint): boolean {
  return (value & info.mask) === info.network;
}

export function neighbours(info: SubnetInfo): { previous: bigint | null; next: bigint | null } {
  return {
    previous: info.network >= info.size ? info.network - info.size : null,
    next: info.last < maxValue(info.version) ? info.last + 1n : null,
  };
}

// ---------- Adresstyp ----------

interface RangeDef {
  cidr: string;
  label: string;
  private?: boolean;
}

const v4Ranges: RangeDef[] = [
  { cidr: "0.0.0.0/8", label: "„Dieses Netz“ (RFC 1122)" },
  { cidr: "10.0.0.0/8", label: "Privat (RFC 1918)", private: true },
  { cidr: "100.64.0.0/10", label: "Carrier-Grade NAT (RFC 6598)", private: true },
  { cidr: "127.0.0.0/8", label: "Loopback" },
  { cidr: "169.254.0.0/16", label: "Link-Local / APIPA" },
  { cidr: "172.16.0.0/12", label: "Privat (RFC 1918)", private: true },
  { cidr: "192.0.0.0/24", label: "IETF-Protokollzuweisungen" },
  { cidr: "192.0.2.0/24", label: "Dokumentation (TEST-NET-1)" },
  { cidr: "192.88.99.0/24", label: "6to4-Relay (veraltet)" },
  { cidr: "192.168.0.0/16", label: "Privat (RFC 1918)", private: true },
  { cidr: "198.18.0.0/15", label: "Benchmark-Tests (RFC 2544)" },
  { cidr: "198.51.100.0/24", label: "Dokumentation (TEST-NET-2)" },
  { cidr: "203.0.113.0/24", label: "Dokumentation (TEST-NET-3)" },
  { cidr: "224.0.0.0/4", label: "Multicast" },
  { cidr: "240.0.0.0/4", label: "Reserviert" },
  { cidr: "255.255.255.255/32", label: "Limited Broadcast" },
];

const v6Ranges: RangeDef[] = [
  { cidr: "::/128", label: "Unspezifizierte Adresse" },
  { cidr: "::1/128", label: "Loopback" },
  { cidr: "::ffff:0:0/96", label: "IPv4-mapped" },
  { cidr: "64:ff9b::/96", label: "NAT64 (RFC 6052)" },
  { cidr: "100::/64", label: "Discard (RFC 6666)" },
  { cidr: "2000::/3", label: "Global Unicast (öffentlich)" },
  { cidr: "2001::/32", label: "Teredo" },
  { cidr: "2001:db8::/32", label: "Dokumentation" },
  { cidr: "2002::/16", label: "6to4" },
  { cidr: "fc00::/7", label: "Unique Local (ULA, privat)", private: true },
  { cidr: "fe80::/10", label: "Link-Local" },
  { cidr: "ff00::/8", label: "Multicast" },
];

const parsedRanges = new Map<IpVersion, { network: bigint; prefix: number; def: RangeDef }[]>();
function rangesFor(version: IpVersion) {
  let list = parsedRanges.get(version);
  if (!list) {
    list = (version === 4 ? v4Ranges : v6Ranges).map((def) => {
      const [ip, p] = def.cidr.split("/");
      const value = parseIp(ip!)!.value;
      return { network: value, prefix: Number(p), def };
    });
    parsedRanges.set(version, list);
  }
  return list;
}

export interface AddressType {
  label: string;
  private: boolean;
}

/** Ordnet das Netz einem besonderen Adressbereich zu (spezifischster Treffer gewinnt). */
export function classify(version: IpVersion, network: bigint, prefix: number): AddressType {
  const ranges = rangesFor(version);
  const containing = ranges
    .filter((r) => r.prefix <= prefix && (network & prefixMask(version, r.prefix)) === r.network)
    .sort((a, b) => b.prefix - a.prefix);
  const inside = ranges.filter((r) => r.prefix > prefix && (r.network & prefixMask(version, prefix)) === network);
  if (inside.length > 0 && (containing.length === 0 || version === 4)) {
    return { label: "umfasst mehrere Adressbereiche", private: false };
  }
  const hit = containing[0];
  if (hit) return { label: hit.def.label, private: !!hit.def.private };
  return version === 4 ? { label: "Öffentlich (global routbar)", private: false } : { label: "Reserviert / nicht zugewiesen", private: false };
}

/** Historische Netzklasse (nur IPv4) */
export function ipv4Class(network: bigint): { name: string; defaultPrefix?: number } {
  const first = Number(network >> 24n);
  if (first < 128) return { name: "A", defaultPrefix: 8 };
  if (first < 192) return { name: "B", defaultPrefix: 16 };
  if (first < 224) return { name: "C", defaultPrefix: 24 };
  if (first < 240) return { name: "D (Multicast)" };
  return { name: "E (reserviert)" };
}

// ---------- Reverse-DNS ----------

export interface ReverseZones {
  zones: string[];
  total: number;
  note?: string;
}

const MAX_ZONES = 16;

export function reverseZones(info: SubnetInfo): ReverseZones {
  if (info.version === 4) {
    if (info.prefix > 24) {
      const base = formatIp(4, info.network).split(".").slice(0, 3).reverse().join(".");
      return {
        zones: [`${base}.in-addr.arpa`],
        total: 1,
        note: "Netz kleiner als /24 – Delegation nur per Classless Delegation (RFC 2317) möglich.",
      };
    }
    const zoneBits = Math.ceil(info.prefix / 8) * 8;
    const total = 2 ** (zoneBits - info.prefix);
    const zones: string[] = [];
    for (let i = 0; i < Math.min(total, MAX_ZONES); i++) {
      const net = info.network + (BigInt(i) << BigInt(32 - zoneBits));
      const octets = formatIp(4, net).split(".").slice(0, zoneBits / 8);
      zones.push(octets.length ? `${octets.reverse().join(".")}.in-addr.arpa` : "in-addr.arpa");
    }
    return { zones, total };
  }
  const zoneBits = Math.ceil(info.prefix / 4) * 4;
  const total = 2 ** (zoneBits - info.prefix);
  const zones: string[] = [];
  for (let i = 0; i < total; i++) {
    const net = info.network + (BigInt(i) << BigInt(128 - zoneBits));
    const nibbles = formatIpv6Full(net).replace(/:/g, "").slice(0, zoneBits / 4).split("");
    zones.push(nibbles.length ? `${nibbles.reverse().join(".")}.ip6.arpa` : "ip6.arpa");
  }
  return { zones, total };
}

// ---------- Aufteilen, Bereiche, Hosts ----------

export interface SplitResult {
  total: bigint;
  items: SubnetInfo[];
}

export function splitSubnet(info: SubnetInfo, targetPrefix: number, limit = 256): SplitResult {
  if (targetPrefix <= info.prefix || targetPrefix > info.bits) throw new Error("Ziel-Präfix muss größer als das aktuelle sein");
  const total = 1n << BigInt(targetPrefix - info.prefix);
  const step = 1n << BigInt(info.bits - targetPrefix);
  const items: SubnetInfo[] = [];
  for (let i = 0n; i < total && i < BigInt(limit); i++) {
    items.push(calculateSubnet(info.version, info.network + i * step, targetPrefix));
  }
  return { total, items };
}

/** Kleinste Menge an CIDR-Blöcken, die genau den Bereich start…end abdeckt. */
export function rangeToCidrs(version: IpVersion, start: bigint, end: bigint): { network: bigint; prefix: number }[] {
  const bits = bitsOf(version);
  const out: { network: bigint; prefix: number }[] = [];
  let cur = start;
  while (cur <= end) {
    // größter Block, an dem cur ausgerichtet ist …
    let size = 1n;
    let hostBits = 0;
    while (hostBits < bits && (cur & ((size << 1n) - 1n)) === 0n && cur + (size << 1n) - 1n <= end) {
      size <<= 1n;
      hostBits++;
    }
    out.push({ network: cur, prefix: bits - hostBits });
    cur += size;
    if (cur > maxValue(version)) break;
  }
  return out;
}

/** Kleinstes IPv4-Netz (größtes Präfix), das mindestens `hosts` nutzbare Adressen bietet. */
export function prefixForHosts(hosts: number): number | null {
  if (!Number.isInteger(hosts) || hosts < 1) return null;
  for (let p = 30; p >= 0; p--) {
    if (2 ** (32 - p) - 2 >= hosts) return p;
  }
  return null;
}

// ---------- Darstellung ----------

const numberFormat = new Intl.NumberFormat("de-DE");

/** 254 · 65.534 · 18.446.744.073.709.551.616 (2⁶⁴) */
export function formatCount(n: bigint): string {
  const text = numberFormat.format(n);
  if (n < 1n << 20n) return text;
  const exp = n.toString(2).length - 1;
  if (1n << BigInt(exp) === n) return `${text} (2${toSuperscript(exp)})`;
  return text;
}

/**
 * Kurzform für sehr große Zahlen (ab 10¹⁵): Zweierpotenzen als „2⁷⁸“, sonst „≈ 3,3 × 10²⁰“.
 * Kleinere Zahlen wie formatCount.
 */
export function formatCountShort(n: bigint): string {
  if (n < 10n ** 15n) return numberFormat.format(n);
  const exp = n.toString(2).length - 1;
  if (1n << BigInt(exp) === n) return `2${toSuperscript(exp)}`;
  const digits = n.toString();
  const mantissa = `${digits[0]},${digits[1]}`;
  return `≈ ${mantissa} × 10${toSuperscript(digits.length - 1)}`;
}

/** „1 Adresse“ / „4 Adressen“ */
export function plural(n: bigint, one: string, many: string): string {
  return `${formatCountShort(n)} ${n === 1n ? one : many}`;
}

function toSuperscript(n: number): string {
  const map = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return String(n)
    .split("")
    .map((d) => map[Number(d)])
    .join("");
}

export function cidrText(version: IpVersion, network: bigint, prefix: number): string {
  return `${formatIp(version, network)}/${prefix}`;
}
