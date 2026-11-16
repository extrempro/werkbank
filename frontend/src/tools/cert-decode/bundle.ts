/**
 * Eingaben (Text und Dateien) einlesen und alles für den Export zusammenstellen:
 * Zertifikate, CSRs, private Schlüssel und PFX-Inhalte – inklusive Zuordnung Schlüssel ↔ Zertifikat.
 */
import { parseDerStrict, toHex } from "./asn1";
import { explicit, fromBase64, integer, oid, pem, seq, set, tlv, concat } from "./der";
import { createZip } from "../image-convert/zip";
import {
  detectKeyDer,
  keyFromDer,
  keyToPkcs8Pem,
  PasswordError,
  publicKeyId,
  type KeyDerKind,
  type PrivateKey,
} from "./keys";
import { looksLikeApcP15, readApcP15 } from "./apc-p15";
import { looksLikePfx, parsePfx } from "./pkcs12";
import {
  decodeDer,
  decodeText,
  isIssuedBy,
  parseCertificate,
  type CertificateInfo,
  type CsrInfo,
} from "./x509";

export interface Source {
  name: string;
  bytes: Uint8Array;
}

export interface LoadedCert {
  info: CertificateInfo;
  source: string;
  friendlyName?: string;
  /** Schlüssel-ID des öffentlichen Schlüssels (zum Abgleich) */
  keyId: string;
}

export interface LoadedKey {
  key: PrivateKey;
  source: string;
  /** Format der Quelle, z. B. „PKCS#8, verschlüsselt (AES-256 …)“ */
  format: string;
  friendlyName?: string;
  keyId?: string;
}

export interface PfxSummary {
  /** Containerformat: PFX/PKCS#12 oder .p15 für APC-Netzwerkkarten */
  kind: "pfx" | "apc";
  source: string;
  details: { label: string; value: string }[];
}

export interface LoadResult {
  certs: LoadedCert[];
  csrs: { info: CsrInfo; source: string }[];
  keys: LoadedKey[];
  pfx: PfxSummary[];
  warnings: string[];
  errors: string[];
  /** Kennwort fehlt bzw. ist falsch (für den Hinweis am Kennwortfeld) */
  password: "ok" | "missing" | "wrong";
}

const keyLabels: Record<string, KeyDerKind> = {
  "PRIVATE KEY": "pkcs8",
  "ENCRYPTED PRIVATE KEY": "pkcs8-encrypted",
  "RSA PRIVATE KEY": "pkcs1",
  "EC PRIVATE KEY": "sec1",
};

const formatNames: Record<KeyDerKind, string> = {
  pkcs8: "PKCS#8",
  "pkcs8-encrypted": "PKCS#8, verschlüsselt",
  pkcs1: "PKCS#1 (RSA)",
  sec1: "SEC1 (EC)",
};

const isText = (bytes: Uint8Array) => {
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart();
  return head.startsWith("-----BEGIN") || /^[A-Za-z0-9+/=\s]+$/.test(head);
};

export async function loadSources(sources: Source[], password: string): Promise<LoadResult> {
  const result: LoadResult = {
    certs: [],
    csrs: [],
    keys: [],
    pfx: [],
    warnings: [],
    errors: [],
    password: "ok",
  };
  const seenCerts = new Set<string>();
  const seenKeys = new Set<string>();
  const multi = sources.length > 1;
  const prefix = (source: string) => (multi ? `${source}: ` : "");

  const notePassword = (e: PasswordError, source: string) => {
    // „falsch“ hat Vorrang vor „fehlt“
    if (result.password !== "wrong") result.password = e.missing ? "missing" : "wrong";
    const msg = prefix(source) + e.message;
    if (!result.errors.includes(msg)) result.errors.push(msg);
  };

  const addCert = (der: Uint8Array, source: string, friendlyName?: string) => {
    const hex = toHex(der);
    if (seenCerts.has(hex)) return;
    seenCerts.add(hex);
    const info = parseCertificate(der);
    result.certs.push({ info, source, friendlyName, keyId: publicKeyId(info.spki) });
  };

  const addKey = (key: PrivateKey, source: string, format: string, friendlyName?: string) => {
    const hex = toHex(key.pkcs8);
    if (seenKeys.has(hex)) return;
    seenKeys.add(hex);
    result.keys.push({
      key,
      source,
      format,
      friendlyName,
      keyId: key.spki ? publicKeyId(key.spki) : undefined,
    });
  };

  const addDecoded = (r: ReturnType<typeof decodeDer>, source: string) => {
    for (const item of r.items) {
      if (item.kind === "certificate") addCert(item.der, source);
      else result.csrs.push({ info: item, source });
    }
    result.warnings.push(...r.warnings.map((w) => prefix(source) + w));
  };

  const readKey = async (der: Uint8Array, kind: KeyDerKind, source: string) => {
    const { key, method } = await keyFromDer(der, kind, password);
    addKey(key, source, method ? `${formatNames[kind]} (${method})` : formatNames[kind]);
  };

  const readPfx = async (bytes: Uint8Array, source: string) => {
    const content = await parsePfx(bytes, password);
    result.pfx.push({ kind: "pfx", source, details: content.details });
    result.warnings.push(...content.warnings.map((w) => prefix(source) + w));
    for (const c of content.certs) addCert(c.der, source, c.friendlyName);
    for (const k of content.keys) {
      const { key } = await keyFromDer(k.der, "pkcs8", "");
      addKey(key, source, "aus PFX", k.friendlyName);
    }
  };

  const readApc = async (bytes: Uint8Array, source: string) => {
    const p15 = await readApcP15(bytes);
    const { key } = await keyFromDer(p15.rsaPkcs1, "pkcs1", "");
    const bits = key.publicKey.bits;
    result.pfx.push({
      kind: "apc",
      source,
      details: [
        {
          label: "Format",
          value: p15.header ? "APC-Netzwerkkarte (.p15 mit APC-Header)" : "PKCS#15 ohne APC-Header",
        },
        ...(p15.header ? [{ label: "Header", value: "Länge und Prüfsummen korrekt" }] : []),
        ...(p15.tool ? [{ label: "Erzeugt mit", value: p15.tool }] : []),
        {
          label: "Inhalt",
          value: p15.certificate
            ? "Zertifikat und privater Schlüssel"
            : "nur privater Schlüssel (kein Zertifikat – z. B. aus „--csr“ des Security Wizard)",
        },
        { label: "Bezeichnung", value: p15.label },
        { label: "Schlüssel", value: `${key.publicKey.algorithm}${bits ? ` ${bits} Bit` : ""}` },
        {
          label: "Schutz des Schlüssels",
          value: `${p15.protection.cipher}, PBKDF2 (${p15.protection.kdfHash}, ${p15.protection.iterations.toLocaleString("de-DE")} Iterationen), ${p15.protection.mac} – mit dem fest eingebauten APC-Kennwort, also praktisch unverschlüsselt`,
        },
      ],
    });
    if (p15.certificate) addCert(p15.certificate, source, p15.label);
    addKey(key, source, "APC-.p15 (NMC)", p15.label);
  };

  const readBinary = async (bytes: Uint8Array, source: string) => {
    if (looksLikeApcP15(bytes)) return readApc(bytes, source);
    if (looksLikePfx(bytes)) return readPfx(bytes, source);
    const top = parseDerStrict(bytes);
    const kind = detectKeyDer(top);
    if (kind) return readKey(bytes, kind, source);
    addDecoded(decodeDer(bytes), source);
  };

  const readText = async (text: string, source: string) => {
    const blocks = [...text.matchAll(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g)];
    if (blocks.length === 0) {
      const compact = text.replace(/\s+/g, "");
      if (!/^[A-Za-z0-9+/]+=*$/.test(compact))
        throw new Error("Kein PEM-Block und kein Base64 gefunden.");
      return readBinary(fromBase64(compact), source);
    }
    for (const [block, label, body] of blocks) {
      try {
        const keyKind = keyLabels[label!];
        if (keyKind) {
          if (/Proc-Type:\s*4,ENCRYPTED/.test(body!)) {
            throw new Error(
              "Altes OpenSSL-Verschlüsselungsformat (Proc-Type/DEK-Info) wird nicht unterstützt. Umwandeln mit: openssl pkcs8 -topk8 -in alt.key -out neu.key",
            );
          }
          await readKey(fromBase64(body!), keyKind, source);
        } else if (label === "EC PARAMETERS") {
          // gehört zu „openssl ecparam -genkey“ – ohne Bedeutung
        } else if (label === "PKCS12") {
          await readPfx(fromBase64(body!), source);
        } else {
          addDecoded(decodeText(block), source);
        }
      } catch (e) {
        if (e instanceof PasswordError) notePassword(e, source);
        else result.errors.push(`${prefix(source)}PEM-Block „${label}“: ${(e as Error).message}`);
      }
    }
  };

  for (const s of sources) {
    try {
      if (isText(s.bytes)) await readText(new TextDecoder().decode(s.bytes), s.name);
      else await readBinary(s.bytes, s.name);
    } catch (e) {
      if (e instanceof PasswordError) notePassword(e, s.name);
      else {
        const msg = (e as Error).message;
        result.errors.push(
          prefix(s.name) +
            (/abgeschnitten|Unerwarteter Aufbau|Zusätzliche Daten/.test(msg)
              ? `Datei ist beschädigt oder kein unterstütztes Format (${msg}).`
              : msg),
        );
      }
    }
  }
  return result;
}

// ---------- Zuordnung & Kette ----------

export const certForKey = (key: LoadedKey, certs: LoadedCert[]) =>
  key.keyId ? certs.find((c) => c.keyId === key.keyId) : undefined;
export const keyForCert = (cert: LoadedCert, keys: LoadedKey[]) =>
  keys.find((k) => k.keyId && k.keyId === cert.keyId);

/** Kette ab `leaf` bis zur Root, soweit vorhanden */
export function chainFrom(leaf: CertificateInfo, all: CertificateInfo[]): CertificateInfo[] {
  const chain = [leaf];
  let current = leaf;
  while (!current.selfSigned) {
    const next = all.find((c) => !chain.includes(c) && isIssuedBy(current, c));
    if (!next) break;
    chain.push(next);
    current = next;
  }
  return chain;
}

/** sinnvolles Hauptzertifikat: das mit passendem Schlüssel, sonst das Blatt der Kette */
export function defaultMainCert(certs: LoadedCert[], keys: LoadedKey[]): LoadedCert | undefined {
  const withKey = certs.find((c) => keyForCert(c, keys));
  if (withKey) return withKey;
  return (
    certs.find(
      (c) => !certs.some((o) => o !== c && !o.info.selfSigned && isIssuedBy(o.info, c.info)),
    ) ?? certs[0]
  );
}

// ---------- Exportformate ----------

export const certsToPem = (certs: CertificateInfo[]) =>
  certs.map((c) => pem("CERTIFICATE", c.der)).join("");

/** PKCS#7 „degenerate SignedData“ – nur Zertifikate, keine Signatur (.p7b) */
export function buildP7b(certs: CertificateInfo[]): Uint8Array {
  const signedData = seq(
    integer(1),
    set(),
    seq(oid("1.2.840.113549.1.7.1")),
    tlv(0xa0, concat(certs.map((c) => c.der))),
    set(),
  );
  return seq(oid("1.2.840.113549.1.7.2"), explicit(0, signedData));
}

/**
 * Paket für Webserver (nginx, Apache, HAProxy, Traefik …).
 * Die Root gehört nicht in die Server-Kette und wird weggelassen.
 */
export function webserverZip(chain: CertificateInfo[], key: PrivateKey): Uint8Array {
  const [leaf, ...rest] = chain;
  if (!leaf) throw new Error("Kein Zertifikat ausgewählt");
  const intermediates = rest.filter((c) => !c.selfSigned);
  const enc = new TextEncoder();
  const keyPem = keyToPkcs8Pem(key);
  const readme = [
    "Zertifikats-Paket für Webserver – erstellt mit der IT-Toolbox",
    "",
    "cert.pem       Serverzertifikat",
    "chain.pem      Zwischenzertifikat(e) ohne Root",
    "fullchain.pem  Serverzertifikat + Zwischenzertifikat(e) – das braucht fast jeder Server",
    "privkey.pem    privater Schlüssel (UNVERSCHLÜSSELT – Rechte z. B. 600, nach dem Einspielen löschen)",
    "combined.pem   fullchain + Schlüssel in einer Datei (HAProxy)",
    "",
    "nginx:   ssl_certificate fullchain.pem;  ssl_certificate_key privkey.pem;",
    "Apache:  SSLCertificateFile fullchain.pem  SSLCertificateKeyFile privkey.pem",
    "",
  ].join("\r\n");
  return createZip([
    { name: "cert.pem", data: enc.encode(certsToPem([leaf])) },
    ...(intermediates.length
      ? [{ name: "chain.pem", data: enc.encode(certsToPem(intermediates)) }]
      : []),
    { name: "fullchain.pem", data: enc.encode(certsToPem([leaf, ...intermediates])) },
    { name: "privkey.pem", data: enc.encode(keyPem) },
    { name: "combined.pem", data: enc.encode(certsToPem([leaf, ...intermediates]) + keyPem) },
    { name: "LIESMICH.txt", data: enc.encode(readme) },
  ]);
}

/** Dateiname aus dem CN, z. B. „*.example.com“ → „wildcard.example.com“ */
export function baseName(cert: CertificateInfo | undefined): string {
  const cn =
    cert?.subject.attrs.find((a) => a.type === "CN")?.value ??
    cert?.san.find((s) => s.type === "DNS")?.value ??
    "zertifikat";
  return (
    cn
      .replace(/^\*\./, "wildcard.")
      .replace(/[^A-Za-z0-9._-]+/g, "_")
      .replace(/^[._]+|[._]+$/g, "") || "zertifikat"
  );
}
