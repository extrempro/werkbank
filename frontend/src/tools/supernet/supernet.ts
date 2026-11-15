/** Liste von Netzen/Adressen/Bereichen zusammenfassen (Supernetting / Aggregation) */
import { bitsOf, formatIp, parseIp, prefixMask, type IpVersion } from "../cidr/ip";
import { rangeToCidrs } from "../cidr/subnet";

export interface Entry {
  raw: string;
  version: IpVersion;
  start: bigint;
  end: bigint;
}

export interface ParseResult {
  entries: Entry[];
  invalid: string[];
  /** Einträge, deren Adresse nicht auf der Netzgrenze lag (z. B. 10.0.0.5/24) */
  unaligned: string[];
}

export function parseEntries(text: string): ParseResult {
  const entries: Entry[] = [];
  const invalid: string[] = [];
  const unaligned: string[] = [];
  // Kommentare (# …) entfernen, Trenner: Zeilenumbruch, Komma, Semikolon, Leerzeichen (außer um „-“)
  const tokens = text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*$/, ""))
    .join("\n")
    .replace(/\s*-\s*/g, "-")
    .split(/[\s,;]+/)
    .filter(Boolean);
  for (const raw of tokens) {
    const range = /^([^/]+)-([^/]+)$/.exec(raw);
    if (range) {
      const a = parseIp(range[1]!);
      const b = parseIp(range[2]!);
      if (!a || !b || a.version !== b.version || a.value > b.value) {
        invalid.push(raw);
        continue;
      }
      entries.push({ raw, version: a.version, start: a.value, end: b.value });
      continue;
    }
    const [addr, pfx] = raw.split("/");
    const ip = parseIp(addr ?? "");
    if (!ip) {
      invalid.push(raw);
      continue;
    }
    const bits = bitsOf(ip.version);
    let prefix = bits;
    if (pfx !== undefined) {
      if (!/^\d{1,3}$/.test(pfx) || Number(pfx) > bits) {
        // Maske statt Präfix? (10.0.0.0/255.255.255.0)
        invalid.push(raw);
        continue;
      }
      prefix = Number(pfx);
    }
    const mask = prefixMask(ip.version, prefix);
    const start = ip.value & mask;
    if (start !== ip.value) unaligned.push(raw);
    const end = start | (~mask & ((1n << BigInt(bits)) - 1n));
    entries.push({ raw, version: ip.version, start, end });
  }
  return { entries, invalid, unaligned };
}

export interface Aggregated {
  version: IpVersion;
  cidrs: { network: bigint; prefix: number }[];
  addresses: bigint;
}

/** Überlappende und angrenzende Bereiche zusammenführen und in minimale CIDR-Blöcke zerlegen */
export function aggregate(entries: Entry[], version: IpVersion): Aggregated {
  const list = entries
    .filter((e) => e.version === version)
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const merged: { start: bigint; end: bigint }[] = [];
  for (const e of list) {
    const last = merged[merged.length - 1];
    if (last && e.start <= last.end + 1n) {
      if (e.end > last.end) last.end = e.end;
    } else merged.push({ start: e.start, end: e.end });
  }
  const cidrs = merged.flatMap((m) => rangeToCidrs(version, m.start, m.end));
  const addresses = merged.reduce((n, m) => n + (m.end - m.start + 1n), 0n);
  return { version, cidrs, addresses };
}

/** Kleinstes einzelnes Netz, das alle Einträge enthält (deckt meist mehr ab als nötig) */
export function commonSupernet(
  entries: Entry[],
  version: IpVersion,
): { network: bigint; prefix: number; addresses: bigint } | null {
  const list = entries.filter((e) => e.version === version);
  if (!list.length) return null;
  const min = list.reduce((m, e) => (e.start < m ? e.start : m), list[0]!.start);
  const max = list.reduce((m, e) => (e.end > m ? e.end : m), list[0]!.end);
  const bits = bitsOf(version);
  let prefix = bits;
  while (prefix > 0 && (min & prefixMask(version, prefix)) !== (max & prefixMask(version, prefix)))
    prefix--;
  // auch Start und Ende müssen innerhalb des Netzes ausgerichtet sein
  while (prefix > 0) {
    const mask = prefixMask(version, prefix);
    const net = min & mask;
    const bcast = net | (~mask & ((1n << BigInt(bits)) - 1n));
    if (net <= min && bcast >= max) break;
    prefix--;
  }
  const network = min & prefixMask(version, prefix);
  return { network, prefix, addresses: 1n << BigInt(bits - prefix) };
}

export const cidrString = (version: IpVersion, c: { network: bigint; prefix: number }) =>
  `${formatIp(version, c.network)}/${c.prefix}`;
