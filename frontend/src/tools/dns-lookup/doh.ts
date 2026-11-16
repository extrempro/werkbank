/**
 * Hilfsfunktionen für DNS-Abfragen (Namen, Reverse-Namen, JSON-Antworten).
 * Die Abfragen selbst stehen in resolvers.ts (JSON-API und RFC 8484).
 */
import { typeNamesByCode } from "./wire";

/** gängige Typen (Auswahl oben) und weitere */
export const commonRecordTypes = [
  "A",
  "AAAA",
  "CNAME",
  "MX",
  "NS",
  "TXT",
  "SOA",
  "SRV",
  "CAA",
  "PTR",
] as const;
export const moreRecordTypes = [
  "HTTPS",
  "SVCB",
  "TLSA",
  "DS",
  "DNSKEY",
  "SSHFP",
  "NAPTR",
  "DNAME",
  "SPF",
] as const;
export const dnsRecordTypes = [...commonRecordTypes, ...moreRecordTypes] as const;
export type DnsRecordType = (typeof dnsRecordTypes)[number];

const statusNames: Record<number, string> = {
  0: "NOERROR",
  1: "FORMERR",
  2: "SERVFAIL",
  3: "NXDOMAIN",
  4: "NOTIMP",
  5: "REFUSED",
};

export interface DnsAnswer {
  name: string;
  type: string;
  ttl: number;
  data: string;
}

export interface DnsResult {
  query: string;
  status: string;
  /** DNSSEC-validiert (AD-Flag) */
  authenticated: boolean;
  answers: DnsAnswer[];
}

const hostnamePattern =
  /^(?=.{1,253}\.?$)(?:[a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.?$/;

export function isValidHostname(name: string): boolean {
  return hostnamePattern.test(name.trim());
}

/** 192.0.2.1 → 1.2.0.192.in-addr.arpa, 2001:db8::1 → …ip6.arpa */
export function reverseName(ip: string): string {
  const v = ip.trim();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) {
    const parts = v.split(".");
    if (parts.some((p) => Number(p) > 255)) throw new Error(`Ungültige IPv4-Adresse: ${ip}`);
    return `${parts.reverse().join(".")}.in-addr.arpa`;
  }
  if (v.includes(":")) {
    return `${expandIpv6(v).replace(/:/g, "").split("").reverse().join(".")}.ip6.arpa`;
  }
  throw new Error(`Für PTR wird eine IP-Adresse erwartet: ${ip}`);
}

/** 2001:db8::1 → 2001:0db8:0000:0000:0000:0000:0000:0001 */
export function expandIpv6(ip: string): string {
  const invalid = () => new Error(`Ungültige IPv6-Adresse: ${ip}`);
  if (!/^[0-9a-fA-F:]+$/.test(ip) || ip.split("::").length > 2) throw invalid();
  const [head = "", tail] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (tail === undefined ? missing !== 0 : missing < 1) throw invalid();
  const groups = [
    ...headParts,
    ...Array<string>(tail === undefined ? 0 : missing).fill("0"),
    ...tailParts,
  ];
  if (groups.some((g) => g.length === 0 || g.length > 4)) throw invalid();
  return groups.map((g) => g.toLowerCase().padStart(4, "0")).join(":");
}

export interface DohJson {
  Status: number;
  AD?: boolean;
  Answer?: { name: string; type: number; TTL: number; data: string }[];
}

export function parseDohResponse(query: string, json: DohJson): DnsResult {
  return {
    query,
    status: statusNames[json.Status] ?? `Status ${json.Status}`,
    authenticated: json.AD === true,
    answers: (json.Answer ?? []).map((a) => ({
      name: a.name.replace(/\.$/, ""),
      type: typeNamesByCode[a.type] ?? `TYPE${a.type}`,
      ttl: a.TTL,
      data: a.data,
    })),
  };
}
