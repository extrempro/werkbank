/** CSR (PKCS#10) im Browser erzeugen – der private Schlüssel verlässt den Browser nicht. */
import {
  bitString,
  concat,
  explicit,
  integer,
  nul,
  octets,
  oid,
  pem,
  seq,
  set,
  tlv,
} from "../cert-decode/der";

export type KeyType = "rsa2048" | "rsa3072" | "rsa4096" | "p256" | "p384";

export const keyTypeLabels: Record<KeyType, string> = {
  rsa2048: "RSA 2048 Bit (überall kompatibel)",
  rsa3072: "RSA 3072 Bit",
  rsa4096: "RSA 4096 Bit",
  p256: "ECDSA P-256 (kurz und schnell)",
  p384: "ECDSA P-384",
};

export interface Subject {
  CN: string;
  O?: string;
  OU?: string;
  L?: string;
  ST?: string;
  C?: string;
  E?: string;
}

const ATTR: Record<keyof Subject, { oid: string; tag: number }> = {
  C: { oid: "2.5.4.6", tag: 0x13 },
  ST: { oid: "2.5.4.8", tag: 0x0c },
  L: { oid: "2.5.4.7", tag: 0x0c },
  O: { oid: "2.5.4.10", tag: 0x0c },
  OU: { oid: "2.5.4.11", tag: 0x0c },
  CN: { oid: "2.5.4.3", tag: 0x0c },
  E: { oid: "1.2.840.113549.1.9.1", tag: 0x16 },
};

const utf8 = (s: string) => new TextEncoder().encode(s);

export function encodeName(subject: Subject): Uint8Array {
  const order: (keyof Subject)[] = ["C", "ST", "L", "O", "OU", "CN", "E"];
  const rdns = order
    .filter((k) => subject[k]?.trim())
    .map((k) => set(seq(oid(ATTR[k].oid), tlv(ATTR[k].tag, utf8(subject[k]!.trim())))));
  return seq(...rdns);
}

function ipBytes(ip: string): Uint8Array | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const p = ip.split(".").map(Number);
    return p.every((x) => x <= 255) ? Uint8Array.from(p) : null;
  }
  if (ip.includes(":")) {
    const [head, tail] = ip.split("::");
    const h = head ? head.split(":") : [];
    const t = tail !== undefined && tail ? tail.split(":") : [];
    const groups =
      tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
    if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null;
    return Uint8Array.from(groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff]));
  }
  return null;
}

export interface SanParsed {
  dns: string[];
  ip: string[];
  email: string[];
  invalid: string[];
}

export function parseSans(text: string): SanParsed {
  const r: SanParsed = { dns: [], ip: [], email: [], invalid: [] };
  for (const raw of text.split(/[\s,;]+/).filter(Boolean)) {
    const v = raw.replace(/^(DNS|IP|email):/i, "");
    if (ipBytes(v)) r.ip.push(v);
    else if (/^[^@\s]+@[^@\s]+$/.test(v)) r.email.push(v);
    else if (/^(\*\.)?([a-z0-9_]([a-z0-9_-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(v))
      r.dns.push(v.toLowerCase());
    else r.invalid.push(raw);
  }
  return r;
}

const algs: Record<
  KeyType,
  {
    gen: RsaHashedKeyGenParams | EcKeyGenParams;
    sign: AlgorithmIdentifier | EcdsaParams;
    sigOid: string;
    rsa: boolean;
    ecLen?: number;
  }
> = {
  rsa2048: {
    gen: {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    sign: "RSASSA-PKCS1-v1_5",
    sigOid: "1.2.840.113549.1.1.11",
    rsa: true,
  },
  rsa3072: {
    gen: {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    sign: "RSASSA-PKCS1-v1_5",
    sigOid: "1.2.840.113549.1.1.11",
    rsa: true,
  },
  rsa4096: {
    gen: {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 4096,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    sign: "RSASSA-PKCS1-v1_5",
    sigOid: "1.2.840.113549.1.1.11",
    rsa: true,
  },
  p256: {
    gen: { name: "ECDSA", namedCurve: "P-256" },
    sign: { name: "ECDSA", hash: "SHA-256" },
    sigOid: "1.2.840.10045.4.3.2",
    rsa: false,
    ecLen: 32,
  },
  p384: {
    gen: { name: "ECDSA", namedCurve: "P-384" },
    sign: { name: "ECDSA", hash: "SHA-384" },
    sigOid: "1.2.840.10045.4.3.3",
    rsa: false,
    ecLen: 48,
  },
};

export interface CsrOptions {
  keyType: KeyType;
  subject: Subject;
  sans: string;
  /** Erweiterte Schlüsselverwendung: Server / Client */
  serverAuth: boolean;
  clientAuth: boolean;
}

export interface CsrResult {
  csrPem: string;
  /** unverschlüsseltes PKCS#8 */
  pkcs8: Uint8Array;
  keyPem: string;
}

export async function createCsr(o: CsrOptions): Promise<CsrResult> {
  if (!o.subject.CN.trim()) throw new Error("Common Name (CN) fehlt");
  if (o.subject.C && !/^[A-Z]{2}$/.test(o.subject.C.trim()))
    throw new Error("Land (C) muss ein zweistelliger Code sein, z. B. DE");
  const sans = parseSans(o.sans);
  if (sans.invalid.length)
    throw new Error(`Ungültige alternative Namen: ${sans.invalid.join(", ")}`);
  const subtle = crypto.subtle;
  if (!subtle) throw new Error("Schlüsselerzeugung braucht HTTPS (Web Crypto)");
  const a = algs[o.keyType];
  const keys = (await subtle.generateKey(a.gen, true, ["sign", "verify"])) as CryptoKeyPair;
  const spki = new Uint8Array(await subtle.exportKey("spki", keys.publicKey));
  const pkcs8 = new Uint8Array(await subtle.exportKey("pkcs8", keys.privateKey));

  const extensions: Uint8Array[] = [];
  const names = [
    ...sans.dns.map((d) => tlv(0x82, utf8(d))),
    ...sans.ip.map((i) => tlv(0x87, ipBytes(i)!)),
    ...sans.email.map((e) => tlv(0x81, utf8(e))),
  ];
  if (names.length) extensions.push(seq(oid("2.5.29.17"), octets(seq(...names))));
  const eku = [o.serverAuth && "1.3.6.1.5.5.7.3.1", o.clientAuth && "1.3.6.1.5.5.7.3.2"].filter(
    Boolean,
  ) as string[];
  if (eku.length) extensions.push(seq(oid("2.5.29.37"), octets(seq(...eku.map(oid)))));
  // keyUsage: RSA digitalSignature+keyEncipherment, EC digitalSignature (kritisch)
  extensions.push(
    seq(
      oid("2.5.29.15"),
      tlv(0x01, new Uint8Array([0xff])),
      octets(a.rsa ? tlv(0x03, new Uint8Array([5, 0xa0])) : tlv(0x03, new Uint8Array([7, 0x80]))),
    ),
  );
  const attrs = extensions.length
    ? tlv(0xa0, seq(oid("1.2.840.113549.1.9.14"), set(seq(...extensions))))
    : tlv(0xa0, new Uint8Array());

  const cri = seq(integer(0), encodeName(o.subject), spki, attrs);
  let sig: Uint8Array = new Uint8Array(
    await subtle.sign(a.sign, keys.privateKey, cri as BufferSource),
  );
  if (!a.rsa) {
    const n = a.ecLen!;
    sig = seq(integer(sig.subarray(0, n)), integer(sig.subarray(n)));
  }
  const algId = a.rsa ? seq(oid(a.sigOid), nul()) : seq(oid(a.sigOid));
  const csr = seq(cri, algId, bitString(sig));
  return { csrPem: pem("CERTIFICATE REQUEST", csr), pkcs8, keyPem: pem("PRIVATE KEY", pkcs8) };
}

/** OpenSSL-Befehl, der dasselbe erzeugt (zum Nachvollziehen) */
export function opensslCommand(o: CsrOptions): string {
  const subj = (["C", "ST", "L", "O", "OU", "CN"] as (keyof Subject)[])
    .filter((k) => o.subject[k]?.trim())
    .map((k) => `/${k}=${o.subject[k]!.trim().replace(/\//g, "\\/")}`)
    .join("");
  const sans = parseSans(o.sans);
  const san = [
    ...sans.dns.map((d) => `DNS:${d}`),
    ...sans.ip.map((i) => `IP:${i}`),
    ...sans.email.map((e) => `email:${e}`),
  ].join(",");
  const key = o.keyType.startsWith("rsa")
    ? `-newkey rsa:${o.keyType.slice(3)}`
    : `-newkey ec -pkeyopt ec_paramgen_curve:${o.keyType === "p256" ? "P-256" : "P-384"}`;
  // In einfachen Anführungszeichen, damit die Shell nichts aus den Namen ausführt
  const quote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;
  return `openssl req -new ${key} -nodes -keyout server.key -out server.csr -subj ${quote(subj)}${san ? ` -addext ${quote(`subjectAltName=${san}`)}` : ""}`;
}

export { concat, explicit };
