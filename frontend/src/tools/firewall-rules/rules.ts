/** Firewall-Regelwerk prüfen: Regeln von oben nach unten, die erste passende gewinnt (First Match) */
import { parseIp, prefixMask, bitsOf, formatIp, type IpVersion } from "../cidr/ip";

export type Action = "allow" | "deny";
export type Proto = "tcp" | "udp" | "icmp" | "any";

interface Net {
  any: boolean;
  version?: IpVersion;
  start: bigint;
  end: bigint;
  text: string;
}

export interface Rule {
  line: number;
  raw: string;
  action: Action;
  proto: Proto;
  src: Net;
  dst: Net;
  /** leer = alle Ports */
  ports: [number, number][];
  comment: string;
}

const ACTIONS: Record<string, Action> = {
  allow: "allow", permit: "allow", accept: "allow", pass: "allow", erlauben: "allow", erlaubt: "allow", zulassen: "allow",
  deny: "deny", drop: "deny", reject: "deny", block: "deny", verbieten: "deny", verweigern: "deny", blockieren: "deny", sperren: "deny",
};
const ANY = /^(any|all|alle|\*|beliebig)$/i;

function parseNet(text: string): Net {
  if (ANY.test(text)) return { any: true, start: 0n, end: 0n, text: "any" };
  const [a, p] = text.split("/");
  const ip = parseIp(a ?? "");
  if (!ip) throw new Error(`„${text}“ ist keine Adresse und kein Netz`);
  const bits = bitsOf(ip.version);
  const prefix = p === undefined ? bits : Number(p);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) throw new Error(`Präfix in „${text}“ ungültig`);
  const mask = prefixMask(ip.version, prefix);
  const start = ip.value & mask;
  const end = start | (~mask & ((1n << BigInt(bits)) - 1n));
  return { any: false, version: ip.version, start, end, text: prefix === bits ? formatIp(ip.version, start) : `${formatIp(ip.version, start)}/${prefix}` };
}

function parsePorts(text: string | undefined): [number, number][] {
  if (!text || ANY.test(text)) return [];
  return text.split(",").map((part) => {
    const m = /^(\d{1,5})(?:[-:](\d{1,5}))?$/.exec(part.trim());
    const lo = Number(m?.[1]);
    const hi = Number(m?.[2] ?? m?.[1]);
    if (!m || lo > 65535 || hi > 65535 || lo > hi) throw new Error(`Port „${part}“ ungültig`);
    return [lo, hi] as [number, number];
  });
}

/** Zeilen „aktion protokoll quelle ziel [port] [# Kommentar]“ */
export function parseRules(text: string): { rules: Rule[]; errors: { line: number; message: string }[] } {
  const rules: Rule[] = [];
  const errors: { line: number; message: string }[] = [];
  text.split(/\r?\n/).forEach((full, idx) => {
    const [body = "", ...c] = full.split("#");
    const raw = body.trim();
    if (!raw) return;
    try {
      const p = raw.split(/[\s;]+/);
      const action = ACTIONS[(p[0] ?? "").toLowerCase()];
      if (!action) throw new Error(`Aktion „${p[0]}“ unbekannt (erlauben/verbieten bzw. allow/deny)`);
      const protoText = (p[1] ?? "").toLowerCase();
      const proto: Proto | undefined = protoText === "ip" || ANY.test(protoText) ? "any" : (["tcp", "udp", "icmp"] as const).find((x) => x === protoText);
      if (!proto) throw new Error(`Protokoll „${p[1] ?? ""}“ unbekannt (tcp, udp, icmp, any)`);
      if (p.length < 4) throw new Error("Quelle und Ziel fehlen");
      if (p.length > 5) throw new Error("Zu viele Angaben – erwartet: Aktion Protokoll Quelle Ziel Port");
      const ports = parsePorts(p[4]);
      if (ports.length && (proto === "icmp" || proto === "any")) throw new Error("Ports gibt es nur bei tcp und udp");
      rules.push({ line: idx + 1, raw, action, proto, src: parseNet(p[2]!), dst: parseNet(p[3]!), ports, comment: c.join("#").trim() });
    } catch (e) {
      errors.push({ line: idx + 1, message: (e as Error).message });
    }
  });
  return { rules, errors };
}

export interface Packet {
  proto: "tcp" | "udp" | "icmp";
  src: string;
  dst: string;
  port?: number;
}

const inNet = (n: Net, ip: { version: IpVersion; value: bigint }) => n.any || (n.version === ip.version && ip.value >= n.start && ip.value <= n.end);

/** Index der ersten passenden Regel, sonst -1 (dann gilt die Standardrichtlinie) */
export function matchPacket(rules: Rule[], pkt: Packet): number {
  const src = parseIp(pkt.src.trim());
  const dst = parseIp(pkt.dst.trim());
  if (!src) throw new Error("Quelladresse des Testpakets ist ungültig.");
  if (!dst) throw new Error("Zieladresse des Testpakets ist ungültig.");
  if (pkt.proto !== "icmp" && !(pkt.port !== undefined && pkt.port >= 0 && pkt.port <= 65535)) throw new Error("Zielport des Testpakets fehlt (0–65535).");
  return rules.findIndex(
    (r) =>
      (r.proto === "any" || r.proto === pkt.proto) &&
      inNet(r.src, src) &&
      inNet(r.dst, dst) &&
      (r.ports.length === 0 || pkt.proto === "icmp" || r.ports.some(([lo, hi]) => pkt.port! >= lo && pkt.port! <= hi)),
  );
}

const covers = (a: Net, b: Net) => a.any || (!b.any && a.version === b.version && a.start <= b.start && a.end >= b.end);
const portsCover = (a: [number, number][], b: [number, number][]) => a.length === 0 || (b.length > 0 && b.every(([lo, hi]) => a.some(([l, h]) => l <= lo && h >= hi)));

export interface Shadow {
  rule: number;
  by: number;
  /** gleiche Aktion = überflüssig, andere Aktion = wirkungslos (wird nie erreicht) */
  sameAction: boolean;
}

/** Regeln, die nie greifen können, weil eine frühere Regel alles abdeckt */
export function findShadowed(rules: Rule[]): Shadow[] {
  const out: Shadow[] = [];
  rules.forEach((r, j) => {
    const i = rules.slice(0, j).findIndex((e) => (e.proto === "any" || e.proto === r.proto) && covers(e.src, r.src) && covers(e.dst, r.dst) && (e.proto === "any" || portsCover(e.ports, r.ports)));
    if (i >= 0) out.push({ rule: j, by: i, sameAction: rules[i]!.action === r.action });
  });
  return out;
}

export const portsText = (r: Rule) => (r.ports.length ? r.ports.map(([lo, hi]) => (lo === hi ? String(lo) : `${lo}-${hi}`)).join(",") : "alle");
