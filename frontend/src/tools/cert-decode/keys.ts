/**
 * Private Schlüssel: PKCS#8 (auch verschlüsselt), PKCS#1 (RSA) und SEC1 (EC) lesen und umwandeln.
 * Zu jedem Schlüssel wird der öffentliche Schlüssel abgeleitet, um ihn einem Zertifikat zuzuordnen.
 */
import { child, content, isContext, isUniversal, parseDerStrict, raw, readBitString, readOid, readSmallInt, Tag, toHex, type Asn1Node } from "./asn1";
import { bitString, explicit, fromBase64, integer, nul, octets, oid, pem, seq, toBase64 } from "./der";
import { describePbe, encryptedParts, OID as PBE_OID, pbeDecrypt, pbeEncrypt } from "./pbe";
import { curveOids, describePublicKey, type PublicKeyInfo } from "./x509";

const KEY_OID = {
  rsa: "1.2.840.113549.1.1.1",
  rsaPss: "1.2.840.113549.1.1.10",
  ec: "1.2.840.10045.2.1",
  x25519: "1.3.101.110",
  x448: "1.3.101.111",
  ed25519: "1.3.101.112",
  ed448: "1.3.101.113",
} as const;

const webCryptoCurves: Record<string, string> = {
  "1.2.840.10045.3.1.7": "P-256",
  "1.3.132.0.34": "P-384",
  "1.3.132.0.35": "P-521",
};

export interface PrivateKey {
  /** unverschlüsseltes PKCS#8 (PrivateKeyInfo) */
  pkcs8: Uint8Array;
  /** abgeleiteter öffentlicher Schlüssel (SubjectPublicKeyInfo); fehlt, wenn er sich nicht berechnen ließ */
  spki?: Uint8Array;
  publicKey: PublicKeyInfo;
  /** klassisches Format: PKCS#1 bei RSA, SEC1 bei EC */
  traditional?: { label: "RSA PRIVATE KEY" | "EC PRIVATE KEY"; der: Uint8Array };
}

const b64url = (s: string) => fromBase64(s.replace(/-/g, "+").replace(/_/g, "/"));

async function publicFromWebCrypto(pkcs8: Uint8Array, alg: EcKeyImportParams | Algorithm): Promise<Uint8Array | undefined> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return undefined;
    const key = await subtle.importKey("pkcs8", pkcs8 as BufferSource, alg, true, ["sign"]);
    const jwk = await subtle.exportKey("jwk", key);
    if (!jwk.x) return undefined;
    if (jwk.y) return Uint8Array.from([4, ...b64url(jwk.x), ...b64url(jwk.y)]);
    return b64url(jwk.x);
  } catch {
    return undefined;
  }
}

/** optionaler öffentlicher Schlüssel [1] in OneAsymmetricKey (PKCS#8 v2) */
function embeddedPublicKey(top: Asn1Node): Uint8Array | undefined {
  const node = top.children.find((n) => isContext(n, 1));
  return node ? content(node).subarray(1) : undefined;
}

/** liest PKCS#8 (PrivateKeyInfo) */
export async function parsePkcs8(der: Uint8Array): Promise<PrivateKey> {
  const top = parseDerStrict(der);
  const algId = child(top, 1);
  const alg = readOid(child(algId, 0));
  const inner = content(child(top, 2));

  switch (alg) {
    case KEY_OID.rsa:
    case KEY_OID.rsaPss: {
      const rsa = parseDerStrict(inner);
      const n = content(child(rsa, 1));
      const e = content(child(rsa, 2));
      const spki = seq(alg === KEY_OID.rsa ? seq(oid(KEY_OID.rsa), nul()) : raw(algId), bitString(seq(integer(n), integer(e))));
      return {
        pkcs8: der,
        spki,
        publicKey: describePublicKey(spki),
        traditional: alg === KEY_OID.rsa ? { label: "RSA PRIVATE KEY", der: inner.slice() } : undefined,
      };
    }
    case KEY_OID.ec: {
      const param = algId.children[1];
      if (!isUniversal(param, Tag.Oid)) throw new Error("EC-Schlüssel mit expliziten Kurvenparametern werden nicht unterstützt");
      const curve = readOid(param);
      const ec = parseDerStrict(inner);
      const privateScalar = content(child(ec, 1));
      const pubNode = ec.children.find((n) => isContext(n, 1));
      let point = pubNode ? readBitString(child(pubNode, 0)) : undefined;
      if (!point && webCryptoCurves[curve]) point = await publicFromWebCrypto(der, { name: "ECDSA", namedCurve: webCryptoCurves[curve]! });
      const spki = point ? seq(seq(oid(KEY_OID.ec), oid(curve)), bitString(point)) : undefined;
      const sec1 = seq(
        integer(1),
        octets(privateScalar),
        explicit(0, oid(curve)),
        ...(point ? [explicit(1, bitString(point))] : []),
      );
      return {
        pkcs8: der,
        spki,
        publicKey: spki ? describePublicKey(spki) : { algorithm: "ECDSA", curve: curveOids[curve]?.name ?? curve },
        traditional: { label: "EC PRIVATE KEY", der: sec1 },
      };
    }
    case KEY_OID.ed25519:
    case KEY_OID.ed448:
    case KEY_OID.x25519:
    case KEY_OID.x448: {
      const names = { [KEY_OID.ed25519]: "Ed25519", [KEY_OID.ed448]: "Ed448", [KEY_OID.x25519]: "X25519", [KEY_OID.x448]: "X448" };
      let pub = embeddedPublicKey(top);
      if (!pub && alg === KEY_OID.ed25519) pub = await publicFromWebCrypto(der, { name: "Ed25519" });
      const spki = pub ? seq(seq(oid(alg)), bitString(pub)) : undefined;
      return { pkcs8: der, spki, publicKey: spki ? describePublicKey(spki) : { algorithm: names[alg] } };
    }
    default:
      throw new Error(`Schlüsseltyp ${alg} wird nicht unterstützt`);
  }
}

/** PKCS#1 RSAPrivateKey → PKCS#8 */
export function pkcs1ToPkcs8(der: Uint8Array): Uint8Array {
  parseDerStrict(der);
  return seq(integer(0), seq(oid(KEY_OID.rsa), nul()), octets(der));
}

/** SEC1 ECPrivateKey → PKCS#8 (Kurve wandert in den AlgorithmIdentifier) */
export function sec1ToPkcs8(der: Uint8Array): Uint8Array {
  const ec = parseDerStrict(der);
  const params = ec.children.find((n) => isContext(n, 0));
  const curveNode = params?.children[0];
  if (!isUniversal(curveNode, Tag.Oid)) throw new Error("EC-Schlüssel ohne benannte Kurve werden nicht unterstützt");
  const pub = ec.children.find((n) => isContext(n, 1));
  const inner = seq(integer(1), raw(child(ec, 1)), ...(pub ? [raw(pub)] : []));
  return seq(integer(0), seq(oid(KEY_OID.ec), raw(curveNode)), octets(inner));
}

export type KeyDerKind = "pkcs8" | "pkcs8-encrypted" | "pkcs1" | "sec1";

const pbeOids = new Set<string>([PBE_OID.pbes2, PBE_OID.pbeSha1And3Des, PBE_OID.pbeSha1And2Des, PBE_OID.pbeSha1AndRc2_128, PBE_OID.pbeSha1AndRc2_40, PBE_OID.pbeSha1AndRc4_128, PBE_OID.pbeSha1AndRc4_40]);

/** erkennt, ob ein DER-Element ein privater Schlüssel ist */
export function detectKeyDer(top: Asn1Node): KeyDerKind | null {
  const [a, b, c] = top.children;
  if (!isUniversal(top, Tag.Sequence) || !a) return null;
  if (isUniversal(a, Tag.Integer) && isUniversal(b, Tag.Sequence) && isUniversal(b.children[0], Tag.Oid) && isUniversal(c, Tag.OctetString)) {
    return "pkcs8";
  }
  if (top.children.length === 2 && isUniversal(a, Tag.Sequence) && isUniversal(a.children[0], Tag.Oid) && isUniversal(b, Tag.OctetString)) {
    return pbeOids.has(readOid(a.children[0])) ? "pkcs8-encrypted" : null;
  }
  if (top.children.length >= 9 && top.children.every((n) => isUniversal(n, Tag.Integer)) && readSmallInt(a) === 0) return "pkcs1";
  if (isUniversal(a, Tag.Integer) && readSmallInt(a) === 1 && isUniversal(b, Tag.OctetString)) return "sec1";
  return null;
}

export class PasswordError extends Error {
  /** true = Kennwort fehlt, false = Kennwort falsch */
  readonly missing: boolean;
  constructor(message: string, missing: boolean) {
    super(message);
    this.missing = missing;
    this.name = "PasswordError";
  }
}

/** EncryptedPrivateKeyInfo entschlüsseln; liefert PKCS#8 und das verwendete Verfahren */
export async function decryptPkcs8(der: Uint8Array, password: string): Promise<{ pkcs8: Uint8Array; method: string }> {
  const node = parseDerStrict(der);
  const { algId, data } = encryptedParts(node);
  const info = describePbe(algId);
  const method = `${info.label}, ${info.iterations.toLocaleString("de-DE")} Iterationen`;
  if (!password) throw new PasswordError("Der private Schlüssel ist verschlüsselt – bitte Kennwort eingeben.", true);
  let plain: Uint8Array;
  try {
    plain = await pbeDecrypt(algId, data, password);
    if (detectKeyDer(parseDerStrict(plain)) !== "pkcs8") throw new Error();
  } catch (e) {
    if (e instanceof Error && /unterstützt|Unbekannt|HTTPS/.test(e.message)) throw e;
    throw new PasswordError("Kennwort für den privaten Schlüssel ist falsch.", false);
  }
  return { pkcs8: plain, method };
}

/** Schlüssel aus DER beliebigen Formats → PKCS#8 */
export async function keyFromDer(der: Uint8Array, kind: KeyDerKind, password: string): Promise<{ key: PrivateKey; method?: string }> {
  switch (kind) {
    case "pkcs8":
      return { key: await parsePkcs8(der) };
    case "pkcs1":
      return { key: await parsePkcs8(pkcs1ToPkcs8(der)) };
    case "sec1":
      return { key: await parsePkcs8(sec1ToPkcs8(der)) };
    case "pkcs8-encrypted": {
      const { pkcs8, method } = await decryptPkcs8(der, password);
      return { key: await parsePkcs8(pkcs8), method };
    }
  }
}

/** Schlüssel-ID zum Abgleich: Inhalt des BIT STRING im SubjectPublicKeyInfo */
export function publicKeyId(spki: Uint8Array): string {
  return toHex(readBitString(child(parseDerStrict(spki), 1)));
}

// ---------- Export ----------

export const keyToPkcs8Pem = (key: PrivateKey) => pem("PRIVATE KEY", key.pkcs8);

export function keyToTraditionalPem(key: PrivateKey): string | null {
  return key.traditional ? pem(key.traditional.label, key.traditional.der) : null;
}

/** verschlüsseltes PKCS#8 (PBES2 / PBKDF2-HMAC-SHA256 / AES-256-CBC) */
export async function keyToEncryptedPem(key: PrivateKey, password: string): Promise<string> {
  if (!password) throw new Error("Für einen verschlüsselten Schlüssel wird ein Kennwort benötigt.");
  const { algId, data } = await pbeEncrypt("aes", password, key.pkcs8);
  return pem("ENCRYPTED PRIVATE KEY", seq(algId, octets(data)));
}

export { toBase64 };
