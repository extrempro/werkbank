import {
  child,
  content,
  isContext,
  isUniversal,
  parseDerStrict,
  raw,
  readBitString,
  readBoolean,
  readIntegerHex,
  readOid,
  readSmallInt,
  readString,
  readTime,
  Tag,
  TagClass,
  toHex,
  type Asn1Node,
} from "./asn1";

// ---------- OID-Namen ----------

const nameOids: Record<string, string> = {
  "2.5.4.3": "CN",
  "2.5.4.4": "SN",
  "2.5.4.5": "serialNumber",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.9": "street",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "2.5.4.12": "title",
  "2.5.4.42": "GN",
  "2.5.4.97": "organizationIdentifier",
  "1.2.840.113549.1.9.1": "E",
  "0.9.2342.19200300.100.1.1": "UID",
  "0.9.2342.19200300.100.1.25": "DC",
};

const signatureOids: Record<string, string> = {
  "1.2.840.113549.1.1.4": "MD5 mit RSA",
  "1.2.840.113549.1.1.5": "SHA-1 mit RSA",
  "1.2.840.113549.1.1.10": "RSASSA-PSS",
  "1.2.840.113549.1.1.11": "SHA-256 mit RSA",
  "1.2.840.113549.1.1.12": "SHA-384 mit RSA",
  "1.2.840.113549.1.1.13": "SHA-512 mit RSA",
  "1.2.840.10045.4.1": "ECDSA mit SHA-1",
  "1.2.840.10045.4.3.2": "ECDSA mit SHA-256",
  "1.2.840.10045.4.3.3": "ECDSA mit SHA-384",
  "1.2.840.10045.4.3.4": "ECDSA mit SHA-512",
  "1.3.101.112": "Ed25519",
  "1.3.101.113": "Ed448",
};

export const curveOids: Record<string, { name: string; bits: number }> = {
  "1.2.840.10045.3.1.7": { name: "P-256", bits: 256 },
  "1.3.132.0.34": { name: "P-384", bits: 384 },
  "1.3.132.0.35": { name: "P-521", bits: 521 },
  "1.3.132.0.10": { name: "secp256k1", bits: 256 },
};

const extensionOids: Record<string, string> = {
  "2.5.29.14": "Subject Key Identifier",
  "2.5.29.15": "Key Usage",
  "2.5.29.17": "Subject Alternative Name",
  "2.5.29.19": "Basic Constraints",
  "2.5.29.31": "CRL-Verteilungspunkte",
  "2.5.29.32": "Zertifikatsrichtlinien",
  "2.5.29.35": "Authority Key Identifier",
  "2.5.29.37": "Erweiterte Schlüsselverwendung",
  "1.3.6.1.5.5.7.1.1": "Zugriff auf Stelleninformationen (AIA)",
  "1.3.6.1.4.1.11129.2.4.2": "Certificate Transparency (SCT)",
  "1.3.6.1.4.1.311.20.2": "Zertifikatvorlagenname (Microsoft)",
  "1.3.6.1.4.1.311.21.7": "Zertifikatvorlage (Microsoft)",
  "1.3.6.1.4.1.311.21.10": "Anwendungsrichtlinien (Microsoft)",
  "1.3.6.1.4.1.311.25.2": "SID-Erweiterung (Microsoft)",
};

const ekuOids: Record<string, string> = {
  "1.3.6.1.5.5.7.3.1": "Serverauthentifizierung",
  "1.3.6.1.5.5.7.3.2": "Clientauthentifizierung",
  "1.3.6.1.5.5.7.3.3": "Codesignatur",
  "1.3.6.1.5.5.7.3.4": "Sichere E-Mail",
  "1.3.6.1.5.5.7.3.8": "Zeitstempel",
  "1.3.6.1.5.5.7.3.9": "OCSP-Signatur",
  "1.3.6.1.4.1.311.20.2.2": "Smartcard-Anmeldung",
  "1.3.6.1.4.1.311.10.3.4": "Verschlüsselndes Dateisystem (EFS)",
  "1.3.6.1.4.1.311.10.3.12": "Dokumentsignatur",
  "2.5.29.37.0": "Beliebiger Zweck",
};

const keyUsageNames = [
  "Digitale Signatur",
  "Nichtabstreitbarkeit",
  "Schlüsselverschlüsselung",
  "Datenverschlüsselung",
  "Schlüsselvereinbarung",
  "Zertifikatsignatur",
  "CRL-Signatur",
  "Nur Verschlüsselung",
  "Nur Entschlüsselung",
];

// ---------- Typen ----------

export interface ParsedName {
  attrs: { type: string; value: string }[];
  /** Darstellung wie in Windows/OpenSSL: CN zuerst */
  text: string;
}

export interface SanEntry {
  type: "DNS" | "IP" | "E-Mail" | "URI" | "UPN" | "Verzeichnisname" | "Sonstiges";
  value: string;
}

export interface PublicKeyInfo {
  algorithm: string;
  bits?: number;
  curve?: string;
}

export interface ExtensionInfo {
  oid: string;
  name: string;
  critical: boolean;
}

interface CommonInfo {
  subject: ParsedName;
  publicKey: PublicKeyInfo;
  signatureAlgorithm: string;
  san: SanEntry[];
  keyUsage: string[];
  extKeyUsage: string[];
  extensions: ExtensionInfo[];
  /** SubjectPublicKeyInfo (DER) – zum Abgleich mit privaten Schlüsseln */
  spki: Uint8Array;
  /** DER-Bytes des gesamten Objekts (für Fingerprints) */
  der: Uint8Array;
}

export interface CertificateInfo extends CommonInfo {
  kind: "certificate";
  version: number;
  serial: string;
  issuer: ParsedName;
  notBefore: Date;
  notAfter: Date;
  basicConstraints?: { ca: boolean; pathLength?: number };
  subjectKeyId?: string;
  authorityKeyId?: string;
  crlUrls: string[];
  ocspUrls: string[];
  caIssuerUrls: string[];
  selfSigned: boolean;
}

export interface CsrInfo extends CommonInfo {
  kind: "csr";
}

export type DecodedItem = CertificateInfo | CsrInfo;

export interface DecodeResult {
  items: DecodedItem[];
  warnings: string[];
}

// ---------- Hilfsfunktionen ----------

function escapeDn(value: string): string {
  return value
    .replace(/([,+"\\<>;=])/g, "\\$1")
    .replace(/^([ #])/, "\\$1")
    .replace(/ $/, "\\ ");
}

export function parseName(node: Asn1Node): ParsedName {
  const attrs: ParsedName["attrs"] = [];
  for (const rdn of node.children) {
    for (const atv of rdn.children) {
      const oid = readOid(child(atv, 0));
      const valueNode = child(atv, 1);
      const value = valueNode.constructed ? toHex(content(valueNode)) : readString(valueNode);
      attrs.push({ type: nameOids[oid] ?? oid, value });
    }
  }
  const text = [...attrs]
    .reverse()
    .map((a) => `${a.type}=${escapeDn(a.value)}`)
    .join(", ");
  return { attrs, text };
}

function formatIp(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join(".");
  if (bytes.length !== 16) return toHex(bytes);
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((bytes[i]! << 8) | bytes[i + 1]!);
  // längste Folge von Null-Gruppen durch :: ersetzen
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > bestLen && j - i > 1) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (bestStart < 0) return hex.join(":");
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLen).join(":")}`;
}

function parseGeneralName(node: Asn1Node): SanEntry {
  if (node.cls !== TagClass.Context) return { type: "Sonstiges", value: toHex(raw(node)) };
  const text = () => String.fromCharCode(...content(node));
  switch (node.tag) {
    case 1:
      return { type: "E-Mail", value: text() };
    case 2:
      return { type: "DNS", value: text() };
    case 6:
      return { type: "URI", value: text() };
    case 7:
      return { type: "IP", value: formatIp(content(node)) };
    case 4:
      return { type: "Verzeichnisname", value: parseName(child(node, 0)).text };
    case 0: {
      // otherName: OID + [0] EXPLICIT Wert – UPN (Microsoft) gezielt auslesen
      const oid = readOid(child(node, 0));
      const wrapper = node.children[1];
      const valueNode = wrapper?.children[0];
      const value = valueNode && !valueNode.constructed ? readString(valueNode) : "";
      if (oid === "1.3.6.1.4.1.311.20.2.3") return { type: "UPN", value };
      return { type: "Sonstiges", value: `${oid}: ${value}` };
    }
    default:
      return { type: "Sonstiges", value: toHex(content(node)) };
  }
}

function collectUris(node: Asn1Node, out: string[]) {
  if (node.cls === TagClass.Context && node.tag === 6 && !node.constructed) {
    out.push(String.fromCharCode(...content(node)));
  }
  for (const c of node.children) collectUris(c, out);
}

function parsePublicKey(spki: Asn1Node): PublicKeyInfo {
  const algId = child(spki, 0);
  const oid = readOid(child(algId, 0));
  const keyBits = readBitString(child(spki, 1));
  switch (oid) {
    case "1.2.840.113549.1.1.1": {
      const rsa = parseDerStrict(keyBits);
      let modulus = content(child(rsa, 0));
      while (modulus.length > 0 && modulus[0] === 0) modulus = modulus.subarray(1);
      const bits = modulus.length * 8 - Math.clz32(modulus[0] ?? 0) + 24;
      return { algorithm: "RSA", bits };
    }
    case "1.2.840.10045.2.1": {
      const param = algId.children[1];
      const curve = param && isUniversal(param, Tag.Oid) ? curveOids[readOid(param)] : undefined;
      return { algorithm: "ECDSA", curve: curve?.name ?? "unbekannte Kurve", bits: curve?.bits };
    }
    case "1.3.101.112":
      return { algorithm: "Ed25519", bits: 256 };
    case "1.3.101.113":
      return { algorithm: "Ed448", bits: 456 };
    case "1.2.840.113549.1.1.10":
      return { algorithm: "RSA-PSS" };
    default:
      return { algorithm: oid };
  }
}

function algorithmName(algId: Asn1Node): string {
  const oid = readOid(child(algId, 0));
  return signatureOids[oid] ?? oid;
}

interface ParsedExtensions {
  list: ExtensionInfo[];
  san: SanEntry[];
  keyUsage: string[];
  extKeyUsage: string[];
  basicConstraints?: { ca: boolean; pathLength?: number };
  subjectKeyId?: string;
  authorityKeyId?: string;
  crlUrls: string[];
  ocspUrls: string[];
  caIssuerUrls: string[];
}

function parseExtensions(seq: Asn1Node | undefined): ParsedExtensions {
  const result: ParsedExtensions = {
    list: [],
    san: [],
    keyUsage: [],
    extKeyUsage: [],
    crlUrls: [],
    ocspUrls: [],
    caIssuerUrls: [],
  };
  if (!seq) return result;
  for (const ext of seq.children) {
    const oid = readOid(child(ext, 0));
    const hasCritical = isUniversal(ext.children[1], Tag.Boolean);
    const critical = hasCritical ? readBoolean(ext.children[1]!) : false;
    const valueNode = ext.children[hasCritical ? 2 : 1];
    result.list.push({ oid, name: extensionOids[oid] ?? oid, critical });
    if (!valueNode) continue;
    let inner: Asn1Node;
    try {
      inner = parseDerStrict(content(valueNode));
    } catch {
      continue; // unbekannte/kaputte Erweiterung nur auflisten
    }
    try {
      switch (oid) {
        case "2.5.29.17":
          result.san = inner.children.map(parseGeneralName);
          break;
        case "2.5.29.15": {
          const bits = readBitString(inner);
          keyUsageNames.forEach((name, i) => {
            if ((bits[i >> 3] ?? 0) & (0x80 >> (i & 7))) result.keyUsage.push(name);
          });
          break;
        }
        case "2.5.29.37":
          result.extKeyUsage = inner.children.map((n) => {
            const o = readOid(n);
            return ekuOids[o] ? `${ekuOids[o]} (${o})` : o;
          });
          break;
        case "2.5.29.19": {
          const ca = isUniversal(inner.children[0], Tag.Boolean)
            ? readBoolean(inner.children[0]!)
            : false;
          const lenNode = inner.children.find((n) => isUniversal(n, Tag.Integer));
          result.basicConstraints = { ca, pathLength: lenNode ? readSmallInt(lenNode) : undefined };
          break;
        }
        case "2.5.29.14":
          result.subjectKeyId = toHex(content(inner), ":").toUpperCase();
          break;
        case "2.5.29.35": {
          const keyId = inner.children.find((n) => isContext(n, 0));
          if (keyId) result.authorityKeyId = toHex(content(keyId), ":").toUpperCase();
          break;
        }
        case "2.5.29.31":
          collectUris(inner, result.crlUrls);
          break;
        case "1.3.6.1.5.5.7.1.1":
          for (const access of inner.children) {
            const method = readOid(child(access, 0));
            const uris: string[] = [];
            collectUris(child(access, 1), uris);
            if (method === "1.3.6.1.5.5.7.48.1") result.ocspUrls.push(...uris);
            if (method === "1.3.6.1.5.5.7.48.2") result.caIssuerUrls.push(...uris);
          }
          break;
      }
    } catch {
      // Inhalt nicht auswertbar – Erweiterung bleibt in der Liste
    }
  }
  return result;
}

// ---------- Zertifikat & CSR ----------

export function parseCertificate(der: Uint8Array): CertificateInfo {
  const cert = parseDerStrict(der);
  const tbs = child(cert, 0);
  let i = 0;
  let version = 1;
  if (isContext(tbs.children[0], 0)) {
    version = readSmallInt(child(child(tbs, 0), 0)) + 1;
    i = 1;
  }
  const serial = readIntegerHex(child(tbs, i));
  const issuer = parseName(child(tbs, i + 2));
  const validity = child(tbs, i + 3);
  const subject = parseName(child(tbs, i + 4));
  const publicKey = parsePublicKey(child(tbs, i + 5));
  const extWrapper = tbs.children.find((n) => isContext(n, 3));
  const ext = parseExtensions(extWrapper?.children[0]);

  const selfSigned =
    subject.text === issuer.text &&
    (!ext.authorityKeyId || !ext.subjectKeyId || ext.authorityKeyId === ext.subjectKeyId);

  return {
    kind: "certificate",
    version,
    serial,
    issuer,
    subject,
    notBefore: readTime(child(validity, 0)),
    notAfter: readTime(child(validity, 1)),
    publicKey,
    signatureAlgorithm: algorithmName(child(cert, 1)),
    san: ext.san,
    keyUsage: ext.keyUsage,
    extKeyUsage: ext.extKeyUsage,
    basicConstraints: ext.basicConstraints,
    subjectKeyId: ext.subjectKeyId,
    authorityKeyId: ext.authorityKeyId,
    crlUrls: ext.crlUrls,
    ocspUrls: ext.ocspUrls,
    caIssuerUrls: ext.caIssuerUrls,
    extensions: ext.list,
    selfSigned,
    spki: raw(child(tbs, i + 5)).slice(),
    der,
  };
}

export function parseCsr(der: Uint8Array): CsrInfo {
  const csr = parseDerStrict(der);
  const info = child(csr, 0);
  const subject = parseName(child(info, 1));
  const publicKey = parsePublicKey(child(info, 2));
  let ext: ParsedExtensions = parseExtensions(undefined);
  const attributes = info.children.find((n) => isContext(n, 0));
  for (const attr of attributes?.children ?? []) {
    // extensionRequest (PKCS#9) bzw. Microsoft-Variante
    const oid = readOid(child(attr, 0));
    if (oid === "1.2.840.113549.1.9.14" || oid === "1.3.6.1.4.1.311.2.1.14") {
      ext = parseExtensions(child(child(attr, 1), 0));
    }
  }
  return {
    kind: "csr",
    subject,
    publicKey,
    signatureAlgorithm: algorithmName(child(csr, 1)),
    san: ext.san,
    keyUsage: ext.keyUsage,
    extKeyUsage: ext.extKeyUsage,
    extensions: ext.list,
    spki: raw(child(info, 2)).slice(),
    der,
  };
}

/** Zertifikate aus einer PKCS#7-Struktur (.p7b) */
function parsePkcs7(top: Asn1Node): Uint8Array[] {
  const signedData = child(child(top, 1), 0);
  const certs = signedData.children.find((n) => isContext(n, 0));
  return (certs?.children ?? [])
    .filter((n) => isUniversal(n, Tag.Sequence))
    .map((n) => raw(n).slice());
}

type DerKind = "certificate" | "csr" | "pkcs7" | "pkcs12" | "unknown";

function detectDer(der: Uint8Array): { kind: DerKind; node: Asn1Node } {
  const top = parseDerStrict(der);
  const first = top.children[0];
  const second = top.children[1];
  if (isUniversal(first, Tag.Oid) && readOid(first) === "1.2.840.113549.1.7.2")
    return { kind: "pkcs7", node: top };
  if (
    isUniversal(first, Tag.Integer) &&
    readSmallInt(first) === 3 &&
    isUniversal(second, Tag.Sequence)
  ) {
    return { kind: "pkcs12", node: top };
  }
  if (isUniversal(first, Tag.Sequence) && top.children.length === 3) {
    if (isContext(first.children[0], 0) || first.children.length >= 6)
      return { kind: "certificate", node: top };
    return { kind: "csr", node: top };
  }
  return { kind: "unknown", node: top };
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/=]/g, "");
  return Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
}

const privateKeyLabels = /PRIVATE KEY/;

/** Liest DER-Bytes (z. B. eine .cer/.der/.p7b-Datei) */
export function decodeDer(der: Uint8Array): DecodeResult {
  const items: DecodedItem[] = [];
  const warnings: string[] = [];
  const { kind, node } = detectDer(der);
  switch (kind) {
    case "certificate":
      items.push(parseCertificate(der));
      break;
    case "csr":
      items.push(parseCsr(der));
      break;
    case "pkcs7":
      for (const c of parsePkcs7(node)) items.push(parseCertificate(c));
      break;
    case "pkcs12":
      warnings.push(
        "PFX/PKCS#12-Dateien enthalten private Schlüssel und werden hier bewusst nicht geöffnet.",
      );
      break;
    default:
      warnings.push("Unbekanntes Format – erwartet Zertifikat, CSR oder PKCS#7.");
  }
  return { items, warnings };
}

/** Liest Text: ein oder mehrere PEM-Blöcke oder reines Base64 */
export function decodeText(text: string): DecodeResult {
  const items: DecodedItem[] = [];
  const warnings: string[] = [];
  const blocks = [...text.matchAll(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g)];

  if (blocks.length === 0) {
    const compact = text.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]+=*$/.test(compact))
      throw new Error("Kein PEM-Block und kein Base64 gefunden.");
    return decodeDer(base64ToBytes(compact));
  }

  for (const [, label, body] of blocks) {
    if (privateKeyLabels.test(label!)) {
      warnings.push(
        "Ein privater Schlüssel wurde ignoriert. Private Schlüssel bitte nirgends einfügen!",
      );
      continue;
    }
    try {
      const der = base64ToBytes(body!);
      if (label === "CERTIFICATE" || label === "TRUSTED CERTIFICATE")
        items.push(parseCertificate(der));
      else if (label === "CERTIFICATE REQUEST" || label === "NEW CERTIFICATE REQUEST")
        items.push(parseCsr(der));
      else if (label === "PKCS7") {
        const r = decodeDer(der);
        items.push(...r.items);
        warnings.push(...r.warnings);
      } else warnings.push(`PEM-Block „${label}“ wird nicht unterstützt.`);
    } catch (e) {
      warnings.push(`PEM-Block „${label}“ konnte nicht gelesen werden: ${(e as Error).message}`);
    }
  }
  return { items, warnings };
}

export async function fingerprints(der: Uint8Array): Promise<{ sha1: string; sha256: string }> {
  const digest = async (alg: string) =>
    toHex(new Uint8Array(await crypto.subtle.digest(alg, der as BufferSource)), ":").toUpperCase();
  return { sha1: await digest("SHA-1"), sha256: await digest("SHA-256") };
}

// ---------- Kette ----------

export function isIssuedBy(cert: CertificateInfo, issuer: CertificateInfo): boolean {
  if (cert.authorityKeyId && issuer.subjectKeyId)
    return cert.authorityKeyId === issuer.subjectKeyId;
  return cert.issuer.text === issuer.subject.text;
}

export interface ChainAnalysis {
  inOrder: boolean;
  issues: string[];
  /** Vorschlag: Blatt → Zwischenzertifikate → Root */
  ordered: CertificateInfo[];
}

export function analyzeChain(certs: CertificateInfo[]): ChainAnalysis | null {
  if (certs.length < 2) return null;
  const issues: string[] = [];
  const name = (c: CertificateInfo) =>
    c.subject.attrs.find((a) => a.type === "CN")?.value ?? c.subject.text;

  let inOrder = true;
  for (let i = 0; i + 1 < certs.length; i++) {
    if (!isIssuedBy(certs[i]!, certs[i + 1]!)) inOrder = false;
  }

  // Blatt = Zertifikat, das kein anderes ausgestellt hat
  const leaf =
    certs.find((c) => !certs.some((o) => o !== c && !o.selfSigned && isIssuedBy(o, c))) ??
    certs[0]!;
  const ordered: CertificateInfo[] = [leaf];
  let current = leaf;
  let gap = false;
  while (!current.selfSigned) {
    const next = certs.find((c) => !ordered.includes(c) && isIssuedBy(current, c));
    if (!next) {
      issues.push(
        `Der Aussteller von „${name(current)}“ (${current.issuer.text}) fehlt in der Kette.`,
      );
      gap = true;
      break;
    }
    ordered.push(next);
    current = next;
  }
  const unused = certs.filter((c) => !ordered.includes(c));
  for (const c of unused) {
    issues.push(
      gap && c.basicConstraints?.ca
        ? `„${name(c)}“ lässt sich ohne das fehlende Zwischenzertifikat nicht anbinden.`
        : `„${name(c)}“ gehört nicht zu dieser Kette.`,
    );
  }
  if (!inOrder && unused.length === 0)
    issues.unshift(
      "Die Reihenfolge stimmt nicht – erwartet wird Blatt → Zwischenzertifikat(e) → Root.",
    );
  if (ordered.length > 1 && ordered[ordered.length - 1]!.selfSigned) {
    issues.push(
      "Das Root-Zertifikat ist enthalten. Server sollten es meist nicht mitsenden – Clients haben es bereits im Vertrauensspeicher.",
    );
  }

  return { inOrder, issues, ordered };
}

export function validityStatus(
  cert: CertificateInfo,
  now = new Date(),
): { tone: "ok" | "warn" | "error"; text: string } {
  const day = 86_400_000;
  if (now < cert.notBefore) return { tone: "error", text: "noch nicht gültig" };
  if (now > cert.notAfter) {
    return {
      tone: "error",
      text: `abgelaufen seit ${Math.floor((now.getTime() - cert.notAfter.getTime()) / day)} Tagen`,
    };
  }
  const left = Math.floor((cert.notAfter.getTime() - now.getTime()) / day);
  return { tone: left <= 30 ? "warn" : "ok", text: `gültig, noch ${left} Tage` };
}

/** Beschreibung eines SubjectPublicKeyInfo (DER), z. B. eines aus einem privaten Schlüssel abgeleiteten */
export function describePublicKey(spki: Uint8Array): PublicKeyInfo {
  return parsePublicKey(parseDerStrict(spki));
}
