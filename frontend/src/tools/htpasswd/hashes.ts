/** Passwort-Hashes für htpasswd, /etc/shadow & Co. erzeugen und prüfen */
import { bcryptHash, bcryptVerify } from "../lib/crypto/bcrypt";
import { md5Crypt, randomSalt, shaCrypt, shaHtpasswd } from "../lib/crypto/crypt";

export type HashFormat = "bcrypt" | "sha512" | "sha256" | "apr1" | "md5" | "sha1";

export const formats: {
  id: HashFormat;
  label: string;
  note: string;
  tone: "ok" | "warn" | "error";
}[] = [
  {
    id: "bcrypt",
    label: "bcrypt ($2y$)",
    note: "Empfohlen für Apache/nginx-htpasswd und viele Web-Anwendungen",
    tone: "ok",
  },
  {
    id: "sha512",
    label: "SHA-512-crypt ($6$)",
    note: "Standard in /etc/shadow, Ansible password_hash, cloud-init",
    tone: "ok",
  },
  { id: "sha256", label: "SHA-256-crypt ($5$)", note: "wie $6$, seltener genutzt", tone: "ok" },
  {
    id: "apr1",
    label: "Apache MD5 ($apr1$)",
    note: "alter htpasswd-Standard – nur noch für alte Systeme",
    tone: "warn",
  },
  { id: "md5", label: "MD5-crypt ($1$)", note: "veraltet, schnell zu knacken", tone: "error" },
  { id: "sha1", label: "{SHA}", note: "ohne Salt – nur wenn nichts anderes geht", tone: "error" },
];

export async function makeHash(
  password: string,
  format: HashFormat,
  opts: { cost: number; rounds: number },
): Promise<string> {
  switch (format) {
    case "bcrypt":
      // $2y$ ist das Präfix, das Apache-htpasswd schreibt; inhaltlich identisch mit $2b$
      return bcryptHash(password, opts.cost, "2y");
    case "sha512":
      return shaCrypt(password, randomSalt(16), 6, opts.rounds);
    case "sha256":
      return shaCrypt(password, randomSalt(16), 5, opts.rounds);
    case "apr1":
      return md5Crypt(password, randomSalt(8), "$apr1$");
    case "md5":
      return md5Crypt(password, randomSalt(8), "$1$");
    case "sha1":
      return shaHtpasswd(password);
  }
}

/** Format eines Hashes erkennen */
export function detectFormat(hash: string): HashFormat | undefined {
  if (/^\$2[abxy]\$\d{2}\$/.test(hash)) return "bcrypt";
  if (hash.startsWith("$6$")) return "sha512";
  if (hash.startsWith("$5$")) return "sha256";
  if (hash.startsWith("$apr1$")) return "apr1";
  if (hash.startsWith("$1$")) return "md5";
  if (hash.startsWith("{SHA}")) return "sha1";
  return undefined;
}

/** „benutzer:hash“ oder nur „hash“ */
export function splitLine(line: string): { user?: string; hash: string } {
  const t = line.trim();
  const m = /^([^:$]+):(.+)$/.exec(t);
  // /etc/shadow hat weitere Felder nach dem Hash
  return m ? { user: m[1], hash: m[2]!.split(":")[0]! } : { hash: t };
}

export async function verifyHash(password: string, hash: string): Promise<boolean> {
  const f = detectFormat(hash);
  if (!f)
    throw new Error(
      "Unbekanntes Hash-Format – unterstützt: $2y$/$2b$, $6$, $5$, $apr1$, $1$, {SHA}",
    );
  if (f === "bcrypt") return bcryptVerify(password, hash);
  if (f === "sha1") return (await shaHtpasswd(password)) === hash;
  if (f === "apr1" || f === "md5") {
    const magic = f === "apr1" ? "$apr1$" : "$1$";
    const salt = hash.slice(magic.length).split("$")[0]!;
    return md5Crypt(password, salt, magic) === hash;
  }
  const m = /^\$([56])\$(?:rounds=(\d+)\$)?([^$]{0,16})\$/.exec(hash);
  if (!m) throw new Error("SHA-crypt-Hash unvollständig");
  return (
    (await shaCrypt(password, m[3]!, Number(m[1]) as 5 | 6, m[2] ? Number(m[2]) : 5000)) === hash
  );
}
