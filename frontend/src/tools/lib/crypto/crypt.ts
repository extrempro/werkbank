/** Passwort-Hashes im crypt-Format: $1$/$apr1$ (MD5), $5$/$6$ (SHA-crypt), {SHA} */
import { md5 } from "./md5";

const ITOA64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const enc = new TextEncoder();

function to64(v: number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) {
    s += ITOA64[v & 0x3f];
    v >>>= 6;
  }
  return s;
}

const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

export function randomSalt(len: number): string {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(b, (x) => ITOA64[x & 0x3f]).join("");
}

/** MD5-crypt: magic „$1$“ (Linux) oder „$apr1$“ (Apache htpasswd) */
export function md5Crypt(
  password: string,
  salt: string,
  magic: "$1$" | "$apr1$" = "$apr1$",
): string {
  const pw = enc.encode(password);
  const s = enc.encode(salt.slice(0, 8));
  let final = md5(cat(pw, s, pw));
  const parts: Uint8Array[] = [pw, enc.encode(magic), s];
  for (let pl = pw.length; pl > 0; pl -= 16) parts.push(final.subarray(0, Math.min(16, pl)));
  for (let i = pw.length; i; i >>= 1) parts.push(i & 1 ? new Uint8Array([0]) : pw.subarray(0, 1));
  final = md5(cat(...parts));
  for (let i = 0; i < 1000; i++) {
    final = md5(
      cat(
        i & 1 ? pw : final,
        i % 3 ? s : new Uint8Array(),
        i % 7 ? pw : new Uint8Array(),
        i & 1 ? final : pw,
      ),
    );
  }
  const f = final;
  const out =
    to64((f[0]! << 16) | (f[6]! << 8) | f[12]!, 4) +
    to64((f[1]! << 16) | (f[7]! << 8) | f[13]!, 4) +
    to64((f[2]! << 16) | (f[8]! << 8) | f[14]!, 4) +
    to64((f[3]! << 16) | (f[9]! << 8) | f[15]!, 4) +
    to64((f[4]! << 16) | (f[10]! << 8) | f[5]!, 4) +
    to64(f[11]!, 2);
  return `${magic}${salt.slice(0, 8)}$${out}`;
}

/** SHA-crypt nach Ulrich Drepper: $5$ (SHA-256) und $6$ (SHA-512) wie in /etc/shadow */
export async function shaCrypt(
  password: string,
  salt: string,
  variant: 5 | 6,
  rounds = 5000,
): Promise<string> {
  const alg = variant === 6 ? "SHA-512" : "SHA-256";
  const H = async (d: Uint8Array) =>
    new Uint8Array(await crypto.subtle.digest(alg, d as BufferSource));
  const hl = variant === 6 ? 64 : 32;
  const pw = enc.encode(password);
  const s = enc.encode(salt.slice(0, 16));
  const r = Math.min(999_999_999, Math.max(1000, rounds));
  const B = await H(cat(pw, s, pw));
  const aParts: Uint8Array[] = [pw, s];
  let n = pw.length;
  for (; n > hl; n -= hl) aParts.push(B);
  aParts.push(B.subarray(0, n));
  for (let i = pw.length; i > 0; i >>= 1) aParts.push(i & 1 ? B : pw);
  const A = await H(cat(...aParts));
  const DP = await H(cat(...Array(pw.length).fill(pw)));
  const P = cat(...Array(Math.floor(pw.length / hl)).fill(DP), DP.subarray(0, pw.length % hl));
  const DS = await H(cat(...Array(16 + A[0]!).fill(s)));
  const S = cat(...Array(Math.floor(s.length / hl)).fill(DS), DS.subarray(0, s.length % hl));
  let C = A;
  for (let i = 0; i < r; i++) {
    const parts: Uint8Array[] = [i & 1 ? P : C];
    if (i % 3) parts.push(S);
    if (i % 7) parts.push(P);
    parts.push(i & 1 ? C : P);
    C = await H(cat(...parts));
  }
  const b = (x: number, y: number, z: number, n4: number) =>
    to64((C[x]! << 16) | (C[y]! << 8) | C[z]!, n4);
  let out = "";
  if (variant === 6) {
    const g = [
      [0, 21, 42],
      [22, 43, 1],
      [44, 2, 23],
      [3, 24, 45],
      [25, 46, 4],
      [47, 5, 26],
      [6, 27, 48],
      [28, 49, 7],
      [50, 8, 29],
      [9, 30, 51],
      [31, 52, 10],
      [53, 11, 32],
      [12, 33, 54],
      [34, 55, 13],
      [56, 14, 35],
      [15, 36, 57],
      [37, 58, 16],
      [59, 17, 38],
      [18, 39, 60],
      [40, 61, 19],
      [62, 20, 41],
    ];
    for (const [x, y, z] of g) out += b(x!, y!, z!, 4);
    out += to64(C[63]!, 2);
  } else {
    const g = [
      [0, 10, 20],
      [21, 1, 11],
      [12, 22, 2],
      [3, 13, 23],
      [24, 4, 14],
      [15, 25, 5],
      [6, 16, 26],
      [27, 7, 17],
      [18, 28, 8],
      [9, 19, 29],
    ];
    for (const [x, y, z] of g) out += b(x!, y!, z!, 4);
    out += to64((C[31]! << 8) | C[30]!, 3);
  }
  return `$${variant}$${r !== 5000 ? `rounds=${r}$` : ""}${salt.slice(0, 16)}$${out}`;
}

/** htpasswd {SHA}: Base64(SHA-1) ohne Salt – veraltet */
export async function shaHtpasswd(password: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-1", enc.encode(password)));
  return `{SHA}${btoa(String.fromCharCode(...d))}`;
}
