/** Prüfsummen und HMAC */
import { md5 } from "../lib/crypto/md5";
import { crc32 } from "../lib/crc32";

export type HashAlg = "MD5" | "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512" | "CRC32";
export const hashAlgs: HashAlg[] = ["SHA-256", "SHA-1", "MD5", "SHA-384", "SHA-512", "CRC32"];

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const toB64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};

export async function hash(alg: HashAlg, data: Uint8Array): Promise<Uint8Array> {
  if (alg === "MD5") return md5(data);
  if (alg === "CRC32") {
    const c = crc32(data);
    return Uint8Array.from([c >>> 24, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff]);
  }
  return new Uint8Array(await crypto.subtle.digest(alg, data as BufferSource));
}

/** erwarteten Wert (Hex in beliebiger Schreibweise oder Base64) mit Ergebnis vergleichen */
export function matches(expected: string, digest: Uint8Array): boolean {
  const e = expected.trim();
  if (!e) return false;
  const hex = e.replace(/[\s:-]/g, "").toLowerCase();
  if (/^[0-9a-f]+$/.test(hex)) return hex === toHex(digest);
  return e.replace(/\s/g, "") === toB64(digest);
}

/** welcher Algorithmus passt zur Länge eines Hex-Werts */
export function guessAlg(expected: string): HashAlg | undefined {
  const hex = expected.trim().replace(/[\s:-]/g, "");
  return ({ 8: "CRC32", 32: "MD5", 40: "SHA-1", 64: "SHA-256", 96: "SHA-384", 128: "SHA-512" } as Record<number, HashAlg>)[hex.length];
}

export type KeyEncoding = "text" | "hex" | "base64";

export function decodeKey(key: string, enc: KeyEncoding): Uint8Array {
  if (enc === "text") return new TextEncoder().encode(key);
  if (enc === "hex") {
    const h = key.replace(/\s/g, "");
    if (!/^([0-9a-fA-F]{2})*$/.test(h)) throw new Error("Schlüssel ist kein gültiges Hex");
    return Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
  }
  try {
    return Uint8Array.from(atob(key.replace(/\s/g, "")), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("Schlüssel ist kein gültiges Base64");
  }
}

export async function hmac(alg: "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512", key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // leerer Schlüssel: Web Crypto lehnt Länge 0 ab – ein Null-Byte ist gleichwertig, da HMAC ohnehin mit Nullen auffüllt
  const k = await crypto.subtle.importKey("raw", (key.length ? key : new Uint8Array(1)) as BufferSource, { name: "HMAC", hash: alg }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}
