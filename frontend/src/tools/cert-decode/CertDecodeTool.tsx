import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { Link } from "../../components/Link";
import { TOOLS_PATH } from "../../navigation";
import { downloadBlob } from "../download";
import { ErrorBox, InfoTable, ToolSection, type InfoRow } from "../ui";
import { buildApcP15, checkApcCompatibility } from "./apc-p15";
import {
  baseName,
  buildP7b,
  certForKey,
  certsToPem,
  chainFrom,
  defaultMainCert,
  keyForCert,
  loadSources,
  webserverZip,
  type LoadedCert,
  type LoadedKey,
  type LoadResult,
  type Source,
} from "./bundle";
import { keyToEncryptedPem, keyToPkcs8Pem, keyToTraditionalPem } from "./keys";
import type { EncryptionMode } from "./pbe";
import { buildPfx } from "./pkcs12";
import {
  analyzeChain,
  fingerprints,
  validityStatus,
  type DecodedItem,
  type PublicKeyInfo,
} from "./x509";

type Tone = "ok" | "warn" | "error" | "neutral";

const PILL: Record<Tone, string> = {
  ok: "pill pill-ok",
  warn: "pill pill-todo",
  error: "pill pill-bad",
  neutral: "pill pill-neutral",
};

function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={PILL[tone]}>{children}</span>;
}

const DATE = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" });
const ACCEPT = ".pem,.crt,.cer,.der,.p7b,.p7c,.csr,.req,.key,.pfx,.p12,.p15,.txt";
const MAX_FILE = 5 * 1024 * 1024;

const commonName = (item: DecodedItem) =>
  item.subject.attrs.find((attr) => attr.type === "CN")?.value ??
  (item.subject.text || "(ohne Antragsteller)");

const keyText = (key: PublicKeyInfo) =>
  [key.algorithm, key.curve, key.bits ? `${key.bits} Bit` : undefined].filter(Boolean).join(" · ");

function weaknesses(item: DecodedItem): string[] {
  const result: string[] = [];
  if (/SHA-1|MD5/.test(item.signatureAlgorithm)) {
    result.push(`Veralteter Signaturalgorithmus: ${item.signatureAlgorithm}`);
  }
  if (item.publicKey.algorithm === "RSA" && (item.publicKey.bits ?? 0) < 2048) {
    result.push(`RSA-Schlüssel mit nur ${item.publicKey.bits} Bit`);
  }
  if (item.kind === "certificate" && !item.basicConstraints?.ca && item.san.length === 0) {
    result.push("Keine alternativen Namen (SAN): Browser akzeptieren den CN allein nicht mehr.");
  }
  return result;
}

function list(values: string[]): ReactNode {
  return values.length === 0 ? (
    "–"
  ) : (
    <ul className="tool-list">
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}

/** Kennwort für den Export, ohne Verzerrung durch Modulo gezogen. */
function randomPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_!";
  const limit = 256 - (256 % alphabet.length);
  let result = "";
  while (result.length < 20) {
    for (const byte of crypto.getRandomValues(new Uint8Array(32))) {
      if (byte < limit && result.length < 20) {
        result += alphabet[byte % alphabet.length];
      }
    }
  }
  return result;
}

const textBlob = (text: string) => new Blob([text], { type: "application/x-pem-file" });
const binBlob = (bytes: Uint8Array, type = "application/octet-stream") =>
  new Blob([bytes as BlobPart], { type });

function ItemCard({
  item,
  index,
  extra,
}: {
  item: DecodedItem;
  index: number;
  extra?: { source?: string; friendlyName?: string; hasKey: boolean };
}) {
  const [fp, setFp] = useState<{ sha1: string; sha256: string } | null>(null);
  useEffect(() => {
    let active = true;
    fingerprints(item.der).then(
      (result) => {
        if (active) {
          setFp(result);
        }
      },
      () => {
        if (active) {
          setFp(null);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [item]);

  const cert = item.kind === "certificate" ? item : null;
  const status = cert ? validityStatus(cert) : null;
  const weak = weaknesses(item);

  const rows: InfoRow[] = [
    { label: "Antragsteller", value: item.subject.text || "–", copy: item.subject.text },
  ];
  if (cert) {
    rows.push(
      { label: "Aussteller", value: cert.issuer.text, copy: cert.issuer.text },
      { label: "Seriennummer", value: cert.serial, copy: cert.serial },
      { label: "Gültig ab", value: DATE.format(cert.notBefore), plain: true },
      { label: "Gültig bis", value: DATE.format(cert.notAfter), plain: true },
    );
  }
  rows.push(
    {
      label: "Alternative Namen (SAN)",
      value: list(item.san.map((san) => `${san.type}: ${san.value}`)),
      copy: item.san.length ? item.san.map((san) => san.value).join("\n") : undefined,
    },
    { label: "Öffentlicher Schlüssel", value: keyText(item.publicKey), plain: true },
    { label: "Signaturalgorithmus", value: item.signatureAlgorithm, plain: true },
    { label: "Schlüsselverwendung", value: list(item.keyUsage), plain: true },
    { label: "Erweiterte Verwendung", value: list(item.extKeyUsage), plain: true },
  );
  if (cert) {
    if (cert.basicConstraints) {
      const constraints = cert.basicConstraints;
      rows.push({
        label: "Basic Constraints",
        value: constraints.ca
          ? `Zertifizierungsstelle${
              constraints.pathLength !== undefined ? `, Pfadlänge ${constraints.pathLength}` : ""
            }`
          : "Endentität (keine CA)",
        plain: true,
      });
    }
    if (cert.subjectKeyId) {
      rows.push({ label: "Subject Key ID", value: cert.subjectKeyId, copy: cert.subjectKeyId });
    }
    if (cert.authorityKeyId) {
      rows.push({
        label: "Authority Key ID",
        value: cert.authorityKeyId,
        copy: cert.authorityKeyId,
      });
    }
    if (cert.crlUrls.length) {
      rows.push({ label: "Sperrliste (CRL)", value: list(cert.crlUrls) });
    }
    if (cert.ocspUrls.length) {
      rows.push({ label: "OCSP", value: list(cert.ocspUrls) });
    }
    if (cert.caIssuerUrls.length) {
      rows.push({ label: "Aussteller-Zertifikat", value: list(cert.caIssuerUrls) });
    }
  }
  if (fp) {
    rows.push(
      { label: "SHA-256-Fingerprint", value: fp.sha256, copy: fp.sha256 },
      {
        label: "SHA-1-Fingerprint (Thumbprint)",
        value: fp.sha1,
        copy: fp.sha1.replace(/:/g, ""),
      },
    );
  }
  rows.push({
    label: "Erweiterungen",
    value: list(
      item.extensions.map((extension) => `${extension.name}${extension.critical ? " (kritisch)" : ""}`),
    ),
    plain: true,
  });
  if (extra?.friendlyName) {
    rows.push({ label: "Anzeigename (PFX)", value: extra.friendlyName, plain: true });
  }
  if (extra?.source) {
    rows.push({ label: "Quelle", value: extra.source, plain: true });
  }

  return (
    <div className="panel tool-card">
      <div className="tool-row">
        <span className="small">#{index + 1}</span>
        <strong className="tool-break">{commonName(item)}</strong>
        <Pill>{item.kind === "certificate" ? "Zertifikat" : "Zertifikatsanforderung (CSR)"}</Pill>
        {status && <Pill tone={status.tone}>{status.text}</Pill>}
        {cert?.basicConstraints?.ca && <Pill>CA</Pill>}
        {cert?.selfSigned && <Pill>selbstsigniert</Pill>}
        {extra?.hasKey && <Pill tone="ok">privater Schlüssel vorhanden</Pill>}
      </div>
      {weak.map((text) => (
        <p key={text} className="hint-box hint-warn">
          {text}
        </p>
      ))}
      <InfoTable rows={rows} caption={`Angaben zu ${commonName(item)}`} />
    </div>
  );
}

function KeyCard({ entry, certs }: { entry: LoadedKey; certs: LoadedCert[] }) {
  const match = certForKey(entry, certs);
  const rows: InfoRow[] = [
    { label: "Typ", value: keyText(entry.key.publicKey), plain: true },
    { label: "Format der Quelle", value: entry.format, plain: true },
    { label: "Quelle", value: entry.source, plain: true },
  ];
  if (entry.friendlyName) {
    rows.push({ label: "Anzeigename (PFX)", value: entry.friendlyName, plain: true });
  }
  return (
    <div className="panel tool-card">
      <div className="tool-row">
        <strong>Privater Schlüssel</strong>
        {match ? (
          <Pill tone="ok">passt zu „{commonName(match.info)}“</Pill>
        ) : !entry.keyId ? (
          <Pill tone="warn">Zuordnung nicht prüfbar</Pill>
        ) : certs.length > 0 ? (
          <Pill tone="error">passt zu keinem Zertifikat</Pill>
        ) : null}
      </div>
      <InfoTable rows={rows} caption="Angaben zum privaten Schlüssel" />
    </div>
  );
}

function ExportGroup({
  title,
  note,
  children,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="cert-export">
      <h3>{title}</h3>
      {note}
      <div className="tool-row">{children}</div>
    </div>
  );
}

const unencryptedHint = (
  <p className="hint-box hint-warn">
    Unverschlüsselt: Die Datei enthält den Schlüssel im Klartext. Sicher ablegen und nach dem
    Einspielen löschen.
  </p>
);

function ExportPanel({ result }: { result: LoadResult }) {
  const { certs, keys } = result;
  const [mainIndex, setMainIndex] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<EncryptionMode>("aes");
  const [friendlyName, setFriendlyName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fallback = defaultMainCert(certs, keys);
  const main = mainIndex !== null && certs[mainIndex] ? certs[mainIndex] : fallback;
  const chain = main
    ? chainFrom(
        main.info,
        certs.map((entry) => entry.info),
      )
    : [];
  const serverChain = chain.filter((entry, index) => index === 0 || !entry.selfSigned);
  const key: LoadedKey | undefined = main ? keyForCert(main, keys) : keys[0];
  const name = baseName(main?.info);
  const apcChecks = main && key ? checkApcCompatibility(main.info, key.key) : [];
  const apcBlocked = apcChecks.some((check) => check.tone === "error");
  const lastInChain = chain.at(-1);

  const run = async (task: () => Promise<void> | void) => {
    setError(null);
    setBusy(true);
    try {
      await task();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const needPassword = () => {
    if (!password) {
      throw new Error("Bitte oben ein Kennwort für den Export eingeben oder erzeugen lassen.");
    }
  };

  return (
    <ToolSection title="Umwandeln und herunterladen">
      {certs.length > 1 && (
        <label>
          Zertifikat
          <select
            value={main ? certs.indexOf(main) : 0}
            onChange={(event) => {
              setMainIndex(Number(event.target.value));
              setError(null);
            }}
          >
            {certs.map((entry, index) => (
              <option key={index} value={index}>
                {commonName(entry.info)}
                {keyForCert(entry, keys) ? " (mit Schlüssel)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {chain.length > 0 && (
        <p className="small">
          Kette für den Export: {chain.map((entry) => commonName(entry)).join(" → ")}
          {lastInChain && !lastInChain.selfSigned
            ? " (Root fehlt, für PFX und P7B gegebenenfalls ergänzen)"
            : ""}
        </p>
      )}

      <div className="tool-columns">
        <div className="tool-row">
          <label>
            Kennwort für den Export (PFX, verschlüsselter Schlüssel)
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError(null);
              }}
            />
          </label>
          <button
            type="button"
            className="button button-secondary"
            aria-pressed={showPassword}
            onClick={() => setShowPassword(!showPassword)}
          >
            {showPassword ? "Verbergen" : "Anzeigen"}
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => {
              setPassword(randomPassword());
              setShowPassword(true);
              setError(null);
            }}
          >
            Erzeugen
          </button>
        </div>
        {main && (
          <label>
            Anzeigename im PFX (freiwillig)
            <input
              type="text"
              value={friendlyName}
              placeholder={main.friendlyName ?? commonName(main.info)}
              onChange={(event) => setFriendlyName(event.target.value)}
            />
          </label>
        )}
      </div>

      {main && (
        <ExportGroup title="Zertifikat und Kette">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => downloadBlob(textBlob(certsToPem([main.info])), `${name}.crt`)}
          >
            PEM (.crt)
          </button>
          <button
            type="button"
            className="button button-secondary"
            onClick={() =>
              downloadBlob(binBlob(main.info.der, "application/pkix-cert"), `${name}.cer`)
            }
          >
            DER (.cer)
          </button>
          {serverChain.length > 1 && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                downloadBlob(textBlob(certsToPem(serverChain)), `${name}-fullchain.pem`)
              }
            >
              Fullchain (.pem)
            </button>
          )}
          {chain.length > 1 && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => downloadBlob(textBlob(certsToPem(chain.slice(1))), `${name}-chain.pem`)}
            >
              Nur Kette ohne Zertifikat (.pem)
            </button>
          )}
          <button
            type="button"
            className="button button-secondary"
            onClick={() =>
              downloadBlob(
                binBlob(buildP7b(chain), "application/x-pkcs7-certificates"),
                `${name}.p7b`,
              )
            }
          >
            PKCS#7 (.p7b)
          </button>
        </ExportGroup>
      )}

      {key && (
        <ExportGroup title="Privater Schlüssel" note={unencryptedHint}>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => downloadBlob(textBlob(keyToPkcs8Pem(key.key)), `${name}.key`)}
          >
            PKCS#8 (.key)
          </button>
          {key.key.traditional && (
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                downloadBlob(
                  textBlob(keyToTraditionalPem(key.key)!),
                  `${name}-${key.key.traditional!.label.startsWith("RSA") ? "rsa" : "ec"}.key`,
                )
              }
            >
              {key.key.traditional.label.startsWith("RSA")
                ? "PKCS#1 „RSA PRIVATE KEY“"
                : "SEC1 „EC PRIVATE KEY“"}{" "}
              (.key)
            </button>
          )}
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                needPassword();
                downloadBlob(
                  textBlob(await keyToEncryptedPem(key.key, password)),
                  `${name}-verschluesselt.key`,
                );
              })
            }
          >
            Verschlüsselt mit Kennwort (.key)
          </button>
        </ExportGroup>
      )}
      {main && keys.length > 0 && !key && (
        <p className="hint-box hint-warn">
          Kein geladener privater Schlüssel passt zu „{commonName(main.info)}“. PFX und
          Webserver-Paket gehen nur mit passendem Schlüssel.
        </p>
      )}

      {main && (
        <ExportGroup
          title="PFX / PKCS#12 (Windows, IIS, Exchange, Java, Azure)"
          note={
            <p className="small">
              {key
                ? "Enthält Zertifikat, Kette und privaten Schlüssel."
                : "Ohne privaten Schlüssel, nur Zertifikat und Kette."}{" "}
              {mode === "aes"
                ? "Modern: für Windows 10, Windows Server 2019 und neuer, OpenSSL 3 und Java."
                : "Kompatibel: für Windows Server 2016 und älter sowie alte Geräte."}
            </p>
          }
        >
          <label>
            Verschlüsselung
            <select
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as EncryptionMode);
                setError(null);
              }}
            >
              <option value="aes">Modern (AES-256, SHA-256)</option>
              <option value="3des">Kompatibel (3DES, SHA-1)</option>
            </select>
          </label>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                needPassword();
                const pfx = await buildPfx({
                  key: key?.key.pkcs8,
                  certs: chain.map((entry) => entry.der),
                  password,
                  friendlyName:
                    friendlyName.trim() || main.friendlyName || commonName(main.info),
                  mode,
                });
                downloadBlob(binBlob(pfx, "application/x-pkcs12"), `${name}.pfx`);
              })
            }
          >
            {busy ? "Erstelle …" : "PFX erstellen"}
          </button>
        </ExportGroup>
      )}

      {main && key && (
        <ExportGroup
          title="Webserver-Paket (nginx, Apache, HAProxy)"
          note={
            <>
              <p className="small">
                ZIP mit cert.pem, chain.pem, fullchain.pem, privkey.pem und combined.pem. Die Root
                wird weggelassen.
              </p>
              {unencryptedHint}
            </>
          }
        >
          <button
            type="button"
            className="button button-secondary"
            onClick={() =>
              void run(() =>
                downloadBlob(
                  binBlob(webserverZip(chain, key.key), "application/zip"),
                  `${name}-webserver.zip`,
                ),
              )
            }
          >
            ZIP herunterladen
          </button>
        </ExportGroup>
      )}

      {main && key && (
        <ExportGroup
          title="APC-Netzwerkkarte (NMC2/NMC3: USV, PDU), .p15"
          note={
            <>
              <p className="small">
                Eine Datei mit Zertifikat und Schlüssel im Format des „NMC Security Wizard“. Sie
                ersetzt den Wizard samt neuer CSR. Hochladen unter Configuration → Network → Web →
                SSL Certificate (oder per FTP/SCP nach /ssl), danach das Management-Interface neu
                starten. Die Kette ist nicht enthalten.
              </p>
              {apcChecks
                .filter((check) => check.tone !== "error")
                .map((check) => (
                  <p key={check.text} className="small">
                    <Pill tone={check.tone}>{check.tone === "ok" ? "ok" : "Hinweis"}</Pill>{" "}
                    {check.text}
                  </p>
                ))}
              <p className="hint-box hint-warn">
                Unverschlüsselt: APC schützt den Schlüssel nur mit einem fest eingebauten Kennwort.
                Die Datei wie einen Klartext-Schlüssel behandeln.
              </p>
            </>
          }
        >
          {apcBlocked ? (
            <div className="hint-box hint-bad">
              <p>
                <strong>Mit diesem Schlüssel ist keine .p15-Datei für die NMC2 möglich.</strong>
              </p>
              {apcChecks
                .filter((check) => check.tone === "error")
                .map((check) => (
                  <p key={check.text}>{check.text}</p>
                ))}
              <p>
                So geht es: neuen RSA-Schlüssel mit 2048 Bit und CSR erstellen, von der CA
                signieren lassen und das Zertifikat zusammen mit dem neuen Schlüssel hier laden.{" "}
                <Link to={`${TOOLS_PATH}/csr?schluessel=rsa2048`}>CSR mit RSA 2048 erstellen</Link>
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() =>
                void run(async () =>
                  downloadBlob(binBlob(await buildApcP15(main.info, key.key)), `${name}-apc.p15`),
                )
              }
            >
              .p15 herunterladen
            </button>
          )}
        </ExportGroup>
      )}

      {error && <ErrorBox>{error}</ErrorBox>}
    </ToolSection>
  );
}

export default function CertDecodeTool() {
  // Zertifikate, Schlüssel und Kennwörter bleiben im Speicher der Seite, nie in der Adresszeile.
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Source[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [result, setResult] = useState<LoadResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const sources = useMemo<Source[]>(
    () => [
      ...(text.trim() ? [{ name: "Eingabefeld", bytes: new TextEncoder().encode(text) }] : []),
      ...files,
    ],
    [text, files],
  );

  useEffect(() => {
    let active = true;
    // Kurz warten, damit nicht bei jedem Tastendruck (Kennwort) neu entschlüsselt wird.
    const timer = window.setTimeout(() => {
      if (sources.length === 0) {
        setResult(null);
        setLoadError(null);
        return;
      }
      loadSources(sources, password).then(
        (loaded) => {
          if (active) {
            setResult(loaded);
            setLoadError(null);
          }
        },
        (caught: unknown) => {
          if (active) {
            setResult(null);
            setLoadError((caught as Error).message);
          }
        },
      );
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [sources, password]);

  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.target.value = "";
    setFileError(null);
    const tooBig = picked.filter((file) => file.size > MAX_FILE);
    if (tooBig.length > 0) {
      setFileError(`Größer als 5 MB: ${tooBig.map((file) => file.name).join(", ")}`);
    }
    const loaded = await Promise.all(
      picked
        .filter((file) => file.size <= MAX_FILE)
        .map(async (file) => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })),
    );
    setFiles((previous) => [
      ...previous.filter((entry) => !loaded.some((fresh) => fresh.name === entry.name)),
      ...loaded,
    ]);
  };

  const chain = analyzeChain(result?.certs.map((entry) => entry.info) ?? []);
  const count = result ? result.certs.length + result.csrs.length : 0;
  const hasPfx =
    files.some((file) => /\.(pfx|p12)$/i.test(file.name)) ||
    (result?.pfx.some((entry) => entry.kind === "pfx") ?? false);

  return (
    <div className="tool-body settings-form">
      <ToolSection title="Eingabe">
        <label>
          Zertifikat, Kette, CSR oder privater Schlüssel (PEM oder Base64)
          <textarea
            rows={8}
            value={text}
            spellCheck={false}
            placeholder={"-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <div className="tool-field">
          <label>
            Dateien öffnen
            <input type="file" multiple accept={ACCEPT} onChange={(event) => void onFiles(event)} />
          </label>
          <p className="small">
            .pem, .crt, .cer, .der, .p7b, .csr, .key, .pfx/.p12 und .p15 (APC), mehrere Dateien
            möglich.
          </p>
          {fileError && <ErrorBox>{fileError}</ErrorBox>}
        </div>
        {files.length > 0 && (
          <ul className="tool-row cert-files">
            {files.map((file) => (
              <li key={file.name}>
                <span className="tool-break">{file.name}</span>{" "}
                <button
                  type="button"
                  className="button button-secondary"
                  aria-label={`${file.name} entfernen`}
                  onClick={() => setFiles((previous) => previous.filter((entry) => entry !== file))}
                >
                  Entfernen
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="tool-field">
          <label className="narrow">
            Kennwort {hasPfx ? "der PFX-Datei" : "(für PFX oder verschlüsselte Schlüssel)"}
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <p role="status">
            {result?.password === "wrong" && <Pill tone="error">Kennwort ist falsch</Pill>}
            {result?.password === "missing" && <Pill tone="warn">Kennwort erforderlich</Pill>}
          </p>
        </div>
        <p className="small">
          Alles wird nur in diesem Browser verarbeitet. Schlüssel und Kennwörter werden nicht
          gespeichert, nicht übertragen und nicht in die Adresszeile geschrieben.
        </p>
      </ToolSection>

      {loadError && <ErrorBox>{loadError}</ErrorBox>}
      {result?.errors.map((message) => (
        <ErrorBox key={message}>{message}</ErrorBox>
      ))}
      {result?.warnings.map((message) => (
        <p key={message} className="hint-box hint-warn">
          {message}
        </p>
      ))}

      {result && (result.certs.length > 0 || result.keys.length > 0) && (
        <ExportPanel result={result} />
      )}

      {result?.pfx.map((entry) => (
        <ToolSection
          key={entry.source}
          title={`${entry.kind === "apc" ? "APC-.p15-Datei" : "PFX-Datei"}${
            result.pfx.length > 1 || files.length > 1 ? `: ${entry.source}` : ""
          }`}
        >
          <InfoTable
            caption="Angaben zur Containerdatei"
            rows={entry.details.map((detail) => ({
              label: detail.label,
              value: detail.value,
              plain: true,
            }))}
          />
        </ToolSection>
      ))}

      {result && result.keys.length > 0 && (
        <ToolSection
          title={
            result.keys.length === 1
              ? "Privater Schlüssel"
              : `Private Schlüssel (${result.keys.length})`
          }
        >
          {result.keys.map((entry, index) => (
            <KeyCard key={index} entry={entry} certs={result.certs} />
          ))}
        </ToolSection>
      )}

      {chain && (
        <ToolSection title="Kette">
          <p className="tool-row">
            <Pill
              tone={
                chain.inOrder && !chain.issues.some((issue) => issue.includes("fehlt"))
                  ? "ok"
                  : "warn"
              }
            >
              {chain.inOrder ? "Reihenfolge korrekt" : "Reihenfolge falsch"}
            </Pill>
            <span className="small">
              {chain.ordered.map((entry) => commonName(entry)).join(" → ")}
            </span>
          </p>
          {chain.issues.length > 0 && list(chain.issues)}
        </ToolSection>
      )}

      {result && count > 0 && (
        <ToolSection title={count === 1 ? "Inhalt" : `Inhalt (${count} Objekte)`}>
          {result.certs.map((entry, index) => (
            <ItemCard
              key={`c${index}`}
              item={entry.info}
              index={index}
              extra={{
                source: sources.length > 1 ? entry.source : undefined,
                friendlyName: entry.friendlyName,
                hasKey: !!keyForCert(entry, result.keys),
              }}
            />
          ))}
          {result.csrs.map((entry, index) => (
            <ItemCard key={`r${index}`} item={entry.info} index={result.certs.length + index} />
          ))}
        </ToolSection>
      )}
    </div>
  );
}
