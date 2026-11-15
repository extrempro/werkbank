/**
 * bcrypt (OpenBSD, $2a$/$2b$/$2y$) mit eigener Blowfish-Umsetzung.
 * Die Startwerte von Blowfish sind die Nachkommastellen von π (hier als Base64 abgelegt).
 */

const PI_B64 =
  "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";

let init: Uint32Array | null = null;
function initialState(): Uint32Array {
  if (!init) {
    const bin = atob(PI_B64);
    init = new Uint32Array(1042);
    for (let i = 0; i < 1042; i++)
      init[i] =
        ((bin.charCodeAt(i * 4) << 24) |
          (bin.charCodeAt(i * 4 + 1) << 16) |
          (bin.charCodeAt(i * 4 + 2) << 8) |
          bin.charCodeAt(i * 4 + 3)) >>>
        0;
  }
  return init;
}

class Blowfish {
  P: Uint32Array;
  S: Uint32Array;
  constructor() {
    const s = initialState();
    this.P = s.slice(0, 18);
    this.S = s.slice(18);
  }
  private f(x: number): number {
    const S = this.S;
    return (
      ((((S[x >>> 24]! + S[256 + ((x >>> 16) & 0xff)]!) ^ S[512 + ((x >>> 8) & 0xff)]!) >>> 0) +
        S[768 + (x & 0xff)]!) >>>
      0
    );
  }
  encrypt(lr: Uint32Array, off: number) {
    let l = lr[off]!;
    let r = lr[off + 1]!;
    const P = this.P;
    for (let i = 0; i < 16; i += 2) {
      l = (l ^ P[i]!) >>> 0;
      r = (r ^ this.f(l)) >>> 0;
      r = (r ^ P[i + 1]!) >>> 0;
      l = (l ^ this.f(r)) >>> 0;
    }
    lr[off] = (r ^ P[17]!) >>> 0;
    lr[off + 1] = (l ^ P[16]!) >>> 0;
  }
  /** ExpandKey aus dem bcrypt-Papier (mit salt) bzw. Blowfish-Schlüsselplan (ohne) */
  expand(key: Uint8Array, salt?: Uint8Array) {
    let kp = 0;
    const word = (data: Uint8Array, pos: { p: number }) => {
      let w = 0;
      for (let i = 0; i < 4; i++) {
        w = (w << 8) | data[pos.p]!;
        pos.p = (pos.p + 1) % data.length;
      }
      return w >>> 0;
    };
    const k = { p: kp };
    for (let i = 0; i < 18; i++) this.P[i] = (this.P[i]! ^ word(key, k)) >>> 0;
    kp = k.p;
    const sp = { p: 0 };
    const lr = new Uint32Array(2);
    const step = (arr: Uint32Array, i: number) => {
      if (salt) {
        lr[0] = (lr[0]! ^ word(salt, sp)) >>> 0;
        lr[1] = (lr[1]! ^ word(salt, sp)) >>> 0;
      }
      this.encrypt(lr, 0);
      arr[i] = lr[0]!;
      arr[i + 1] = lr[1]!;
    };
    for (let i = 0; i < 18; i += 2) step(this.P, i);
    for (let i = 0; i < 1024; i += 2) step(this.S, i);
  }
}

/** für Tests: Blowfish-ECB mit beliebigem Schlüssel */
export function blowfishEncryptBlock(key: Uint8Array, block: [number, number]): [number, number] {
  const bf = new Blowfish();
  bf.expand(key);
  const lr = Uint32Array.from(block);
  bf.encrypt(lr, 0);
  return [lr[0]!, lr[1]!];
}

const B64 = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function encodeB64(data: Uint8Array, len: number): string {
  let out = "";
  let i = 0;
  while (i < len) {
    let c1 = data[i++]!;
    out += B64[(c1 >> 2) & 0x3f];
    c1 = (c1 & 0x03) << 4;
    if (i >= len) {
      out += B64[c1];
      break;
    }
    let c2 = data[i++]!;
    out += B64[c1 | ((c2 >> 4) & 0x0f)];
    c1 = (c2 & 0x0f) << 2;
    if (i >= len) {
      out += B64[c1];
      break;
    }
    c2 = data[i++]!;
    out += B64[c1 | ((c2 >> 6) & 0x03)];
    out += B64[c2 & 0x3f];
  }
  return out;
}

function decodeB64(s: string, len: number): Uint8Array {
  const out: number[] = [];
  const v = (c: string) => {
    const i = B64.indexOf(c);
    if (i < 0) throw new Error("Ungültiges Zeichen im bcrypt-Salt");
    return i;
  };
  let i = 0;
  while (out.length < len && i < s.length - 1) {
    const c1 = v(s[i++]!);
    const c2 = v(s[i++]!);
    out.push(((c1 << 2) | ((c2 & 0x30) >> 4)) & 0xff);
    if (out.length >= len || i >= s.length) break;
    const c3 = v(s[i++]!);
    out.push((((c2 & 0x0f) << 4) | ((c3 & 0x3c) >> 2)) & 0xff);
    if (out.length >= len || i >= s.length) break;
    const c4 = v(s[i++]!);
    out.push((((c3 & 0x03) << 6) | c4) & 0xff);
  }
  return Uint8Array.from(out);
}

export function bcryptRaw(
  password: string,
  cost: number,
  salt: Uint8Array,
  prefix: "2a" | "2b" | "2y" = "2b",
): string {
  if (cost < 4 || cost > 31) throw new Error("Kostenfaktor muss zwischen 4 und 31 liegen");
  const pw = new TextEncoder().encode(password);
  const key = new Uint8Array(Math.min(pw.length + 1, 72));
  key.set(pw.subarray(0, 72));
  const bf = new Blowfish();
  bf.expand(key, salt);
  const rounds = 2 ** cost;
  for (let i = 0; i < rounds; i++) {
    bf.expand(key);
    bf.expand(salt);
  }
  const ctext = Uint32Array.from([
    0x4f727068, 0x65616e42, 0x65686f6c, 0x64657253, 0x63727944, 0x6f756274,
  ]);
  for (let i = 0; i < 64; i++) for (let j = 0; j < 6; j += 2) bf.encrypt(ctext, j);
  const bytes = new Uint8Array(24);
  ctext.forEach((w, i) => {
    bytes[i * 4] = w >>> 24;
    bytes[i * 4 + 1] = (w >>> 16) & 0xff;
    bytes[i * 4 + 2] = (w >>> 8) & 0xff;
    bytes[i * 4 + 3] = w & 0xff;
  });
  return `$${prefix}$${String(cost).padStart(2, "0")}$${encodeB64(salt, 16)}${encodeB64(bytes, 23)}`;
}

/** bcrypt mit Zufalls-Salt */
export function bcryptHash(password: string, cost = 12, prefix: "2a" | "2b" | "2y" = "2b"): string {
  return bcryptRaw(password, cost, crypto.getRandomValues(new Uint8Array(16)), prefix);
}

/** Salt und Kosten aus einem vorhandenen Hash übernehmen (für Tests und Prüfen) */
export function bcryptWithSetting(password: string, setting: string): string {
  const m = /^\$(2[abxy])\$(\d{2})\$([./A-Za-z0-9]{22})/.exec(setting);
  if (!m) throw new Error("Kein bcrypt-Hash ($2a$/$2b$/$2y$)");
  return bcryptRaw(
    password,
    Number(m[2]),
    decodeB64(m[3]!, 16),
    (m[1] === "2x" ? "2a" : m[1]) as "2a",
  );
}

export function bcryptVerify(password: string, hash: string): boolean {
  return bcryptWithSetting(password, hash) === hash.slice(0, 60);
}
