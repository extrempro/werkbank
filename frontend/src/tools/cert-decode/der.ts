/** DER-Kodierung (ASN.1) zum Erzeugen von PFX, P7B und Schlüsseldateien. */

export type Der = Uint8Array;

function encodeLength(len: number): number[] {
  if (len < 0x80) return [len];
  const bytes: number[] = [];
  for (let n = len; n > 0; n = Math.floor(n / 256)) bytes.unshift(n & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

export function tlv(tag: number, content: Uint8Array): Der {
  const len = encodeLength(content.length);
  const out = new Uint8Array(1 + len.length + content.length);
  out[0] = tag;
  out.set(len, 1);
  out.set(content, 1 + len.length);
  return out;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export const seq = (...items: Der[]) => tlv(0x30, concat(items));

/** SET OF – DER verlangt sortierte Elemente */
export function set(...items: Der[]): Der {
  const sorted = [...items].sort((a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
    return a.length - b.length;
  });
  return tlv(0x31, concat(sorted));
}

export const octets = (data: Uint8Array) => tlv(0x04, data);
export const nul = () => new Uint8Array([0x05, 0x00]);

/** [n] EXPLICIT (konstruiert) */
export const explicit = (n: number, inner: Der) => tlv(0xa0 | n, inner);

/** [n] IMPLICIT für primitive Inhalte (z. B. OCTET STRING) */
export const implicitPrimitive = (n: number, content: Uint8Array) => tlv(0x80 | n, content);

export function integer(value: number | bigint | Uint8Array): Der {
  let bytes: number[];
  if (value instanceof Uint8Array) {
    bytes = [...value];
    while (bytes.length > 1 && bytes[0] === 0 && bytes[1]! < 0x80) bytes.shift();
    if (bytes.length === 0) bytes = [0];
    if (bytes[0]! >= 0x80) bytes.unshift(0);
  } else {
    let n = BigInt(value);
    if (n < 0n) throw new Error("Negative Zahlen werden nicht unterstützt");
    bytes = [];
    do {
      bytes.unshift(Number(n & 0xffn));
      n >>= 8n;
    } while (n > 0n);
    if (bytes[0]! >= 0x80) bytes.unshift(0);
  }
  return tlv(0x02, Uint8Array.from(bytes));
}

export function oid(dotted: string): Der {
  const parts = dotted.split(".").map((p) => BigInt(p));
  const out: number[] = [];
  const push = (n: bigint) => {
    const chunk: number[] = [Number(n & 0x7fn)];
    for (n >>= 7n; n > 0n; n >>= 7n) chunk.unshift(Number(n & 0x7fn) | 0x80);
    out.push(...chunk);
  };
  push(parts[0]! * 40n + parts[1]!);
  for (const p of parts.slice(2)) push(p);
  return tlv(0x06, Uint8Array.from(out));
}

export function bmpString(text: string): Der {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    out[i * 2] = text.charCodeAt(i) >> 8;
    out[i * 2 + 1] = text.charCodeAt(i) & 0xff;
  }
  return tlv(0x1e, out);
}

export const bitString = (data: Uint8Array) => tlv(0x03, concat([new Uint8Array([0]), data]));

// ---------- PEM ----------

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, "");
  return Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
}

export function pem(label: string, der: Uint8Array, headers?: string[]): string {
  const body = toBase64(der).replace(/(.{64})/g, "$1\n").replace(/\n$/, "");
  const head = headers?.length ? `${headers.join("\n")}\n\n` : "";
  return `-----BEGIN ${label}-----\n${head}${body}\n-----END ${label}-----\n`;
}
