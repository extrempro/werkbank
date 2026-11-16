/**
 * Normalisierung von DNS-Daten, damit unterschiedliche Schreibweisen vergleichbar werden
 * (Resolver untereinander, NetBox ↔ öffentliches DNS).
 */
import { expandIpv6 } from "./doh";

export const stripDot = (name: string) => name.trim().toLowerCase().replace(/\.$/, "");

/**
 * Zielnamen (CNAME, MX, NS …): mit Punkt am Ende absolut, sonst relativ zur Zone.
 * Ohne Punkt, aber mit Punkten im Namen ist es mehrdeutig – dann zählen beide Lesarten.
 */
export function nameCandidates(value: string, zone?: string): string[] {
  const v = value.trim().toLowerCase();
  if (v === "@" && zone) return [stripDot(zone)];
  if (v.endsWith(".") || !zone) return [stripDot(v)];
  const relative = `${v}.${stripDot(zone)}`;
  return v.includes(".") ? [v, relative] : [relative];
}

/** Inhalt von TXT-Daten: "a" "b" → ab; ohne Anführungszeichen unverändert */
export function txtContent(value: string): string {
  const v = value.trim();
  if (!v.startsWith('"')) return v;
  let out = "";
  for (const m of v.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    out += m[1]!.replace(/\\(\d{3}|.)/g, (_, esc: string) =>
      esc.length === 3 ? String.fromCharCode(Number(esc)) : esc,
    );
  }
  return out;
}

/** CAA: „0 issue "letsencrypt.org"“ oder RFC-3597-Form „\# 22 00 05 …“ */
export function caaNormalized(value: string): string {
  const v = value.trim();
  if (v.startsWith("\\#")) {
    const bytes = v
      .slice(2)
      .trim()
      .split(/\s+/)
      .slice(1)
      .join("")
      .match(/../g)
      ?.map((h) => parseInt(h, 16));
    if (bytes && bytes.length >= 2) {
      const tagLen = bytes[1]!;
      const tag = String.fromCharCode(...bytes.slice(2, 2 + tagLen));
      const val = String.fromCharCode(...bytes.slice(2 + tagLen));
      return `${bytes[0]} ${tag.toLowerCase()} ${val}`;
    }
  }
  const m = v.match(/^(\d+)\s+(\S+)\s+(.*)$/);
  if (!m) return v.toLowerCase();
  return `${Number(m[1])} ${m[2]!.toLowerCase()} ${txtContent(m[3]!)}`;
}

/** mögliche normalisierte Formen eines Werts (NetBox: mit Zone für relative Namen; öffentlich: ohne) */
export function normalizeValue(type: string, value: string, zone?: string): string[] {
  const v = value.trim();
  switch (type.toUpperCase()) {
    case "A":
      return [v];
    case "AAAA":
      try {
        return [expandIpv6(v)];
      } catch {
        return [v.toLowerCase()];
      }
    case "CNAME":
    case "NS":
    case "PTR":
    case "DNAME":
      return nameCandidates(v, zone);
    case "MX": {
      const [pref = "", target = ""] = v.split(/\s+/);
      return nameCandidates(target, zone).map((t) => `${Number(pref)} ${t}`);
    }
    case "SRV": {
      const [prio = "", weight = "", port = "", target = ""] = v.split(/\s+/);
      return nameCandidates(target, zone).map(
        (t) => `${Number(prio)} ${Number(weight)} ${Number(port)} ${t}`,
      );
    }
    case "TXT":
    case "SPF":
      return [txtContent(v)];
    case "CAA":
      return [caaNormalized(v)];
    default:
      return [v.toLowerCase().replace(/\s+/g, " ")];
  }
}
