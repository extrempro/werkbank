/**
 * PFX / PKCS#12 (RFC 7292) lesen und erzeugen.
 * Lesen: BER erlaubt, Inhalte unverschlüsselt oder verschlüsselt (PBES2/AES, 3DES, RC2), MAC-Prüfung.
 * Erzeugen: „modern“ (AES-256, wie OpenSSL 3 / Windows „AES256-SHA256“) oder „kompatibel“ (3DES/SHA-1).
 */
import {
  child,
  content,
  isContext,
  isUniversal,
  octetString,
  parseDer,
  readOid,
  readSmallInt,
  readString,
  Tag,
  toHex,
  type Asn1Node,
} from "./asn1";
import { explicit, implicitPrimitive, integer, nul, octets, oid, seq, set, bmpString } from "./der";
import { PasswordError } from "./keys";
import {
  bmpPassword,
  describePbe,
  digestOidToHash,
  encryptedParts,
  hashLength,
  hmac,
  pbeDecrypt,
  pbeEncrypt,
  pkcs12Kdf,
  random,
  type EncryptionMode,
  type HashName,
} from "./pbe";

const OID = {
  data: "1.2.840.113549.1.7.1",
  encryptedData: "1.2.840.113549.1.7.6",
  envelopedData: "1.2.840.113549.1.7.3",
  keyBag: "1.2.840.113549.1.12.10.1.1",
  shroudedKeyBag: "1.2.840.113549.1.12.10.1.2",
  certBag: "1.2.840.113549.1.12.10.1.3",
  crlBag: "1.2.840.113549.1.12.10.1.4",
  secretBag: "1.2.840.113549.1.12.10.1.5",
  safeContentsBag: "1.2.840.113549.1.12.10.1.6",
  x509Certificate: "1.2.840.113549.1.9.22.1",
  friendlyName: "1.2.840.113549.1.9.20",
  localKeyId: "1.2.840.113549.1.9.21",
  pbmac1: "1.2.840.113549.1.5.14",
} as const;

const hashToDigestOid: Record<HashName, string> = Object.fromEntries(
  Object.entries(digestOidToHash).map(([o, h]) => [h, o]),
) as Record<HashName, string>;

export interface PfxEntry {
  der: Uint8Array;
  friendlyName?: string;
  localKeyId?: string;
}

export interface PfxContent {
  certs: PfxEntry[];
  /** unverschlüsseltes PKCS#8 */
  keys: PfxEntry[];
  /** Angaben zur Datei für die Anzeige */
  details: { label: string; value: string }[];
  warnings: string[];
}

/** erkennt eine PFX-Datei (auch BER-kodiert) */
export function looksLikePfx(bytes: Uint8Array): boolean {
  try {
    const top = parseDer(bytes, 0, bytes.length, true);
    const [version, authSafe] = top.children;
    return (
      isUniversal(version, Tag.Integer) &&
      readSmallInt(version) === 3 &&
      isUniversal(authSafe, Tag.Sequence) &&
      isUniversal(authSafe.children[0], Tag.Oid) &&
      readOid(authSafe.children[0]) === OID.data
    );
  } catch {
    return false;
  }
}

/** Inhalt von [0] EXPLICIT OCTET STRING einer ContentInfo vom Typ data */
function dataContent(contentInfo: Asn1Node): Uint8Array {
  return octetString(child(child(contentInfo, 1), 0));
}

function parseAttributes(bag: Asn1Node): { friendlyName?: string; localKeyId?: string } {
  const attrs = bag.children[2];
  const out: { friendlyName?: string; localKeyId?: string } = {};
  if (!isUniversal(attrs, Tag.Set)) return out;
  for (const attr of attrs.children) {
    const type = readOid(child(attr, 0));
    const value = child(attr, 1).children[0];
    if (!value) continue;
    if (type === OID.friendlyName) out.friendlyName = readString(value);
    if (type === OID.localKeyId) out.localKeyId = toHex(content(value));
  }
  return out;
}

const iterationText = (n: number) => `${n.toLocaleString("de-DE")} Iterationen`;

/**
 * Liest eine PFX-Datei. Wirft `PasswordError`, wenn das Kennwort fehlt oder falsch ist.
 */
export async function parsePfx(bytes: Uint8Array, password: string): Promise<PfxContent> {
  const top = parseDer(bytes, 0, bytes.length, true);
  const authSafeInfo = child(top, 1);
  const authSafeBytes = dataContent(authSafeInfo);
  const macData = top.children[2];
  const details: PfxContent["details"] = [];
  const warnings: string[] = [];

  // Kennwort-Varianten: normal (BMPString + 00 00) und – nur bei leerem Kennwort – ganz ohne Bytes
  const candidates: { pw: string; emptyAsNull: boolean }[] = [{ pw: password, emptyAsNull: false }];
  if (password === "") candidates.push({ pw: "", emptyAsNull: true });
  let chosen = candidates[0]!;

  if (macData) {
    const digestInfo = child(macData, 0);
    const macAlg = readOid(child(child(digestInfo, 0), 0));
    if (macAlg === OID.pbmac1) {
      details.push({ label: "Integrität (MAC)", value: "PBMAC1" });
      warnings.push("Die Datei nutzt PBMAC1 – die Integritätsprüfung wird hier übersprungen.");
    } else {
      const hash = digestOidToHash[macAlg];
      if (!hash) throw new Error(`Unbekanntes MAC-Verfahren (${macAlg})`);
      const expected = content(child(digestInfo, 1));
      const salt = content(child(macData, 1));
      const iterations = macData.children[2] ? readSmallInt(child(macData, 2)) : 1;
      details.push({
        label: "Integrität (MAC)",
        value: `HMAC-${hash}, ${iterationText(iterations)}`,
      });
      let ok: (typeof candidates)[number] | undefined;
      for (const c of candidates) {
        const pw = c.emptyAsNull ? new Uint8Array(0) : bmpPassword(c.pw);
        const key = await pkcs12Kdf(hash, pw, salt, iterations, 3, hashLength(hash));
        const mac = await hmac(hash, key, authSafeBytes);
        if (toHex(mac) === toHex(expected)) {
          ok = c;
          break;
        }
      }
      if (!ok) {
        throw password
          ? new PasswordError(
              "Kennwort ist falsch (die Integritätsprüfung der PFX-Datei schlägt fehl).",
              false,
            )
          : new PasswordError(
              "Die PFX-Datei ist kennwortgeschützt – bitte Kennwort eingeben.",
              true,
            );
      }
      chosen = ok;
    }
  } else {
    details.push({ label: "Integrität (MAC)", value: "keine" });
  }

  const certs: PfxEntry[] = [];
  const keys: PfxEntry[] = [];
  const certEncryption = new Set<string>();
  const keyEncryption = new Set<string>();

  const decrypt = async (algId: Asn1Node, data: Uint8Array) => {
    try {
      return await pbeDecrypt(algId, data, chosen.pw, chosen.emptyAsNull);
    } catch (e) {
      if (e instanceof Error && /falsches Kennwort|ungültige Länge/.test(e.message)) {
        throw password
          ? new PasswordError("Kennwort ist falsch.", false)
          : new PasswordError(
              "Die PFX-Datei ist kennwortgeschützt – bitte Kennwort eingeben.",
              true,
            );
      }
      throw e;
    }
  };

  const describe = (algId: Asn1Node) => {
    const d = describePbe(algId);
    return `${d.label}, ${iterationText(d.iterations)}`;
  };

  const readBags = async (safeContents: Uint8Array, encryption: string | null) => {
    const list = parseDer(safeContents, 0, safeContents.length, true);
    for (const bag of list.children) {
      const type = readOid(child(bag, 0));
      const value = child(child(bag, 1), 0);
      const attrs = parseAttributes(bag);
      switch (type) {
        case OID.certBag: {
          const certType = readOid(child(value, 0));
          if (certType !== OID.x509Certificate) {
            warnings.push("Ein Zertifikat in einem unbekannten Format wurde übersprungen.");
            break;
          }
          certs.push({ der: octetString(child(child(value, 1), 0)).slice(), ...attrs });
          if (encryption) certEncryption.add(encryption);
          break;
        }
        case OID.keyBag:
          keys.push({ der: dataOf(value), ...attrs });
          keyEncryption.add("keine (Schlüssel liegt unverschlüsselt in der Datei)");
          break;
        case OID.shroudedKeyBag: {
          const { algId, data } = encryptedParts(value);
          keyEncryption.add(describe(algId));
          keys.push({ der: await decrypt(algId, data), ...attrs });
          break;
        }
        case OID.safeContentsBag:
          await readBags(dataOf(value), encryption);
          break;
        case OID.crlBag:
        case OID.secretBag:
          warnings.push("Sperrlisten bzw. geheime Daten in der PFX-Datei wurden übersprungen.");
          break;
        default:
          warnings.push(`Unbekannter Eintrag (${type}) wurde übersprungen.`);
      }
    }
  };

  const authSafe = parseDer(authSafeBytes, 0, authSafeBytes.length, true);
  for (const info of authSafe.children) {
    const type = readOid(child(info, 0));
    if (type === OID.data) {
      await readBags(dataContent(info), null);
    } else if (type === OID.encryptedData) {
      const encryptedData = child(child(info, 1), 0);
      const eci = child(encryptedData, 1);
      const algId = child(eci, 1);
      const encrypted = eci.children[2];
      if (!encrypted || !isContext(encrypted, 0)) continue;
      const label = describe(algId);
      await readBags(await decrypt(algId, octetString(encrypted)), label);
    } else if (type === OID.envelopedData) {
      warnings.push(
        "Mit einem Zertifikat verschlüsselte Inhalte (envelopedData) werden nicht unterstützt.",
      );
    }
  }

  if (certs.length && !certEncryption.size) certEncryption.add("keine");
  if (keyEncryption.size)
    details.push({ label: "Verschlüsselung Schlüssel", value: [...keyEncryption].join("; ") });
  if (certEncryption.size)
    details.push({ label: "Verschlüsselung Zertifikate", value: [...certEncryption].join("; ") });
  if ([...keyEncryption, ...certEncryption].some((e) => /RC2|RC4|2-Key/.test(e))) {
    warnings.push(
      "Die Datei nutzt veraltete Verschlüsselung (RC2/RC4). Für OpenSSL 3 ohne „-legacy“ neu exportieren, z. B. hier als PFX (modern).",
    );
  }

  return { certs, keys, details, warnings };
}

function dataOf(node: Asn1Node): Uint8Array {
  return node.buffer.slice(node.start, node.end);
}

// ---------- Erzeugen ----------

export interface BuildPfxOptions {
  /** unverschlüsseltes PKCS#8 */
  key?: Uint8Array;
  /** Zertifikate (DER), das zum Schlüssel gehörende zuerst */
  certs: Uint8Array[];
  password: string;
  friendlyName?: string;
  mode: EncryptionMode;
}

function attributes(
  friendlyName: string | undefined,
  localKeyId: Uint8Array | undefined,
): Uint8Array[] {
  const attrs: Uint8Array[] = [];
  if (friendlyName) attrs.push(seq(oid(OID.friendlyName), set(bmpString(friendlyName))));
  if (localKeyId) attrs.push(seq(oid(OID.localKeyId), set(octets(localKeyId))));
  return attrs.length ? [set(...attrs)] : [];
}

export async function buildPfx(options: BuildPfxOptions): Promise<Uint8Array> {
  const { key, certs, password, friendlyName, mode } = options;
  if (certs.length === 0 && !key) throw new Error("Nichts zum Exportieren");
  const localKeyId =
    key && certs[0]
      ? new Uint8Array(await crypto.subtle.digest("SHA-1", certs[0] as BufferSource))
      : undefined;

  const certBags = certs.map((der, i) =>
    seq(
      oid(OID.certBag),
      explicit(0, seq(oid(OID.x509Certificate), explicit(0, octets(der)))),
      ...attributes(i === 0 ? friendlyName : undefined, i === 0 ? localKeyId : undefined),
    ),
  );

  const contentInfos: Uint8Array[] = [];
  if (certBags.length) {
    const enc = await pbeEncrypt(mode, password, seq(...certBags));
    contentInfos.push(
      seq(
        oid(OID.encryptedData),
        explicit(0, seq(integer(0), seq(oid(OID.data), enc.algId, implicitPrimitive(0, enc.data)))),
      ),
    );
  }
  if (key) {
    const enc = await pbeEncrypt(mode, password, key);
    const bag = seq(
      oid(OID.shroudedKeyBag),
      explicit(0, seq(enc.algId, octets(enc.data))),
      ...attributes(friendlyName, localKeyId),
    );
    contentInfos.push(seq(oid(OID.data), explicit(0, octets(seq(bag)))));
  }
  const authSafe = seq(...contentInfos);

  const hash: HashName = mode === "aes" ? "SHA-256" : "SHA-1";
  const macSalt = random(mode === "aes" ? 16 : 8);
  const macIterations = 2048;
  const macKey = await pkcs12Kdf(
    hash,
    bmpPassword(password),
    macSalt,
    macIterations,
    3,
    hashLength(hash),
  );
  const mac = await hmac(hash, macKey, authSafe);
  const macData = seq(
    seq(seq(oid(hashToDigestOid[hash]), nul()), octets(mac)),
    octets(macSalt),
    integer(macIterations),
  );

  return seq(integer(3), seq(oid(OID.data), explicit(0, octets(authSafe))), macData);
}
