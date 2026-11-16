/**
 * APC/Schneider Network Management Card (NMC2/NMC3): Zertifikat + privater Schlüssel als .p15.
 *
 * Die NMC nimmt im Web-UI genau eine Datei an – eine PKCS#15-Datei im Format von cryptlib
 * (das nutzt APCs „NMC Security Wizard“) mit vorangestelltem 228-Byte-Header von APC.
 * Der private Schlüssel steckt darin als AuthEnvelopedData (RFC 5083) mit Passwort-Empfänger
 * (RFC 3211): KEK über PBKDF2-HMAC-SHA256 aus dem festen Kennwort „user“, CEK mit 3DES gewickelt,
 * Inhalt 3DES-CBC, MAC HMAC-SHA256 (cryptlib „authEnc128“). Das Kennwort ist fest vorgegeben –
 * die Datei ist damit praktisch unverschlüsselt und muss wie ein Klartext-Schlüssel behandelt werden.
 *
 * Eigene Umsetzung anhand der veröffentlichten Formatbeschreibungen (PKCS#15, RFC 3211/5083,
 * Analysen von apc_tools und apc-p15-tool); geprüft durch Rückwärts-Entschlüsselung in den Tests.
 */
import {
  child,
  content,
  isContext,
  isUniversal,
  parseDerStrict,
  raw,
  readBitString,
  readOid,
  Tag,
  type Asn1Node,
} from "./asn1";
import {
  concat,
  explicit,
  implicitPrimitive,
  integer,
  octets,
  oid,
  seq,
  set,
  tlv,
  type Der,
} from "./der";
import { cbcDecrypt, cbcEncrypt, tripleDesCipher, type BlockCipher } from "./des";
import type { PrivateKey } from "./keys";
import type { CertificateInfo } from "./x509";

const OID = {
  pkcs15Content: "1.2.840.113549.1.15.3.1",
  rsaEncryption: "1.2.840.113549.1.1.1",
  pbkdf2: "1.2.840.113549.1.5.12",
  hmacSha256: "1.2.840.113549.2.9",
  pwriKek: "1.2.840.113549.1.9.16.3.9",
  desEde3Cbc: "1.2.840.113549.3.7",
  data: "1.2.840.113549.1.7.1",
  authEnc128: "1.2.840.113549.1.9.16.3.15",
} as const;

/** fest vorgegeben von APC (Security Wizard / NMC-Firmware) */
const KEY_LABEL = "Private key";
const KEK_PASSWORD = "user";
const KEK_ITERATIONS = 5000;
export const APC_HEADER_LENGTH = 228;
const HEADER_TOOL_NAME = "NMCSecurityWizardCLI100";

/** RSA-Schlüssellängen, die die NMC2 annimmt (3072 offiziell nicht, funktioniert aber) */
export const NMC2_RSA_BITS = [1024, 2048, 3072] as const;

// ---------- Hilfen ----------

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s)
    throw new Error(
      "Die Web Crypto API ist nicht verfügbar – die Toolbox muss über HTTPS (oder localhost) laufen.",
    );
  return s;
};
const buf = (b: Uint8Array) => b as BufferSource;

async function sha1(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().digest("SHA-1", buf(data)));
}

async function pbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  hash: "SHA-1" | "SHA-256",
  length: number,
): Promise<Uint8Array> {
  const key = await subtle().importKey("raw", buf(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(
    await subtle().deriveBits(
      { name: "PBKDF2", salt: buf(salt), iterations, hash },
      key,
      length * 8,
    ),
  );
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey("raw", buf(key), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return new Uint8Array(await subtle().sign("HMAC", k, buf(data)));
}

const utf8 = (s: string) => new TextEncoder().encode(s);

const defaultRandom = (n: number) => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
};

/** CBC ohne Auffüllung (Länge muss ein Vielfaches der Blockgröße sein) */
function cbcRaw(
  cipher: BlockCipher,
  iv: Uint8Array,
  data: Uint8Array,
  decrypt = false,
): Uint8Array {
  const n = cipher.blockSize;
  if (data.length % n !== 0) throw new Error("CBC-Daten haben eine ungültige Länge");
  const out = new Uint8Array(data.length);
  let prev = iv;
  for (let i = 0; i < data.length; i += n) {
    const block = data.subarray(i, i + n);
    if (decrypt) {
      const plain = cipher.decryptBlock(block);
      for (let j = 0; j < n; j++) out[i + j] = plain[j]! ^ prev[j]!;
      prev = block;
    } else {
      const x = new Uint8Array(n);
      for (let j = 0; j < n; j++) x[j] = block[j]! ^ prev[j]!;
      const enc = cipher.encryptBlock(x);
      out.set(enc, i);
      prev = enc;
    }
  }
  return out;
}

/** vorzeichenlose Zahl ohne führende Nullen */
function unsigned(bytes: Uint8Array): Uint8Array {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  return bytes.subarray(i);
}

function bitLength(bytes: Uint8Array): number {
  const b = unsigned(bytes);
  if (b.length === 1 && b[0] === 0) return 0;
  return (b.length - 1) * 8 + (32 - Math.clz32(b[0]!));
}

/** [n] IMPLICIT INTEGER */
function implicitInteger(n: number, value: Uint8Array): Der {
  const der = integer(value);
  return implicitPrimitive(n, content(parseDerStrict(der)));
}

/** GeneralizedTime-Inhalt „JJJJMMTTHHMMSSZ“ (UTC, ohne Sekundenbruchteile) */
function generalizedTimeContent(date: Date): Uint8Array {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const text =
    p(date.getUTCFullYear(), 4) +
    p(date.getUTCMonth() + 1) +
    p(date.getUTCDate()) +
    p(date.getUTCHours()) +
    p(date.getUTCMinutes()) +
    p(date.getUTCSeconds()) +
    "Z";
  return utf8(text);
}
const generalizedTime = (d: Date) => tlv(0x18, generalizedTimeContent(d));
const utf8String = (s: string) => tlv(0x0c, utf8(s));

/** BIT STRING aus einer Bitfolge, z. B. „1110001“ (benannte Bits, Reihenfolge wie in PKCS#15) */
function namedBits(bits: string): Der {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  [...bits].forEach((b, i) => {
    if (b === "1") bytes[i >> 3]! |= 0x80 >> (i & 7);
  });
  const unused = bytes.length * 8 - bits.length;
  return tlv(0x03, concat([new Uint8Array([unused]), bytes]));
}

// ---------- CRC & Header ----------

/** CRC-16/XMODEM (Polynom 0x1021, Startwert 0) */
export function crc16Xmodem(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++)
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

/** 16-Bit-Prüfsumme mit Vorzeichenerweiterung auf 32 Bit (so schreibt es der Security Wizard) */
const signExtend16 = (v: number) => ((v << 16) >> 16) >>> 0;

/** 228-Byte-Header von APC vor der eigentlichen PKCS#15-Datei */
export function apcHeader(p15: Uint8Array): Uint8Array {
  const header = new Uint8Array(APC_HEADER_LENGTH);
  const view = new DataView(header.buffer);
  view.setUint32(0, 1, true);
  view.setUint32(4, 1, true);
  header.set(utf8(HEADER_TOOL_NAME), 8);
  view.setUint32(208, 1, true);
  view.setUint32(212, 1, true);
  view.setUint32(216, p15.length, true);
  view.setUint32(220, signExtend16(crc16Xmodem(p15)), true);
  view.setUint32(224, signExtend16(crc16Xmodem(header.subarray(0, 224))), true);
  return header;
}

// ---------- RSA-Schlüssel ----------

interface RsaParts {
  n: Uint8Array;
  e: Uint8Array;
  p: Uint8Array;
  q: Uint8Array;
  dp: Uint8Array;
  dq: Uint8Array;
  qinv: Uint8Array;
}

function rsaParts(key: PrivateKey): RsaParts {
  if (key.traditional?.label !== "RSA PRIVATE KEY") {
    const alg = key.publicKey.algorithm;
    throw new Error(
      `Die NMC2 unterstützt nur RSA-Schlüssel – dieser Schlüssel ist ${alg}${key.publicKey.curve ? ` (${key.publicKey.curve})` : ""}.`,
    );
  }
  const rsa = parseDerStrict(key.traditional.der);
  const at = (i: number) => unsigned(content(child(rsa, i))).slice();
  return { n: at(1), e: at(2), p: at(4), q: at(5), dp: at(6), dq: at(7), qinv: at(8) };
}

function certModulus(cert: CertificateInfo): Uint8Array | undefined {
  try {
    const spki = parseDerStrict(cert.spki);
    if (readOid(child(child(spki, 0), 0)) !== OID.rsaEncryption) return undefined;
    const rsa = parseDerStrict(readBitString(child(spki, 1)));
    return unsigned(content(child(rsa, 0)));
  } catch {
    return undefined;
  }
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

// ---------- Zertifikat: Rohdaten für die Schlüssel-IDs ----------

interface CertRaw {
  serial: Uint8Array;
  issuer: Uint8Array;
  subject: Uint8Array;
}

function certRaw(der: Uint8Array): CertRaw {
  const tbs = child(parseDerStrict(der), 0);
  const i = isContext(tbs.children[0], 0) ? 1 : 0;
  return {
    serial: raw(child(tbs, i)).slice(),
    issuer: raw(child(tbs, i + 2)).slice(),
    subject: raw(child(tbs, i + 4)).slice(),
  };
}

/** Schlüssel-ID 9: OpenPGP-v4-Key-ID (RFC 4880, 12.2) – Erstellzeit = Beginn der Gültigkeit */
async function openPgpKeyId(rsa: RsaParts, created: Date): Promise<Uint8Array> {
  const mpi = (v: Uint8Array) => {
    const bits = bitLength(v);
    return concat([new Uint8Array([bits >> 8, bits & 0xff]), unsigned(v)]);
  };
  const time = Math.floor(created.getTime() / 1000) >>> 0;
  const packet = concat([
    new Uint8Array([4, time >>> 24, (time >>> 16) & 0xff, (time >>> 8) & 0xff, time & 0xff, 1]),
    mpi(rsa.n),
    mpi(rsa.e),
  ]);
  const hash = await sha1(
    concat([new Uint8Array([0x99, packet.length >> 8, packet.length & 0xff]), packet]),
  );
  return hash.subarray(12);
}

const keyIdEntry = (type: number, value: Uint8Array) => seq(integer(type), octets(value));

// ---------- Verschlüsselung des privaten Schlüssels ----------

export interface ApcP15Options {
  /** Zufallsquelle (für Tests austauschbar) */
  random?: (n: number) => Uint8Array;
}

async function envelope(plain: Uint8Array, random: (n: number) => Uint8Array): Promise<Der> {
  // KEK aus dem festen Kennwort
  const kekSalt = random(8);
  const kek = await pbkdf2(utf8(KEK_PASSWORD), kekSalt, KEK_ITERATIONS, "SHA-256", 24);
  const kekCipher = tripleDesCipher(kek);

  // CEK nach RFC 3211 wickeln: Länge, Prüfbytes (Komplement), CEK, Auffüllung; zweimal CBC
  const cek = random(16);
  let wrapped = concat([
    new Uint8Array([cek.length, ~cek[0]! & 0xff, ~cek[1]! & 0xff, ~cek[2]! & 0xff]),
    cek,
  ]);
  const minLen = 2 * kekCipher.blockSize;
  const target = Math.max(
    minLen,
    Math.ceil(wrapped.length / kekCipher.blockSize) * kekCipher.blockSize,
  );
  wrapped = concat([wrapped, random(target - wrapped.length)]);
  const wrapIv = random(8);
  const pass1 = cbcRaw(kekCipher, wrapIv, wrapped);
  const encryptedCek = cbcRaw(kekCipher, pass1.subarray(pass1.length - 8), pass1);

  // Inhalt mit 3DES verschlüsseln, MAC über Algorithmus + Chiffrat
  const contentIv = random(8);
  const encKey = await pbkdf2(cek, utf8("encryption"), 1, "SHA-1", 24);
  const macKey = await pbkdf2(cek, utf8("authentication"), 1, "SHA-1", 32);
  const encrypted = cbcEncrypt(tripleDesCipher(encKey), contentIv, plain);
  const encAlg = seq(
    oid(OID.authEnc128),
    seq(
      seq(oid(OID.desEde3Cbc), octets(contentIv)),
      seq(oid(OID.hmacSha256), new Uint8Array([5, 0])),
    ),
  );
  const mac = await hmacSha256(macKey, concat([encAlg, encrypted]));

  const pwri = tlv(
    0xa3,
    concat([
      integer(0),
      explicit(
        0,
        concat([
          oid(OID.pbkdf2),
          seq(
            octets(kekSalt),
            integer(KEK_ITERATIONS),
            seq(oid(OID.hmacSha256), new Uint8Array([5, 0])),
          ),
        ]),
      ),
      seq(oid(OID.pwriKek), seq(oid(OID.desEde3Cbc), octets(wrapIv))),
      octets(encryptedCek),
    ]),
  );
  // Inhalt von AuthEnvelopedData (ohne äußere SEQUENCE – steht direkt in [4])
  return concat([
    integer(2),
    set(pwri),
    seq(oid(OID.data), encAlg, implicitPrimitive(0, encrypted)),
    octets(mac),
  ]);
}

// ---------- Datei erzeugen ----------

export interface ApcCheck {
  tone: "ok" | "warn" | "error";
  text: string;
}

const KNOWN_GOOD_SIGNATURE = "SHA-256 mit RSA";
const KNOWN_EXTENSIONS = new Set([
  "2.5.29.15",
  "2.5.29.19",
  "2.5.29.17",
  "2.5.29.37",
  "2.5.29.14",
  "2.5.29.35",
  "1.3.6.1.5.5.7.1.1",
  "2.5.29.32",
  "1.3.6.1.4.1.11129.2.4.2",
  "2.5.29.31",
]);
const CRITICAL_OK = new Set(["2.5.29.15", "2.5.29.19", "2.5.29.17"]);

/** Prüft vorab, ob Zertifikat und Schlüssel zur NMC2 passen. Einträge mit „error“ verhindern den Export. */
export function checkApcCompatibility(
  cert: CertificateInfo,
  key: PrivateKey | undefined,
  now = new Date(),
): ApcCheck[] {
  const checks: ApcCheck[] = [];
  if (!key) {
    checks.push({
      tone: "error",
      text: "Ohne passenden privaten Schlüssel ist keine .p15-Datei möglich.",
    });
    return checks;
  }
  const bits = key.publicKey.bits;
  if (key.traditional?.label !== "RSA PRIVATE KEY") {
    checks.push({
      tone: "error",
      text: `Die NMC2 unterstützt nur RSA-Schlüssel – hier: ${key.publicKey.algorithm}${key.publicKey.curve ? ` ${key.publicKey.curve}` : ""}.`,
    });
  } else if (!bits || !(NMC2_RSA_BITS as readonly number[]).includes(bits)) {
    checks.push({
      tone: "error",
      text: `RSA mit ${bits ?? "?"} Bit wird von der NMC2 nicht unterstützt (möglich: 1024, 2048, 3072 Bit; empfohlen 2048). Größere Schlüssel lehnt die Karte ab.`,
    });
  } else if (bits === 1024) {
    checks.push({
      tone: "warn",
      text: "RSA 1024 Bit ist veraltet – aktuelle Browser lehnen solche Zertifikate teilweise ab. Besser 2048 Bit.",
    });
  } else if (bits === 3072) {
    checks.push({
      tone: "warn",
      text: "RSA 3072 Bit ist offiziell nicht freigegeben, funktioniert laut Erfahrungsberichten aber. Am sichersten: 2048 Bit.",
    });
  } else {
    checks.push({ tone: "ok", text: `RSA ${bits} Bit – passt.` });
  }
  if (cert.signatureAlgorithm !== KNOWN_GOOD_SIGNATURE) {
    checks.push({
      tone: "warn",
      text: `Signaturverfahren „${cert.signatureAlgorithm}“: bekannt funktionierend ist nur SHA-256 mit RSA.`,
    });
  }
  if (now < cert.notBefore)
    checks.push({ tone: "warn", text: "Das Zertifikat ist noch nicht gültig." });
  if (now > cert.notAfter) checks.push({ tone: "warn", text: "Das Zertifikat ist abgelaufen." });
  for (const ext of cert.extensions) {
    const ok = ext.critical ? CRITICAL_OK.has(ext.oid) : KNOWN_EXTENSIONS.has(ext.oid);
    if (!ok)
      checks.push({
        tone: "warn",
        text: `${ext.critical ? "Kritische " : ""}Erweiterung „${ext.name}“ wird von der NMC möglicherweise nicht unterstützt.`,
      });
  }
  if (!cert.san.some((s) => s.type === "DNS" || s.type === "IP")) {
    checks.push({
      tone: "warn",
      text: "Das Zertifikat hat keinen DNS- oder IP-Eintrag im SAN – Browser melden dann einen Namensfehler.",
    });
  }
  return checks;
}

/**
 * Erzeugt die .p15-Datei (mit APC-Header) für den Upload unter
 * Configuration → Network → Web → SSL Certificate bzw. per FTP/SCP nach /ssl.
 */
export async function buildApcP15(
  cert: CertificateInfo,
  key: PrivateKey,
  options: ApcP15Options = {},
): Promise<Uint8Array> {
  const random = options.random ?? defaultRandom;
  const rsa = rsaParts(key);
  const bits = bitLength(rsa.n);
  if (!(NMC2_RSA_BITS as readonly number[]).includes(bits)) {
    throw new Error(
      `RSA mit ${bits} Bit wird von der NMC2 nicht unterstützt (möglich: 1024, 2048, 3072 Bit).`,
    );
  }
  const modulus = certModulus(cert);
  if (!modulus || !sameBytes(modulus, rsa.n))
    throw new Error("Privater Schlüssel und Zertifikat passen nicht zusammen.");

  const { serial, issuer, subject } = certRaw(cert.der);
  const keyId = await sha1(cert.spki);

  // privater Schlüssel (cryptlib-Format: nur p, q, dp, dq, qinv als [3]…[7])
  const plain = seq(
    implicitInteger(3, rsa.p),
    implicitInteger(4, rsa.q),
    implicitInteger(5, rsa.dp),
    implicitInteger(6, rsa.dq),
    implicitInteger(7, rsa.qinv),
  );
  const enveloped = await envelope(plain, random);

  const privateKeyObject = seq(
    seq(utf8String(KEY_LABEL)),
    seq(
      octets(keyId),
      namedBits("1110001"), // usage: encrypt, decrypt, sign, nonRepudiation
      namedBits("1011"), // accessFlags: sensitive, alwaysSensitive, neverExtractable
      generalizedTime(cert.notBefore),
      implicitPrimitive(0, generalizedTimeContent(cert.notAfter)),
    ),
    explicit(1, seq(explicit(4, enveloped))),
  );

  const certificateObject = seq(
    seq(utf8String(KEY_LABEL)),
    seq(
      octets(keyId),
      explicit(
        2,
        concat([
          keyIdEntry(2, keyId),
          keyIdEntry(3, await sha1(seq(issuer, serial))),
          keyIdEntry(6, await sha1(issuer)),
          keyIdEntry(7, await sha1(subject)),
          keyIdEntry(8, rsa.n.subarray(rsa.n.length - 8)),
          keyIdEntry(9, await openPgpKeyId(rsa, cert.notBefore)),
        ]),
      ),
      generalizedTime(cert.notBefore),
      implicitPrimitive(4, generalizedTimeContent(cert.notAfter)),
    ),
    explicit(1, seq(explicit(0, cert.der))),
  );

  const p15 = seq(
    oid(OID.pkcs15Content),
    explicit(
      0,
      seq(
        integer(0),
        seq(
          explicit(0, explicit(0, privateKeyObject)),
          explicit(4, explicit(0, certificateObject)),
        ),
      ),
    ),
  );
  return concat([apcHeader(p15), p15]);
}

// ---------- Datei lesen ----------

const PKCS15_PREFIX = [0x06, 0x0a, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x0f, 0x03, 0x01];

/** beginnt hier eine PKCS#15-Datei (SEQUENCE mit OID pkcs15-content)? */
function pkcs15At(bytes: Uint8Array, offset: number): boolean {
  if (bytes[offset] !== 0x30) return false;
  const len = bytes[offset + 1] ?? 0;
  const hl = len < 0x80 ? 2 : 2 + (len & 0x7f);
  return PKCS15_PREFIX.every((b, i) => bytes[offset + hl + i] === b);
}

/** Erkennt .p15-Dateien von APC (mit Header) und reine PKCS#15-Dateien (ohne Header). */
export function looksLikeApcP15(bytes: Uint8Array): boolean {
  return (
    (bytes.length > APC_HEADER_LENGTH && pkcs15At(bytes, APC_HEADER_LENGTH)) || pkcs15At(bytes, 0)
  );
}

export interface ApcP15Content {
  /** APC-Header vorhanden (und Prüfsummen korrekt) */
  header: boolean;
  /** Werkzeug-Kennung aus dem Header, z. B. „NMCSecurityWizardCLI100“ */
  tool?: string;
  label: string;
  /** Zertifikat (DER) – fehlt bei reinen Schlüsseldateien, z. B. aus „--csr“ */
  certificate?: Uint8Array;
  /** öffentlicher Schlüssel (SubjectPublicKeyInfo) */
  spki?: Uint8Array;
  /** vollständiger privater RSA-Schlüssel als PKCS#1 (DER), aus den gespeicherten Teilen berechnet */
  rsaPkcs1: Uint8Array;
  /** Schutz des Schlüssels in der Datei */
  protection: { iterations: number; kdfHash: string; cipher: string; mac: string };
}

// BigInt-Hilfen für die RSA-Rekonstruktion
const toBig = (b: Uint8Array) => (b.length ? BigInt("0x" + hex(b)) : 0n);
function fromBig(v: bigint): Uint8Array {
  let h = v.toString(16);
  if (h.length % 2) h = "0" + h;
  return Uint8Array.from(h.match(/../g) ?? ["00"], (x) => parseInt(x, 16));
}
function modInverse(a: bigint, m: bigint): bigint {
  let [r0, r1, s0, s1] = [((a % m) + m) % m, m, 1n, 0n];
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  if (r0 !== 1n) throw new Error("RSA-Schlüssel ist ungültig (kein Inverses)");
  return ((s0 % m) + m) % m;
}
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));

function hex(b: Uint8Array) {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * sucht rekursiv eine RSA-SubjectPublicKeyInfo ({ SEQUENCE { OID rsaEncryption, … }, BIT STRING }) –
 * in PKCS#15 auch implizit getaggt – und liefert sie als normale SEQUENCE (DER)
 */
function findRsaSpki(node: Asn1Node): Uint8Array | undefined {
  const [alg, bits] = node.children;
  if (
    node.constructed &&
    node.children.length === 2 &&
    isUniversal(alg, Tag.Sequence) &&
    isUniversal(bits, Tag.BitString)
  ) {
    try {
      if (readOid(child(alg, 0)) === OID.rsaEncryption) return seq(raw(alg), raw(bits));
    } catch {
      /* weiter suchen */
    }
  }
  for (const c of node.children) {
    const hit = findRsaSpki(c);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Liest eine .p15-Datei (mit oder ohne APC-Header): prüft Header-Prüfsummen und MAC,
 * entschlüsselt den Schlüssel und baut daraus einen vollständigen RSA-Schlüssel (PKCS#1).
 */
export async function readApcP15(file: Uint8Array): Promise<ApcP15Content> {
  let body = file;
  let header = false;
  let tool: string | undefined;
  if (file.length > APC_HEADER_LENGTH && pkcs15At(file, APC_HEADER_LENGTH)) {
    const head = file.subarray(0, APC_HEADER_LENGTH);
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    body = file.subarray(APC_HEADER_LENGTH);
    if (view.getUint32(216, true) !== body.length)
      throw new Error(
        "Längenangabe im APC-Header stimmt nicht – Datei unvollständig oder beschädigt.",
      );
    if (view.getUint32(220, true) !== signExtend16(crc16Xmodem(body)))
      throw new Error("Prüfsumme der Daten im APC-Header stimmt nicht – Datei beschädigt.");
    if (view.getUint32(224, true) !== signExtend16(crc16Xmodem(head.subarray(0, 224))))
      throw new Error("Prüfsumme des APC-Headers stimmt nicht – Datei beschädigt.");
    header = true;
    const end = head.indexOf(0, 8);
    tool =
      new TextDecoder().decode(head.subarray(8, end < 0 || end > 208 ? 208 : end)) || undefined;
  } else if (!pkcs15At(file, 0)) {
    throw new Error("Keine .p15-Datei (PKCS#15) erkannt.");
  }

  const top = parseDerStrict(body);
  if (readOid(child(top, 0)) !== OID.pkcs15Content) throw new Error("Keine PKCS#15-Datei");
  const objects = child(child(child(top, 1), 0), 1);
  const find = (tag: number) => objects.children.find((n) => isContext(n, tag));
  const privNode = find(0);
  if (!privNode) throw new Error("Die .p15-Datei enthält keinen privaten Schlüssel.");
  const priv = child(child(privNode, 0), 0);
  if (!isUniversal(priv, Tag.Sequence))
    throw new Error("Nur RSA-Schlüssel werden unterstützt (ECDSA-Dateien der NMC3 noch nicht).");
  const label = new TextDecoder().decode(content(child(child(priv, 0), 0)));
  const value = priv.children.find((n) => isContext(n, 1));
  if (!value) throw new Error("Privater Schlüssel in der .p15-Datei nicht gefunden.");
  const wrapper = child(child(value, 0), 0);
  if (!isContext(wrapper, 4))
    throw new Error("Unbekannte Schutzart des Schlüssels in der .p15-Datei.");

  // Zertifikat ([4]) und öffentlicher Schlüssel ([1] bei reinen Schlüsseldateien)
  let certificate: Uint8Array | undefined;
  const certNode = find(4);
  if (certNode) {
    const certObj = child(child(certNode, 0), 0);
    const certValue = certObj.children.find((n) => isContext(n, 1));
    if (certValue) certificate = raw(child(child(child(certValue, 0), 0), 0)).slice();
  }
  let spki: Uint8Array | undefined;
  if (certificate) {
    const tbs = child(parseDerStrict(certificate), 0);
    spki = raw(child(tbs, isContext(tbs.children[0], 0) ? 6 : 5)).slice();
  } else {
    const pub = find(1);
    if (pub) spki = findRsaSpki(pub);
  }

  const { plain, protection } = await openEnvelope(wrapper.children);
  const parts = new Map<number, Uint8Array>();
  for (const n of parseDerStrict(plain).children)
    if (n.cls === 2) parts.set(n.tag, unsigned(content(n)).slice());

  // fehlendes n/e aus dem öffentlichen Schlüssel ergänzen, d berechnen
  let nBytes = parts.get(0);
  let eBytes = parts.get(1);
  if ((!nBytes || !eBytes) && spki) {
    const rsa = parseDerStrict(readBitString(child(parseDerStrict(spki), 1)));
    nBytes ??= unsigned(content(child(rsa, 0))).slice();
    eBytes ??= unsigned(content(child(rsa, 1))).slice();
  }
  const pb = parts.get(3);
  const qb = parts.get(4);
  if (!pb || !qb)
    throw new Error(
      "Unerwarteter Aufbau des privaten Schlüssels (p/q fehlen) – möglicherweise kein RSA-Schlüssel.",
    );
  if (!eBytes)
    throw new Error(
      "Öffentlicher Exponent fehlt – die Datei enthält weder Zertifikat noch öffentlichen Schlüssel.",
    );
  const p = toBig(pb);
  const q = toBig(qb);
  const e = toBig(eBytes);
  const n = p * q;
  if (nBytes && toBig(nBytes) !== n)
    throw new Error("Privater Schlüssel und Zertifikat in der .p15-Datei passen nicht zusammen.");
  const lambda = ((p - 1n) * (q - 1n)) / gcd(p - 1n, q - 1n);
  // d mod λ(n) – kann sich vom ursprünglichen d (manchmal mod φ(n)) unterscheiden, ist aber gleichwertig
  const d = parts.get(2) ? toBig(parts.get(2)!) : modInverse(e, lambda);
  const dp = parts.get(5) ? toBig(parts.get(5)!) : d % (p - 1n);
  const dq = parts.get(6) ? toBig(parts.get(6)!) : d % (q - 1n);
  const qinv = parts.get(7) ? toBig(parts.get(7)!) : modInverse(q, p);
  if ((e * dp) % (p - 1n) !== 1n || (e * dq) % (q - 1n) !== 1n || (q * qinv) % p !== 1n) {
    throw new Error("Die Bestandteile des RSA-Schlüssels sind widersprüchlich.");
  }
  const rsaPkcs1 = seq(
    ...[0n, n, e, d, p, q, dp, dq, qinv].map((v, i) =>
      i === 0 ? integer(0) : integer(fromBig(v)),
    ),
  );
  return { header, tool, label, certificate, spki, rsaPkcs1, protection };
}

const CIPHERS: Record<string, string> = { [OID.desEde3Cbc]: "3DES-CBC" };
const PRFS: Record<string, { hash: "SHA-1" | "SHA-256"; name: string }> = {
  [OID.hmacSha256]: { hash: "SHA-256", name: "HMAC-SHA256" },
  "1.2.840.113549.2.7": { hash: "SHA-1", name: "HMAC-SHA1" },
};

async function openEnvelope(
  env: Asn1Node[],
): Promise<{ plain: Uint8Array; protection: ApcP15Content["protection"] }> {
  const [, recipients, encInfo, macNode] = env as [Asn1Node, Asn1Node, Asn1Node, Asn1Node];
  if (!recipients || !encInfo || !macNode)
    throw new Error("Unerwarteter Aufbau der Schlüssel-Verschlüsselung");
  const pwri = child(recipients, 0);
  if (!isContext(pwri, 3))
    throw new Error("Der Schlüssel ist nicht mit einem Kennwort geschützt – unbekanntes Format.");
  const kdf = child(pwri, 1);
  if (readOid(child(kdf, 0)) !== OID.pbkdf2)
    throw new Error("Unbekannte Schlüsselableitung in der .p15-Datei");
  const kdfParams = child(kdf, 1);
  const kekSalt = content(child(kdfParams, 0));
  const iterations = Number(toBig(content(child(kdfParams, 1))));
  if (!(iterations >= 1 && iterations <= 10_000_000))
    throw new Error("Unplausible Iterationszahl in der .p15-Datei");
  const prfNode = kdfParams.children.find((c) => isUniversal(c, 0x10));
  const prf = prfNode ? PRFS[readOid(child(prfNode, 0))] : PRFS["1.2.840.113549.2.7"];
  if (!prf) throw new Error("Unbekanntes Hashverfahren der Schlüsselableitung");
  const kekAlg = child(child(pwri, 2), 1);
  if (readOid(child(kekAlg, 0)) !== OID.desEde3Cbc)
    throw new Error("Nur 3DES-geschützte .p15-Dateien werden unterstützt.");
  const kek = await pbkdf2(utf8(KEK_PASSWORD), kekSalt, iterations, prf.hash, 24);
  const kekCipher = tripleDesCipher(kek);
  const wrapIv = content(child(kekAlg, 1));
  const encryptedCek = content(child(pwri, 3));

  // RFC 3211: zuerst mit dem vorletzten Block als IV den letzten Block entschlüsseln …
  const n = kekCipher.blockSize;
  const len = encryptedCek.length;
  if (len < 2 * n || len % n)
    throw new Error("Ungültiger verschlüsselter Schlüssel in der .p15-Datei");
  const lastBlockIv = encryptedCek.subarray(len - 2 * n, len - n);
  const last = cbcRaw(kekCipher, lastBlockIv, encryptedCek.subarray(len - n), true);
  const firstPass = concat([
    cbcRaw(kekCipher, last, encryptedCek.subarray(0, len - n), true),
    last,
  ]);
  const wrapped = cbcRaw(kekCipher, wrapIv, firstPass, true);
  const cekLen = wrapped[0]!;
  const cek = wrapped.subarray(4, 4 + cekLen);
  if (
    cekLen < 8 ||
    4 + cekLen > wrapped.length ||
    ![0, 1, 2].every((i) => (wrapped[1 + i]! ^ cek[i]!) === 0xff)
  ) {
    throw new Error(
      "Schlüssel der .p15-Datei ließ sich nicht entschlüsseln (anderes Kennwort als bei APC üblich?)",
    );
  }

  const encAlg = child(encInfo, 1);
  if (readOid(child(encAlg, 0)) !== OID.authEnc128)
    throw new Error("Unbekanntes Verschlüsselungsverfahren in der .p15-Datei");
  const cipherAlg = child(child(encAlg, 1), 0);
  const cipherName = CIPHERS[readOid(child(cipherAlg, 0))];
  if (!cipherName) throw new Error("Nur 3DES-geschützte .p15-Dateien werden unterstützt.");
  const macAlgOid = readOid(child(child(child(encAlg, 1), 1), 0));
  if (macAlgOid !== OID.hmacSha256) throw new Error("Unbekanntes MAC-Verfahren in der .p15-Datei");
  const contentIv = content(child(cipherAlg, 1));
  const encrypted = content(child(encInfo, 2));
  const macKey = await pbkdf2(cek, utf8("authentication"), 1, "SHA-1", 32);
  const mac = await hmacSha256(macKey, concat([raw(encAlg), encrypted]));
  if (!sameBytes(mac, content(macNode)))
    throw new Error(
      "Prüfwert (MAC) der .p15-Datei stimmt nicht – Datei beschädigt oder verändert.",
    );
  const encKey = await pbkdf2(cek, utf8("encryption"), 1, "SHA-1", 24);
  const plain = cbcDecrypt(tripleDesCipher(encKey), contentIv, encrypted);
  return {
    plain,
    protection: { iterations, kdfHash: prf.name, cipher: cipherName, mac: "HMAC-SHA256" },
  };
}
