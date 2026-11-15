/** JWT dekodieren und Signatur prüfen (Web Crypto) */

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown> | string;
  signature: string;
  parts: string[];
}

export function base64UrlDecode(part: string): Uint8Array {
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(padded);
  } catch {
    throw new Error("Kein gültiges Base64url");
  }
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const utf8 = (b: Uint8Array) => new TextDecoder().decode(b);

export function decodeJwt(token: string): DecodedJwt {
  const clean = token.trim().replace(/^Bearer\s+/i, "").replace(/\s+/g, "");
  const parts = clean.split(".");
  if (parts.length === 5) throw new Error("Das ist ein verschlüsseltes JWE (5 Teile) – ohne Schlüssel nicht lesbar.");
  if (parts.length !== 3) throw new Error(`Ein JWT hat 3 durch Punkte getrennte Teile – gefunden: ${parts.length}`);
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(utf8(base64UrlDecode(parts[0]!)));
  } catch {
    throw new Error("Header ist kein gültiges JSON");
  }
  let payload: Record<string, unknown> | string;
  const raw = utf8(base64UrlDecode(parts[1]!));
  try {
    payload = JSON.parse(raw);
  } catch {
    payload = raw;
  }
  return { header, payload, signature: parts[2]!, parts };
}

export const timeClaims = ["exp", "nbf", "iat", "auth_time", "updated_at"];

export const claimLabels: Record<string, string> = {
  iss: "Aussteller", sub: "Subjekt", aud: "Zielgruppe", exp: "Läuft ab", nbf: "Gültig ab", iat: "Ausgestellt", jti: "Token-ID",
  name: "Name", upn: "UPN", unique_name: "Anmeldename", preferred_username: "Benutzername", email: "E-Mail", oid: "Objekt-ID (Entra)",
  tid: "Mandanten-ID (Entra)", appid: "App-ID", azp: "Angefragt von", scp: "Berechtigungen (scope)", roles: "Rollen", groups: "Gruppen",
  amr: "Anmeldemethoden", ver: "Version", nonce: "Nonce", sid: "Sitzung", idp: "Identitätsanbieter", auth_time: "Angemeldet",
};

export function tokenStatus(payload: DecodedJwt["payload"], now = Date.now() / 1000): { state: "valid" | "expired" | "notyet" | "unknown"; text: string } {
  if (typeof payload !== "object") return { state: "unknown", text: "Payload ist kein JSON" };
  const exp = typeof payload.exp === "number" ? payload.exp : undefined;
  const nbf = typeof payload.nbf === "number" ? payload.nbf : undefined;
  if (nbf !== undefined && now < nbf) return { state: "notyet", text: "noch nicht gültig" };
  if (exp !== undefined && now >= exp) return { state: "expired", text: "abgelaufen" };
  if (exp !== undefined) return { state: "valid", text: "gültig (Zeitraum)" };
  return { state: "unknown", text: "ohne Ablaufdatum" };
}

// ---------- Signatur ----------

const hashOf = (alg: string) => ({ "256": "SHA-256", "384": "SHA-384", "512": "SHA-512" })[alg.slice(2)] ?? "SHA-256";

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** ECDSA-Signatur im JWT ist bereits r|s (IEEE P1363) – genau das erwartet Web Crypto */
export async function verifyJwt(jwt: DecodedJwt, key: string): Promise<boolean> {
  const alg = String(jwt.header.alg ?? "");
  const data = new TextEncoder().encode(`${jwt.parts[0]}.${jwt.parts[1]}`);
  const sig = base64UrlDecode(jwt.signature);
  const subtle = crypto.subtle;
  if (!subtle) throw new Error("Signaturprüfung braucht HTTPS (Web Crypto)");
  if (alg === "none") throw new Error("alg=none – das Token ist nicht signiert");
  let cryptoKey: CryptoKey;
  let algo: AlgorithmIdentifier | RsaPssParams | EcdsaParams;
  const k = key.trim();
  const jwk = k.startsWith("{") ? (JSON.parse(k) as JsonWebKey & { keys?: JsonWebKey[] }) : undefined;
  const pickJwk = () => {
    if (!jwk) return undefined;
    if (jwk.keys) return jwk.keys.find((x) => (x as { kid?: string }).kid === jwt.header.kid) ?? jwk.keys[0];
    return jwk;
  };
  if (alg.startsWith("HS")) {
    cryptoKey = await subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: hashOf(alg) }, false, ["verify"]);
    algo = "HMAC";
  } else if (alg.startsWith("RS") || alg.startsWith("PS")) {
    const params = { name: alg.startsWith("RS") ? "RSASSA-PKCS1-v1_5" : "RSA-PSS", hash: hashOf(alg) };
    const j = pickJwk();
    cryptoKey = j ? await subtle.importKey("jwk", j, params, false, ["verify"]) : await subtle.importKey("spki", pemToDer(k) as BufferSource, params, false, ["verify"]);
    algo = alg.startsWith("RS") ? "RSASSA-PKCS1-v1_5" : { name: "RSA-PSS", saltLength: Number(alg.slice(2)) / 8 };
  } else if (alg.startsWith("ES")) {
    const curve = { ES256: "P-256", ES384: "P-384", ES512: "P-521" }[alg];
    if (!curve) throw new Error(`Algorithmus ${alg} wird nicht unterstützt`);
    const params = { name: "ECDSA", namedCurve: curve };
    const j = pickJwk();
    cryptoKey = j ? await subtle.importKey("jwk", j, params, false, ["verify"]) : await subtle.importKey("spki", pemToDer(k) as BufferSource, params, false, ["verify"]);
    algo = { name: "ECDSA", hash: hashOf(alg) };
  } else if (alg === "EdDSA") {
    const j = pickJwk();
    cryptoKey = j ? await subtle.importKey("jwk", j, { name: "Ed25519" }, false, ["verify"]) : await subtle.importKey("spki", pemToDer(k) as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    algo = { name: "Ed25519" };
  } else throw new Error(`Algorithmus ${alg} wird nicht unterstützt`);
  return subtle.verify(algo, cryptoKey, sig as BufferSource, data as BufferSource);
}
