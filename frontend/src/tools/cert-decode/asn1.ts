/** Minimaler DER-Parser (ASN.1) – genug für X.509-Zertifikate, CSRs und PKCS#7-Ketten. */

export const TagClass = {
  Universal: 0,
  Application: 1,
  Context: 2,
  Private: 3,
} as const;
export type TagClass = (typeof TagClass)[keyof typeof TagClass];

export const Tag = {
  Boolean: 1,
  Integer: 2,
  BitString: 3,
  OctetString: 4,
  Null: 5,
  Oid: 6,
  Utf8String: 12,
  Sequence: 16,
  Set: 17,
  PrintableString: 19,
  T61String: 20,
  Ia5String: 22,
  UtcTime: 23,
  GeneralizedTime: 24,
  UniversalString: 28,
  BmpString: 30,
} as const;

export interface Asn1Node {
  cls: TagClass;
  tag: number;
  constructed: boolean;
  /** Position des Tag-Bytes */
  start: number;
  contentStart: number;
  /** Ende des Inhalts (bei BER mit unbestimmter Länge vor der Endmarke 00 00) */
  contentEnd: number;
  end: number;
  children: Asn1Node[];
  /** gesamter Eingabepuffer – Inhalt über content() lesen */
  buffer: Uint8Array;
}

/**
 * Liest ein DER-Element. Mit `ber = true` sind auch BER-Eigenheiten erlaubt (unbestimmte Längen),
 * wie sie manche PFX-Dateien (z. B. aus Java oder macOS) verwenden.
 */
export function parseDer(buffer: Uint8Array, offset = 0, limit = buffer.length, ber = false): Asn1Node {
  let pos = offset;
  const need = (n: number) => {
    if (pos + n > limit) throw new Error("DER-Daten sind abgeschnitten");
  };

  need(1);
  const first = buffer[pos++]!;
  const cls = (first >> 6) as TagClass;
  const constructed = (first & 0x20) !== 0;
  let tag = first & 0x1f;
  if (tag === 0x1f) {
    tag = 0;
    let b: number;
    do {
      need(1);
      b = buffer[pos++]!;
      tag = tag * 128 + (b & 0x7f);
    } while (b & 0x80);
  }

  need(1);
  let length = buffer[pos++]!;
  if (length === 0x80) {
    if (!ber || !constructed) throw new Error("Unbestimmte Länge ist in DER nicht erlaubt");
    const node: Asn1Node = { cls, tag, constructed, start: offset, contentStart: pos, contentEnd: pos, end: pos, children: [], buffer };
    let p = pos;
    for (;;) {
      if (p + 2 > limit) throw new Error("BER-Daten sind abgeschnitten (Endmarke fehlt)");
      if (buffer[p] === 0 && buffer[p + 1] === 0) break;
      const child = parseDer(buffer, p, limit, ber);
      node.children.push(child);
      p = child.end;
    }
    node.contentEnd = p;
    node.end = p + 2;
    return node;
  }
  if (length > 0x80) {
    const count = length & 0x7f;
    if (count > 4) throw new Error("Längenangabe zu groß");
    need(count);
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + buffer[pos++]!;
  }

  const contentStart = pos;
  const end = contentStart + length;
  if (end > limit) throw new Error("DER-Daten sind abgeschnitten");

  const node: Asn1Node = { cls, tag, constructed, start: offset, contentStart, contentEnd: end, end, children: [], buffer };
  if (constructed) {
    let p = contentStart;
    while (p < end) {
      const child = parseDer(buffer, p, end, ber);
      node.children.push(child);
      p = child.end;
    }
  }
  return node;
}

/** Parst einen Puffer, der genau ein DER-Element enthalten muss. */
export function parseDerStrict(bytes: Uint8Array): Asn1Node {
  const node = parseDer(bytes);
  if (node.end !== bytes.length) throw new Error("Zusätzliche Daten nach dem DER-Element");
  return node;
}

export function content(node: Asn1Node): Uint8Array {
  return node.buffer.subarray(node.contentStart, node.contentEnd);
}

/** Inhalt eines OCTET STRING – bei BER auch zusammengesetzt aus mehreren Teilen */
export function octetString(node: Asn1Node): Uint8Array {
  if (!node.constructed) return content(node);
  const parts = node.children.map(octetString);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** Komplettes Element inkl. Tag und Länge (z. B. für Fingerprints) */
export function raw(node: Asn1Node): Uint8Array {
  return node.buffer.subarray(node.start, node.end);
}

export function isUniversal(node: Asn1Node | undefined, tag: number): node is Asn1Node {
  return !!node && node.cls === TagClass.Universal && node.tag === tag;
}

export function isContext(node: Asn1Node | undefined, tag: number): node is Asn1Node {
  return !!node && node.cls === TagClass.Context && node.tag === tag;
}

export function child(node: Asn1Node, index: number): Asn1Node {
  const c = node.children[index];
  if (!c) throw new Error("Unerwarteter Aufbau der DER-Daten");
  return c;
}

export function readOid(node: Asn1Node): string {
  const bytes = content(node);
  if (bytes.length === 0) throw new Error("Leere OID");
  const parts: bigint[] = [];
  let value = 0n;
  for (const b of bytes) {
    value = (value << 7n) | BigInt(b & 0x7f);
    if (!(b & 0x80)) {
      parts.push(value);
      value = 0n;
    }
  }
  const first = parts.shift()!;
  const a = first < 40n ? 0n : first < 80n ? 1n : 2n;
  return [a, first - a * 40n, ...parts].join(".");
}

export function toHex(bytes: Uint8Array, separator = ""): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(separator);
}

/** INTEGER als Hex (führende Null für positive Zahlen entfernt) */
export function readIntegerHex(node: Asn1Node): string {
  let bytes = content(node);
  while (bytes.length > 1 && bytes[0] === 0) bytes = bytes.subarray(1);
  return toHex(bytes).toUpperCase();
}

export function readSmallInt(node: Asn1Node): number {
  let n = 0;
  for (const b of content(node)) n = n * 256 + b;
  return n;
}

export function readBoolean(node: Asn1Node): boolean {
  return content(node)[0] !== 0;
}

/** Inhalt eines BIT STRING ohne das Byte für ungenutzte Bits */
export function readBitString(node: Asn1Node): Uint8Array {
  return content(node).subarray(1);
}

export function readString(node: Asn1Node): string {
  const bytes = content(node);
  switch (node.tag) {
    case Tag.Utf8String:
      return new TextDecoder("utf-8").decode(bytes);
    case Tag.BmpString: {
      let s = "";
      for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
      return s;
    }
    case Tag.UniversalString: {
      let s = "";
      for (let i = 0; i + 3 < bytes.length; i += 4) {
        s += String.fromCodePoint(((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0);
      }
      return s;
    }
    default:
      // PrintableString, IA5String, T61String … – Latin-1 als Näherung
      return String.fromCharCode(...bytes);
  }
}

export function readTime(node: Asn1Node): Date {
  const s = String.fromCharCode(...content(node));
  const m =
    node.tag === Tag.UtcTime
      ? s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/)
      : s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z$/);
  if (!m) throw new Error(`Unbekanntes Zeitformat: ${s}`);
  let year = Number(m[1]);
  if (node.tag === Tag.UtcTime) year += year < 50 ? 2000 : 1900;
  return new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)));
}
