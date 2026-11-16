import { useState } from "react";
import { keyToEncryptedPem, parsePkcs8 } from "../cert-decode/keys";
import { downloadBlob } from "../download";
import { useToolParams } from "../params";
import { ErrorBox, Output, ToolSection } from "../ui";
import {
  createCsr,
  keyTypeLabels,
  opensslCommand,
  parseSans,
  type CsrOptions,
  type KeyType,
} from "./csr";

const KEY_TYPES = Object.keys(keyTypeLabels) as KeyType[];

const FIELDS = [
  ["cn", "Common Name (CN)", "www.example.com"],
  ["o", "Organisation (O)", "Beispiel GmbH"],
  ["ou", "Abteilung (OU), von vielen CAs ignoriert", "IT"],
  ["l", "Ort (L)", ""],
  ["st", "Bundesland (ST)", ""],
  ["c", "Land (C)", "DE"],
  ["e", "E-Mail (freiwillig)", ""],
] as const;

type FieldKey = (typeof FIELDS)[number][0];

const EMPTY: Record<FieldKey, string> = { cn: "", o: "", ou: "", l: "", st: "", c: "", e: "" };

const pemBlob = (text: string) => new Blob([text], { type: "application/x-pem-file" });

export default function CsrTool() {
  // In der Adresszeile stehen nur Schlüsseltyp und Verwendung, nie Namen oder Kennwörter.
  const [params, setParams] = useToolParams({ schluessel: "rsa2048", server: "1", client: "0" });
  const keyType: KeyType = KEY_TYPES.includes(params.schluessel as KeyType)
    ? (params.schluessel as KeyType)
    : "rsa2048";
  const [subject, setSubject] = useState(EMPTY);
  const [sanText, setSanText] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ csr: string; key: string; encrypted: boolean } | null>(
    null,
  );

  const cn = subject.cn.trim();
  const sans = parseSans(sanText);
  const sanCount = sans.dns.length + sans.ip.length + sans.email.length;
  const options: CsrOptions = {
    keyType,
    subject: {
      CN: subject.cn,
      O: subject.o,
      OU: subject.ou,
      L: subject.l,
      ST: subject.st,
      C: subject.c.trim().toUpperCase(),
      E: subject.e,
    },
    // Ohne SANs kommt der CN hinein: Browser werten nur die SANs aus.
    sans: sanCount === 0 && cn ? cn : sanText,
    serverAuth: params.server === "1",
    clientAuth: params.client === "1",
  };
  const fileBase = (cn || "server").replace(/^\*\./, "wildcard.").replace(/[^\w.-]/g, "_");

  const run = async () => {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const created = await createCsr(options);
      const key = keyPassword
        ? await keyToEncryptedPem(await parsePkcs8(created.pkcs8), keyPassword)
        : created.keyPem;
      setResult({ csr: created.csrPem, key, encrypted: keyPassword !== "" });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tool-body settings-form">
      <ToolSection title="Antragsteller">
        <div className="tool-columns">
          {FIELDS.map(([key, label, placeholder]) => (
            <label key={key} className={key === "cn" ? "tool-wide" : undefined}>
              {label}
              <input
                type="text"
                value={subject[key]}
                placeholder={placeholder}
                maxLength={key === "c" ? 2 : 256}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setSubject({ ...subject, [key]: event.target.value });
                  setResult(null);
                }}
              />
            </label>
          ))}
        </div>
        <div className="tool-field">
          <label>
            Alternative Namen (SAN), ein Name pro Zeile oder durch Komma getrennt
            <textarea
              rows={4}
              value={sanText}
              spellCheck={false}
              placeholder={"www.example.com\nexample.com\n192.0.2.10"}
              onChange={(event) => {
                setSanText(event.target.value);
                setResult(null);
              }}
            />
          </label>
          <p className="small">
            {sanCount > 0
              ? `${sans.dns.length} DNS-Namen, ${sans.ip.length} IP-Adressen, ${sans.email.length} E-Mail-Adressen`
              : "Leer: Der Common Name wird automatisch als SAN übernommen."}
          </p>
          {sans.invalid.length > 0 && (
            <p className="hint-box hint-warn">Ungültig: {sans.invalid.join(", ")}</p>
          )}
        </div>
      </ToolSection>

      <ToolSection title="Schlüssel">
        <div className="tool-columns">
          <label>
            Schlüsseltyp
            <select
              value={keyType}
              onChange={(event) => setParams({ schluessel: event.target.value })}
            >
              {KEY_TYPES.map((key) => (
                <option key={key} value={key}>
                  {keyTypeLabels[key]}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="tool-options">
            <legend>Verwendung</legend>
            <label className="check-label">
              <input
                type="checkbox"
                className="check"
                checked={params.server === "1"}
                onChange={(event) => setParams({ server: event.target.checked ? "1" : "0" })}
              />
              Serverauthentifizierung (TLS-Server)
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                className="check"
                checked={params.client === "1"}
                onChange={(event) => setParams({ client: event.target.checked ? "1" : "0" })}
              />
              Clientauthentifizierung
            </label>
          </fieldset>
          <div className="tool-field">
            <label>
              Kennwort für den privaten Schlüssel (freiwillig)
              <input
                type="password"
                autoComplete="new-password"
                value={keyPassword}
                onChange={(event) => setKeyPassword(event.target.value)}
              />
            </label>
            <p className="small">
              Mit Kennwort: verschlüsseltes PKCS#8 (AES-256). nginx und Apache brauchen den
              Schlüssel meist unverschlüsselt.
            </p>
          </div>
        </div>
      </ToolSection>

      <div className="tool-row">
        <button
          type="button"
          className="button"
          disabled={busy || cn === ""}
          onClick={() => void run()}
        >
          {busy ? "Erzeuge Schlüssel …" : "CSR und Schlüssel erzeugen"}
        </button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}

      {result && (
        <>
          <Output value={result.csr} label="CSR (an die CA übergeben)" />
          <div className="tool-row">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => downloadBlob(pemBlob(result.csr), `${fileBase}.csr`)}
            >
              {fileBase}.csr herunterladen
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => downloadBlob(pemBlob(result.key), `${fileBase}.key`)}
            >
              {fileBase}.key herunterladen
            </button>
          </div>
          <Output
            value={result.key}
            label={
              result.encrypted
                ? "Privater Schlüssel (verschlüsselt)"
                : "Privater Schlüssel, geheim halten"
            }
          />
          <p className="hint-box hint-warn">
            Der Schlüssel existiert nur in diesem Browserfenster. Jetzt herunterladen und sicher
            ablegen, beim Neuladen ist er weg. Später lässt er sich mit „Zertifikate anzeigen und
            umwandeln“ zur PFX-Datei zusammenfügen.
          </p>
        </>
      )}

      {cn !== "" && (
        <Output value={opensslCommand(options)} label="Dasselbe mit OpenSSL" />
      )}

      <p className="small">
        Schlüssel und CSR entstehen nur in diesem Browser. Nichts davon wird gespeichert, übertragen
        oder in die Adresszeile geschrieben.
      </p>
    </div>
  );
}
