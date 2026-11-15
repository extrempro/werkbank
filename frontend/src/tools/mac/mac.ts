/** MAC-Adressen erkennen, umformatieren und einordnen */
import { formatIpv6 } from "../cidr/ip";

export interface MacInfo {
  raw: string;
  /** 12 Hex-Ziffern, Großbuchstaben */
  hex: string;
  multicast: boolean;
  broadcast: boolean;
  /** lokal verwaltet – z. B. zufällige „private“ WLAN-Adressen, VMs, Container */
  local: boolean;
}

export type MacFormat = "colon" | "hyphen" | "cisco" | "bare" | "colonUpper";

export const formatLabels: Record<MacFormat, string> = {
  colon: "Linux / macOS (aa:bb:cc:dd:ee:ff)",
  colonUpper: "Doppelpunkt groß (AA:BB:CC:DD:EE:FF)",
  hyphen: "Windows (AA-BB-CC-DD-EE-FF)",
  cisco: "Cisco (aabb.ccdd.eeff)",
  bare: "ohne Trenner (AABBCCDDEEFF)",
};

/** alle MAC-Adressen aus einem Text (eine pro Zeile oder gemischt, z. B. aus „arp -a“) */
export function extractMacs(text: string): MacInfo[] {
  const re = /(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{2}([:-])(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}|[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}\.[0-9A-Fa-f]{4}|[0-9A-Fa-f]{12})(?![0-9A-Fa-f])/g;
  const out: MacInfo[] = [];
  for (const m of text.matchAll(re)) out.push(info(m[0]));
  return out;
}

export function parseMac(text: string): MacInfo | null {
  const t = text.trim();
  const m = extractMacs(t);
  return m.length === 1 && m[0]!.raw === t ? m[0]! : null;
}

function info(raw: string): MacInfo {
  const hex = raw.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
  const first = parseInt(hex.slice(0, 2), 16);
  return { raw, hex, multicast: (first & 1) === 1, broadcast: hex === "FFFFFFFFFFFF", local: (first & 2) === 2 };
}

export function formatMac(hex: string, f: MacFormat): string {
  const pairs = hex.match(/../g)!;
  switch (f) {
    case "colon":
      return pairs.join(":").toLowerCase();
    case "colonUpper":
      return pairs.join(":");
    case "hyphen":
      return pairs.join("-");
    case "cisco":
      return (hex.match(/..../g) ?? []).join(".").toLowerCase();
    case "bare":
      return hex;
  }
}

/** modifiziertes EUI-64 (SLAAC) und daraus die IPv6-Link-Local-Adresse */
export function eui64(hex: string): { eui: string; linkLocal: string } {
  const b = hex.match(/../g)!.map((x) => parseInt(x, 16));
  b[0] = b[0]! ^ 0x02;
  const e = [...b.slice(0, 3), 0xff, 0xfe, ...b.slice(3)];
  const iid = e.reduce((v, x) => (v << 8n) | BigInt(x), 0n);
  return {
    eui: e.map((x) => x.toString(16).padStart(2, "0")).join(":"),
    linkLocal: formatIpv6((0xfe80n << 112n) | iid),
  };
}

/** Hersteller-Liste: „OUI<TAB>Name“, OUI mit 6, 7 oder 9 Hex-Ziffern (MA-L, MA-M, MA-S) */
export function parseOuiList(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab > 0) map.set(line.slice(0, tab), line.slice(tab + 1));
  }
  return map;
}

export function lookupVendor(list: Map<string, string>, hex: string): string | undefined {
  return list.get(hex.slice(0, 9)) ?? list.get(hex.slice(0, 7)) ?? list.get(hex.slice(0, 6));
}

/** bekannte Sonderadressen */
export function specialMac(hex: string): string | undefined {
  if (hex === "FFFFFFFFFFFF") return "Broadcast";
  if (hex.startsWith("01005E")) return "IPv4-Multicast";
  if (hex.startsWith("3333")) return "IPv6-Multicast";
  if (hex.startsWith("0180C20000")) return "Spanning Tree / LLDP / 802.1X (Bridge-Gruppe)";
  if (hex.startsWith("01000CCCCCC")) return "Cisco CDP/VTP/DTP";
  if (hex.startsWith("00005E0001")) return "VRRP (IPv4) – virtuelle Router-Adresse";
  if (hex.startsWith("00005E0002")) return "VRRP (IPv6) – virtuelle Router-Adresse";
  if (hex.startsWith("00000C07AC")) return "HSRP v1 – virtuelle Router-Adresse";
  if (hex.startsWith("00000C9F")) return "HSRP v2 – virtuelle Router-Adresse";
  if (hex.startsWith("0007B4")) return "GLBP – virtuelle Router-Adresse";
  return undefined;
}
