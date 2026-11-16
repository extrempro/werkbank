/**
 * Kennwortbasierte Verschlüsselung für PFX (PKCS#12) und verschlüsselte Schlüssel (PKCS#8):
 * - PKCS#12-Verfahren (SHA-1 + 3DES / RC2) – ältere Windows- und OpenSSL-Dateien
 * - PBES2 (PBKDF2 + AES-CBC) – moderne Dateien (OpenSSL 3, Windows ab 10/1709 „AES256-SHA256“)
 * AES, PBKDF2, HMAC und SHA kommen aus Web Crypto, 3DES/RC2 aus eigenen Modulen.
 */
import {
  child,
  content,
  isUniversal,
  octetString,
  readOid,
  readSmallInt,
  Tag,
  type Asn1Node,
} from "./asn1";
import { cbcDecrypt, cbcEncrypt, tripleDesCipher } from "./des";
import { concat, integer, octets, oid, seq } from "./der";
import { rc2 } from "./rc2";

export type HashName = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

const hashInfo: Record<HashName, { u: number; v: number }> = {
  "SHA-1": { u: 20, v: 64 },
  "SHA-256": { u: 32, v: 64 },
  "SHA-384": { u: 48, v: 128 },
  "SHA-512": { u: 64, v: 128 },
};

export const OID = {
  pbeSha1And3Des: "1.2.840.113549.1.12.1.3",
  pbeSha1And2Des: "1.2.840.113549.1.12.1.4",
  pbeSha1AndRc2_128: "1.2.840.113549.1.12.1.5",
  pbeSha1AndRc2_40: "1.2.840.113549.1.12.1.6",
  pbeSha1AndRc4_128: "1.2.840.113549.1.12.1.1",
  pbeSha1AndRc4_40: "1.2.840.113549.1.12.1.2",
  pbes2: "1.2.840.113549.1.5.13",
  pbkdf2: "1.2.840.113549.1.5.12",
  hmacSha1: "1.2.840.113549.2.7",
  hmacSha256: "1.2.840.113549.2.9",
  hmacSha384: "1.2.840.113549.2.10",
  hmacSha512: "1.2.840.113549.2.11",
  aes128Cbc: "2.16.840.1.101.3.4.1.2",
  aes192Cbc: "2.16.840.1.101.3.4.1.22",
  aes256Cbc: "2.16.840.1.101.3.4.1.42",
  desEde3Cbc: "1.2.840.113549.3.7",
  sha1: "1.3.14.3.2.26",
  sha256: "2.16.840.1.101.3.4.2.1",
  sha384: "2.16.840.1.101.3.4.2.2",
  sha512: "2.16.840.1.101.3.4.2.3",
} as const;

export const digestOidToHash: Record<string, HashName> = {
  [OID.sha1]: "SHA-1",
  [OID.sha256]: "SHA-256",
  [OID.sha384]: "SHA-384",
  [OID.sha512]: "SHA-512",
};

const hmacOidToHash: Record<string, HashName> = {
  [OID.hmacSha1]: "SHA-1",
  [OID.hmacSha256]: "SHA-256",
  [OID.hmacSha384]: "SHA-384",
  [OID.hmacSha512]: "SHA-512",
};

/** lesbare Bezeichnung für die Anzeige */
export const algorithmLabels: Record<string, string> = {
  [OID.pbeSha1And3Des]: "3DES (SHA-1)",
  [OID.pbeSha1And2Des]: "2-Key-3DES (SHA-1)",
  [OID.pbeSha1AndRc2_128]: "RC2-128 (SHA-1)",
  [OID.pbeSha1AndRc2_40]: "RC2-40 (SHA-1, veraltet)",
  [OID.pbeSha1AndRc4_128]: "RC4-128 (veraltet)",
  [OID.pbeSha1AndRc4_40]: "RC4-40 (veraltet)",
  [OID.pbes2]: "PBES2",
};

const subtle = () => {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "Für Kennwort-Verschlüsselung muss die Toolbox über HTTPS (oder localhost) aufgerufen werden.",
    );
  return globalThis.crypto.subtle;
};

const buf = (b: Uint8Array) => b as BufferSource;

// ---------- Kennwörter ----------

/** PKCS#12 erwartet das Kennwort als BMPString (UTF-16BE) mit abschließender 0 */
export function bmpPassword(password: string): Uint8Array {
  const out = new Uint8Array((password.length + 1) * 2);
  for (let i = 0; i < password.length; i++) {
    out[i * 2] = password.charCodeAt(i) >> 8;
    out[i * 2 + 1] = password.charCodeAt(i) & 0xff;
  }
  return out;
}

const utf8 = (s: string) => new TextEncoder().encode(s);

// ---------- PKCS#12-Schlüsselableitung (RFC 7292, Anhang B) ----------

export type KdfPurpose = 1 | 2 | 3; // 1 = Schlüssel, 2 = IV, 3 = MAC-Schlüssel

export async function pkcs12Kdf(
  hash: HashName,
  passwordBytes: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  id: KdfPurpose,
  length: number,
): Promise<Uint8Array> {
  const { u, v } = hashInfo[hash];
  const D = new Uint8Array(v).fill(id);
  const fill = (src: Uint8Array) => {
    if (src.length === 0) return new Uint8Array(0);
    const out = new Uint8Array(v * Math.ceil(src.length / v));
    for (let i = 0; i < out.length; i++) out[i] = src[i % src.length]!;
    return out;
  };
  const I = concat([fill(salt), fill(passwordBytes)]);
  const result = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += u) {
    let A = new Uint8Array(await subtle().digest(hash, buf(concat([D, I]))));
    for (let r = 1; r < iterations; r++) A = new Uint8Array(await subtle().digest(hash, buf(A)));
    result.set(A.subarray(0, Math.min(u, length - offset)), offset);
    if (offset + u >= length) break;
    // I_j = (I_j + B + 1) mod 2^(8v)
    const B = new Uint8Array(v);
    for (let i = 0; i < v; i++) B[i] = A[i % u]!;
    for (let j = 0; j < I.length; j += v) {
      let carry = 1;
      for (let k = v - 1; k >= 0; k--) {
        const sum = I[j + k]! + B[k]! + carry;
        I[j + k] = sum & 0xff;
        carry = sum >> 8;
      }
    }
  }
  return result;
}

export async function hmac(hash: HashName, key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle().importKey("raw", buf(key), { name: "HMAC", hash }, false, ["sign"]);
  return new Uint8Array(await subtle().sign("HMAC", k, buf(data)));
}

export const hashLength = (h: HashName) => hashInfo[h].u;

// ---------- AES / PBKDF2 ----------

async function pbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
  hash: HashName,
  length: number,
): Promise<Uint8Array> {
  const key = await subtle().importKey("raw", buf(utf8(password)), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(
    await subtle().deriveBits(
      { name: "PBKDF2", salt: buf(salt), iterations, hash },
      key,
      length * 8,
    ),
  );
}

async function aesCbc(
  mode: "encrypt" | "decrypt",
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const k = await subtle().importKey("raw", buf(key), "AES-CBC", false, [mode]);
  try {
    const result =
      mode === "encrypt"
        ? await subtle().encrypt({ name: "AES-CBC", iv: buf(iv) }, k, buf(data))
        : await subtle().decrypt({ name: "AES-CBC", iv: buf(iv) }, k, buf(data));
    return new Uint8Array(result);
  } catch {
    throw new Error("Entschlüsselung fehlgeschlagen – falsches Kennwort?");
  }
}

// ---------- Entschlüsseln ----------

export interface PbeInfo {
  label: string;
  iterations: number;
}

function pkcs12Params(algId: Asn1Node) {
  const params = child(algId, 1);
  return { salt: content(child(params, 0)), iterations: readSmallInt(child(params, 1)) };
}

/** Beschreibung des Verfahrens (für die Anzeige) */
export function describePbe(algId: Asn1Node): PbeInfo {
  const o = readOid(child(algId, 0));
  if (o === OID.pbes2) {
    const params = child(algId, 1);
    const kdf = child(params, 0);
    const enc = readOid(child(child(params, 1), 0));
    const kdfParams = child(kdf, 1);
    const prfNode = kdfParams.children.find((n) => isUniversal(n, Tag.Sequence));
    const prf = prfNode ? (hmacOidToHash[readOid(child(prfNode, 0))] ?? "?") : "SHA-1";
    const cipher =
      {
        [OID.aes128Cbc]: "AES-128",
        [OID.aes192Cbc]: "AES-192",
        [OID.aes256Cbc]: "AES-256",
        [OID.desEde3Cbc]: "3DES",
      }[enc] ?? enc;
    return { label: `${cipher} (PBKDF2-${prf})`, iterations: readSmallInt(child(kdfParams, 1)) };
  }
  return { label: algorithmLabels[o] ?? o, iterations: pkcs12Params(algId).iterations };
}

/**
 * Entschlüsselt mit dem in `algId` (AlgorithmIdentifier) angegebenen Verfahren.
 * `emptyAsNull`: leeres Kennwort ohne abschließende 0 (manche Programme machen das so).
 */
export async function pbeDecrypt(
  algId: Asn1Node,
  data: Uint8Array,
  password: string,
  emptyAsNull = false,
): Promise<Uint8Array> {
  const o = readOid(child(algId, 0));

  if (o === OID.pbes2) {
    const params = child(algId, 1);
    const kdf = child(params, 0);
    if (readOid(child(kdf, 0)) !== OID.pbkdf2)
      throw new Error("Unbekannte Schlüsselableitung in PBES2");
    const kdfParams = child(kdf, 1);
    const salt = content(child(kdfParams, 0));
    const iterations = readSmallInt(child(kdfParams, 1));
    const prfNode = kdfParams.children.find((n) => isUniversal(n, Tag.Sequence));
    const hash = prfNode ? hmacOidToHash[readOid(child(prfNode, 0))] : "SHA-1";
    if (!hash) throw new Error("Unbekannte PRF in PBKDF2");
    const encAlg = child(params, 1);
    const encOid = readOid(child(encAlg, 0));
    const iv = content(child(encAlg, 1));
    if (encOid === OID.aes128Cbc || encOid === OID.aes256Cbc) {
      const key = await pbkdf2(
        password,
        salt,
        iterations,
        hash,
        encOid === OID.aes128Cbc ? 16 : 32,
      );
      return aesCbc("decrypt", key, iv, data);
    }
    if (encOid === OID.aes192Cbc) throw new Error("AES-192 wird von Browsern nicht unterstützt");
    if (encOid === OID.desEde3Cbc) {
      const key = await pbkdf2(password, salt, iterations, hash, 24);
      return cbcDecrypt(tripleDesCipher(key), iv, data);
    }
    throw new Error(`Unbekannte Verschlüsselung in PBES2 (${encOid})`);
  }

  const { salt, iterations } = pkcs12Params(algId);
  const pw = emptyAsNull && password === "" ? new Uint8Array(0) : bmpPassword(password);
  switch (o) {
    case OID.pbeSha1And3Des:
    case OID.pbeSha1And2Des: {
      const keyLen = o === OID.pbeSha1And3Des ? 24 : 16;
      const key = await pkcs12Kdf("SHA-1", pw, salt, iterations, 1, keyLen);
      const iv = await pkcs12Kdf("SHA-1", pw, salt, iterations, 2, 8);
      return cbcDecrypt(tripleDesCipher(key), iv, data);
    }
    case OID.pbeSha1AndRc2_128:
    case OID.pbeSha1AndRc2_40: {
      const keyLen = o === OID.pbeSha1AndRc2_128 ? 16 : 5;
      const key = await pkcs12Kdf("SHA-1", pw, salt, iterations, 1, keyLen);
      const iv = await pkcs12Kdf("SHA-1", pw, salt, iterations, 2, 8);
      return cbcDecrypt(rc2(key, keyLen * 8), iv, data);
    }
    case OID.pbeSha1AndRc4_128:
    case OID.pbeSha1AndRc4_40:
      throw new Error(
        "RC4-verschlüsselte PFX-Dateien werden nicht unterstützt (sehr alt und unsicher).",
      );
    default:
      throw new Error(`Unbekanntes Verschlüsselungsverfahren (${o})`);
  }
}

/** EncryptedPrivateKeyInfo / EncryptedContentInfo: Algorithmus + verschlüsselte Daten */
export function encryptedParts(node: Asn1Node): { algId: Asn1Node; data: Uint8Array } {
  return { algId: child(node, 0), data: octetString(child(node, 1)) };
}

// ---------- Verschlüsseln ----------

export type EncryptionMode = "aes" | "3des";

const random = (n: number) => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
};

/**
 * Verschlüsselt und liefert AlgorithmIdentifier (DER) + Chiffrat.
 * aes  = PBES2/PBKDF2-HMAC-SHA256/AES-256-CBC (Standard von OpenSSL 3)
 * 3des = PKCS#12 pbeWithSHAAnd3-KeyTripleDES-CBC (Windows-Standard, kompatibel mit älteren Systemen)
 */
export async function pbeEncrypt(
  mode: EncryptionMode,
  password: string,
  data: Uint8Array,
  iterations = mode === "aes" ? 10000 : 2048,
): Promise<{ algId: Uint8Array; data: Uint8Array }> {
  const salt = random(mode === "aes" ? 16 : 8);
  if (mode === "aes") {
    const iv = random(16);
    const key = await pbkdf2(password, salt, iterations, "SHA-256", 32);
    const enc = await aesCbc("encrypt", key, iv, data);
    const algId = seq(
      oid(OID.pbes2),
      seq(
        seq(
          oid(OID.pbkdf2),
          seq(
            octets(salt),
            integer(iterations),
            seq(oid(OID.hmacSha256), new Uint8Array([0x05, 0x00])),
          ),
        ),
        seq(oid(OID.aes256Cbc), octets(iv)),
      ),
    );
    return { algId, data: enc };
  }
  const pw = bmpPassword(password);
  const key = await pkcs12Kdf("SHA-1", pw, salt, iterations, 1, 24);
  const iv = await pkcs12Kdf("SHA-1", pw, salt, iterations, 2, 8);
  const enc = cbcEncrypt(tripleDesCipher(key), iv, data);
  return { algId: seq(oid(OID.pbeSha1And3Des), seq(octets(salt), integer(iterations))), data: enc };
}

export { random };
