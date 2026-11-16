/**
 * DNS-Nachrichten im Binärformat (RFC 1035) für DNS-over-HTTPS nach RFC 8484 („application/dns-message“).
 * Damit funktionieren auch Resolver, die kein JSON anbieten (Quad9, AdGuard, Unbound, Technitium …).
 */

export const typeCodes: Record<string, number> = {
  A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, HINFO: 13, MX: 15, TXT: 16, RP: 17, AAAA: 28, LOC: 29, SRV: 33, NAPTR: 35,
  DNAME: 39, OPT: 41, DS: 43, SSHFP: 44, RRSIG: 46, NSEC: 47, DNSKEY: 48, NSEC3: 50, NSEC3PARAM: 51, TLSA: 52,
  SMIMEA: 53, CDS: 59, CDNSKEY: 60, OPENPGPKEY: 61, SVCB: 64, HTTPS: 65, SPF: 99, CAA: 257,
};
export const typeNamesByCode: Record<number, string> = Object.fromEntries(Object.entries(typeCodes).map(([k, v]) => [v, k]));

export interface WireAnswer {
  name: string;
  type: string;
  ttl: number;
  data: string;
}

export interface WireResponse {
  rcode: number;
  authenticated: boolean;
  truncated: boolean;
  answers: WireAnswer[];
}

// ---------- Anfrage ----------

export function encodeName(name: string): number[] {
  const out: number[] = [];
  const clean = name.replace(/\.$/, "");
  if (clean) {
    for (const label of clean.split(".")) {
      const bytes = new TextEncoder().encode(label);
      if (bytes.length === 0 || bytes.length > 63) throw new Error(`Ungültiger Namensteil „${label}“`);
      out.push(bytes.length, ...bytes);
    }
  }
  out.push(0);
  if (out.length > 255) throw new Error("Name ist zu lang");
  return out;
}

/**
 * Anfrage mit ID 0 (RFC 8484 empfiehlt das für Caching), RD und AD gesetzt (AD = „zeig mir, ob DNSSEC-validiert“).
 * Ohne EDNS/DO-Bit – sonst kämen RRSIG-Einträge mit, die hier nur stören.
 */
export function buildQuery(name: string, type: string): Uint8Array {
  const code = typeCodes[type.toUpperCase()] ?? (/^TYPE\d+$/i.test(type) ? Number(type.slice(4)) : undefined);
  if (code === undefined) throw new Error(`Unbekannter Typ ${type}`);
  const header = [0, 0, 0x01, 0x20, 0, 1, 0, 0, 0, 0, 0, 0];
  const question = [...encodeName(name), code >> 8, code & 0xff, 0, 1];
  return Uint8Array.from([...header, ...question]);
}

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------- Antwort ----------

class Reader {
  pos = 0;
  readonly buf: Uint8Array;
  constructor(buf: Uint8Array) {
    this.buf = buf;
  }
  need(n: number, at = this.pos) {
    if (at + n > this.buf.length) throw new Error("DNS-Antwort ist abgeschnitten");
  }
  u8() {
    this.need(1);
    return this.buf[this.pos++]!;
  }
  u16() {
    this.need(2);
    const v = (this.buf[this.pos]! << 8) | this.buf[this.pos + 1]!;
    this.pos += 2;
    return v;
  }
  u32() {
    return this.u16() * 65536 + this.u16();
  }
  bytes(n: number) {
    this.need(n);
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }
  /** Name mit Kompressionszeigern; liefert „example.com.“ */
  name(): string {
    const labels: string[] = [];
    let pos = this.pos;
    let jumped = false;
    let jumps = 0;
    for (;;) {
      this.need(1, pos);
      const len = this.buf[pos]!;
      if (len === 0) {
        pos++;
        break;
      }
      if ((len & 0xc0) === 0xc0) {
        this.need(2, pos);
        const target = ((len & 0x3f) << 8) | this.buf[pos + 1]!;
        if (!jumped) this.pos = pos + 2;
        jumped = true;
        if (++jumps > 64 || target >= this.buf.length) throw new Error("Fehlerhafte Namenskompression");
        pos = target;
        continue;
      }
      if (len > 63) throw new Error("Ungültige Label-Länge");
      this.need(len + 1, pos);
      labels.push(escapeLabel(this.buf.subarray(pos + 1, pos + 1 + len)));
      pos += len + 1;
    }
    if (!jumped) this.pos = pos;
    return labels.length ? `${labels.join(".")}.` : ".";
  }
}

function escapeLabel(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) {
    const c = String.fromCharCode(b);
    if (c === "." || c === "\\") s += `\\${c}`;
    else if (b < 0x21 || b > 0x7e) s += `\\${String(b).padStart(3, "0")}`;
    else s += c;
  }
  return s;
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("").toUpperCase();
const base64 = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
};

function characterString(r: Reader): string {
  const len = r.u8();
  const bytes = r.bytes(len);
  let s = "";
  for (const b of bytes) {
    if (b === 0x22 || b === 0x5c) s += `\\${String.fromCharCode(b)}`;
    else if (b < 0x20 || b > 0x7e) s += `\\${String(b).padStart(3, "0")}`;
    else s += String.fromCharCode(b);
  }
  return `"${s}"`;
}

function ipv6(b: Uint8Array): string {
  const groups = Array.from({ length: 8 }, (_, i) => ((b[i * 2]! << 8) | b[i * 2 + 1]!).toString(16));
  // längste Folge von Nullen durch :: ersetzen
  let best = -1;
  let bestLen = 1;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== "0") {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === "0") j++;
    if (j - i > bestLen) {
      best = i;
      bestLen = j - i;
    }
    i = j;
  }
  if (best < 0) return groups.join(":");
  return `${groups.slice(0, best).join(":")}::${groups.slice(best + bestLen).join(":")}`;
}

const svcKeys: Record<number, string> = { 0: "mandatory", 1: "alpn", 2: "no-default-alpn", 3: "port", 4: "ipv4hint", 5: "ech", 6: "ipv6hint" };

function svcParams(r: Reader, end: number): string {
  const parts: string[] = [];
  while (r.pos < end) {
    const key = r.u16();
    const len = r.u16();
    const v = r.bytes(len);
    const name = svcKeys[key] ?? `key${key}`;
    const sub = new Reader(v);
    switch (key) {
      case 1: {
        const ids: string[] = [];
        while (sub.pos < v.length) ids.push(new TextDecoder().decode(sub.bytes(sub.u8())));
        parts.push(`alpn=${ids.join(",")}`);
        break;
      }
      case 2:
        parts.push(name);
        break;
      case 3:
        parts.push(`port=${sub.u16()}`);
        break;
      case 4: {
        const ips: string[] = [];
        for (let i = 0; i + 4 <= v.length; i += 4) ips.push(Array.from(v.subarray(i, i + 4)).join("."));
        parts.push(`ipv4hint=${ips.join(",")}`);
        break;
      }
      case 6: {
        const ips: string[] = [];
        for (let i = 0; i + 16 <= v.length; i += 16) ips.push(ipv6(v.subarray(i, i + 16)));
        parts.push(`ipv6hint=${ips.join(",")}`);
        break;
      }
      case 0: {
        const keys: string[] = [];
        while (sub.pos < v.length) {
          const k = sub.u16();
          keys.push(svcKeys[k] ?? `key${k}`);
        }
        parts.push(`mandatory=${keys.join(",")}`);
        break;
      }
      case 5:
        parts.push(`ech=${base64(v)}`);
        break;
      default:
        parts.push(`${name}=${hex(v)}`);
    }
  }
  return parts.join(" ");
}

/** RDATA in Textform (Präsentationsformat), unbekannte Typen als „\# Länge Hex“ (RFC 3597) */
function rdata(r: Reader, type: number, len: number): string {
  const end = r.pos + len;
  r.need(len);
  const generic = () => {
    r.pos = end;
    return `\\# ${len}${len ? ` ${hex(r.buf.subarray(end - len, end))}` : ""}`;
  };
  try {
    let out: string;
    switch (type) {
      case 1:
        out = Array.from(r.bytes(4)).join(".");
        break;
      case 28:
        out = ipv6(r.bytes(16));
        break;
      case 2:
      case 5:
      case 12:
      case 39:
        out = r.name();
        break;
      case 15:
        out = `${r.u16()} ${r.name()}`;
        break;
      case 16:
      case 99: {
        const parts: string[] = [];
        while (r.pos < end) parts.push(characterString(r));
        out = parts.join(" ");
        break;
      }
      case 6:
        out = `${r.name()} ${r.name()} ${r.u32()} ${r.u32()} ${r.u32()} ${r.u32()} ${r.u32()}`;
        break;
      case 33:
        out = `${r.u16()} ${r.u16()} ${r.u16()} ${r.name()}`;
        break;
      case 257: {
        const flags = r.u8();
        const tag = new TextDecoder().decode(r.bytes(r.u8()));
        const value = new TextDecoder().decode(r.bytes(end - r.pos));
        out = `${flags} ${tag} "${value.replace(/["\\]/g, "\\$&")}"`;
        break;
      }
      case 43:
      case 59:
        out = `${r.u16()} ${r.u8()} ${r.u8()} ${hex(r.bytes(end - r.pos))}`;
        break;
      case 48:
      case 60:
        out = `${r.u16()} ${r.u8()} ${r.u8()} ${base64(r.bytes(end - r.pos))}`;
        break;
      case 52:
      case 53:
        out = `${r.u8()} ${r.u8()} ${r.u8()} ${hex(r.bytes(end - r.pos))}`;
        break;
      case 44:
        out = `${r.u8()} ${r.u8()} ${hex(r.bytes(end - r.pos))}`;
        break;
      case 35: {
        const order = r.u16();
        const pref = r.u16();
        out = `${order} ${pref} ${characterString(r)} ${characterString(r)} ${characterString(r)} ${r.name()}`;
        break;
      }
      case 64:
      case 65: {
        const prio = r.u16();
        const target = r.name();
        const params = svcParams(r, end);
        out = params ? `${prio} ${target} ${params}` : `${prio} ${target}`;
        break;
      }
      default:
        return generic();
    }
    if (r.pos !== end) return generic();
    return out;
  } catch {
    return generic();
  }
}

export function parseResponse(bytes: Uint8Array): WireResponse {
  const r = new Reader(bytes);
  r.u16(); // ID
  const flags = r.u16();
  const qd = r.u16();
  const an = r.u16();
  r.u16(); // Authority
  r.u16(); // Additional
  for (let i = 0; i < qd; i++) {
    r.name();
    r.u16();
    r.u16();
  }
  const answers: WireAnswer[] = [];
  for (let i = 0; i < an; i++) {
    const name = r.name();
    const type = r.u16();
    r.u16(); // Klasse
    const ttl = r.u32();
    const len = r.u16();
    const start = r.pos;
    const data = rdata(r, type, len);
    r.pos = start + len;
    if (type === 41) continue;
    answers.push({ name, type: typeNamesByCode[type] ?? `TYPE${type}`, ttl, data });
  }
  return { rcode: flags & 0x0f, authenticated: (flags & 0x0020) !== 0, truncated: (flags & 0x0200) !== 0, answers };
}
